import { CompletionContext, type autocompletion, type CompletionResult } from "@codemirror/autocomplete";
import { PostgreSQL, sql, StandardSQL, type SQLDialect } from "@codemirror/lang-sql";
import { EditorState } from "@codemirror/state";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";
import { freezeParseBudget } from "@/lib/testing/parse-budget";
import { withoutCursor } from "@/lib/testing/text";

import type { NavKind, NavNode } from "./navigator-model";
import type { CachedLevel } from "./navigator-search";

// A configuração que `sqlCompletion` entrega à biblioteca, anotada a cada chamada: é por ela que o teste roda as fontes DE VERDADE do editor (o `override`), e não
// uma cópia delas montada aqui. O resto da biblioteca é o de verdade.
type CompletionConfig = NonNullable<Parameters<typeof autocompletion>[0]>;
const configured = vi.hoisted(() => [] as CompletionConfig[]);
vi.mock("@codemirror/autocomplete", async (importOriginal) => {
  const real = await importOriginal<typeof import("@codemirror/autocomplete")>();

  return {
    ...real,
    autocompletion: (config: CompletionConfig) => {
      configured.push(config);
      return real.autocompletion(config);
    },
  };
});

import { cachedLevels, completionNamespace, namesSource, sqlCompletion, sqlName } from "./sql-completion";
import { uppercaseWords } from "./sql-keyword-case";
import { isInsideComment, statementCount } from "./sql-statements";
import { quoteIdentifier } from "./table-sql";

freezeParseBudget();

const postgres: Engine = 1;
const db2: Engine = 2;
const informix: Engine = 3;

const node = (kind: NavKind, label: string, detail?: string): NavNode => ({ key: `${kind}:${label}`, kind, label, depth: 0, hasChildren: kind === "table", ...(detail === undefined ? {} : { detail }) });
const level = (key: string[], nodes: NavNode[]): CachedLevel => ({ key, nodes });

/** O que a árvore de uma conexão guarda depois de o usuário abrir `erp` e `public`, e as colunas de `public.clientes` (a árvore ordena os esquemas por nome). */
const tree = (): CachedLevel[] => [
  level(["tree", "c1", "schemas"], [node("schema", "erp"), node("schema", "public"), node("schema", "pg_catalog", "sistema")]),
  level(["tree", "c1", "schema", "public", "objects", "tables"], [node("table", "clientes"), node("table", "Pedidos")]),
  level(["tree", "c1", "schema", "public", "objects", "views"], [node("view", "v_ativos")]),
  level(["tree", "c1", "schema", "public", "objects", "routines"], [node("routine", "fn_total", "função")]),
  level(["tree", "c1", "schema", "erp", "objects", "tables"], [node("table", "produtos"), node("table", "clientes")]),
  level(["tree", "c1", "schema", "public", "table", "clientes", "columns"], [node("column", "id", "integer"), node("column", "nome", "text · nulo")]),
  level(["tree", "c1", "schema", "public", "table", "clientes", "indexes"], [node("index", "clientes_pkey", "id")]),
];

type Where = { engine?: Engine; dialect?: SQLDialect; explicit?: boolean };

/** Roda a fonte de nomes no texto, com o cursor onde está o `|`. O resultado é o da fonte, sem a lista já filtrada: quem filtra pelo que foi digitado é a biblioteca. */
function run(text: string, levels: readonly CachedLevel[], { engine = postgres, dialect = PostgreSQL, explicit = false }: Where = {}) {
  const { doc, at } = withoutCursor(text);
  const state = EditorState.create({ doc, extensions: [sql({ dialect })] });
  const result = namesSource(() => levels, dialect, engine)(new CompletionContext(state, at, explicit)) as CompletionResult | null;

  return { doc, at, result };
}

function propose(text: string, levels: readonly CachedLevel[], where: Where = {}) {
  const { result } = run(text, levels, where);

  return { from: result?.from ?? null, options: (result?.options ?? []).map((option) => ({ label: option.label, apply: option.apply, detail: option.detail, type: option.type })) };
}

const labels = (proposal: ReturnType<typeof propose>) => proposal.options.map((option) => option.label).sort();
const find = (proposal: ReturnType<typeof propose>, label: string) => proposal.options.find((option) => option.label === label);

