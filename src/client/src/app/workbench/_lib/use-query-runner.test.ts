import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { queryOutcomeCopy } from "./query-outcome.copy";
import { platformScriptShortcut } from "./script-run";
import { scriptsCopy } from "./scripts.copy";
import { countQueryTotal, executeQuery, fetchNextPage } from "./query.service";
import { createQueryRunner, isBusyState, type RunnerState } from "./use-query-runner";
import { workbenchCopy } from "./workbench.copy";

// As rotas de verdade, embrulhadas: os testes da rede de segurança fazem uma delas lançar um erro qualquer.
vi.mock("./query.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./query.service")>();
  return { ...actual, executeQuery: vi.fn(actual.executeQuery), fetchNextPage: vi.fn(actual.fetchNextPage), countQueryTotal: vi.fn(actual.countQueryTotal) };
});

const copy = workbenchCopy.toasts;
const base = "http://127.0.0.1:51234/";
const sessions = "api/user/database-sessions";

const bridge = { getApiConfig: async () => ({ baseUrl: base.slice(0, -1), token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

type Call = { method: string; path: string; body: unknown };

/** Troca o `fetch` por um que responde, na ordem, o que o teste combinou para cada rota. */
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
    routes: () => calls.map((call) => `${call.method} ${call.path}`),
    on: (route: string, answer: Response | Promise<Response>) => void answers.push({ route, answer }),
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const problem = (status: number, type: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...extra }), { status });
const session = (id: string) => json({ id, database: "mes" }, 201);

const columns = [
  { name: "id", type: "int8", kind: "number" },
  { name: "obs", type: "text", kind: "text" },
];
const page = (rows: (string | null)[][], extra: Record<string, unknown> = {}) => json({ columns, rows, hasMore: true, elapsedMs: 42, truncatedCells: [], rowsAffected: null, ...extra });

/** O estado de erro com a mensagem do banco, como veio. */
const databaseError = (message: string, sqlState: string | null, errorAt: number | null) => ({ status: "error", source: "database", title: workbenchCopy.result.errorTitle, message, sqlState, errorAt });

const outcomeCopy = queryOutcomeCopy.toasts;

/**
 * Os corpos de erro da API (422) para o comando que terminou depois de um pedido de cancelamento, e as recusas da rede de segurança (Ruling 135; a
 * tabela do relatório da Tarefa 43). Os `detail` são as constantes de `AdoDatabaseConnection.cs` e as mensagens dos bancos como os drivers as entregam
 * (a nota da sonda IBM). A tela decide pelas extensões `outcome` e `executed`, e nunca pelo texto.
 */
const afterCancel = {
  postgresCanceled: { detail: "canceling statement due to user request", sqlState: "57014", outcome: "canceled" },
  db2Canceled: { detail: "[IBM][DB2/LINUXX8664] SQL0952N  Processing was cancelled due to an interrupt.", sqlState: "57014", outcome: "canceled" },
  informixCanceled: { detail: "[IBM][IDS/UNIX64] Statement timed out or interrupted by user.", sqlState: "IX000", outcome: "canceled" },
  notSentOrCutRead: { detail: "O comando foi cancelado.", outcome: "canceled" },
  sessionLost: { detail: "O banco não respondeu ao cancelamento a tempo, e a sessão foi encerrada. O Prism não sabe se o comando foi concluído: confira no banco antes de executá-lo de novo.", outcome: "unknown" },
  ibmInterruptedAfterItRan: { detail: "[IBM][DB2/LINUXX8664] SQL0952N  Processing was cancelled due to an interrupt.", sqlState: "57014", outcome: "unknown" },
  partial: { detail: "O cancelamento chegou enquanto o comando devolvia as linhas. O que ele gravou até ali está confirmado, e pode ser só uma parte do comando: o Prism não sabe se ele foi concluído. Confira no banco antes de executá-lo de novo.", outcome: "partial" },
} as const;

const transactionControlMessage = "Comandos de controle de transação (BEGIN, COMMIT, ROLLBACK, SAVEPOINT) não são aceitos: toda sessão é auto-commit, e cada comando é confirmado quando termina.";
const undoneTransactionMessage = `O comando deixou uma transação aberta, e o Prism a desfez: nada do que ele gravou dentro dela ficou. ${transactionControlMessage}`;

/** O erro de `TRANSACTION_CONTROL_NOT_SUPPORTED` com `executed`: o comando rodou, e a frase da API toma o lugar do resultado (RN-SESSAO-005). */
const executedError = (message: string) => ({ status: "error", source: "api", title: "Título de TRANSACTION_CONTROL_NOT_SUPPORTED", message, sqlState: null, errorAt: null, executed: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function setup() {
  const api = fakeApi();
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const onSession = vi.fn<(sessionId: string | null) => void>();
  const queryClient = createQueryClient(toast);
  const runner = createQueryRunner({ connectionId: "c1", queryClient, toast, onSession });
  return { api, toast, onSession, runner, queryClient };
}

/** Uma aba com a sessão aberta e um resultado de leitura na tela, com o cursor aberto. */
async function withResult() {
  const context = setup();
  context.api.on(`POST ${sessions}`, session("s1"));
  context.api.on(`POST ${sessions}/s1/queries`, page([["1", "a"], ["2", "b"]]));
  await context.runner.run({ sql: "select * from t", offset: 0 });
  const result = context.runner.getState();
  if (result.status !== "rows") throw new Error("esperava linhas");
  return { ...context, result };
}

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("a aba sem conexão (RN-SCRIPT-003)", () => {
  it("não abre sessão nem chama a API: avisa, e sem resultado na tela a área diz por quê", async () => {
    const api = fakeApi();
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const runner = createQueryRunner({ connectionId: null, queryClient: createQueryClient(toast), toast, onSession: vi.fn() });

    await runner.run({ sql: "select 1", offset: 0 });

    expect(api.calls).toEqual([]);
    expect(toast.warning).toHaveBeenCalledWith(scriptsCopy.toasts.noConnection);
    expect(runner.getState()).toEqual({ status: "notice", message: scriptsCopy.toasts.noConnection });
  });
});

describe("executar", () => {
  it("a aba aberta a partir de outro banco do servidor abre a sessão dele e executa nela (RN-ARVORE-006)", async () => {
    const api = fakeApi();
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const runner = createQueryRunner({ connectionId: "c1", database: "arquivo", queryClient: createQueryClient(toast), toast, onSession: vi.fn() });
    api.on(`POST ${sessions}`, session("s-arquivo"));
    api.on(`POST ${sessions}/s-arquivo/queries`, page([["1", "a"]]));

    await runner.run({ sql: "select 1", offset: 0 });

    expect(api.calls).toEqual([
      { method: "POST", path: sessions, body: { connectionID: "c1", database: "arquivo" } },
      { method: "POST", path: `${sessions}/s-arquivo/queries`, body: { sql: "select 1" } },
    ]);
  });

  it("a primeira execução abre a sessão da aba e executa nela; a segunda usa a mesma (RN-SESSAO-001)", async () => {
    const { api, toast, onSession, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    api.on(`POST ${sessions}/s1/queries`, page([["2", "b"]], { hasMore: false }));

    expect(runner.getState()).toEqual({ status: "idle" });
    await runner.run({ sql: "select 1", offset: 0 });

    expect(api.calls).toEqual([
      { method: "POST", path: sessions, body: { connectionID: "c1" } },
      { method: "POST", path: `${sessions}/s1/queries`, body: { sql: "select 1" } },
    ]);
    expect(onSession).toHaveBeenCalledExactlyOnceWith("s1");
    expect(runner.getState()).toMatchObject({ status: "rows", columns, rows: [["1", "a"]], hasMore: true, elapsedMs: 42, pages: 1, total: null, cursorClosed: false });

    await runner.run({ sql: "select 2", offset: 0 });

    expect(api.routes().slice(2)).toEqual([`POST ${sessions}/s1/queries`]);
    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["2", "b"]], hasMore: false });
    // RN-AVISO-005: `SELECT` que devolve linhas não gera aviso; o resultado é o aviso.
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("enquanto roda o estado é running, e um segundo pedido é ignorado (RN-SESSAO-002)", async () => {
    const { api, runner } = setup();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, answer.promise);

    const running = runner.run({ sql: "select pg_sleep(30)", offset: 0 });
    expect(runner.getState()).toEqual({ status: "running", cancelling: false, previous: null });
    await runner.run({ sql: "select 2", offset: 0 });

    answer.resolve(page([["1", "a"]]));
    await running;
    expect(api.calls.filter((call) => call.path.endsWith("/queries"))).toHaveLength(1);
  });

  it("comando sem linhas: linhas afetadas e aviso de sucesso (RN-SQL-008, RN-AVISO-002)", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, json({ columns: null, rows: null, hasMore: false, elapsedMs: 12, truncatedCells: null, rowsAffected: 3 }));

    await runner.run({ sql: "update t set a = 1", offset: 0 });

    expect(runner.getState()).toEqual({ status: "affected", rowsAffected: 3, elapsedMs: 12 });
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Comando executado. 3 linhas afetadas.");
  });

  it("erro de SQL: a mensagem do banco, o SQLSTATE e a posição no texto do editor; o aviso é curto (RN-SQL-009)", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: 'ERROR: syntax error at or near "form"', sqlState: "42601", position: 10 }));

    // O comando enviado começa na posição 20 do editor: a posição 10 do banco (de 1 em diante) é a 29 do texto.
    await runner.run({ sql: "select 1 form t", offset: 20 });

    expect(runner.getState()).toEqual(databaseError('ERROR: syntax error at or near "form"', "42601", 29));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);

    runner.textEdited();
    expect(runner.getState()).toMatchObject({ status: "error", sqlState: "42601", errorAt: null });
  });

  it("a posição do banco conta caracteres, e o editor, unidades UTF-16: o emoji antes do erro não desloca a marca (D9)", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: 'ERROR: syntax error at or near "FROM"', sqlState: "42601", position: 17 }));

    // O comando começa na posição 5 do editor; o F de FROM é o 17.º caractere dele, e o índice 17 em UTF-16 (o emoji ocupa dois).
    const sql = "SELECT 'ção 😀', FROM loja.cliente";
    await runner.run({ sql, offset: 5 });

    const state = runner.getState();
    if (state.status !== "error" || state.errorAt === null) throw new Error("esperava o erro com a posição");
    expect(state.errorAt).toBe(5 + 17);
    expect(("xxxxx" + sql).slice(state.errorAt, state.errorAt + 4)).toBe("FROM");
  });

  it("texto alterado enquanto o comando rodava: o erro chega sem posição, porque ela era a do texto enviado", async () => {
    const { api, runner } = setup();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, answer.promise);

    const running = runner.run({ sql: "select 1 form t", offset: 20 });
    runner.textEdited();
    answer.resolve(problem(422, "SQL_EXECUTION_FAILED", { detail: 'ERROR: syntax error at or near "form"', sqlState: "42601", position: 10 }));
    await running;

    expect(runner.getState()).toEqual(databaseError('ERROR: syntax error at or near "form"', "42601", null));

    // A edição vale para o comando em que aconteceu: no seguinte, sem edição, a posição volta.
    api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: "ERROR: outra", sqlState: "42601", position: 3 }));
    await runner.run({ sql: "select 1 form t", offset: 20 });
    expect(runner.getState()).toMatchObject({ status: "error", errorAt: 22 });
  });

  it("a mensagem do banco com várias linhas (mensagem, DETAIL, HINT) chega inteira, com as quebras (RN-SQL-009)", async () => {
    const { api, runner } = setup();
    const message = 'ERROR: insert or update on table "apontamento" violates foreign key constraint "fk_maquina"\nDETAIL: Key (maquina_id)=(999) is not present in table "maquina".\nHINT: Confira a máquina.';
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: message, sqlState: "23503" }));

    await runner.run({ sql: "insert into apontamento (maquina_id) values (999)", offset: 0 });

    expect(runner.getState()).toEqual(databaseError(message, "23503", null));
  });

  it("comando de controle de transação: a frase da API na área de resultado e o aviso curto, sem SQLSTATE nem posição (RN-SQL-003)", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(422, "TRANSACTION_CONTROL_NOT_SUPPORTED", { detail: "Nesta versão toda sessão é auto-commit." }));

    await runner.run({ sql: "begin", offset: 0 });

    expect(runner.getState()).toEqual({ status: "error", source: "api", title: "Título de TRANSACTION_CONTROL_NOT_SUPPORTED", message: "Nesta versão toda sessão é auto-commit.", sqlState: null, errorAt: null });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);
  });

  it("comando que grava e devolve linhas: as linhas recebidas e o total, sem cursor, com aviso de sucesso (RN-SQL-013)", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"], ["2", "b"]], { hasMore: false, totalRows: 1200 }));

    await runner.run({ sql: "update t set a = 1 returning *", offset: 0 });

    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"]], totalRows: 1200, hasMore: false });
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Comando executado. 1.200 linhas devolvidas.");

    // Não há cursor nem o que contar: carregar mais e contar total não chamam a API.
    await runner.loadMore();
    await runner.countTotal();
    expect(api.calls).toHaveLength(2);
  });

  it("um total que a API mande junto de `hasMore` não deixa a tela oferecer mais linhas: o comando já acabou", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]], { hasMore: true, totalRows: 5 }));

    await runner.run({ sql: "delete from t returning *", offset: 0 });

    expect(runner.getState()).toMatchObject({ status: "rows", totalRows: 5, hasMore: false });
  });
});

