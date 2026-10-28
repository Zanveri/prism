import { describe, expect, it, vi } from "vitest";

const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return {
    ...createHookRuntime(),
    copied: [] as string[],
    savedFiles: [] as { fileName: string; content: string | Uint8Array; type: string }[],
    externalCalls: [] as { content: string; extension: string; name?: string }[],
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  useHost: () => ({ document: {} }),
  useToast: () => rt.toast,
}));
vi.mock("@/lib/host/host", () => ({
  hostClipboard: () => ({
    writeText: (text: string) => {
      rt.copied.push(text);
      return Promise.resolve();
    },
  }),
}));
vi.mock("../_lib/save-file", () => ({
  saveCellFile: (fileName: string, content: string | Uint8Array, type: string) => {
    rt.savedFiles.push({ fileName, content, type });
  },
}));
vi.mock("@/lib/api/bridge", () => ({
  openExternalEditor: (payload: { content: string; extension: string; name?: string }) => {
    rt.externalCalls.push(payload);
    return Promise.resolve(true);
  },
}));

import { elementsOf } from "@/lib/testing/react-tree";

import type { CellValueViewerState } from "../_lib/grid-editing";
import { addRow, changesOf, editCell, editNewCell, noEdits } from "../_lib/record-edits";
import { CellValueViewerPanel } from "./cell-value-viewer-panel";

function makeState(overrides: Partial<CellValueViewerState> = {}): CellValueViewerState {
  return {
    open: true,
    active: { row: 0, column: 0 },
    column: { name: "payload", type: "jsonb", kind: "text" },
    value: '{"id":1,"ativo":true}',
    editable: { editable: false, reason: "somente leitura" },
    setNullAccess: { editable: false, reason: "somente leitura" },
    onClose: vi.fn(),
    ...overrides,
  };
}

const byTestId = (tree: ReturnType<typeof CellValueViewerPanel>, id: string) =>
  elementsOf(tree).find((el) => el.props["data-testid"] === id);

