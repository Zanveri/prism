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

import type { CellMenuAction } from "./cell-menu";
import { clipboardLimit } from "./grid-copy";
import { extend, selectAll, selectRow, toggleRow } from "./grid-selection";
import { gridSelectionCopy } from "./grid-selection.copy";
import { editCell, noEdits, deleteRow, addRow } from "./record-edits";
import type { EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";
import { forgetExcept, remember } from "./tab-memory";
import { duplicateLimit, useRecordEdits, type CopyAsSource, type GenerateSqlSource, type GridFollowSource, type GridSelectionContext, type GridSortSource } from "./use-record-edits";

const pg: Engine = 1;
const selection = gridSelectionCopy;
const edit = recordsCopy.edit;

const columns: RowsState["columns"] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "Nome", type: "text", kind: "text" },
  { name: "cliente_id", type: "int4", kind: "number" },
];
const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedidos", key: [0], editable: true, reason: null }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "Nome", editable: true, reason: null, nullable: true, generated: null },
    { table: 0, baseColumn: "cliente_id", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

function rowsState(over: Partial<RowsState> = {}): RowsState {
  return {
    status: "rows",
    id: 1,
    target: { sql: "select 1", offset: 0 },
    columns,
    rows: [
      ["1", "Ana", "10"],
      ["2", 'B\t"b"', "20"],
      ["3", null, "30"],
    ],
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

type Extra = Partial<Parameters<typeof useRecordEdits>[0]>;

function mount(runner: ReturnType<typeof fakeRunner>, extra: Extra = {}) {
  const params = { tabId: "t1", runner: runner as unknown as QueryRunner, connectionId: "c1", engine: pg, onSaved: vi.fn(), ...extra };
  const show = (change: Extra = {}) => {
    Object.assign(params, change);
    return rt.render(() => useRecordEdits({ ...params, state: runner.state }));
  };
  return { show, params };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const items = (view: ReturnType<typeof mount>) => view.show().menu!.groups.flat();
const submenu = (view: ReturnType<typeof mount>, id: CellMenuAction) => items(view).find((item) => item.id === id)!.submenu!.groups.flatMap((group) => (Array.isArray(group) ? group : group.items));
const choose = (view: ReturnType<typeof mount>, id: CellMenuAction) => view.show().menu!.onChoose(id);
const pausesOf = (runner: ReturnType<typeof fakeRunner>) => runner.autoRefresh.pause.mock.calls.filter(([why]) => why === "editing").map(([, on]) => on);

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

describe("a seleção que a grade recebe (RN-GRADE-001)", () => {
  it("cada gesto muda a seleção pela função pura; a grade recebe a seleção, a grade de agora e a célula ativa", () => {
    const view = mount(fakeRunner(rowsState()));

    view.show().editing!.onSelection((held, grid) => selectRow(held, 1, grid));
    const editing = view.show().editing!;

    expect(editing.active).toEqual({ row: 1, column: 0 });
    expect(editing.layout).toEqual({ read: 3, added: [], columns: 3 });
    expect(editing.selection.shape).toMatchObject({ kind: "rows" });
  });

  it("a contagem da barra, com mais de uma célula: linhas inteiras e células; espera a seleção parar de mudar", () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onActivate({ row: 0, column: 0 });
    expect(view.show().editing!.status).toBeNull();

    view.show().editing!.onSelecting(true);
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 2, column: 1 }, grid));
    // No meio do arraste a contagem é a de antes.
    expect(view.show().editing!.status).toBeNull();
    view.show().editing!.onSelecting(false);
    expect(view.show().editing!.status).toBe("6 células escolhidas");

    view.show().editing!.onSelection((held, grid) => selectAll(held, grid));
    expect(view.show().editing!.status).toBe("3 linhas escolhidas");
  });

  it("é esquecida, com a célula ativa, a cada execução nova da aba; o 'carregar mais' a mantém", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().editing!.onSelection((held, grid) => selectAll(held, grid));

    runner.state = rowsState({ rows: [...rowsState().rows, ["4", "Duda", "40"]], pages: 2 });
    expect(view.show().editing!.selection.shape.kind).toBe("rows");
    expect(view.show().editing!.status).toBe("3 linhas escolhidas");

    runner.state = rowsState({ id: 2, resultId: "r2" });
    const fresh = view.show().editing!;
    expect(fresh.active).toBeNull();
    expect(fresh.selection.shape).toEqual({ kind: "cell" });
    expect(fresh.status).toBeNull();
  });

  it("a atualização automática espera com mais de uma célula escolhida; o Esc (uma célula só) a libera", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().editing!.onActivate({ row: 0, column: 0 });
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 1, column: 0 }, grid));
    view.show();

    expect(pausesOf(runner).at(-1)).toBe(true);
    view.show().editing!.onActivate({ row: 1, column: 1 });
    view.show();
    expect(pausesOf(runner).at(-1)).toBe(false);
  });
});

