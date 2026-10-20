import { describe, expect, it } from "vitest";

import type { ForeignKey } from "./database-sessions.schema";
import { foreignKeyLinks, recordLinks, resultLinks, shownResultLinks, sourceTables, type ColumnLink } from "./foreign-key-links";
import type { QueryColumn } from "./query.schema";
import type { SqlTarget } from "./record-edits.schema";
import type { TableRef } from "./table-diagram";

const column = (name: string, kind: QueryColumn["kind"] = "text"): QueryColumn => ({ name, type: kind === "number" ? "bigint" : "varchar(20)", kind });
const fk = (name: string, columns: string[], referencedTable: string, referencedColumns: string[], referencedSchema = "producao"): ForeignKey => ({ name, columns, referencedSchema, referencedTable, referencedColumns });

type TargetTable = SqlTarget["tables"][number];
type TargetColumn = SqlTarget["columns"][number];
const table = (name: string, kind: TargetTable["kind"] = "table", schema = "producao"): TargetTable => ({ schema, name, key: [], editable: true, reason: null, kind, keyColumns: [] });
const origin = (tableIndex: number | null, baseColumn: string | null): TargetColumn => ({ table: tableIndex, baseColumn, editable: true, reason: null, nullable: true, generated: null });
/** Uma coluna de origem da tabela do `FROM` de índice 0; `null` é a coluna calculada (sem tabela nem coluna de origem). */
const oneOrigin = (baseColumn: string | null): TargetColumn => (baseColumn === null ? origin(null, null) : origin(0, baseColumn));
const sqlTarget = (tables: TargetTable[], columns: TargetColumn[]): SqlTarget => ({ tables, columns, rowOperations: true, oneAtATime: false });
/** O catálogo das chaves por nome de tabela (sem esquema); a tabela que não está nele ainda não chegou. */
const catalogOf = (catalog: Record<string, readonly ForeignKey[]>) => (ref: TableRef) => catalog[ref.name];

const columns = [column("id", "number"), column("ordem_id", "number"), column("maquina_codigo"), column("observacao")];
const chaveOrdem = [fk("fk_ordem", ["ordem_id"], "ordem_producao", ["id"])];
const ordemLink: ColumnLink = { table: { schema: "producao", name: "ordem_producao" }, column: "id" };

describe("resultLinks e foreignKeyLinks: a mesma coluna de origem em mais de uma posição do resultado (RN-TABELA-007)", () => {
  it.each<[string, (string | null)[], number[]]>([
    ["duas vezes seguidas", ["ordem_id", "ordem_id"], [0, 1]],
    ["com outra coluna no meio", ["ordem_id", "id", "ordem_id"], [0, 2]],
    ["com uma coluna calculada (sem origem) entre elas", ["ordem_id", null, "ordem_id"], [0, 2]],
  ])("%s: as duas posições levam à mesma tabela e à mesma coluna", (_, baseColumns, keys) => {
    const target = sqlTarget([table("apontamento")], baseColumns.map(oneOrigin));

    const links = resultLinks(baseColumns.length, target, catalogOf({ apontamento: chaveOrdem }));

    expect([...links.keys()]).toEqual(keys);
    for (const key of keys) expect(links.get(key)).toEqual(ordemLink);
  });

  it("no resultado da consulta (nomes, não origem), a mesma coluna em duas posições dá dois links iguais", () => {
    const links = foreignKeyLinks([column("ordem_id", "number"), column("ordem_id", "number")], chaveOrdem);

    expect([...links]).toEqual([
      [0, ordemLink],
      [1, ordemLink],
    ]);
  });
});

describe("resultLinks: duas tabelas com a mesma coluna, e a chave em só uma delas (RN-TABELA-007)", () => {
  const duas = sqlTarget([table("apontamento"), table("ordem_producao")], [origin(0, "ordem_id"), origin(1, "ordem_id")]);

  it.each<[string, Record<string, readonly ForeignKey[]>, number[]]>([
    ["a chave está na tabela do primeiro FROM", { apontamento: chaveOrdem, ordem_producao: [] }, [0]],
    ["a chave está na tabela do segundo FROM", { apontamento: [], ordem_producao: chaveOrdem }, [1]],
  ])("%s: só a coluna da tabela com a chave leva", (_, catalog, keys) => {
    const links = resultLinks(2, duas, catalogOf(catalog));

    expect([...links.keys()]).toEqual(keys);
    for (const key of keys) expect(links.get(key)).toEqual(ordemLink);
  });
});

describe("resultLinks, shownResultLinks e sourceTables: tipo de objeto que não é TABELA não tem link (RN-TABELA-007)", () => {
  it.each(["view", "materializedView", "foreign", "other", "elsewhere"] as const)("tipo %s: a coluna não leva a lugar nenhum, mesmo com chave no catálogo", (kind) => {
    const target = sqlTarget([table("apontamento", kind)], [origin(0, "ordem_id")]);
    const everything = () => chaveOrdem;

    expect(resultLinks(1, target, everything).size).toBe(0);
    expect(shownResultLinks(true, 1, target, everything)?.size).toBe(0);
    expect(sourceTables(1, target)).toEqual([]);
  });
});