/** O texto que o editor passa a ter ao aceitar a sugestão de rótulo `label`: o que ela insere, no lugar do que a biblioteca manda trocar. */
function accept(text: string, levels: readonly CachedLevel[], label: string, where: Where = {}): string {
  const { doc, at, result } = run(text, levels, { explicit: true, ...where });
  const option = result?.options.find((candidate) => candidate.label === label);
  if (result === null || option === undefined) throw new Error(`sem a sugestão ${label} em ${text}`);

  return doc.slice(0, result.from) + (typeof option.apply === "string" ? option.apply : option.label) + doc.slice(result.to ?? at);
}

/** As reservadas do PostgreSQL que a lista das maiúsculas não tem de propósito (nome comum de coluna fica fora dela): `user` à frente, que o servidor lê como função. */
const alsoReserved = ["user", "session_user", "system_user", "current_catalog", "current_role", "current_schema", "localtime", "localtimestamp", "window", "array", "asymmetric", "symmetric", "both", "leading", "trailing", "collate", "deferrable", "initially", "do", "placing", "variadic", "analyse"];

/**
 * As palavras reservadas do PostgreSQL, como o servidor as lista (`pg_get_keywords()` num PostgreSQL 18.6; é a tabela do apêndice "SQL Key Words" da
 * documentação): as 78 "reservadas" (categoria R) e as 23 "reservadas, podem ser função ou tipo" (categoria T). Nenhuma delas é nome de tabela ou de coluna sem
 * aspas. As "não reservadas" (U) e as "não reservadas, não podem ser função ou tipo" (C: `between`, `values`, `exists`, `int`…) ficam de fora: valem como nome.
 */
const postgresReserved =
  "all analyse analyze and any array as asc asymmetric both case cast check collate column constraint create current_catalog current_date current_role current_time current_timestamp current_user default deferrable desc distinct do else end except false fetch for foreign from grant group having in initially intersect into lateral leading limit localtime localtimestamp not null offset on only or order placing primary references returning select session_user some symmetric system_user table then to trailing true union unique user using variadic when where window with".split(
    " ",
  );
const postgresReservedAsFunctionOrType = "authorization binary collation concurrently cross current_schema freeze full ilike inner is isnull join left like natural notnull outer overlaps right similar tablesample verbose".split(" ");

/** Nomes comuns de coluna e de esquema que o dialeto marca como palavra-chave e que NÃO são reservados: nunca pedem aspas. */
const plainNames = ["id", "name", "type", "count", "public", "value", "key", "level", "data", "status", "year", "month", "day", "text", "code", "date", "time", "index", "view", "open", "close", "comment", "position", "sequence", "schema", "database", "function"];