describe("o Copiar e o Copiar com cabeçalho (RN-GRADE-002)", () => {
  it("Ctrl+C copia o retângulo como uma planilha cola, com a aspa dobrada, e o aviso diz as linhas", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onActivate({ row: 0, column: 1 });
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 2, column: 2 }, grid));

    view.show().editing!.onCopy();
    await settle();

    expect(clipboard.writeText.mock.calls).toEqual([['Ana\t10\n"B\t""b"""\t20\n\t30']]);
    expect(rt.toast.success.mock.calls).toEqual([["3 linhas copiadas."]]);
  });

  it("uma célula só é o valor puro; sem célula ativa o Ctrl+C não faz nada", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onCopy();
    await settle();
    expect(clipboard.writeText).not.toHaveBeenCalled();

    view.show().editing!.onActivate({ row: 1, column: 1 });
    view.show().editing!.onCopy();
    await settle();
    expect(clipboard.writeText.mock.calls).toEqual([['B\t"b"']]);
    expect(rt.toast.success.mock.calls).toEqual([["Copiado."]]);
  });

  it("\"Copiar com cabeçalho\" do menu põe a linha dos nomes antes; leva o que a grade mostra (a pendência, a linha nova)", async () => {
    remember("t1", "edits", { resultId: "r1", edits: addRow(editCell(noEdits, 0, 1, "Bia", "Ana"), { 1: "Nova" }).edits });
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onActivate({ row: 0, column: 1 });
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 3, column: 1 }, grid));

    view.show().editing!.onMenu({ row: 1, column: 1 }, { x: 1, y: 1 }, false);
    await settle();
    choose(view, "copyWithHeader");
    await settle();

    expect(clipboard.writeText.mock.calls).toEqual([['Nome\nBia\n"B\t""b"""\n\nNova']]);
    expect(rt.toast.success.mock.calls).toEqual([["4 linhas copiadas, com o cabeçalho."]]);
  });

  it("a célula cortada da seleção vai com o valor completo, pedido só para ela", async () => {
    const full = "x".repeat(20_000);
    rt.cells.resultCells.mockResolvedValue({ ok: true, data: [full] });
    const view = mount(fakeRunner(rowsState({ rows: [["1", full.slice(0, 10), "10"], ["2", "b", "20"]], truncated: new Map([[0, new Set([1])]]) })));
    view.show().editing!.onSelection((held, grid) => selectAll(held, grid));

    view.show().editing!.onCopy();
    await settle();
    await settle();

    expect(rt.cells.resultCells).toHaveBeenCalledWith("s1", "r1", [{ row: 0, column: 1 }], expect.any(AbortSignal));
    expect(clipboard.writeText.mock.calls).toEqual([[`1\t${full}\t10\n2\tb\t20`]]);
  });

  it("o que passa de 10 MiB não vai: o aviso de erro diz o limite, e a área de transferência fica como estava", async () => {
    const huge = "y".repeat(clipboardLimit / 2 + 10);
    const view = mount(fakeRunner(rowsState({ rows: [["1", huge, "10"], ["2", huge, "20"]] })));
    view.show().editing!.onActivate({ row: 0, column: 1 });
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 1, column: 1 }, grid));

    view.show().editing!.onCopy();
    await settle();

    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(rt.toast.error.mock.calls).toEqual([[selection.copy.tooLarge]]);
  });

  it("a atualização automática fica em pausa do começo da cópia até o texto ir para a área de transferência", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().editing!.onActivate({ row: 0, column: 0 });
    runner.autoRefresh.pause.mockClear();

    view.show().editing!.onCopy();
    expect(pausesOf(runner)).toEqual([true]);
    await settle();
    view.show();
    expect(pausesOf(runner).at(-1)).toBe(false);
  });
});

