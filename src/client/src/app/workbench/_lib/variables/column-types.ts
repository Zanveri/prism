import type { Engine } from "@/components/ui/engine-tag";

import type { ColumnRef, TypeAnnotation } from "./ast";
import { annotationColumns } from "./named-types";
import type { ScriptModel } from "./script";
import { booleanType, nullable, numberType, stringType, type Type } from "./values";
import { phrase } from "./variables.copy";

/*
 * O tipo de uma coluna (RN-VAR-004): `let c: pedido.cliente_id` e o `random.of(pedido.cliente_id)` (RN-VAR-010) dão à variável o tipo da coluna, lido no catálogo
 * pela sessão da aba. Aqui fica o que é puro: o quadro dos tipos de cada banco, os nomes como o catálogo os guarda e a leitura, com o catálogo dado por quem chama.
 */

/** A espécie do tipo da coluna, pelo quadro da RN-VAR-004. `binary` e `list` são recusadas. */
export type ColumnKind = "number" | "boolean" | "day" | "instant" | "string" | "binary" | "list";

/** A espécie que a variável aceita. */
export type VariableColumnKind = Exclude<ColumnKind, "binary" | "list">;

const numberTypes = /^(smallint|integer|bigint|int[248]?|numeric|decimal|real|double precision|double|decfloat|float|smallfloat|serial8?|bigserial|smallserial)\b/;

/** A espécie do tipo como o catálogo o escreve (`format_type` no PostgreSQL, `SYSCAT.COLUMNS.TYPENAME` no Db2, o nome montado de `coltype` no Informix). */
export function columnKindOf(type: string, engine: Engine | undefined): ColumnKind {
  const text = type.trim().toLowerCase();
  if (text.endsWith("[]")) return "list";
  if (/^(bytea|blob|binary|varbinary|byte)\b/.test(text) || text.includes("for bit data")) return "binary";
  if (text === "boolean" || text === "bool") return "boolean";
  if (text === "date" || /^datetime\s+year\s+to\s+day$/.test(text)) return "day";
  if (/^timestamp\b/.test(text) || /^datetime\s+year\s+to\b/.test(text)) return "instant";
  // O `money` é número só no Informix: no PostgreSQL ele vem com o símbolo da moeda, e é texto.
  if (numberTypes.test(text) || (engine === 3 && /^money\b/.test(text))) return "number";
  return "string";
}

/** O tipo da variável para uma espécie de coluna, com o `| null` quando a coluna aceita nulo. */
export function typeOfKind(kind: VariableColumnKind, isNullable: boolean): Type {
  const base: Type = kind === "number" ? numberType : kind === "boolean" ? booleanType : kind === "string" ? stringType : { tag: "date", precision: kind };
  return isNullable ? nullable(base) : base;
}

/** O que a leitura de uma coluna deu: o tipo e onde ela está, ou a frase do erro (RN-VAR-004). */
export type ColumnRead =
  | { ok: true; type: Type; kind: VariableColumnKind; schema: string; table: string; column: string; isPrimaryKey: boolean; /** O tipo como o catálogo o escreve. */ dbType: string }
  | { ok: false; message: string };

/** O que o avaliador recebe de cada coluna, pelo texto dela como foi escrito (`ColumnRef.text`): o tipo, ou a frase do erro. Vai ao Worker como dado. */
export type ColumnTypes = ReadonlyMap<string, { type: Type } | { error: string }>;

export const columnTypesOf = (reads: ReadonlyMap<string, ColumnRead>): ColumnTypes => new Map([...reads].map(([text, read]) => [text, read.ok ? { type: read.type } : { error: read.message }] as const));

/** O tipo da anotação de coluna (`pedido.cliente_id`, `pedido.cliente_id[]`, com o `| null`), com o tipo lido; ou a frase, quando a coluna não se resolveu. */
export function columnAnnotationType(annotation: TypeAnnotation, columns: ColumnTypes | undefined): Type | { error: string } {
  const ref = annotation.column as ColumnRef;
  const read = columns?.get(ref.text);
  if (read === undefined) return { error: phrase.columnNotRead(ref.text) };
  if ("error" in read) return read;
  const type: Type = annotation.list ? { tag: "list", item: read.type } : read.type;
  return annotation.nullable ? nullable(type) : type;
}