describe("uma execução leva um comando só (RN-SQL-001)", () => {
  it("seleção com mais de um comando: não envia, avisa na área de resultado e em atenção", async () => {
    const { api, toast, runner } = setup();

    await runner.run({ sql: "update t set a = 1;\ndelete from t;\nselect 3;", offset: 0 });

    expect(api.calls).toEqual([]);
    expect(runner.getState()).toEqual({ status: "notice", message: `A seleção tem 3 comandos, e Executar leva um só: selecione um ou ponha o cursor nele. Para executar todos, um depois do outro, use Executar script (${platformScriptShortcut}).` });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.tooManyStatements(platformScriptShortcut));
    // Os dois ensinam o script, que executa todos (RN-SQL-019).
    expect(copy.tooManyStatements("Alt+X")).toBe("A seleção tem mais de um comando. Nada foi executado: para executar todos, use Executar script (Alt+X).");
  });

  it("seleção com um comando só vai como está, com o `;` e o comentário que vieram juntos (RN-SQL-003)", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));

    await runner.run({ sql: "  select 'a;b' from t; -- conferido\n", offset: 4 });

    expect(api.calls.at(-1)?.body).toEqual({ sql: "  select 'a;b' from t; -- conferido\n" });
    expect(runner.getState()).toMatchObject({ status: "rows" });
  });

  it("Db2: o procedimento com `;` no corpo, selecionado inteiro, vai como um comando só e sem alteração (RN-SQL-001, RN-SQL-002)", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, json({ columns: null, rows: null, hasMore: false, elapsedMs: 12, truncatedCells: null, rowsAffected: 0 }));
    const sql = "-- cria\nCREATE OR REPLACE PROCEDURE p ()\nLANGUAGE SQL\nBEGIN\n  UPDATE t SET a = 1;\n  DELETE FROM u;\nEND;\n";

    await runner.run({ sql, offset: 0, engine: 2 });

    expect(api.calls.at(-1)?.body).toEqual({ sql });
    expect(runner.getState()).toMatchObject({ status: "affected" });
  });

  it("o mesmo texto no Informix, que não tem esse bloco, tem três comandos: não envia", async () => {
    const { api, runner } = setup();
    const sql = "CREATE PROCEDURE p ()\nLANGUAGE SQL\nBEGIN\n  UPDATE t SET a = 1;\n  DELETE FROM u;\nEND";

    await runner.run({ sql, offset: 0, engine: 3 });

    expect(api.calls).toEqual([]);
    expect(runner.getState()).toEqual({ status: "notice", message: `A seleção tem 3 comandos, e Executar leva um só: selecione um ou ponha o cursor nele. Para executar todos, um depois do outro, use Executar script (${platformScriptShortcut}).` });
  });
});

describe("\"executar de novo\" executa o comando do resultado que está na tela, nunca outro", () => {
  type Context = Awaited<ReturnType<typeof withResult>>;

  /** Cada caso tenta um comando que grava (`delete from t`) e é recusado antes de a API aceitar; as linhas do `select` ficam na tela. */
  const refusals: [string, (context: Context) => Promise<unknown>][] = [
    ["seleção com mais de um comando", async ({ runner }) => runner.run({ sql: "delete from t; delete from u", offset: 0 })],
    [
      "SESSION_BUSY",
      async ({ api, runner }) => {
        api.on(`POST ${sessions}/s1/queries`, problem(409, "SESSION_BUSY"));
        await runner.run({ sql: "delete from t", offset: 0 });
      },
    ],
    [
      "controle de transação",
      async ({ api, runner }) => {
        api.on(`POST ${sessions}/s1/queries`, problem(422, "TRANSACTION_CONTROL_NOT_SUPPORTED"));
        await runner.run({ sql: "commit", offset: 0 });
      },
    ],
    // Sem resposta combinada, o `fetch` falha: é a API fora do ar.
    ["erro de rede", async ({ runner }) => runner.run({ sql: "delete from t", offset: 0 })],
    [
      "RESPONSE_INVALID",
      async ({ api, runner }) => {
        api.on(`POST ${sessions}/s1/queries`, json({ inesperado: true }));
        await runner.run({ sql: "delete from t", offset: 0 });
      },
    ],
    [
      "500",
      async ({ api, runner }) => {
        api.on(`POST ${sessions}/s1/queries`, problem(500, "INTERNAL_SERVER_ERROR"));
        await runner.run({ sql: "delete from t", offset: 0 });
      },
    ],
    [
      "falha ao abrir a sessão",
      async ({ api, runner }) => {
        runner.release();
        api.on(`POST ${sessions}`, problem(422, "DATABASE_CONNECTION_FAILED", { detail: "FATAL: fora do ar" }));
        await runner.run({ sql: "delete from t", offset: 0 });
      },
    ],
    [
      "cancelado antes de enviar",
      async ({ api, runner }) => {
        runner.release();
        const opening = deferred<Response>();
        api.on(`POST ${sessions}`, opening.promise);
        const running = runner.run({ sql: "delete from t", offset: 0 });
        await runner.cancel();
        opening.resolve(session("s1"));
        await running;
      },
    ],
  ];

  it.each(refusals)("depois de %s, repete o `select` que gerou as linhas, e não o comando recusado", async (_name, refuse) => {
    const context = await withResult();
    const { api, runner } = context;

    await refuse(context);
    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"]] });

    // Com a aba solta no caso, a sessão é aberta de novo; nos outros a resposta combinada sobra.
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.rerun();

    expect(api.calls.at(-1)).toEqual({ method: "POST", path: `${sessions}/s1/queries`, body: { sql: "select * from t" } });
  });

  it("a aba que chegou de outra janela (RN-ABAS-002) mostra o resultado que trouxe, sem executar, e \"Carregar mais\" continua no cursor da sessão dela", async () => {
    const { result } = await withResult();
    const api = fakeApi();
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const onSession = vi.fn<(sessionId: string | null) => void>();
    const runner = createQueryRunner({ connectionId: "c1", queryClient: createQueryClient(toast), toast, onSession, initial: { state: result, sessionId: "s1" } });

    expect(runner.getState()).toBe(result);
    expect(runner.sessionOf()).toBe("s1");
    expect(api.calls).toEqual([]);

    api.on(`POST ${sessions}/s1/queries/next`, page([["3", "c"]], { hasMore: false }));
    await runner.loadMore();
    expect(api.routes()).toEqual([`POST ${sessions}/s1/queries/next`]);
    expect(runner.getState()).toMatchObject({ status: "rows", id: result.id, rows: [["1", "a"], ["2", "b"], ["3", "c"]] });

    // O comando seguinte é outro resultado (outra chave de grade), na mesma sessão: nenhuma sessão nova é aberta.
    api.on(`POST ${sessions}/s1/queries`, page([["9", "z"]]));
    await runner.run({ sql: "select 9", offset: 0 });
    expect(runner.getState()).toMatchObject({ status: "rows", id: result.id + 1 });
    expect(onSession).not.toHaveBeenCalled();
  });

  it("o comando recusado nunca é o que \"executar de novo\" envia, mesmo com o cursor fechado depois", async () => {
    const { api, runner } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, problem(409, "SESSION_BUSY"));
    await runner.run({ sql: "delete from t", offset: 0 });
    api.on(`POST ${sessions}/s1/queries/next`, problem(409, "NO_OPEN_CURSOR"));
    await runner.loadMore();
    expect(runner.getState()).toMatchObject({ status: "rows", cursorClosed: true });

    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.rerun();

    const sent = api.calls.filter((call) => call.path.endsWith("/queries")).map((call) => (call.body as { sql: string }).sql);
    expect(sent).toEqual(["select * from t", "delete from t", "select * from t"]);
  });

  it("sem linhas na tela não há o que executar de novo", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, json({ columns: null, rows: null, hasMore: false, elapsedMs: 12, truncatedCells: null, rowsAffected: 3 }));
    await runner.run({ sql: "delete from t", offset: 0 });

    await runner.rerun();

    expect(api.calls.filter((call) => call.path.endsWith("/queries"))).toHaveLength(1);
  });
});