describe("Copiar nome da(s) coluna(s) e número de linha(s) (RN-GRADE-015)", () => {
  it("os nomes das colunas da seleção, como o banco pede, por tabulação; os números das linhas, um por linha", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onActivate({ row: 0, column: 0 });
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 2, column: 1 }, grid));
    view.show().editing!.onMenu({ row: 1, column: 1 }, { x: 1, y: 1 }, false);
    await settle();

    expect(submenu(view, "advancedCopy").map((item) => item.id)).toEqual(["copyColumnNames", "copyRowNumbers"]);
    choose(view, "copyColumnNames");
    await settle();
    expect(clipboard.writeText.mock.calls.at(-1)).toEqual(['id\t"Nome"']);
    expect(rt.toast.success.mock.calls.at(-1)).toEqual(["2 nomes de coluna copiados."]);

    view.show().editing!.onMenu({ row: 1, column: 1 }, { x: 1, y: 1 }, false);
    await settle();
    choose(view, "copyRowNumbers");
    await settle();
    expect(clipboard.writeText.mock.calls.at(-1)).toEqual(["1\n2\n3"]);
    expect(rt.toast.success.mock.calls.at(-1)).toEqual(["3 números de linha copiados."]);
  });

  it("com só linhas novas na seleção, \"Copiar número de linha(s)\" fica desabilitado: elas não têm número", async () => {
    remember("t1", "edits", { resultId: "r1", edits: addRow(noEdits).edits });
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onMenu({ row: 3, column: 0 }, { x: 1, y: 1 }, false);
    await settle();

    expect(submenu(view, "advancedCopy").find((item) => item.id === "copyRowNumbers")).toMatchObject({ disabled: true, hint: selection.numbers.onlyNew });
  });
});

