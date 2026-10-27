import { describe, expect, it } from "vitest";

import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

import type { ObjectNames, SchemaObjectNames } from "./database-sessions.schema";
import { treeKey } from "./database-sessions.service";
import { indexLevels, searchIndexCap } from "./navigator-index";
import { childrenKey, databaseNodes, navKey, objectNodes, schemaNodes, tableTargetOf, treeNodes, type LevelState, type NavNode, type NavPath } from "./navigator-model";
import { fold, loadedLevels, searchTree, type CachedNames } from "./navigator-search";

const now = "2026-10-27T12:00:00Z";
const folder: Folder = { id: "f1", parentID: null, name: "Ambientes", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
const connection = (id: string, name: string): Connection => ({ id, folderID: "f1", name, engine: 1, host: "srv", port: 5432, database: "erp", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now });
const base = treeNodes(buildConnectionTree([folder], [connection("c1", "Dev"), connection("c2", "Homolog"), connection("c3", "Prod")]));

const schema = (name: string, tables: string[], views: string[] = [], isSystem = false): SchemaObjectNames => ({ name, isSystem, tables, views });
const answer = (schemas: SchemaObjectNames[], truncated = false): ObjectNames => ({ schemas, truncated });
const index = (connectionId: string, names: ObjectNames, database?: string): CachedNames => (database === undefined ? { connectionId, databaseName: "erp", names } : { connectionId, database, databaseName: database, names });

const run = (query: string, indexes: readonly CachedNames[], levels: ReadonlyMap<string, LevelState> = base.levels, cap?: number) => {
  const result = indexLevels(levels, indexes, fold(query.trim()), cap);
  return { ...result, view: searchTree(base.roots, result.levels, query) };
};
const labels = (rows: NavNode[]) => rows.map((row) => row.label);
const levelOf = (levels: ReadonlyMap<string, LevelState>, path: NavPath) => levels.get(childrenKey({ key: navKey(path) }));
const childrenOf = (levels: ReadonlyMap<string, LevelState>, path: NavPath) => {
  const level = levelOf(levels, path);
  return level?.status === "loaded" ? level.children : undefined;
};

describe("o corte de 200 por banco, nas bordas", () => {
  const tables = (count: number) => Array.from({ length: count }, (_, position) => `t_${String(position).padStart(4, "0")}`);

  it.each([
    { found: 0, shown: 0, hidden: 0 },
    { found: 1, shown: 1, hidden: 0 },
    { found: 199, shown: 199, hidden: 0 },
    { found: 200, shown: 200, hidden: 0 },
    { found: 201, shown: 200, hidden: 1 },
    { found: 250, shown: 200, hidden: 50 },
    { found: 5000, shown: 200, hidden: 4800 },
  ])("$found tabelas que casam: $shown na tela, $hidden de fora", ({ found, shown, hidden }) => {
    const result = run("t_", [index("c1", answer([schema("vendas", tables(found))]))]);
    const rows = result.view.rows.filter((row) => row.kind === "table");

    expect(rows).toHaveLength(shown);
    expect(result.hidden).toBe(hidden);
    expect(result.cuts).toEqual(hidden === 0 ? [] : [{ connectionId: "c1", found, shown }]);
    // O que entra é o começo da lista do banco, e a tela o mostra em ordem de nome.
    expect(labels(rows)).toEqual(tables(shown));
  });

  it("tabelas e visões contam juntas: 150 tabelas e 60 visões que casam mostram as 150 e 50 das visões", () => {
    const { cuts, hidden, view } = run("n_", [index("c1", answer([schema("vendas", Array.from({ length: 150 }, (_, position) => `n_t${position}`), Array.from({ length: 60 }, (_, position) => `n_v${position}`))]))]);

    expect(view.rows.filter((row) => row.kind === "table")).toHaveLength(150);
    expect(view.rows.filter((row) => row.kind === "view")).toHaveLength(50);
    expect(cuts).toEqual([{ connectionId: "c1", found: 210, shown: 200 }]);
    expect(hidden).toBe(10);
    // O grupo cortado diz o que coube do total que o índice tem: o corte não esconde o tamanho do esquema.
    expect(view.rows.find((row) => row.label === "Visões")?.detail).toBe("50 de 60");
    expect(view.rows.find((row) => row.label === "Tabelas")?.detail).toBe("150");
  });

  it("o corte é o que o chamador manda: 1 mostra a primeira e conta as outras; o padrão é o searchIndexCap", () => {
    const names = answer([schema("vendas", tables(3))]);

    expect(run("t_", [index("c1", names)], base.levels, 1).cuts).toEqual([{ connectionId: "c1", found: 3, shown: 1 }]);
    expect(run("t_", [index("c1", names)], base.levels, 3).cuts).toEqual([]);
    expect(indexLevels(base.levels, [index("c1", answer([schema("vendas", tables(searchIndexCap + 1))]))], "t_").hidden).toBe(1);
  });

  it("o banco que já está dentro do corte não herda a sobra do vizinho: o corte é de cada banco", () => {
    const { cuts, view } = run("t_", [index("c1", answer([schema("vendas", tables(500))])), index("c2", answer([schema("vendas", tables(120))])), index("c3", answer([schema("vendas", tables(200))]))]);

    expect(cuts).toEqual([{ connectionId: "c1", found: 500, shown: 200 }]);
    const byConnection = (id: string) => view.rows.filter((row) => row.kind === "table" && (JSON.parse(row.key) as { connectionId: string }).connectionId === id).length;
    expect([byConnection("c1"), byConnection("c2"), byConnection("c3")]).toEqual([200, 120, 200]);
  });
});

describe("nomes exatos: a linha do índice leva o nome como o catálogo o guarda (o SELECT e a chave dependem dele)", () => {
  const awkwardSchema = 'a b/c"d\\e#f {x}';
  const awkwardTables = ['t "x"_k', "t\\y_k", "t#z_k", "t y_k", "t nbsp_k", '{"type":"table"}_k', "Tabela_k", "tabela_k", "Ação_k"];
  const awkwardViews = ['v "x"_k', "v#1_k", "v\\2_k", "v y_k", "v:view:3_k", "#view:1_k"];
  const names = answer([schema(awkwardSchema, awkwardTables, awkwardViews)]);

  it("cada tabela e cada visão volta com o esquema e o nome exatos, e as chaves são as do objectNodes da lista inteira", () => {
    const { view } = run("_k", [index("c1", names)]);
    const found = view.rows.filter((row) => row.kind === "table" || row.kind === "view");

    expect(found.map((row) => tableTargetOf(row)).sort((a, b) => a!.name.localeCompare(b!.name))).toEqual(
      [...awkwardTables, ...awkwardViews].map((name) => ({ connectionId: "c1", schema: awkwardSchema, name })).sort((a, b) => a.name.localeCompare(b.name)),
    );
    expect(new Set(found.map((row) => row.key)).size).toBe(found.length);

    const real = [
      ...objectNodes("c1", awkwardSchema, "tables", awkwardTables.map((name) => ({ name, kind: "table" as const }))),
      ...objectNodes("c1", awkwardSchema, "views", awkwardViews.map((name) => ({ name, kind: "view" as const }))),
    ];
    for (const row of found) expect(real.find((node) => node.label === row.label)?.key).toBe(row.key);
  });

  it("o esquema de nome estranho aparece com o nome exato, e o do outro banco leva a marca dele", () => {
    const { view } = run("_k", [index("c1", names), index("c1", names, 'banco "x"/y')]);

    expect(view.rows.filter((row) => row.kind === "schema").map((row) => row.label)).toEqual([awkwardSchema, awkwardSchema]);
    expect(view.rows.filter((row) => row.kind === "database").map((row) => row.label)).toEqual(["erp", 'banco "x"/y']);
    expect(view.rows.filter((row) => row.kind === "table" && row.key.includes("banco")).map((row) => tableTargetOf(row)?.database)).toEqual(Array(awkwardTables.length).fill('banco "x"/y'));
  });
});

describe("o termo é texto, não padrão: nada do que se digita vira operador", () => {
  const names = answer([schema("s", ["a_b", "axb", "a%b", "a\\b", "a.b", "a*b", "(x)", "[y]", "$z", "^w", "q?", "p+", "m|n", "{o}", "a b", "A-B", "ab"])]);
  const found = (query: string) => labels(run(query, [index("c1", names)]).view.rows.filter((row) => row.kind === "table")).sort();

  it.each([
    ["_", ["a_b"]],
    ["%", ["a%b"]],
    ["\\", ["a\\b"]],
    [".", ["a.b"]],
    ["*", ["a*b"]],
    ["(", ["(x)"]],
    ["[", ["[y]"]],
    ["$", ["$z"]],
    ["^", ["^w"]],
    ["?", ["q?"]],
    ["+", ["p+"]],
    ["|", ["m|n"]],
    ["{", ["{o}"]],
    ["a.", ["a.b"]],
    ["a_", ["a_b"]],
    ["a b", ["a b"]],
    ["  A-B  ", ["A-B"]],
  ])("%j", (query, expected) => {
    expect(found(query)).toEqual([...expected].sort());
  });

  it("um termo só de espaços não procura nada (como a busca da árvore)", () => {
    expect(indexLevels(base.levels, [index("c1", names)], fold("   ".trim())).levels).toBe(base.levels);
  });
});

describe("a conta não guarda estado entre chamadas: o dobrado e as posições das visões são do dado, não do termo", () => {
  const views = ["Zeta", "alfa", "Beta", "álamo", "v10", "v9", "v2", "Pedido", "pedido", "v_a", "v_b", "v_c"];
  const names = answer([schema("vendas", ["alfa_t", "beta_t", "Gama_t"], views), schema("crm", ["cliente"], ["v_cliente", "V_Cliente"])]);
  const needles = ["a", "v", "v_", "pedido", "ZETA", "alfa", "cli", "t", "v1", "á", "z", "gama", "inexistente"];

  /** O que uma chamada devolve, sem a identidade: os níveis montados (chave a chave) e os cortes. */
  const outcome = (indexes: CachedNames[], needle: string) => {
    const result = indexLevels(base.levels, indexes, fold(needle));
    return { levels: [...result.levels].map(([key, state]) => [key, state]), cuts: result.cuts, hidden: result.hidden };
  };

  it("a mesma resposta, consultada com termos em qualquer ordem, dá o que uma resposta nova (recém-chegada) daria", () => {
    const shared = [index("c1", names)];

    for (const order of [needles, [...needles].reverse(), [...needles.slice(5), ...needles.slice(0, 5)]]) {
      for (const needle of order) {
        // A cópia é outro objeto: não tem dobrado nem posição guardados.
        const fresh = [index("c1", structuredClone(names))];
        expect(outcome(shared, needle), `termo ${needle}`).toEqual(outcome(fresh, needle));
      }
    }
  });

  it("duas chamadas seguidas com o mesmo termo dão o mesmo resultado", () => {
    const indexes = [index("c1", names)];

    expect(outcome(indexes, "v")).toEqual(outcome(indexes, "v"));
  });

  it("as posições das visões são as da lista inteira, também quando a primeira busca achou só uma delas e a segunda acha outras", () => {
    const indexes = [index("c1", names)];
    const real = objectNodes("c1", "vendas", "views", views.map((name) => ({ name, kind: "view" as const })));

    for (const needle of ["v_a", "pedido", "zeta", "v1", "á"]) {
      const group = childrenOf(indexLevels(base.levels, indexes, fold(needle)).levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "views" }) ?? [];
      expect(group.length, needle).toBeGreaterThan(0);
      for (const row of group) expect(real.find((node) => node.label === row.label)?.key, `${needle}: ${row.label}`).toBe(row.key);
    }
  });

  it("não mexe no que recebe: a resposta, a lista de índices e os níveis ficam como estavam (inclusive congelados)", () => {
    const frozen = structuredClone(names);
    for (const item of frozen.schemas) {
      Object.freeze(item.tables);
      Object.freeze(item.views);
      Object.freeze(item);
    }
    Object.freeze(frozen.schemas);
    Object.freeze(frozen);
    const indexes = Object.freeze([Object.freeze(index("c1", frozen))]);
    const levelsBefore = [...base.levels];

    expect(() => indexLevels(base.levels, indexes, fold("a"))).not.toThrow();
    expect(() => indexLevels(base.levels, indexes, fold("v"))).not.toThrow();

    expect([...base.levels]).toEqual(levelsBefore);
    expect(frozen).toEqual(names);
  });

  it("a mesma resposta em três conexões (como a que o cache compartilha) dá um achado por conexão, cada um com a chave da sua", () => {
    const { view, cuts } = run("cliente", [index("c1", names), index("c2", names), index("c3", names)]);
    const tables = view.rows.filter((row) => row.kind === "table");

    expect(tables.map((row) => tableTargetOf(row)?.connectionId)).toEqual(["c1", "c2", "c3"]);
    expect(new Set(tables.map((row) => row.key)).size).toBe(3);
    expect(cuts).toEqual([]);
  });
});

