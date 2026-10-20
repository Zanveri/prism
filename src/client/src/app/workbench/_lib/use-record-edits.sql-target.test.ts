import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import type { AutoRefreshBlocker, AutoRefreshState } from "./auto-refresh";
import type { SqlTarget } from "./record-edits.schema";
import type { QueryRunner, RowsState, RunnerState } from "./use-query-runner";

// O alvo `purpose: "sql"` (RN-GRADE-020) do resultado, que o "Gerar SQL", o "Copiar como" e os links de chave estrangeira do resultado (RN-TABELA-007) dividem:
// um pedido à API por resultado e por comando e colunas, pelo gancho da edição com os ganchos do React simulados (`createHookRuntime`). A atualização automática
// e o F5 trazem outro resultado da API com o mesmo comando, e não perguntam de novo.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return {
    ...createHookRuntime(),
    service: { editTargetOrRefuse: vi.fn(), saveEditsOrRefuse: vi.fn(), previewEditsOrRefuse: vi.fn(), sqlTargetOrRefuse: vi.fn() },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    // O terceiro argumento é o `silent`: a falha da chamada não vira aviso (RN-TABELA-007).
    through: vi.fn<(client: unknown, work: () => Promise<unknown>, silent?: boolean) => Promise<unknown>>((_client, work) => work()),
    client: { getQueryData: vi.fn<(key: unknown) => unknown>(() => undefined) },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => rt.client }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: rt.through }));
vi.mock("./record-edits.service", () => rt.service);

import { useRecordEdits } from "./use-record-edits";

const pg: Engine = 1;

const columns: RowsState["columns"] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "status_id", type: "int4", kind: "number" },
];
const sqlTarget: SqlTarget = {
  tables: [{ schema: "loja", name: "pedido", key: [0], editable: true, reason: null, kind: "table", keyColumns: ["id"] }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "status_id", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

function rowsState(over: Partial<RowsState> = {}): RowsState {
  return {
    status: "rows",
    id: 1,
    target: { sql: "select id, status_id from pedido", offset: 0 },
    columns,
    rows: [["1", "10"]],
    truncated: new Map(),
    hasMore: false,
    totalRows: null,
    elapsedMs: 3,
    pages: 1,
    loadingMore: false,
    cancelling: false,
    cursorClosed: false,
    total: null,
    counting: false,
    resultId: "r1",
    ...over,
  };
}

function fakeRunner(initial: RunnerState) {
  const runner = {
    state: initial,
    subscribe: () => () => {},
    getState: (): RunnerState => runner.state,
    sessionOf: () => "s1",
    script: { getState: () => null },
    autoRefresh: { subscribe: () => () => {}, getState: (): AutoRefreshState => ({ status: "off", stopped: null }), blocker: (): AutoRefreshBlocker | null => null, start: vi.fn(), stop: vi.fn(), pause: vi.fn() },
  };
  return runner;
}

/** O que o "Gerar SQL" sabe sem perguntar (`knownSqlTarget`, do contexto da seleção). */
const known = (edits: ReturnType<typeof useRecordEdits>) => edits.selectionContext()!.knownSqlTarget();

function mount(runner: ReturnType<typeof fakeRunner>, over: Partial<Parameters<typeof useRecordEdits>[0]> = {}) {
  const params = { tabId: "t1", runner: runner as unknown as QueryRunner, connectionId: "c1", engine: pg, subject: "result" as const, onSaved: vi.fn(), ...over };
  return { show: () => rt.render(() => useRecordEdits({ ...params, state: runner.state })) };
}

/** A tela mostra outro resultado da API (a atualização automática, o F5): outra execução e outro `resultId`, no comando e nas colunas que se passar. */
function nextResult(runner: ReturnType<typeof fakeRunner>, resultId: string, over: Partial<RowsState> = {}) {
  runner.state = rowsState({ id: Number(resultId.slice(1)), resultId, ...over });
}

beforeEach(() => {
  vi.clearAllMocks();
  rt.service.sqlTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: sqlTarget }));
  rt.client.getQueryData.mockImplementation(() => undefined);
});
afterEach(() => rt.unmount());