describe("as ações de linha agem nas linhas da seleção (RN-EDIT-013 a 016)", () => {
  it("com várias linhas, a barra diz \"Duplicar linhas\" e \"Excluir linhas\", com quantas na dica e para o leitor de tela", () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onSelection((held, grid) => extend(selectRow(held, 0, grid), { row: 1, column: 0 }, grid));
    view.show().editing!.onSelection((held, grid) => selectRow(held, 0, grid));
    view.show().editing!.onSelection((held, grid) => toggleRow(held, 2, grid));
    const [, , duplicate, remove] = view.show().editing!.bar.buttons;

    expect([duplicate.label, duplicate.title, duplicate.description]).toEqual(["Duplicar linhas", "Duplicar as 2 linhas escolhidas (Ctrl+Alt+Insert)", "Duplicar as 2 linhas escolhidas"]);
    expect([remove.label, remove.title, remove.description]).toEqual(["Excluir linhas", "Excluir as 2 linhas escolhidas (Alt+Delete)", "Excluir as 2 linhas escolhidas"]);
  });

  it("\"Excluir linhas\" (Alt+Delete e o menu) marca todas as lidas da seleção", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onActivate({ row: 0, column: 0 });
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 1, column: 1 }, grid));

    view.show().editing!.onDeleteRow();
    await settle();

    expect([...view.show().editing!.marks].map(([row, mark]) => [row, mark.deleted])).toEqual([
      [0, true],
      [1, true],
    ]);
  });

  describe("o Delete sozinho marca na hora para exclusão as linhas das células escolhidas, sem perguntar (RN-EDIT-015)", () => {
    const marked = (view: ReturnType<typeof mount>) => [...view.show().editing!.marks].filter(([, mark]) => mark.deleted).map(([row]) => row);

    it("com uma célula só, marca a linha dela de uma vez, a mesma que o Alt+Delete marcaria", async () => {
      const view = mount(fakeRunner(rowsState()));
      view.show().editing!.onActivate({ row: 1, column: 2 });

      view.show().editing!.onDeleteRows();
      await settle();

      expect(marked(view)).toEqual([1]);
      expect(view.show().pending).toBe(1);
      expect(view.show().banner.notice).toBeNull();
    });

    it("com um retângulo, marca todas as linhas dele; com linhas inteiras também", async () => {
      const view = mount(fakeRunner(rowsState()));
      view.show().editing!.onActivate({ row: 0, column: 0 });
      view.show().editing!.onSelection((held, grid) => extend(held, { row: 1, column: 1 }, grid));

      view.show().editing!.onDeleteRows();
      await settle();
      expect(marked(view)).toEqual([0, 1]);

      view.show().editing!.onSelection((held, grid) => selectRow(held, 2, grid));
      view.show().editing!.onDeleteRows();
      await settle();
      expect(marked(view)).toEqual([0, 1, 2]);
    });

    it("dá o mesmo resultado do Alt+Delete na mesma seleção, e é uma pendência: nada vai ao banco antes do Salvar", async () => {
      const byKey = mount(fakeRunner(rowsState()));
      byKey.show().editing!.onSelection((held, grid) => toggleRow(selectRow(held, 0, grid), 2, grid));
      byKey.show().editing!.onDeleteRows();
      await settle();
      const keyMarks = marked(byKey);
      expect(byKey.show().pending).toBe(2);
      expect(rt.service.saveEditsOrRefuse).not.toHaveBeenCalled();

      rt.unmount();
      const byAlt = mount(fakeRunner(rowsState()));
      byAlt.show().editing!.onSelection((held, grid) => toggleRow(selectRow(held, 0, grid), 2, grid));
      byAlt.show().editing!.onDeleteRow();
      await settle();

      expect(keyMarks).toEqual([0, 2]);
      expect(marked(byAlt)).toEqual(keyMarks);
    });

    it("sem nenhuma célula escolhida, nada acontece", async () => {
      const view = mount(fakeRunner(rowsState()));

      view.show().editing!.onDeleteRows();
      await settle();

      expect(marked(view)).toEqual([]);
      expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
    });

    it("a linha nova não salva simplesmente sai da grade", async () => {
      remember("t1", "edits", { resultId: "r1", edits: addRow(noEdits, { 1: "N1" }).edits });
      const view = mount(fakeRunner(rowsState()));
      view.show().editing!.onSelection((held, grid) => selectRow(held, 3, grid));

      view.show().editing!.onDeleteRows();
      await settle();

      expect(view.show().editing!.rows).toHaveLength(3);
      expect(view.show().pending).toBe(0);
    });

    it("com linhas lidas e novas juntas, marca as lidas e tira as novas", async () => {
      remember("t1", "edits", { resultId: "r1", edits: addRow(noEdits, { 1: "N1" }).edits });
      const view = mount(fakeRunner(rowsState()));
      view.show().editing!.onSelection((held, grid) => toggleRow(selectRow(held, 0, grid), 3, grid));

      view.show().editing!.onDeleteRows();
      await settle();

      expect(view.show().editing!.rows).toHaveLength(3);
      expect(marked(view)).toEqual([0]);
    });

    it("onde a exclusão não vale, a faixa dá o mesmo motivo do Alt+Delete e nada é marcado", async () => {
      const refused = mount(fakeRunner(rowsState({ truncated: new Map([[1, new Set([0])]]) })));
      refused.show().editing!.onActivate({ row: 1, column: 1 });
      refused.show().editing!.onDeleteRow();
      await settle();
      const reason = refused.show().banner.notice;
      expect(reason).toBe(edit.readOnly("a chave desta linha chegou cortada"));

      rt.unmount();
      const view = mount(fakeRunner(rowsState({ truncated: new Map([[1, new Set([0])]]) })));
      view.show().editing!.onActivate({ row: 1, column: 1 });
      view.show().editing!.onDeleteRows();
      await settle();

      expect(view.show().banner.notice).toBe(reason);
      expect(marked(view)).toEqual([]);
    });

    it("na conexão somente leitura, o motivo da conexão, e nada é marcado", async () => {
      rt.client.getQueryData.mockImplementation((key: unknown) => (Array.isArray(key) && key[0] === "connections" ? [{ id: "c1", protections: { readOnly: true } }] : undefined));
      const view = mount(fakeRunner(rowsState({ readOnly: edit.reasons.connectionReadOnly })));
      view.show().editing!.onActivate({ row: 0, column: 0 });

      view.show().editing!.onDeleteRows();
      await settle();

      expect(view.show().banner.notice).toBe(edit.readOnly(edit.reasons.connectionReadOnly));
      expect(marked(view)).toEqual([]);
      rt.client.getQueryData.mockImplementation(() => undefined);
    });
  });

  it("uma linha cuja chave não se sabe impede a exclusão de todas, e a faixa diz qual, pelo número", async () => {
    const view = mount(fakeRunner(rowsState({ truncated: new Map([[1, new Set([0])]]) })));
    view.show().editing!.onSelection((held, grid) => selectAll(held, grid));
    view.show();

    view.show().editing!.onDeleteRow();
    await settle();

    expect(view.show().editing!.marks.size).toBe(0);
    expect(view.show().banner.notice).toBe(edit.readOnly("a chave da linha 2 chegou cortada"));
  });

  it("tiradas linhas novas, a seleção passa a ser a célula ativa, na linha que ficou no lugar da primeira tirada", async () => {
    let pending = addRow(noEdits, { 1: "N1" }).edits;
    pending = addRow(pending, { 1: "N2" }).edits;
    pending = addRow(pending, { 1: "N3" }).edits;
    remember("t1", "edits", { resultId: "r1", edits: pending });
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onSelection((held, grid) => toggleRow(selectRow(held, 3, grid), 4, grid));

    view.show().editing!.onDeleteRow();
    await settle();
    const editing = view.show().editing!;

    expect(editing.rows.slice(3)).toEqual([[null, "N3", null]]);
    expect(editing.active).toEqual({ row: 3, column: 0 });
    expect(editing.selection.shape).toEqual({ kind: "cell" });
  });

  it("\"Duplicar linhas\" copia cada linha da seleção, na ordem, e a seleção passa a ser as cópias, inteiras", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onSelection((held, grid) => toggleRow(selectRow(held, 2, grid), 0, grid));

    view.show().editing!.onDuplicateRow();
    await settle();
    await settle();
    const editing = view.show().editing!;

    expect(editing.rows.slice(3)).toEqual([
      ["1", "Ana", "10"],
      ["3", null, "30"],
    ]);
    expect(editing.active).toEqual({ row: 3, column: 0 });
    expect(editing.status).toBe("2 linhas escolhidas");
    expect(view.show().banner.notice).toBe(selection.rows.keyCopied("pedidos", ["id"]));
  });

  it("mais de 1.000 linhas na seleção: nada é duplicado, e o motivo é o do limite", async () => {
    const many = Array.from({ length: duplicateLimit + 1 }, (_, index) => [String(index), "x", "1"]);
    const view = mount(fakeRunner(rowsState({ rows: many })));
    view.show().editing!.onSelection((held, grid) => selectAll(held, grid));

    expect(view.show().editing!.bar.buttons[2].reason).toBe(selection.rows.duplicateLimit);
    view.show().editing!.onDuplicateRow();
    await settle();
    expect(view.show().editing!.rows).toHaveLength(duplicateLimit + 1);
    expect(view.show().banner.notice).toBe(selection.rows.duplicateLimit);
  });

  it("\"Desfazer alteração\" tira as pendências das células escolhidas e devolve as linhas escolhidas marcadas", async () => {
    remember("t1", "edits", { resultId: "r1", edits: deleteRow(editCell(editCell(noEdits, 0, 1, "Bia", "Ana"), 2, 2, "99", "30"), 1) });
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onActivate({ row: 0, column: 1 });
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 1, column: 1 }, grid));

    view.show().editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 1 }, false);
    await settle();
    expect(items(view).find((item) => item.id === "undo")?.disabled).toBe(false);
    choose(view, "undo");

    // A da linha 3, fora da seleção, fica.
    expect([...view.show().editing!.marks.keys()]).toEqual([2]);
  });

  it("com mais de uma célula escolhida, \"Colar\" vale para uma só; \"Definir como nulo\" vale para as da coluna da ativa (RN-EDIT-017)", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onSelection((held, grid) => selectAll(held, grid));
    view.show().editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 1 }, false);
    await settle();

    expect(items(view).filter((item) => item.id === "paste" || item.id === "setNull").map((item) => [item.label, item.hint])).toEqual([
      ["Colar", selection.menu.oneCellOnly],
      [`Definir as ${rowsState().rows.length} células como nulo`, undefined],
    ]);
  });
});

