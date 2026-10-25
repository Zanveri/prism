import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";

import type { ForeignKey, ReferencingForeignKey } from "./database-sessions.schema";
import { aliasFor, joinSuggestions, linksOf, writtenTable, type StatementTable, type TableName } from "./sql-join";

/*
 * Casos extras da RN-SQL-025 (a junção), escritos a partir das decisões (navegacao-grade-completar-mac-decisoes.md, Frente C). Os valores esperados vêm
 * delas, não do código.
 */

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

const out = (name: string, columns: string[], table: string, referencedColumns: string[], schema = "public"): ForeignKey => ({ name, columns, referencedSchema: schema, referencedTable: table, referencedColumns });
const into = (name: string, schema: string, table: string, columns: string[], referencedColumns: string[]): ReferencingForeignKey => ({ name, referencingSchema: schema, referencingTable: table, columns, referencedColumns });
const stated = (name: string, qualifier: string, foreignKeys: ForeignKey[] = [], referencedBy: ReferencingForeignKey[] = [], schema = "public"): StatementTable => ({ schema, name, qualifier, links: linksOf(foreignKeys, referencedBy) });

type Expected = readonly (readonly [label: string, detail: string])[];

type JoinCase = {
  title: string;
  tables: StatementTable[];
  /** Os apelidos e nomes que o comando já usa (em minúsculas). */
  used: string[];
  expected: Expected;
  usesAliases?: boolean;
  engine?: Engine;
  defaultSchemas?: string[] | null;
};

const run = ({ tables, used, usesAliases = true, engine = postgres, defaultSchemas = ["public"] }: Pick<JoinCase, "tables" | "used" | "usesAliases" | "engine" | "defaultSchemas">) =>
  joinSuggestions({ tables, used: new Set(used), usesAliases, engine, defaultSchemas });

const suggestions = (expected: Expected) => expected.map(([label, detail]) => ({ label, detail }));

