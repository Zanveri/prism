import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

import type { ObjectNames, SchemaObjectNames } from "./database-sessions.schema";
import { databaseSessionKey, objectNamesKey, treeKey } from "./database-sessions.service";
import { indexLevels, searchIndexCap } from "./navigator-index";
import { childrenKey, databaseNodes, flattenVisible, navKey, objectNodes, parseNavKey, schemaGroupNodes, schemaNodes, tableTargetOf, treeNodes, type LevelState, type NavNode, type NavPath } from "./navigator-model";
import { cachedTree, fold, loadedLevels, searchTree, type CachedNames } from "./navigator-search";

const now = "2026-10-27T12:00:00Z";
const folder: Folder = { id: "f1", parentID: null, name: "Ambientes", environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
const connection = (id: string, name: string): Connection => ({ id, folderID: "f1", name, engine: 1, host: "srv", port: 5432, database: "erp", userName: "u", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now });

const base = treeNodes(buildConnectionTree([folder], [connection("c1", "Dev"), connection("c2", "Homolog"), connection("c3", "Prod")]));

const schema = (name: string, tables: string[], views: string[] = [], isSystem = false): SchemaObjectNames => ({ name, isSystem, tables, views });
const answer = (schemas: SchemaObjectNames[], truncated = false): ObjectNames => ({ schemas, truncated });
/** O índice de um banco: do banco da conexão (com o nome que a sessão dá) ou de outro banco do servidor. */
const index = (connectionId: string, names: ObjectNames, database?: string): CachedNames => (database === undefined ? { connectionId, databaseName: "erp", names } : { connectionId, database, databaseName: database, names });

const run = (query: string, indexes: readonly CachedNames[], levels: ReadonlyMap<string, LevelState> = base.levels, cap?: number) => {
  const result = indexLevels(levels, indexes, fold(query.trim()), cap);
  return { ...result, view: searchTree(base.roots, result.levels, query) };
};
const labels = (rows: NavNode[]) => rows.map((row) => row.label);
const levelOf = (levels: ReadonlyMap<string, LevelState>, path: NavPath) => levels.get(childrenKey({ key: navKey(path) }));
const loaded = (children: NavNode[], total?: number): LevelState => ({ status: "loaded", children, ...(total === undefined ? {} : { total }) });

const vendas = schema("vendas", ["cliente", "pedido", "item_pedido"], ["v_cliente"]);

describe("indexLevels: a tabela de um esquema que ninguém abriu aparece no caminho dela (RN-BUSCA-002)", () => {
  it("a conexão sem a lista dos bancos ganha só o banco dela, marcado como o padrão, e a tabela aparece com os ancestrais", () => {
    const { view } = run("cliente", [index("c1", answer([vendas]))]);

    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "erp", "vendas", "Tabelas", "cliente", "Visões", "v_cliente"]);
    expect(view.rows.find((row) => row.label === "erp")?.badge).toBe(databaseNodes("c1", [{ name: "erp", isCurrent: true }])[0].badge);
    expect(view.rows.map((row) => row.depth)).toEqual([0, 1, 2, 3, 4, 5, 4, 5]);
    expect(view.rows.filter((row) => view.open.has(row.key)).map((row) => row.label)).toEqual(["Ambientes", "Dev", "erp", "vendas", "Tabelas", "Visões"]);
  });

  it("o banco da conexão sem nome (a sessão já não está no cache) e sem a lista dos bancos não tem onde aparecer", () => {
    const { view, levels } = run("cliente", [{ connectionId: "c1", names: answer([vendas]) }]);

    expect(view.rows).toEqual([]);
    expect(levelOf(levels, { type: "connection", connectionId: "c1" })).toBeUndefined();
  });

  it("os grupos fixos do esquema entram (Tabelas, Visões e Rotinas), mas só os que têm achado aparecem na busca", () => {
    const { levels, view } = run("cliente", [index("c1", answer([vendas]))]);

    expect(levelOf(levels, { type: "schema", connectionId: "c1", schema: "vendas" })).toEqual(loaded(schemaGroupNodes("c1", "vendas")));
    expect(labels(view.rows)).not.toContain("Rotinas");
  });

  it("a linha é a mesma que a árvore terá quando o nível carregar: a mesma chave da tabela, para o duplo clique, o menu e a escolha", () => {
    const { levels } = run("pedido", [index("c1", answer([vendas]))]);
    const group = levelOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" });
    const real = objectNodes("c1", "vendas", "tables", vendas.tables.map((name) => ({ name, kind: "table" as const })));

    expect(group?.status === "loaded" && group.children.map((node) => node.label)).toEqual(["item_pedido", "pedido"]);
    for (const node of group?.status === "loaded" ? group.children : []) expect(node).toEqual(real.find((row) => row.label === node.label));
    expect(tableTargetOf((group as { children: NavNode[] }).children[1])).toEqual({ connectionId: "c1", schema: "vendas", name: "pedido" });
  });

  it("a chave da visão é a posição dela na lista INTEIRA em ordem byName, a mesma do objectNodes, mesmo com acento, caixa e número", () => {
    const names = ["Zeta", "alfa", "Beta", "álamo", "v10", "v9", "v2", "Pedido", "pedido"];
    const real = objectNodes("c1", "vendas", "views", names.map((name) => ({ name, kind: "view" as const })));
    const { levels } = run("a", [index("c1", answer([schema("vendas", [], names)]))]);
    const group = levelOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "views" });

    expect(group?.status).toBe("loaded");
    const children = (group as { children: NavNode[] }).children;
    // As que casam, na ordem da lista inteira (a da tela): "álamo" antes de "alfa", "Beta" e "Zeta" sem diferenciar a caixa.
    expect(children.map((node) => node.label)).toEqual(real.map((row) => row.label).filter((label) => fold(label).includes("a")));
    expect(children.map((node) => node.label)).toEqual(["álamo", "alfa", "Beta", "Zeta"]);
    for (const node of children) expect(node.key).toBe(real.find((row) => row.label === node.label)?.key);
    expect(tableTargetOf(children[0])).toEqual({ connectionId: "c1", schema: "vendas", name: children[0].label });
  });

  it("as visões que a busca mostra são só as que casam, mas cada uma leva a posição que tem entre TODAS as do esquema", () => {
    const names = ["v_a", "v_b", "v_c", "v_d", "v_e"];
    const { levels } = run("v_d", [index("c1", answer([schema("vendas", [], names)]))]);
    const group = levelOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "views" }) as { children: NavNode[]; total: number };

    expect(group.children).toHaveLength(1);
    expect(group.children[0].key).toBe(objectNodes("c1", "vendas", "views", names.map((name) => ({ name, kind: "view" as const })))[3].key);
    expect(group.total).toBe(5);
  });

  it("acento e caixa não contam, no nome da tabela e no do esquema", () => {
    const { view } = run("PRODUCAO", [index("c1", answer([schema("Vendas", ["Produção_Extra", "ordem_producao", "linha"]), schema("Produção", [])]))]);

    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "erp", "Produção", "Vendas", "Tabelas", "ordem_producao", "Produção_Extra"]);
  });

  it("o esquema cujo nome casa aparece mesmo sem tabela que case (como na árvore carregada), sem chevron", () => {
    const { view } = run("vendas", [index("c1", answer([vendas]))]);
    const row = view.rows.find((item) => item.label === "vendas");

    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "erp", "vendas"]);
    expect(row?.hasChildren).toBe(false);
  });

  it("os esquemas de sistema vêm por último, na lista e no corte", () => {
    const system = schema("pg_catalog", ["pg_class", "pg_proc"], [], true);
    const indexes = [index("c1", answer([vendas, schema("crm", ["classe"]), system]))];

    expect(labels(run("cl", indexes).view.rows.filter((row) => row.kind === "schema"))).toEqual(["crm", "pg_catalog", "vendas"]);
    expect(run("cl", indexes).view.rows.find((row) => row.label === "pg_catalog")?.detail).toBe("sistema");

    const cut = run("cl", indexes, base.levels, 3);
    expect(labels(cut.view.rows.filter((row) => row.kind === "table" || row.kind === "view"))).toEqual(["classe", "cliente", "v_cliente"]);
    expect(cut.cuts).toEqual([{ connectionId: "c1", found: 4, shown: 3 }]);
  });
});

