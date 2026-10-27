import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorToastFor } from "@/lib/api/query-client";

import {
  databaseSessionKey,
  databaseSessionQuery,
  getObjectNames,
  objectNamesKey,
  objectNamesLimit,
  objectNamesOf,
  objectNamesQuery,
  reopenDatabaseSession,
  searchSessionQuery,
  treeKey,
  treePrefixes,
} from "./database-sessions.service";
import { forgetMissingConnections } from "./workbench-model";
import { dropDataAtLock } from "./workbench-lock";

/** A API trocada: cada pedido responde pelo caminho e pelo método, e o teste lê o que foi pedido. */
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/prism-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/prism-api")>()), apiRequest: api.request }));

type Call = { path: string; method?: string; body?: unknown };
const calls = () => api.request.mock.calls.map(([path, options]): Call => ({ path, method: options?.method, body: options?.body }));

const names = { schemas: [{ name: "vendas", isSystem: false, tables: ["cliente", "pedido"], views: ["v_pedido"] }], truncated: false };
const failure = (code: string, title: string) => ({ ok: false, error: { status: 422, code, title, detail: null, errors: null, extensions: {} } });

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.request.mockReset();
  api.request.mockImplementation((path: string, options?: { method?: string; body?: { database?: string } }) => {
    if (options?.method === "POST") return Promise.resolve({ ok: true, data: { id: `sessao-${options.body?.database ?? "padrao"}`, database: options.body?.database ?? "mes" } });
    if (path.endsWith("/object-names")) return Promise.resolve({ ok: true, data: names });
    return Promise.resolve({ ok: true, data: [] });
  });
});

describe("a rota do índice de nomes (RN-BUSCA-002)", () => {
  it("é pedida pela sessão, com o id codificado, e a resposta passa pelo schema", async () => {
    const result = await getObjectNames("s 1");

    expect(calls()).toEqual([{ path: "api/user/database-sessions/s%201/object-names", method: undefined, body: undefined }]);
    expect(result).toEqual({ ok: true, data: names });
    expect(api.request.mock.calls[0][1].schema).toBeDefined();
  });

  it("o limite é o da API: 50.000 nomes por banco", () => {
    expect(objectNamesLimit).toBe(50_000);
  });
});

describe("a chave do índice, na família da árvore e sem ser nível", () => {
  it("o banco da conexão guarda a chave sem banco; outro banco leva a marca dele, como os níveis (RN-ARVORE-006)", () => {
    expect(objectNamesKey("c1")).toEqual(["tree", "c1", "names"]);
    expect(objectNamesKey("c1", "arquivo")).toEqual(["tree", "c1", { database: "arquivo" }, "names"]);
  });

  it("objectNamesOf é o inverso de objectNamesKey", () => {
    expect(objectNamesOf(objectNamesKey("c1"))).toEqual({ connectionId: "c1" });
    expect(objectNamesOf(objectNamesKey("c1", "arquivo morto"))).toEqual({ connectionId: "c1", database: "arquivo morto" });
  });

  it("chave que não é de índice não vira índice: os níveis, a sessão e o que tem 'names' no meio", () => {
    expect(objectNamesOf(treeKey({ type: "connection", connectionId: "c1" }))).toBeNull();
    expect(objectNamesOf(treeKey({ type: "database", connectionId: "c1" }))).toBeNull();
    expect(objectNamesOf(treeKey({ type: "objects", connectionId: "c1", schema: "names", objects: "tables" }))).toBeNull();
    expect(objectNamesOf(treeKey({ type: "tableLevel", connectionId: "c1", schema: "s", table: "names", level: "columns" }))).toBeNull();
    expect(objectNamesOf(databaseSessionKey("c1"))).toBeNull();
    expect(objectNamesOf(["tree", "c1"])).toBeNull();
    expect(objectNamesOf(["tree", "c1", "x", "names"])).toBeNull();
    expect(objectNamesOf(["tree", "c1", { database: "arquivo" }, "schema", "names"])).toBeNull();
    expect(objectNamesOf(["outra", "c1", "names"])).toBeNull();
    expect(objectNamesOf(["tree", 7, "names"])).toBeNull();
  });
});

