import { describe, expect, it } from "vitest";

import type { ForeignKey } from "./database-sessions.schema";
import { followOf, foreignKeyLinks, recordLinks, resultLinks, sameLinks, shownResultLinks, sourceTables } from "./foreign-key-links";
import type { QueryColumn } from "./query.schema";
import type { SqlTarget } from "./record-edits.schema";
import type { TableRef } from "./table-diagram";

const column = (name: string, kind: QueryColumn["kind"] = "text"): QueryColumn => ({ name, type: kind === "number" ? "bigint" : "varchar(20)", kind });
const fk = (name: string, columns: string[], referencedTable: string, referencedColumns: string[], referencedSchema = "producao"): ForeignKey => ({ name, columns, referencedSchema, referencedTable, referencedColumns });

const columns = [column("id", "number"), column("ordem_id", "number"), column("maquina_codigo"), column("observacao")];

describe("foreignKeyLinks: as colunas do resultado que levam a outra tabela (RN-TABELA-007)", () => {
  it("cada coluna de chave estrangeira leva à coluna que referencia, na tabela que referencia", () => {
    const links = foreignKeyLinks(columns, [fk("fk_ordem", ["ordem_id"], "ordem_producao", ["id"]), fk("fk_maquina", ["maquina_codigo"], "maquina", ["codigo"], "cadastro")]);

    expect([...links]).toEqual([
      [1, { table: { schema: "producao", name: "ordem_producao" }, column: "id" }],
      [2, { table: { schema: "cadastro", name: "maquina" }, column: "codigo" }],
    ]);
  });

  it("as colunas que não são chave estrangeira não têm link, e uma tabela sem chaves não tem nenhum", () => {
    expect(foreignKeyLinks(columns, []).size).toBe(0);
    expect(foreignKeyLinks(columns, [fk("fk_ordem", ["ordem_id"], "ordem_producao", ["id"])]).has(0)).toBe(false);
    expect(foreignKeyLinks(columns, [fk("fk_ordem", ["ordem_id"], "ordem_producao", ["id"])]).has(3)).toBe(false);
  });

  it("numa chave composta, cada coluna leva à parceira que ocupa a mesma posição na lista das referenciadas", () => {
    const links = foreignKeyLinks(columns, [fk("fk_composta", ["ordem_id", "maquina_codigo"], "agenda", ["ordem", "maquina"])]);

    expect(links.get(1)?.column).toBe("ordem");
    expect(links.get(2)?.column).toBe("maquina");
  });

  it("a coluna que está em duas chaves leva pela primeira, na ordem do catálogo", () => {
    const links = foreignKeyLinks(columns, [fk("fk_a", ["ordem_id"], "ordem_producao", ["id"]), fk("fk_b", ["ordem_id"], "historico", ["ordem"])]);

    expect(links.get(1)?.table.name).toBe("ordem_producao");
  });

  it("uma chave que a API devolveu sem a parceira daquela posição não dá link", () => {
    const links = foreignKeyLinks(columns, [fk("fk_curta", ["ordem_id", "maquina_codigo"], "agenda", ["ordem"])]);

    expect(links.get(1)?.column).toBe("ordem");
    expect(links.has(2)).toBe(false);
  });

  it("o nome da coluna é o que o catálogo diz, com a caixa dele: nada é comparado sem ela", () => {
    expect(foreignKeyLinks([column("Ordem_Id")], [fk("fk", ["ordem_id"], "t", ["id"])]).size).toBe(0);
    expect(foreignKeyLinks([column("Ordem_Id")], [fk("fk", ["Ordem_Id"], "t", ["id"])]).size).toBe(1);
  });
});

describe("recordLinks: os links que a vista Registros mostra", () => {
  const foreignKeys = [fk("fk_ordem", ["ordem_id"], "ordem_producao", ["id"])];

  it("com linhas na tela, o catálogo das chaves e a conexão de pé: os links das chaves", () => {
    expect(recordLinks(columns, foreignKeys, false)).toEqual(foreignKeyLinks(columns, foreignKeys));
    expect(recordLinks(columns, foreignKeys, false)?.get(1)?.table.name).toBe("ordem_producao");
  });

  it("sem linhas na tela, ou sem o catálogo das chaves, não há link nenhum", () => {
    expect(recordLinks(undefined, foreignKeys, false)).toBeUndefined();
    expect(recordLinks(columns, undefined, false)).toBeUndefined();
  });

  it("com a conexão desconectada pela pessoa o valor volta a ser texto (E5): o clique abriria a tabela referenciada com um filtro que ninguém enviaria", () => {
    expect(recordLinks(columns, foreignKeys, true)).toBeUndefined();
  });
});