describe("sqlName: o nome como vai ao SQL (cru só o que o banco lê como está escrito)", () => {
  // O PostgreSQL e o Informix dobram o nome sem aspas para minúsculas; o Db2, para MAIÚSCULAS. Cru só o nome simples que já está na caixa que o banco dobra e que
  // não é palavra reservada: nome comum (`id`, `name`, `type`, `count`, `public`) vai como está, e todo o resto passa por `quoteIdentifier`.
  describe.each([
    ["PostgreSQL", postgres],
    ["Informix", informix],
  ] as const)("%s (dobra para minúsculas)", (_name, engine) => {
    it("o nome simples em minúsculas (letras, número, sublinhado e cifrão) vai como está", () => {
      for (const name of ["clientes", "itens_2", "a$b", "_x", "v_ativos"]) expect(sqlName(name, engine), name).toBe(name);
    });

    it("o nome comum que o dialeto marca como palavra-chave, mas que não é reservado, vai como está: id, name, type, count, public…", () => {
      for (const name of plainNames) expect(sqlName(name, engine), name).toBe(name);
    });

    it("a palavra reservada entra entre aspas, mesmo parecendo simples: `user`, `order` e `select` não são nomes para o servidor", () => {
      for (const word of ["user", "order", "select", "table", "group", "from", "where", "ilike", ...alsoReserved]) expect(sqlName(word, engine), word).toBe(`"${word}"`);
    });

    it("todo o resto, por quoteIdentifier: caixa mista, maiúsculas, espaço, número no começo, aspa, ponto e vírgula, comentário", () => {
      expect(sqlName("Pedidos", engine)).toBe(quoteIdentifier("Pedidos"));
      expect(sqlName("CLIENTES", engine)).toBe('"CLIENTES"');
      expect(sqlName("ordem de serviço", engine)).toBe('"ordem de serviço"');
      expect(sqlName("2fa", engine)).toBe('"2fa"');
      expect(sqlName('a"b', engine)).toBe('"a""b"');
      expect(sqlName("x; drop table y; --", engine)).toBe('"x; drop table y; --"');
      expect(sqlName("x -- ", engine)).toBe('"x -- "');
    });
  });

  it("o Informix também: o driver abre a sessão com identificadores delimitados (sonda de 2026-10-09), então `Clientes` cru viraria `clientes`, e as aspas são o que o nome exige", () => {
    expect(sqlName("Clientes", informix)).toBe('"Clientes"');
    expect(sqlName("clientes", informix)).toBe("clientes");
  });

  it("sem o banco da aba, vale o PostgreSQL", () => {
    expect(sqlName("clientes", undefined)).toBe("clientes");
    expect(sqlName("Clientes", undefined)).toBe('"Clientes"');
    expect(sqlName("order", undefined)).toBe('"order"');
  });

  describe("Db2 (dobra para MAIÚSCULAS)", () => {
    it("o nome simples em MAIÚSCULAS vai como está: o Db2 dobra `clientes` para `CLIENTES`, então `CLIENTES` cru acha a tabela CLIENTES", () => {
      for (const name of ["CLIENTES", "PEDIDO", "ITENS_2", "A$B", "_X", "DB2INST1"]) expect(sqlName(name, db2), name).toBe(name);
    });

    it("o nome comum em maiúsculas (ID, NAME, TYPE, COUNT, PUBLIC…) também vai como está", () => {
      for (const name of plainNames) expect(sqlName(name.toUpperCase(), db2), name).toBe(name.toUpperCase());
    });

    it("a palavra reservada, em maiúsculas, entra entre aspas: ORDER, SELECT, USER…", () => {
      for (const word of ["order", "select", "user", "table", "group", ...alsoReserved]) expect(sqlName(word.toUpperCase(), db2), word).toBe(`"${word.toUpperCase()}"`);
    });

    it("em minúsculas ou em caixa mista entra entre aspas, com a grafia do catálogo: sem elas o Db2 leria outro nome", () => {
      expect(sqlName("clientes", db2)).toBe('"clientes"');
      expect(sqlName("pedido", db2)).toBe('"pedido"');
      expect(sqlName("Pedidos", db2)).toBe('"Pedidos"');
      expect(sqlName("PedidoItem", db2)).toBe('"PedidoItem"');
    });

    it("todo o resto, por quoteIdentifier: espaço, número no começo, aspa, ponto e vírgula, comentário", () => {
      expect(sqlName("ORDEM DE SERVIÇO", db2)).toBe('"ORDEM DE SERVIÇO"');
      expect(sqlName("2FA", db2)).toBe('"2FA"');
      expect(sqlName('A"B', db2)).toBe('"A""B"');
      expect(sqlName("X; DROP TABLE Y; --", db2)).toBe('"X; DROP TABLE Y; --"');
      expect(sqlName("X --", db2)).toBe('"X --"');
    });
  });

  describe("a lista das reservadas é fixa e a mesma nos três bancos", () => {
    it("tem todas as palavras da conversão para maiúsculas (`uppercaseWords`): nenhuma delas vai crua, em caixa alguma", () => {
      for (const word of uppercaseWords) {
        expect(sqlName(word, postgres), word).toBe(`"${word}"`);
        expect(sqlName(word, informix), word).toBe(`"${word}"`);
        expect(sqlName(word.toUpperCase(), db2), word).toBe(`"${word.toUpperCase()}"`);
      }
    });

    it("TODAS as reservadas do PostgreSQL entram entre aspas, as 78 reservadas e as 23 que podem ser função ou tipo: `authorization`, `binary`, `freeze`, `isnull`, `verbose`…", () => {
      expect(postgresReserved).toHaveLength(78);
      expect(postgresReservedAsFunctionOrType).toHaveLength(23);

      const raw = [...postgresReserved, ...postgresReservedAsFunctionOrType].filter((word) => sqlName(word, postgres) !== `"${word}"`);
      expect(raw).toEqual([]);
    });

    it("no Db2, em maiúsculas, as mesmas: a lista é uma só", () => {
      const raw = [...postgresReserved, ...postgresReservedAsFunctionOrType].filter((word) => sqlName(word.toUpperCase(), db2) !== `"${word.toUpperCase()}"`);
      expect(raw).toEqual([]);
    });

    it("e as reservadas do PostgreSQL que ela não tem de propósito, `user` à frente", () => {
      for (const word of alsoReserved) expect(uppercaseWords.has(word), word).toBe(false);
    });
  });
});

