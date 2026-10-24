import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { numberedScriptQuestion } from "./command-confirmation";
import { gridFilterCopy } from "./grid-filter.copy";
import { applyResultFilter, filterBaseOf } from "./result-filter";
import { entriesOf, entryAt, scriptTotals, type ScriptRun } from "./script-run";
import { createQueryRunner, type DocRange, type RunHooks, type RunnerState, type VariableErrorsState } from "./use-query-runner";
import { variableRunCopy } from "./variable-run.copy";
import { inlineEvaluator } from "./variables/evaluator-inline";
import type { Evaluator } from "./variables/evaluator-host";

// A execução com variáveis no executor da aba (seção 41: RN-VAR-019 a 023 e 033, RN-SQL-009), com a API de mentira e o avaliador no mesmo processo.
const base = "http://127.0.0.1:51234/";
const sessions = "api/user/database-sessions";
const queries = `POST ${sessions}/s1/queries`;
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
  return {
    calls,
    /** O corpo de cada comando enviado, na ordem. */
    sent: () => calls.filter((call) => `${call.method} ${call.path}` === queries).map((call) => call.body as { sql: string; params?: { type: string; value: string | null }[]; filter?: string }),
    on: (route: string, answer: Response | Promise<Response>) => void answers.push({ route, answer }),
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const problem = (status: number, type: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...extra }), { status });
const session = (id: string) => json({ id, database: "mes" }, 201);
const columns = [{ name: "id", type: "int8", kind: "number" }];
const page = (rows: string[][] = [["1"]], extra: Record<string, unknown> = {}) => json({ columns, rows, hasMore: false, elapsedMs: 40, truncatedCells: [], rowsAffected: null, resultID: "r1", ...extra });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

function setup(options: { evaluator?: Evaluator } = {}) {
  const api = fakeApi();
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const runner = createQueryRunner({ connectionId: "c1", queryClient: createQueryClient(toast), toast, onSession: vi.fn(), evaluator: options.evaluator ?? inlineEvaluator(), title: () => "consulta-1.sql" });
  return { api, toast, runner };
}

/** O que o editor entrega: o texto inteiro e o que vai (a seleção `[from, to]`, ou o texto inteiro). */
function range(text: string, from = 0, to = text.length): DocRange {
  return { doc: { text, blankLines: true }, engine: 1, from, to };
}
/** O cursor dentro do primeiro trecho `marker` do texto. */
const cursorIn = (text: string, marker: string): DocRange => range(text, text.indexOf(marker) + 1, text.indexOf(marker) + 1);

const script = (runner: ReturnType<typeof setup>["runner"]): ScriptRun => {
  const run = runner.script.getState();
  if (run === null) throw new Error("esperava um script");
  return run;
};
const errorsOf = (state: RunnerState) => {
  if (state.status !== "variableErrors") throw new Error(`esperava erros das variáveis, veio ${state.status}`);
  return (state as VariableErrorsState).errors;
};

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("Ctrl+Enter numa declaração (RN-VAR-020)", () => {
  it("avalia a declaração, guarda o valor na aba, pede o painel e não toca na API nem no resultado", async () => {
    const { api, runner } = setup();
    const text = "let x = 5\nconst y = x * 2\n\nselect @y;";
    await runner.runItem(cursorIn(text, "const y"));

    expect(api.calls).toEqual([]);
    const { values, counter } = runner.values.snapshot();
    expect([...values.keys()].sort()).toEqual(["x", "y"]);
    expect(values.get("y")?.value).toMatchObject({ kind: "number", value: 10 });
    expect(counter).toBe(2);
    expect(runner.reveal.getState()).toEqual({ serial: 1, name: "y" });
    expect(runner.getState()).toEqual({ status: "idle" });
  });

  it("o cursor na linha em branco logo depois da declaração avalia a declaração", async () => {
    const { runner } = setup();
    const text = "let x = 5\n\nselect @x;";
    await runner.runItem(range(text, 10, 10));
    expect(runner.values.snapshot().values.has("x")).toBe(true);
  });

  it("destaca a declaração avaliada (RN-VAR-025), e o executor diz o trecho dela", async () => {
    const { runner } = setup();
    const flash = vi.fn();
    const text = "let x = 5\nconst y = x * 2\n\nselect @y;";
    await runner.runItem(cursorIn(text, "const y"), { flash });

    expect(flash).toHaveBeenCalledTimes(1);
    expect(flash).toHaveBeenCalledWith({ offset: 10, text: "const y = x * 2" });
  });

  it("a declaração com erro mostra a lista de erros, com a linha, e não guarda nada", async () => {
    const { runner, toast } = setup();
    const text = "let x = 1\nconst y = x.foo\n";
    await runner.runItem(cursorIn(text, "const y"));

    const errors = errorsOf(runner.getState());
    expect(errors).toHaveLength(1);
    expect(errors[0].line).toBe(2);
    expect(toast.error).toHaveBeenCalledWith(variableRunCopy.refused.declaration(1));
    expect(runner.values.snapshot().values.size).toBe(0);
  });
});

