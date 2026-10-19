import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import type { AutoRefreshBlocker, AutoRefreshState } from "./auto-refresh";
import type { QueryRunner, RowsState, RunnerState } from "./use-query-runner";

// A seleção da grade (RN-GRADE-001) e o que age sobre ela (RN-GRADE-002, 004 e 015, RN-EDIT-004 e 013 a 016), pelo gancho da edição com os ganchos do React
// simulados (`createHookRuntime`): o que se confere é o que ele entrega à grade e à área de resultado, e o que ele faz com a área de transferência, com as
// pendências, com a faixa e com o executor. As decisões puras têm teste próprio (`grid-selection.test.ts`, `grid-copy.test.ts`, `cell-menu.test.ts`).
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return {
    ...createHookRuntime(),
    service: { editTargetOrRefuse: vi.fn(), saveEditsOrRefuse: vi.fn(), previewEditsOrRefuse: vi.fn(), sqlTargetOrRefuse: vi.fn() },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    cells: { resultCells: vi.fn() },
    // O cache da tela: a lista das conexões diz o somente leitura (RN-PROT-002); sem ela, nada.
    client: { getQueryData: vi.fn<(key: unknown) => unknown>(() => undefined) },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => rt.client }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("./record-edits.service", () => rt.service);
vi.mock("./full-values.service", () => rt.cells);

import { clipboardLimit } from "./grid-copy";
import { selectColumn, toggleColumn } from "./grid-selection";
import { gridSelectionCopy } from "./grid-selection.copy";
import { addRow } from "./record-edits";
import type { EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";
import type { RecordsSort } from "./table-sql";
import { forgetExcept, remember } from "./tab-memory";
import { loadRestLimit, useRecordEdits, type GridSortSource } from "./use-record-edits";
import type { LoadMoreOutcome } from "./use-query-runner";

// As colunas inteiras (RN-GRADE-021 a 023) pelo gancho da edição: a contagem da barra, a pausa, as ações de linha que não valem, o botão de ordenar, e o
// carregar das linhas que faltam antes de copiar, com os limites e as recusas.

const pg: Engine = 1;
const selection = gridSelectionCopy;

const columns: RowsState["columns"] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "Nome", type: "text", kind: "text" },
];
const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedidos", key: [0], editable: true, reason: null }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "Nome", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

const page = (from: number, count: number) => Array.from({ length: count }, (_, index) => [`${from + index + 1}`, `n${from + index + 1}`]);

function rowsState(over: Partial<RowsState> = {}): RowsState {
  return { status: "rows", id: 1, target: { sql: "select 1", offset: 0 }, columns, rows: page(0, 3), truncated: new Map(), hasMore: false, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false, resultId: "r1", ...over };
}

/**
 * O executor de mentira: `pages` é quantas páginas o "Carregar mais" ainda traz, de `size` linhas, até o fim; `fail` faz a próxima falhar com a mensagem do
 * banco. Cada página entra no estado do executor, como no de verdade, e o gancho a lê de lá.
 */
function fakeRunner(initial: RunnerState, { pages = 0, size = 2, fail = null as string | null } = {}) {
  let left = pages;
  const runner = {
    state: initial,
    subscribe: () => () => {},
    getState: (): RunnerState => runner.state,
    sessionOf: () => "s1",
    script: { getState: () => null },
    loadMore: vi.fn(async (): Promise<LoadMoreOutcome> => {
      const now = runner.state;
      if (now.status !== "rows") return { kind: "gone" };
      if (fail !== null) return { kind: "failed", message: fail };
      if (!now.hasMore) return { kind: "end" };
      left -= 1;
      runner.state = { ...now, rows: [...now.rows, ...page(now.rows.length, size)], hasMore: left > 0, pages: now.pages + 1 };
      return { kind: "loaded" };
    }),
    autoRefresh: { subscribe: () => () => {}, getState: (): AutoRefreshState => ({ status: "off", stopped: null }), blocker: (): AutoRefreshBlocker | null => null, start: vi.fn(), stop: vi.fn(), pause: vi.fn() },
  };
  return runner;
}

