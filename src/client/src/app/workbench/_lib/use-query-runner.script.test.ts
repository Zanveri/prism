import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { entriesOf, entryAt, scriptResultCap, scriptTotals, type ScriptRun } from "./script-run";
import { scriptRunCopy } from "./script-run.copy";
import { createQueryRunner, isPersonBusy, type RunTarget } from "./use-query-runner";
import { workbenchCopy } from "./workbench.copy";

// O "Executar script" no executor da aba (seção 31, RN-SQL-019 a 022), com a API de mentira (`fetch` trocado), como em `use-query-runner.test.ts`: um
// comando por pedido, na ordem, um por vez; as abas e as Estatísticas no estado do script; a pergunta de erro; o cancelamento; o limite das abas.
const base = "http://127.0.0.1:51234/";
const sessions = "api/user/database-sessions";
const queries = `POST ${sessions}/s1/queries`;
const bridge = { getApiConfig: async () => ({ baseUrl: base.slice(0, -1), token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };
const copy = scriptRunCopy;

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

  return {
    calls,
    /** O SQL de cada comando enviado, na ordem. */
    sent: () => calls.filter((call) => `${call.method} ${call.path}` === queries).map((call) => (call.body as { sql: string }).sql),
    on: (route: string, answer: Response | Promise<Response>) => void answers.push({ route, answer }),
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const problem = (status: number, type: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...extra }), { status });
const session = (id: string) => json({ id, database: "mes" }, 201);
const columns = [{ name: "id", type: "int8", kind: "number" }];
const page = (rows: string[][], hasMore = true) => json({ columns, rows: rows.map((row) => row.map((cell) => cell)), hasMore, elapsedMs: 40, truncatedCells: [], rowsAffected: null });
const affected = (count: number) => json({ columns: null, rows: null, hasMore: false, elapsedMs: 10, truncatedCells: null, rowsAffected: count });
const sqlError = (detail: string, position: number | null = null) => problem(422, "SQL_EXECUTION_FAILED", { detail, sqlState: "42601", ...(position === null ? {} : { position }) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

/** Deixa as promessas em andamento andarem até a próxima espera de verdade (a resposta combinada que ainda não chegou). */
const settle = () => new Promise((done) => setTimeout(done, 0));

/** O nome da aba, que o executor lê no fim do script (RN-SQL-020): a aba pode ser renomeada enquanto ele roda. */
const tabTitle = "consulta-1.sql";

function setup() {
  const api = fakeApi();
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const title = { now: tabTitle };
  const runner = createQueryRunner({ connectionId: "c1", queryClient: createQueryClient(toast), toast, onSession: vi.fn(), title: () => title.now });
  return { api, toast, runner, title };
}

/** Os comandos do script como o editor os manda: o texto e onde ele está no texto do editor. */
function commands(...texts: string[]): RunTarget[] {
  let offset = 0;
  return texts.map((sql) => {
    const target = { sql, offset, engine: 1 as const };
    offset += sql.length + 2;
    return target;
  });
}

const script = (runner: ReturnType<typeof setup>["runner"]): ScriptRun => {
  const run = runner.script.getState();
  if (run === null) throw new Error("esperava um script");
  return run;
};
const statuses = (run: ScriptRun) => entriesOf(run).map((entry) => entry.status);

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("o script roda um comando por vez, na ordem, na sessão da aba (RN-SQL-019)", () => {
  it("cada comando é um pedido, e o seguinte só sai quando o anterior respondeu; a barra sabe qual roda", async () => {
    const { api, runner } = setup();
    const first = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, first.promise);
    api.on(queries, affected(2));
    api.on(queries, page([["1"]], false));

    const done = runner.runScript(commands("select 1", "update t set a = 1", "select 2"));
    await settle();

    expect(api.sent()).toEqual(["select 1"]);
    expect(statuses(script(runner))).toEqual(["running", "pending", "pending"]);
    expect(script(runner).current).toBe(0);
    // O executor fica ocupado do primeiro ao último: "Cancelar" na barra, e a aba não troca de banco nem vai a outra janela (RN-SQL-019).
    expect(isPersonBusy(runner.getState())).toBe(true);

    first.resolve(page([["1"]]));
    await done;

    expect(api.sent()).toEqual(["select 1", "update t set a = 1", "select 2"]);
    expect(api.calls.filter((call) => call.path === sessions)).toHaveLength(1);
    expect(statuses(script(runner))).toEqual(["ok", "ok", "ok"]);
    expect(script(runner).phase).toBe("done");
  });

  it("só os comandos que devolvem linhas ganham aba; a do último tem o cursor aberto e é o estado do executor", async () => {
    const { api, runner, toast } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page([["1"]]));
    api.on(queries, affected(3));
    api.on(queries, page([["2"]]));

    await runner.runScript(commands("select 1", "update t set a = 1", "select 2"));

    const run = script(runner);
    expect(run.results.map((result) => result.entry)).toEqual([0, 2]);
    expect(run.live).toBe(2);
    expect(runner.getState()).toBe(run.results[1].rows);
    expect(entryAt(run, 1)).toMatchObject({ status: "ok", affected: 3, rows: null, kept: null });
    expect(entryAt(run, 0)).toMatchObject({ status: "ok", rows: { read: 1, more: true, total: null }, kept: true });
    // Um aviso só, no fim (RN-SQL-020): nada por comando.
    expect(toast.success.mock.calls).toEqual([[copy.toasts.done(tabTitle, 3)]]);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("o aviso do fim diz a aba pelo nome de agora: ela pode ter sido renomeada, ou salva como script, enquanto ele rodava", async () => {
    const { api, runner, toast, title } = setup();
    const first = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, first.promise);
    api.on(queries, affected(1));

    const done = runner.runScript(commands("update t set a = 1", "update t set a = 2"));
    await settle();
    title.now = "carga.sql";
    first.resolve(affected(1));
    await done;

    expect(toast.success.mock.calls).toEqual([["Script executado na aba carga.sql: 2 comandos."]]);
  });

  it("o último comando sem linhas: nenhuma aba fica com o cursor, e o executor termina com as linhas afetadas", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page([["1"]]));
    api.on(queries, affected(-1));

    await runner.runScript(commands("select 1", "create table x (a int)"));

    expect(script(runner).live).toBeNull();
    expect(runner.getState()).toEqual({ status: "affected", rowsAffected: -1, elapsedMs: 10 });
    expect(scriptTotals(script(runner))).toMatchObject({ ok: 2, total: 2, changed: 0, elapsedMs: 50 });
  });

  it("um comando só também é script", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page([["1"]]));

    await runner.runScript(commands("select 1"));

    expect(script(runner)).toMatchObject({ phase: "done", live: 0 });
    expect(script(runner).results).toHaveLength(1);
  });

  it("guarda as abas dos 20 primeiros que devolvem linhas e a do último; os outros só nas Estatísticas (RN-SQL-020)", async () => {
    const { api, runner } = setup();
    const total = scriptResultCap + 3;
    api.on(`POST ${sessions}`, session("s1"));
    for (let index = 0; index < total; index++) api.on(queries, page([[String(index)]]));

    await runner.runScript(commands(...Array.from({ length: total }, (_, index) => `select ${index}`)));

    const run = script(runner);
    expect(run.results.map((result) => result.entry)).toEqual([...Array.from({ length: scriptResultCap }, (_, index) => index), total - 1]);
    expect(run.live).toBe(total - 1);
    expect(entryAt(run, scriptResultCap).kept).toBe(false);
    expect(scriptTotals(run).dropped).toBe(2);
  });

  it("desliga a atualização automática, que o script é outro comando (RN-GRADE-014)", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page([["1"]]));
    await runner.run({ sql: "select 1", offset: 0 });
    runner.autoRefresh.start(5_000);
    expect(runner.autoRefresh.getState().status).toBe("on");
    api.on(queries, page([["1"]]));

    await runner.runScript(commands("select 1"));

    expect(runner.autoRefresh.getState()).toEqual({ status: "off", stopped: null });
  });
});