describe("falhas que não são do comando", () => {
  it("falha ao abrir a sessão: a mensagem do banco na área de resultado e o aviso central (RN-SESSAO-003)", async () => {
    const { api, toast, onSession, runner } = setup();
    api.on(`POST ${sessions}`, problem(422, "DATABASE_CONNECTION_FAILED", { detail: 'FATAL: password authentication failed for user "mes"' }));

    await runner.run({ sql: "select 1", offset: 0 });

    // A mensagem é do banco, mas não é resultado de um comando: `connection`, e não `database`.
    expect(runner.getState()).toEqual({ ...databaseError('FATAL: password authentication failed for user "mes"', null, null), source: "connection" });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de DATABASE_CONNECTION_FAILED", 'FATAL: password authentication failed for user "mes"');
    expect(onSession).not.toHaveBeenCalled();
  });

  it("driver do banco não instalado ao abrir a sessão: a frase da API na área de resultado, pronta para 'Instalar driver', e o aviso central (RN-DRIVER-006)", async () => {
    const { api, toast, onSession, runner } = setup();
    api.on(`POST ${sessions}`, problem(422, "DRIVER_NOT_INSTALLED", { detail: "O driver do IBM Data Server não está instalado." }));

    await runner.run({ sql: "select 1", offset: 0 });

    // Não é mensagem do banco nem resultado de comando: `driver`, e a área de resultado oferece o caminho até a tela de Drivers.
    expect(runner.getState()).toEqual({ status: "error", source: "driver", title: workbenchCopy.result.driverMissingTitle, message: "O driver do IBM Data Server não está instalado.", sqlState: null, errorAt: null });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de DRIVER_NOT_INSTALLED", "O driver do IBM Data Server não está instalado.");
    expect(onSession).not.toHaveBeenCalled();
  });

  it("o 422 traz o `driverID` do driver que falta (seção 16): o estado o guarda para a tela de Drivers apontar a linha", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, problem(422, "DRIVER_NOT_INSTALLED", { detail: "O driver do IBM Data Server não está instalado.", driverID: "ibm-data-server" }));

    await runner.run({ sql: "select 1", offset: 0 });

    expect(runner.getState()).toMatchObject({ status: "error", source: "driver", driverID: "ibm-data-server" });
  });

  it("driver não instalado ao executar (removido depois de a sessão abrir): o mesmo estado", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(422, "DRIVER_NOT_INSTALLED", { detail: "O driver do IBM Data Server não está instalado." }));

    await runner.run({ sql: "select 1", offset: 0 });

    expect(runner.getState()).toMatchObject({ status: "error", source: "driver", message: "O driver do IBM Data Server não está instalado." });
  });

  it("driver não instalado com um resultado na tela: o resultado fica, como em qualquer recusa que não deu resultado", async () => {
    const { api, runner, result } = await withResult();
    runner.release();
    api.on(`POST ${sessions}`, problem(422, "DRIVER_NOT_INSTALLED"));

    await runner.run({ sql: "select 2", offset: 0 });

    expect(runner.getState()).toBe(result);
  });

  it("falha que não é do banco, sem resultado na tela: o aviso central, e a área de resultado volta ao começo", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(500, "INTERNAL_SERVER_ERROR"));

    await runner.run({ sql: "select 1", offset: 0 });

    expect(runner.getState()).toEqual({ status: "idle" });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de INTERNAL_SERVER_ERROR", undefined);
  });
});