type Extra = Partial<Parameters<typeof useRecordEdits>[0]>;

function mount(runner: ReturnType<typeof fakeRunner>, extra: Extra = {}) {
  const params = { tabId: "t1", runner: runner as unknown as QueryRunner, connectionId: "c1", engine: pg, onSaved: vi.fn(), ...extra };
  const show = (change: Extra = {}) => {
    Object.assign(params, change);
    return rt.render(() => useRecordEdits({ ...params, state: runner.state }));
  };
  return { show, params };
}

const settle = async () => {
  for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const chooseColumn = (view: ReturnType<typeof mount>, column: number) => view.show().editing!.onSelection((held, grid) => selectColumn(held, column, grid));
const items = (view: ReturnType<typeof mount>) => view.show().menu!.groups.flat();

let clipboard: { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  forgetExcept(new Set());
  rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: target }));
  rt.client.getQueryData.mockImplementation(() => undefined);
  clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => "") };
  vi.stubGlobal("navigator", { clipboard, platform: "Win32" });
});
afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

describe("a contagem e a pausa com colunas inteiras (RN-GRADE-022)", () => {
  it("com o resultado lido até o fim, a contagem diz o total; com linhas a ler, quantas a grade tem; com o total contado, ele", () => {
    const whole = mount(fakeRunner(rowsState()));
    chooseColumn(whole, 1);
    expect(whole.show().editing!.status).toBe("Coluna Nome: todas as 3 linhas");

    const more = mount(fakeRunner(rowsState({ hasMore: true })));
    chooseColumn(more, 1);
    expect(more.show().editing!.status).toBe("Coluna Nome: todas as linhas (3 carregadas)");
    more.show().editing!.onSelection((held, grid) => toggleColumn(held, 0, grid));
    expect(more.show().editing!.status).toBe("2 colunas: todas as linhas (3 carregadas)");

    const counted = mount(fakeRunner(rowsState({ hasMore: true, total: 1234 })));
    chooseColumn(counted, 0);
    expect(counted.show().editing!.status).toBe("Coluna id: todas as 1.234 linhas");
  });

  it("as linhas novas entram: no total, somadas; sem ele, contadas à parte", () => {
    remember("t1", "edits", { resultId: "r1", edits: addRow(addRow({ cells: [], deleted: [], added: [], nextId: 1 }).edits).edits });
    const view = mount(fakeRunner(rowsState({ hasMore: true })));
    chooseColumn(view, 1);
    expect(view.show().editing!.status).toBe("Coluna Nome: todas as linhas (3 carregadas e 2 novas)");
  });

  it("a atualização automática fica em pausa com colunas inteiras, também num resultado de uma linha só", () => {
    const runner = fakeRunner(rowsState({ rows: page(0, 1) }));
    const view = mount(runner);
    chooseColumn(view, 0);
    view.show();

    expect(runner.autoRefresh.pause).toHaveBeenLastCalledWith("editing", true);
  });
});

