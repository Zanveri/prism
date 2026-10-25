import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";

import type { ForeignKey, ReferencingForeignKey } from "./database-sessions.schema";
import { aliasFor, joinSuggestions, linksOf, onSuggestions, writtenTable, type StatementTable } from "./sql-join";

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

const out = (name: string, columns: string[], table: string, referencedColumns: string[], schema = "public"): ForeignKey => ({ name, columns, referencedSchema: schema, referencedTable: table, referencedColumns });
const into = (name: string, schema: string, table: string, columns: string[], referencedColumns: string[]): ReferencingForeignKey => ({ name, referencingSchema: schema, referencingTable: table, columns, referencedColumns });

/** Uma tabela do comando. `qualifier` é o apelido ou o nome. */
const stated = (name: string, qualifier: string, foreignKeys: ForeignKey[] = [], referencedBy: ReferencingForeignKey[] = [], schema = "public"): StatementTable => ({ schema, name, qualifier, links: linksOf(foreignKeys, referencedBy) });

const labels = (suggestions: readonly { label: string }[]) => suggestions.map((suggestion) => suggestion.label);

describe("linksOf: a mesma chave vista de cada lado", () => {
  it("a chave da tabela liga à referenciada; a que chega liga à de origem; o que não chegou não liga nada", () => {
    expect(linksOf([out("fk_cliente", ["cliente_id"], "clientes", ["id"])], [into("fk_item", "public", "itens", ["pedido_id"], ["id"])])).toEqual([
      { name: "fk_cliente", table: { schema: "public", name: "clientes" }, own: ["cliente_id"], other: ["id"] },
      { name: "fk_item", table: { schema: "public", name: "itens" }, own: ["id"], other: ["pedido_id"] },
    ]);
    expect(linksOf(undefined, undefined)).toEqual([]);
  });
});

describe("aliasFor: as iniciais das partes do nome", () => {
  const taken = (...names: string[]) => new Set(names);

  it.each([
    ["clientes", "c"],
    ["itens_pedido", "ip"],
    ["nota_fiscal_item", "nfi"],
    ["Clientes", "c"],
    ["_interno", "i"],
    ["ação_técnica", "at"],
    ["2024_vendas", "v"],
    ["123", "t"],
    ["", "t"],
  ])("%s → %s", (name, expected) => {
    expect(aliasFor(name, taken())).toBe(expected);
  });

  it("o apelido em uso ganha 2, 3…", () => {
    expect(aliasFor("clientes", taken("c"))).toBe("c2");
    expect(aliasFor("clientes", taken("c", "c2"))).toBe("c3");
    expect(aliasFor("itens_pedido", taken("ip", "ip2"))).toBe("ip3");
  });

  it("a palavra reservada não serve: `ordem_nota` daria `on`", () => {
    expect(aliasFor("ordem_nota", taken())).toBe("on2");
    expect(aliasFor("item_selecionado", taken())).toBe("is2");
    expect(aliasFor("departamento_origem", taken())).toBe("do2");
    expect(aliasFor("as_x", taken())).toBe("ax");
    expect(aliasFor("tabela_oculta_jogo", taken())).toBe("toj");
  });
});

describe("writtenTable: como o autocompletar escreve o nome", () => {
  it("o esquema só quando não é o padrão da sessão", () => {
    expect(writtenTable({ schema: "public", name: "clientes" }, postgres, ["maria", "public"])).toBe("clientes");
    expect(writtenTable({ schema: "maria", name: "clientes" }, postgres, ["maria", "public"])).toBe("clientes");
    expect(writtenTable({ schema: "erp", name: "produtos" }, postgres, ["maria", "public"])).toBe("erp.produtos");
  });

  it("o nome por sqlName: aspas na caixa mista e na palavra reservada", () => {
    expect(writtenTable({ schema: "public", name: "Clientes" }, postgres, ["public"])).toBe('"Clientes"');
    expect(writtenTable({ schema: "public", name: "order" }, postgres, ["public"])).toBe('"order"');
    expect(writtenTable({ schema: "Erp", name: "itens pedido" }, postgres, ["public"])).toBe('"Erp"."itens pedido"');
  });

  it("no Db2 o nome em maiúsculas vai cru, e o em minúsculas leva aspas", () => {
    expect(writtenTable({ schema: "ERP", name: "CLIENTES" }, db2, ["MARIA"])).toBe("ERP.CLIENTES");
    expect(writtenTable({ schema: "MARIA", name: "CLIENTES" }, db2, ["MARIA"])).toBe("CLIENTES");
    expect(writtenTable({ schema: "MARIA", name: "clientes" }, db2, ["MARIA"])).toBe('"clientes"');
  });

  it("no Informix o esquema vai sempre, como na lista de tabelas", () => {
    expect(writtenTable({ schema: "informix", name: "clientes" }, informix, null)).toBe("informix.clientes");
  });
});