describe("a pergunta de erro (RN-SQL-021)", () => {
  async function failingSecond() {
    const context = setup();
    context.api.on(`POST ${sessions}`, session("s1"));
    context.api.on(queries, page([["1"]]));
    context.api.on(queries, sqlError('ERROR: syntax error at or near "form"', 10));
    const done = context.runner.runScript(commands("select 1", "select * form t", "select 3"));
    await settle();
    return { ...context, done };
  }

  it("o script para e espera a resposta, com o erro do banco no executor e a posição no texto inteiro do editor", async () => {
    const { runner } = await failingSecond();

    const run = script(runner);
    expect(run).toMatchObject({ phase: "paused", current: 1 });
    expect(entryAt(run, 1)).toMatchObject({ status: "error", error: { title: workbenchCopy.result.errorTitle, message: 'ERROR: syntax error at or near "form"', sqlState: "42601" } });
    // O segundo comando começa no 10 do texto do editor ("select 1" e a quebra antes dele); o banco aponta o 10º caractere do comando.
    expect(runner.getState()).toMatchObject({ status: "error", errorAt: 10 + 9 });
    // Enquanto a pergunta espera, o script não é comando em andamento para o bloqueio (RN-SEG-001).
    expect(isPersonBusy(runner.getState())).toBe(false);
  });

  it("Parar: o que já rodou fica, o que falhou fica com o erro e os seguintes não executam", async () => {
    const { api, runner, toast, done } = await failingSecond();

    runner.script.decide("stop");
    await done;

    expect(api.sent()).toEqual(["select 1", "select * form t"]);
    expect(statuses(script(runner))).toEqual(["ok", "error", "notRun"]);
    expect(script(runner)).toMatchObject({ phase: "stopped", current: null });
    expect(script(runner).results.map((result) => result.entry)).toEqual([0]);
    expect(toast.warning.mock.calls).toEqual([[copy.toasts.stopped(tabTitle, 1, 3)]]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("Tentar de novo executa o mesmo comando outra vez", async () => {
    const { api, runner, done } = await failingSecond();
    api.on(queries, affected(1));
    api.on(queries, page([["3"]]));

    runner.script.decide("retry");
    await done;

    expect(api.sent()).toEqual(["select 1", "select * form t", "select * form t", "select 3"]);
    expect(statuses(script(runner))).toEqual(["ok", "ok", "ok"]);
    expect(entryAt(script(runner), 1).error).toBeNull();
  });

  it("Pular segue com o próximo, e o pulado fica com o erro", async () => {
    const { api, runner, toast, done } = await failingSecond();
    api.on(queries, page([["3"]]));

    runner.script.decide("skip");
    await done;

    expect(statuses(script(runner))).toEqual(["ok", "skipped", "ok"]);
    expect(entryAt(script(runner), 1).error?.message).toBe('ERROR: syntax error at or near "form"');
    expect(toast.warning.mock.calls).toEqual([[copy.toasts.doneWithErrors(tabTitle, 1, 2, 3)]]);
  });

  it("Pular todos os erros: os seguintes que falham são pulados sem perguntar", async () => {
    const { api, runner, done } = await failingSecond();
    api.on(queries, sqlError("ERROR: relation \"t3\" does not exist"));

    runner.script.decide("skipAll");
    await done;

    expect(statuses(script(runner))).toEqual(["ok", "skipped", "skipped"]);
    expect(script(runner).phase).toBe("done");
  });

  it("a recusa da API para o comando (controle de transação em Auto-commit) também pergunta, e a frase dela vai ao erro", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, problem(422, "TRANSACTION_CONTROL_NOT_SUPPORTED", { detail: "Comandos de controle de transação não são aceitos." }));

    const done = runner.runScript(commands("begin", "select 1"));
    await settle();

    expect(script(runner)).toMatchObject({ phase: "paused", current: 0 });
    expect(entryAt(script(runner), 0).error).toEqual({ title: "Título de TRANSACTION_CONTROL_NOT_SUPPORTED", message: "Comandos de controle de transação não são aceitos.", sqlState: null });
    runner.script.decide("stop");
    await done;
  });

  it("o que não é do comando para o script sem perguntar: a sessão ocupada no meio dele", async () => {
    const { api, runner, toast } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page([["1"]]));
    api.on(queries, problem(409, "SESSION_BUSY"));

    await runner.runScript(commands("select 1", "select 2", "select 3"));

    expect(statuses(script(runner))).toEqual(["ok", "error", "notRun"]);
    expect(script(runner).phase).toBe("stopped");
    // O aviso central disse o que houve (RN-AVISO-004), e o script avisa que parou.
    expect(toast.error).toHaveBeenCalledWith("Título de SESSION_BUSY", undefined);
    expect(toast.warning).toHaveBeenCalledWith(copy.toasts.stopped(tabTitle, 1, 3));
  });

  it("a sessão que cai no meio do script não é reaberta: o script para, e diz por quê", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, json({ columns: null, rows: null, hasMore: false, elapsedMs: 5, truncatedCells: null, rowsAffected: 0 }));
    api.on(queries, problem(404, "DATABASE_SESSION_NOT_FOUND"));

    await runner.runScript(commands("create temp table x (a int)", "insert into x values (1)", "select * from x"));

    expect(api.calls.filter((call) => call.path === sessions)).toHaveLength(1);
    expect(entryAt(script(runner), 1)).toMatchObject({ status: "error", error: { message: copy.error.sessionLost } });
    expect(runner.sessionOf()).toBeNull();
  });

  it("nada respondido sobre comando nenhum (a conexão não abre): a tela fica como estava, e o executor faz o que faria com o Ctrl+Enter", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, problem(422, "DATABASE_CONNECTION_FAILED", { detail: "connection refused" }));

    await runner.runScript(commands("select 1", "select 2"));

    expect(runner.script.getState()).toBeNull();
    expect(runner.getState()).toMatchObject({ status: "error", source: "connection", message: "connection refused" });
  });

  it("soltar a aba durante a pergunta para o script (Desconectar); aposentar o executor o tira (o bloqueio)", async () => {
    const { runner, done } = await failingSecond();

    runner.release();
    await done;
    expect(script(runner)).toMatchObject({ phase: "stopped" });
    expect(statuses(script(runner))).toEqual(["ok", "error", "notRun"]);

    runner.retire();
    expect(runner.script.getState()).toBeNull();
  });
});

