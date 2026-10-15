import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { databaseSessionKey, getDatabases, loadServerDatabases, openDatabaseSession, reopenDatabaseSession, treeKey, treePrefixes, treeQuery, treeSessionIds } from "./database-sessions.service";
import { navKey, parseNavKey } from "./navigator-model";

/** A API trocada: cada pedido responde pelo caminho e pelo método, e o teste lê o que foi pedido. */
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/prism-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/prism-api")>()), apiRequest: api.request }));

type Call = { path: string; method?: string; body?: unknown };
const calls = () => api.request.mock.calls.map(([path, options]): Call => ({ path, method: options?.method, body: options?.body }));

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.request.mockReset();
  api.request.mockImplementation((path: string, options?: { method?: string; body?: { database?: string } }) => {
    if (options?.method === "POST") return Promise.resolve({ ok: true, data: { id: `sessao-${options.body?.database ?? "padrao"}`, database: options.body?.database ?? "mes" } });
    if (path.endsWith("/databases")) return Promise.resolve({ ok: true, data: [{ name: "alfa", isCurrent: false }, { name: "mes", isCurrent: true }] });
    if (path.endsWith("/schemas")) return Promise.resolve({ ok: true, data: [{ name: "loja", isSystem: false }] });
    return Promise.resolve({ ok: true, data: [] });
  });
});