describe("o menu da grade e a seleção (RN-GRADE-004)", () => {
  it("o botão direito fora da seleção a escolhe antes; dentro dela, a seleção fica e a célula passa a ser a ativa", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onActivate({ row: 0, column: 0 });
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 1, column: 1 }, grid));

    view.show().editing!.onMenu({ row: 1, column: 0 }, { x: 1, y: 1 }, false);
    await settle();
    expect(view.show().editing!.status).toBe("4 células escolhidas");
    expect(view.show().editing!.active).toEqual({ row: 1, column: 0 });

    view.show().editing!.onMenu({ row: 2, column: 2 }, { x: 1, y: 1 }, false);
    await settle();
    expect(view.show().editing!.status).toBeNull();
    expect(view.show().editing!.active).toEqual({ row: 2, column: 2 });
  });

  it("o botão direito no número da linha escolhe a linha inteira antes, e o menu abre", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onRowMenu(1, { x: 1, y: 1 });
    await settle();

    expect(view.show().editing!.status).toBe("1 linha escolhida");
    expect(view.show().menu).not.toBeNull();
  });

  it("o \"Ordenar\" marca a ordem em uso da coluna da célula ativa e pede a escolhida", async () => {
    const apply = vi.fn();
    const sort: GridSortSource = { applied: () => ({ column: "Nome", direction: "asc" }), apply };
    const view = mount(fakeRunner(rowsState()), { sort });
    view.show().editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 1 }, false);
    await settle();

    expect(submenu(view, "sort").map((item) => [item.label, item.checked])).toEqual([
      ["Crescente", true],
      ["Decrescente", false],
      ["Sem ordem", false],
    ]);
    choose(view, "sort:desc");
    expect(apply).toHaveBeenCalledWith({ column: "Nome", direction: "desc" });
  });

  it("\"Ir para o registro referenciado\" só numa coluna de chave estrangeira, com o valor lido; o nulo não tem para onde ir", async () => {
    const follow = vi.fn();
    const source: GridFollowSource = { links: (column) => column === 2, linkable: () => true, follow };
    const view = mount(fakeRunner(rowsState({ rows: [["1", "Ana", "10"], ["2", "Bia", null]] })), { follow: source });

    view.show().editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 1 }, false);
    await settle();
    expect(items(view).some((item) => item.id === "follow")).toBe(false);

    view.show().editing!.onMenu({ row: 1, column: 2 }, { x: 1, y: 1 }, false);
    await settle();
    expect(items(view).find((item) => item.id === "follow")).toMatchObject({ disabled: true, hint: selection.menu.followUnavailable });

    view.show().editing!.onMenu({ row: 0, column: 2 }, { x: 1, y: 1 }, false);
    await settle();
    choose(view, "follow");
    expect(follow).toHaveBeenCalledWith(2, "10");
  });
});