describe("joinSuggestions: depois de JOIN (RN-SQL-025)", () => {
  const base = { used: new Set<string>(), usesAliases: true, engine: postgres as Engine | undefined, defaultSchemas: ["public"] as readonly string[] | null };

  it("a chave que sai da tabela do comando: a condição com a coluna da tabela nova à esquerda", () => {
    const pedidos = stated("pedidos", "p", [out("fk_pedidos_cliente", ["cliente_id"], "clientes", ["id"])]);

    expect(joinSuggestions({ ...base, tables: [pedidos], used: new Set(["p"]) })).toEqual([{ label: "clientes c ON c.id = p.cliente_id", detail: "fk_pedidos_cliente" }]);
  });

  it("a chave que chega à tabela do comando (a outra a referencia)", () => {
    const pedidos = stated("pedidos", "p", [], [into("fk_itens_pedido", "public", "itens_pedido", ["pedido_id"], ["id"])]);

    expect(joinSuggestions({ ...base, tables: [pedidos], used: new Set(["p"]) })).toEqual([{ label: "itens_pedido ip ON ip.pedido_id = p.id", detail: "fk_itens_pedido" }]);
  });

  it("a chave composta junta as colunas com AND, na ordem da chave", () => {
    const itens = stated("itens", "i", [out("fk_produto", ["empresa", "produto_id"], "produtos", ["empresa", "id"])]);

    expect(labels(joinSuggestions({ ...base, tables: [itens], used: new Set(["i"]) }))).toEqual(["produtos p ON p.empresa = i.empresa AND p.id = i.produto_id"]);
  });

  it("sem apelidos no comando, a tabela nova entra pelo nome inteiro", () => {
    const pedidos = stated("pedidos", "pedidos", [out("fk_cliente", ["cliente_id"], "clientes", ["id"])], [into("fk_item", "public", "itens", ["pedido_id"], ["id"])]);

    expect(labels(joinSuggestions({ ...base, tables: [pedidos], usesAliases: false, used: new Set(["pedidos"]) }))).toEqual(["clientes ON clientes.id = pedidos.cliente_id", "itens ON itens.pedido_id = pedidos.id"]);
  });

  it("a tabela que se liga a si mesma ganha outro apelido, nas duas direções; sem apelidos no comando também", () => {
    const funcionarios = (qualifier: string) => stated("funcionarios", qualifier, [out("fk_gerente", ["gerente_id"], "funcionarios", ["id"])], [into("fk_gerente", "public", "funcionarios", ["gerente_id"], ["id"])]);

    expect(joinSuggestions({ ...base, tables: [funcionarios("f")], used: new Set(["f"]) })).toEqual([
      { label: "funcionarios f2 ON f2.id = f.gerente_id", detail: "fk_gerente" },
      { label: "funcionarios f2 ON f2.gerente_id = f.id", detail: "fk_gerente" },
    ]);
    expect(labels(joinSuggestions({ ...base, tables: [funcionarios("funcionarios")], usesAliases: false, used: new Set(["funcionarios"]) }))).toEqual(["funcionarios f ON f.id = funcionarios.gerente_id", "funcionarios f ON f.gerente_id = funcionarios.id"]);
  });

  it("o apelido novo foge dos que o comando usa, dos nomes das tabelas sem apelido e dos apelidos das subconsultas", () => {
    const pedidos = stated("pedidos", "p", [out("fk_cliente", ["cliente_id"], "clientes", ["id"])]);

    expect(labels(joinSuggestions({ ...base, tables: [pedidos], used: new Set(["p", "c"]) }))).toEqual(["clientes c2 ON c2.id = p.cliente_id"]);
    expect(labels(joinSuggestions({ ...base, tables: [pedidos], used: new Set(["p", "c", "c2"]) }))).toEqual(["clientes c3 ON c3.id = p.cliente_id"]);
  });

  it("o apelido que seria palavra reservada ganha número", () => {
    const itens = stated("itens", "i", [out("fk_ordem", ["ordem_id"], "ordem_nota", ["id"])]);

    expect(labels(joinSuggestions({ ...base, tables: [itens], used: new Set(["i"]) }))).toEqual(["ordem_nota on2 ON on2.id = i.ordem_id"]);
  });

  it("sem apelidos, o nome da tabela nova que já é de outra tabela do comando (de outro esquema) ganha apelido", () => {
    const pedidos = stated("pedidos", "pedidos", [out("fk_cliente", ["cliente_id"], "clientes", ["id"], "erp")]);
    const clientes = stated("clientes", "clientes", [], [], "public");

    // O `clientes` do esquema erp não é a tabela `public.clientes` do comando, e o nome é o mesmo: sem apelido, as duas se confundiriam.
    expect(labels(joinSuggestions({ ...base, tables: [clientes, pedidos], usesAliases: false, used: new Set(["pedidos", "clientes"]) }))).toEqual(["erp.clientes c ON c.id = pedidos.cliente_id"]);
  });

  it("primeiro as que ligam à última tabela escrita; depois as das outras, na ordem do comando", () => {
    const pedidos = stated("pedidos", "p", [out("fk_cliente", ["cliente_id"], "clientes", ["id"])]);
    const itens = stated("itens", "i", [out("fk_produto", ["produto_id"], "produtos", ["id"])]);
    const entregas = stated("entregas", "e", [out("fk_transportadora", ["transportadora_id"], "transportadoras", ["id"])]);

    expect(labels(joinSuggestions({ ...base, tables: [pedidos, itens, entregas], used: new Set(["p", "i", "e"]) }))).toEqual(["transportadoras t ON t.id = e.transportadora_id", "clientes c ON c.id = p.cliente_id", "produtos p2 ON p2.id = i.produto_id"]);
  });

  it("a tabela que já está no comando não volta, mesmo ligada a outra", () => {
    const pedidos = stated("pedidos", "p", [out("fk_cliente", ["cliente_id"], "clientes", ["id"])]);
    const clientes = stated("clientes", "c", [], [into("fk_cliente", "public", "pedidos", ["cliente_id"], ["id"])]);

    expect(joinSuggestions({ ...base, tables: [pedidos, clientes], used: new Set(["p", "c"]) })).toEqual([]);
  });

  it("a ligação com outro esquema escreve o esquema; o do esquema padrão não", () => {
    const pedidos = stated("pedidos", "p", [out("fk_produto", ["produto_id"], "produtos", ["id"], "erp"), out("fk_cliente", ["cliente_id"], "clientes", ["id"])]);

    expect(labels(joinSuggestions({ ...base, tables: [pedidos], used: new Set(["p"]) }))).toEqual(["erp.produtos p2 ON p2.id = p.produto_id", "clientes c ON c.id = p.cliente_id"]);
  });

  it("nomes que pedem aspas saem como o autocompletar os escreve; o apelido do comando vai como está", () => {
    const pedidos = stated("Pedidos", '"P"', [out("fk_cliente", ["Cliente Id"], "Clientes", ["Id"])]);

    expect(labels(joinSuggestions({ ...base, tables: [pedidos], used: new Set(["p"]) }))).toEqual(['"Clientes" c ON c."Id" = "P"."Cliente Id"']);
  });

  it("o Db2: nomes em maiúsculas crus, o esquema do usuário omitido, o apelido novo em minúsculas", () => {
    const pedidos = stated("PEDIDOS", "P", [out("FK_CLIENTE", ["CLIENTE_ID"], "CLIENTES", ["ID"], "MARIA")], [], "MARIA");

    expect(joinSuggestions({ ...base, engine: db2, defaultSchemas: ["MARIA"], tables: [pedidos], used: new Set(["p"]) })).toEqual([{ label: "CLIENTES c ON c.ID = P.CLIENTE_ID", detail: "FK_CLIENTE" }]);
    const other = stated("PEDIDOS", "P", [out("FK_CLIENTE", ["CLIENTE_ID"], "CLIENTES", ["ID"], "ERP")], [], "MARIA");
    expect(labels(joinSuggestions({ ...base, engine: db2, defaultSchemas: ["MARIA"], tables: [other], used: new Set(["p"]) }))).toEqual(["ERP.CLIENTES c ON c.ID = P.CLIENTE_ID"]);
  });

  it("uma sugestão por chave, mesmo se a lista a repete", () => {
    const pedidos = stated("pedidos", "p", [out("fk_cliente", ["cliente_id"], "clientes", ["id"]), out("fk_cliente", ["cliente_id"], "clientes", ["id"])]);

    expect(joinSuggestions({ ...base, tables: [pedidos], used: new Set(["p"]) })).toHaveLength(1);
  });

  it("duas chaves para a mesma tabela são duas sugestões, cada uma com o nome da chave", () => {
    const pedidos = stated("pedidos", "p", [out("fk_cobranca", ["cobranca_id"], "enderecos", ["id"]), out("fk_entrega", ["entrega_id"], "enderecos", ["id"])]);

    expect(joinSuggestions({ ...base, tables: [pedidos], used: new Set(["p"]) })).toEqual([
      { label: "enderecos e ON e.id = p.cobranca_id", detail: "fk_cobranca" },
      { label: "enderecos e ON e.id = p.entrega_id", detail: "fk_entrega" },
    ]);
  });

  it("sem tabela no comando que o catálogo conheça, nada", () => {
    expect(joinSuggestions({ ...base, tables: [] })).toEqual([]);
  });
});