describe("a sessão de outro banco do servidor (RN-ARVORE-006)", () => {
  it("sem banco, o POST leva só a conexão; com banco, leva o nome dele", async () => {
    await openDatabaseSession("c1");
    await openDatabaseSession("c1", "alfa");

    expect(calls()).toEqual([
      { path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1" } },
      { path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1", database: "alfa" } },
    ]);
  });

  it("a lista dos bancos é pedida pela sessão", async () => {
    await getDatabases("s 1");

    expect(calls()).toEqual([{ path: "api/user/database-sessions/s%201/databases", method: undefined, body: undefined }]);
  });

  it("cada banco tem a sessão dele na árvore; a do banco da conexão guarda a chave de sempre, e todas ficam sob a conexão", () => {
    expect(databaseSessionKey("c1")).toEqual(["database-session", "c1"]);
    expect(databaseSessionKey("c1", "alfa")).toEqual(["database-session", "c1", { database: "alfa" }]);
  });

  it("treeSessionIds devolve as sessões da árvore de todos os bancos da conexão, e só dela: é o que Desconectar fecha", () => {
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s-padrao", database: "mes" });
    queryClient.setQueryData(databaseSessionKey("c1", "alfa"), { id: "s-alfa", database: "alfa" });
    queryClient.setQueryData(databaseSessionKey("c2"), { id: "s-outra", database: "mes" });
    queryClient.getQueryCache().build(queryClient, { queryKey: databaseSessionKey("c1", "zeta") });

    expect(treeSessionIds(queryClient, "c1").sort()).toEqual(["s-alfa", "s-padrao"]);
  });
});

describe("as chaves da árvore com os bancos do servidor", () => {
  it("a lista dos bancos é o nível da conexão; o banco da conexão guarda as chaves de sempre; outro banco leva o nome numa marca que nome de esquema não imita", () => {
    expect(treeKey({ type: "connection", connectionId: "c1" })).toEqual(["tree", "c1", "databases"]);
    expect(treeKey({ type: "database", connectionId: "c1" })).toEqual(["tree", "c1", "schemas"]);
    expect(treeKey({ type: "objects", connectionId: "c1", schema: "loja", objects: "tables" })).toEqual(["tree", "c1", "schema", "loja", "objects", "tables"]);
    expect(treeKey({ type: "database", connectionId: "c1", database: "alfa" })).toEqual(["tree", "c1", { database: "alfa" }, "schemas"]);
    expect(treeKey({ type: "tableLevel", connectionId: "c1", database: "alfa", schema: "loja", table: "pedido", level: "columns" })).toEqual(["tree", "c1", { database: "alfa" }, "schema", "loja", "table", "pedido", "columns"]);
  });

  it("'Atualizar' na conexão leva tudo dela (a lista dos bancos de novo); num banco, só o que é dele", () => {
    expect(treePrefixes({ type: "connection", connectionId: "c1" })).toEqual([["tree", "c1"]]);
    expect(treePrefixes({ type: "database", connectionId: "c1" })).toEqual([["tree", "c1", "schemas"], ["tree", "c1", "schema"]]);
    expect(treePrefixes({ type: "database", connectionId: "c1", database: "alfa" })).toEqual([["tree", "c1", { database: "alfa" }]]);
    expect(treePrefixes({ type: "schema", connectionId: "c1", database: "alfa", schema: "loja" })).toEqual([["tree", "c1", { database: "alfa" }, "schema", "loja"]]);
    expect(treePrefixes({ type: "folder", id: "f1" })).toEqual([]);
  });

  it("o nível da conexão busca a lista pela sessão da conexão e devolve os bancos, o dela primeiro", async () => {
    const nodes = await queryClient.fetchQuery(treeQuery({ type: "connection", connectionId: "c1" }, queryClient, true));

    expect(nodes.map((node) => node.label)).toEqual(["mes", "alfa"]);
    expect(nodes[0].key).toBe(navKey({ type: "database", connectionId: "c1" }));
    expect(calls()).toEqual([
      { path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1" } },
      { path: "api/user/database-sessions/sessao-padrao/databases", method: undefined, body: undefined },
    ]);
  });

  it("os esquemas de outro banco abrem a sessão dele e vêm por ela, com o banco na chave de cada um", async () => {
    const nodes = await queryClient.fetchQuery(treeQuery({ type: "database", connectionId: "c1", database: "alfa" }, queryClient, true));

    expect(calls()).toEqual([
      { path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1", database: "alfa" } },
      { path: "api/user/database-sessions/sessao-alfa/schemas", method: undefined, body: undefined },
    ]);
    expect(parseNavKey(nodes[0].key)).toEqual({ type: "schema", connectionId: "c1", database: "alfa", schema: "loja" });
    expect(queryClient.getQueryData(databaseSessionKey("c1", "alfa"))).toEqual({ id: "sessao-alfa", database: "alfa" });
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toBeUndefined();
  });

  it("reabrir a sessão caída de outro banco refaz só a dele e os níveis dele: o banco da conexão e a lista ficam", async () => {
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s-padrao", database: "mes" });
    queryClient.setQueryData(databaseSessionKey("c1", "alfa"), { id: "s-morta", database: "alfa" });
    queryClient.setQueryData(["tree", "c1", "databases"], []);
    queryClient.setQueryData(["tree", "c1", "schemas"], []);
    queryClient.setQueryData(["tree", "c1", { database: "alfa" }, "schemas"], []);
    // O nó do banco está aberto no navegador: o nível dele é observado, e é ele que pede a sessão nova.
    const unsubscribe = new QueryObserver(queryClient, treeQuery({ type: "database", connectionId: "c1", database: "alfa" }, queryClient, true)).subscribe(() => undefined);

    expect(await reopenDatabaseSession(queryClient, "c1", "alfa")).toBe(true);

    expect(queryClient.getQueryData(databaseSessionKey("c1", "alfa"))).toEqual({ id: "sessao-alfa", database: "alfa" });
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "s-padrao", database: "mes" });
    expect(queryClient.getQueryData(["tree", "c1", "databases"])).toEqual([]);
    expect(queryClient.getQueryData(["tree", "c1", "schemas"])).toEqual([]);
    expect(calls().filter((call) => call.method === "POST")).toEqual([{ path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1", database: "alfa" } }]);
    expect(calls().at(-1)?.path).toBe("api/user/database-sessions/sessao-alfa/schemas");
    unsubscribe();
  });
});

describe("loadServerDatabases: a lista dos bancos que a barra do editor pede ao abrir (RN-ARVORE-007)", () => {
  it("abre a sessão da árvore da conexão, como expandir a conexão, e guarda a lista na mesma consulta da árvore", async () => {
    expect(await loadServerDatabases(queryClient, "c1")).toBe("loaded");

    expect(calls()).toEqual([
      { path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1" } },
      { path: "api/user/database-sessions/sessao-padrao/databases", method: undefined, body: undefined },
    ]);
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "sessao-padrao", database: "mes" });
    expect(queryClient.getQueryData<{ label: string }[]>(treeKey({ type: "connection", connectionId: "c1" }))?.map((node) => node.label)).toEqual(["mes", "alfa"]);
  });

  it("com a lista já em cache (a árvore a abriu), não pede nada: ela fica até o 'Atualizar' da conexão (RN-ARVORE-002)", async () => {
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s-padrao", database: "mes" });
    queryClient.setQueryData(treeKey({ type: "connection", connectionId: "c1" }), []);

    expect(await loadServerDatabases(queryClient, "c1")).toBe("loaded");
    expect(calls()).toEqual([]);
  });

  it("a conexão que não abre para ali: a lista não é pedida (a falha vai ao aviso central, uma vez)", async () => {
    api.request.mockImplementation(() => Promise.resolve({ ok: false, error: { code: "DATABASE_CONNECTION_FAILED", title: "Falha", detail: null, errors: null, extensions: {} } }));

    expect(await loadServerDatabases(queryClient, "c1")).toBe("failed");
    expect(calls()).toEqual([{ path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1" } }]);
  });

  it("a sessão da árvore que caiu abre outra no lugar dela e pede a lista de novo, como o 'Tentar de novo' da árvore", async () => {
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s-morta", database: "mes" });
    const lost = { ok: false, error: { code: "DATABASE_SESSION_NOT_FOUND", title: "Sessão não encontrada", detail: null, errors: null, extensions: {} } };
    const answer = api.request.getMockImplementation()!;
    api.request.mockImplementation((path: string, options?: { method?: string }) => (path.includes("s-morta") ? Promise.resolve(lost) : answer(path, options)));

    expect(await loadServerDatabases(queryClient, "c1")).toBe("reopened");

    expect(calls().filter((call) => call.method === "POST")).toEqual([{ path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1" } }]);
    expect(calls().at(-1)?.path).toBe("api/user/database-sessions/sessao-padrao/databases");
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "sessao-padrao", database: "mes" });
  });
});