describe("os nomes que a árvore já carregou (RN-CONFIG-004)", () => {
  it("no PostgreSQL, sem ponto: os esquemas e as tabelas e visões de todos os esquemas carregados, sem rotinas nem índices", () => {
    const proposal = propose("select * from cli|", tree());

    expect(labels(proposal)).toEqual(["Pedidos", "clientes", "erp", "pg_catalog", "produtos", "public", "v_ativos"]);
    expect(proposal.from).toBe(14);
  });

  it("o nome do esquema padrão entra como está; o de outro esquema entra com o esquema na frente, e a tela diz de onde vem", () => {
    const proposal = propose("select * from |", tree(), { explicit: true });

    expect(find(proposal, "clientes")).toMatchObject({ detail: "public · tabela", type: "class" });
    expect(find(proposal, "clientes")?.apply).toBeUndefined();
    expect(find(proposal, "produtos")).toMatchObject({ apply: "erp.produtos", detail: "erp · tabela" });
    expect(find(proposal, "v_ativos")).toMatchObject({ detail: "public · visão", type: "interface" });
    expect(find(proposal, "Pedidos")?.apply).toBe('"Pedidos"');
    expect(find(proposal, "erp")).toMatchObject({ detail: "esquema", type: "namespace" });
  });

  it("`public` é palavra-chave do dialeto, mas não é reservada: o esquema entra como está, e a tabela dele, que é o padrão, sem esquema nenhum", () => {
    const proposal = propose("select * from |", tree(), { explicit: true });

    expect(find(proposal, "public")?.apply).toBeUndefined();
    expect(find(proposal, "clientes")?.apply).toBeUndefined();
  });

  it("o mesmo nome em dois esquemas aparece uma vez, e vale o do esquema padrão", () => {
    const proposal = propose("select * from |", tree(), { explicit: true });

    expect(proposal.options.filter((option) => option.label === "clientes")).toHaveLength(1);
    expect(find(proposal, "clientes")?.detail).toBe("public · tabela");
  });

  it("depois de `esquema.`, as tabelas e visões daquele esquema, com o nome sozinho, que o esquema já foi digitado", () => {
    const erp = propose("select * from erp.|", tree());
    expect(labels(erp)).toEqual(["clientes", "produtos"]);
    expect(find(erp, "produtos")).toMatchObject({ detail: "tabela" });
    expect(find(erp, "produtos")?.apply).toBeUndefined();

    const pub = propose("select * from public.|", tree());
    expect(labels(pub)).toEqual(["Pedidos", "clientes", "v_ativos"]);
    expect(find(pub, "Pedidos")?.apply).toBe('"Pedidos"');
    expect(find(pub, "v_ativos")?.detail).toBe("visão");
  });

  it("depois de `tabela.`, `esquema.tabela.` ou `apelido.`, as colunas que a árvore já carregou, com o tipo ao lado", () => {
    for (const text of ["select clientes.| from clientes", "select public.clientes.| from public.clientes", "select c.| from clientes c", "select c.| from public.clientes as c"]) {
      const proposal = propose(text, tree());

      expect(labels(proposal), text).toEqual(["id", "nome"]);
      expect(find(proposal, "nome"), text).toMatchObject({ detail: "text · nulo", type: "property" });
    }
  });

  it("a coluna que o dialeto conta como palavra-chave (`id`, `name`, `type`, `count`, no PostgreSQL) entra como está, e só a reservada (`user`, `order`) entra entre aspas", () => {
    const columns = [level(["tree", "c1", "schema", "public", "table", "clientes", "columns"], ["id", "name", "type", "count", "nome", "user", "order"].map((label) => node("column", label)))];
    const proposal = propose("select c.| from clientes c", [...tree().filter((entry) => !entry.key.includes("columns")), ...columns]);

    for (const name of ["id", "name", "type", "count", "nome"]) expect(find(proposal, name)?.apply, name).toBeUndefined();
    for (const name of ["user", "order"]) expect(find(proposal, name)?.apply, name).toBe(`"${name}"`);
  });

  it("uma tabela cujas colunas ainda não foram carregadas não tem sugestão de coluna, e nada é inventado", () => {
    expect(labels(propose("select p.| from erp.produtos p", tree()))).toEqual([]);
  });

  it("sem nada carregado, nenhum nome", () => {
    expect(labels(propose("select * from cli|", []))).toEqual([]);
    expect(labels(propose("select * from |", [], { explicit: true }))).toEqual([]);
  });

  it("no Informix e no Db2 não há esquema padrão conhecido: toda tabela entra com o esquema na frente, e o nome vai pela mesma regra dos três bancos", () => {
    const ifxTree = [
      level(["tree", "c1", "schemas"], [node("schema", "informix")]),
      level(["tree", "c1", "schema", "informix", "objects", "tables"], [node("table", "clientes"), node("table", "Pedidos")]),
    ];
    const ifx = propose("select * from |", ifxTree, { engine: informix, dialect: StandardSQL, explicit: true });
    expect(find(ifx, "clientes")?.apply).toBe("informix.clientes");
    expect(find(ifx, "Pedidos")?.apply).toBe('informix."Pedidos"');
    expect(find(ifx, "informix")?.apply).toBeUndefined();

    // O Db2 dobra o nome sem aspas para MAIÚSCULAS: o nome simples em maiúsculas que não é reservado entra como está (`CLIENTES` cru acha a tabela CLIENTES), e
    // todo o resto, entre aspas (em minúsculas ou em caixa mista, sem elas o Db2 leria outro nome; `ORDER` é reservada).
    const db2Tree = [
      level(["tree", "c1", "schemas"], [node("schema", "DB2INST1")]),
      level(["tree", "c1", "schema", "DB2INST1", "objects", "tables"], [node("table", "CLIENTES"), node("table", "PEDIDO"), node("table", "ORDER"), node("table", "USER"), node("table", "pedidos"), node("table", "Pedidos")]),
    ];
    const ids = propose("select * from |", db2Tree, { engine: db2, dialect: StandardSQL, explicit: true });
    expect(find(ids, "CLIENTES")?.apply).toBe("DB2INST1.CLIENTES");
    expect(find(ids, "PEDIDO")?.apply).toBe("DB2INST1.PEDIDO");
    expect(find(ids, "ORDER")?.apply).toBe('DB2INST1."ORDER"');
    expect(find(ids, "USER")?.apply).toBe('DB2INST1."USER"');
    expect(find(ids, "pedidos")?.apply).toBe('DB2INST1."pedidos"');
    expect(find(ids, "Pedidos")?.apply).toBe('DB2INST1."Pedidos"');
    expect(find(ids, "DB2INST1")?.apply).toBeUndefined();
  });

  it("a mesma regra nos três bancos: id, name, type, count e public entram como estão onde o banco lê como está escrito; user, order e select, entre aspas", () => {
    const names = ["id", "name", "type", "count", "user", "order", "select"];
    const bank = (schema: string, engine: Engine, dialect: SQLDialect, fold: (name: string) => string) => {
      const treeOf = [level(["tree", "c1", "schemas"], [node("schema", schema)]), level(["tree", "c1", "schema", schema, "objects", "tables"], names.map((name) => node("table", fold(name))))];
      return propose("select * from |", treeOf, { engine, dialect, explicit: true });
    };

    const pg = bank("public", postgres, PostgreSQL, (name) => name);
    for (const name of ["id", "name", "type", "count"]) expect(find(pg, name)?.apply, `PostgreSQL ${name}`).toBeUndefined();
    for (const name of ["user", "order", "select"]) expect(find(pg, name)?.apply, `PostgreSQL ${name}`).toBe(`"${name}"`);
    expect(find(pg, "public")?.apply).toBeUndefined();

    const ifx = bank("informix", informix, StandardSQL, (name) => name);
    for (const name of ["id", "name", "type", "count"]) expect(find(ifx, name)?.apply, `Informix ${name}`).toBe(`informix.${name}`);
    for (const name of ["user", "order", "select"]) expect(find(ifx, name)?.apply, `Informix ${name}`).toBe(`informix."${name}"`);

    const ids = bank("DB2INST1", db2, StandardSQL, (name) => name.toUpperCase());
    for (const name of ["ID", "NAME", "TYPE", "COUNT"]) expect(find(ids, name)?.apply, `Db2 ${name}`).toBe(`DB2INST1.${name}`);
    for (const name of ["USER", "ORDER", "SELECT"]) expect(find(ids, name)?.apply, `Db2 ${name}`).toBe(`DB2INST1."${name}"`);
  });

  it("o nome com ponto não vira dois níveis: continua uma tabela só", () => {
    const dotted = [level(["tree", "c1", "schemas"], [node("schema", "public")]), level(["tree", "c1", "schema", "public", "objects", "tables"], [node("table", "v1.0")])];
    const proposal = propose("select * from public.|", dotted);

    expect(labels(proposal)).toEqual(["v1.0"]);
    expect(find(proposal, "v1.0")?.apply).toBe('"v1.0"');
  });

  it("o texto digitado entre aspas pede os nomes entre aspas, e a sugestão os devolve assim", () => {
    const proposal = propose('select * from public."Ped|', tree());

    expect(find(proposal, '"Pedidos"')).toBeDefined();
  });

  it("monta a estrutura uma vez por conjunto de níveis: a mesma árvore devolve o mesmo resultado, e uma árvore nova refaz", () => {
    const levels = tree();
    const dialect = PostgreSQL;
    const source = namesSource(() => levels, dialect, postgres);
    const state = EditorState.create({ doc: "select * from cli", extensions: [sql({ dialect })] });

    const first = source(new CompletionContext(state, 17, false)) as CompletionResult;
    const again = source(new CompletionContext(state, 17, false)) as CompletionResult;
    expect(again.options).toBe(first.options);

    const changed = namesSource(() => [...levels, level(["tree", "c1", "schema", "erp", "objects", "views"], [node("view", "v_erp")])], dialect, postgres);
    const refreshed = changed(new CompletionContext(state, 17, false)) as CompletionResult;
    expect(refreshed.options.map((option) => option.label)).toContain("v_erp");
    expect(first.options.map((option) => option.label)).not.toContain("v_erp");
  });
});

