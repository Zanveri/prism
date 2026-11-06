import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { transactionCopy } from "./transaction.copy";
import { createQueryRunner } from "./use-query-runner";

const base = "http://127.0.0.1:51234/";
const sessions = "api/user/database-sessions";

const bridge = { getApiConfig: async () => ({ baseUrl: base.slice(0, -1), token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

type Call = { method: string; path: string; body: unknown };

/** Troca o `fetch` por um que responde, na ordem, o que o teste combinou para cada rota. */
function fakeApi() {
  const calls: Call[] = [];
  const answers: { route: string; answer: Response }[] = [];

  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { method: init.method ?? "GET", path: url.replace(base, ""), body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined };
    calls.push(call);

    const index = answers.findIndex((candidate) => candidate.route === `${call.method} ${call.path}`);
    if (index < 0) throw new Error(`Sem resposta combinada para ${call.method} ${call.path}`);
    return answers.splice(index, 1)[0].answer;
  });

  return { calls, routes: () => calls.map((call) => `${call.method} ${call.path}`), on: (route: string, answer: Response) => void answers.push({ route, answer }) };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const problem = (status: number, type: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...extra }), { status });

/** O estado que a API devolve (seção 22): `open` com os comandos e o começo, ou sem transação. */
const manual = (commands: number) => ({ mode: "manual", isolationLevel: "default", open: commands > 0, failed: false, commands, openedAt: commands > 0 ? "2026-10-29T12:00:00Z" : null });
const affected = (rowsAffected: number, transaction: unknown) => json({ rowsAffected, elapsedMs: 3, transaction });

function setup() {
  const api = fakeApi();
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const runner = createQueryRunner({ connectionId: "c1", queryClient: createQueryClient(toast), toast, onSession: vi.fn() });
  return { api, toast, runner };
}