describe("o resultado na tela só é substituído quando a API aceitou um comando novo", () => {
  it("enquanto o comando novo roda, o resultado anterior continua na tela", async () => {
    const { api, runner, result } = await withResult();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}/s1/queries`, answer.promise);

    const running = runner.run({ sql: "select 2", offset: 0 });
    const state = runner.getState();
    expect(state).toEqual({ status: "running", cancelling: false, previous: result });
    if (state.status === "running") expect(state.previous).toBe(result);

    answer.resolve(page([["9", "z"]], { hasMore: false }));
    await running;
    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["9", "z"]] });
  });

  it("seleção com mais de um comando: o resultado e o cursor ficam como estavam, e sai só o aviso", async () => {
    const { api, toast, runner, result } = await withResult();

    await runner.run({ sql: "select 1; select 2", offset: 0 });

    expect(runner.getState()).toBe(result);
    expect(api.calls).toHaveLength(2);
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.tooManyStatements(platformScriptShortcut));

    // O cursor continua aberto: "carregar mais" segue lendo dele.
    api.on(`POST ${sessions}/s1/queries/next`, page([["3", "c"]], { hasMore: false }));
    await runner.loadMore();
    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"], ["3", "c"]] });
  });

  it("nada para enviar: nem o resultado nem a área vazia mudam, e sai o aviso", async () => {
    const { api, toast, runner, result } = await withResult();

    await runner.run({ sql: "  ;\n -- só um comentário", offset: 0 });

    expect(runner.getState()).toBe(result);
    expect(api.calls).toHaveLength(2);
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.nothingToSend);

    const empty = setup();
    await empty.runner.run({ sql: "", offset: 0 });
    expect(empty.runner.getState()).toEqual({ status: "idle" });
    expect(empty.api.calls).toEqual([]);
    expect(empty.toast.warning).toHaveBeenCalledExactlyOnceWith(copy.nothingToSend);
  });

  it("SESSION_BUSY: o resultado fica, com o aviso central", async () => {
    const { api, toast, runner, result } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, problem(409, "SESSION_BUSY", { detail: "A sessão está executando outro comando." }));

    await runner.run({ sql: "select 2", offset: 0 });

    expect(runner.getState()).toBe(result);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de SESSION_BUSY", "A sessão está executando outro comando.");
  });

  it("TRANSACTION_CONTROL_NOT_SUPPORTED: o resultado fica, e a frase da API vai no aviso de erro", async () => {
    const { api, toast, runner, result } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, problem(422, "TRANSACTION_CONTROL_NOT_SUPPORTED", { detail: "Nesta versão toda sessão é auto-commit." }));

    await runner.run({ sql: "commit", offset: 0 });

    expect(runner.getState()).toBe(result);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de TRANSACTION_CONTROL_NOT_SUPPORTED", "Nesta versão toda sessão é auto-commit.");
  });

  it("TRANSACTION_CONTROL_NOT_SUPPORTED com `executed`: o comando rodou e a API desfez a transação dele, com o cursor anterior fechado; o erro toma o lugar do resultado (RN-SESSAO-005)", async () => {
    const { api, toast, runner } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, problem(422, "TRANSACTION_CONTROL_NOT_SUPPORTED", { detail: transactionControlMessage, executed: true }));

    await runner.run({ sql: "call abre_transacao()", offset: 0 });

    expect(runner.getState()).toEqual(executedError(transactionControlMessage));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);

    // As linhas velhas saíram da tela, e com elas o "carregar mais" do cursor que a API fechou.
    const calls = api.calls.length;
    await runner.loadMore();
    expect(api.calls).toHaveLength(calls);

    // É resultado de um comando que rodou: uma recusa depois dele (vários comandos) o deixa na tela.
    const shown = runner.getState();
    await runner.run({ sql: "select 1; select 2", offset: 0 });
    expect(runner.getState()).toBe(shown);
  });

  it("`executed` que não é `true` não é execução: o resultado fica, como na recusa antes de executar", async () => {
    const { api, runner, result } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, problem(422, "TRANSACTION_CONTROL_NOT_SUPPORTED", { detail: transactionControlMessage, executed: false }));

    await runner.run({ sql: "begin", offset: 0 });

    expect(runner.getState()).toBe(result);
  });

  it("erro de rede: o resultado fica, com o aviso central", async () => {
    const { toast, runner, result } = await withResult();

    // Sem resposta combinada, o `fetch` falha: é a API fora do ar.
    await runner.run({ sql: "select 2", offset: 0 });

    expect(runner.getState()).toBe(result);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Sem resposta da API.", undefined);
  });

  it("RESPONSE_INVALID: o resultado fica, com o aviso central", async () => {
    const { api, toast, runner, result } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, json({ inesperado: true }));

    await runner.run({ sql: "select 2", offset: 0 });

    expect(runner.getState()).toBe(result);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("A API respondeu em um formato inesperado.", undefined);
  });

  it("500: o resultado fica, com o aviso central", async () => {
    const { api, toast, runner, result } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, problem(500, "INTERNAL_SERVER_ERROR"));

    await runner.run({ sql: "select 2", offset: 0 });

    expect(runner.getState()).toBe(result);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de INTERNAL_SERVER_ERROR", undefined);
  });

  it("falha ao abrir a sessão com um resultado na tela (aba desconectada): o resultado fica", async () => {
    const { api, toast, runner } = await withResult();
    runner.release();
    const result = runner.getState();
    api.on(`POST ${sessions}`, problem(422, "DATABASE_CONNECTION_FAILED", { detail: "FATAL: the database system is shutting down" }));

    await runner.run({ sql: "select 2", offset: 0 });

    expect(runner.getState()).toBe(result);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de DATABASE_CONNECTION_FAILED", "FATAL: the database system is shutting down");
  });

  it("erro de SQL: o banco executou o comando novo e fechou o cursor anterior; o erro substitui o resultado", async () => {
    const { api, toast, runner } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: 'ERROR: relation "x" does not exist', sqlState: "42P01", position: 15 }));

    await runner.run({ sql: "select * from x", offset: 0 });

    expect(runner.getState()).toEqual(databaseError('ERROR: relation "x" does not exist', "42P01", 14));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);
  });

  it("cancelado antes de o comando ser enviado (a sessão ainda abria): o resultado fica", async () => {
    const { api, runner } = await withResult();
    runner.release();
    const result = runner.getState();
    const opening = deferred<Response>();
    api.on(`POST ${sessions}`, opening.promise);

    const running = runner.run({ sql: "select 2", offset: 0 });
    await runner.cancel();
    opening.resolve(session("s2"));
    await running;

    expect(runner.getState()).toBe(result);
  });

  it("aba solta no meio de um comando: o resultado anterior continua na tela", async () => {
    const { api, runner, result } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, deferred<Response>().promise);

    void runner.run({ sql: "select pg_sleep(30)", offset: 0 });
    runner.release();

    expect(runner.getState()).toBe(result);
  });
});

describe("linhas afetadas e erro de SQL também são resultado na tela", () => {
  /** Uma aba com "3 linhas afetadas" na área de resultado. */
  async function withAffected() {
    const context = setup();
    context.api.on(`POST ${sessions}`, session("s1"));
    context.api.on(`POST ${sessions}/s1/queries`, json({ columns: null, rows: null, hasMore: false, elapsedMs: 12, truncatedCells: null, rowsAffected: 3 }));
    await context.runner.run({ sql: "update t set a = 1", offset: 0 });
    return { ...context, result: context.runner.getState() };
  }

  /** Uma aba com um erro de SQL na área de resultado, com SQLSTATE e a posição marcada no editor. */
  async function withSqlError() {
    const context = setup();
    context.api.on(`POST ${sessions}`, session("s1"));
    context.api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: 'ERROR: syntax error at or near "form"', sqlState: "42601", position: 10 }));
    await context.runner.run({ sql: "select 1 form t", offset: 20 });
    return { ...context, result: context.runner.getState() };
  }

  type Context = Awaited<ReturnType<typeof withAffected>>;

  const refusals: [string, (context: Context) => Promise<unknown>][] = [
    ["seleção com mais de um comando", async ({ runner }) => runner.run({ sql: "select 1; select 2", offset: 0 })],
    [
      "controle de transação",
      async ({ api, runner }) => {
        api.on(`POST ${sessions}/s1/queries`, problem(422, "TRANSACTION_CONTROL_NOT_SUPPORTED", { detail: "Nesta versão toda sessão é auto-commit." }));
        await runner.run({ sql: "commit", offset: 0 });
      },
    ],
    [
      "SESSION_BUSY",
      async ({ api, runner }) => {
        api.on(`POST ${sessions}/s1/queries`, problem(409, "SESSION_BUSY"));
        await runner.run({ sql: "select 2", offset: 0 });
      },
    ],
    ["erro de rede", async ({ runner }) => runner.run({ sql: "select 2", offset: 0 })],
    [
      "RESPONSE_INVALID",
      async ({ api, runner }) => {
        api.on(`POST ${sessions}/s1/queries`, json({ inesperado: true }));
        await runner.run({ sql: "select 2", offset: 0 });
      },
    ],
    [
      "500",
      async ({ api, runner }) => {
        api.on(`POST ${sessions}/s1/queries`, problem(500, "INTERNAL_SERVER_ERROR"));
        await runner.run({ sql: "select 2", offset: 0 });
      },
    ],
    [
      "falha ao abrir a sessão",
      async ({ api, runner }) => {
        runner.release();
        api.on(`POST ${sessions}`, problem(422, "DATABASE_CONNECTION_FAILED", { detail: "FATAL: fora do ar" }));
        await runner.run({ sql: "select 2", offset: 0 });
      },
    ],
  ];

  it.each([["linhas afetadas", withAffected] as const, ["erro de SQL", withSqlError] as const])("%s na tela e o comando cancelado antes de ser enviado: o resultado continua lá", async (_name, withPrevious) => {
    const { api, runner, result } = await withPrevious();
    runner.release();
    const opening = deferred<Response>();
    api.on(`POST ${sessions}`, opening.promise);

    const running = runner.run({ sql: "select 2", offset: 0 });
    await runner.cancel();
    opening.resolve(session("s2"));
    await running;

    expect(runner.getState()).toBe(result);
  });

  it.each(refusals)("\"3 linhas afetadas\" na tela e %s: a confirmação do que gravou continua lá", async (_name, refuse) => {
    const context = await withAffected();
    expect(context.result).toEqual({ status: "affected", rowsAffected: 3, elapsedMs: 12 });

    await refuse(context);

    expect(context.runner.getState()).toBe(context.result);
    expect(context.toast.warning.mock.calls.length + context.toast.error.mock.calls.length).toBe(1);
  });

  it.each(refusals)("erro de SQL na tela e %s: a mensagem e o SQLSTATE continuam lá", async (_name, refuse) => {
    const context = await withSqlError();
    expect(context.result).toEqual(databaseError('ERROR: syntax error at or near "form"', "42601", 29));
    context.toast.error.mockClear();

    await refuse(context);

    expect(context.runner.getState()).toBe(context.result);
    expect(context.toast.warning.mock.calls.length + context.toast.error.mock.calls.length).toBe(1);
  });

  it("enquanto o comando novo roda, o que estava na tela vai em `previous`", async () => {
    const { api, runner, result } = await withAffected();
    api.on(`POST ${sessions}/s1/queries`, deferred<Response>().promise);

    void runner.run({ sql: "select pg_sleep(30)", offset: 0 });

    expect(runner.getState()).toEqual({ status: "running", cancelling: false, previous: result });
  });

  it("texto alterado com o comando novo rodando: o erro que volta à tela vem sem a posição velha", async () => {
    const { api, runner } = await withSqlError();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}/s1/queries`, answer.promise);

    const running = runner.run({ sql: "select 2", offset: 0 });
    expect(runner.getState()).toMatchObject({ status: "running", previous: { status: "error", errorAt: 29 } });
    runner.textEdited();
    expect(runner.getState()).toMatchObject({ status: "running", previous: { status: "error", errorAt: null } });

    answer.resolve(problem(500, "INTERNAL_SERVER_ERROR"));
    await running;

    expect(runner.getState()).toEqual(databaseError('ERROR: syntax error at or near "form"', "42601", null));
  });

  it("a frase de \"N comandos\" não é resultado: outra recusa ocupa o lugar dela", async () => {
    const { api, runner } = setup();
    await runner.run({ sql: "select 1; select 2", offset: 0 });
    expect(runner.getState()).toMatchObject({ status: "notice" });

    await runner.run({ sql: "select 1; select 2; select 3", offset: 0 });
    expect(runner.getState()).toEqual({ status: "notice", message: `A seleção tem 3 comandos, e Executar leva um só: selecione um ou ponha o cursor nele. Para executar todos, um depois do outro, use Executar script (${platformScriptShortcut}).` });

    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(500, "INTERNAL_SERVER_ERROR"));
    await runner.run({ sql: "select 1", offset: 0 });
    expect(runner.getState()).toEqual({ status: "idle" });
  });

  it("a mensagem da conexão que não abriu também não: a tentativa seguinte mostra a mensagem nova", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, problem(422, "DATABASE_CONNECTION_FAILED", { detail: "FATAL: senha errada" }));
    await runner.run({ sql: "select 1", offset: 0 });
    api.on(`POST ${sessions}`, problem(422, "DATABASE_CONNECTION_FAILED", { detail: "FATAL: o banco está desligando" }));
    await runner.run({ sql: "select 1", offset: 0 });

    expect(runner.getState()).toMatchObject({ status: "error", source: "connection", message: "FATAL: o banco está desligando" });
  });
});

describe("contar total só quando há o que contar", () => {
  it("resultado que veio inteiro: o total é o que está na tela, e a API não é chamada", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"], ["2", "b"]], { hasMore: false }));
    await runner.run({ sql: "select * from t", offset: 0 });

    await runner.countTotal();

    expect(api.calls).toHaveLength(2);
    expect(runner.getState()).toMatchObject({ status: "rows", hasMore: false, counting: false, total: null });
  });

  it("cursor fechado antes do fim: ainda há o que contar", async () => {
    const { api, runner } = await withResult();
    api.on(`POST ${sessions}/s1/queries/next`, problem(409, "NO_OPEN_CURSOR"));
    await runner.loadMore();

    api.on(`POST ${sessions}/s1/queries/count`, json({ total: 1000 }));
    await runner.countTotal();

    expect(runner.getState()).toMatchObject({ status: "rows", cursorClosed: true, total: 1000 });
  });
});

describe("o cache de mutações não guarda as chamadas da aba", () => {
  const cached = (queryClient: ReturnType<typeof createQueryClient>) => queryClient.getMutationCache().getAll();

  it("abrir a sessão e executar não deixam nada no cache: nem as linhas, nem o SQL", async () => {
    const { runner, queryClient } = await withResult();

    expect(runner.getState()).toMatchObject({ status: "rows" });
    await vi.waitFor(() => expect(cached(queryClient)).toEqual([]));
  });

  it("carregar mais, contar total e cancelar também não", async () => {
    const { api, runner, queryClient } = await withResult();
    api.on(`POST ${sessions}/s1/queries/next`, page([["3", "c"]]));
    await runner.loadMore();
    api.on(`POST ${sessions}/s1/queries/count`, json({ total: 1000 }));
    await runner.countTotal();

    const answer = deferred<Response>();
    api.on(`POST ${sessions}/s1/queries`, answer.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));
    const running = runner.run({ sql: "select pg_sleep(30)", offset: 0 });
    await runner.cancel();
    answer.resolve(problem(422, "SQL_EXECUTION_FAILED", { detail: "ERROR: canceling statement due to user request", sqlState: "57014" }));
    await running;

    await vi.waitFor(() => expect(cached(queryClient)).toEqual([]));
  });

  it("a chamada que falha (recusa tratada, ou a que vai ao aviso central) também sai do cache", async () => {
    const { api, runner, queryClient } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, problem(500, "INTERNAL_SERVER_ERROR"));
    await runner.run({ sql: "select 2", offset: 0 });
    api.on(`POST ${sessions}/s1/queries/next`, problem(409, "NO_OPEN_CURSOR"));
    await runner.loadMore();

    await vi.waitFor(() => expect(cached(queryClient)).toEqual([]));
  });

  it("cinquenta execuções seguidas: o cache continua vazio", async () => {
    const { api, runner, queryClient } = await withResult();
    for (let index = 0; index < 50; index++) {
      api.on(`POST ${sessions}/s1/queries`, page([[String(index), "x"]]));
      await runner.run({ sql: `select ${index}`, offset: 0 });
    }

    await vi.waitFor(() => expect(cached(queryClient)).toEqual([]));
  });
});

