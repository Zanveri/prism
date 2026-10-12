import type { Engine } from "@/components/ui/engine-tag";

import type { Column, ForeignKey, TableIndex } from "./database-sessions.schema";
import type { ObjectKind } from "./object-kind";
import { quoteIdentifier } from "./table-sql";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.tableTab.structure.ddl;

export type DdlInput = {
  engine: Engine;
  schema: string;
  name: string;
  /** Tabela, visão ou `unknown` (a árvore da conexão ainda não mostrou o objeto): `object-kind.ts`. */
  kind: ObjectKind;
  columns: readonly Column[];
  foreignKeys: readonly ForeignKey[];
  indexes: readonly TableIndex[];
};

const sameNames = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((name, position) => name === b[position]);

const nameList = (names: readonly string[]) => `(${names.map(quoteIdentifier).join(", ")})`;

/** O que a API devolveu para uma chave estrangeira, como cláusula da tabela. O Informix escreve o nome da restrição DEPOIS da definição. */
function foreignKeyClause(engine: Engine, foreignKey: ForeignKey): string {
  const definition = `FOREIGN KEY ${nameList(foreignKey.columns)} REFERENCES ${quoteIdentifier(foreignKey.referencedSchema)}.${quoteIdentifier(foreignKey.referencedTable)} ${nameList(foreignKey.referencedColumns)}`;
  return engine === 3 ? `${definition} CONSTRAINT ${quoteIdentifier(foreignKey.name)}` : `CONSTRAINT ${quoteIdentifier(foreignKey.name)} ${definition}`;
}

/**
 * O "DDL aproximado" de uma tabela (RN-TABELA-008): um `CREATE TABLE` montado a partir do que o catálogo já deu (colunas, tipos, nulo, chave
 * primária, chaves estrangeiras e índices), com os `CREATE INDEX` depois. Não é o DDL do banco: padrões, restrições de conferência e opções de
 * armazenamento não aparecem, e a primeira linha do texto diz isso, para a cópia não ser tomada pelo original. É texto para ler e copiar: o Prism
 * não o executa.
 *
 * Os nomes (esquema, tabela, coluna, restrição, índice) vão sempre entre aspas duplas, com a aspa dobrada, como em todo comando do Prism. O tipo
 * entra como o catálogo o escreve. O índice único das mesmas colunas da chave primária é o dela e não se repete. `null` sem colunas (não há o que montar) e
 * para uma visão (o Prism não monta o DDL de visões: um `CREATE TABLE` seria errado); sem saber o tipo (`unknown`), o texto leva uma segunda linha de aviso.
 */
export function approximateDdl({ engine, schema, name, kind, columns, foreignKeys, indexes }: DdlInput): string | null {
  if (kind === "view" || columns.length === 0) return null;

  const ordered = [...columns].sort((a, b) => a.position - b.position);
  const primaryKey = ordered.filter((column) => column.isPrimaryKey).map((column) => column.name);
  const table = `${quoteIdentifier(schema)}.${quoteIdentifier(name)}`;

  const clauses = [
    ...ordered.map((column) => `${quoteIdentifier(column.name)}${column.type === "" ? "" : ` ${column.type}`}${column.isNullable ? "" : " NOT NULL"}`),
    ...(primaryKey.length === 0 ? [] : [`PRIMARY KEY ${nameList(primaryKey)}`]),
    ...foreignKeys.map((foreignKey) => foreignKeyClause(engine, foreignKey)),
  ];

  const indexStatements = indexes
    .filter((index) => index.columns.length > 0 && !(index.isUnique && primaryKey.length > 0 && sameNames(index.columns, primaryKey)))
    .map((index) => `CREATE${index.isUnique ? " UNIQUE" : ""} INDEX ${quoteIdentifier(index.name)} ON ${table} ${nameList(index.columns)};`);

  return [`-- ${copy.warning}`, ...(kind === "unknown" ? [`-- ${copy.unknownLine}`] : []), `CREATE TABLE ${table} (`, `${clauses.map((clause) => `  ${clause}`).join(",\n")}`, ");", ...(indexStatements.length === 0 ? [] : ["", ...indexStatements])].join("\n");
}

/** O que a seção DDL mostra: carregando, sem colunas, uma visão (nada a montar), ou o texto (e se pode ser uma visão). */
export type DdlState = { kind: "loading" } | { kind: "empty" } | { kind: "view" } | { kind: "ready"; text: string; maybeView: boolean };

/**
 * O estado da seção a partir do que a Estrutura já carregou: as listas são `undefined` enquanto não chegaram. Uma visão não espera lista nenhuma (o
 * aviso de que o Prism não monta o DDL de visões vale desde já); a tabela, ou o objeto de tipo desconhecido, espera as três listas e o banco da conexão.
 */
export function ddlState(input: Omit<DdlInput, "engine" | "columns" | "foreignKeys" | "indexes"> & { engine: Engine | undefined; columns: readonly Column[] | undefined; foreignKeys: readonly ForeignKey[] | undefined; indexes: readonly TableIndex[] | undefined }): DdlState {
  const { engine, columns, foreignKeys, indexes, ...object } = input;
  if (object.kind === "view") return { kind: "view" };
  if (engine === undefined || columns === undefined || foreignKeys === undefined || indexes === undefined) return { kind: "loading" };

  const text = approximateDdl({ ...object, engine, columns, foreignKeys, indexes });
  return text === null ? { kind: "empty" } : { kind: "ready", text, maybeView: object.kind === "unknown" };
}
