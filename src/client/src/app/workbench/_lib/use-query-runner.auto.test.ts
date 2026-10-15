import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { anyRunnerBusy } from "./workbench-lock";
import { createQueryRunner, isAutoRun, isBusyState, isPersonBusy, type QueryRunner, type RunnerState } from "./use-query-runner";
import { workbenchCopy } from "./workbench.copy";

// RN-GRADE-014: a atualização automática com o executor de verdade e a API simulada pelo `fetch` (como em `use-query-runner.test.ts`), com os temporizadores
// falsos. O relógio tem teste próprio (`auto-refresh.test.ts`); aqui se confere a ligação: o que o executor manda à API, os avisos que não se repetem, a grade
// que fica, o bloqueio por inatividade que não é segurado e o que a desliga.
const base = "http://127.0.0.1:51234/";
const sessions = "api/user/database-sessions";
const bridge = { getApiConfig: async () => ({ baseUrl: base.slice(0, -1), token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

type Call = { method: string; path: string; body: unknown };

function fakeApi() {
  const calls: Call[] = [];
  const answers: { route: string; answer: Response | Promise<Response> }[] = [];

  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const call = { method: init.method ?? "GET", path: url.replace(base, ""), body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined };
    calls.push(call);
    const index = answers.findIndex((candidate) => candidate.route === `${call.method} ${call.path}`);
    if (index < 0) throw new Error(`Sem resposta combinada para ${call.method} ${call.path}`);
    return answers.splice(index, 1)[0].answer;
  });

  return { calls, routes: () => calls.map((call) => `${call.method} ${call.path}`), on: (route: string, answer: Response | Promise<Response>) => void answers.push({ route, answer }) };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const problem = (status: number, type: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...extra }), { status });
const columns = [
  { name: "id", type: "int8", kind: "number" },
  { name: "obs", type: "text", kind: "text" },
];
const page = (rows: (string | null)[][], extra: Record<string, unknown> = {}) => json({ columns, rows, hasMore: true, elapsedMs: 4, truncatedCells: [], rowsAffected: null, ...extra });
const queries = `POST ${sessions}/s1/queries`;
const command = { sql: "select * from fila", offset: 0 };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** Uma aba com a sessão aberta e as linhas de uma leitura na tela; a primeira página traz, por padrão, uma célula cortada (o aviso sai uma vez). */
async function withResult(first: Response = page([["1", "a"]], { truncatedCells: [[0, 1]] })) {
  const api = fakeApi();
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const runner = createQueryRunner({ connectionId: "c1", queryClient: createQueryClient(toast), toast, onSession: () => {} });
  api.on(`POST ${sessions}`, json({ id: "s1", database: "mes" }, 201));
  api.on(queries, first);
  await runner.run(command);
  if (runner.getState().status !== "rows") throw new Error("esperava linhas");
  // À vista, como a vista diria.
  runner.autoRefresh.pause("hidden", false);
  return { api, toast, runner };
}

const rowsOf = (runner: QueryRunner) => {
  const state = runner.getState();
  if (state.status !== "rows") throw new Error(`esperava linhas, veio ${state.status}`);
  return state;
};