describe("rede de segurança: um erro qualquer não deixa a aba presa", () => {
  const boom = new Error("falha que ninguém previu");

  it("executar: a chamada lança, a aba sai de \"Executando…\" e avisa", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    vi.mocked(executeQuery).mockRejectedValueOnce(boom);

    await runner.run({ sql: "select 1", offset: 0 });

    expect(runner.getState()).toEqual({ status: "idle" });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Erro inesperado.", undefined);

    // E a aba segue utilizável.
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select 1", offset: 0 });
    expect(runner.getState()).toMatchObject({ status: "rows" });
  });

  it("executar com um resultado na tela: volta a ele", async () => {
    const { runner, result } = await withResult();
    vi.mocked(executeQuery).mockRejectedValueOnce(boom);

    await runner.run({ sql: "select 2", offset: 0 });

    expect(runner.getState()).toBe(result);
  });

  it("carregar mais: a chamada lança, e o botão volta", async () => {
    const { toast, runner } = await withResult();
    vi.mocked(fetchNextPage).mockRejectedValueOnce(boom);

    await runner.loadMore();

    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"]], loadingMore: false, cancelling: false });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Erro inesperado.", undefined);
  });

  it("contar total: a chamada lança, e o botão volta", async () => {
    const { toast, runner } = await withResult();
    vi.mocked(countQueryTotal).mockRejectedValueOnce(boom);

    await runner.countTotal();

    expect(runner.getState()).toMatchObject({ status: "rows", counting: false, cancelling: false, total: null });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Erro inesperado.", undefined);
  });

  it("erro fora da chamada (quem guarda a sessão da aba lança): a aba também não fica presa, e avisa uma vez", async () => {
    const { api, toast, onSession, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    onSession.mockImplementationOnce(() => {
      throw boom;
    });

    await runner.run({ sql: "select 1", offset: 0 });

    expect(runner.getState()).toEqual({ status: "idle" });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.unexpectedError);
  });

  it("exceção tardia de um comando já solto não mexe no comando novo que está em voo", async () => {
    const { api, runner } = setup();
    let failLate!: (error: Error) => void;
    const late = new Promise<never>((_resolve, reject) => (failLate = reject));
    api.on(`POST ${sessions}`, session("s1"));
    const executions = vi.mocked(executeQuery).mock.calls.length;
    vi.mocked(executeQuery).mockImplementationOnce(() => late);

    // O primeiro comando fica em voo, já enviado, e a aba é solta (desconectar, por exemplo).
    const first = runner.run({ sql: "select 1", offset: 0 });
    await vi.waitFor(() => expect(vi.mocked(executeQuery).mock.calls).toHaveLength(executions + 1));
    expect(runner.release()).toEqual({ sessionId: "s1", busy: true });

    // O comando novo abre outra sessão e também fica em voo.
    const answer = deferred<Response>();
    api.on(`POST ${sessions}`, session("s2"));
    api.on(`POST ${sessions}/s2/queries`, answer.promise);
    const second = runner.run({ sql: "select 2", offset: 0 });
    await vi.waitFor(() => expect(api.routes()).toContain(`POST ${sessions}/s2/queries`));

    failLate(boom);
    await first;
    expect(runner.getState()).toEqual({ status: "running", cancelling: false, previous: null });

    answer.resolve(page([["2", "b"]], { hasMore: false }));
    await second;
    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["2", "b"]] });
  });
});

describe("sessão que caiu (seção 7)", () => {
  it("DATABASE_SESSION_NOT_FOUND na execução: abre uma sessão nova, repete uma vez e avisa em atenção", async () => {
    const { api, toast, onSession, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select 1", offset: 0 });

    api.on(`POST ${sessions}/s1/queries`, problem(404, "DATABASE_SESSION_NOT_FOUND"));
    api.on(`POST ${sessions}`, session("s2"));
    api.on(`POST ${sessions}/s2/queries`, page([["2", "b"]]));
    await runner.run({ sql: "select 2", offset: 0 });

    expect(api.routes().slice(2)).toEqual([`POST ${sessions}/s1/queries`, `POST ${sessions}`, `POST ${sessions}/s2/queries`]);
    expect(onSession.mock.calls).toEqual([["s1"], [null], ["s2"]]);
    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["2", "b"]] });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.sessionReopened);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("se a sessão nova também não existe, não repete outra vez: aviso central e estado inicial", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(404, "DATABASE_SESSION_NOT_FOUND"));
    api.on(`POST ${sessions}`, session("s2"));
    api.on(`POST ${sessions}/s2/queries`, problem(404, "DATABASE_SESSION_NOT_FOUND"));

    await runner.run({ sql: "select 1", offset: 0 });

    expect(api.calls).toHaveLength(4);
    expect(runner.getState()).toEqual({ status: "idle" });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de DATABASE_SESSION_NOT_FOUND", undefined);
  });
});