describe("a consulta do índice (objectNamesQuery)", () => {
  it("abre a sessão da árvore do banco, se ainda não há, e pede o índice por ela; sem abrir nó nenhum", async () => {
    const result = await queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true));

    expect(result).toEqual(names);
    expect(calls()).toEqual([
      { path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1" } },
      { path: "api/user/database-sessions/sessao-padrao/object-names", method: undefined, body: undefined },
    ]);
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
    expect(queryClient.getQueryData(treeKey({ type: "database", connectionId: "c1" }))).toBeUndefined();
  });

  it("com a sessão já aberta, não abre outra", async () => {
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s-padrao", database: "mes" });

    await queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true));

    expect(calls()).toEqual([{ path: "api/user/database-sessions/s-padrao/object-names", method: undefined, body: undefined }]);
  });

  it("outro banco do servidor usa a sessão dele, e o índice leva a marca dele na chave", async () => {
    await queryClient.fetchQuery(objectNamesQuery("c1", "arquivo", queryClient, true));

    expect(calls()).toEqual([
      { path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1", database: "arquivo" } },
      { path: "api/user/database-sessions/sessao-arquivo/object-names", method: undefined, body: undefined },
    ]);
    expect(queryClient.getQueryData(objectNamesKey("c1", "arquivo"))).toEqual(names);
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toBeUndefined();
  });

  it("fica em memória até o 'Atualizar' (como a árvore), é calada, e só busca quando 'enabled'", () => {
    const options = objectNamesQuery("c1", undefined, queryClient, false);

    expect(options).toMatchObject({ staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false, retryOnMount: false, enabled: false, meta: { silent: true } });
    expect(objectNamesQuery("c1", undefined, queryClient, true).enabled).toBe(true);
  });

  it("a falha da consulta não vira aviso central (a linha da busca a mostra); a mensagem do banco chega como veio", async () => {
    api.request.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === "POST") return Promise.resolve({ ok: true, data: { id: "s", database: "mes" } });
      return Promise.resolve(failure("SQL_EXECUTION_FAILED", "permission denied for table pg_class"));
    });
    const options = objectNamesQuery("c1", undefined, queryClient, true);

    await expect(queryClient.fetchQuery(options)).rejects.toMatchObject({ error: { code: "SQL_EXECUTION_FAILED", title: "permission denied for table pg_class" } });
    expect(errorToastFor(new Error("x"), options.meta)).toBeNull();
  });

  it("a falha de abrir a sessão também fica na linha: a sessão da busca é calada", async () => {
    api.request.mockImplementation(() => Promise.resolve(failure("DATABASE_CONNECTION_FAILED", "connection refused")));
    const notified: unknown[] = [];
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") notified.push(event.query.meta);
    });

    await expect(queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true))).rejects.toMatchObject({ error: { code: "DATABASE_CONNECTION_FAILED" } });

    expect(calls()).toEqual([{ path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1" } }]);
    expect(notified).toEqual([{ silent: true }, { silent: true }]);
    expect(queryClient.getQueryState(databaseSessionKey("c1"))?.status).toBe("error");
  });

  it("a sessão da busca é a mesma consulta da sessão da árvore (a mesma chave), só calada", () => {
    expect(searchSessionQuery("c1").queryKey).toEqual(databaseSessionKey("c1"));
    expect(searchSessionQuery("c1", "arquivo").queryKey).toEqual(databaseSessionKey("c1", "arquivo"));
    expect(searchSessionQuery("c1")).toMatchObject({ staleTime: Infinity, gcTime: Infinity, meta: { silent: true } });
  });
});