describe("indexLevels: o carregado de verdade vale mais", () => {
  const real = (connectionId: string, tables: string[]) => objectNodes(connectionId, "vendas", "tables", tables.map((name) => ({ name, kind: "table" as const })));
  const realPath: NavPath = { type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" };

  it("o nível já carregado não recebe nada do índice: o grupo, a lista dos esquemas e a dos bancos ficam como estavam", () => {
    const own = loadedLevels(base.levels, [
      { key: treeKey({ type: "connection", connectionId: "c1" }), nodes: databaseNodes("c1", [{ name: "erp", isCurrent: true }, { name: "arquivo", isCurrent: false }]) },
      { key: treeKey(realPath), nodes: real("c1", ["cliente_real"]) },
    ]);
    const before = new Map(own);
    const { levels, view } = run("cliente", [index("c1", answer([vendas]))], own);

    expect(levelOf(levels, realPath)).toBe(levelOf(own, realPath));
    expect(levelOf(levels, { type: "connection", connectionId: "c1" })).toBe(levelOf(own, { type: "connection", connectionId: "c1" }));
    expect(labels(view.rows)).toContain("cliente_real");
    expect(labels(view.rows)).not.toContain("cliente");
    expect(own).toEqual(before);
  });

  it("o grupo carregado de verdade não gasta o corte do índice: os achados dele não contam", () => {
    const own = loadedLevels(base.levels, [{ key: treeKey(realPath), nodes: real("c1", ["cliente_real"]) }]);
    const many = Array.from({ length: 300 }, (_, position) => `cliente_${position}`);
    const { cuts, hidden, view } = run("cliente", [index("c1", answer([schema("vendas", many), schema("crm", ["cliente"])]))], own);

    expect(cuts).toEqual([]);
    expect(hidden).toBe(0);
    expect(labels(view.rows)).toEqual(expect.arrayContaining(["cliente_real", "cliente"]));
    expect(view.rows.filter((row) => row.label.startsWith("cliente_") && row.label !== "cliente_real")).toEqual([]);
  });

  it("o grupo de visões é independente do de tabelas: o das tabelas carregado, o das visões vem do índice", () => {
    const own = loadedLevels(base.levels, [{ key: treeKey(realPath), nodes: real("c1", ["cliente_real"]) }]);
    const { view } = run("cliente", [index("c1", answer([vendas]))], own);

    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "erp", "vendas", "Tabelas", "cliente_real", "Visões", "v_cliente"]);
  });

  it("não altera os níveis que recebeu, e sem índice (ou com o índice vazio) devolve o próprio mapa", () => {
    const original = new Map(base.levels);

    run("cliente", [index("c1", answer([vendas]))]);
    expect(base.levels).toEqual(original);

    expect(indexLevels(base.levels, [], "cliente").levels).toBe(base.levels);
    expect(indexLevels(base.levels, [index("c1", answer([]))], "cliente")).toEqual({ levels: base.levels, cuts: [], hidden: 0 });
    expect(run("cliente", [index("c1", answer([]))]).view.rows).toEqual([]);
  });

  it("termo vazio não monta nada (quem chama mostra a árvore normal)", () => {
    expect(indexLevels(base.levels, [index("c1", answer([vendas]))], "").levels).toBe(base.levels);
  });

  it("um termo que não casa nada não acrescenta nenhum grupo nem achado", () => {
    const { levels, view, cuts } = run("zzz", [index("c1", answer([vendas]))]);

    expect(view.rows).toEqual([]);
    expect(cuts).toEqual([]);
    expect(levelOf(levels, { type: "schema", connectionId: "c1", schema: "vendas" })).toBeUndefined();
    expect(levelOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" })).toBeUndefined();
  });
});

