import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { databaseSessionKey, databaseSessionQuery, isSessionLost, objectNamesKey, objectNamesQuery, reopenDatabaseSession, searchSessionQuery, treePrefixes } from "./database-sessions.service";
import { cachedTree } from "./navigator-search";

/** A API trocada: cada pedido responde pelo caminho e pelo método, e o teste lê o que foi pedido (como em `database-sessions.service.names.test.ts`). */
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/prism-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/prism-api")>()), apiRequest: api.request }));

type Call = { path: string; method?: string; body?: { database?: string } };
const calls = (): Call[] => api.request.mock.calls.map(([path, options]) => ({ path, method: options?.method, body: options?.body }));
const posts = () => calls().filter((call) => call.method === "POST");
const nameRequests = () => calls().filter((call) => call.path.endsWith("/object-names"));

const names = { schemas: [{ name: "vendas", isSystem: false, tables: ["cliente"], views: [] }], truncated: false };
const failure = (status: number, code: string, title: string) => ({ ok: false, error: { status, code, title, detail: null, errors: null, extensions: {} } });
const succeeded = (data: unknown) => ({ ok: true, data });

let queryClient: QueryClient;
let opened: number;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  opened = 0;
  api.request.mockReset();
  // Cada sessão aberta tem um número (`sessao-1`, `sessao-2`…), e o índice só responde pela viva.
  api.request.mockImplementation((path: string, options?: { method?: string; body?: { database?: string } }) => {
    if (options?.method === "POST") return Promise.resolve(succeeded({ id: `sessao-${++opened}`, database: options.body?.database ?? "mes" }));
    if (path.endsWith("/object-names")) return Promise.resolve(succeeded(names));
    return Promise.resolve(succeeded([]));
  });
});

type Observed = { getCurrentResult(): { isSuccess: boolean; isError: boolean; error: unknown } };

/** Espera o observador chegar a um estado, sem depender de quanto tempo as consultas levam. */
const until = (observer: Observed, done: (result: ReturnType<Observed["getCurrentResult"]>) => boolean) => vi.waitFor(() => expect(done(observer.getCurrentResult())).toBe(true));

describe("o índice pede a sessão sem abrir duas (RN-BUSCA-002)", () => {
  it("a árvore e a busca pedindo a sessão do mesmo banco ao mesmo tempo abrem UMA só", async () => {
    await Promise.all([queryClient.fetchQuery(databaseSessionQuery("c1")), queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true)), queryClient.fetchQuery(searchSessionQuery("c1"))]);

    expect(posts()).toHaveLength(1);
    expect(nameRequests()).toEqual([expect.objectContaining({ path: "api/user/database-sessions/sessao-1/object-names" })]);
  });

  it("o mesmo índice pedido três vezes ao mesmo tempo vai à API uma vez", async () => {
    const results = await Promise.all([1, 2, 3].map(() => queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true))));

    expect(results).toEqual([names, names, names]);
    expect(posts()).toHaveLength(1);
    expect(nameRequests()).toHaveLength(1);
  });

  it("dois bancos da mesma conexão, ao mesmo tempo: duas sessões, cada índice pela sua", async () => {
    await Promise.all([queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true)), queryClient.fetchQuery(objectNamesQuery("c1", "arquivo", queryClient, true))]);

    expect(posts().map((call) => call.body?.database ?? "padrão").sort()).toEqual(["arquivo", "padrão"]);
    expect(nameRequests()).toHaveLength(2);
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
    expect(queryClient.getQueryData(objectNamesKey("c1", "arquivo"))).toEqual(names);
  });

  it("a conexão que já tem a sessão da árvore aberta ('Buscar nelas também' em quem já estava conectada) não abre outra", async () => {
    queryClient.setQueryData(databaseSessionKey("c1"), { id: "aberta", database: "mes" });

    await queryClient.fetchQuery(searchSessionQuery("c1"));

    expect(posts()).toHaveLength(0);
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "aberta", database: "mes" });
  });

  it("'Buscar nelas também' numa conexão que não abre: rejeita, sem aviso central, e a mensagem do banco está no erro para a linha de estado", async () => {
    api.request.mockImplementation(() => Promise.resolve(failure(422, "DATABASE_CONNECTION_FAILED", "FATAL: password authentication failed for user \"u\"")));
    const metas: unknown[] = [];
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") metas.push(event.query.meta);
    });

    await expect(queryClient.fetchQuery(searchSessionQuery("c1"))).rejects.toMatchObject({ error: { code: "DATABASE_CONNECTION_FAILED", title: 'FATAL: password authentication failed for user "u"' } });

    expect(metas).toEqual([{ silent: true }]);
  });
});