describe("onSuggestions: depois de JOIN tabela ON (RN-SQL-025)", () => {
  it("as condições que ligam a tabela do JOIN às outras, a da última tabela escrita primeiro", () => {
    const clientes = stated("clientes", "c", [], [into("fk_pedido_cliente", "public", "pedidos", ["cliente_id"], ["id"]), into("fk_entrega_cliente", "public", "entregas", ["cliente_id"], ["id"])]);
    const pedidos = stated("pedidos", "p");
    const entregas = stated("entregas", "e");

    expect(onSuggestions(clientes, [pedidos, entregas], postgres)).toEqual([
      { label: "c.id = e.cliente_id", detail: "fk_entrega_cliente" },
      { label: "c.id = p.cliente_id", detail: "fk_pedido_cliente" },
    ]);
  });

  it("a chave que sai da tabela do JOIN para uma tabela do comando", () => {
    const itens = stated("itens", "i", [out("fk_pedido", ["pedido_id"], "pedidos", ["id"])]);

    expect(labels(onSuggestions(itens, [stated("pedidos", "p"), stated("produtos", "pr")], postgres))).toEqual(["i.pedido_id = p.id"]);
  });

  it("a chave composta, com AND", () => {
    const itens = stated("itens", "i", [out("fk_produto", ["empresa", "produto_id"], "produtos", ["empresa", "id"])]);

    expect(labels(onSuggestions(itens, [stated("produtos", "p")], postgres))).toEqual(["i.empresa = p.empresa AND i.produto_id = p.id"]);
  });

  it("a tabela ligada a si mesma, com outra instância dela no comando: a condição filha e a pai", () => {
    const f2 = stated("funcionarios", "f2", [out("fk_gerente", ["gerente_id"], "funcionarios", ["id"])], [into("fk_gerente", "public", "funcionarios", ["gerente_id"], ["id"])]);

    expect(labels(onSuggestions(f2, [stated("funcionarios", "f")], postgres))).toEqual(["f2.gerente_id = f.id", "f2.id = f.gerente_id"]);
  });

  it("sem apelidos, o nome inteiro; nomes com aspas e o Db2 como o autocompletar os escreve", () => {
    expect(labels(onSuggestions(stated("clientes", "clientes", [], [into("fk", "public", "pedidos", ["cliente_id"], ["id"])]), [stated("pedidos", "pedidos")], postgres))).toEqual(["clientes.id = pedidos.cliente_id"]);
    expect(labels(onSuggestions(stated("Clientes", "c", [], [into("fk", "public", "Pedidos", ["Cliente Id"], ["Id"])]), [stated("Pedidos", "p")], postgres))).toEqual(['c."Id" = p."Cliente Id"']);
    expect(labels(onSuggestions(stated("CLIENTES", "C", [], [into("FK", "public", "PEDIDOS", ["CLIENTE_ID"], ["ID"])]), [stated("PEDIDOS", "P")], db2))).toEqual(["C.ID = P.CLIENTE_ID"]);
  });

  it("sem ligação com as outras tabelas, nada", () => {
    expect(onSuggestions(stated("clientes", "c"), [stated("pedidos", "p")], postgres)).toEqual([]);
  });
});