describe("as ações de linha com colunas inteiras (RN-GRADE-022, RN-EDIT-014 a 016)", () => {
  it("'Duplicar linha' e 'Excluir linha' ficam desabilitados, na barra e no menu, com o motivo; 'Adicionar linha' continua", async () => {
    const view = mount(fakeRunner(rowsState()));
    chooseColumn(view, 1);

    const bar = view.show().editing!.bar.buttons;
    expect(bar.find((button) => button.id === "duplicateRow")).toMatchObject({ reason: selection.rows.chooseRows, label: recordsCopy.edit.menu.duplicateRow });
    expect(bar.find((button) => button.id === "deleteRow")?.reason).toBe(selection.rows.chooseRows);
    expect(bar.find((button) => button.id === "newRow")?.reason).toBeNull();

    view.show().editing!.onMenu({ row: 0, column: 1 }, { x: 0, y: 0 }, false);
    await settle();
    const menu = items(view);
    expect(menu.find((item) => item.id === "duplicateRow")).toMatchObject({ disabled: true, hint: selection.rows.chooseRows, label: recordsCopy.edit.menu.duplicateRow });
    expect(menu.find((item) => item.id === "deleteRow")).toMatchObject({ disabled: true, hint: selection.rows.chooseRows });
    expect(menu.find((item) => item.id === "newRow")?.disabled).not.toBe(true);
  });

  it("o atalho Alt+Delete diz o motivo na faixa, e o Delete sozinho não faz nada", () => {
    const view = mount(fakeRunner(rowsState()));
    chooseColumn(view, 1);

    view.show().editing!.onDeleteRow();
    expect(view.show().banner.notice).toBe(selection.rows.chooseRows);
    view.show().editing!.onDeleteRows();
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
  });

  it("o 'Descartar' que tira linhas novas deixa as colunas escolhidas", () => {
    remember("t1", "edits", { resultId: "r1", edits: addRow({ cells: [], deleted: [], added: [], nextId: 1 }).edits });
    const view = mount(fakeRunner(rowsState()));
    chooseColumn(view, 1);

    view.show().banner.onDiscard();
    expect(view.show().editing!.selection.shape).toEqual({ kind: "columns", columns: [1] });
  });

  it("o botão direito no nome escolhe a coluna e abre o menu com a célula ativa nela", async () => {
    const view = mount(fakeRunner(rowsState()));

    view.show().editing!.onColumnMenu(1, { x: 5, y: 5 });
    await settle();
    expect(view.show().editing!.selection.shape).toEqual({ kind: "columns", columns: [1] });
    expect(view.show().editing!.active).toEqual({ row: 0, column: 1 });
    expect(view.show().menu).not.toBeNull();
  });

  it("as entradas da exportação leem as colunas escolhidas na hora (RN-EXPORT-005)", () => {
    const view = mount(fakeRunner(rowsState()));
    expect(view.show().chosenColumns()).toBeNull();
    chooseColumn(view, 1);
    expect(view.show().chosenColumns()).toEqual([1]);
  });
});

describe("o botão de ordenar do cabeçalho (RN-GRADE-021)", () => {
  const sort = () => ({ applied: () => ({ column: "Nome", direction: "asc" }) satisfies RecordsSort, apply: vi.fn<GridSortSource["apply"]>() });

  it("tem a ordem aplicada, e o clique segue o ciclo pelo caminho do 'Ordenar' do menu", () => {
    const source = sort();
    const view = mount(fakeRunner(rowsState()), { sort: source });

    const header = view.show().editing!.sort!;
    expect(header).toMatchObject({ applied: { column: "Nome", direction: "asc" }, reason: null });
    header.onSort("Nome");
    expect(source.apply).toHaveBeenLastCalledWith({ column: "Nome", direction: "desc" });
    header.onSort("id");
    expect(source.apply).toHaveBeenLastCalledWith({ column: "id", direction: "asc" });
  });

  it("desabilitado, com o motivo, com a aba ocupada, com a atualização automática lendo e no comando que não é só de leitura; sem ordem, não há botão", () => {
    const source = sort();
    const busy = mount(fakeRunner({ status: "running", cancelling: false, previous: rowsState() }), { sort: source });
    expect(busy.show().editing!.sort!.reason).toBe("há um comando em andamento na aba");
    busy.show().editing!.sort!.onSort("Nome");
    expect(source.apply).not.toHaveBeenCalled();

    const auto = mount(fakeRunner({ status: "running", cancelling: false, previous: rowsState(), auto: true }), { sort: source });
    expect(auto.show().editing!.sort!.reason).toBe(recordsCopy.edit.reasons.refreshing);

    const written = mount(fakeRunner(rowsState({ read: false })), { sort: source, subject: "result" });
    expect(written.show().editing!.sort!.reason).toBe(selection.menu.sortNotRead);
    // Nos Registros, o `read` não desabilita: o comando é o da tabela.
    expect(mount(fakeRunner(rowsState({ read: false })), { sort: source }).show().editing!.sort!.reason).toBeNull();

    expect(mount(fakeRunner(rowsState())).show().editing!.sort).toBeUndefined();
  });

  it("o 'Ordenar' do menu fica desabilitado com o mesmo motivo do botão", async () => {
    const view = mount(fakeRunner(rowsState({ read: false })), { sort: sort(), subject: "result" });
    view.show().editing!.onMenu({ row: 0, column: 1 }, { x: 0, y: 0 }, false);
    await settle();

    const submenu = items(view).find((item) => item.id === "sort")!.submenu!.groups.flatMap((group) => (Array.isArray(group) ? group : group.items));
    expect(submenu[0]).toMatchObject({ disabled: true, hint: selection.menu.sortUnavailable(selection.menu.sortNotRead) });
  });
});