beforeEach(() => {
  vi.stubGlobal("window", { prism: bridge });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a atualização automática pelo executor (RN-GRADE-014)", () => {
  it("executa de novo o mesmo comando, pela mesma rota, a cada intervalo, e a grade fica (a mesma chave) quando as colunas são as mesmas", async () => {
    const { api, runner } = await withResult();
    const first = rowsOf(runner);

    runner.autoRefresh.start(5_000);
    api.on(queries, page([["1", "a"], ["2", "b"]]));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(api.calls.at(-1)).toEqual({ method: "POST", path: `${sessions}/s1/queries`, body: { sql: command.sql } });
    expect(rowsOf(runner)).toMatchObject({ id: first.id, rows: [["1", "a"], ["2", "b"]], total: null });
    expect(runner.autoRefresh.getState()).toMatchObject({ status: "on", running: false, lastAt: Date.now() });

    // Outras colunas: a grade é outra.
    api.on(queries, json({ columns: [{ name: "id", type: "int8", kind: "number" }], rows: [["1"]], hasMore: false, elapsedMs: 1, truncatedCells: [], rowsAffected: null }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(rowsOf(runner).id).not.toBe(first.id);
  });

  it("não repete o aviso de valores cortados: as células seguem marcadas", async () => {
    const { api, toast, runner } = await withResult();
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(workbenchCopy.toasts.valuesTruncated);

    runner.autoRefresh.start(5_000);
    api.on(queries, page([["1", "a"]], { truncatedCells: [[0, 1]] }));
    await vi.advanceTimersByTimeAsync(5_000);
    api.on(queries, page([["1", "a"]], { truncatedCells: [[0, 1]] }));
    await vi.advanceTimersByTimeAsync(5_000);

    expect(toast.warning).toHaveBeenCalledOnce();
    expect(rowsOf(runner).truncated.get(0)).toEqual(new Set([1]));
  });

  it("enquanto ela roda, a aba está ocupada, mas o bloqueio por inatividade não é segurado; o comando da pessoa segura", async () => {
    const { api, runner } = await withResult();
    const answer = deferred<Response>();
    runner.autoRefresh.start(5_000);
    api.on(queries, answer.promise);

    await vi.advanceTimersByTimeAsync(5_000);
    const running = runner.getState();
    expect(running).toMatchObject({ status: "running", auto: true });
    expect(isBusyState(running)).toBe(true);
    expect(isPersonBusy(running)).toBe(false);
    expect(anyRunnerBusy(new Map([["t1", runner]]))).toBe(false);

    answer.resolve(page([["1", "a"]]));
    await vi.advanceTimersByTimeAsync(0);
    const manual = deferred<Response>();
    api.on(queries, manual.promise);
    const rerun = runner.rerun();
    expect(isPersonBusy(runner.getState())).toBe(true);
    expect(anyRunnerBusy(new Map([["t1", runner]]))).toBe(true);
    manual.resolve(page([["1", "a"]]));
    await rerun;
  });

  it("o erro do banco aparece uma vez, como sempre, e ela para com a nota", async () => {
    const { api, toast, runner } = await withResult();
    runner.autoRefresh.start(5_000);
    api.on(queries, problem(422, "SQL_EXECUTION_FAILED", { detail: 'relation "fila" does not exist', sqlState: "42P01" }));

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(runner.getState()).toMatchObject({ status: "error", source: "database", message: 'relation "fila" does not exist' });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(workbenchCopy.toasts.commandFailed);
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: "failed" });
    expect(api.routes().filter((route) => route === queries)).toHaveLength(2);
  });

  it("a API fora do ar: o aviso central uma vez, as linhas de antes ficam, e ela para", async () => {
    const { api, toast, runner } = await withResult();
    const before = runner.getState();
    runner.autoRefresh.start(5_000);
    api.on(queries, problem(500, "INTERNAL_ERROR"));

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(runner.getState()).toBe(before);
    expect(toast.error).toHaveBeenCalledOnce();
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: "notRun" });
  });

  it("não liga sobre o comando que grava e devolve linhas (RN-SQL-013): o motivo é esse", async () => {
    const api = fakeApi();
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const runner = createQueryRunner({ connectionId: "c1", queryClient: createQueryClient(toast), toast, onSession: () => {} });
    api.on(`POST ${sessions}`, json({ id: "s1", database: "mes" }, 201));
    api.on(queries, page([["7", "x"]], { hasMore: false, totalRows: 1 }));
    await runner.run({ sql: "update fila set obs = 'x' returning *", offset: 0 });

    runner.autoRefresh.start(5_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(runner.autoRefresh.blocker()).toBe("writes");
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: null });
    expect(api.routes().filter((route) => route === queries)).toHaveLength(1);
  });

  it("outro comando da pessoa a desliga; o mesmo (o F5) a mantém", async () => {
    const { api, runner } = await withResult();
    runner.autoRefresh.start(10_000);

    api.on(queries, page([["1", "a"]]));
    await runner.rerun();
    expect(runner.autoRefresh.getState()).toMatchObject({ status: "on" });

    api.on(queries, page([["1", "a"]]));
    await runner.run({ sql: "select * from outra", offset: 0 });
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: null });
  });

  it("o comando que a pessoa pediu e que nem foi enviado (dois comandos na seleção) não a desliga", async () => {
    const { toast, runner } = await withResult();
    runner.autoRefresh.start(10_000);

    await runner.run({ sql: "select 1; select 2", offset: 0 });

    expect(toast.warning).toHaveBeenLastCalledWith(workbenchCopy.toasts.tooManyStatements);
    expect(runner.autoRefresh.getState()).toMatchObject({ status: "on" });
  });

  it("soltar a aba (desconectar) e aposentar o executor (fechar, trocar de banco, outra janela, o bloqueio) a desligam, e nada mais é executado", async () => {
    for (const leave of [(runner: QueryRunner) => runner.release(), (runner: QueryRunner) => runner.retire()]) {
      const { api, runner } = await withResult();
      runner.autoRefresh.start(5_000);

      leave(runner);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: null });
      expect(api.routes().filter((route) => route === queries)).toHaveLength(1);
      // Sem sessão, ela não liga de novo sozinha (nada reconecta, RN-SESSAO-004).
      runner.autoRefresh.start(5_000);
      expect(runner.autoRefresh.getState().status).toBe("off");
    }
  });

  it("Cancelar alcança a execução automática: ela para com a nota, e o resultado diz que foi cancelado", async () => {
    const { api, toast, runner } = await withResult();
    const answer = deferred<Response>();
    runner.autoRefresh.start(5_000);
    api.on(queries, answer.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));

    await vi.advanceTimersByTimeAsync(5_000);
    await runner.cancel();
    answer.resolve(problem(422, "SQL_EXECUTION_FAILED", { detail: "canceling statement due to user request", sqlState: "57014", outcome: "canceled" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(runner.getState()).toEqual({ status: "cancelled" } satisfies RunnerState);
    expect(toast.warning).toHaveBeenLastCalledWith(workbenchCopy.toasts.commandCancelled);
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: "cancelled" });
  });
});