describe("CellValueViewerPanel (painel Valor — F7)", () => {
  it("detecta automaticamente o formato JSON para coluna jsonb e permite alternar entre Formatado e Cru", () => {
    rt.unmount();
    const state = makeState();
    let tree = rt.render(() => CellValueViewerPanel({ state }));

    const select = byTestId(tree, "value-viewer-format-select");
    expect(select?.props.value).toBe("json");

    const textarea = byTestId(tree, "value-viewer-textarea");
    expect(textarea?.props.value).toBe('{\n  "id": 1,\n  "ativo": true\n}');

    // Alterna para a forma crua ("Cru")
    const rawButton = byTestId(tree, "value-viewer-mode-raw");
    expect(rawButton).toBeDefined();
    (rawButton!.props.onClick as () => void)();

    tree = rt.render(() => CellValueViewerPanel({ state }));
    expect(byTestId(tree, "value-viewer-textarea")?.props.value).toBe('{"id":1,"ativo":true}');

    // Volta para a forma formatada ("Formatado")
    const formattedButton = byTestId(tree, "value-viewer-mode-formatted");
    (formattedButton!.props.onClick as () => void)();

    tree = rt.render(() => CellValueViewerPanel({ state }));
    expect(byTestId(tree, "value-viewer-textarea")?.props.value).toBe('{\n  "id": 1,\n  "ativo": true\n}');
  });

  it("permite trocar para o formato Binary usando o componente Select e exibe a grade hexadecimal + ASCII igual ao DBeaver", () => {
    rt.unmount();
    const state = makeState({
      column: { name: "Testa", type: "varchar", kind: "text" },
      value: "Testando",
    });
    let tree = rt.render(() => CellValueViewerPanel({ state }));
    expect(byTestId(tree, "value-viewer-format-select")?.props.value).toBe("text");

    const select = byTestId(tree, "value-viewer-format-select")!;
    (select.props.onChange as (value: string) => void)("binary");

    tree = rt.render(() => CellValueViewerPanel({ state }));
    expect(byTestId(tree, "value-viewer-format-select")?.props.value).toBe("binary");

    const hexTable = byTestId(tree, "value-viewer-hex-table");
    expect(hexTable).toBeDefined();
    const offsetCell = byTestId(tree, "value-viewer-hex-offset-0");
    const asciiCell = byTestId(tree, "value-viewer-hex-ascii-0");
    expect(offsetCell?.props.children).toBe("00000000");
    expect(asciiCell?.props.children).toBe("Testando");
  });

  it("permite arrastar a divisória lateral para aumentar ou diminuir a largura do painel Valor", () => {
    rt.unmount();
    const state = makeState();
    let tree = rt.render(() => CellValueViewerPanel({ state }));

    const panel = byTestId(tree, "cell-value-viewer-panel")!;
    expect((panel.props.style as { width: number }).width).toBe(352);

    const handle = byTestId(tree, "value-viewer-resize-handle")!;
    expect(handle.props.role).toBe("separator");
    expect(handle.props["aria-orientation"]).toBe("vertical");

    // Arrasta 120px para a esquerda -> aumenta a largura de 352 para 472
    (handle.props.onPointerDown as (event: { pointerId: number; clientX: number; currentTarget: { setPointerCapture?: (id: number) => void } }) => void)({
      pointerId: 1,
      clientX: 600,
      currentTarget: { setPointerCapture: vi.fn() },
    });
    tree = rt.render(() => CellValueViewerPanel({ state }));
    (byTestId(tree, "value-viewer-resize-handle")!.props.onPointerMove as (event: { clientX: number }) => void)({
      clientX: 480,
    });
    tree = rt.render(() => CellValueViewerPanel({ state }));
    expect((byTestId(tree, "cell-value-viewer-panel")!.props.style as { width: number }).width).toBe(472);

    // Arrasta para a direita para diminuir ainda mais (ex.: 220px)
    (byTestId(tree, "value-viewer-resize-handle")!.props.onPointerMove as (event: { clientX: number }) => void)({
      clientX: 732,
    });
    tree = rt.render(() => CellValueViewerPanel({ state }));
    expect((byTestId(tree, "cell-value-viewer-panel")!.props.style as { width: number }).width).toBe(220);

    (byTestId(tree, "value-viewer-resize-handle")!.props.onPointerUp as () => void)();
    tree = rt.render(() => CellValueViewerPanel({ state }));

    // Teclado (ArrowLeft aumenta 16px, ArrowRight diminui 16px)
    (byTestId(tree, "value-viewer-resize-handle")!.props.onKeyDown as (event: { key: string; preventDefault: () => void }) => void)({
      key: "ArrowLeft",
      preventDefault: vi.fn(),
    });
    tree = rt.render(() => CellValueViewerPanel({ state }));
    expect((byTestId(tree, "cell-value-viewer-panel")!.props.style as { width: number }).width).toBe(236);
  });

  it("copia o valor exibido, salva em arquivo e abre no editor externo com a extensão do formato ativo", async () => {
    rt.unmount();
    rt.copied.length = 0;
    rt.savedFiles.length = 0;
    rt.externalCalls.length = 0;

    const state = makeState();
    const tree = rt.render(() => CellValueViewerPanel({ state }));

    // Copiar
    const copyBtn = byTestId(tree, "value-viewer-copy")!;
    (copyBtn.props.onClick as () => void)();
    await Promise.resolve();
    expect(rt.copied).toEqual(['{\n  "id": 1,\n  "ativo": true\n}']);

    // Salvar em arquivo
    const saveBtn = byTestId(tree, "value-viewer-save-file")!;
    (saveBtn.props.onClick as () => void)();
    expect(rt.savedFiles).toEqual([
      {
        fileName: "payload.json",
        content: '{\n  "id": 1,\n  "ativo": true\n}',
        type: "application/json;charset=utf-8",
      },
    ]);

    // Abrir no editor externo
    const extBtn = byTestId(tree, "value-viewer-open-external")!;
    (extBtn.props.onClick as () => void)();
    await Promise.resolve();
    expect(rt.externalCalls).toEqual([
      {
        content: '{\n  "id": 1,\n  "ativo": true\n}',
        extension: "json",
        name: "payload",
      },
    ]);
  });

  it("exige clicar no ícone de lápis para habilitar a edição no F7 e permite aplicar ou definir NULL", () => {
    rt.unmount();
    const onCommitValue = vi.fn();
    const state = makeState({
      column: { name: "observacao", type: "text", kind: "text" },
      value: "texto inicial",
      editable: { editable: true },
      setNullAccess: { editable: true },
      onCommitValue,
    });

    let tree = rt.render(() => CellValueViewerPanel({ state }));
    // Antes de clicar no lápis, o textarea fica somente leitura e o botão Aplicar não aparece
    expect(byTestId(tree, "value-viewer-textarea")?.props.readOnly).toBe(true);
    expect(byTestId(tree, "value-viewer-apply")).toBeUndefined();

    // Clica no ícone de lápis para entrar em modo de edição explícito
    const editToggleBtn = byTestId(tree, "value-viewer-edit-toggle")!;
    expect(editToggleBtn).toBeDefined();
    expect(editToggleBtn.props["aria-pressed"]).toBe(false);
    (editToggleBtn.props.onClick as () => void)();

    tree = rt.render(() => CellValueViewerPanel({ state }));
    expect(byTestId(tree, "value-viewer-edit-toggle")?.props["aria-pressed"]).toBe(true);
    const textarea = byTestId(tree, "value-viewer-textarea")!;
    expect(textarea.props.readOnly).toBe(false);

    (textarea.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "texto atualizado" },
    });

    tree = rt.render(() => CellValueViewerPanel({ state }));
    const applyBtn = byTestId(tree, "value-viewer-apply")!;
    expect(applyBtn.props.disabled).toBe(false);
    (applyBtn.props.onClick as () => void)();
    expect(onCommitValue).toHaveBeenCalledWith("texto atualizado");

    const setNullBtn = byTestId(tree, "value-viewer-set-null")!;
    (setNullBtn.props.onClick as () => void)();
    expect(onCommitValue).toHaveBeenCalledWith(null);
  });

  it("ao editar um JSON formatado (prettified) no F7, salva o JSON compactado sem quebras de linha no UPDATE e no INSERT", () => {
    rt.unmount();
    const target = {
      tables: [{ schema: "public", name: "eventos", key: [0], editable: true, reason: null, kind: "table" as const, keyColumns: ["id"] }],
      columns: [
        { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null, type: "integer" },
        { table: 0, baseColumn: "payload", editable: true, reason: null, nullable: true, generated: null, type: "jsonb" },
      ],
      rowOperations: true,
      oneAtATime: false,
    };
    const rows = [["1", '{"id":1,"ativo":true}']];
    let edits = noEdits;

    const onCommitUpdate = vi.fn((nextValue: string | null) => {
      edits = editCell(edits, 0, 1, nextValue, rows[0][1]);
    });

    const state = makeState({
      column: { name: "payload", type: "jsonb", kind: "text" },
      value: '{"id":1,"ativo":true}',
      editable: { editable: true },
      setNullAccess: { editable: true },
      onCommitValue: onCommitUpdate,
    });

    let tree = rt.render(() => CellValueViewerPanel({ state }));
    // Visualização inicial está formatada (prettified) com quebras de linha e indentação
    expect(byTestId(tree, "value-viewer-textarea")?.props.value).toBe('{\n  "id": 1,\n  "ativo": true\n}');

    // Clica no lápis para editar o JSON formatado
    (byTestId(tree, "value-viewer-edit-toggle")!.props.onClick as () => void)();
    tree = rt.render(() => CellValueViewerPanel({ state }));

    // Usuário edita mantendo o JSON prettified (com quebras de linha e espaços)
    const textarea = byTestId(tree, "value-viewer-textarea")!;
    (textarea.props.onChange as (event: { target: { value: string } }) => void)({
      target: {
        value: '{\n  "id": 1,\n  "ativo": false,\n  "tags": [\n    "a",\n    "b"\n  ]\n}',
      },
    });

    tree = rt.render(() => CellValueViewerPanel({ state }));
    (byTestId(tree, "value-viewer-apply")!.props.onClick as () => void)();

    // Verifica que o valor comitado na célula para UPDATE foi minificado/compactado em uma linha só
    expect(onCommitUpdate).toHaveBeenCalledWith('{"id":1,"ativo":false,"tags":["a","b"]}');

    // Agora testa também numa linha nova (INSERT)
    const added = addRow(edits, { 0: "2" });
    edits = added.edits;
    const insertState = makeState({
      active: { row: 1, column: 1 },
      column: { name: "payload", type: "jsonb", kind: "text" },
      value: null,
      editable: { editable: true },
      setNullAccess: { editable: true },
      onCommitValue: (nextValue) => {
        edits = editNewCell(edits, added.id, 1, nextValue);
      },
    });

    rt.unmount();
    tree = rt.render(() => CellValueViewerPanel({ state: insertState }));
    (byTestId(tree, "value-viewer-edit-toggle")!.props.onClick as () => void)();
    tree = rt.render(() => CellValueViewerPanel({ state: insertState }));
    (byTestId(tree, "value-viewer-textarea")!.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: '{\n  "novo": true,\n  "total": 10\n}' },
    });
    tree = rt.render(() => CellValueViewerPanel({ state: insertState }));
    (byTestId(tree, "value-viewer-apply")!.props.onClick as () => void)();

    const planned = changesOf(edits, rows, target);
    expect(planned.changes).toEqual([
      {
        kind: "update",
        table: 0,
        key: ["1"],
        set: [{ column: 1, value: '{"id":1,"ativo":false,"tags":["a","b"]}' }],
      },
      {
        kind: "insert",
        table: 0,
        values: [
          { column: 0, value: "2" },
          { column: 1, value: '{"novo":true,"total":10}' },
        ],
      },
    ]);
  });

  it("permite editar colunas binárias (BLOB / BYTEA) clicando no ícone de lápis", () => {
    rt.unmount();
    const onCommitValue = vi.fn();
    const state = makeState({
      column: { name: "anexo", type: "bytea", kind: "binary" },
      value: "0x4F69",
      editable: { editable: true },
      setNullAccess: { editable: true },
      onCommitValue,
    });

    let tree = rt.render(() => CellValueViewerPanel({ state }));
    // No modo leitura, mostra a tabela hexadecimal
    expect(byTestId(tree, "value-viewer-hex-table")).toBeDefined();

    // Clica no lápis para editar o binário
    (byTestId(tree, "value-viewer-edit-toggle")!.props.onClick as () => void)();
    tree = rt.render(() => CellValueViewerPanel({ state }));

    const textarea = byTestId(tree, "value-viewer-textarea")!;
    expect(textarea.props.value).toBe("0x4F69");
    (textarea.props.onChange as (event: { target: { value: string } }) => void)({
      target: { value: "0xcafe" },
    });

    tree = rt.render(() => CellValueViewerPanel({ state }));
    (byTestId(tree, "value-viewer-apply")!.props.onClick as () => void)();
    expect(onCommitValue).toHaveBeenCalledWith("0xCAFE");
  });
});