describe("cancelar o script (RN-SQL-022)", () => {
  it("interrompe o comando em andamento e para o script: o cancelado fica cancelado, e os seguintes não executam", async () => {
    const { api, runner, toast } = setup();
    const second = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page([["1"]]));
    api.on(queries, second.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));

    const done = runner.runScript(commands("select 1", "select pg_sleep(60)", "select 3"));
    await settle();
    await runner.cancel();
    second.resolve(problem(422, "SQL_EXECUTION_FAILED", { detail: "canceling statement due to user request", sqlState: "57014", outcome: "canceled" }));
    await done;

    expect(api.sent()).toEqual(["select 1", "select pg_sleep(60)"]);
    expect(statuses(script(runner))).toEqual(["ok", "cancelled", "notRun"]);
    expect(script(runner).phase).toBe("cancelled");
    expect(runner.getState()).toEqual({ status: "cancelled" });
    expect(toast.warning.mock.calls).toEqual([[copy.toasts.cancelled(tabTitle, 1, 3)]]);
  });

  it("o comando que terminou antes de o cancelamento chegar fica como concluído, e o script para mesmo assim", async () => {
    const { api, runner } = setup();
    const second = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, affected(1));
    api.on(queries, second.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));

    const done = runner.runScript(commands("delete from t where id = 1", "select 2", "select 3"));
    await settle();
    await runner.cancel();
    second.resolve(page([["2"]]));
    await done;

    expect(statuses(script(runner))).toEqual(["ok", "ok", "notRun"]);
    expect(script(runner)).toMatchObject({ phase: "cancelled", live: 1 });
    expect(runner.getState()).toMatchObject({ status: "rows", cancelling: false });
  });
});