describe("depois de responder, a busca não volta à API até o 'Atualizar' (RN-BUSCA-002)", () => {
  it("limpar o campo e digitar de novo, ou outra montagem, não pedem o índice outra vez", async () => {
    const observer = new QueryObserver(queryClient, objectNamesQuery("c1", undefined, queryClient, true));
    const unsubscribe = observer.subscribe(() => undefined);
    await until(observer, (result) => result.isSuccess);
    expect(nameRequests()).toHaveLength(1);

    // O campo é limpo (enabled passa a falso) e a pessoa volta a digitar (enabled verdadeiro), e uma segunda montagem observa a mesma consulta.
    observer.setOptions(objectNamesQuery("c1", undefined, queryClient, false));
    observer.setOptions(objectNamesQuery("c1", undefined, queryClient, true));
    const second = new QueryObserver(queryClient, objectNamesQuery("c1", undefined, queryClient, true));
    const unsubscribeSecond = second.subscribe(() => undefined);
    await until(second, (result) => result.isSuccess);

    expect(nameRequests()).toHaveLength(1);
    expect(posts()).toHaveLength(1);
    unsubscribe();
    unsubscribeSecond();
  });

  it("sem texto na busca (enabled falso) nada vai à API, e com o índice já em memória o observador o devolve sem pedir", async () => {
    const idle = new QueryObserver(queryClient, objectNamesQuery("c1", undefined, queryClient, false));
    const unsubscribeIdle = idle.subscribe(() => undefined);
    await Promise.resolve();
    expect(calls()).toEqual([]);
    unsubscribeIdle();

    queryClient.setQueryData(objectNamesKey("c1"), names);
    const warm = new QueryObserver(queryClient, objectNamesQuery("c1", undefined, queryClient, false));
    expect(warm.getCurrentResult().data).toEqual(names);
    expect(calls()).toEqual([]);
  });

  it("o 'Atualizar' o faz velho e, com a busca ligada, ele é pedido de novo pela MESMA sessão (a sessão não é refeita)", async () => {
    const observer = new QueryObserver(queryClient, objectNamesQuery("c1", undefined, queryClient, true));
    const unsubscribe = observer.subscribe(() => undefined);
    await until(observer, (result) => result.isSuccess);

    for (const queryKey of treePrefixes({ type: "objects", connectionId: "c1", schema: "vendas", objects: "tables" })) await queryClient.invalidateQueries({ queryKey, predicate: (query) => query.queryKey.includes("names") });
    await vi.waitFor(() => expect(nameRequests()).toHaveLength(2));

    expect(posts()).toHaveLength(1);
    expect(nameRequests().map((call) => call.path)).toEqual(Array(2).fill("api/user/database-sessions/sessao-1/object-names"));
    unsubscribe();
  });
});