describe("Ctrl+Enter num comando com variáveis (RN-VAR-020 e 033)", () => {
  it("troca o @nome pelo marcador, manda os parâmetros e guarda o comando trocado no alvo do resultado", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    const text = "let id = 7\nconst nome = 'Ana'\n\nselect * from pedido where id = @id and nome = @nome;";
    await runner.runItem(cursorIn(text, "select"));

    expect(api.sent()).toEqual([{ sql: "select * from pedido where id = $1 and nome = $2", params: [{ type: "number", value: "7" }, { type: "text", value: "Ana" }] }]);
    const state = runner.getState();
    if (state.status !== "rows") throw new Error("esperava linhas");
    expect(state.target.sql).toBe("select * from pedido where id = @id and nome = @nome;".replace(";", ""));
    expect(state.target.sent?.sql).toBe("select * from pedido where id = $1 and nome = $2");
    expect(state.target.sent?.params.map((parameter) => parameter.variable)).toEqual(["@id", "@nome"]);
  });

  it("destaca o comando que o executor escolheu, e não o que o leitor sem declarações acharia (RN-SQL-018, RN-VAR-025), só quando vai ao banco", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    const text = "let id = 7\nselect * from t where id = @id;";
    const flash = vi.fn();
    const refused = vi.fn();
    await runner.runItem(cursorIn(text, "select"), { confirm: () => Promise.resolve(false), flash: refused });
    expect(refused).not.toHaveBeenCalled();

    await runner.runItem(cursorIn(text, "select"), { flash });
    expect(flash).toHaveBeenCalledTimes(1);
    expect(flash).toHaveBeenCalledWith({ offset: 11, text: "select * from t where id = @id" });
  });

  it("o F5 executa de novo o texto enviado, com os mesmos parâmetros, sem avaliar nada", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    api.on(queries, page());
    const text = "let x = random.int(1, 1000000)\n\nselect @x;";
    await runner.runItem(cursorIn(text, "select"));
    const first = api.sent()[0].params;
    const counter = runner.values.snapshot().counter;

    await runner.rerun();

    expect(api.sent()[1]).toEqual({ sql: "select $1", params: first });
    expect(runner.values.snapshot().counter).toBe(counter);
  });

  it("o valor que a aba já tem serve ao Ctrl+Enter seguinte: o random não muda", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    api.on(queries, page());
    const text = "let x = random.int(1, 1000000)\n\nselect @x;";
    await runner.runItem(cursorIn(text, "select"));
    await runner.runItem(cursorIn(text, "select"));
    const [first, second] = api.sent();
    expect(second.params).toEqual(first.params);
  });

  it("a atribuição desatualizada é avaliada de novo, com as de que depende (x sorteado de novo, y refeito)", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    api.on(queries, page());
    const text = "let x = random.int(1, 1000000)\nconst y = x * 2\n\nselect @y;";
    await runner.runItem(cursorIn(text, "select"));
    const firstY = Number(api.sent()[0].params?.[0].value);

    await runner.runItem(cursorIn(text, "let x"));
    const newX = Number((runner.values.snapshot().values.get("x")?.value as { value: number }).value);
    await runner.runItem(cursorIn(text, "select"));

    const secondY = Number(api.sent()[1].params?.[0].value);
    expect(secondY).toBe(newX * 2);
    expect(newX * 2 === firstY).toBe(false);
  });

  it("o erro do banco aponta o lugar no texto do editor, pelo mapa das posições (RN-SQL-009)", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    // `select * from pedido where id = $1 and nome = $2 and x`: o erro na posição de `x` (1 em diante, no texto enviado).
    api.on(queries, problem(422, "SQL_EXECUTION_FAILED", { detail: "coluna x não existe", sqlState: "42703", position: 54 }));
    const text = "let id = 7\nconst nome = 'Ana'\n\nselect * from pedido where id = @id and nome = @nome and x";
    await runner.runItem(cursorIn(text, "select"));

    const state = runner.getState();
    if (state.status !== "error") throw new Error("esperava erro");
    expect(state.errorAt).toBe(text.length - 1);
  });

  it("a conferência acha o const reatribuído: nada vai à API, e a lista traz a linha", async () => {
    const { api, runner, toast } = setup();
    const text = "const x = 1\nx = 2\n\nselect @x;";
    await runner.runItem(cursorIn(text, "select"));

    expect(api.calls).toEqual([]);
    expect(errorsOf(runner.getState()).map((error) => error.line)).toEqual([2]);
    expect(toast.error).toHaveBeenCalledWith(variableRunCopy.refused.command(1));
  });

  it("a declaração sem valor é recusada com a frase provisória, no lugar", async () => {
    const { runner } = setup();
    const text = "let x: number\n\nselect @x;";
    await runner.runItem(cursorIn(text, "select"));
    expect(errorsOf(runner.getState())[0].message).toContain("não tem valor");
  });

  it("um erro numa declaração que o comando não usa não o impede", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    const text = "let bom = 1\nconst ruim = bom.foo\n\nselect @bom;";
    await runner.runItem(cursorIn(text, "select"));
    expect(api.sent()).toEqual([{ sql: "select $1", params: [{ type: "number", value: "1" }] }]);
  });

  it("a pergunta da proteção traz o comando com os valores como literais, e cancelada nada é enviado", async () => {
    const { api, runner } = setup();
    const questions: unknown[] = [];
    const hooks: RunHooks = {
      confirm: (make) => {
        questions.push(make({ confirm: { level: "all", from: null }, readOnly: null } as never));
        return Promise.resolve(false);
      },
      begin: vi.fn(),
    };
    const text = "let nome = \"O'Neil\"\n\nselect @nome;";
    await runner.runItem(cursorIn(text, "select"), hooks);

    expect(api.calls).toEqual([]);
    expect(hooks.begin).not.toHaveBeenCalled();
    expect(questions[0]).toMatchObject({ kind: "command", command: { sql: "select 'O''Neil'" } });
    expect(runner.values.snapshot().values.size).toBe(0);
  });

  it("a variável sql conta como irreversível na pergunta, e o trecho dela vem marcado", async () => {
    const { runner } = setup();
    let question: unknown;
    const hooks: RunHooks = {
      confirm: (make) => {
        question = make({ confirm: { level: "irreversible", from: null }, readOnly: null } as never);
        return Promise.resolve(false);
      },
    };
    const text = "const filtro: sql = 'id > 3'\n\ndelete from pedido where @filtro;";
    await runner.runItem(cursorIn(text, "delete"), hooks);

    expect(question).toMatchObject({ kind: "command", command: { sql: "delete from pedido where id > 3", irreversible: { kind: "sqlVariable", target: "@filtro" }, ranges: [{ start: 25, end: 31 }] } });
  });
});