describe("o que a pessoa pede enquanto a execução automática roda (RN-GRADE-014): é atendido, e não perdido", () => {
  const cancelRoute = `POST ${sessions}/s1/queries/cancel`;
  const cancelledByUs = () => problem(422, "SQL_EXECUTION_FAILED", { detail: "canceling statement due to user request", sqlState: "57014", outcome: "canceled" });

  /** A aba com ela ligada e a execução automática em andamento, a resposta dela presa até a prova soltar. */
  async function withAutoRunning(first?: Response) {
    const tab = await withResult(first);
    const autoAnswer = deferred<Response>();
    tab.runner.autoRefresh.start(5_000);
    tab.api.on(queries, autoAnswer.promise);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tab.runner.getState()).toMatchObject({ status: "running", auto: true });
    return { ...tab, autoAnswer };
  }

  it("outro comando da pessoa abandona a execução automática: o cancelamento vai à API, a aba mostra o comando da pessoa rodando, e ele sai quando a sessão fica livre", async () => {
    const { api, toast, runner, autoAnswer } = await withAutoRunning();
    const before = (runner.getState() as Extract<RunnerState, { status: "running" }>).previous;
    api.on(cancelRoute, new Response(null, { status: 204 }));
    const mine = deferred<Response>();
    api.on(queries, mine.promise);

    const running = runner.run({ sql: "select * from outra", offset: 0 });
    // Desde o clique: o comando da pessoa, que a área mostra rodando (sem `auto`), sobre o resultado de antes (com o cursor fechado: o banco executou a
    // automática); e outro comando a desliga.
    expect(runner.getState()).toEqual({ status: "running", cancelling: false, previous: { ...before, cursorClosed: true } });
    expect(isPersonBusy(runner.getState())).toBe(true);
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(api.routes().slice(-2)).toEqual([queries, cancelRoute]);

    // A resposta da execução abandonada chega: nada dela aparece (nem estado, nem aviso). Só então o comando da pessoa sai.
    autoAnswer.resolve(cancelledByUs());
    await vi.advanceTimersByTimeAsync(0);
    expect(api.calls.at(-1)).toEqual({ method: "POST", path: `${sessions}/s1/queries`, body: { sql: "select * from outra" } });
    expect(runner.getState()).toMatchObject({ status: "running", cancelling: false });
    mine.resolve(page([["9", "z"]]));
    await running;

    expect(rowsOf(runner).rows).toEqual([["9", "z"]]);
    expect(toast.warning).toHaveBeenCalledOnce(); // só o de valores cortados da primeira página
    expect(toast.error).not.toHaveBeenCalled();
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: null });
  });

  it("o mesmo comando (o F5, \"Atualizar\") também toma o lugar dela, e ela continua ligada, com o tempo contado do fim do da pessoa", async () => {
    const { api, runner, autoAnswer } = await withAutoRunning();
    api.on(cancelRoute, new Response(null, { status: 204 }));
    api.on(queries, page([["1", "a"], ["2", "b"]]));

    const again = runner.rerun();
    expect(runner.getState()).toMatchObject({ status: "running" });
    expect(isAutoRun(runner.getState())).toBe(false);
    // A execução terminou sozinha antes de o cancelamento chegar: a resposta dela também não aparece.
    autoAnswer.resolve(page([["velho", "x"]]));
    await again;

    expect(rowsOf(runner).rows).toEqual([["1", "a"], ["2", "b"]]);
    expect(runner.autoRefresh.getState()).toMatchObject({ status: "on", running: false, lastAt: Date.now() });
    const sent = api.routes().filter((route) => route === queries).length;
    api.on(queries, page([["1", "a"]]));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(api.routes().filter((route) => route === queries)).toHaveLength(sent);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.routes().filter((route) => route === queries)).toHaveLength(sent + 1);
  });

  it("Cancelar enquanto a sessão se livra: nada da pessoa é enviado, e o resultado de antes volta com o cursor fechado (o banco executou a automática)", async () => {
    const { api, runner, autoAnswer } = await withAutoRunning();
    const before = (runner.getState() as Extract<RunnerState, { status: "running" }>).previous;
    api.on(cancelRoute, new Response(null, { status: 204 }));
    api.on(cancelRoute, new Response(null, { status: 204 }));

    const running = runner.run({ sql: "select * from outra", offset: 0 });
    await runner.cancel();
    autoAnswer.resolve(cancelledByUs());
    await running;

    expect(api.calls.filter((call) => call.path === `${sessions}/s1/queries`)).toHaveLength(2);
    expect(runner.getState()).toEqual({ ...before, cursorClosed: true });
  });

  it("\"Carregar mais\" espera a execução automática e lê a página seguinte do resultado novo", async () => {
    const { api, runner, autoAnswer } = await withAutoRunning();
    const more = runner.loadMore();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.routes().at(-1)).toBe(queries);

    autoAnswer.resolve(page([["1", "novo"]]));
    api.on(`POST ${sessions}/s1/queries/next`, page([["2", "b"]], { hasMore: false }));
    await more;

    expect(api.routes().slice(-2)).toEqual([queries, `POST ${sessions}/s1/queries/next`]);
    expect(rowsOf(runner)).toMatchObject({ rows: [["1", "novo"], ["2", "b"]], pages: 2, hasMore: false });
  });

  it("\"Contar total\" espera a execução automática e conta sobre o resultado novo", async () => {
    const { api, runner, autoAnswer } = await withAutoRunning();
    const count = runner.countTotal();

    autoAnswer.resolve(page([["1", "novo"]]));
    api.on(`POST ${sessions}/s1/queries/count`, json({ total: 42 }));
    await count;

    expect(api.routes().at(-1)).toBe(`POST ${sessions}/s1/queries/count`);
    expect(rowsOf(runner)).toMatchObject({ rows: [["1", "novo"]], total: 42 });
  });

  it("o executor aposentado durante a espera (trocar o banco ou a conexão da aba) faz o \"Carregar mais\" e o \"Contar total\" que esperavam desistirem calados", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { api, runner, autoAnswer } = await withAutoRunning();
    const sent = api.calls.length;
    const more = runner.loadMore();
    const count = runner.countTotal();
    await vi.advanceTimersByTimeAsync(0);

    runner.retire();
    autoAnswer.resolve(page([["1", "novo"]]));
    await more;
    await count;

    // Nada foi enviado depois da execução automática, e o registro não diz que o painel segurou um executor velho: ele foi aposentado no meio da espera.
    expect(api.calls.slice(sent).map((call) => call.path)).not.toContain(`${sessions}/s1/queries/next`);
    expect(api.calls.slice(sent).map((call) => call.path)).not.toContain(`${sessions}/s1/queries/count`);
    expect(warn).not.toHaveBeenCalled();
    expect(runner.getState()).toEqual({ status: "idle" });

    // O pedido que chega ao executor JÁ aposentado continua recusado com o registro.
    await runner.loadMore();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('"loadMore"');
    warn.mockRestore();
  });

  it("autoRunSettled espera a execução automática em andamento; sem ela, resolve na hora", async () => {
    const { runner, autoAnswer } = await withAutoRunning();
    let settled = false;
    void runner.autoRunSettled().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    autoAnswer.resolve(page([["1", "a"]]));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    await expect(runner.autoRunSettled()).resolves.toBeUndefined();
  });

  it("desligar durante a execução automática a abandona: o resultado de antes volta já (com o cursor fechado), o cancelamento vai calado, e a resposta dela não muda a tela nem avisa", async () => {
    const { api, toast, runner, autoAnswer } = await withAutoRunning();
    const before = (runner.getState() as Extract<RunnerState, { status: "running" }>).previous;
    api.on(cancelRoute, new Response(null, { status: 204 }));

    runner.autoRefresh.stop();
    expect(runner.getState()).toEqual({ ...before, cursorClosed: true });
    expect(isBusyState(runner.getState())).toBe(false);
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: null });
    // Nada ocupa a aba à vista: ela pode ligar de novo.
    expect(runner.autoRefresh.blocker()).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.routes().at(-1)).toBe(cancelRoute);

    autoAnswer.resolve(problem(422, "SQL_EXECUTION_FAILED", { detail: 'relation "fila" does not exist', sqlState: "42P01" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.getState()).toEqual({ ...before, cursorClosed: true });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("ligada de novo logo depois de desligar, a próxima execução espera a sessão se livrar da abandonada", async () => {
    const { api, runner, autoAnswer } = await withAutoRunning();
    api.on(cancelRoute, new Response(null, { status: 204 }));
    runner.autoRefresh.stop();
    runner.autoRefresh.start(5_000);
    expect(runner.autoRefresh.getState()).toMatchObject({ status: "on", everyMs: 5_000 });
    api.on(queries, page([["1", "novo"]]));

    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.routes().filter((route) => route === queries)).toHaveLength(2);

    autoAnswer.resolve(cancelledByUs());
    await vi.advanceTimersByTimeAsync(0);
    expect(api.routes().filter((route) => route === queries)).toHaveLength(3);
    expect(rowsOf(runner).rows).toEqual([["1", "novo"]]);
    expect(runner.autoRefresh.getState()).toMatchObject({ status: "on", running: false });
  });

  it("o comando da pessoa logo depois de desligar também espera a sessão se livrar da execução abandonada", async () => {
    const { api, runner, autoAnswer } = await withAutoRunning();
    api.on(cancelRoute, new Response(null, { status: 204 }));
    runner.autoRefresh.stop();
    api.on(queries, page([["9", "z"]]));

    const mine = runner.run({ sql: "select * from outra", offset: 0 });
    await vi.advanceTimersByTimeAsync(0);
    expect(isPersonBusy(runner.getState())).toBe(true);
    expect(api.routes().filter((route) => route === queries)).toHaveLength(2);

    autoAnswer.resolve(cancelledByUs());
    await mine;
    expect(api.calls.at(-1)).toEqual({ method: "POST", path: `${sessions}/s1/queries`, body: { sql: "select * from outra" } });
    expect(rowsOf(runner).rows).toEqual([["9", "z"]]);
  });

  it("o comando da pessoa que nem seria enviado (dois comandos) deixa a execução automática seguir", async () => {
    const { api, toast, runner, autoAnswer } = await withAutoRunning();

    await runner.run({ sql: "select 1; select 2", offset: 0 });
    expect(toast.warning).toHaveBeenLastCalledWith(workbenchCopy.toasts.tooManyStatements);
    expect(runner.getState()).toMatchObject({ status: "running", auto: true });

    autoAnswer.resolve(page([["1", "novo"]]));
    await vi.advanceTimersByTimeAsync(0);
    expect(rowsOf(runner).rows).toEqual([["1", "novo"]]);
    expect(api.routes()).not.toContain(cancelRoute);
  });
});