describe("followOf: o que o clique no valor pede (RN-TABELA-007)", () => {
  const link = { table: { schema: "producao", name: "ordem_producao" }, column: "id" };

  it("a tabela referenciada e o filtro com a coluna dela e o valor da célula como literal", () => {
    expect(followOf(1, column("ordem_id", "number"), link, "42")).toEqual({ table: link.table, where: '"id" = 42' });
    expect(followOf(1, column("maquina_codigo"), { ...link, column: "codigo" }, "AB-1")).toEqual({ table: link.table, where: "\"codigo\" = 'AB-1'" });
  });

  it("texto que parece número, numa coluna de texto, vai entre aspas", () => {
    expect(followOf(2, column("codigo"), link, "42")?.where).toBe("\"id\" = '42'");
  });

  it("o nulo não tem para onde ir", () => {
    expect(followOf(1, column("ordem_id", "number"), link, null)).toBeNull();
  });

  it("o valor que chegou cortado (RN-SQL-011) não é o valor do banco: não leva a lugar nenhum", () => {
    expect(followOf(1, column("codigo"), link, "AB-1", true)).toBeNull();
  });

  it("o valor com quebra de linha não cabe no campo do filtro: sem link", () => {
    expect(followOf(1, column("codigo"), link, "a\nb")).toBeNull();
  });

  it("o valor com barra invertida leva à tabela nos três bancos: no PostgreSQL como E'...' com a barra dobrada, no Db2 e no Informix como está (RN-TABELA-007, Ruling 133)", () => {
    expect(followOf(1, column("codigo"), link, "a\\b")?.where).toBe("\"id\" = E'a\\\\b'");
    expect(followOf(2, column("codigo"), link, "a\\b")?.where).toBe("\"id\" = 'a\\b'");
    expect(followOf(3, column("codigo"), link, "a\\b")?.where).toBe("\"id\" = 'a\\b'");
    expect(followOf(2, column("codigo"), link, "ab")?.where).toBe("\"id\" = 'ab'");
  });

  it("o valor hostil vira um literal inteiro: a aspa dobrada e o ponto e vírgula dentro", () => {
    expect(followOf(3, column("codigo"), link, "x'; DROP TABLE t; --")?.where).toBe("\"id\" = 'x''; DROP TABLE t; --'");
  });
});

// RN-TABELA-007 no resultado da consulta e do script: a origem de cada coluna é o alvo `purpose: "sql"` (RN-GRADE-020), e a chave é a da tabela dela.
type TargetTable = SqlTarget["tables"][number];
type TargetColumn = SqlTarget["columns"][number];

const table = (name: string, kind: TargetTable["kind"] = "table", schema = "producao"): TargetTable => ({ schema, name, key: [], editable: true, reason: null, kind, keyColumns: [] });
const origin = (tableIndex: number | null, baseColumn: string | null): TargetColumn => ({ table: tableIndex, baseColumn, editable: true, reason: null, nullable: true, generated: null });
const sqlTarget = (tables: TargetTable[], targetColumns: TargetColumn[]): SqlTarget => ({ tables, columns: targetColumns, rowOperations: true, oneAtATime: false });
const catalogOf = (catalog: Record<string, ForeignKey[]>) => (ref: TableRef) => catalog[ref.name];