describe("o que a sugestão insere nunca muda o comando (RN-TABELA-002: a mesma regra nos três bancos)", () => {
  /**
   * Nomes que o catálogo pode devolver e que, crus, mudariam o comando: outro comando, um comentário que engole o resto, aspas, chave, palavra reservada, caixa mista.
   * `ORDER` e `USER` são a reservada que o Db2 devolve em maiúsculas (a forma que ele deixaria crua), e `PEDIDO`, o nome simples que no Db2 vai como está.
   */
  const hostile = ["x; drop table y; --", "x --", "x /*", "x }", "{ x", 'a"b', "Clientes", "user", "order", "select", "window", "ORDER", "USER", "PEDIDO", "a b", "x'y", "v1.0", "x\ny"];
  const banks = [
    ["PostgreSQL", postgres, PostgreSQL, "public"],
    ["Db2", db2, StandardSQL, "DB2INST1"],
    ["Informix", informix, StandardSQL, "informix"],
  ] as const;

  describe.each(banks)("%s", (_name, engine, dialect, schema) => {
    const levels = [
      level(["tree", "c1", "schemas"], [node("schema", schema), node("schema", "erp")]),
      level(["tree", "c1", "schema", schema, "objects", "tables"], hostile.map((name) => node("table", name))),
      level(["tree", "c1", "schema", "erp", "objects", "views"], hostile.map((name) => node("view", name))),
      level(["tree", "c1", "schema", schema, "table", "clientes", "columns"], hostile.map((name) => node("column", name))),
    ];

    it.each(hostile)("%j: aceitar a sugestão deixa UM comando só e o WHERE onde estava, no nível de cima e depois de `esquema.`", (name) => {
      for (const [text, label] of [
        ["delete from | where id = 5", name],
        [`delete from ${schema}.| where id = 5`, name],
        [`delete from erp.| where id = 5`, name],
      ] as const) {
        const after = accept(text, levels, label, { engine, dialect });

        expect(statementCount(after, engine), after).toBe(1);
        expect(after.endsWith(" where id = 5"), after).toBe(true);
        expect(after.startsWith("delete from "), after).toBe(true);
        // Contar comandos não pega o comentário que o nome abre (`x --`, `x /*`, `{ x` no Informix): o WHERE segue no texto e fora de qualquer comentário.
        expect(isInsideComment(after, after.lastIndexOf("where"), engine), after).toBe(false);
      }
    });

    it.each(hostile)("%j: a coluna aceita depois de `tabela.` também não escapa", (name) => {
      const levelsWithTable = [...levels, level(["tree", "c1", "schema", schema, "objects", "tables"], [node("table", "clientes")])];
      const after = accept(`select c.| from ${schema}.clientes c where c.id = 5`, levelsWithTable, name, { engine, dialect });

      expect(statementCount(after, engine), after).toBe(1);
      expect(after.endsWith(` from ${schema}.clientes c where c.id = 5`), after).toBe(true);
      expect(isInsideComment(after, after.lastIndexOf("where"), engine), after).toBe(false);
    });

    it.each(hostile)("%j: com as aspas já abertas pela pessoa a sugestão entra inteira e bem escrita (a biblioteca trocaria o rótulo sem dobrar a aspa de dentro)", (name) => {
      const prefix = engine === postgres ? "" : `${sqlName(schema, engine)}.`;

      const top = accept(`delete from "|" where id = 5`, levels, quoteIdentifier(name), { engine, dialect });
      expect(top).toBe(`delete from ${prefix}${quoteIdentifier(name)} where id = 5`);
      expect(statementCount(top, engine), top).toBe(1);

      const nested = accept(`delete from ${schema}."|" where id = 5`, levels, quoteIdentifier(name), { engine, dialect });
      expect(nested).toBe(`delete from ${schema}.${quoteIdentifier(name)} where id = 5`);
      expect(statementCount(nested, engine), nested).toBe(1);
    });
  });
});