describe("o que a árvore já carregou vale mais, em cada nível", () => {
  const vendas = schema("vendas", ["cliente", "pedido"], ["v_cliente"]);

  it("a conexão com a lista dos bancos carregada não ganha o banco padrão de novo, e o outro banco que tem índice entra sob o nó dele", () => {
    const own = loadedLevels(base.levels, [{ key: treeKey({ type: "connection", connectionId: "c1" }), nodes: databaseNodes("c1", [{ name: "erp", isCurrent: true }, { name: "arquivo", isCurrent: false }]) }]);
    const { view } = run("pedido", [index("c1", answer([schema("historico", ["pedido_2019"])]), "arquivo")], own);

    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "arquivo", "historico", "Tabelas", "pedido_2019"]);
    expect(view.rows.filter((row) => row.kind === "database")).toHaveLength(1);
  });

  it("a lista dos esquemas carregada vale: o esquema que nasceu depois dela só entra com o 'Atualizar', como a tabela nova", () => {
    const own = loadedLevels(base.levels, [
      { key: treeKey({ type: "connection", connectionId: "c1" }), nodes: databaseNodes("c1", [{ name: "erp", isCurrent: true }]) },
      { key: treeKey({ type: "database", connectionId: "c1" }), nodes: schemaNodes("c1", [{ name: "vendas", isSystem: false }]) },
    ]);
    const { view } = run("cliente", [index("c1", answer([vendas, schema("novo", ["cliente_novo"])]))], own);

    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "erp", "vendas", "Tabelas", "cliente", "Visões", "v_cliente"]);
  });

  it("o que a árvore já tem não é refeito em nível nenhum: o mesmo objeto da conexão, do banco, do esquema e dos grupos, e só o que faltava é acrescentado", () => {
    const paths: NavPath[] = [
      { type: "connection", connectionId: "c1" },
      { type: "database", connectionId: "c1" },
      { type: "schema", connectionId: "c1", schema: "vendas" },
      { type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" },
      { type: "objects", connectionId: "c1", schema: "vendas", objects: "routines" },
    ];
    const own = loadedLevels(base.levels, [
      { key: treeKey({ type: "connection", connectionId: "c1" }), nodes: databaseNodes("c1", [{ name: "erp", isCurrent: true }]) },
      { key: treeKey({ type: "database", connectionId: "c1" }), nodes: schemaNodes("c1", [{ name: "vendas", isSystem: false }]) },
      { key: treeKey({ type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" }), nodes: objectNodes("c1", "vendas", "tables", [{ name: "cliente_real", kind: "table" }]) },
      { key: treeKey({ type: "objects", connectionId: "c1", schema: "vendas", objects: "routines" }), nodes: [] },
    ]);
    const { levels } = run("cliente", [index("c1", answer([vendas]))], own);

    for (const path of paths) expect(levelOf(levels, path), JSON.stringify(path)).toBe(levelOf(own, path));
    // O que faltava (as visões) veio do índice, e só isso.
    expect(levels.size - own.size).toBe(1);
    expect(childrenOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "views" })?.map((node) => node.label)).toEqual(["v_cliente"]);
  });

  it("o grupo de tabelas carregado de verdade, mesmo vazio, não recebe nada do índice", () => {
    const own = loadedLevels(base.levels, [{ key: treeKey({ type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" }), nodes: [] }]);
    const { view, levels } = run("cliente", [index("c1", answer([vendas]))], own);

    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "erp", "vendas", "Visões", "v_cliente"]);
    expect(childrenOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" })).toEqual([]);
  });
});

describe("o índice cortado na API e o banco sem nada", () => {
  it("cortado na API, o corte da tela continua valendo e o grupo mostra só os achados (sem 'de N')", () => {
    const tables = Array.from({ length: 300 }, (_, position) => `t_${position}`);
    const { view, cuts, levels } = run("t_", [index("c1", answer([schema("vendas", tables)], true))]);

    expect(cuts).toEqual([{ connectionId: "c1", found: 300, shown: 200 }]);
    expect(levelOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" })).not.toHaveProperty("total");
    expect(view.rows.find((row) => row.label === "Tabelas")?.detail).toBe("200");
  });

  it("os bancos aparecem sob a conexão com o da conexão primeiro, qualquer que seja a ordem em que os índices chegaram, e o banco sem tabela nem visão não aparece", () => {
    const { view } = run("pedido", [
      index("c1", answer([schema("historico", ["pedido_2019"])]), "arquivo"),
      index("c1", answer([]), "vazio"),
      index("c1", answer([schema("vendas", ["pedido"])])),
    ]);

    expect(view.rows.filter((row) => row.kind === "database").map((row) => row.label)).toEqual(["erp", "arquivo"]);
  });

  it("achado só no esquema de sistema: aparece por último, com a marca, depois dos comuns", () => {
    const { view } = run("class", [index("c1", answer([schema("crm", ["classe"]), schema("pg_catalog", ["pg_class"], [], true)]))]);

    expect(labels(view.rows.filter((row) => row.kind === "schema" || row.kind === "table"))).toEqual(["crm", "classe", "pg_catalog", "pg_class"]);
    expect(view.rows.find((row) => row.label === "pg_catalog")?.detail).toBe("sistema");
  });
});