describe("o contrato com as frentes do Copiar avançado e do Gerar SQL (seção 37)", () => {
  it("o menu pergunta o estado dos itens e entrega a escolha com a seleção, o recorte e a busca dos valores completos", async () => {
    const chosen: [string, GridSelectionContext][] = [];
    const copyAs: CopyAsSource = { access: () => ({ dialog: { editable: true }, configure: { editable: true } }), choose: (action, context) => void chosen.push([action, context]) };
    const generateSql: GenerateSqlSource = { access: () => ({ create: { editable: false, reason: "Indisponível: teste." } }), choose: (action, context) => void chosen.push([action, context]) };
    const view = mount(fakeRunner(rowsState()), { copyAs, generateSql });
    view.show().editing!.onSelection((held, grid) => toggleRow(selectRow(held, 0, grid), 2, grid));
    view.show().editing!.onMenu({ row: 0, column: 0 }, { x: 1, y: 1 }, false);
    await settle();

    expect(submenu(view, "advancedCopy").map((item) => item.id)).toContain("copyAs:json");
    expect(submenu(view, "generateSql").find((item) => item.id === "sql:create")).toMatchObject({ disabled: true });
    choose(view, "copyAs:json");
    view.show().editing!.onMenu({ row: 0, column: 0 }, { x: 1, y: 1 }, false);
    await settle();
    choose(view, "sql:update");

    expect(chosen.map(([action]) => action)).toEqual(["copyAs:json", "sql:update"]);
    const [, context] = chosen[0];
    expect(context.rows).toEqual([0, 2]);
    expect(context.columns).toEqual([0, 1, 2]);
    expect(context.slice().rows).toEqual([
      ["1", "Ana", "10"],
      ["3", null, "30"],
    ]);
    expect(context.slice("loaded").positions).toEqual([0, 1, 2]);
    expect(context.moved()).toBe(false);
  });

  it("Ctrl+Shift+C abre o \"Copiar avançado…\" da outra frente; sem ela, a grade não recebe a tecla", () => {
    const choose = vi.fn();
    const copyAs: CopyAsSource = { access: () => ({ dialog: { editable: true }, configure: { editable: true } }), choose };
    expect(mount(fakeRunner(rowsState())).show().editing!.onCopyAdvanced).toBeUndefined();

    const view = mount(fakeRunner(rowsState()), { copyAs });
    view.show().editing!.onActivate({ row: 1, column: 1 });
    view.show().editing!.onCopyAdvanced!();

    expect(choose).toHaveBeenCalledWith("copyAdvanced", expect.objectContaining({ rows: [1], columns: [1] }));
  });

  it("o recorte com a célula cortada vem com o valor completo pela busca do contexto", async () => {
    rt.cells.resultCells.mockResolvedValue({ ok: true, data: ["inteiro"] });
    const contexts: GridSelectionContext[] = [];
    const copyAs: CopyAsSource = { access: () => ({ dialog: { editable: true }, configure: { editable: true } }), choose: (_action, context) => void contexts.push(context) };
    const view = mount(fakeRunner(rowsState({ truncated: new Map([[0, new Set([1])]]) })), { copyAs });
    view.show().editing!.onActivate({ row: 0, column: 1 });
    view.show().editing!.onCopyAdvanced!();

    const completed = await contexts[0].complete(contexts[0].slice());
    expect(completed?.slice.rows).toEqual([["inteiro"]]);
    expect(completed?.missing).toBe(0);
  });
});