describe("a sessão que cai desliga a atualização automática, que não abre outra (RN-GRADE-014, RN-SESSAO-004)", () => {
  it("ao contar: ela para com a nota, e o relógio não executa mais nada", async () => {
    const { api, runner } = await withResult();
    runner.autoRefresh.start(5_000);
    api.on(`POST ${sessions}/s1/queries/count`, problem(404, "DATABASE_SESSION_NOT_FOUND"));

    await runner.countTotal();
    expect(runner.sessionOf()).toBeNull();
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: "disconnected" });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.routes().filter((route) => route === `POST ${sessions}`)).toHaveLength(1);
    expect(api.routes().filter((route) => route.endsWith("/queries"))).toHaveLength(1);
  });

  it("na própria execução automática: as linhas de antes ficam, sem aviso, ela para com a nota, e nenhuma sessão é aberta", async () => {
    const { api, toast, runner } = await withResult();
    const before = runner.getState();
    runner.autoRefresh.start(5_000);
    api.on(queries, problem(404, "DATABASE_SESSION_NOT_FOUND"));

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(runner.getState()).toBe(before);
    expect(runner.sessionOf()).toBeNull();
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: "disconnected" });
    expect(api.routes().filter((route) => route === `POST ${sessions}`)).toHaveLength(1);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledOnce(); // só o de valores cortados da primeira página
  });

  it("o comando da pessoa reabre a sessão, como sempre (seção 7)", async () => {
    const { api, toast, runner } = await withResult();
    api.on(queries, problem(404, "DATABASE_SESSION_NOT_FOUND"));
    api.on(`POST ${sessions}`, json({ id: "s2", database: "mes" }, 201));
    api.on(`POST ${sessions}/s2/queries`, page([["1", "a"]]));

    await runner.rerun();

    expect(runner.sessionOf()).toBe("s2");
    expect(toast.warning).toHaveBeenLastCalledWith(workbenchCopy.toasts.sessionReopened);
  });

  it("ligada, o mesmo comando da pessoa (o F5) que reabre a sessão a mantém ligada, com o tempo contado do fim dele, na sessão nova", async () => {
    const { api, toast, runner } = await withResult();
    runner.autoRefresh.start(5_000);
    api.on(queries, problem(404, "DATABASE_SESSION_NOT_FOUND"));
    api.on(`POST ${sessions}`, json({ id: "s2", database: "mes" }, 201));
    api.on(`POST ${sessions}/s2/queries`, page([["9", "z"]]));

    await runner.rerun();

    expect(rowsOf(runner).rows).toEqual([["9", "z"]]);
    expect(toast.warning).toHaveBeenLastCalledWith(workbenchCopy.toasts.sessionReopened);
    expect(runner.autoRefresh.getState()).toEqual({ status: "on", everyMs: 5_000, lastAt: Date.now(), running: false, paused: null });

    api.on(`POST ${sessions}/s2/queries`, page([["9", "z"], ["10", "y"]]));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(api.routes().at(-1)).toBe(`POST ${sessions}/s2/queries`);
    expect(rowsOf(runner).rows).toHaveLength(2);
  });

  it("ligada, se o comando da pessoa não consegue reabrir a sessão, ela para com a nota de a sessão ter caído", async () => {
    const { api, runner } = await withResult();
    runner.autoRefresh.start(5_000);
    api.on(queries, problem(404, "DATABASE_SESSION_NOT_FOUND"));
    api.on(`POST ${sessions}`, problem(502, "DATABASE_CONNECTION_FAILED", { detail: "connection refused" }));

    await runner.rerun();

    expect(runner.sessionOf()).toBeNull();
    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: "disconnected" });
  });
});

