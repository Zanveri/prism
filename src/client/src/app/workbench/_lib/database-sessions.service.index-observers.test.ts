import { QueriesObserver, QueryClient, type QueryObserverOptions } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { databaseSessionKey, objectNamesKey, objectNamesQuery, reopenDatabaseSession, treePrefixes } from "./database-sessions.service";

// Os observadores do índice como o `useQueries` do navegador os usa, mas com o `QueriesObserver` de verdade e a API trocada: o que se confere é o COMPORTAMENTO da
// biblioteca de consultas que a busca (RN-BUSCA-002) pressupõe: pedir uma vez por banco, só com texto, não repetir, refazer só no "Atualizar" e na sessão reaberta,
// e não pedir nada de uma conexão que saiu do escopo.
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/prism-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/prism-api")>()), apiRequest: api.request }));

const names = { schemas: [{ name: "vendas", isSystem: false, tables: ["cliente", "pedido"], views: ["v_pedido"] }], truncated: false };
const failure = (code: string, title: string) => ({ ok: false, error: { status: code === "DATABASE_SESSION_NOT_FOUND" ? 404 : 422, code, title, detail: null, errors: null, extensions: {} } });

type Call = { path: string; method?: string; body?: { connectionID: string; database?: string } };
const calls = () => api.request.mock.calls.map(([path, options]): Call => ({ path, method: options?.method, body: options?.body }));
const posts = () => calls().filter((call) => call.method === "POST");
const nameRequests = () => calls().filter((call) => call.path.endsWith("/object-names"));

let queryClient: QueryClient;
let observer: QueriesObserver | null;
let opened: number;
let deadSessions: Set<string>;

/** Os observadores dos índices de uns bancos, como o navegador os monta: `[conexão, outro banco?]`, habilitados quando há texto. */
const watch = (databases: [string, string?][], searching: boolean) => {
  // O `useQueries` do React aceita a consulta tipada; o observador do núcleo pede as opções soltas.
  const queries = databases.map(([connectionId, database]) => objectNamesQuery(connectionId, database, queryClient, searching)) as unknown as QueryObserverOptions[];
  if (observer === null) {
    observer = new QueriesObserver(queryClient, queries);
    observer.subscribe(() => undefined);
  }
  observer.setQueries(queries);
};
const settle = () => vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  observer = null;
  opened = 0;
  deadSessions = new Set();
  api.request.mockReset();
  api.request.mockImplementation((path: string, options?: { method?: string; body?: { connectionID: string; database?: string } }) => {
    if (options?.method === "POST") return Promise.resolve({ ok: true, data: { id: `s${++opened}`, database: options.body?.database ?? "loja" } });
    if (path.endsWith("/object-names")) return Promise.resolve(deadSessions.has(path.split("/")[3]) ? failure("DATABASE_SESSION_NOT_FOUND", "Sessão não encontrada.") : { ok: true, data: names });
    return Promise.resolve({ ok: true, data: [] });
  });
});

afterEach(() => {
  observer?.destroy();
});