describe("depois do script (RN-SQL-020)", () => {
  async function finished() {
    const context = setup();
    context.api.on(`POST ${sessions}`, session("s1"));
    context.api.on(queries, page([["1"]]));
    context.api.on(queries, page([["2"]]));
    await context.runner.runScript(commands("select 1", "select 2"));
    return context;
  }

  it("o Ctrl+Enter aceito troca os resultados do script", async () => {
    const { api, runner } = await finished();
    api.on(queries, affected(1));

    await runner.run({ sql: "update t set a = 1", offset: 0 });

    expect(runner.script.getState()).toBeNull();
  });

  it("o comando que a API não aceita deixa o script na tela, como deixa o resultado", async () => {
    const { api, runner } = await finished();
    api.on(queries, problem(409, "SESSION_BUSY"));

    await runner.run({ sql: "update t set a = 1", offset: 0 });

    expect(runner.script.getState()).not.toBeNull();
  });

  it("o filtro e o F5 no resultado do último comando mudam só ele; as outras abas ficam", async () => {
    const { api, runner } = await finished();
    api.on(queries, page([["2"]]));
    api.on(queries, page([["2"]]));

    await runner.run({ sql: "select 2", offset: 10, filter: "id > 1" }, { keepScript: true });
    await runner.rerun();

    expect(script(runner).results.map((result) => result.entry)).toEqual([0, 1]);
    expect(api.calls.at(-2)?.body).toEqual({ sql: "select 2", filter: "id > 1" });
  });

  it("Executar este comando executa só ele, como o Ctrl+Enter nele, e troca os resultados do script", async () => {
    const { api, runner } = await finished();
    api.on(queries, page([["1"]]));

    await runner.runCommand(script(runner).results[0].rows.target);

    expect(api.sent().at(-1)).toBe("select 1");
    expect(runner.script.getState()).toBeNull();
  });

  it("outro script troca o anterior", async () => {
    const { api, runner } = await finished();
    const before = script(runner).id;
    api.on(queries, affected(1));

    await runner.runScript(commands("delete from t"));

    expect(script(runner).id).not.toBe(before);
    expect(script(runner).results).toEqual([]);
  });
});

describe("o script numa conexão somente leitura (RN-PROT-002 e RN-SQL-021)", () => {
  it("o comando que não é leitura é recusado pela API, e a recusa é o erro dele: o script pergunta o que fazer", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page([["1"]]));
    api.on(queries, problem(422, "CONNECTION_READ_ONLY", { detail: "A conexão é somente leitura, e só leituras são executadas nela: um DELETE não é leitura. Nada foi enviado ao banco." }));

    const done = runner.runScript(commands("select 1", "delete from t", "select 2"));
    await settle();

    expect(script(runner)).toMatchObject({ phase: "paused", current: 1 });
    expect(entryAt(script(runner), 1).error).toEqual({ title: "Título de CONNECTION_READ_ONLY", message: "A conexão é somente leitura, e só leituras são executadas nela: um DELETE não é leitura. Nada foi enviado ao banco.", sqlState: null });
    runner.script.decide("stop");
    await done;
  });
});
