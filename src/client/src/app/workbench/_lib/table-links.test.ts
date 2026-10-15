import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";

import { treeKey } from "./database-sessions.service";
import type { NavNode } from "./navigator-model";
import type { CachedLevel } from "./navigator-search";
import { defaultSchemasOf, linkCatalog, tableLinkAt } from "./table-links";

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

const level = (schema: string, objects: "tables" | "views" | "routines", names: string[]): CachedLevel => ({
  key: treeKey({ type: "objects", connectionId: "c1", schema, objects }),
  nodes: names.map((label) => ({ label }) as NavNode),
});

/** O catálogo de um banco: o que a árvore já carregou (as tabelas e as visões de cada esquema). */
const catalog = linkCatalog([
  level("public", "tables", ["pedido", "Cliente Novo", "select"]),
  level("public", "views", ["vendas_mes"]),
  level("loja", "tables", ["produto", "pedido"]),
  level("loja", "routines", ["recalcula"]),
  level("ana", "tables", ["rascunho"]),
  level("MES", "tables", ["APONTAMENTO", "Turno"]),
]);

/** O ponto (`|`) marca onde está o ponteiro; ele sai do texto. */
function at(marked: string, engine: Engine, defaults: readonly string[] | null) {
  const offset = marked.indexOf("|");
  const sql = marked.slice(0, offset) + marked.slice(offset + 1);
  const link = tableLinkAt(sql, offset, engine, catalog, defaults);
  return link === null ? null : { text: sql.slice(link.from, link.to), schema: link.schema, name: link.name };
}

describe("tableLinkAt: o nome sob o ponteiro é uma tabela ou visão que o catálogo conhece (RN-LINK-001)", () => {
  const pg = defaultSchemasOf(postgres, "ana");

  it("sem o esquema, é o do esquema padrão da sessão; com ele, o daquele esquema; o trecho é o nome inteiro, com o esquema", () => {
    expect(at("select * from ped|ido", postgres, pg)).toEqual({ text: "pedido", schema: "public", name: "pedido" });
    expect(at("select * from lo|ja.pedido", postgres, pg)).toEqual({ text: "loja.pedido", schema: "loja", name: "pedido" });
    expect(at("select * from loja.prod|uto p", postgres, pg)).toEqual({ text: "loja.produto", schema: "loja", name: "produto" });
    expect(at("select * from vendas|_mes", postgres, pg)).toEqual({ text: "vendas_mes", schema: "public", name: "vendas_mes" });
  });

  it("no PostgreSQL o esquema padrão é o do usuário e depois o public, como no search_path: sem esquema, só eles", () => {
    expect(at("select * from rasc|unho", postgres, pg)).toEqual({ text: "rascunho", schema: "ana", name: "rascunho" });
    expect(at("select * from produ|to", postgres, pg)).toBeNull();
    expect(pg).toEqual(["ana", "public"]);
  });

  it("o nome sem aspas é dobrado como o banco o lê: minúsculas no PostgreSQL e no Informix, maiúsculas no Db2", () => {
    expect(at("SELECT * FROM PED|IDO", postgres, pg)).toEqual({ text: "PEDIDO", schema: "public", name: "pedido" });
    expect(at("select * from Lo|ja.Pedido", informix, null)).toEqual({ text: "Loja.Pedido", schema: "loja", name: "pedido" });
    expect(at("select * from apon|tamento", db2, defaultSchemasOf(db2, "mes"))).toEqual({ text: "apontamento", schema: "MES", name: "APONTAMENTO" });
    expect(at("select * from mes.apon|tamento", db2, null)).toEqual({ text: "mes.apontamento", schema: "MES", name: "APONTAMENTO" });
  });

  it("entre aspas duplas o nome vale como está escrito, com a aspa dobrada de dentro; nem dobra nem acha o nome em outra caixa", () => {
    expect(at('select * from "Cliente |Novo"', postgres, pg)).toEqual({ text: '"Cliente Novo"', schema: "public", name: "Cliente Novo" });
    expect(at('select * from "MES"."Tu|rno"', db2, null)).toEqual({ text: '"MES"."Turno"', schema: "MES", name: "Turno" });
    expect(at('select * from "PED|IDO"', postgres, pg)).toBeNull();
    expect(at('select * from mes."Tu|rno"', db2, null)).toEqual({ text: 'mes."Turno"', schema: "MES", name: "Turno" });
  });

  it("no Informix o nome sem esquema acha a tabela de qualquer dono", () => {
    expect(at("select * from produ|to", informix, defaultSchemasOf(informix, "informix"))).toEqual({ text: "produto", schema: "loja", name: "produto" });
  });

  it("dentro de texto entre aspas simples e de comentário não é link, nem o comentário de chaves do Informix", () => {
    expect(at("select 'ped|ido' from t", postgres, pg)).toBeNull();
    expect(at("select 1 -- ped|ido", postgres, pg)).toBeNull();
    expect(at("select 1 /* from ped|ido */", postgres, pg)).toBeNull();
    expect(at("select 1 { from ped|ido }", informix, null)).toBeNull();
    expect(at("select $$ ped|ido $$", postgres, pg)).toBeNull();
  });

  it("o que o catálogo não conhece não é link: outro nome, uma rotina, a coluna de um apelido, a palavra reservada sem aspas, nome com três partes", () => {
    expect(at("select * from clie|ntes", postgres, pg)).toBeNull();
    expect(at("select loja.recal|cula()", postgres, pg)).toBeNull();
    expect(at("select p.ped|ido from pedido p", postgres, pg)).toBeNull();
    expect(at("sel|ect * from x", postgres, pg)).toBeNull();
    expect(at('select * from "sel|ect"', postgres, pg)).toEqual({ text: '"select"', schema: "public", name: "select" });
    expect(at("select * from banco.loja.ped|ido", postgres, pg)).toBeNull();
  });

  it("fora de um nome (espaço, ponto, vírgula, o fim do texto) não é link", () => {
    expect(at("select * from |  pedido", postgres, pg)).toBeNull();
    expect(at("select * from loja|.pedido", postgres, pg)).toEqual({ text: "loja.pedido", schema: "loja", name: "pedido" });
    expect(at("select * from pedido|", postgres, pg)).toBeNull();
    expect(at("select *| from pedido", postgres, pg)).toBeNull();
  });
});

describe("defaultSchemasOf: o esquema padrão da sessão em cada banco", () => {
  it("PostgreSQL: o do usuário e o public; Db2: o do usuário, em maiúsculas; Informix: qualquer dono; sem usuário, só o public no PostgreSQL", () => {
    expect(defaultSchemasOf(postgres, "ana")).toEqual(["ana", "public"]);
    expect(defaultSchemasOf(db2, "db2inst1")).toEqual(["DB2INST1"]);
    expect(defaultSchemasOf(informix, "informix")).toBeNull();
    expect(defaultSchemasOf(postgres, undefined)).toEqual(["public"]);
    expect(defaultSchemasOf(db2, undefined)).toEqual([]);
  });
});