describe("o índice é pedido quando há texto, uma vez por banco", () => {
  it("com o campo vazio os observadores existem, mas não pedem nada: nem sessão, nem índice", async () => {
    watch([["c1"], ["c2"]], false);
    await settle();

    expect(api.request).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toBeUndefined();
  });

  it("com texto, cada banco pede o seu índice (a sessão da árvore abre se faltar), e a renderização seguinte, ou a próxima tecla, não pede de novo", async () => {
    watch([["c1"], ["c2"]], true);
    await settle();

    expect(posts().map((call) => call.body)).toEqual([{ connectionID: "c1" }, { connectionID: "c2" }]);
    expect(nameRequests()).toHaveLength(2);
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
    expect(queryClient.getQueryData(objectNamesKey("c2"))).toEqual(names);

    api.request.mockClear();
    for (let key = 0; key < 5; key++) watch([["c1"], ["c2"]], true);
    await settle();
    expect(api.request).not.toHaveBeenCalled();
  });

  it("limpar o campo e escrever de novo não volta à API: o índice fica em memória até o 'Atualizar'", async () => {
    watch([["c1"]], true);
    await settle();
    api.request.mockClear();

    watch([["c1"]], false);
    watch([["c1"]], true);
    await settle();

    expect(api.request).not.toHaveBeenCalled();
  });

  it("outro banco do servidor usa a sessão dele, e o banco da conexão não é pedido pelo dele", async () => {
    watch([["c1", "arquivo"]], true);
    await settle();

    expect(posts().map((call) => call.body)).toEqual([{ connectionID: "c1", database: "arquivo" }]);
    expect(queryClient.getQueryData(objectNamesKey("c1", "arquivo"))).toEqual(names);
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toBeUndefined();
  });

  it("o banco que entra no escopo durante a busca é pedido sozinho, e os que já estavam não", async () => {
    watch([["c1"]], true);
    await settle();
    api.request.mockClear();

    watch([["c1"], ["c2"]], true);
    await settle();

    expect(posts().map((call) => call.body)).toEqual([{ connectionID: "c2" }]);
    expect(nameRequests()).toHaveLength(1);
  });

  it("a conexão que sai do escopo (filtro trocado) não é pedida de novo, e o índice dela fica no cache para quando voltar", async () => {
    watch([["c1"], ["c2"]], true);
    await settle();
    api.request.mockClear();

    watch([["c1"]], true);
    watch([["c1"], ["c2"]], true);
    await settle();

    expect(api.request).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(objectNamesKey("c2"))).toEqual(names);
  });
});

describe("a falha de um índice", () => {
  it("fica na consulta com a mensagem do banco, não derruba o dos outros bancos e não é repetida a cada tecla", async () => {
    api.request.mockImplementation((path: string, options?: { method?: string; body?: { connectionID: string } }) => {
      if (options?.method === "POST") return Promise.resolve({ ok: true, data: { id: `s-${options.body?.connectionID}`, database: "loja" } });
      return Promise.resolve(path.includes("s-c2") ? failure("SQL_EXECUTION_FAILED", "permission denied for table pg_class") : { ok: true, data: names });
    });
    watch([["c1"], ["c2"], ["c3"]], true);
    await settle();

    expect(queryClient.getQueryState(objectNamesKey("c2"))?.status).toBe("error");
    expect(queryClient.getQueryState(objectNamesKey("c2"))?.error).toMatchObject({ error: { code: "SQL_EXECUTION_FAILED", title: "permission denied for table pg_class" } });
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
    expect(queryClient.getQueryData(objectNamesKey("c3"))).toEqual(names);

    api.request.mockClear();
    for (let key = 0; key < 5; key++) watch([["c1"], ["c2"], ["c3"]], true);
    await settle();
    expect(api.request).not.toHaveBeenCalled();
  });

  it("o 'Tentar de novo' (refetchQueries exato) pede só o índice dele, pela sessão que já tem", async () => {
    let failing = true;
    api.request.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === "POST") return Promise.resolve({ ok: true, data: { id: `s${++opened}`, database: "loja" } });
      return Promise.resolve(failing ? failure("SQL_EXECUTION_FAILED", "canceling statement due to statement timeout") : { ok: true, data: names });
    });
    watch([["c1"], ["c2"]], true);
    await settle();
    expect(queryClient.getQueryState(objectNamesKey("c1"))?.status).toBe("error");
    api.request.mockClear();
    failing = false;

    await queryClient.refetchQueries({ queryKey: objectNamesKey("c1"), exact: true });

    expect(posts()).toEqual([]);
    expect(nameRequests()).toHaveLength(1);
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
  });

  it("apagar o texto e escrever de novo busca de novo o índice que falhou (e só ele): a falha não gruda", async () => {
    let failing = true;
    api.request.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === "POST") return Promise.resolve({ ok: true, data: { id: `s${++opened}`, database: "loja" } });
      return Promise.resolve(failing ? failure("SQL_EXECUTION_FAILED", "timeout") : { ok: true, data: names });
    });
    watch([["c1"]], true);
    await settle();
    expect(queryClient.getQueryState(objectNamesKey("c1"))?.status).toBe("error");
    failing = false;
    api.request.mockClear();

    watch([["c1"]], false);
    watch([["c1"]], true);
    await settle();

    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
    expect(posts()).toEqual([]);
  });

  it("a sessão que caiu: reabri-la (como a árvore faz) recomeça o índice daquele banco e o refaz, pela sessão nova, sem tocar nos outros bancos", async () => {
    watch([["c1"], ["c1", "arquivo"]], true);
    await settle();
    // A API esqueceu a sessão do banco da conexão: o "Atualizar" seguinte do índice, com a busca em andamento, responde 404.
    deadSessions.add("s1");
    await queryClient.invalidateQueries({ queryKey: objectNamesKey("c1"), exact: true });
    await settle();
    expect(queryClient.getQueryState(objectNamesKey("c1"))?.error).toMatchObject({ error: { code: "DATABASE_SESSION_NOT_FOUND" } });
    api.request.mockClear();

    expect(await reopenDatabaseSession(queryClient, "c1")).toBe(true);
    await settle();

    expect(posts().map((call) => call.body)).toEqual([{ connectionID: "c1" }]);
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toMatchObject({ id: "s3" });
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
    expect(nameRequests().map((call) => call.path)).toEqual(["api/user/database-sessions/s3/object-names"]);
    expect(queryClient.getQueryData(databaseSessionKey("c1", "arquivo"))).toMatchObject({ id: "s2" });
  });
});