/** A aba no Commit manual, com a sessão aberta nele e dois comandos sem commit. */
async function withTwoPending() {
  const context = setup();
  expect(await context.runner.transaction.setMode("manual")).toBe(true);
  context.api.on(`POST ${sessions}`, json({ id: "s1", database: "mes", transaction: manual(0), transactionsAvailable: true }, 201));
  context.api.on(`POST ${sessions}/s1/queries`, affected(3, manual(1)));
  context.api.on(`POST ${sessions}/s1/queries`, affected(1, manual(2)));
  await context.runner.run({ sql: "update t set a = 1", offset: 0 });
  await context.runner.run({ sql: "delete from t where a = 2", offset: 0 });
  return context;
}

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("o Commit manual da aba (RN-TX-001 a 008)", () => {
  it("a sessão abre no modo da aba, e cada resposta diz a transação; o aviso do comando diz que ele ficou sem commit", async () => {
    const { api, toast, runner } = await withTwoPending();

    expect(api.calls[0]).toEqual({ method: "POST", path: sessions, body: { connectionID: "c1", transactionMode: "manual" } });
    expect(runner.transaction.getState()).toMatchObject({ mode: "manual", open: true, failed: false, commands: 2, openedAt: Date.parse("2026-10-29T12:00:00Z") });
    expect(toast.success).toHaveBeenLastCalledWith("Comando executado. 1 linha afetada, sem commit.");
  });

  it("o Commit confirma, avisa quantos comandos e deixa a aba sem transação", async () => {
    const { api, toast, runner } = await withTwoPending();
    api.on(`POST ${sessions}/s1/transaction/commit`, json({ transaction: manual(0), commands: 2 }));

    expect(await runner.transaction.end(true)).toBe(true);

    expect(api.routes().at(-1)).toBe(`POST ${sessions}/s1/transaction/commit`);
    expect(toast.success).toHaveBeenLastCalledWith(transactionCopy.toasts.committed(2));
    expect(runner.transaction.getState()).toMatchObject({ open: false, commands: 0, pending: false });
  });

  it("a transação que o banco desfez sem pedido é avisada, com os comandos que se perderam (RN-TX-009)", async () => {
    const { api, toast, runner } = await withTwoPending();
    api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: "SQL0911N deadlock", sqlState: "40001", transaction: manual(0), transactionUndone: true }));

    await runner.run({ sql: "update t set a = 3", offset: 0 });

    expect(toast.warning).toHaveBeenCalledWith(transactionCopy.toasts.undone(2));
    expect(runner.transaction.getState().open).toBe(false);
  });

  it("a sessão que cai com a transação aberta não é reaberta em silêncio, e o comando não é repetido (RN-TX-008)", async () => {
    const { api, toast, runner } = await withTwoPending();
    api.on(`POST ${sessions}/s1/queries`, problem(404, "DATABASE_SESSION_NOT_FOUND"));

    await runner.run({ sql: "update t set a = 3", offset: 0 });

    expect(api.routes().filter((route) => route === `POST ${sessions}`)).toHaveLength(1);
    expect(toast.warning).toHaveBeenCalledWith(transactionCopy.toasts.lost(2));
    expect(runner.transaction.getState()).toMatchObject({ mode: "manual", open: false });
    expect(runner.sessionOf()).toBeNull();
  });

  it("no banco sem log de transação a sessão não abre no Commit manual: a aba passa a Auto-commit, e o Commit manual fica indisponível (RN-TX-013)", async () => {
    const { api, runner } = setup();
    await runner.transaction.setMode("manual");
    api.on(`POST ${sessions}`, problem(422, "TRANSACTIONS_NOT_AVAILABLE", { detail: "Este banco não tem log de transação." }));

    await runner.run({ sql: "update t set a = 1", offset: 0 });

    expect(api.routes()).toEqual([`POST ${sessions}`]);
    expect(runner.transaction.getState()).toMatchObject({ mode: "autoCommit", available: false });
  });

  it("com a sessão aberta, a troca de modo vai à API; a recusa da transação aberta deixa o modo como estava (RN-TX-005)", async () => {
    const { api, runner } = await withTwoPending();
    api.on(`PATCH ${sessions}`, problem(409, "TRANSACTION_OPEN", { detail: "A aba tem uma transação aberta.", transaction: manual(2) }));

    expect(await runner.transaction.setMode("autoCommit")).toBe(false);

    expect(api.calls.at(-1)).toEqual({ method: "PATCH", path: sessions, body: { id: "s1", transactionMode: "autoCommit" } });
    expect(runner.transaction.getState()).toMatchObject({ mode: "manual", open: true, pending: false });
  });

  it("o nível de isolamento vai na abertura da sessão (quando não é o padrão) e na troca pela API (RN-ISOL-002 a 004)", async () => {
    const { api, runner } = setup();
    expect(await runner.transaction.setIsolationLevel("serializable")).toBe(true);
    api.on(`POST ${sessions}`, json({ id: "s1", database: "mes", transaction: { ...manual(0), mode: "autoCommit", isolationLevel: "serializable" }, transactionsAvailable: true }, 201));
    api.on(`POST ${sessions}/s1/queries`, affected(1, { ...manual(0), mode: "autoCommit", isolationLevel: "serializable" }));

    await runner.run({ sql: "update t set a = 1", offset: 0 });
    expect(api.calls[0]).toEqual({ method: "POST", path: sessions, body: { connectionID: "c1", isolationLevel: "serializable" } });
    expect(runner.transaction.getState().isolationLevel).toBe("serializable");

    api.on(`PATCH ${sessions}`, json({ id: "s1", database: "mes", transaction: { ...manual(0), mode: "autoCommit", isolationLevel: "readCommitted" }, transactionsAvailable: true }));
    expect(await runner.transaction.setIsolationLevel("readCommitted")).toBe(true);
    expect(api.calls.at(-1)).toEqual({ method: "PATCH", path: sessions, body: { id: "s1", transactionMode: "autoCommit", isolationLevel: "readCommitted" } });
    expect(runner.transaction.getState().isolationLevel).toBe("readCommitted");
  });
});