describe("os avisos que a execução automática não repete", () => {
  it("o \"Carregar mais\" depois dela não avisa de novo os valores cortados de um resultado que já avisou", async () => {
    const { api, toast, runner } = await withResult();
    runner.autoRefresh.start(5_000);
    for (let cycle = 0; cycle < 3; cycle++) {
      api.on(queries, page([["1", "a"]], { truncatedCells: [[0, 1]] }));
      await vi.advanceTimersByTimeAsync(5_000);
      api.on(`POST ${sessions}/s1/queries/next`, page([["2", "b"]], { truncatedCells: [[0, 1]] }));
      await runner.loadMore();
    }

    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(workbenchCopy.toasts.valuesTruncated);
  });

  it("o resultado que ainda não avisou avisa uma vez, no \"Carregar mais\" que traz o primeiro valor cortado", async () => {
    const { api, toast, runner } = await withResult(page([["1", "a"]]));
    runner.autoRefresh.start(5_000);
    api.on(queries, page([["1", "a"]], { truncatedCells: [[0, 1]] }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(toast.warning).not.toHaveBeenCalled();

    api.on(`POST ${sessions}/s1/queries/next`, page([["2", "b"]], { truncatedCells: [[0, 1]] }));
    await runner.loadMore();
    api.on(`POST ${sessions}/s1/queries/next`, page([["3", "c"]], { truncatedCells: [[0, 1]] }));
    await runner.loadMore();

    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(workbenchCopy.toasts.valuesTruncated);
  });
});

describe("a posição do erro, com o texto editado depois do envio (RN-SQL-009)", () => {
  const failedAt = (position: number) => problem(422, "SQL_EXECUTION_FAILED", { detail: 'ERROR: relation "fila" does not exist', sqlState: "42P01", position });

  it("a execução automática repete o comando de antes: o erro dela não marca o texto que mudou", async () => {
    const { api, runner } = await withResult();
    runner.textEdited();
    runner.autoRefresh.start(5_000);
    api.on(queries, failedAt(15));

    await vi.advanceTimersByTimeAsync(5_000);

    expect(runner.getState()).toMatchObject({ status: "error", errorAt: null });
  });

  it("executar de novo (o F5) também: só o comando do editor volta a marcar", async () => {
    const { api, runner } = await withResult();
    runner.textEdited();
    api.on(queries, failedAt(15));
    await runner.rerun();
    expect(runner.getState()).toMatchObject({ status: "error", errorAt: null });

    api.on(queries, failedAt(15));
    await runner.run(command);
    expect(runner.getState()).toMatchObject({ status: "error", errorAt: 14 });
  });
});