describe("o 'Atualizar' e a conexão que sai", () => {
  it("o 'Atualizar' de um nó do banco, com a busca em andamento, pede o índice de novo; sem texto, só deixa velho até a próxima busca", async () => {
    watch([["c1"]], true);
    await settle();
    api.request.mockClear();

    for (const queryKey of treePrefixes({ type: "schema", connectionId: "c1", schema: "vendas" })) await queryClient.invalidateQueries({ queryKey });
    await settle();
    expect(nameRequests()).toHaveLength(1);

    watch([["c1"]], false);
    api.request.mockClear();
    for (const queryKey of treePrefixes({ type: "schema", connectionId: "c1", schema: "vendas" })) await queryClient.invalidateQueries({ queryKey });
    await settle();
    expect(api.request).not.toHaveBeenCalled();

    watch([["c1"]], true);
    await settle();
    expect(nameRequests()).toHaveLength(1);
  });

  it("o 'Atualizar' em outro banco não refaz o índice do banco da conexão", async () => {
    watch([["c1"], ["c1", "arquivo"]], true);
    await settle();
    api.request.mockClear();

    for (const queryKey of treePrefixes({ type: "database", connectionId: "c1", database: "arquivo" })) await queryClient.invalidateQueries({ queryKey });
    await settle();

    expect(nameRequests().map((call) => call.path)).toEqual(["api/user/database-sessions/s2/object-names"]);
  });

  it("o 'Desconectar' no meio da busca: com a conexão fora do escopo na renderização seguinte, nada é pedido e nenhuma sessão abre", async () => {
    watch([["c1"], ["c2"]], true);
    await settle();
    api.request.mockClear();

    // O que o provedor faz (e, na tela, a lista de bancos do escopo já sem a conexão na MESMA renderização).
    queryClient.removeQueries({ queryKey: databaseSessionKey("c2") });
    queryClient.removeQueries({ queryKey: ["tree", "c2"] });
    watch([["c1"]], true);
    await settle();

    expect(api.request).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(objectNamesKey("c2"))).toBeUndefined();
    expect(queryClient.getQueryData(databaseSessionKey("c2"))).toBeUndefined();
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
  });
});