describe("carregar mais (RN-SQL-005, RN-SQL-007)", () => {
  async function withFirstPage(extra: Record<string, unknown> = {}) {
    const context = setup();
    context.api.on(`POST ${sessions}`, session("s1"));
    context.api.on(`POST ${sessions}/s1/queries`, page([["1", "a"], ["2", "b"]], extra));
    await context.runner.run({ sql: "select * from t", offset: 0 });
    return context;
  }

  it("acrescenta as linhas, e os valores cortados da página entram na posição da linha no resultado", async () => {
    const { api, runner } = await withFirstPage({ truncatedCells: [[0, 1]] });
    const first = runner.getState();
    api.on(`POST ${sessions}/s1/queries/next`, page([["3", "c"], ["4", "d"]], { hasMore: false, truncatedCells: [[1, 1]], elapsedMs: 7 }));

    const loading = runner.loadMore();
    expect(runner.getState()).toMatchObject({ status: "rows", loadingMore: true });
    await loading;

    const state = runner.getState();
    expect(state).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"], ["3", "c"], ["4", "d"]], hasMore: false, pages: 2, loadingMore: false, elapsedMs: 42 });
    if (state.status !== "rows" || first.status !== "rows") throw new Error("esperava linhas");
    // As linhas e as colunas que já estavam na tela são os mesmos objetos: a grade não as redesenha.
    expect(state.rows[0]).toBe(first.rows[0]);
    expect(state.columns).toBe(first.columns);
    expect(state.id).toBe(first.id);
    expect([...state.truncated].map(([row, cells]) => [row, [...cells]])).toEqual([[0, [1]], [3, [1]]]);
  });

  it("valores cortados avisam em atenção uma vez por resultado (RN-AVISO-003)", async () => {
    const { api, toast, runner } = await withFirstPage({ truncatedCells: [[0, 1]] });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.valuesTruncated);

    api.on(`POST ${sessions}/s1/queries/next`, page([["3", "c"]], { truncatedCells: [[0, 1]] }));
    await runner.loadMore();
    expect(toast.warning).toHaveBeenCalledOnce();

    api.on(`POST ${sessions}/s1/queries`, page([["9", "z"]], { truncatedCells: [[0, 0]] }));
    await runner.run({ sql: "select * from t", offset: 0 });
    expect(toast.warning).toHaveBeenCalledTimes(2);
  });

  it("NO_OPEN_CURSOR: as linhas ficam, a área de resultado oferece executar de novo e sai o aviso de atenção", async () => {
    const { api, toast, runner } = await withFirstPage();
    api.on(`POST ${sessions}/s1/queries/next`, problem(409, "NO_OPEN_CURSOR"));

    await runner.loadMore();

    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"]], cursorClosed: true, loadingMore: false });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.cursorClosed);
    expect(toast.error).not.toHaveBeenCalled();

    // "Executar de novo" repete o comando que deu este resultado.
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.rerun();
    expect(api.calls.at(-1)).toEqual({ method: "POST", path: `${sessions}/s1/queries`, body: { sql: "select * from t" } });
    expect(runner.getState()).toMatchObject({ status: "rows", cursorClosed: false, pages: 1 });
  });

  it("carregar mais cancelado: as linhas ficam, o cursor fechou na API e a tela oferece executar de novo, não mais \"Carregar mais\" (D4)", async () => {
    const { api, toast, runner } = await withFirstPage();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}/s1/queries/next`, answer.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));

    const loading = runner.loadMore();
    await runner.cancel();
    answer.resolve(problem(422, "SQL_EXECUTION_FAILED", afterCancel.postgresCanceled));
    await loading;

    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"]], cursorClosed: true, loadingMore: false, cancelling: false });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.commandCancelled);
    expect(toast.error).not.toHaveBeenCalled();

    // "Executar de novo" repete o comando que deu estas linhas.
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.rerun();
    expect(api.calls.at(-1)).toEqual({ method: "POST", path: `${sessions}/s1/queries`, body: { sql: "select * from t" } });
    expect(runner.getState()).toMatchObject({ status: "rows", cursorClosed: false, pages: 1 });
  });

  /** "Carregar mais" cancelado pelo usuário; a API responde `answer`. */
  async function loadMoreCancelledWith(answer: Response) {
    const context = await withFirstPage();
    const response = deferred<Response>();
    context.api.on(`POST ${sessions}/s1/queries/next`, response.promise);
    context.api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));

    const loading = context.runner.loadMore();
    await context.runner.cancel();
    response.resolve(answer);
    await loading;
    return context;
  }

  it("carregar mais cancelado com a leitura cortada pelo driver da IBM (`canceled`, sem SQLSTATE): \"Comando cancelado.\", e o cursor fechou", async () => {
    const { toast, runner } = await loadMoreCancelledWith(problem(422, "SQL_EXECUTION_FAILED", afterCancel.notSentOrCutRead));

    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"]], cursorClosed: true, loadingMore: false, cancelling: false });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.commandCancelled);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("carregar mais com o desfecho incerto (`unknown`): as linhas ficam, o cursor fechou, e o aviso curto leva o detalhe da API; nunca \"Comando cancelado.\"", async () => {
    const { toast, runner } = await loadMoreCancelledWith(problem(422, "SQL_EXECUTION_FAILED", afterCancel.sessionLost));

    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"]], cursorClosed: true, loadingMore: false, cancelling: false });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(outcomeCopy.unknown, afterCancel.sessionLost.detail);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("carregar mais cancelado que termina num erro sem `outcome` é erro do banco: o aviso central, e não \"Comando cancelado.\"", async () => {
    const { toast, runner } = await loadMoreCancelledWith(problem(422, "SQL_EXECUTION_FAILED", { detail: "division by zero", sqlState: "22012" }));

    expect(runner.getState()).toMatchObject({ status: "rows", cursorClosed: true, loadingMore: false, cancelling: false });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de SQL_EXECUTION_FAILED", "division by zero");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("carregar mais que o banco recusa, sem cancelar: as linhas ficam, o cursor está fechado, e o aviso de erro é o central, sem um segundo aviso", async () => {
    const { api, toast, runner } = await withFirstPage();
    api.on(`POST ${sessions}/s1/queries/next`, problem(422, "SQL_EXECUTION_FAILED", { detail: "ERROR: division by zero", sqlState: "22012" }));

    await runner.loadMore();

    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"]], cursorClosed: true, loadingMore: false });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de SQL_EXECUTION_FAILED", "ERROR: division by zero");
    expect(toast.warning).not.toHaveBeenCalled();

    // Fechado, "carregar mais" não vai à API (o botão nem aparece).
    const calls = api.calls.length;
    await runner.loadMore();
    expect(api.calls).toHaveLength(calls);
  });

  it("sessão que já não existe ao carregar mais: o cursor foi com ela, e a próxima execução abre outra", async () => {
    const { api, onSession, runner } = await withFirstPage();
    api.on(`POST ${sessions}/s1/queries/next`, problem(404, "DATABASE_SESSION_NOT_FOUND"));

    await runner.loadMore();

    expect(runner.getState()).toMatchObject({ status: "rows", cursorClosed: true });
    expect(onSession).toHaveBeenLastCalledWith(null);
  });
});

describe("contar total (RN-SQL-006)", () => {
  it("só conta quando pedido, e guarda o total no resultado", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select * from t", offset: 0 });
    expect(api.routes()).not.toContain(`POST ${sessions}/s1/queries/count`);

    api.on(`POST ${sessions}/s1/queries/count`, json({ total: 1000 }));
    const counting = runner.countTotal();
    expect(runner.getState()).toMatchObject({ status: "rows", counting: true, total: null });
    await counting;

    expect(runner.getState()).toMatchObject({ status: "rows", counting: false, total: 1000 });
  });

  it("recusado pelo banco: aviso de erro com a mensagem do banco, e o resultado continua na tela", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select * from t for update", offset: 0 });

    api.on(`POST ${sessions}/s1/queries/count`, problem(422, "SQL_EXECUTION_FAILED", { detail: "ERROR: FOR UPDATE is not allowed in subqueries", sqlState: "0A000" }));
    await runner.countTotal();

    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"]], counting: false, total: null });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de SQL_EXECUTION_FAILED", "ERROR: FOR UPDATE is not allowed in subqueries");
  });
});

describe("contar de novo (RN-SQL-006, issue #10)", () => {
  /** Uma aba com linhas na tela e o total já contado (1000). */
  async function counted() {
    const context = await withResult();
    context.api.on(`POST ${sessions}/s1/queries/count`, json({ total: 1000 }));
    await context.runner.countTotal();
    return context;
  }

  it("conta outra vez: o total de antes fica à vista enquanto conta, e o novo toma o lugar dele", async () => {
    const { api, runner } = await counted();
    const answer = deferred<Response>();

    api.on(`POST ${sessions}/s1/queries/count`, answer.promise);
    const counting = runner.countTotal();
    expect(runner.getState()).toMatchObject({ status: "rows", counting: true, total: 1000 });

    answer.resolve(json({ total: 1003 }));
    await counting;

    expect(api.routes().filter((route) => route.endsWith("/queries/count"))).toHaveLength(2);
    expect(runner.getState()).toMatchObject({ status: "rows", counting: false, total: 1003 });
  });

  it("a contagem de novo recusada pelo banco deixa o total de antes, com o aviso central, como a primeira", async () => {
    const { api, toast, runner } = await counted();

    api.on(`POST ${sessions}/s1/queries/count`, problem(422, "SQL_EXECUTION_FAILED", { detail: "ERROR: canceling statement due to statement timeout", sqlState: "57014" }));
    await runner.countTotal();

    expect(runner.getState()).toMatchObject({ status: "rows", counting: false, total: 1000 });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de SQL_EXECUTION_FAILED", "ERROR: canceling statement due to statement timeout");
  });

  it("a contagem de novo cancelada deixa o total de antes, com \"Comando cancelado.\"", async () => {
    const { api, toast, runner } = await counted();
    const answer = deferred<Response>();

    api.on(`POST ${sessions}/s1/queries/count`, answer.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));
    const counting = runner.countTotal();
    await runner.cancel();
    answer.resolve(problem(422, "SQL_EXECUTION_FAILED", afterCancel.postgresCanceled));
    await counting;

    expect(runner.getState()).toMatchObject({ status: "rows", counting: false, cancelling: false, total: 1000 });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.commandCancelled);
  });

  it("com as linhas todas carregadas depois da contagem, o total contado ainda se conta de novo", async () => {
    const { api, runner } = await counted();
    api.on(`POST ${sessions}/s1/queries/next`, page([["3", "c"]], { hasMore: false }));
    await runner.loadMore();

    api.on(`POST ${sessions}/s1/queries/count`, json({ total: 3 }));
    await runner.countTotal();

    expect(runner.getState()).toMatchObject({ status: "rows", hasMore: false, total: 3 });
  });

  it("um comando novo começa sem total: contar de novo é só sobre o total que está na tela", async () => {
    const { api, runner } = await counted();

    api.on(`POST ${sessions}/s1/queries`, page([["9", "z"]], { hasMore: false }));
    await runner.run({ sql: "select * from u", offset: 0 });
    await runner.countTotal();

    expect(api.routes().filter((route) => route.endsWith("/queries/count"))).toHaveLength(1);
    expect(runner.getState()).toMatchObject({ status: "rows", total: null });
  });
});

describe("cancelar (RN-SQL-010)", () => {
  /** Um comando em execução, cancelado pelo usuário; o banco responde `answer` e a promessa devolvida termina com o comando. */
  async function cancelledWith(answer: Response) {
    const context = setup();
    const response = deferred<Response>();
    context.api.on(`POST ${sessions}`, session("s1"));
    context.api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await context.runner.run({ sql: "select 1", offset: 0 });

    context.api.on(`POST ${sessions}/s1/queries`, response.promise);
    context.api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));
    const running = context.runner.run({ sql: "select pg_sleep(30)", offset: 0 });
    await context.runner.cancel();
    expect(context.api.routes().at(-1)).toBe(`POST ${sessions}/s1/queries/cancel`);
    expect(context.runner.getState()).toMatchObject({ status: "running", cancelling: true });

    response.resolve(answer);
    await running;
    return context;
  }

  it("pede o cancelamento à sessão, e o comando cancelado aparece como \"Comando cancelado.\", sem erro do banco, com aviso de atenção (D5)", async () => {
    const { toast, runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", afterCancel.postgresCanceled));

    expect(runner.getState()).toEqual({ status: "cancelled" });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.commandCancelled);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it.each([
    ["o 57014 do Db2", afterCancel.db2Canceled],
    ["o IX000 do Informix (o -213 só a API vê)", afterCancel.informixCanceled],
    ["o comando que nem foi enviado, ou a leitura que o driver da IBM cortou, sem SQLSTATE", afterCancel.notSentOrCutRead],
  ])("quem decide é o `outcome` da API, e não o SQLSTATE nem o texto: %s, com `canceled`, é \"Comando cancelado.\" (Ruling 135)", async (_name, body) => {
    const { toast, runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", body));

    expect(runner.getState()).toEqual({ status: "cancelled" });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.commandCancelled);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("com o pedido feito, um 57014 sem `outcome` é erro do banco: a tela não decide pelo SQLSTATE", async () => {
    const { toast, runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", { detail: "canceling statement due to user request", sqlState: "57014" }));

    expect(runner.getState()).toEqual(databaseError("canceling statement due to user request", "57014", null));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("desfecho incerto (`unknown`, a sessão caiu sem resposta): o detalhe da API como erro do banco e o aviso curto de que o desfecho é incerto; nunca \"Comando cancelado.\"", async () => {
    const { toast, runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", afterCancel.sessionLost));

    expect(runner.getState()).toEqual(databaseError(afterCancel.sessionLost.detail, null, null));
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(outcomeCopy.unknown);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("desfecho incerto com o 57014 do banco (a interrupção que a IBM disse depois de o comando rodar): a mensagem e o SQLSTATE do banco, e o aviso de incerteza", async () => {
    const { toast, runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", afterCancel.ibmInterruptedAfterItRan));

    expect(runner.getState()).toEqual(databaseError(afterCancel.ibmInterruptedAfterItRan.detail, "57014", null));
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(outcomeCopy.unknown);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("cancelado enquanto devolvia as linhas (`partial`): o detalhe da API como erro do banco e o aviso curto de que o que ele gravou ficou", async () => {
    const { toast, runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", afterCancel.partial));

    expect(runner.getState()).toEqual(databaseError(afterCancel.partial.detail, null, null));
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(outcomeCopy.partial);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("um `outcome` que a tela não conhece não é cancelamento: é erro do banco, com o aviso de falha", async () => {
    const { toast, runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", { detail: "Outra coisa.", outcome: "algo-novo" }));

    expect(runner.getState()).toEqual(databaseError("Outra coisa.", null, null));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("o erro do próprio comando que chega com o cancelamento a caminho (sem `outcome`) é erro do banco", async () => {
    const { toast, runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", { detail: "division by zero", sqlState: "22012" }));

    expect(runner.getState()).toEqual(databaseError("division by zero", "22012", null));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("Informix cancelado enquanto devolvia as linhas, com a transação dele desfeita (`executed`): a frase da API no lugar do resultado, e não \"Comando cancelado.\"", async () => {
    const { toast, runner } = await cancelledWith(problem(422, "TRANSACTION_CONTROL_NOT_SUPPORTED", { detail: undoneTransactionMessage, executed: true }));

    expect(runner.getState()).toEqual(executedError(undoneTransactionMessage));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("a marca do cancelamento não vaza para o comando seguinte: o erro dele, sem `outcome`, é erro do banco", async () => {
    const { api, toast, runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", afterCancel.postgresCanceled));
    api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: 'relation "x" does not exist', sqlState: "42P01" }));

    await runner.run({ sql: "select * from x", offset: 0 });

    expect(runner.getState()).toEqual(databaseError('relation "x" does not exist', "42P01", null));
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.commandCancelled);
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);
  });

  it("57014 sem o usuário ter pedido (um timeout do servidor, por exemplo) continua sendo erro do banco, com a mensagem dele e o aviso de falha", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: "ERROR: canceling statement due to statement timeout", sqlState: "57014" }));

    await runner.run({ sql: "select * from grande", offset: 0 });

    expect(runner.getState()).toEqual(databaseError("ERROR: canceling statement due to statement timeout", "57014", null));
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("o pedido de cancelar que não chegou à sessão não é cancelamento: o erro do banco que vier depois é erro", async () => {
    const { api, toast, runner } = setup();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select 1", offset: 0 });

    api.on(`POST ${sessions}/s1/queries`, answer.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, problem(500, "INTERNAL_SERVER_ERROR"));
    const running = runner.run({ sql: "select 1/0", offset: 0 });
    await runner.cancel();
    expect(runner.getState()).toMatchObject({ status: "running", cancelling: false });
    answer.resolve(problem(422, "SQL_EXECUTION_FAILED", { detail: "ERROR: division by zero", sqlState: "22012" }));
    await running;

    expect(runner.getState()).toEqual(databaseError("ERROR: division by zero", "22012", null));
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("o cancelado é resultado como o erro de SQL: uma recusa depois dele (vários comandos) o deixa na tela", async () => {
    const { runner } = await cancelledWith(problem(422, "SQL_EXECUTION_FAILED", afterCancel.postgresCanceled));

    await runner.run({ sql: "select 1; select 2", offset: 0 });

    expect(runner.getState()).toEqual({ status: "cancelled" });
  });

  it("o comando que terminou antes de o cancelamento chegar é dado como concluído: o resultado aparece normalmente", async () => {
    const { api, toast, runner } = setup();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select 1", offset: 0 });

    api.on(`POST ${sessions}/s1/queries`, answer.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));
    const running = runner.run({ sql: "update t set a = 1", offset: 0 });
    await runner.cancel();
    answer.resolve(json({ columns: null, rows: null, hasMore: false, elapsedMs: 12, truncatedCells: null, rowsAffected: 3 }));
    await running;

    expect(runner.getState()).toEqual({ status: "affected", rowsAffected: 3, elapsedMs: 12 });
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Comando executado. 3 linhas afetadas.");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("vale para uma contagem em andamento: cancela, sem aviso de erro e sem mexer no resultado nem no cursor", async () => {
    const { api, toast, runner } = setup();
    const counting = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"], ["2", "b"]]));
    await runner.run({ sql: "select * from t", offset: 0 });
    const before = runner.getState();

    api.on(`POST ${sessions}/s1/queries/count`, counting.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));
    const counted = runner.countTotal();
    await runner.cancel();

    expect(api.routes().at(-1)).toBe(`POST ${sessions}/s1/queries/cancel`);
    expect(runner.getState()).toMatchObject({ status: "rows", counting: true, cancelling: true });

    counting.resolve(problem(422, "SQL_EXECUTION_FAILED", afterCancel.postgresCanceled));
    await counted;

    const after = runner.getState();
    expect(after).toMatchObject({ status: "rows", counting: false, cancelling: false, total: null, hasMore: true, cursorClosed: false });
    if (after.status !== "rows" || before.status !== "rows") throw new Error("esperava linhas");
    expect(after.rows).toBe(before.rows);
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(copy.commandCancelled);

    // O cursor continua aberto: carregar mais segue valendo.
    api.on(`POST ${sessions}/s1/queries/next`, page([["3", "c"]], { hasMore: false }));
    await runner.loadMore();
    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"], ["2", "b"], ["3", "c"]] });
  });

  /** Uma contagem cancelada pelo usuário, sobre linhas com o cursor aberto; a API responde `answer`. */
  async function countCancelledWith(answer: Response) {
    const context = setup();
    const counting = deferred<Response>();
    context.api.on(`POST ${sessions}`, session("s1"));
    context.api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await context.runner.run({ sql: "select * from t", offset: 0 });

    context.api.on(`POST ${sessions}/s1/queries/count`, counting.promise);
    context.api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));
    const counted = context.runner.countTotal();
    await context.runner.cancel();
    counting.resolve(answer);
    await counted;
    return context;
  }

  it("a contagem cancelada que termina num erro sem `outcome` é erro do banco: o aviso central, e não \"Comando cancelado.\"", async () => {
    const { toast, runner } = await countCancelledWith(problem(422, "SQL_EXECUTION_FAILED", { detail: "FOR UPDATE is not allowed in subqueries", sqlState: "0A000" }));

    expect(runner.getState()).toMatchObject({ status: "rows", counting: false, cancelling: false, total: null, cursorClosed: false });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de SQL_EXECUTION_FAILED", "FOR UPDATE is not allowed in subqueries");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("a contagem com o desfecho incerto (`unknown`): o aviso curto com o detalhe da API, sem total e sem mexer no cursor", async () => {
    const { toast, runner } = await countCancelledWith(problem(422, "SQL_EXECUTION_FAILED", afterCancel.sessionLost));

    expect(runner.getState()).toMatchObject({ status: "rows", counting: false, cancelling: false, total: null, cursorClosed: false });
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(outcomeCopy.unknown, afterCancel.sessionLost.detail);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a contagem que terminou antes de o cancelamento chegar mostra o total", async () => {
    const { api, runner } = setup();
    const counting = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select * from t", offset: 0 });

    api.on(`POST ${sessions}/s1/queries/count`, counting.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));
    const counted = runner.countTotal();
    await runner.cancel();
    counting.resolve(json({ total: 1000 }));
    await counted;

    expect(runner.getState()).toMatchObject({ status: "rows", counting: false, cancelling: false, total: 1000 });
  });

  it("enquanto conta, a aba está ocupada: um novo comando e \"carregar mais\" esperam", async () => {
    const { api, runner } = setup();
    const counting = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select * from t", offset: 0 });

    api.on(`POST ${sessions}/s1/queries/count`, counting.promise);
    const counted = runner.countTotal();
    await runner.run({ sql: "select 2", offset: 0 });
    await runner.loadMore();

    expect(api.routes().slice(2)).toEqual([`POST ${sessions}/s1/queries/count`]);
    counting.resolve(json({ total: 7 }));
    await counted;
  });

  it("cancelar com a sessão ainda abrindo: a sessão fica com a aba e o comando não é enviado", async () => {
    const { api, onSession, runner } = setup();
    const opening = deferred<Response>();
    api.on(`POST ${sessions}`, opening.promise);

    const running = runner.run({ sql: "select 1", offset: 0 });
    await runner.cancel();
    opening.resolve(session("s1"));
    await running;

    expect(api.routes()).toEqual([`POST ${sessions}`]);
    expect(onSession).toHaveBeenCalledExactlyOnceWith("s1");
    expect(runner.getState()).toEqual({ status: "idle" });
  });
});

describe("soltar a aba (fechar a aba, desconectar: RN-SESSAO-004)", () => {
  it("devolve a sessão e diz se havia comando rodando; a resposta que chegar depois não muda nada nem reabre a sessão", async () => {
    const { api, toast, onSession, runner } = setup();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, answer.promise);

    const running = runner.run({ sql: "select pg_sleep(30)", offset: 0 });
    await vi.waitFor(() => expect(api.routes()).toContain(`POST ${sessions}/s1/queries`));

    expect(runner.release()).toEqual({ sessionId: "s1", busy: true });
    expect(runner.getState()).toEqual({ status: "idle" });
    expect(runner.release()).toEqual({ sessionId: null, busy: false });

    // Quem soltou fecha a sessão; o comando que rodava responde que ela não existe mais.
    answer.resolve(problem(404, "DATABASE_SESSION_NOT_FOUND"));
    await running;

    expect(api.calls).toHaveLength(2);
    expect(runner.getState()).toEqual({ status: "idle" });
    expect(onSession).toHaveBeenCalledExactlyOnceWith("s1");
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("solta enquanto a sessão abria: a sessão recém-aberta é fechada, para não ficar órfã na API", async () => {
    const { api, onSession, runner } = setup();
    const opening = deferred<Response>();
    api.on(`POST ${sessions}`, opening.promise);
    api.on(`DELETE ${sessions}/s1`, new Response(null, { status: 204 }));

    const running = runner.run({ sql: "select 1", offset: 0 });
    expect(runner.release()).toEqual({ sessionId: null, busy: true });
    opening.resolve(session("s1"));
    await running;

    await vi.waitFor(() => expect(api.routes()).toEqual([`POST ${sessions}`, `DELETE ${sessions}/s1`]));
    expect(onSession).not.toHaveBeenCalled();
  });

  it("depois de solta, as linhas ficam; carregar mais avisa que o cursor foi fechado em vez de chamar a API", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select * from t", offset: 0 });

    runner.release();
    await runner.loadMore();

    expect(api.calls).toHaveLength(2);
    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["1", "a"]], cursorClosed: true });
  });
});

describe("subscribe", () => {
  it("avisa a cada mudança de estado, e para de avisar depois de cancelar a inscrição", async () => {
    const { api, runner } = setup();
    const listener = vi.fn();
    const unsubscribe = runner.subscribe(listener);
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));

    await runner.run({ sql: "select 1", offset: 0 });
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select 1", offset: 0 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("isBusyState: o que o bloqueio por inatividade chama de comando em andamento (RN-SEG-001)", () => {
  const rows = (patch: Partial<Extract<RunnerState, { status: "rows" }>>): RunnerState => ({
    status: "rows",
    id: 1,
    target: { sql: "select 1", offset: 0 },
    columns,
    rows: [],
    truncated: new Map(),
    hasMore: true,
    totalRows: null,
    elapsedMs: 1,
    pages: 1,
    loadingMore: false,
    cancelling: false,
    cursorClosed: false,
    total: null,
    counting: false,
    ...patch,
  } as RunnerState);

  it("executar, carregar mais e contar deixam a aba ocupada", () => {
    expect(isBusyState({ status: "running", cancelling: false, previous: null })).toBe(true);
    expect(isBusyState(rows({ loadingMore: true }))).toBe(true);
    expect(isBusyState(rows({ counting: true }))).toBe(true);
  });

  it("o resto não: nada rodando, o resultado na tela, o erro e o aviso", () => {
    expect(isBusyState({ status: "idle" })).toBe(false);
    expect(isBusyState(rows({}))).toBe(false);
    // Pedir o cancelamento não é rodar: o que roda é o comando, e quem diz isso é `loadingMore` ou `counting`.
    expect(isBusyState(rows({ cancelling: true }))).toBe(false);
    expect(isBusyState({ status: "affected", rowsAffected: 1, elapsedMs: 1 })).toBe(false);
    expect(isBusyState({ status: "cancelled" })).toBe(false);
    expect(isBusyState({ status: "notice", message: "x" })).toBe(false);
    expect(isBusyState({ status: "error", source: "database", title: "t", message: null, sqlState: null, errorAt: null })).toBe(false);
  });

  it("concorda com o executor de verdade: ocupado enquanto o comando roda, livre quando termina", async () => {
    const { api, runner } = setup();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, answer.promise);

    const running = runner.run({ sql: "select 1", offset: 0 });
    expect(isBusyState(runner.getState())).toBe(true);

    answer.resolve(page([["1", "a"]]));
    await running;
    expect(isBusyState(runner.getState())).toBe(false);
  });
});

describe("retire: o executor que saiu de cena de vez (o bloqueio, a aba fechada)", () => {
  // O aposentado que recusa avisa no console (o describe seguinte confere o aviso); aqui o registro fica calado.
  beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => undefined));
  afterEach(() => vi.mocked(console.warn).mockRestore());

  it("recusa executar: não abre sessão, não chama a API e não avisa nada (um painel que ainda o segure por um instante não roda comando órfão)", async () => {
    const { api, toast, runner } = setup();

    runner.retire();
    await runner.run({ sql: "update t set a = 1", offset: 0 });

    expect(api.calls).toEqual([]);
    expect(runner.getState()).toEqual({ status: "idle" });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("recusa também executar de novo, carregar mais e contar o total", async () => {
    const { api, runner } = setup();

    runner.retire();
    await runner.rerun();
    await runner.loadMore();
    await runner.countTotal();

    expect(api.calls).toEqual([]);
  });

  it("devolve o que há para encerrar, como release (a sessão e se havia comando rodando)", async () => {
    const { api, runner } = setup();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, answer.promise);
    const running = runner.run({ sql: "select pg_sleep(30)", offset: 0 });
    await vi.waitFor(() => expect(api.calls).toHaveLength(2));

    expect(runner.retire()).toEqual({ sessionId: "s1", busy: true });

    answer.resolve(page([["1", "a"]]));
    await running;
    // A resposta que ainda estava a caminho chega e não muda nada.
    expect(runner.getState()).toEqual({ status: "idle" });
  });

  it("volta ao começo: as linhas que estavam na tela somem, mesmo numa aba que já não tinha sessão (o 'resultados descartados' do bloqueio)", async () => {
    const { runner } = await withResult();
    expect(runner.getState().status).toBe("rows");

    runner.retire();

    expect(runner.getState()).toEqual({ status: "idle" });
  });

  it("release, ao contrário, deixa o executor em uso: depois de Desconectar, executar de novo abre a sessão nova", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run({ sql: "select 1", offset: 0 });

    runner.release();
    api.on(`POST ${sessions}`, session("s2"));
    api.on(`POST ${sessions}/s2/queries`, page([["2", "b"]]));
    await runner.run({ sql: "select 2", offset: 0 });

    expect(runner.getState()).toMatchObject({ status: "rows", rows: [["2", "b"]] });
    expect(api.routes().slice(2)).toEqual([`POST ${sessions}`, `POST ${sessions}/s2/queries`]);
  });
});

describe("retire: o executor aposentado que recusa avisa no registro, para a regressão não falhar calada", () => {
  const refusals = [
    ["run", (runner: ReturnType<typeof setup>["runner"]) => runner.run({ sql: "update clientes set segredo = 'DADO-DE-BANCO-123'", offset: 0 })],
    ["loadMore", (runner: ReturnType<typeof setup>["runner"]) => runner.loadMore()],
    ["countTotal", (runner: ReturnType<typeof setup>["runner"]) => runner.countTotal()],
  ] as const;

  it.each(refusals)("recusar %s avisa uma vez no console, com o nome da operação e sem SQL nem dado", async (operation, call) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { api, runner } = setup();
    runner.retire();

    await call(runner);
    await call(runner);

    expect(api.calls).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    const text = String(warn.mock.calls[0][0]);
    expect(text).toContain(`"${operation}"`);
    expect(text).not.toMatch(/DADO-DE-BANCO-123|clientes|segredo|update/);
    warn.mockRestore();
  });

  it("o aviso é por operação: recusar run e depois loadMore avisa duas vezes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { runner } = setup();
    runner.retire();

    await runner.run({ sql: "select 1", offset: 0 });
    await runner.loadMore();

    expect(warn.mock.calls.map(([text]) => String(text).match(/recusou "(\w+)"/)?.[1])).toEqual(["run", "loadMore"]);
    warn.mockRestore();
  });

  it("quem não foi aposentado não avisa: nem o que está em uso, nem o ocupado que recusa um segundo comando, nem o solto por release()", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { api, runner } = setup();
    const answer = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, answer.promise);
    const running = runner.run({ sql: "select pg_sleep(30)", offset: 0 });
    await vi.waitFor(() => expect(api.calls).toHaveLength(2));

    // Ocupado: um segundo comando é recusado, e isso não é do aposentado.
    await runner.run({ sql: "select 2", offset: 0 });
    answer.resolve(page([["1", "a"]]));
    await running;

    // Solto por release() (o "Desconectar"), o executor continua em uso.
    runner.release();
    await runner.loadMore();
    await runner.countTotal();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("o resultado da página e a sessão da aba, para a edição dos Registros (seção 22)", () => {
  it("as linhas levam o resultado e o motivo de só leitura que a página trouxe, e a sessão da aba fica legível", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]], { resultID: "r1", editable: { known: true, reason: "DISTINCT" } }));

    expect(runner.sessionOf()).toBeNull();
    await runner.run({ sql: "select distinct 1", offset: 0 });

    expect(runner.getState()).toMatchObject({ status: "rows", resultId: "r1", readOnly: "DISTINCT" });
    expect(runner.sessionOf()).toBe("s1");
  });

  it("carregar mais é o mesmo resultado: o resultado das linhas não muda", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]], { resultID: "r1", editable: { known: false, reason: null } }));
    api.on(`POST ${sessions}/s1/queries/next`, page([["2", "b"]], { hasMore: false, resultID: "r1", editable: { known: false, reason: null } }));

    await runner.run({ sql: "select 1", offset: 0 });
    await runner.loadMore();

    expect(runner.getState()).toMatchObject({ status: "rows", resultId: "r1", readOnly: null, rows: [["1", "a"], ["2", "b"]] });
  });
});

describe("o resultado depois de um Salvar da edição na aba de consulta (RN-EDIT-009)", () => {
  /** A aba com o resultado `r1` na tela; `hasMore` diz se o cursor ficou aberto. */
  async function withEditable(hasMore: boolean) {
    const context = setup();
    context.api.on(`POST ${sessions}`, session("s1"));
    context.api.on(`POST ${sessions}/s1/queries`, page([["1", "a"], ["2", "b"]], { hasMore, resultID: "r1", editable: { known: false, reason: null } }));
    await context.runner.run({ sql: "select * from t", offset: 0 });
    const before = context.runner.getState();
    if (before.status !== "rows") throw new Error("esperava linhas");
    return { ...context, before };
  }

  const saved = { rows: [["1", "x"], ["3", null]], truncated: new Map<number, ReadonlySet<number>>(), generated: new Map([[1, new Set([1])]]) };

  it("as linhas salvas tomam o lugar das lidas sem executar nada, a grade é a mesma, e o cursor que estava aberto fechou: a área oferece executar de novo", async () => {
    const { api, runner, before } = await withEditable(true);
    const sent = api.calls.length;

    runner.keepSaved("r1", saved);

    expect(runner.getState()).toMatchObject({ status: "rows", id: before.id, resultId: "r1", rows: saved.rows, generated: saved.generated, hasMore: true, cursorClosed: true });
    expect(api.calls).toHaveLength(sent);
  });

  it("com todas as linhas já na tela não havia cursor aberto: nada muda além das linhas", async () => {
    const { runner } = await withEditable(false);

    runner.keepSaved("r1", saved);

    expect(runner.getState()).toMatchObject({ status: "rows", rows: saved.rows, hasMore: false, cursorClosed: false });
  });

  it("outro resultado na tela (outro comando executou enquanto salvava), ou um comando em andamento: as linhas salvas não entram", async () => {
    const { api, runner, before } = await withEditable(true);

    runner.keepSaved("r0", saved);
    expect(runner.getState()).toBe(before);

    const reply = deferred<Response>();
    api.on(`POST ${sessions}/s1/queries`, reply.promise);
    const running = runner.run({ sql: "select 2", offset: 0 });
    runner.keepSaved("r1", saved);
    expect(runner.getState()).toMatchObject({ status: "running", previous: before });

    reply.resolve(page([["9", "z"]], { resultID: "r2" }));
    await running;
  });
});

describe("a recusa do somente leitura (RN-PROT-002)", () => {
  const refusal = "A conexão é somente leitura, e só leituras são executadas nela: um DELETE não é leitura. Nada foi enviado ao banco.";

  it("com linhas na tela, elas e o cursor ficam (nada foi ao banco), e a frase da API vai no aviso de erro, sem o aviso central", async () => {
    const { api, toast, runner, result } = await withResult();
    api.on(`POST ${sessions}/s1/queries`, problem(422, "CONNECTION_READ_ONLY", { detail: refusal }));

    await runner.run({ sql: "delete from t", offset: 0 });

    expect(runner.getState()).toBe(result);
    expect(result).toMatchObject({ cursorClosed: false });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith("Título de CONNECTION_READ_ONLY", refusal);
  });

  it("com o cursor aberto, a recusa não o fecha: “Carregar mais” continua lendo", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]], { hasMore: true }));
    await runner.run({ sql: "select * from t", offset: 0 });
    api.on(`POST ${sessions}/s1/queries`, problem(422, "CONNECTION_READ_ONLY", { detail: refusal }));

    await runner.run({ sql: "update t set a = 1", offset: 0 });

    expect(runner.getState()).toMatchObject({ status: "rows", hasMore: true, cursorClosed: false });
  });

  it("sem resultado na tela, a frase da API vai à área de resultado, com o aviso curto", async () => {
    const { api, toast, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(`POST ${sessions}/s1/queries`, problem(422, "CONNECTION_READ_ONLY", { detail: refusal }));

    await runner.run({ sql: "delete from t", offset: 0 });

    expect(runner.getState()).toEqual({ status: "error", source: "api", title: "Título de CONNECTION_READ_ONLY", message: refusal, sqlState: null, errorAt: null });
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(copy.commandFailed);
  });
});