describe("Alt+X com variáveis (RN-VAR-019, 022 e 023)", () => {
  it("avalia tudo uma vez, executa cada item na vez dele com os valores daquele ponto, e as Estatísticas separam os totais", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    api.on(queries, page());
    const text = "let x = 1\nselect @x;\nx = 2\nselect @x;";
    await runner.runScriptDoc(range(text));

    expect(api.sent().map((body) => body.params?.[0].value)).toEqual(["1", "2"]);
    const run = script(runner);
    expect(entriesOf(run).map((entry) => [entry.kind, entry.status])).toEqual([
      ["declaration", "ok"],
      ["statement", "ok"],
      ["declaration", "ok"],
      ["statement", "ok"],
    ]);
    expect(scriptTotals(run)).toMatchObject({ ok: 2, total: 2, declarationsOk: 2, declarations: 2, errors: 0 });
    expect(runner.values.snapshot().values.get("x")?.value).toMatchObject({ value: 2 });
    expect(entryAt(run, 1).target.sent?.sql).toBe("select $1");
  });

  it("os valores que a aba já tinha não servem: o random sorteia de novo a cada Alt+X", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    api.on(queries, page());
    const text = "let x = random.int(1, 1000000000)\nselect @x;";
    await runner.runScriptDoc(range(text));
    await runner.runScriptDoc(range(text));
    const [first, second] = api.sent();
    expect(second.params).not.toEqual(first.params);
  });

  it("os erros da conferência impedem o script inteiro: nada é executado, e a lista diz a linha", async () => {
    const { api, runner, toast } = setup();
    const text = "const a = 1\na = 2\nlet b: number\nselect @a;";
    await runner.runScriptDoc(range(text));

    expect(api.calls).toEqual([]);
    expect(errorsOf(runner.getState()).map((error) => error.line)).toEqual([2, 3]);
    expect(toast.error).toHaveBeenCalledWith(variableRunCopy.refused.script(2));
    expect(runner.script.getState()).toBeNull();
  });

  it("a pergunta da proteção vem depois da avaliação, com os valores calculados, uma vez; cancelada, nada roda", async () => {
    const { api, runner } = setup();
    let asked: unknown;
    const hooks: RunHooks = {
      confirm: (make) => {
        asked = make({ confirm: { level: "all", from: null }, readOnly: null } as never);
        return Promise.resolve(false);
      },
      begin: vi.fn(),
    };
    const text = "const x = 3 * 4\nselect @x;\nselect 2;";
    await runner.runScriptDoc(range(text), hooks);

    expect(api.calls).toEqual([]);
    expect(hooks.begin).not.toHaveBeenCalled();
    expect(runner.script.getState()).toBeNull();
    expect(asked).toMatchObject({ kind: "script", total: 3, commands: [{ number: 2, sql: "select 12" }, { number: 3, sql: "select 2" }] });
    expect(runner.values.snapshot().values.size).toBe(0);
  });

  it("confirmada, o begin roda e o script segue sem perguntar de novo", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    const hooks: RunHooks = { confirm: () => true, begin: vi.fn() };
    await runner.runScriptDoc(range("const x = 1\nselect @x;"), hooks);
    expect(hooks.begin).toHaveBeenCalledTimes(1);
    expect(api.sent()).toHaveLength(1);
  });

  it("a seleção que usa um @nome declarado acima dela usa o valor da aba, avaliado antes, fora das Estatísticas", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    const text = "const x = 41 + 1\n\nselect @x;\nselect 2;";
    const from = text.indexOf("select @x");
    await runner.runScriptDoc(range(text, from, from + "select @x;".length));

    expect(api.sent()).toEqual([{ sql: "select $1", params: [{ type: "number", value: "42" }] }]);
    expect(entriesOf(script(runner))).toHaveLength(1);
    expect(runner.values.snapshot().values.has("x")).toBe(true);
  });

  it("o script só de declarações avalia, deixa o resultado de antes e pede o painel", async () => {
    const { api, runner } = setup();
    await runner.runScriptDoc(range("let a = 1\nlet b = a + 1"));

    expect(api.calls).toEqual([]);
    expect(scriptTotals(script(runner))).toMatchObject({ total: 0, declarations: 2, declarationsOk: 2 });
    expect(runner.reveal.getState().serial).toBe(1);
    expect(runner.getState()).toEqual({ status: "idle" });
  });

  it("o Cancelar com o comando parametrizado em andamento: o comando fica cancelado, o seguinte não roda, e as declarações já avaliadas ficam na aba (RN-SQL-022)", async () => {
    const { api, runner, toast } = setup();
    const hanging = deferred<Response>();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, hanging.promise);
    api.on(`POST ${sessions}/s1/queries/cancel`, new Response(null, { status: 204 }));
    const text = "let x = 3\nconst y = x * 2\n\nselect pg_sleep(@y);\nselect @x;";
    const done = runner.runScriptDoc(range(text));
    await vi.waitFor(() => expect(api.sent()).toHaveLength(1));

    // O comando está no banco: com os parâmetros da avaliação, e o executor ocupado.
    expect(api.sent()[0]).toEqual({ sql: "select pg_sleep($1)", params: [{ type: "number", value: "6" }] });
    expect(entriesOf(script(runner)).map((entry) => entry.status)).toEqual(["ok", "ok", "running", "pending"]);

    await runner.cancel();
    hanging.resolve(problem(422, "SQL_EXECUTION_FAILED", { detail: "canceling statement due to user request", sqlState: "57014", outcome: "canceled" }));
    await done;

    expect(api.calls.filter((call) => call.path === `${sessions}/s1/queries/cancel`)).toHaveLength(1);
    expect(api.sent()).toHaveLength(1);
    expect(entriesOf(script(runner)).map((entry) => [entry.kind, entry.status])).toEqual([
      ["declaration", "ok"],
      ["declaration", "ok"],
      ["statement", "cancelled"],
      ["statement", "notRun"],
    ]);
    expect(script(runner).phase).toBe("cancelled");
    expect(runner.getState()).toEqual({ status: "cancelled" });
    expect(toast.warning).toHaveBeenCalledTimes(1);
    // O que foi avaliado antes do comando fica à mostra no painel Variáveis; o cancelamento não esquece nada.
    expect([...runner.values.snapshot().values.keys()].sort()).toEqual(["x", "y"]);
    expect(runner.values.snapshot().values.get("y")?.value).toMatchObject({ value: 6 });
  });

  it("o QUERY_PARAMETERS_MISMATCH é erro do comando: a pergunta de erro tem as quatro escolhas", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, problem(422, "QUERY_PARAMETERS_MISMATCH", { detail: "O comando tem 2 marcadores, e vieram 1 valores.", markers: 2, values: 1 }));
    const done = runner.runScriptDoc(range("let x = 1\nselect @x;"));
    await vi.waitFor(() => expect(script(runner).phase).toBe("paused"));
    expect(entryAt(script(runner), 1).kind).toBe("statement");
    runner.script.decide("stop");
    await done;
    expect(entryAt(script(runner), 1).error?.message).toContain("2 marcadores");
  });

  it("o Ctrl+Enter que só avalia ou que o executor recusa deixa a pergunta de erro do script esperando; o que vai ao banco responde Parar (RN-SQL-021)", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, problem(422, "QUERY_PARAMETERS_MISMATCH", { detail: "O comando tem 2 marcadores, e vieram 1 valores.", markers: 2, values: 1 }));
    const done = runner.runScriptDoc(range("let x = 1\nselect @x;"));
    await vi.waitFor(() => expect(script(runner).phase).toBe("paused"));
    let finished = false;
    void done.then(() => (finished = true));

    // Uma declaração só avalia; o erro de variável e o "Nada a enviar" são recusas: nada foi enviado, e a pergunta segue esperando.
    await runner.runItem(cursorIn("let z = 3\n", "let z"));
    await Promise.resolve();
    expect(finished, "declaração").toBe(false);
    await runner.runItem(cursorIn("let z = 3\nconst y = z.foo\nselect @y;", "select"));
    await Promise.resolve();
    expect(finished, "erro").toBe(false);
    await runner.runItem(range("let z = 3\n-- nada\n", 18, 18));
    await Promise.resolve();
    expect(finished, "nada").toBe(false);
    expect(script(runner).phase).toBe("paused");

    // O comando que vai mesmo ao banco responde "Parar" e então executa.
    api.on(queries, page());
    await runner.runItem(cursorIn("let z = 3\nselect @z;", "select"));
    await done;
    expect(finished).toBe(true);
    expect(runner.script.getState()).toBeNull();
    expect(api.sent().at(-1)).toEqual({ sql: "select $1", params: [{ type: "number", value: "3" }] });
  });

  it("o erro numa declaração só deixa Parar e Tentar de novo: tentar de novo avalia a declaração outra vez", async () => {
    const real = inlineEvaluator();
    let calls = 0;
    // A primeira avaliação não devolve o valor da declaração (como se ela dependesse do banco); a segunda falha; a terceira acerta.
    const evaluator: Evaluator = {
      async evaluate(request) {
        calls++;
        if (calls === 1) return { kind: "done", items: [], counter: request.counter, tab: [] };
        if (calls === 2) return { kind: "done", items: [{ index: request.indices[0], result: { ok: false, error: { message: "A consulta falhou.", offset: 0, line: 1, column: 1, itemIndex: request.indices[0] } } }], counter: request.counter, tab: [] };
        return real.evaluate(request);
      },
      dispose() {},
    };
    const { runner } = setup({ evaluator });
    const done = runner.runScriptDoc(range("let total = 5"));

    await vi.waitFor(() => expect(script(runner).phase).toBe("paused"));
    expect(entryAt(script(runner), 0)).toMatchObject({ kind: "declaration", status: "error", error: { message: "A consulta falhou." } });
    runner.script.decide("retry");
    await done;

    expect(entryAt(script(runner), 0).status).toBe("ok");
    expect(runner.values.snapshot().values.get("total")?.value).toMatchObject({ value: 5 });
  });
});