describe("indexLevels: o grupo diz quantas casaram do total do índice (RN-BUSCA-002)", () => {
  const tables = Array.from({ length: 120 }, (_, position) => (position < 3 ? `cliente_${position}` : `outra_${position}`));

  it("'3 de 120': os filhos são os que casaram, e o total é o do índice", () => {
    const { levels, view } = run("cliente", [index("c1", answer([schema("vendas", tables)]))]);
    const group = levelOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" });

    expect(group).toMatchObject({ status: "loaded", total: 120 });
    expect(view.rows.find((row) => row.label === "Tabelas")?.detail).toBe("3 de 120");
  });

  it("o grupo em que tudo casa diz só o total", () => {
    expect(run("_", [index("c1", answer([schema("vendas", ["a_1", "a_2"])]))]).view.rows.find((row) => row.label === "Tabelas")?.detail).toBe("2");
  });

  it("com o índice cortado na API o total não se sabe: o nível não leva 'total' e o grupo mostra só o número achado", () => {
    const { levels, view } = run("cliente", [index("c1", answer([schema("vendas", tables, ["v_cliente_a", "v_outra"])], true))]);

    expect(levelOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" })).not.toHaveProperty("total");
    expect(levelOf(levels, { type: "objects", connectionId: "c1", schema: "vendas", objects: "views" })).not.toHaveProperty("total");
    expect(view.rows.find((row) => row.label === "Tabelas")?.detail).toBe("3");
    expect(view.rows.find((row) => row.label === "Visões")?.detail).toBe("1");
  });
});

describe("indexLevels: o corte é de 200 por banco, e a contagem continua além dele", () => {
  const many = (prefix: string, count: number) => Array.from({ length: count }, (_, position) => `${prefix}_${String(position).padStart(4, "0")}`);

  it("o corte padrão é 200", () => {
    expect(searchIndexCap).toBe(200);
  });

  it("cada banco mostra as suas 200 primeiras, na ordem dos esquemas e dos nomes do banco, e os achados além do corte ficam contados", () => {
    const { cuts, hidden, view } = run("cliente", [index("c1", answer([schema("vendas", many("cliente", 500))]))]);

    expect(view.rows.filter((row) => row.kind === "table")).toHaveLength(200);
    expect(view.rows.filter((row) => row.kind === "table").at(-1)?.label).toBe("cliente_0199");
    expect(cuts).toEqual([{ connectionId: "c1", found: 500, shown: 200 }]);
    expect(hidden).toBe(300);
    expect(view.count).toBe(200);
  });

  it("o corte é por banco e não do total: três ambientes com as mesmas tabelas mostram as 200 de cada um", () => {
    const names = answer([schema("vendas", many("cliente", 450))]);
    const { cuts, hidden, view } = run("cliente", [index("c1", names), index("c2", names), index("c3", names)]);

    for (const connectionId of ["c1", "c2", "c3"]) {
      expect(view.rows.filter((row) => row.kind === "table" && (parseNavKey(row.key) as { connectionId: string }).connectionId === connectionId)).toHaveLength(200);
    }
    expect(cuts.map((cut) => [cut.connectionId, cut.found, cut.shown])).toEqual([["c1", 450, 200], ["c2", 450, 200], ["c3", 450, 200]]);
    expect(hidden).toBe(750);
  });

  it("o corte atravessa os esquemas na ordem do índice, tabelas antes das visões, e o grupo cortado mostra o que coube", () => {
    const first = schema("a_primeiro", ["x_1", "x_2", "x_3"], ["x_v1", "x_v2"]);
    const second = schema("b_segundo", ["x_4", "x_5"]);
    const { levels, cuts } = run("x_", [index("c1", answer([first, second]))], base.levels, 4);

    const children = (path: NavPath) => (levelOf(levels, path) as { children: NavNode[] } | undefined)?.children.map((node) => node.label);
    expect(children({ type: "objects", connectionId: "c1", schema: "a_primeiro", objects: "tables" })).toEqual(["x_1", "x_2", "x_3"]);
    expect(children({ type: "objects", connectionId: "c1", schema: "a_primeiro", objects: "views" })).toEqual(["x_v1"]);
    expect(children({ type: "objects", connectionId: "c1", schema: "b_segundo", objects: "tables" })).toBeUndefined();
    expect(cuts).toEqual([{ connectionId: "c1", found: 7, shown: 4 }]);
  });

  it("sem passar do corte, nada é cortado", () => {
    const { cuts, hidden } = run("cliente", [index("c1", answer([schema("vendas", many("cliente", 200))]))]);

    expect(cuts).toEqual([]);
    expect(hidden).toBe(0);
  });

  it("um termo de uma letra que acha quase tudo continua sendo cortado por banco", () => {
    const { cuts, view } = run("e", [index("c1", answer([schema("vendas", many("cliente", 5000), many("visoes", 1000))])), index("c2", answer([schema("vendas", many("cliente", 10))]))]);

    expect(view.rows.filter((row) => row.kind === "table" || row.kind === "view")).toHaveLength(210);
    expect(cuts).toEqual([{ connectionId: "c1", found: 6000, shown: 200 }]);
    expect(view.rows.filter((row) => row.kind === "view")).toEqual([]);
  });
});

describe("indexLevels: vários bancos e várias conexões", () => {
  it("três conexões com a mesma tabela dão três caminhos, cada um com a chave da sua conexão", () => {
    const names = answer([schema("vendas", ["cliente"])]);
    const { view } = run("cliente", [index("c1", names), index("c2", names), index("c3", names)]);
    const tables = view.rows.filter((row) => row.kind === "table");

    expect(tables.map((row) => (parseNavKey(row.key) as { connectionId: string }).connectionId)).toEqual(["c1", "c2", "c3"]);
    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "erp", "vendas", "Tabelas", "cliente", "Homolog", "erp", "vendas", "Tabelas", "cliente", "Prod", "erp", "vendas", "Tabelas", "cliente"]);
    expect(new Set(tables.map((row) => row.key)).size).toBe(3);
  });

  it("outro banco do servidor leva a marca dele nas chaves, sob o nó dele, depois do banco da conexão", () => {
    const { view } = run("pedido", [index("c1", answer([vendas])), index("c1", answer([schema("historico", ["pedido_2019"])]), "arquivo")]);
    const arquivo = view.rows.find((row) => row.label === "pedido_2019");

    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "erp", "vendas", "Tabelas", "item_pedido", "pedido", "arquivo", "historico", "Tabelas", "pedido_2019"]);
    expect(view.rows.find((row) => row.label === "arquivo")?.badge).toBeUndefined();
    expect(parseNavKey(arquivo!.key)).toEqual({ type: "table", connectionId: "c1", database: "arquivo", schema: "historico", table: "pedido_2019" });
    expect(tableTargetOf(arquivo!)).toEqual({ connectionId: "c1", database: "arquivo", schema: "historico", name: "pedido_2019" });
  });

  it("o índice de outro banco sozinho (sem o do banco da conexão) mostra só ele, sem inventar o banco padrão", () => {
    const { view } = run("pedido", [index("c1", answer([schema("historico", ["pedido_2019"])]), "arquivo")]);

    expect(labels(view.rows)).toEqual(["Ambientes", "Dev", "arquivo", "historico", "Tabelas", "pedido_2019"]);
  });

  it("o corte vale por banco da mesma conexão", () => {
    const many = (count: number) => answer([schema("s", Array.from({ length: count }, (_, position) => `t_${position}`))]);
    const { cuts } = run("t_", [index("c1", many(250)), index("c1", many(300), "arquivo")]);

    expect(cuts).toEqual([
      { connectionId: "c1", found: 250, shown: 200 },
      { connectionId: "c1", database: "arquivo", found: 300, shown: 200 },
    ]);
  });
});