describe("a falha do índice não apaga o que já se sabia, e a sessão que caiu reabre pela busca", () => {
  it("o 'Atualizar' que falha deixa o índice velho no cache da busca (a lista não some de repente) e o erro na consulta", async () => {
    const observer = new QueryObserver(queryClient, objectNamesQuery("c1", undefined, queryClient, true));
    const unsubscribe = observer.subscribe(() => undefined);
    await until(observer, (result) => result.isSuccess);

    api.request.mockImplementation((_path: string, options?: { method?: string }) => Promise.resolve(options?.method === "POST" ? succeeded({ id: "x", database: "mes" }) : failure(422, "SQL_EXECUTION_FAILED", "permission denied for relation pg_class")));
    await queryClient.invalidateQueries({ queryKey: objectNamesKey("c1") });
    await until(observer, (result) => result.isError);

    expect(cachedTree(queryClient).indexes.map((entry) => entry.names)).toEqual([names]);
    expect(queryClient.getQueryState(objectNamesKey("c1"))?.error).toMatchObject({ error: { code: "SQL_EXECUTION_FAILED", title: "permission denied for relation pg_class" } });
    unsubscribe();
  });

  it("a sessão que a API já não conhece: o índice falha como 'sessão perdida', o 'Atualizar' do banco o acha e a reabertura pede o índice pela sessão NOVA", async () => {
    api.request.mockImplementation((path: string, options?: { method?: string; body?: { database?: string } }) => {
      if (options?.method === "POST") return Promise.resolve(succeeded({ id: `sessao-${++opened}`, database: "mes" }));
      // Só a primeira sessão caiu: a segunda, aberta no lugar dela, responde.
      return Promise.resolve(path.includes("/sessao-1/") ? failure(404, "DATABASE_SESSION_NOT_FOUND", "Sessão não encontrada.") : succeeded(names));
    });

    // Só a busca observa (a árvore nem abriu o nó): a sessão existe porque o índice a pediu.
    const observer = new QueryObserver(queryClient, objectNamesQuery("c1", undefined, queryClient, true));
    const unsubscribe = observer.subscribe(() => undefined);
    await until(observer, (result) => result.isError);

    expect(isSessionLost(observer.getCurrentResult().error)).toBe(true);
    // O que o "Atualizar" de um esquema faz para saber que a sessão caiu (`lostSessionsUnder`): lê o erro das consultas sob os prefixos dele, o do índice entre elas.
    const lost = treePrefixes({ type: "schema", connectionId: "c1", schema: "vendas" }).flatMap((queryKey) => queryClient.getQueryCache().findAll({ queryKey }).filter((query) => isSessionLost(query.state.error)));
    expect(lost.map((query) => query.queryKey)).toEqual([objectNamesKey("c1")]);

    expect(await reopenDatabaseSession(queryClient, "c1")).toBe(true);

    await until(observer, (result) => result.isSuccess);
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toEqual(names);
    expect(queryClient.getQueryData(databaseSessionKey("c1"))).toEqual({ id: "sessao-2", database: "mes" });
    expect(nameRequests().map((call) => call.path)).toEqual(["api/user/database-sessions/sessao-1/object-names", "api/user/database-sessions/sessao-2/object-names"]);
    unsubscribe();
  });

  it("o erro de um banco não toca nos índices dos outros: cada banco falha e se recupera sozinho", async () => {
    api.request.mockImplementation((path: string, options?: { method?: string; body?: { database?: string } }) => {
      if (options?.method === "POST") return Promise.resolve(succeeded({ id: `sessao-${options.body?.database ?? "padrao"}`, database: options.body?.database ?? "mes" }));
      return Promise.resolve(path.includes("sessao-arquivo") ? failure(422, "SQL_EXECUTION_FAILED", "arquivo fora do ar") : succeeded(names));
    });

    const results = await Promise.allSettled([queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true)), queryClient.fetchQuery(objectNamesQuery("c1", "arquivo", queryClient, true))]);

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(cachedTree(queryClient).indexes.map((entry) => entry.database)).toEqual([undefined]);
    expect(queryClient.getQueryState(objectNamesKey("c1", "arquivo"))?.status).toBe("error");
  });
});

describe("o 'Desconectar' e o bloqueio com o índice a caminho", () => {
  it("a conexão removida enquanto a sessão ainda abre: o índice não chega a pedir nada e nada volta ao cache", async () => {
    let finishOpening: () => void = () => undefined;
    api.request.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === "POST") return new Promise((resolve) => (finishOpening = () => resolve(succeeded({ id: "sessao-lenta", database: "mes" }))));
      return Promise.resolve(path.endsWith("/object-names") ? succeeded(names) : succeeded([]));
    });
    const pending = queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true)).then(
      () => "respondeu",
      () => "recusou",
    );
    await vi.waitFor(() => expect(posts()).toHaveLength(1));

    // "Desconectar": a família da árvore e a sessão saem do cache.
    queryClient.removeQueries({ queryKey: ["tree", "c1"] });
    queryClient.removeQueries({ queryKey: ["database-session", "c1"] });
    finishOpening();

    expect(await pending).toBe("recusou");
    expect(nameRequests()).toEqual([]);
    expect(queryClient.getQueryData(objectNamesKey("c1"))).toBeUndefined();
    expect(cachedTree(queryClient).indexes).toEqual([]);
  });

  it("a conexão removida enquanto o índice vem: a resposta tardia não o devolve ao cache", async () => {
    let answerNames: () => void = () => undefined;
    api.request.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === "POST") return Promise.resolve(succeeded({ id: "sessao-1", database: "mes" }));
      if (path.endsWith("/object-names")) return new Promise((resolve) => (answerNames = () => resolve(succeeded(names))));
      return Promise.resolve(succeeded([]));
    });
    const pending = queryClient.fetchQuery(objectNamesQuery("c1", undefined, queryClient, true)).catch(() => undefined);
    await vi.waitFor(() => expect(nameRequests()).toHaveLength(1));

    queryClient.removeQueries({ queryKey: ["tree", "c1"] });
    answerNames();
    await pending;

    expect(queryClient.getQueryData(objectNamesKey("c1"))).toBeUndefined();
    expect(cachedTree(queryClient).indexes).toEqual([]);
  });
});