/**
 * As colunas que as atribuições `indices` citam, no tipo (a anotação, também nos campos das interfaces e dos `type` que ela usa: `id: estoque.cliente.id`) e no
 * `random.of`, uma vez cada, pelo texto.
 */
export function columnRefsOf(model: ScriptModel, indices: readonly number[]): ColumnRef[] {
  const found = new Map<string, ColumnRef>();
  for (const index of indices) {
    const parsed = model.items[index]?.parsed;
    if (parsed === null || parsed === undefined) continue;
    if (parsed.kind === "declaration" && parsed.annotation !== null) for (const column of annotationColumns(model, parsed.annotation)) found.set(column.text, column);
    if (parsed.value?.t === "sample") found.set(parsed.value.column.text, parsed.value.column);
  }
  return [...found.values()];
}

/** O nome como o catálogo o guarda: entre aspas, como está; sem elas, dobrado como o banco dobra (minúsculas no PostgreSQL e no Informix, maiúsculas no Db2). */
export function catalogName(part: string, engine: Engine | undefined): string {
  if (part.length >= 2 && part.startsWith('"') && part.endsWith('"')) return part.slice(1, -1);
  return engine === 2 ? part.replace(/[a-z]+/g, (letters) => letters.toUpperCase()) : part.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

type CatalogColumn = { name: string; type: string; isNullable: boolean; isPrimaryKey: boolean };

/** O catálogo que a leitura usa: as tabelas e visões de cada esquema, e as colunas de uma tabela. A falha é a frase da API. */
export type ColumnCatalog = {
  tables: () => Promise<ReadonlyMap<string, ReadonlySet<string>> | { error: string }>;
  columns: (schema: string, table: string) => Promise<readonly CatalogColumn[] | { error: string }>;
};

/**
 * Lê o tipo de cada coluna (RN-VAR-004): a tabela sem esquema no esquema padrão da sessão (`defaults`, como na RN-LINK-001; nulo, qualquer esquema), e as colunas
 * dela no catálogo, uma vez por tabela. A coluna que não existe é "A coluna pedido.cliente_idx não existe."; a binária e a lista do banco são recusadas.
 */
export async function readColumns(refs: readonly ColumnRef[], engine: Engine | undefined, defaults: readonly string[] | null, catalog: ColumnCatalog): Promise<Map<string, ColumnRead>> {
  const reads = new Map<string, ColumnRead>();
  let tables: ReadonlyMap<string, ReadonlySet<string>> | { error: string } | null = null;
  const columnsOf = new Map<string, readonly CatalogColumn[] | { error: string }>();

  for (const ref of refs) {
    const table = catalogName(ref.table, engine);
    let schema: string | undefined;
    if (ref.schema !== null) schema = catalogName(ref.schema, engine);
    else {
      tables ??= await catalog.tables();
      if ("error" in tables) {
        reads.set(ref.text, { ok: false, message: tables.error });
        continue;
      }
      const known = tables;
      schema = (defaults ?? [...known.keys()]).find((candidate) => known.get(candidate)?.has(table) === true);
    }
    if (schema === undefined) {
      reads.set(ref.text, { ok: false, message: phrase.columnMissing(ref.text) });
      continue;
    }

    const key = JSON.stringify([schema, table]);
    const columns = columnsOf.get(key) ?? (await catalog.columns(schema, table));
    columnsOf.set(key, columns);
    if ("error" in columns) {
      reads.set(ref.text, { ok: false, message: columns.error });
      continue;
    }
    const name = catalogName(ref.column, engine);
    const column = columns.find((candidate) => candidate.name === name);
    if (column === undefined) {
      reads.set(ref.text, { ok: false, message: phrase.columnMissing(ref.text) });
      continue;
    }
    const kind = columnKindOf(column.type, engine);
    if (kind === "binary") reads.set(ref.text, { ok: false, message: phrase.queryBinaryColumn(column.name) });
    else if (kind === "list") reads.set(ref.text, { ok: false, message: phrase.columnIsList(column.name) });
    else reads.set(ref.text, { ok: true, type: typeOfKind(kind, column.isNullable), kind, schema, table, column: column.name, isPrimaryKey: column.isPrimaryKey, dbType: column.type });
  }
  return reads;
}
