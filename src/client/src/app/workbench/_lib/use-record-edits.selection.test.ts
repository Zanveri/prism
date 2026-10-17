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
    service: { editTargetOrRefuse: vi.fn(), saveEditsOrRefuse: vi.fn(), previewEditsOrRefuse: vi.fn() },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    cells: { resultCells: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => ({ getQueryData: () => undefined }) }));
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

  it("\"Excluir linhas\" marca todas as lidas da seleção; o Delete sozinho só com linhas inteiras", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onActivate({ row: 0, column: 0 });
    view.show().editing!.onSelection((held, grid) => extend(held, { row: 1, column: 1 }, grid));

    // Um retângulo, mesmo de linhas inteiras de largura, não vale para o Delete.
    view.show().editing!.onDeleteRows();
    await settle();
    expect(view.show().editing!.marks.size).toBe(0);

    view.show().editing!.onSelection((held, grid) => extend(selectRow(held, 0, grid), { row: 1, column: 0 }, grid));
    view.show().editing!.onSelection((held, grid) => toggleRow(selectRow(held, 0, grid), 1, grid));
    view.show().editing!.onDeleteRows();
    await settle();
    expect([...view.show().editing!.marks].map(([row, mark]) => [row, mark.deleted])).toEqual([
      [0, true],
      [1, true],
    ]);
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

  it("com mais de uma célula escolhida, \"Colar\" e \"Definir como nulo\" valem para uma só", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().editing!.onSelection((held, grid) => selectAll(held, grid));
    view.show().editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 1 }, false);
    await settle();

    expect(items(view).filter((item) => item.id === "paste" || item.id === "setNull").map((item) => item.hint)).toEqual([selection.menu.oneCellOnly, selection.menu.oneCellOnly]);
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
    const sort: GridSortSource = { current: () => ({ column: "Nome", direction: "asc" }), apply };
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