describe("ler a árvore do cache sem consultar o banco", () => {
  it("devolve só os níveis respondidos da conexão: as sessões, as outras conexões e o que ainda não chegou ficam de fora", () => {
    const client = new QueryClient();
    client.setQueryData(["tree", "c1", "schemas"], [node("schema", "public")]);
    client.setQueryData(["tree", "c1", "schema", "public", "objects", "tables"], [node("table", "clientes")]);
    client.setQueryData(["tree", "c2", "schemas"], [node("schema", "outro")]);
    client.setQueryData(["database-session", "c1"], { id: "s1", database: "erp" });
    void client.prefetchQuery({ queryKey: ["tree", "c1", "schema", "erp", "objects", "tables"], queryFn: () => new Promise<NavNode[]>(() => undefined) });

    const levels = cachedLevels(client, "c1");

    expect(levels.map((entry) => entry.key)).toEqual([
      ["tree", "c1", "schemas"],
      ["tree", "c1", "schema", "public", "objects", "tables"],
    ]);
    expect(cachedLevels(client, "c3")).toEqual([]);
    client.clear();
  });

  it("só o banco da aba (RN-ARVORE-006): o banco da conexão não vê os níveis de outro banco, nem a lista dos bancos, e o outro só vê os dele", () => {
    const client = new QueryClient();
    client.setQueryData(["tree", "c1", "databases"], [node("database", "erp")]);
    client.setQueryData(["tree", "c1", "schemas"], [node("schema", "public")]);
    client.setQueryData(["tree", "c1", { database: "arquivo" }, "schemas"], [node("schema", "historico")]);
    client.setQueryData(["tree", "c1", { database: "arquivo" }, "schema", "historico", "objects", "tables"], [node("table", "pedidos_2019")]);

    expect(cachedLevels(client, "c1").map((entry) => entry.key)).toEqual([["tree", "c1", "schemas"]]);
    expect(cachedLevels(client, "c1", "arquivo").map((entry) => entry.key)).toEqual([
      ["tree", "c1", { database: "arquivo" }, "schemas"],
      ["tree", "c1", { database: "arquivo" }, "schema", "historico", "objects", "tables"],
    ]);
    expect(cachedLevels(client, "c1", "outro")).toEqual([]);
    client.clear();
  });

  it("não busca nada: ler não inicia consulta nenhuma", () => {
    const client = new QueryClient();
    const fetched: unknown[] = [];
    client.getQueryCache().subscribe((event) => {
      if (event.type === "added") fetched.push(event.query.queryKey);
    });
    cachedLevels(client, "c1");

    expect(fetched).toEqual([]);
  });
});

