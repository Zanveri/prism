import { describe, expect, it, vi } from "vitest";

// As teclas e o duplo clique da grade editável (RN-EDIT-001 e 015), com os ganchos do React simulados (`createHookRuntime`) e o virtualizador trocado por um
// que não mede nada: o que se confere é o que a grade pede à edição (`GridEditing`) para cada tecla.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-virtual", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-virtual")>()),
  useVirtualizer: () => ({ getVirtualItems: () => [], getTotalSize: () => 0, measure: () => {}, scrollToIndex: () => {} }),
}));

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { select, selectColumn, selectRow, emptySelection, type GridLayout, type GridSelection } from "../_lib/grid-selection";
import type { GridEditing } from "../_lib/grid-editing";
import { ResultGrid } from "./result-grid";

const columns = [
  { name: "id", type: "int4", kind: "number" as const },
  { name: "nome", type: "text", kind: "text" as const },
];
const layout: GridLayout = { read: 3, added: [], columns: 2 };

function editingWith(selection: GridSelection) {
  const calls = { deleteRows: vi.fn(), deleteRow: vi.fn(), edit: vi.fn(), toggleValueViewer: vi.fn() };
  const editing = {
    rows: [["1", "Ana"], ["2", "Bia"], ["3", "Caio"]],
    selection,
    layout,
    onSelection: vi.fn(),
    onSelecting: vi.fn(),
    status: null,
    pending: 0,
    marks: new Map(),
    active: { row: 1, column: 1 },
    editor: null,
    columnHints: null,
    columnReadOnly: null,
    columnPending: new Map(),
    onActivate: vi.fn(),
    onEdit: calls.edit,
    onDraft: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    onMenu: vi.fn(),
    onRowMenu: vi.fn(),
    onColumnMenu: vi.fn(),
    onCopy: vi.fn(),
    onDeleteRows: calls.deleteRows,
    onSave: vi.fn(),
    onNewRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    onDeleteRow: calls.deleteRow,
    bar: { buttons: [], onAction: vi.fn() },
    onToggleValueViewer: calls.toggleValueViewer,
  } as unknown as GridEditing;
  return { editing, calls };
}

/** A grade montada, o elemento que rola (a grade) e um evento de teclado nele. */
function mount(editing: GridEditing) {
  rt.unmount();
  const tree = rt.render(() => (ResultGrid as unknown as { type: (props: object) => ReturnType<typeof ResultGrid> }).type({ columns, rows: [], truncated: new Map(), editing }));
  const grid = elementsOf(tree).find((element): element is Found => element.props.role === "grid")!;
  const key = (init: Partial<{ key: string; altKey: boolean; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }>) => {
    const target = {};
    const event = { key: "", altKey: false, ctrlKey: false, shiftKey: false, metaKey: false, ...init, target, currentTarget: target, preventDefault: vi.fn() };
    (grid.props.onKeyDown as (event: unknown) => void)(event);
    return event;
  };
  return { grid, key };
}

const cell = (row: number, column: number) => select(emptySelection, { row, column }, layout);

describe("o Delete sozinho na grade editável (RN-EDIT-015)", () => {
  it("com a célula ativa só, pede à edição que marque as linhas na hora, e a tecla não segue", () => {
    const { editing, calls } = editingWith(cell(1, 1));
    const view = mount(editing);

    const event = view.key({ key: "Delete" });

    expect(calls.deleteRows).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(calls.deleteRow).not.toHaveBeenCalled();
  });

  it("com linhas inteiras também", () => {
    const { editing, calls } = editingWith(selectRow(emptySelection, 2, layout));

    mount(editing).key({ key: "Delete" });

    expect(calls.deleteRows).toHaveBeenCalledTimes(1);
  });

  it("com colunas inteiras escolhidas, não faz nada", () => {
    const { editing, calls } = editingWith(selectColumn(emptySelection, 1, layout));

    const event = mount(editing).key({ key: "Delete" });

    expect(calls.deleteRows).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("sem nada escolhido, não faz nada", () => {
    const { editing, calls } = editingWith(emptySelection);

    mount(editing).key({ key: "Delete" });

    expect(calls.deleteRows).not.toHaveBeenCalled();
  });

  it("com Ctrl, Shift ou Cmd não é o Delete das linhas; com Alt é o Alt+Delete, o outro caminho", () => {
    const { editing, calls } = editingWith(cell(1, 1));
    const view = mount(editing);

    view.key({ key: "Delete", ctrlKey: true });
    view.key({ key: "Delete", shiftKey: true });
    view.key({ key: "Delete", metaKey: true });
    expect(calls.deleteRows).not.toHaveBeenCalled();
    expect(calls.deleteRow).not.toHaveBeenCalled();

    view.key({ key: "Delete", altKey: true });
    expect(calls.deleteRow).toHaveBeenCalledTimes(1);
    expect(calls.deleteRows).not.toHaveBeenCalled();
  });
});

describe("abrir o campo de edição pela grade (RN-EDIT-001)", () => {
  it("F2 e Enter abrem o campo na célula ativa, sem texto inicial (o campo seleciona o valor); digitar abre com o caractere", () => {
    const { editing, calls } = editingWith(cell(1, 1));
    const view = mount(editing);

    view.key({ key: "F2" });
    view.key({ key: "Enter" });
    view.key({ key: "k" });

    expect(calls.edit.mock.calls).toEqual([[{ row: 1, column: 1 }], [{ row: 1, column: 1 }], [{ row: 1, column: 1 }, "k"]]);
  });

  it("o duplo clique numa célula abre o campo nela, sem texto inicial", () => {
    const { editing, calls } = editingWith(cell(1, 1));
    const view = mount(editing);
    const element = { nodeType: 1, closest: () => ({ dataset: { row: "2", col: "0" } }) };
    (view.grid.props.ref as { current: unknown }).current = { contains: () => true };

    (view.grid.props.onDoubleClick as (event: unknown) => void)({ target: element });

    expect(calls.edit).toHaveBeenCalledExactlyOnceWith({ row: 2, column: 0 });
  });

  it("F7 com uma célula selecionada alterna o painel Valor (onToggleValueViewer), e com modificadores não faz nada", () => {
    const { editing, calls } = editingWith(cell(1, 1));
    const view = mount(editing);

    view.key({ key: "F7", ctrlKey: true });
    view.key({ key: "F7", shiftKey: true });
    expect(calls.toggleValueViewer).not.toHaveBeenCalled();

    view.key({ key: "F7" });
    expect(calls.toggleValueViewer).toHaveBeenCalledTimes(1);
  });
});