describe("sqlTarget: um pedido à API por resultado, e por comando e colunas (RN-GRADE-020 e RN-TABELA-007)", () => {
  it("o mesmo comando e as mesmas colunas num resultado novo (atualização automática, F5) não perguntam de novo, e o Gerar SQL já o sabe sem perguntar", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    expect(known(view.show())).toBeNull();
    expect(await view.show().sqlTarget()).toEqual({ kind: "target", target: sqlTarget });
    nextResult(runner, "r2");
    const edits = view.show();

    expect(known(edits)).toEqual({ kind: "target", target: sqlTarget });
    expect(await edits.sqlTarget()).toEqual({ kind: "target", target: sqlTarget });
    nextResult(runner, "r3");
    await view.show().sqlTarget();

    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(1);
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledWith("s1", "r1", null);
  });

  it("outro texto de comando é outro pedido, e as colunas trocadas (nome, tipo ou ordem) também", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    await view.show().sqlTarget();

    nextResult(runner, "r2", { target: { sql: "select id, status_id from pedido where id > 0", offset: 0 } });
    expect(known(view.show())).toBeNull();
    await view.show().sqlTarget();
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(2);

    nextResult(runner, "r3", { columns: [columns[0], { name: "status_id", type: "int8", kind: "number" }] });
    expect(known(view.show())).toBeNull();
    await view.show().sqlTarget();
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(3);
  });

  it("o filtro do resultado (RN-GRADE-011) muda o comando executado: outro pedido", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    await view.show().sqlTarget();

    nextResult(runner, "r2", { target: { sql: "select id, status_id from pedido", offset: 0, filter: "id > 1" } });
    await view.show().sqlTarget();

    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(2);
  });

  it("a conexão e o banco da aba fazem parte da identidade", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    await view.show().sqlTarget();

    const other = mount(fakeRunner(rowsState({ resultId: "r9" })), { connectionId: "c2" });
    expect(known(other.show())).toBeNull();
  });

  it("a pergunta em andamento vale para o resultado novo do mesmo comando: a atualização automática não acrescenta pedido enquanto a API responde", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    let answer: (value: { ok: true; data: SqlTarget }) => void = () => {};
    rt.service.sqlTargetOrRefuse.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));

    const first = view.show().sqlTarget();
    nextResult(runner, "r2");
    const second = view.show().sqlTarget();
    answer({ ok: true, data: sqlTarget });

    expect(await first).toEqual({ kind: "target", target: sqlTarget });
    expect(await second).toEqual({ kind: "target", target: sqlTarget });
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(1);
  });

  it("a resposta que falhou não fica guardada: a pergunta seguinte vai à API de novo", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    rt.service.sqlTargetOrRefuse.mockImplementationOnce(async () => ({ ok: false, error: { code: "SERVER_ERROR", title: "Falhou", detail: null, extensions: {} } }));

    expect((await view.show().sqlTarget()).kind).toBe("failed");
    nextResult(runner, "r2");
    expect((await view.show().sqlTarget()).kind).toBe("target");

    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(2);
  });

  it("o pedido dos links de chave estrangeira é em silêncio (a falha fora das recusas não vira aviso), e o do Gerar SQL e do Copiar como segue com o aviso", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    await view.show().sqlTarget();
    expect(rt.through.mock.calls.map((call) => call[2])).toEqual([true]);

    nextResult(runner, "r2", { target: { sql: "select id, status_id from pedido where id > 0", offset: 0 } });
    await view.show().selectionContext()!.sqlTarget("Conferindo…");
    expect(rt.through.mock.calls.map((call) => call[2])).toEqual([true, false]);
  });

  it("sem sessão para perguntar, a resposta é a falha, sem pedido nenhum", async () => {
    const runner = fakeRunner(rowsState());
    runner.sessionOf = () => null as unknown as string;
    const view = mount(runner);

    expect((await view.show().sqlTarget()).kind).toBe("failed");
    expect(rt.service.sqlTargetOrRefuse).not.toHaveBeenCalled();
  });
});
