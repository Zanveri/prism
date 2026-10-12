import { describe, expect, it } from "vitest";

import type { ForeignKey } from "./database-sessions.schema";
import { followOf, foreignKeyLinks, recordLinks } from "./foreign-key-links";
import type { QueryColumn } from "./query.schema";

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