describe("copiar as colunas inteiras carrega antes as linhas que faltam (RN-GRADE-023)", () => {
  it("com o resultado lido até o fim, copia todas as linhas na hora, sem pedir nada", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    chooseColumn(view, 1);

    view.show().editing!.onCopy();
    await settle();
    expect(runner.loadMore).not.toHaveBeenCalled();
    expect(clipboard.writeText).toHaveBeenCalledWith("n1\nn2\nn3");
  });

  it("com linhas a ler, pede as páginas pelo 'Carregar mais' até o fim, e copia todas; a faixa diz o andamento, e a atualização automática espera", async () => {
    const runner = fakeRunner(rowsState({ hasMore: true }), { pages: 2 });
    const view = mount(runner);
    chooseColumn(view, 1);

    view.show().editing!.onCopy();
    expect(view.show().banner.loading).toBe("Carregando as linhas que faltam… 3 linhas");
    await settle();
    expect(runner.loadMore).toHaveBeenCalledTimes(2);
    expect(clipboard.writeText).toHaveBeenCalledWith("n1\nn2\nn3\nn4\nn5\nn6\nn7");
    expect(view.show().banner.loading).toBeNull();
    expect(runner.autoRefresh.pause.mock.calls.some(([why, on]) => why === "editing" && on === true)).toBe(true);
  });

  it("'Copiar número de linha(s)' também: os números de todas as linhas", async () => {
    const runner = fakeRunner(rowsState({ hasMore: true }), { pages: 1 });
    const view = mount(runner);
    chooseColumn(view, 0);
    view.show().editing!.onMenu({ row: 0, column: 0 }, { x: 0, y: 0 }, false);
    await settle();

    view.show().menu!.onChoose("copyRowNumbers");
    await settle();
    expect(clipboard.writeText).toHaveBeenCalledWith("1\n2\n3\n4\n5");
  });

  it("com o cursor fechado (e na aba guardada do script), recusa na hora, sem pedir nada nem copiar", async () => {
    const runner = fakeRunner(rowsState({ hasMore: true, cursorClosed: true }), { pages: 1 });
    const view = mount(runner, { subject: "result" });
    chooseColumn(view, 1);

    view.show().editing!.onCopy();
    await settle();
    expect(runner.loadMore).not.toHaveBeenCalled();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(view.show().banner.notice).toBe(selection.loadRest.closed("result"));

    const kept = fakeRunner(rowsState(), { pages: 1 });
    // A aba guardada do script à frente: o script ainda a tem (RN-SQL-023), e o cursor dela já não existe.
    kept.script = { getState: () => ({ results: [{ rows: { resultId: "k1" } }] }) } as never;
    const keptView = mount(kept, { kept: rowsState({ hasMore: true, resultId: "k1" }) });
    chooseColumn(keptView, 1);
    keptView.show().editing!.onCopy();
    await settle();
    expect(kept.loadMore).not.toHaveBeenCalled();
    expect(keptView.show().banner.notice).toBe(selection.loadRest.closed("table"));
  });

  it("com a aba ocupada, recusa na hora, sem esperar", async () => {
    const runner = fakeRunner({ status: "running", cancelling: false, previous: rowsState({ hasMore: true }) }, { pages: 1 });
    const view = mount(runner);
    chooseColumn(view, 1);

    view.show().editing!.onCopy();
    await settle();
    expect(runner.loadMore).not.toHaveBeenCalled();
    expect(view.show().banner.notice).toBe(selection.loadRest.busy);
  });

  it("a leitura que falha não copia nada, e a faixa diz por quê, com a mensagem do banco", async () => {
    const runner = fakeRunner(rowsState({ hasMore: true }), { pages: 1, fail: "ERROR: canceling statement due to lock timeout" });
    const view = mount(runner);
    chooseColumn(view, 1);

    view.show().editing!.onCopy();
    await settle();
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(view.show().banner.failure).toMatchObject({ headline: selection.loadRest.failed, detail: "ERROR: canceling statement due to lock timeout" });
  });

  it("passadas 100.000 linhas lidas com o resultado ainda tendo mais, recusa com o limite; as linhas que chegaram ficam", async () => {
    const runner = fakeRunner(rowsState({ hasMore: true, rows: page(0, loadRestLimit - 2) }), { pages: 5, size: 2 });
    const view = mount(runner);
    chooseColumn(view, 0);

    view.show().editing!.onCopy();
    await settle();
    expect(runner.loadMore).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(view.show().banner.notice).toBe(selection.loadRest.tooMany);
    expect((runner.state as RowsState).rows).toHaveLength(loadRestLimit);
  });

  it("para de carregar assim que o texto passa de 10 MiB, e a recusa é a de sempre", async () => {
    const big = "x".repeat(Math.ceil(clipboardLimit / 2));
    const runner = fakeRunner(rowsState({ hasMore: true, rows: [["1", big]] }), { pages: 5, size: 1 });
    runner.loadMore.mockImplementation(async () => {
      const now = runner.state as RowsState;
      runner.state = { ...now, rows: [...now.rows, [`${now.rows.length + 1}`, big]], hasMore: true };
      return { kind: "loaded" };
    });
    const view = mount(runner);
    chooseColumn(view, 1);

    view.show().editing!.onCopy();
    await settle();
    // A primeira página já passa do limite: a segunda não é pedida.
    expect(runner.loadMore).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(rt.toast.error).toHaveBeenCalledWith(selection.copy.tooLarge);
  });

  it("o 'Cancelar' da faixa para de carregar sem copiar nada", async () => {
    const runner = fakeRunner(rowsState({ hasMore: true }), { pages: 3 });
    const view = mount(runner);
    chooseColumn(view, 1);

    view.show().editing!.onCopy();
    view.show().banner.onCancelFetch();
    await settle();
    expect(runner.loadMore).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("o contexto das outras frentes diz as colunas, se há linhas a carregar e o total, e o carregar devolve o contexto com todas as linhas", async () => {
    const runner = fakeRunner(rowsState({ hasMore: true }), { pages: 1 });
    const view = mount(runner);
    chooseColumn(view, 1);

    const context = view.show().selectionContext()!;
    expect(context).toMatchObject({ wholeColumns: [1], rowsToLoad: true, total: null, rows: [0, 1, 2] });
    const progress = vi.fn();
    const loaded = await context.loadRest({ onProgress: progress });
    expect(progress).toHaveBeenCalledWith("Carregando as linhas que faltam… 3 linhas");
    expect(loaded.kind).toBe("ready");
    if (loaded.kind !== "ready") return;
    expect(loaded.context.rows).toEqual([0, 1, 2, 3, 4]);
    expect(loaded.context.rowsToLoad).toBe(false);
    expect(loaded.context.slice().rows.map((row) => row[0])).toEqual(["n1", "n2", "n3", "n4", "n5"]);
    // Com quem mostra o andamento, a faixa não diz nada.
    expect(view.show().banner.loading).toBeNull();
  });
});