/** O resultado de um comando com variáveis na tela: `let id = 7` e `select … where id = @id`. */
async function withResult(extra: { rows?: Response[] } = {}) {
  const context = setup();
  context.api.on(`POST ${sessions}`, session("s1"));
  context.api.on(queries, page());
  for (const answer of extra.rows ?? []) context.api.on(queries, answer);
  const text = "let id = 7\n\nselect * from pedido where id = @id and nome = 'x';";
  await context.runner.runItem(cursorIn(text, "select"));
  const state = context.runner.getState();
  if (state.status !== "rows") throw new Error("esperava linhas");
  return { ...context, state, text };
}

describe("o filtro do resultado de um comando com variáveis (RN-GRADE-011 e RN-VAR-033)", () => {
  const sentText = "select * from pedido where id = $1 and nome = 'x'";
  const params = [{ type: "number", value: "7" }];

  it("o pedido leva o texto enviado, os mesmos parâmetros e o filtro; nada é avaliado de novo, e o alvo do resultado guarda os três", async () => {
    const { api, runner, state } = await withResult({ rows: [page([["2"]], { filterApplied: "merged" })] });
    const counter = runner.values.snapshot().counter;

    const base = filterBaseOf(state, null);
    expect(base?.sent?.sql).toBe(sentText);
    await runner.run({ ...(base as NonNullable<typeof base>), filter: "id > 3 ORDER BY id DESC" });

    expect(api.sent()[1]).toEqual({ sql: sentText, params, filter: "id > 3 ORDER BY id DESC" });
    expect(runner.values.snapshot().counter).toBe(counter);
    const after = runner.getState();
    if (after.status !== "rows") throw new Error("esperava linhas");
    expect(after.filterApplied).toBe("merged");
    expect(after.target.filter).toBe("id > 3 ORDER BY id DESC");
    expect(after.target.sent?.sql).toBe(sentText);
    expect(after.target.sent?.params.map((parameter) => parameter.value)).toEqual(["7"]);
    expect(after.target.sql).toBe("select * from pedido where id = @id and nome = 'x'");

    // O F5 com o filtro em vigor repete o texto enviado, os parâmetros e o filtro.
    api.on(queries, page([["2"]], { filterApplied: "merged" }));
    await runner.rerun();
    expect(api.sent()[2]).toEqual({ sql: sentText, params, filter: "id > 3 ORDER BY id DESC" });
  });

  it("o @nome escrito no filtro não é variável: vai como está, sem avaliar nem trocar, e os parâmetros são os do comando", async () => {
    const { api, runner, state } = await withResult({ rows: [page([["2"]], { filterApplied: "merged" })] });
    const base = filterBaseOf(state, null) as NonNullable<ReturnType<typeof filterBaseOf>>;

    await runner.run({ ...base, filter: "nome = @id" });

    expect(api.sent()[1]).toEqual({ sql: sentText, params, filter: "nome = @id" });
  });

  it("o filtro com marcador de parâmetro é recusado pela API (FILTER_INVALID): o resultado de antes fica, a frase vai ao campo e o filtro em vigor volta ao de antes", async () => {
    const { api, runner, state, toast } = await withResult();
    api.on(queries, problem(422, "FILTER_INVALID", { detail: "O filtro não pode ter marcador de parâmetro ($1)." }));

    const calls: string[] = [];
    const deps = {
      setDraft: (text: string) => calls.push(`draft:${text}`),
      setApplied: (text: string) => calls.push(`applied:${text}`),
      setProblem: (value: { message: string } | null) => calls.push(`problem:${value?.message ?? "-"}`),
      setPinned: () => calls.push("pinned"),
      run: (target: Parameters<typeof runner.run>[0]) => runner.run(target),
    };
    await applyResultFilter(filterBaseOf(state, null), "id = $1", "", state, deps);

    expect(api.sent()[1]).toEqual({ sql: sentText, params, filter: "id = $1" });
    expect(runner.getState()).toBe(state);
    expect(calls.at(-2)).toBe("problem:O filtro não pode ter marcador de parâmetro ($1).");
    expect(calls.at(-1)).toBe("applied:");
    expect([...toast.error.mock.calls, ...toast.warning.mock.calls]).toEqual([]);

    // O F5 depois da recusa executa de novo o comando de antes, sem filtro e com os mesmos parâmetros.
    api.on(queries, page());
    await runner.rerun();
    expect(api.sent()[2]).toEqual({ sql: sentText, params });
  });

  it("a ordem do filtro com o ORDER BY do comando em marcador: a API embrulha (wrapped), e a tela mostra só leitura, com os marcadores e os valores como estavam", async () => {
    const context = setup();
    context.api.on(`POST ${sessions}`, session("s1"));
    context.api.on(queries, page());
    context.api.on(queries, page([["2"]], { filterApplied: "wrapped" }));
    const text = "let col = 2\n\nselect id, nome from pedido order by id + @col;";
    await context.runner.runItem(cursorIn(text, "select"));
    const first = context.runner.getState();
    if (first.status !== "rows") throw new Error("esperava linhas");
    const orderedSent = "select id, nome from pedido order by id + $1";

    await context.runner.run({ ...(filterBaseOf(first, null) as NonNullable<ReturnType<typeof filterBaseOf>>), filter: "ORDER BY nome" });

    // A tela manda o mesmo texto e os mesmos parâmetros; quem decide juntar ou embrulhar é a API.
    expect(context.api.sent()[1]).toEqual({ sql: orderedSent, params: [{ type: "number", value: "2" }], filter: "ORDER BY nome" });
    const after = context.runner.getState();
    if (after.status !== "rows") throw new Error("esperava linhas");
    expect(after).toMatchObject({ filterApplied: "wrapped", readOnly: gridFilterCopy.result.wrapped });
    expect(after.target.sent?.sql).toBe(orderedSent);
    expect(after.target.sent?.params.map((parameter) => parameter.value)).toEqual(["2"]);
  });

  it("limpar o filtro executa de novo o comando sem ele, com o texto enviado e os parâmetros", async () => {
    const { api, runner, state } = await withResult({ rows: [page([["2"]], { filterApplied: "merged" }), page()] });
    const filtered = filterBaseOf(state, null) as NonNullable<ReturnType<typeof filterBaseOf>>;
    await runner.run({ ...filtered, filter: "id > 3" });
    const shown = runner.getState();

    await applyResultFilter(filterBaseOf(shown, null), "", "id > 3", shown, { setDraft: () => {}, setApplied: () => {}, setProblem: () => {}, setPinned: () => {}, run: (target) => runner.run(target) });

    expect(api.sent()[2]).toEqual({ sql: sentText, params });
  });
});