describe("a estrutura de nomes", () => {
  it("só entra esquema, tabela, visão e coluna, nesta ordem: as rotinas e os índices não", () => {
    const namespace = completionNamespace(tree(), postgres);
    const text = JSON.stringify(namespace);

    expect(text).toContain("clientes");
    expect(text).not.toContain("fn_total");
    expect(text).not.toContain("clientes_pkey");
  });
});

describe("depois de um ponto só entram os nomes daquele objeto (E3)", () => {
  /**
   * O que a lista de sugestões mostra no texto, com o cursor onde está o `|`: as fontes que a extensão de verdade do editor (`sqlCompletion`) entrega à
   * biblioteca (`override`, anotado em `configured`), cada uma com o que propõe, e o filtro que a biblioteca aplica (`filterStrict`: só o que COMEÇA com o que foi
   * digitado, sem diferenciar a caixa).
   */
  function suggest(text: string, { engine = postgres, dialect = PostgreSQL, explicit = false }: Where = {}): string[] {
    const { doc, at } = withoutCursor(text);
    const state = EditorState.create({ doc, extensions: [sql({ dialect })] });

    configured.length = 0;
    sqlCompletion({ dialect, engine, levels: tree });
    const [{ override, filterStrict }] = configured;
    expect(filterStrict).toBe(true);

    return (override ?? []).flatMap((source) => {
      const result = source(new CompletionContext(state, at, explicit)) as CompletionResult | null;
      if (result === null) return [];

      const typed = doc.slice(result.from, at).toLowerCase();
      return result.options.map((option) => option.label).filter((label) => label.toLowerCase().startsWith(typed));
    });
  }

  it("depois de `tabela.`: só as colunas dela, cada uma uma vez, sem palavra-chave (antes saíam `id`, e depois `id` de novo, `identity`, `if`, `ignore`…)", () => {
    expect(suggest("select clientes.i| from clientes")).toEqual(["id"]);
    expect(suggest("select clientes.n| from clientes")).toEqual(["nome"]);
  });

  it("depois de `apelido.` e de `esquema.tabela.`: o mesmo", () => {
    expect(suggest("select c.n| from clientes c")).toEqual(["nome"]);
    expect(suggest("select public.clientes.i| from public.clientes")).toEqual(["id"]);
  });

  it("depois de `esquema.`: só as tabelas e as visões dele", () => {
    expect(suggest("select * from public.c|")).toEqual(["clientes"]);
    expect(suggest("select * from erp.p|")).toEqual(["produtos"]);
  });

  it("logo depois do ponto, sem letra nenhuma: todos os nomes do objeto, e nenhuma palavra-chave", () => {
    expect(suggest("select clientes.| from clientes").sort()).toEqual(["id", "nome"]);
  });

  it("uma coluna que a árvore ainda não carregou não ganha palavra-chave no lugar: a lista fica vazia", () => {
    expect(suggest("select produtos.i| from erp.produtos")).toEqual([]);
  });

  it("fora do ponto as palavras-chave seguem valendo, junto com os nomes", () => {
    expect(suggest("sel|")).toContain("select");
    expect(suggest("select i|")).toEqual(expect.arrayContaining(["if", "in", "is"]));
    expect(suggest("select * from c|")).toEqual(expect.arrayContaining(["clientes", "cross"]));
  });

  it("o ponto que não é o da palavra em que se está não conta: depois de `tabela.coluna`, a palavra seguinte volta a ter palavras-chave", () => {
    expect(suggest("select clientes.id f|")).toContain("from");
    expect(suggest("select 1.5, i|")).toContain("if");
  });

  it("a palavra depois do ponto pode ter acento: Ctrl+Espaço no meio dela não traz a lista inteira de palavras-chave", () => {
    expect(suggest("select clientes.ação| from clientes", { explicit: true })).toEqual([]);
    expect(suggest("select clientes.| from clientes", { explicit: true }).sort()).toEqual(["id", "nome"]);
  });

  it("vale nos dialetos do Db2 e do Informix (SQL padrão)", () => {
    // Sem esquema padrão conhecido, a tabela vai com o esquema: `clientes` sozinho seria o do primeiro esquema da árvore (`erp`), que não tem colunas carregadas.
    expect(suggest("select c.n| from public.clientes c", { engine: informix, dialect: StandardSQL })).toEqual(["nome"]);
    expect(suggest("select public.clientes.i|", { engine: db2, dialect: StandardSQL })).toEqual(["id"]);
    expect(suggest("sel|", { engine: db2, dialect: StandardSQL })).toContain("select");
  });
});

describe("a extensão do editor", () => {
  it("traduz o nome da lista para o leitor de tela", () => {
    const state = EditorState.create({ doc: "", extensions: [sqlCompletion({ dialect: PostgreSQL, engine: postgres, levels: () => [] })] });

    expect(state.phrase("Completions")).toBe("Sugestões");
  });
});
