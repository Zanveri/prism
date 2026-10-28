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

  it("permite trocar para o formato Binary e exibe a grade hexadecimal + ASCII igual ao DBeaver", () => {
    rt.unmount();
    const state = makeState({
      column: { name: "Testa", type: "varchar", kind: "text" },
      value: "Testando",
    });
    let tree = rt.render(() => CellValueViewerPanel({ state }));
    expect(byTestId(tree, "value-viewer-format-select")?.props.value).toBe("text");

    const select = byTestId(tree, "value-viewer-format-select")!;
    (select.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: "binary" } });

    tree = rt.render(() => CellValueViewerPanel({ state }));
    expect(byTestId(tree, "value-viewer-format-select")?.props.value).toBe("binary");

    const hexTable = byTestId(tree, "value-viewer-hex-table");
    expect(hexTable).toBeDefined();
    const offsetCell = byTestId(tree, "value-viewer-hex-offset-0");
    const asciiCell = byTestId(tree, "value-viewer-hex-ascii-0");
    expect(offsetCell?.props.children).toBe("00000000");
    expect(asciiCell?.props.children).toBe("Testando");
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

  it("permite editar o valor e aplicar na célula ou definir NULL quando a célula é editável", () => {
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
});