describe("o índice acompanha a árvore: 'Atualizar', sessão reaberta, 'Desconectar', conexão que some e bloqueio", () => {
  it("'Atualizar' em qualquer nó de um banco invalida o índice dele; na conexão e em outro banco, o prefixo de cima já o cobre", () => {
    expect(treePrefixes({ type: "connection", connectionId: "c1" })).toEqual([["tree", "c1"]]);
    expect(treePrefixes({ type: "database", connectionId: "c1" })).toEqual([["tree", "c1", "schemas"], ["tree", "c1", "schema"], ["tree", "c1", "names"]]);
    expect(treePrefixes({ type: "database", connectionId: "c1", database: "alfa" })).toEqual([["tree", "c1", { database: "alfa" }]]);
    expect(treePrefixes({ type: "schema", connectionId: "c1", schema: "loja" })).toEqual([["tree", "c1", "schema", "loja"], ["tree", "c1", "names"]]);
    expect(treePrefixes({ type: "table", connectionId: "c1", database: "alfa", schema: "loja", table: "pedido" })).toEqual([["tree", "c1", { database: "alfa" }, "schema", "loja", "table", "pedido"], ["tree", "c1", { database: "alfa" }, "names"]]);
    expect(treePrefixes({ type: "objects", connectionId: "c1", schema: "loja", objects: "tables" })).toEqual([["tree", "c1", "schema", "loja", "objects", "tables"], ["tree", "c1", "names"]]);
    expect(treePrefixes({ type: "tableLevel", connectionId: "c1", database: "alfa", schema: "loja", table: "pedido", level: "columns" })).toEqual([
      ["tree", "c1", { database: "alfa" }, "schema", "loja", "table", "pedido", "columns"],
      ["tree", "c1", { database: "alfa" }, "names"],
    ]);
  });

  it("os prefixos do 'Atualizar' de um nó alcançam o índice do banco dele, e só o dele", () => {
    queryClient.setQueryData(objectNamesKey("c1"), names);
    queryClient.setQueryData(objectNamesKey("c1", "alfa"), names);
    queryClient.setQueryData(objectNamesKey("c2"), names);
    const reached = (path: Parameters<typeof treePrefixes>[0]) =>
      treePrefixes(path)
        .flatMap((queryKey) => queryClient.getQueryCache().findAll({ queryKey }))
        .map((query) => query.queryKey)
        .filter((queryKey) => objectNamesOf(queryKey) !== null);

    expect(reached({ type: "schema", connectionId: "c1", schema: "loja" })).toEqual([objectNamesKey("c1")]);
    expect(reached({ type: "schema", connectionId: "c1", database: "alfa", schema: "loja" })).toEqual([objectNamesKey("c1", "alfa")]);
    expect(reached({ type: "database", connectionId: "c1", database: "alfa" })).toEqual([objectNamesKey("c1", "alfa")]);
    expect(reached({ type: "connection", connectionId: "c1" })).toEqual([objectNamesKey("c1"), objectNamesKey("c1", "alfa")]);
  });

  it("invalidar o índice o faz velho: a próxima busca o pede de novo", async () => {
    await queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true));
    api.request.mockClear();

    for (const queryKey of treePrefixes({ type: "schema", connectionId: "c1", schema: "vendas" })) await queryClient.invalidateQueries({ queryKey });
    const unsubscribe = new QueryObserver(queryClient, objectNamesQuery("c1", undefined, queryClient, true)).subscribe(() => undefined);
    await vi.waitFor(() => expect(calls().map((call) => call.path)).toEqual(["api/user/database-sessions/sessao-padrao/object-names"]));
    unsubscribe();
  });

  it("a sessão reaberta recomeça o índice do banco dela e deixa o dos outros bancos", async () => {
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "s-morta", database: "mes" });
    queryClient.setQueryData(databaseSessionKey("c1", "alfa"), { id: "s-alfa", database: "alfa" });
    queryClient.setQueryData(objectNamesKey("c1"), names);
    queryClient.setQueryData(objectNamesKey("c1", "alfa"), names);
    // O nó da conexão está aberto no navegador: é o observador da sessão que a abre de novo.
    const unsubscribe = new QueryObserver(queryClient, databaseSessionQuery("c1")).subscribe(() => undefined);

    expect(await reopenDatabaseSession(queryClient, "c1")).toBe(true);

    expect(queryClient.getQueryData(objectNamesKey("c1"))).toBeUndefined();
    expect(queryClient.getQueryData(objectNamesKey("c1", "alfa"))).toEqual(names);
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "sessao-padrao", database: "mes" });
    expect(queryClient.getQueryData(databaseSessionKey("c1", "alfa"))).toEqual({ id: "s-alfa", database: "alfa" });
    unsubscribe();
  });

  it("a sessão reaberta de outro banco recomeça o índice dele, e só ele", async () => {
    queryClient.setQueryData(databaseSessionKey("c1", "alfa"), { id: "s-morta", database: "alfa" });
    queryClient.setQueryData(objectNamesKey("c1"), names);
    queryClient.setQueryData(objectNamesKey("c1", "alfa"), names);
    const unsubscribe = new QueryObserver(queryClient, databaseSessionQuery("c1", "alfa")).subscribe(() => undefined);

    expect(await reopenDatabaseSession(queryClient, "c1", "alfa")).toBe(true);

    expect(queryClient.getQueryData(objectNamesKey("c1", "alfa"))).toBeUndefined();
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
    unsubscribe();
  });

  it("o 'Desconectar' (remove a família da conexão) leva o índice dos bancos dela, e deixa o de outra conexão", () => {
    queryClient.setQueryData(objectNamesKey("c1"), names);
    queryClient.setQueryData(objectNamesKey("c1", "alfa"), names);
    queryClient.setQueryData(objectNamesKey("c2"), names);

    queryClient.removeQueries({ queryKey: ["tree", "c1"] });

    expect(queryClient.getQueryData(objectNamesKey("c1"))).toBeUndefined();
    expect(queryClient.getQueryData(objectNamesKey("c1", "alfa"))).toBeUndefined();
    expect(queryClient.getQueryData(objectNamesKey("c2"))).toEqual(names);
  });

  it("a conexão que some da lista leva o índice dela", () => {
    queryClient.setQueryData(objectNamesKey("c1"), names);
    queryClient.setQueryData(objectNamesKey("c2"), names);

    forgetMissingConnections(queryClient, new Set(["c2"]));

    expect(queryClient.getQueryData(objectNamesKey("c1"))).toBeUndefined();
    expect(queryClient.getQueryData(objectNamesKey("c2"))).toEqual(names);
  });

  it("o bloqueio leva o índice: o cofre fechado não deixa nome de tabela na memória", () => {
    queryClient.setQueryData(objectNamesKey("c1"), names);
    queryClient.setQueryData(objectNamesKey("c1", "alfa"), names);

    dropDataAtLock(queryClient);

    expect(queryClient.getQueryData(objectNamesKey("c1"))).toBeUndefined();
    expect(queryClient.getQueryData(objectNamesKey("c1", "alfa"))).toBeUndefined();
  });
});