describe("resultLinks: as colunas do resultado de um comando que levam a outra tabela (RN-TABELA-007)", () => {
  const apontamento = [fk("fk_ordem", ["ordem_id"], "ordem_producao", ["id"]), fk("fk_maquina", ["maquina_codigo"], "maquina", ["codigo"], "cadastro")];

  it("a coluna que vem de uma coluna de chave estrangeira da tabela do FROM leva à tabela e à coluna que ela referencia", () => {
    const target = sqlTarget([table("apontamento")], [origin(0, "id"), origin(0, "ordem_id"), origin(0, "maquina_codigo"), origin(0, "observacao")]);

    expect([...resultLinks(4, target, catalogOf({ apontamento }))]).toEqual([
      [1, { table: { schema: "producao", name: "ordem_producao" }, column: "id" }],
      [2, { table: { schema: "cadastro", name: "maquina" }, column: "codigo" }],
    ]);
  });

  it("o apelido não esconde a chave: vale a coluna de origem (`baseColumn`), e não o nome que o resultado mostra (`SELECT ordem_id AS status`)", () => {
    // O resultado mostra "status" na posição 1 e "ordem_id" na 3 (uma coluna que se chama como a chave, mas vem de outra coisa).
    const target = sqlTarget([table("apontamento")], [origin(0, "id"), origin(0, "ordem_id"), origin(0, "observacao"), origin(null, null)]);

    const links = resultLinks(4, target, catalogOf({ apontamento }));

    expect(links.get(1)?.table.name).toBe("ordem_producao");
    expect(links.has(3)).toBe(false);
  });

  it("numa junção de duas tabelas, cada coluna usa a chave da sua tabela", () => {
    const target = sqlTarget([table("apontamento"), table("ordem_producao")], [origin(0, "id"), origin(0, "ordem_id"), origin(1, "id"), origin(1, "cliente_id")]);
    const links = resultLinks(4, target, catalogOf({ apontamento, ordem_producao: [fk("fk_cliente", ["cliente_id"], "cliente", ["codigo"], "cadastro")] }));

    expect([...links.keys()]).toEqual([1, 3]);
    expect(links.get(1)?.table.name).toBe("ordem_producao");
    expect(links.get(3)).toEqual({ table: { schema: "cadastro", name: "cliente" }, column: "codigo" });
  });

  it("a chave de uma tabela não vale para a coluna de mesmo nome de outra: `id` da ordem não é a `ordem_id` do apontamento", () => {
    const target = sqlTarget([table("ordem_producao")], [origin(0, "ordem_id")]);

    expect(resultLinks(1, target, catalogOf({ apontamento, ordem_producao: [] })).size).toBe(0);
  });

  it("numa chave composta, cada coluna leva à parceira de mesma posição", () => {
    const target = sqlTarget([table("apontamento")], [origin(0, "ordem_id"), origin(0, "maquina_codigo")]);
    const links = resultLinks(2, target, catalogOf({ apontamento: [fk("fk_composta", ["ordem_id", "maquina_codigo"], "agenda", ["ordem", "maquina"])] }));

    expect(links.get(0)?.column).toBe("ordem");
    expect(links.get(1)?.column).toBe("maquina");
  });

  it("a visão, a tabela estrangeira, o sinônimo e a tabela de outra sessão não têm chave estrangeira no catálogo: sem link, mesmo com a coluna certa", () => {
    for (const kind of ["view", "materializedView", "foreign", "other", "elsewhere"] as const) {
      const target = sqlTarget([table("apontamento", kind)], [origin(0, "ordem_id")]);

      expect(resultLinks(1, target, catalogOf({ apontamento })).size, kind).toBe(0);
    }
  });

  it("a coluna calculada (tabela nula) e a de origem desconhecida (`baseColumn` nulo) não são link", () => {
    const target = sqlTarget([table("apontamento")], [origin(null, null), origin(null, "ordem_id"), origin(0, null)]);

    expect(resultLinks(3, target, catalogOf({ apontamento })).size).toBe(0);
  });

  it("uma tabela cujas chaves ainda não chegaram não dá link, e as outras dão", () => {
    const target = sqlTarget([table("apontamento"), table("ordem_producao")], [origin(0, "ordem_id"), origin(1, "cliente_id")]);
    const links = resultLinks(2, target, catalogOf({ apontamento }));

    expect([...links.keys()]).toEqual([0]);
  });

  it("a chave que a API devolveu sem a parceira daquela posição (lista curta) não dá link para ela", () => {
    const target = sqlTarget([table("apontamento")], [origin(0, "ordem_id"), origin(0, "maquina_codigo")]);
    const links = resultLinks(2, target, catalogOf({ apontamento: [fk("fk_curta", ["ordem_id", "maquina_codigo"], "agenda", ["ordem"])] }));

    expect([...links.keys()]).toEqual([0]);
  });

  it("a coluna que está em duas chaves leva pela primeira, na ordem do catálogo", () => {
    const target = sqlTarget([table("apontamento")], [origin(0, "ordem_id")]);
    const links = resultLinks(1, target, catalogOf({ apontamento: [fk("fk_a", ["ordem_id"], "ordem_producao", ["id"]), fk("fk_b", ["ordem_id"], "historico", ["ordem"])] }));

    expect(links.get(0)?.table.name).toBe("ordem_producao");
  });

  it("o alvo tem uma coluna por coluna do resultado: a que sobra no alvo ou falta nele não vira link nem lança", () => {
    const target = sqlTarget([table("apontamento")], [origin(0, "ordem_id"), origin(0, "maquina_codigo")]);

    expect([...resultLinks(1, target, catalogOf({ apontamento })).keys()]).toEqual([0]);
    expect(resultLinks(5, target, catalogOf({ apontamento })).size).toBe(2);
  });

  it("a coluna que aponta para uma tabela que o alvo não tem (índice fora da lista) não lança e não é link", () => {
    expect(resultLinks(1, sqlTarget([table("apontamento")], [origin(3, "ordem_id")]), catalogOf({ apontamento })).size).toBe(0);
  });
});