describe("a busca inteira: do cache da árvore ao que aparece (cachedTree, loadedLevels, indexLevels, searchTree)", () => {
  function scenario() {
    const client = new QueryClient();
    for (const id of ["c1", "c2", "c3"]) {
      client.setQueryData(databaseSessionKey(id), { id: `s-${id}`, database: "erp" });
      client.setQueryData(objectNamesKey(id), answer([vendas]));
    }
    return client;
  }

  const search = (client: QueryClient, query: string) => {
    const cache = cachedTree(client);
    const { levels, cuts } = indexLevels(loadedLevels(base.levels, cache.cached), cache.indexes, fold(query.trim()));
    return { view: searchTree(base.roots, levels, query), cuts };
  };

  it("'cliente' acha a tabela nas três conexões, todas recolhidas e sem nível nenhum aberto, com o caminho aberto", () => {
    const { view } = search(scenario(), "cliente");

    expect(view.rows.filter((row) => row.kind === "table").map((row) => (parseNavKey(row.key) as { connectionId: string }).connectionId)).toEqual(["c1", "c2", "c3"]);
    expect(view.rows.filter((row) => view.open.has(row.key)).map((row) => row.label)).toEqual(["Ambientes", "Dev", "erp", "vendas", "Tabelas", "Visões", "Homolog", "erp", "vendas", "Tabelas", "Visões", "Prod", "erp", "vendas", "Tabelas", "Visões"]);
  });

  it("a conexão que perde o índice (o 'Desconectar') sai do resultado, e a que o ganha entra", () => {
    const client = scenario();
    client.removeQueries({ queryKey: ["tree", "c2"] });
    expect(search(client, "cliente").view.rows.filter((row) => row.kind === "table")).toHaveLength(2);

    client.setQueryData(databaseSessionKey("c2"), { id: "s-c2", database: "erp" });
    client.setQueryData(objectNamesKey("c2"), answer([vendas]));
    expect(search(client, "cliente").view.rows.filter((row) => row.kind === "table")).toHaveLength(3);
  });

  it("limpar o campo devolve a árvore como estava: nada entrou nos níveis da árvore nem no que ela guarda", () => {
    const client = scenario();
    const before = new Map(base.levels);
    const open = new Set<string>();
    const rowsBefore = flattenVisible(base.roots, open, base.levels);

    search(client, "cliente");

    expect(base.levels).toEqual(before);
    expect(flattenVisible(base.roots, open, base.levels)).toEqual(rowsBefore);
    expect(cachedTree(client).cached).toEqual([]);
  });

  it("o nível que a árvore carrega depois vale mais, e a linha continua com a mesma chave (a escolha não se perde)", () => {
    const client = scenario();
    const fromIndex = search(client, "pedido").view.rows.find((row) => row.label === "pedido" && row.key.includes('"c1"'));

    // A árvore carrega o que a pessoa abriu: a lista dos bancos, a dos esquemas e o grupo de tabelas.
    client.setQueryData(treeKey({ type: "connection", connectionId: "c1" }), databaseNodes("c1", [{ name: "erp", isCurrent: true }]));
    client.setQueryData(treeKey({ type: "database", connectionId: "c1" }), schemaNodes("c1", [{ name: "vendas", isSystem: false }]));
    client.setQueryData(treeKey({ type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" }), objectNodes("c1", "vendas", "tables", [{ name: "pedido", kind: "table" }, { name: "pedido_novo", kind: "table" }]));
    const afterLoad = search(client, "pedido").view.rows.find((row) => row.label === "pedido" && row.key.includes('"c1"'));

    expect(fromIndex?.key).toBe(afterLoad?.key);
    expect(search(client, "pedido_novo").view.rows.some((row) => row.label === "pedido_novo")).toBe(true);
  });
});
