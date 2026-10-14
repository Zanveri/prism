import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/lib/api/query-client";

import { gridFilterCopy } from "./grid-filter.copy";
import { queryResultSchema } from "./query.schema";
import { createQueryRunner } from "./use-query-runner";
import { workbenchCopy } from "./workbench.copy";

// RN-GRADE-011: o filtro do resultado da aba de consulta vai à API com o comando (`filter` no corpo de `POST …/queries`), a página diz como ele entrou
// (`filterApplied`) e o filtro inválido volta 422 `FILTER_INVALID`. A API é simulada pelo `fetch`, como em `use-query-runner.test.ts`: é o contrato que a
// parte da API desta tarefa implementa.
const base = "http://127.0.0.1:51234/";
const sessions = "api/user/database-sessions";
const bridge = { getApiConfig: async () => ({ baseUrl: base.slice(0, -1), token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

type Call = { method: string; path: string; body: unknown };

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

  return { calls, on: (route: string, answer: Response) => void answers.push({ route, answer }) };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const problem = (status: number, type: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ type, title: `Título de ${type}`, status, ...extra }), { status });
const columns = [
  { name: "id", type: "int8", kind: "number" },
  { name: "code", type: "text", kind: "text" },
];
const page = (rows: (string | null)[][], extra: Record<string, unknown> = {}) => json({ columns, rows, hasMore: false, elapsedMs: 4, truncatedCells: [], rowsAffected: null, resultID: "r1", ...extra });

function setup() {
  const api = fakeApi();
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const queryClient = createQueryClient(toast);
  const runner = createQueryRunner({ connectionId: "c1", queryClient, toast, onSession: () => {} });
  api.on(`POST ${sessions}`, json({ id: "s1", database: "mes" }, 201));
  return { api, toast, runner };
}

const command = { sql: "select * from pedidos", offset: 12, engine: 1 as const };

beforeEach(() => vi.stubGlobal("window", { prism: bridge }));
afterEach(() => vi.unstubAllGlobals());

describe("a página diz como o filtro entrou (filterApplied)", () => {
  it("merged e wrapped passam; ausente, nulo ou outro valor viram nulo (a página não é recusada)", () => {
    const body = { columns, rows: [["1", "a"]], hasMore: false, elapsedMs: 1 };

    expect(queryResultSchema.parse({ ...body, filterApplied: "merged" })).toMatchObject({ kind: "rows", filterApplied: "merged" });
    expect(queryResultSchema.parse({ ...body, filterApplied: "wrapped" })).toMatchObject({ kind: "rows", filterApplied: "wrapped" });
    expect(queryResultSchema.parse(body)).toMatchObject({ kind: "rows", filterApplied: null });
    expect(queryResultSchema.parse({ ...body, filterApplied: null })).toMatchObject({ kind: "rows", filterApplied: null });
    expect(queryResultSchema.parse({ ...body, filterApplied: "outro" })).toMatchObject({ kind: "rows", filterApplied: null });
  });
});

describe("o filtro do resultado vai à API junto do comando (RN-GRADE-011)", () => {
  it("com filtro, o corpo leva `sql` e `filter`; sem filtro, só `sql`", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]], { filterApplied: "merged" }));

    await runner.run(command);
    await runner.run({ ...command, filter: `"code" = 'a' ORDER BY "id" DESC` });

    expect(api.calls.filter((call) => call.path.endsWith("/queries")).map((call) => call.body)).toEqual([{ sql: "select * from pedidos" }, { sql: "select * from pedidos", filter: `"code" = 'a' ORDER BY "id" DESC` }]);
  });

  it("o resultado lembra o filtro com o comando: Executar de novo repete os dois, e o texto do editor não muda", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]], { filterApplied: "merged" }));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]], { filterApplied: "merged" }));

    await runner.run({ ...command, filter: "id > 0" });
    expect(runner.getState()).toMatchObject({ status: "rows", target: { ...command, filter: "id > 0" }, filterApplied: "merged", readOnly: null });

    await runner.rerun();
    expect(api.calls.at(-1)?.body).toEqual({ sql: "select * from pedidos", filter: "id > 0" });
  });

  it("o resultado embrulhado (wrapped) é só leitura, e diz por quê; o motivo que a API mandar vale mais", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]], { filterApplied: "wrapped" }));
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]], { filterApplied: "wrapped", editable: { known: true, reason: "união de consultas" } }));

    await runner.run({ ...command, filter: "id > 0" });
    expect(runner.getState()).toMatchObject({ status: "rows", filterApplied: "wrapped", readOnly: gridFilterCopy.result.wrapped });

    await runner.run({ ...command, filter: "id > 0" });
    expect(runner.getState()).toMatchObject({ readOnly: "união de consultas" });
  });

  it("FILTER_INVALID: nada é executado, o resultado de antes fica, a frase da API volta para o campo e não há aviso", async () => {
    const { api, runner, toast } = setup();
    api.on(`POST ${sessions}/s1/queries`, page([["1", "a"]]));
    await runner.run(command);
    const before = runner.getState();

    api.on(`POST ${sessions}/s1/queries`, problem(422, "FILTER_INVALID", { detail: "O filtro tem um terminador de comando (;)." }));
    const refusal = await runner.run({ ...command, filter: "id > 0; drop table t" });

    expect(refusal).toEqual({ code: "FILTER_INVALID", message: "O filtro tem um terminador de comando (;)." });
    expect(runner.getState()).toBe(before);
    expect([...toast.error.mock.calls, ...toast.warning.mock.calls]).toEqual([]);
  });

  it("FILTER_INVALID sem resultado na tela deixa a aba como estava, sem resultado", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}/s1/queries`, problem(422, "FILTER_INVALID", { detail: "O filtro deixa aspas abertas." }));

    expect(await runner.run({ ...command, filter: "code = 'a" })).toEqual({ code: "FILTER_INVALID", message: "O filtro deixa aspas abertas." });
    expect(runner.getState()).toEqual({ status: "idle" });
  });

  it("o erro do banco no comando filtrado não marca o editor: a posição é a do comando que a API montou", async () => {
    const { api, runner } = setup();
    api.on(`POST ${sessions}/s1/queries`, problem(422, "SQL_EXECUTION_FAILED", { detail: 'column "x" does not exist', sqlState: "42703", position: 30 }));

    await runner.run({ ...command, filter: "x = 1" });

    expect(runner.getState()).toMatchObject({ status: "error", source: "database", message: 'column "x" does not exist', sqlState: "42703", errorAt: null });
  });

  it("sem filtro, o FILTER_INVALID não é tratado no lugar: vai ao aviso central, como qualquer recusa que a aba não espera", async () => {
    const { api, runner, toast } = setup();
    api.on(`POST ${sessions}/s1/queries`, problem(422, "FILTER_INVALID", { detail: "x" }));

    expect(await runner.run(command)).toBeUndefined();
    expect(toast.error).toHaveBeenCalled();
    expect(toast.error.mock.calls.flat()).not.toContain(workbenchCopy.toasts.commandFailed);
  });
});