describe("Executar este comando com parâmetros (RN-VAR-033 e RN-SQL-020)", () => {
  /** Um avaliador que conta as chamadas. */
  function counting() {
    const real = inlineEvaluator();
    const evaluator: Evaluator & { calls: number } = {
      calls: 0,
      evaluate(request) {
        evaluator.calls++;
        return real.evaluate(request);
      },
      dispose() {},
    };
    return evaluator;
  }

  it("repete os valores com que o comando rodou no Alt+X, sem avaliar as declarações de novo: o random, o contador e a aba ficam como estavam", async () => {
    const evaluator = counting();
    const { api, runner } = setup({ evaluator });
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    api.on(queries, page());
    api.on(queries, page());
    const text = "let x = random.int(1, 1000000000)\nselect @x;\nselect @x + 1;";
    await runner.runScriptDoc(range(text));
    const [firstSent] = api.sent();
    const target = entryAt(script(runner), 1).target;
    expect(target.sent?.params.map((parameter) => parameter.value)).toEqual([firstSent.params?.[0].value]);

    const evaluations = evaluator.calls;
    const before = runner.values.snapshot();
    await runner.runCommand(target);

    expect(api.sent()[2]).toEqual({ sql: "select $1", params: firstSent.params });
    expect(evaluator.calls).toBe(evaluations);
    const after = runner.values.snapshot();
    expect(after.counter).toBe(before.counter);
    expect(after.values.get("x")?.value).toEqual(before.values.get("x")?.value);
    // O resultado é o do comando executado, com o mesmo alvo (o texto enviado e os parâmetros).
    const state = runner.getState();
    if (state.status !== "rows") throw new Error("esperava linhas");
    expect(state.target.sent?.sql).toBe("select $1");
    expect(state.target.sent?.params.map((parameter) => parameter.value)).toEqual([firstSent.params?.[0].value]);
  });

  it("um alvo com os parâmetros dele manda esses valores, e não os que a aba tem agora para a mesma variável", async () => {
    const evaluator = counting();
    const { api, runner } = setup({ evaluator });
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    api.on(queries, page());
    api.on(queries, page());
    // O comando rodou com `n = 5`; depois a aba passou a ter `n = 9` (outro Ctrl+Enter na declaração).
    await runner.runScriptDoc(range("let n = 5\nselect @n;"));
    const target = entryAt(script(runner), 1).target;
    await runner.runItem(range("let n = 9\n", 0, 0));
    expect(runner.values.snapshot().values.get("n")?.value).toMatchObject({ value: 9 });
    const evaluations = evaluator.calls;

    await runner.runCommand(target);

    expect(api.sent().at(-1)).toEqual({ sql: "select $1", params: [{ type: "number", value: "5" }] });
    expect(evaluator.calls).toBe(evaluations);
    expect(runner.values.snapshot().values.get("n")?.value).toMatchObject({ value: 9 });
  });

  it("o alvo com a lista e o texto também repete tudo: um marcador por item, na ordem", async () => {
    const evaluator = counting();
    const { api, runner } = setup({ evaluator });
    api.on(`POST ${sessions}`, session("s1"));
    api.on(queries, page());
    api.on(queries, page());
    await runner.runScriptDoc(range("const ids = [1, 2, 3]\nconst nome = 'Ana'\nselect * from t where id in (@ids) and nome = @nome;"));
    const target = entryAt(script(runner), 2).target;
    const evaluations = evaluator.calls;

    await runner.runCommand(target);

    const [first, second] = api.sent();
    expect(second).toEqual(first);
    expect(second.sql).toBe("select * from t where id in ($1, $2, $3) and nome = $4");
    expect(second.params).toEqual([{ type: "number", value: "1" }, { type: "number", value: "2" }, { type: "number", value: "3" }, { type: "text", value: "Ana" }]);
    expect(evaluator.calls).toBe(evaluations);
  });
});

