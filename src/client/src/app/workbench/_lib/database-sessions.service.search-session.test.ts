import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { databaseSessionKey, databaseSessionQuery, objectNamesKey, openSessionForSearch, treeKey } from "./database-sessions.service";

// "Buscar nelas também" (RN-BUSCA-002): abrir a sessão da árvore de uma conexão de fora, sem abrir o nó. A API é trocada; o cache é o de verdade.
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/prism-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/prism-api")>()), apiRequest: api.request }));

type Call = { path: string; method?: string; body?: unknown };
const calls = () => api.request.mock.calls.map(([path, options]): Call => ({ path, method: options?.method, body: options?.body }));
const posts = () => calls().filter((call) => call.method === "POST");
const failure = (code: string, title: string) => ({ ok: false, error: { status: 422, code, title, detail: null, errors: null, extensions: {} } });

let queryClient: QueryClient;
let opened = 0;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  opened = 0;
  api.request.mockReset();
  api.request.mockImplementation((_path: string, options?: { method?: string }) =>
    options?.method === "POST" ? Promise.resolve({ ok: true, data: { id: `sessao-${++opened}`, database: "loja" } }) : Promise.resolve({ ok: true, data: [] }),
  );
});

describe("openSessionForSearch", () => {
  it("abre a sessão da árvore do banco da conexão, devolve que abriu, e não abre nó nem pede nível nenhum", async () => {
    expect(await openSessionForSearch(queryClient, "c1")).toBe(true);

    expect(calls()).toEqual([{ path: "api/user/database-sessions", method: "POST", body: { connectionID: "c1" } }]);
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "sessao-1", database: "loja" });
    expect(queryClient.getQueryCache().findAll({ queryKey: ["tree"] })).toEqual([]);
  });

  it("duas chamadas ao mesmo tempo abrem UMA sessão (o clique repetido não deixa sessão órfã na API)", async () => {
    const results = await Promise.all([openSessionForSearch(queryClient, "c1"), openSessionForSearch(queryClient, "c1")]);

    expect(results).toEqual([true, true]);
    expect(posts()).toHaveLength(1);
  });

  it("várias conexões de uma vez: uma sessão para cada, e nenhuma para as que ninguém pediu", async () => {
    await Promise.all(["c1", "c2", "c3"].map((id) => openSessionForSearch(queryClient, id)));

    expect(posts().map((call) => call.body)).toEqual([{ connectionID: "c1" }, { connectionID: "c2" }, { connectionID: "c3" }]);
  });

  it("a falha de abrir NÃO é lançada: devolve que não abriu, e a mensagem do banco fica na consulta, de onde a linha de estado a lê", async () => {
    api.request.mockImplementation(() => Promise.resolve(failure("DATABASE_CONNECTION_FAILED", "FATAL: password authentication failed")));

    expect(await openSessionForSearch(queryClient, "c1")).toBe(false);

    const state = queryClient.getQueryState(databaseSessionKey("c1"));
    expect(state?.status).toBe("error");
    expect(state?.error).toMatchObject({ error: { code: "DATABASE_CONNECTION_FAILED", title: "FATAL: password authentication failed" } });
    expect(state?.data).toBeUndefined();
  });

  it("depois da falha, o 'Tentar de novo' abre de verdade (a consulta com erro e sem dado busca de novo)", async () => {
    api.request.mockImplementationOnce(() => Promise.resolve(failure("DATABASE_CONNECTION_FAILED", "connection refused")));

    expect(await openSessionForSearch(queryClient, "c1")).toBe(false);
    expect(await openSessionForSearch(queryClient, "c1")).toBe(true);

    expect(posts()).toHaveLength(2);
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "sessao-1", database: "loja" });
    expect(queryClient.getQueryState(databaseSessionKey("c1"))?.status).toBe("success");
  });

  it("a conexão de fora que ainda guarda a sessão (a que a verificação achou sem sessão na API) abre uma sessão NOVA no lugar da morta", async () => {
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "sessao-morta", database: "loja" });

    expect(await openSessionForSearch(queryClient, "c1")).toBe(true);

    expect(posts()).toHaveLength(1);
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "sessao-1", database: "loja" });
  });

  it("a abertura forçada que falha deixa a consulta em erro, com a mensagem do banco: a conexão continua sem sessão que valha", async () => {
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "sessao-morta", database: "loja" });
    api.request.mockImplementationOnce(() => Promise.resolve(failure("DATABASE_CONNECTION_FAILED", "host unreachable")));

    expect(await openSessionForSearch(queryClient, "c1")).toBe(false);
    expect(queryClient.getQueryState(databaseSessionKey("c1"))?.status).toBe("error");
    expect(queryClient.getQueryState(databaseSessionKey("c1"))?.error).toMatchObject({ error: { title: "host unreachable" } });
  });

  it("não toca no índice nem nos níveis da árvore que o cache já tinha, nem nas sessões dos outros bancos do servidor", async () => {
    queryClient.setQueryData(objectNamesKey("c1"), { schemas: [], truncated: false });
    queryClient.setQueryData(treeKey({ type: "connection", connectionId: "c1" }), []);
    queryClient.setQueryData(databaseSessionKey("c1", "arquivo"), { id: "sessao-arquivo", database: "arquivo" });

    await openSessionForSearch(queryClient, "c1");

    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual({ schemas: [], truncated: false });
    expect(queryClient.getQueryData(treeKey({ type: "connection", connectionId: "c1" }))).toEqual([]);
    expect(queryClient.getQueryData(databaseSessionKey("c1", "arquivo"))).toEqual({ id: "sessao-arquivo", database: "arquivo" });
  });

  it("é a mesma consulta da sessão da árvore: o nó que se abre depois usa a sessão que a busca abriu, sem abrir outra", async () => {
    await openSessionForSearch(queryClient, "c1");
    const unsubscribe = new QueryObserver(queryClient, databaseSessionQuery("c1")).subscribe(() => undefined);

    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "sessao-1", database: "loja" });
    expect(posts()).toHaveLength(1);
    unsubscribe();
  });
});