describe("joinSuggestions: sentidos e formas da chave (RN-SQL-025)", () => {
  it.each<JoinCase>([
    {
      title: "saída, com nome de tabela em `_`: as iniciais viram o apelido; a condição põe a tabela nova à esquerda",
      tables: [stated("itens_pedido", "ip", [out("fk_pedido", ["pedido_id"], "pedidos_entrega", ["id"])])],
      used: ["ip"],
      expected: [["pedidos_entrega pe ON pe.id = ip.pedido_id", "fk_pedido"]],
    },
    {
      title: "entrada: a outra tabela referencia a do comando; a condição põe a coluna dela à esquerda",
      tables: [stated("clientes", "c", [], [into("fk_pedido_cliente", "public", "pedidos", ["cliente_id"], ["id"])])],
      used: ["c"],
      expected: [["pedidos p ON p.cliente_id = c.id", "fk_pedido_cliente"]],
    },
    {
      title: "saída e entrada com a mesma tabela: a de saída antes, cada uma com a condição do seu lado",
      tables: [stated("pedidos", "p", [out("fk_pedido_cliente", ["cliente_id"], "clientes", ["id"])], [into("fk_cliente_pedido_preferido", "public", "clientes", ["pedido_preferido_id"], ["id"])])],
      used: ["p"],
      expected: [
        ["clientes c ON c.id = p.cliente_id", "fk_pedido_cliente"],
        ["clientes c ON c.pedido_preferido_id = p.id", "fk_cliente_pedido_preferido"],
      ],
    },
    {
      title: "chave composta que chega: as colunas com AND, na ordem da chave",
      tables: [stated("itens", "i", [], [into("fk_reserva_item", "public", "reservas", ["empresa", "item_id"], ["empresa", "id"])])],
      used: ["i"],
      expected: [["reservas r ON r.empresa = i.empresa AND r.item_id = i.id", "fk_reserva_item"]],
    },
    {
      title: "chave composta que sai, com as colunas fora da ordem alfabética: a ordem é a da chave",
      tables: [stated("itens", "i", [out("fk_produto", ["produto_codigo", "produto_empresa"], "produtos", ["codigo", "empresa"])])],
      used: ["i"],
      expected: [["produtos p ON p.codigo = i.produto_codigo AND p.empresa = i.produto_empresa", "fk_produto"]],
    },
    {
      title: "duas chaves com as mesmas colunas e nomes diferentes: duas sugestões com o mesmo texto, cada uma com o nome da sua chave",
      tables: [stated("pedidos", "p", [out("fk_faturamento", ["cliente_id"], "clientes", ["id"]), out("fk_entrega", ["cliente_id"], "clientes", ["id"])])],
      used: ["p"],
      expected: [
        ["clientes c ON c.id = p.cliente_id", "fk_faturamento"],
        ["clientes c ON c.id = p.cliente_id", "fk_entrega"],
      ],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("joinSuggestions: autorreferência (RN-SQL-025)", () => {
  it.each<JoinCase>([
    {
      title: "autorreferência com `_` no nome: o apelido novo é cp2, nas duas direções",
      tables: [stated("categorias_produto", "cp", [out("fk_categoria_pai", ["pai_id"], "categorias_produto", ["id"])], [into("fk_categoria_pai", "public", "categorias_produto", ["pai_id"], ["id"])])],
      used: ["cp"],
      expected: [
        ["categorias_produto cp2 ON cp2.id = cp.pai_id", "fk_categoria_pai"],
        ["categorias_produto cp2 ON cp2.pai_id = cp.id", "fk_categoria_pai"],
      ],
    },
    {
      title: "autorreferência com f e f2 em uso: o apelido novo é f3",
      tables: [stated("funcionarios", "f", [out("fk_gerente", ["gerente_id"], "funcionarios", ["id"])])],
      used: ["f", "f2"],
      expected: [["funcionarios f3 ON f3.id = f.gerente_id", "fk_gerente"]],
    },
    {
      title: "autorreferência numa tabela que não é a última: a da última primeiro, depois a autorreferência (saída, entrada)",
      tables: [
        stated("funcionarios", "f", [out("fk_gerente", ["gerente_id"], "funcionarios", ["id"])], [into("fk_gerente", "public", "funcionarios", ["gerente_id"], ["id"])]),
        stated("pedidos", "p", [out("fk_cliente", ["cliente_id"], "clientes", ["id"])]),
      ],
      used: ["f", "p"],
      expected: [
        ["clientes c ON c.id = p.cliente_id", "fk_cliente"],
        ["funcionarios f2 ON f2.id = f.gerente_id", "fk_gerente"],
        ["funcionarios f2 ON f2.gerente_id = f.id", "fk_gerente"],
      ],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("joinSuggestions: colisões de apelido (p, p2, p3)", () => {
  it.each<JoinCase>([
    {
      title: "p e p2 em uso (a outra tabela do comando): a nova ganha p3",
      tables: [stated("pedidos", "p", [out("fk_produto", ["produto_id"], "produtos", ["id"])]), stated("reservas", "p2")],
      used: ["p", "p2"],
      expected: [["produtos p3 ON p3.id = p.produto_id", "fk_produto"]],
    },
    {
      title: "p e p3 em uso: o primeiro livre é p2",
      tables: [stated("pedidos", "p", [out("fk_produto", ["produto_id"], "produtos", ["id"])])],
      used: ["p", "p3"],
      expected: [["produtos p2 ON p2.id = p.produto_id", "fk_produto"]],
    },
    {
      title: "três chaves que dão três tabelas novas: cada uma é uma escolha, e todas ganham p2 (o apelido é o que o comando já usa)",
      tables: [stated("pedidos", "p", [out("fk_produto", ["produto_id"], "produtos", ["id"]), out("fk_pacote", ["pacote_id"], "pacotes", ["id"]), out("fk_pagamento", ["pagamento_id"], "pagamentos", ["id"])])],
      used: ["p"],
      expected: [
        ["produtos p2 ON p2.id = p.produto_id", "fk_produto"],
        ["pacotes p2 ON p2.id = p.pacote_id", "fk_pacote"],
        ["pagamentos p2 ON p2.id = p.pagamento_id", "fk_pagamento"],
      ],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("joinSuggestions: palavras reservadas como apelido (RN-SQL-025)", () => {
  it.each<JoinCase>([
    {
      title: "tabela `o_n`: o apelido `on` é palavra reservada, então é on2",
      tables: [stated("itens", "i", [out("fk_ordem", ["ordem_id"], "o_n", ["id"])])],
      used: ["i"],
      expected: [["o_n on2 ON on2.id = i.ordem_id", "fk_ordem"]],
    },
    {
      title: "tabela `a_s`: `as` é palavra reservada, então as2; o nome sai como está",
      tables: [stated("itens", "i", [out("fk_x", ["x_id"], "a_s", ["id"])])],
      used: ["i"],
      expected: [["a_s as2 ON as2.id = i.x_id", "fk_x"]],
    },
    {
      title: "tabela `user` (reservada no PostgreSQL): o nome vai entre aspas, o apelido é u",
      tables: [stated("pedidos", "p", [out("fk_usuario", ["usuario_id"], "user", ["id"])])],
      used: ["p"],
      expected: [['"user" u ON u.id = p.usuario_id', "fk_usuario"]],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("joinSuggestions: nomes com dígitos e `_` inicial (RN-SQL-025)", () => {
  it.each<JoinCase>([
    {
      title: "nome com `_` inicial, sem aspas: _nota_fiscal → nf",
      tables: [stated("itens", "i", [out("fk_nota", ["nota_id"], "_nota_fiscal", ["id"])])],
      used: ["i"],
      expected: [["_nota_fiscal nf ON nf.id = i.nota_id", "fk_nota"]],
    },
    {
      title: "dígito no meio do nome, sem aspas: vendas_2024 → v (a parte só de número não entra na inicial)",
      tables: [stated("itens", "i", [out("fk_venda", ["venda_id"], "vendas_2024", ["id"])])],
      used: ["i"],
      expected: [["vendas_2024 v ON v.id = i.venda_id", "fk_venda"]],
    },
    {
      title: "nome que começa por dígito pede aspas; o apelido sai das letras",
      tables: [stated("itens", "i", [out("fk_venda", ["venda_id"], "2024_vendas", ["id"])])],
      used: ["i"],
      expected: [['"2024_vendas" v ON v.id = i.venda_id', "fk_venda"]],
    },
    {
      title: "coluna com `_` inicial na condição, sem aspas",
      tables: [stated("itens", "i", [out("fk_venda", ["_ref"], "vendas_2024", ["_id"])])],
      used: ["i"],
      expected: [["vendas_2024 v ON v._id = i._ref", "fk_venda"]],
    },
    {
      title: "sem apelidos: vendas_2024 entra pelo nome inteiro, com o dígito",
      tables: [stated("itens", "itens", [out("fk_venda", ["venda_id"], "vendas_2024", ["id"])])],
      usesAliases: false,
      used: ["itens"],
      expected: [["vendas_2024 ON vendas_2024.id = itens.venda_id", "fk_venda"]],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("joinSuggestions: comando sem apelidos, nomes inteiros (RN-SQL-025)", () => {
  it.each<JoinCase>([
    {
      title: "entrada, com nome de tabela em `_`: o nome inteiro na tabela e na condição",
      tables: [stated("clientes", "clientes", [], [into("fk_pedido_cliente", "public", "pedidos_entrega", ["cliente_id"], ["id"])])],
      usesAliases: false,
      used: ["clientes"],
      expected: [["pedidos_entrega ON pedidos_entrega.cliente_id = clientes.id", "fk_pedido_cliente"]],
    },
    {
      title: "chave composta sem apelidos: AND com os nomes inteiros",
      tables: [stated("itens", "itens", [out("fk_produto", ["empresa", "produto_id"], "produtos", ["empresa", "id"])])],
      usesAliases: false,
      used: ["itens"],
      expected: [["produtos ON produtos.empresa = itens.empresa AND produtos.id = itens.produto_id", "fk_produto"]],
    },
    {
      title: "duas tabelas sem apelidos: a última primeiro, as outras depois",
      tables: [stated("pedidos", "pedidos", [out("fk_cliente", ["cliente_id"], "clientes", ["id"])]), stated("itens", "itens", [out("fk_produto", ["produto_id"], "produtos", ["id"])])],
      usesAliases: false,
      used: ["pedidos", "itens"],
      expected: [
        ["produtos ON produtos.id = itens.produto_id", "fk_produto"],
        ["clientes ON clientes.id = pedidos.cliente_id", "fk_cliente"],
      ],
    },
    {
      title: "Informix sem apelidos: o esquema vai sempre (defaultSchemas null)",
      tables: [stated("pedidos", "pedidos", [out("fk_cliente", ["cliente_id"], "clientes", ["id"], "informix")])],
      engine: informix,
      defaultSchemas: null,
      usesAliases: false,
      used: ["pedidos"],
      expected: [["informix.clientes ON clientes.id = pedidos.cliente_id", "fk_cliente"]],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("joinSuggestions: esquema fora do padrão (RN-SQL-025)", () => {
  it.each<JoinCase>([
    {
      title: "esquema fora do padrão, sem apelidos: o esquema na frente do nome; a condição usa o nome da tabela",
      tables: [stated("pedidos", "pedidos", [out("fk_produto", ["produto_id"], "produtos", ["id"], "erp")])],
      usesAliases: false,
      used: ["pedidos"],
      expected: [["erp.produtos ON produtos.id = pedidos.produto_id", "fk_produto"]],
    },
    {
      title: "dois esquemas padrão: maria e public não aparecem; erp aparece",
      tables: [stated("pedidos", "p", [out("fk_c", ["cliente_id"], "clientes", ["id"], "maria"), out("fk_p", ["produto_id"], "produtos", ["id"], "erp")])],
      defaultSchemas: ["maria", "public"],
      used: ["p"],
      expected: [
        ["clientes c ON c.id = p.cliente_id", "fk_c"],
        ["erp.produtos p2 ON p2.id = p.produto_id", "fk_p"],
      ],
    },
    {
      title: "Informix com apelido: o esquema vai sempre",
      tables: [stated("pedidos", "p", [out("fk_cliente", ["cliente_id"], "clientes", ["id"], "informix")])],
      engine: informix,
      defaultSchemas: null,
      used: ["p"],
      expected: [["informix.clientes c ON c.id = p.cliente_id", "fk_cliente"]],
    },
    {
      title: "esquema e tabela que pedem aspas: as duas entre aspas; o apelido vem da inicial do nome",
      tables: [stated("pedidos", "p", [out("fk_item", ["item_id"], "itens pedido", ["id"], "Erp")])],
      used: ["p"],
      expected: [['"Erp"."itens pedido" i ON i.id = p.item_id', "fk_item"]],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("joinSuggestions: Db2 em maiúsculas (RN-SQL-025)", () => {
  it.each<JoinCase>([
    {
      title: "Db2 sem apelidos: nomes crus em maiúsculas, esquema do usuário omitido",
      tables: [stated("PEDIDOS", "PEDIDOS", [out("FK_CLIENTE", ["CLIENTE_ID"], "CLIENTES", ["ID"], "MARIA")], [], "MARIA")],
      engine: db2,
      defaultSchemas: ["MARIA"],
      usesAliases: false,
      used: ["pedidos"],
      expected: [["CLIENTES ON CLIENTES.ID = PEDIDOS.CLIENTE_ID", "FK_CLIENTE"]],
    },
    {
      title: "Db2 entrada com `_` em maiúsculas: o apelido sai em minúsculas",
      tables: [stated("PEDIDOS", "P", [], [into("FK_ITEM", "MARIA", "ITENS_PEDIDO", ["PEDIDO_ID"], ["ID"])], "MARIA")],
      engine: db2,
      defaultSchemas: ["MARIA"],
      used: ["p"],
      expected: [["ITENS_PEDIDO ip ON ip.PEDIDO_ID = P.ID", "FK_ITEM"]],
    },
    {
      title: "Db2 nome em minúsculas (o Db2 não o dobra) leva aspas; a coluna em maiúsculas vai crua",
      tables: [stated("PEDIDOS", "P", [out("FK_CLI", ["CLIENTE_ID"], "clientes", ["ID"], "MARIA")], [], "MARIA")],
      engine: db2,
      defaultSchemas: ["MARIA"],
      used: ["p"],
      expected: [['"clientes" c ON c.ID = P.CLIENTE_ID', "FK_CLI"]],
    },
    {
      title: "Db2 palavra reservada em maiúsculas (ORDER) entra entre aspas; o apelido é o",
      tables: [stated("PEDIDOS", "P", [out("FK_ORD", ["ORDEM_ID"], "ORDER", ["ID"], "MARIA")], [], "MARIA")],
      engine: db2,
      defaultSchemas: ["MARIA"],
      used: ["p"],
      expected: [['"ORDER" o ON o.ID = P.ORDEM_ID', "FK_ORD"]],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("joinSuggestions: nomes que pedem aspas (RN-SQL-025)", () => {
  it.each<JoinCase>([
    {
      title: "nome com espaço: entre aspas; o apelido é a inicial (só `_` separa as partes)",
      tables: [stated("pedidos", "p", [out("fk_item", ["item_id"], "itens pedido", ["id"])])],
      used: ["p"],
      expected: [['"itens pedido" i ON i.id = p.item_id', "fk_item"]],
    },
    {
      title: "nome com hífen: entre aspas, apelido n",
      tables: [stated("pedidos", "p", [out("fk_nota", ["nota_id"], "nota-fiscal", ["id"])])],
      used: ["p"],
      expected: [['"nota-fiscal" n ON n.id = p.nota_id', "fk_nota"]],
    },
    {
      title: "aspa dentro do nome: dobrada na tabela; a inicial é a letra antes dela",
      tables: [stated("pedidos", "p", [out("fk_a", ["a_id"], 'a"b', ["id"])])],
      used: ["p"],
      expected: [['"a""b" a ON a.id = p.a_id', "fk_a"]],
    },
    {
      title: "sem apelidos, nome com maiúscula: entre aspas na tabela e na condição",
      tables: [stated("pedidos", "pedidos", [out("fk_c", ["cliente_id"], "Clientes", ["Id"])])],
      usesAliases: false,
      used: ["pedidos"],
      expected: [['"Clientes" ON "Clientes"."Id" = pedidos.cliente_id', "fk_c"]],
    },
    {
      title: "palavra reservada como nome (order): entre aspas; o apelido é o",
      tables: [stated("itens", "i", [out("fk_ordem", ["ordem_id"], "order", ["id"])])],
      used: ["i"],
      expected: [['"order" o ON o.id = i.ordem_id', "fk_ordem"]],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("joinSuggestions: ordem e tabelas do comando (RN-SQL-025)", () => {
  it.each<JoinCase>([
    {
      title: "a última primeiro (saída, depois entrada); depois as outras na ordem do comando",
      tables: [
        stated("pedidos", "p", [out("fk_cliente", ["cliente_id"], "clientes", ["id"])]),
        stated("itens", "i", [out("fk_produto", ["produto_id"], "produtos", ["id"])]),
        stated("entregas", "e", [out("fk_transportadora", ["transportadora_id"], "transportadoras", ["id"])], [into("fk_rastreio_entrega", "public", "rastreios", ["entrega_id"], ["id"])]),
      ],
      used: ["p", "i", "e"],
      expected: [
        ["transportadoras t ON t.id = e.transportadora_id", "fk_transportadora"],
        ["rastreios r ON r.entrega_id = e.id", "fk_rastreio_entrega"],
        ["clientes c ON c.id = p.cliente_id", "fk_cliente"],
        ["produtos p2 ON p2.id = i.produto_id", "fk_produto"],
      ],
    },
    {
      title: "a última sem ligação: as da penúltima saem",
      tables: [stated("itens", "i", [out("fk_produto", ["produto_id"], "produtos", ["id"])]), stated("pedidos", "p")],
      used: ["i", "p"],
      expected: [["produtos p2 ON p2.id = i.produto_id", "fk_produto"]],
    },
    {
      title: "tabelas do meio: a ordem é a do comando, não a da ligação",
      tables: [
        stated("itens", "i", [out("fk_produto", ["produto_id"], "produtos", ["id"])]),
        stated("pedidos", "p", [out("fk_cliente", ["cliente_id"], "clientes", ["id"])]),
        stated("entregas", "e"),
      ],
      used: ["i", "p", "e"],
      expected: [
        ["produtos p2 ON p2.id = i.produto_id", "fk_produto"],
        ["clientes c ON c.id = p.cliente_id", "fk_cliente"],
      ],
    },
    {
      title: "a ligação entre duas tabelas do comando não volta (nem da última para a outra, nem o contrário); só a das de fora",
      tables: [
        stated("clientes", "c", [out("fk_cidade", ["cidade_id"], "cidades", ["id"])], [into("fk_pedido_cliente", "public", "pedidos", ["cliente_id"], ["id"])]),
        stated("pedidos", "p", [out("fk_pedido_cliente", ["cliente_id"], "clientes", ["id"])]),
      ],
      used: ["c", "p"],
      expected: [["cidades c2 ON c2.id = c.cidade_id", "fk_cidade"]],
    },
    {
      title: "tabela sem nenhuma chave: nada",
      tables: [stated("pedidos", "p")],
      used: ["p"],
      expected: [],
    },
  ])("$title", (input) => {
    expect(run(input)).toEqual(suggestions(input.expected));
  });
});

describe("aliasFor: palavras reservadas, colisões e nomes com dígitos ou `_` inicial (RN-SQL-025)", () => {
  it.each([
    ["a_s", "as2"],
    ["o_n", "on2"],
    ["i_n", "in2"],
    ["i_s", "is2"],
    ["o_r", "or2"],
    ["d_o", "do2"],
    ["b_y", "by2"],
    ["t_o", "to2"],
    ["j_o_i_n", "join2"],
    ["l_e_f_t", "left2"],
  ])("a inicial de %s, reservada, vira %s", (name, expected) => {
    expect(aliasFor(name, new Set())).toBe(expected);
  });

  it.each<{ name: string; taken: string[]; expected: string }>([
    { name: "p", taken: ["p", "p2", "p3"], expected: "p4" },
    { name: "pedidos", taken: ["p", "p3"], expected: "p2" },
    { name: "o_n", taken: ["on2"], expected: "on3" },
    { name: "a_s", taken: ["as", "as2"], expected: "as3" },
  ])("$name com $taken em uso → $expected", ({ name, taken, expected }) => {
    expect(aliasFor(name, new Set(taken))).toBe(expected);
  });

  it.each([
    // `if` está na lista de palavras reservadas do app (a mesma que faz `sqlName` entre aspas `if`), então o apelido sai com 2. As decisões não nomeiam essa palavra.
    ["_interno_fiscal", "if2"],
    ["__", "t"],
    ["_", "t"],
    ["_2024", "t"],
    ["__nota_fiscal_", "nf"],
    ["a__b", "ab"],
    ["vendas_2024", "v"],
    ["pedido_2_item", "pi"],
    ["nota2_item", "ni"],
    ["t2_pedido", "tp"],
    ["item2", "i"],
  ])("o nome %s dá o apelido %s", (name, expected) => {
    expect(aliasFor(name, new Set())).toBe(expected);
  });
});

describe("writtenTable: o nome como o autocompletar escreve (RN-SQL-025)", () => {
  it.each<{ title: string; table: TableName; engine: Engine; defaults: string[]; expected: string }>([
    { title: "palavra reservada (user) entre aspas no PostgreSQL", table: { schema: "public", name: "user" }, engine: postgres, defaults: ["public"], expected: '"user"' },
    { title: "aspa dentro do nome, dobrada", table: { schema: "public", name: 'a"b' }, engine: postgres, defaults: ["public"], expected: '"a""b"' },
    { title: "nome que começa por dígito pede aspas", table: { schema: "public", name: "2024_vendas" }, engine: postgres, defaults: ["public"], expected: '"2024_vendas"' },
    { title: "dígito no meio do nome não pede aspas", table: { schema: "public", name: "vendas_2024" }, engine: postgres, defaults: ["public"], expected: "vendas_2024" },
    { title: "`_` inicial e esquema fora do padrão", table: { schema: "erp", name: "_log" }, engine: postgres, defaults: ["public"], expected: "erp._log" },
  ])("$title", ({ table, engine, defaults, expected }) => {
    expect(writtenTable(table, engine, defaults)).toBe(expected);
  });
});