describe("os valores da aba saem com o executor (RN-VAR-023 e RN-SEG-001)", () => {
  it("retire() esquece os valores e solta o avaliador; release() (desconectar) não os esquece", async () => {
    const dispose = vi.fn();
    const evaluator = { ...inlineEvaluator(), dispose };
    const { runner } = setup({ evaluator });
    await runner.runItem(range("let x = 1", 0, 0));
    expect(runner.values.snapshot().values.size).toBe(1);

    runner.release();
    expect(runner.values.snapshot().values.size).toBe(1);

    runner.retire();
    expect(runner.values.snapshot().values.size).toBe(0);
    expect(dispose).toHaveBeenCalled();
  });

  it("o executor aposentado não avalia mais nada", async () => {
    const { runner } = setup();
    runner.retire();
    await runner.runItem(range("let x = 1", 0, 0));
    expect(runner.values.snapshot().values.size).toBe(0);
  });

  it("os valores que vieram com a aba ficam à mostra", () => {
    const api = fakeApi();
    void api;
    const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
    const source = createQueryRunner({ connectionId: "c1", queryClient: createQueryClient(toast), toast, onSession: vi.fn(), evaluator: inlineEvaluator() });
    expect(source.values.snapshot().counter).toBe(0);
  });
});

describe("a pergunta numerada do script (RN-PROT-001)", () => {
  it("só os comandos que pedem confirmação, cada um com o número dele no script", () => {
    const protections = { confirm: { level: "irreversible", from: null }, readOnly: null } as never;
    const question = numberedScriptQuestion(protections, [{ number: 2, sql: "delete from t" }, { number: 3, sql: "select 1" }], 3);
    expect(question).toMatchObject({ kind: "script", total: 3, commands: [{ number: 2, sql: "delete from t" }] });
  });
});