describe("resultLinks e sourceTables: coluna que aponta para uma tabela fora da lista do alvo (RN-TABELA-007)", () => {
  it.each<[string, number]>([
    ["além da última tabela", 5],
    ["negativo", -1],
  ])("índice fora da lista (%s): a coluna não tem link, a outra leva, e nada lança", (_, index) => {
    const target = sqlTarget([table("apontamento")], [origin(index, "ordem_id"), origin(0, "ordem_id")]);

    const links = resultLinks(2, target, catalogOf({ apontamento: chaveOrdem }));

    expect([...links.keys()]).toEqual([1]);
    expect(sourceTables(2, target)).toEqual([{ schema: "producao", name: "apontamento" }]);
  });
});

describe("resultLinks, shownResultLinks e recordLinks: lista de chaves vazia (RN-TABELA-007)", () => {
  const target = sqlTarget([table("apontamento")], [origin(0, "ordem_id"), origin(0, "observacao")]);

  it.each<[string, (ref: TableRef) => readonly ForeignKey[] | undefined]>([
    ["a tabela sem chave (lista vazia)", () => []],
    ["o catálogo ainda não trouxe a tabela", () => undefined],
  ])("%s: nenhuma coluna é link, e o resultado é um mapa vazio", (_, foreignKeysOf) => {
    expect(resultLinks(2, target, foreignKeysOf).size).toBe(0);
    expect(shownResultLinks(true, 2, target, foreignKeysOf)).toEqual(new Map());
  });

  it("a vista Registros com a lista vazia (a tabela sem chaves): mapa vazio, e não o `undefined` do catálogo que não chegou", () => {
    expect(recordLinks(columns, [], false)).toEqual(new Map());
    expect(recordLinks(columns, undefined, false)).toBeUndefined();
  });
});

describe("resultLinks: o link leva ao esquema da referência, não ao da origem (RN-TABELA-007)", () => {
  it.each<[string, string, string]>([
    ["origem em producao, referência em cadastro", "producao", "cadastro"],
    ["origem em cadastro, referência em producao", "cadastro", "producao"],
  ])("%s", (_, source, referenced) => {
    const target = sqlTarget([table("apontamento", "table", source)], [origin(0, "maquina_codigo")]);
    const catalog = (ref: TableRef) => (ref.schema === source ? [fk("fk_maquina", ["maquina_codigo"], "maquina", ["codigo"], referenced)] : undefined);

    expect(resultLinks(1, target, catalog).get(0)).toEqual({ table: { schema: referenced, name: "maquina" }, column: "codigo" });
  });

  it("a tabela de mesmo nome em dois esquemas tem a sua chave: a busca é pelo esquema e pelo nome", () => {
    const porTabela: Record<string, readonly ForeignKey[]> = {
      "producao.apontamento": chaveOrdem,
      "teste.apontamento": [fk("fk_ordem", ["ordem_id"], "ordem", ["id"], "cadastro")],
    };
    const target = sqlTarget([table("apontamento", "table", "producao"), table("apontamento", "table", "teste")], [origin(0, "ordem_id"), origin(1, "ordem_id")]);

    const links = resultLinks(2, target, (ref) => porTabela[`${ref.schema}.${ref.name}`]);

    expect(links.get(0)).toEqual(ordemLink);
    expect(links.get(1)).toEqual({ table: { schema: "cadastro", name: "ordem" }, column: "id" });
  });
});

describe("foreignKeyLinks e resultLinks: chave composta com só algumas colunas no resultado (RN-TABELA-007)", () => {
  const composta = [fk("fk_composta", ["ordem_id", "maquina_codigo"], "agenda", ["ordem", "maquina"])];

  it.each<[string, string[], [number, string][]]>([
    ["só a primeira coluna da chave", ["ordem_id", "observacao"], [[0, "ordem"]]],
    ["só a segunda, e na primeira posição do resultado", ["maquina_codigo"], [[0, "maquina"]]],
    ["as duas, invertidas no resultado: a parceira vem pelo nome, não pela posição", ["maquina_codigo", "ordem_id"], [[0, "maquina"], [1, "ordem"]]],
    ["nenhuma das duas", ["observacao", "id"], []],
  ])("%s", (_, names, expected) => {
    const links = foreignKeyLinks(
      names.map((name) => column(name)),
      composta,
    );

    expect([...links].map(([index, link]) => [index, link.column])).toEqual(expected);
  });

  it("no alvo, a mesma regra: a coluna de origem que é só uma das duas leva à sua parceira", () => {
    const target = sqlTarget([table("apontamento")], [origin(0, "maquina_codigo")]);

    expect(resultLinks(1, target, () => composta).get(0)).toEqual({ table: { schema: "producao", name: "agenda" }, column: "maquina" });
  });
});

describe("resultLinks e foreignKeyLinks: o nome da coluna é comparado como está, com a caixa e os espaços (sem correspondência aproximada)", () => {
  it.each<[string, string]>([
    ["em maiúsculas", "ORDEM_ID"],
    ["com espaço no fim", "ordem_id "],
  ])("a coluna de origem %s não é a chave", (_, baseColumn) => {
    const target = sqlTarget([table("apontamento")], [origin(0, baseColumn)]);

    expect(resultLinks(1, target, catalogOf({ apontamento: chaveOrdem })).size).toBe(0);
    expect(foreignKeyLinks([column(baseColumn)], chaveOrdem).size).toBe(0);
  });

  it("a coluna referenciada sai com a caixa do catálogo, e a tabela também", () => {
    const links = foreignKeyLinks([column("ordem_id")], [fk("fk", ["ordem_id"], "ORDEM_PRODUCAO", ["ID"])]);

    expect(links.get(0)).toEqual({ table: { schema: "producao", name: "ORDEM_PRODUCAO" }, column: "ID" });
  });
});