describe("sourceTables: as tabelas de que se pedem as chaves", () => {
  it("cada tabela uma vez, na ordem em que aparece, só as de tipo tabela com coluna de origem no resultado", () => {
    const target = sqlTarget(
      [table("apontamento"), table("ordem_producao"), table("v_ordem", "view"), table("sem_coluna")],
      [origin(0, "id"), origin(1, "id"), origin(0, "ordem_id"), origin(2, "x"), origin(null, null), origin(1, null)],
    );

    expect(sourceTables(6, target)).toEqual([
      { schema: "producao", name: "apontamento" },
      { schema: "producao", name: "ordem_producao" },
    ]);
  });

  it("sem alvo, nada; e a mesma tabela de dois esquemas são duas", () => {
    expect(sourceTables(3, null)).toEqual([]);
    expect(sourceTables(2, sqlTarget([table("t", "table", "a"), table("t", "table", "b")], [origin(0, "x"), origin(1, "x")]))).toHaveLength(2);
  });
});

describe("shownResultLinks: os links que o resultado mostra", () => {
  const apontamento = [fk("fk_ordem", ["ordem_id"], "ordem_producao", ["id"])];
  const target = sqlTarget([table("apontamento")], [origin(0, "ordem_id")]);

  it("com a aba conectada e o alvo, os links das chaves", () => {
    expect(shownResultLinks(true, 1, target, catalogOf({ apontamento }))?.get(0)?.table.name).toBe("ordem_producao");
  });

  it("com a conexão desconectada pela pessoa, nenhum valor é link: o clique abriria a tabela referenciada com um filtro que ninguém enviaria", () => {
    expect(shownResultLinks(false, 1, target, catalogOf({ apontamento }))).toBeUndefined();
  });

  it("enquanto o alvo não chega (ou foi recusado, ou falhou), os valores são texto", () => {
    expect(shownResultLinks(true, 1, null, catalogOf({ apontamento }))).toBeUndefined();
  });
});

describe("sameLinks: os links iguais por conteúdo", () => {
  const link = { table: { schema: "producao", name: "ordem_producao" }, column: "id" };

  it("o mesmo conteúdo é igual; outra coluna, outra tabela, outro esquema ou outro tamanho, não", () => {
    const base = new Map([[1, link]]);

    expect(sameLinks(base, new Map([[1, { ...link, table: { ...link.table } }]]))).toBe(true);
    expect(sameLinks(base, new Map([[1, { ...link, column: "codigo" }]]))).toBe(false);
    expect(sameLinks(base, new Map([[1, { ...link, table: { ...link.table, name: "outra" } }]]))).toBe(false);
    expect(sameLinks(base, new Map([[1, { ...link, table: { ...link.table, schema: "outro" } }]]))).toBe(false);
    expect(sameLinks(base, new Map([[2, link]]))).toBe(false);
    expect(sameLinks(base, new Map())).toBe(false);
  });

  it("nenhum valor ser link (`undefined`) só é igual a si mesmo, e não a um mapa vazio", () => {
    expect(sameLinks(undefined, undefined)).toBe(true);
    expect(sameLinks(undefined, new Map())).toBe(false);
    expect(sameLinks(new Map(), undefined)).toBe(false);
  });
});