describe("o alvo do Gerar SQL e do Copiar como, a busca e a faixa no contexto (seção 37, RN-GRADE-020 e RN-EDIT-010)", () => {
  /** O contexto que o Ctrl+Shift+C entregaria agora, com a célula `Nome` da primeira linha. */
  const contextOf = (view: ReturnType<typeof mount>) => {
    view.show().editing!.onActivate({ row: 0, column: 1 });
    return view.show().selectionContext()!;
  };
  const sqlTarget = { ...target, tables: target.tables.map((table) => ({ ...table, kind: "table" as const, keyColumns: ["id"] })) };

  it("pergunta o edit-target com purpose sql uma vez por resultado, com a frase na faixa enquanto a API responde; a resposta não vai para a edição", async () => {
    let answer!: (value: unknown) => void;
    rt.service.sqlTargetOrRefuse.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const view = mount(fakeRunner(rowsState()));
    const context = contextOf(view);

    const first = context.sqlTarget("Conferindo a tabela deste resultado…");
    const second = context.sqlTarget();
    expect(view.show().banner.notice).toBe("Conferindo a tabela deste resultado…");
    answer({ ok: true, data: sqlTarget });
    expect(await first).toEqual({ kind: "target", target: sqlTarget });
    expect(await second).toEqual({ kind: "target", target: sqlTarget });
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(1);
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledWith("s1", "r1", null);
    expect(view.show().banner.notice).toBeNull();

    expect(view.show().selectionContext()!.knownSqlTarget()).toEqual({ kind: "target", target: sqlTarget });
    await view.show().selectionContext()!.sqlTarget();
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(1);
    // A edição não recebe o alvo do "Gerar SQL": o da conexão somente leitura não serve a ela, e ela pergunta o dela.
    expect(view.show().selectionContext()!.target).toBeNull();
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
  });

  it("o alvo que a edição já tem, com o tipo e a chave pelo nome, serve sem perguntar; o motivo da página também", async () => {
    rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: sqlTarget }));
    const view = mount(fakeRunner(rowsState()));
    await contextOf(view).ensureTarget();
    expect(await view.show().selectionContext()!.sqlTarget()).toEqual({ kind: "target", target: sqlTarget });
    expect(rt.service.sqlTargetOrRefuse).not.toHaveBeenCalled();

    rt.unmount();
    const readOnly = mount(fakeRunner(rowsState({ readOnly: "UNION" })));
    expect(contextOf(readOnly).knownSqlTarget()).toEqual({ kind: "notEditable", reason: "UNION" });
  });

  it("na conexão somente leitura o motivo da página não serve: o alvo vem da API com purpose sql (RN-GRADE-020 e RN-PROT-002)", async () => {
    rt.client.getQueryData.mockImplementation((key: unknown) => (Array.isArray(key) && key[0] === "connections" ? [{ id: "c1", protections: { readOnly: true } }] : undefined));
    rt.service.sqlTargetOrRefuse.mockResolvedValueOnce({ ok: true, data: sqlTarget });
    const view = mount(fakeRunner(rowsState({ readOnly: edit.reasons.connectionReadOnly })));
    const context = contextOf(view);

    expect(context.knownSqlTarget()).toBeNull();
    expect(await context.sqlTarget()).toEqual({ kind: "target", target: sqlTarget });
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(1);
    expect(view.show().selectionContext()!.knownSqlTarget()).toEqual({ kind: "target", target: sqlTarget });
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
  });

  describe("o somente leitura desmarcado ou marcado depois da leitura (RN-PROT-002 e 003)", () => {
    /** A lista das conexões em cache, com o somente leitura de `c1` agora. */
    const readOnlyNow = (on: boolean) => rt.client.getQueryData.mockImplementation((key: unknown) => (Array.isArray(key) && key[0] === "connections" ? [{ id: "c1", protections: { readOnly: on } }] : undefined));

    it("lido na conexão somente leitura e desmarcado depois: o motivo da página não vale, e a edição e o Gerar SQL perguntam à API como numa página sem motivo", async () => {
      readOnlyNow(false);
      rt.service.sqlTargetOrRefuse.mockResolvedValueOnce({ ok: true, data: sqlTarget });
      const view = mount(fakeRunner(rowsState({ readOnly: edit.reasons.connectionReadOnly })));

      expect(view.show().banner.readOnly).toBeNull();
      const context = contextOf(view);
      expect(context.knownSqlTarget()).toBeNull();
      expect(await context.sqlTarget()).toEqual({ kind: "target", target: sqlTarget });
      expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(1);
      expect(await context.ensureTarget()).toEqual(target);
      expect(rt.service.editTargetOrRefuse).toHaveBeenCalledWith("s1", "r1", null);
      expect(view.show().banner.readOnly).toBeNull();
    });

    it("lido e ainda somente leitura: o motivo da página vale, a edição não pergunta, e o Gerar SQL pergunta o alvo dele (purpose sql)", async () => {
      readOnlyNow(true);
      rt.service.sqlTargetOrRefuse.mockResolvedValueOnce({ ok: true, data: sqlTarget });
      const view = mount(fakeRunner(rowsState({ readOnly: edit.reasons.connectionReadOnly })));

      expect(view.show().banner.readOnly).toBe(edit.readOnly(edit.reasons.connectionReadOnly));
      const context = contextOf(view);
      expect(await context.ensureTarget()).toBeNull();
      expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
      expect(await context.sqlTarget()).toEqual({ kind: "target", target: sqlTarget });
    });

    it("o outro motivo da página vale também com a conexão livre: o Gerar SQL não pergunta", () => {
      readOnlyNow(false);
      const view = mount(fakeRunner(rowsState({ readOnly: "UNION" })));
      expect(view.show().banner.readOnly).toBe(edit.readOnly("UNION"));
      expect(contextOf(view).knownSqlTarget()).toEqual({ kind: "notEditable", reason: "UNION" });
    });

    it("marcado depois da leitura: a página não traz motivo, a API recusa e a recusa vale enquanto ele vale; desmarcado de novo, a edição pergunta outra vez", async () => {
      readOnlyNow(true);
      rt.service.editTargetOrRefuse.mockResolvedValueOnce({ ok: false, error: { code: "CONNECTION_READ_ONLY", title: "Somente leitura", detail: "A conexão é somente leitura.", extensions: {} } });
      const view = mount(fakeRunner(rowsState()));

      expect(view.show().banner.readOnly).toBeNull();
      expect(await contextOf(view).ensureTarget()).toBeNull();
      expect(view.show().banner.readOnly).toBe(edit.readOnly(edit.reasons.connectionReadOnly));
      expect(rt.service.editTargetOrRefuse).toHaveBeenCalledTimes(1);

      readOnlyNow(false);
      expect(view.show().banner.readOnly).toBeNull();
      expect(await view.show().selectionContext()!.ensureTarget()).toEqual(target);
      expect(rt.service.editTargetOrRefuse).toHaveBeenCalledTimes(2);
    });
  });

  it("a recusa de que o resultado não se edita fica para o resultado; a falha não, e a seguinte pergunta de novo", async () => {
    rt.service.sqlTargetOrRefuse.mockResolvedValueOnce({ ok: false, error: { code: "SESSION_BUSY", title: "Ocupada", detail: "a sessão está ocupada", extensions: {} } });
    rt.service.sqlTargetOrRefuse.mockResolvedValueOnce({ ok: false, error: { code: "RESULT_NOT_EDITABLE", title: "Só leitura", detail: "x", extensions: { reason: "DISTINCT" } } });
    const view = mount(fakeRunner(rowsState()));
    const context = contextOf(view);

    expect(await context.sqlTarget()).toEqual({ kind: "failed", message: "a sessão está ocupada" });
    expect(context.knownSqlTarget()).toBeNull();
    expect(await context.sqlTarget()).toEqual({ kind: "notEditable", reason: "DISTINCT" });
    expect(context.knownSqlTarget()).toEqual({ kind: "notEditable", reason: "DISTINCT" });
  });

  it("o contexto diz a aba ocupada e as pendências como a grade as mostra", () => {
    remember("t1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 1, "Ana Maria", "Ana") });
    const view = mount(fakeRunner(rowsState()));
    const context = contextOf(view);
    expect(context.busy).toBe(false);
    expect(context.pending.cells).toEqual([expect.objectContaining({ row: 0, column: 1, value: "Ana Maria" })]);
  });

  it("a busca dos valores completos desiste pelo sinal de quem pediu (o \"Cancelar a busca\" do diálogo), como pelo \"Cancelar\" da faixa", async () => {
    rt.cells.resultCells.mockImplementation((_session: string, _result: string, _cells: unknown, signal: AbortSignal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, error: { code: "CANCELLED", title: "", detail: null, extensions: {} } }))));
    const view = mount(fakeRunner(rowsState({ truncated: new Map([[0, new Set([1])]]) })));
    const context = contextOf(view);
    const controller = new AbortController();

    const fetching = context.complete(context.slice(), undefined, controller.signal);
    expect(view.show().banner.fetching).toBe(true);
    controller.abort();
    expect(await fetching).toBeNull();
    expect(view.show().banner.fetching).toBe(false);

    const already = new AbortController();
    already.abort();
    expect(await context.fullValues([{ row: 0, column: 1 }], already.signal)).toBeNull();
  });

  it("a faixa \"Copiando…\" de uma cópia de outra frente aparece passado meio segundo, e o Cancelar dela aborta a cópia", () => {
    vi.useFakeTimers();
    try {
      const view = mount(fakeRunner(rowsState()));
      const controller = new AbortController();
      const done = contextOf(view).copying(controller);
      expect(view.show().banner.copying).toBe(false);
      vi.advanceTimersByTime(500);
      expect(view.show().banner.copying).toBe(true);

      view.show().banner.onCancelFetch();
      expect(controller.signal.aborted).toBe(true);
      expect(view.show().banner.copying).toBe(false);
      done();
    } finally {
      vi.useRealTimers();
    }
  });
});
