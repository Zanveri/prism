import { EditorState } from "@codemirror/state";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// O véu com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`: o vitest deste projeto não tem DOM). A página é de
// mentira: guarda os ouvintes da captura que o véu registra, e `fire` faz o caminho do evento (a captura na raiz, depois o alvo), com o `stopPropagation`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { elementsOf } from "@/lib/testing/react-tree";

import { createTabDragSession } from "../_lib/tab-drag";
import { resultTabDragType, tabDragType, writeTabDrag } from "../_lib/tab-order";
import { isInTabStrip, TabDragVeil } from "./tab-drag-veil";

type Listener = (event: FakeDragEvent) => void;
type FakeTarget = { nodeType: number; closest: (selector: string) => unknown; listeners: Map<string, Listener> };
type FakeDragEvent = {
  type: string;
  target: FakeTarget;
  dataTransfer: { types: string[]; dropEffect: string; getData: (type: string) => string };
  stopped: boolean;
  defaultPrevented: boolean;
  stopPropagation: () => void;
  preventDefault: () => void;
};

const capture = new Map<string, Listener>();
const page = {
  addEventListener: (type: string, listener: Listener, useCapture: boolean) => void (useCapture && capture.set(type, listener)),
  removeEventListener: (type: string) => void capture.delete(type),
};
const area = { current: { ownerDocument: page, getBoundingClientRect: () => ({ left: 260, top: 40, width: 900, bottom: 840 }), querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 69 }) }) } as unknown as HTMLElement };

const element = (inStrip: boolean): FakeTarget => ({ nodeType: 1, closest: (selector) => (inStrip && selector === "[data-tab-strip]" ? {} : null), listeners: new Map() });

/** O caminho do evento: a captura da raiz, e então o alvo, se ninguém parou a propagação. */
function fire(type: string, target: FakeTarget, types: string[], data: Record<string, string> = {}): FakeDragEvent {
  const event: FakeDragEvent = {
    type,
    target,
    dataTransfer: { types, dropEffect: "none", getData: (kind) => data[kind] ?? "" },
    stopped: false,
    defaultPrevented: false,
    stopPropagation: () => void (event.stopped = true),
    preventDefault: () => void (event.defaultPrevented = true),
  };
  capture.get(type)?.(event);
  if (!event.stopped) target.listeners.get(type)?.(event);
  return event;
}

/** O editor (o `.cm-content`): aceita o que se solta nele como texto, como o CodeMirror faz com o que não é dele. */
function editorTarget() {
  const target = element(false);
  const editor = { state: EditorState.create({ doc: "select 1" }) };
  const accept = (event: FakeDragEvent) => event.preventDefault();
  target.listeners.set("dragover", accept);
  target.listeners.set("drop", (event) => {
    event.preventDefault();
    const text = event.dataTransfer.getData("text/plain") || event.dataTransfer.getData(tabDragType) || event.dataTransfer.getData(resultTabDragType);
    editor.state = editor.state.update({ changes: { from: editor.state.doc.length, insert: text } }).state;
  });
  return { target, editor };
}

const tabId = "6f1c1f62-5d2b-4d36-9a37-2f6f0c7a1b10";

function mount({ windowId = 1 as number | null, onlyTab = false } = {}) {
  const session = createTabDragSession(() => {});
  const onReceive = vi.fn();
  const props = { session, windowId, onlyTab, onReceive, area: { current: area.current } };
  const show = () => rt.render(() => TabDragVeil(props)) as ReactElement<Record<string, unknown>> | null;
  show();
  return { session, onReceive, show, props };
}

afterEach(() => {
  rt.unmount();
  capture.clear();
});

describe("o véu do arraste da aba (RN-ABAS-010)", () => {
  it("soltar a aba sobre o editor não escreve nada nele: a raiz para a propagação na captura, e quem responde é o véu", () => {
    const { session } = mount();
    const { target, editor } = editorTarget();
    session.begin(tabId, "tab");
    const data = { [tabDragType]: writeTabDrag({ windowId: 1, tabId }) };

    const over = fire("dragover", target, [tabDragType], data);
    const drop = fire("drop", target, [tabDragType], data);

    expect(over).toMatchObject({ stopped: true, defaultPrevented: true });
    expect(over.dataTransfer.dropEffect).toBe("move");
    expect(drop.stopped).toBe(true);
    expect(editor.state.doc.toString()).toBe("select 1");
    // O véu marcou a soltura desta janela: o pedido da janela nova sai no `dragend`.
    expect(session.finish()).toMatchObject({ dropped: "veil" });
  });

  it("a aba do resultado também não chega ao editor; o texto comum, sim (o véu só olha os tipos da aba)", () => {
    mount();
    const result = editorTarget();
    fire("drop", result.target, [resultTabDragType], { [resultTabDragType]: writeTabDrag({ windowId: 1, tabId }) });
    expect(result.editor.state.doc.toString()).toBe("select 1");

    const text = editorTarget();
    const drop = fire("drop", text.target, ["text/plain"], { "text/plain": " where 1 = 1" });
    expect(drop.stopped).toBe(false);
    expect(text.editor.state.doc.toString()).toBe("select 1 where 1 = 1");
  });

  it("sobre a faixa o véu não responde: a faixa recebe o evento (o marcador do lugar, RN-ABAS-001), e o véu some", () => {
    const { session, show } = mount();
    session.begin(tabId, "tab");

    fire("dragenter", element(false), [tabDragType]);
    expect(elementsOf(show()).some((node) => node.props.children === "Solte para abrir numa janela nova")).toBe(true);

    const strip = element(true);
    expect(fire("dragenter", strip, [tabDragType]).stopped).toBe(false);
    expect(fire("dragover", strip, [tabDragType]).stopped).toBe(false);
    expect(show()).toBeNull();
  });

  it("o véu cobre a janela inteira com a frase no meio da área das abas, abaixo da faixa, e é só visual", () => {
    const { session, show } = mount();
    session.begin(tabId, "tab");
    fire("dragenter", element(false), [tabDragType]);

    const veil = show();
    expect(veil?.props).toMatchObject({ "aria-hidden": true, "data-tab-drag-veil": "accepts" });
    expect(String(veil?.props.className).split(" ")).toEqual(expect.arrayContaining(["fixed", "inset-0", "z-40", "border-2", "border-dashed", "border-accent"]));
    const text = elementsOf(veil).find((node) => node.type === "p");
    expect(text?.props.style).toEqual({ left: 260, top: 69, width: 900, height: 771 });
  });

  it("com uma aba só, o véu diz que a janela já é aquela aba, com o ponteiro de proibido, e a soltura não vale", () => {
    const { session, show } = mount({ onlyTab: true });
    session.begin(tabId, "tab");

    const over = fire("dragover", element(false), [tabDragType]);
    expect(over).toMatchObject({ stopped: true, defaultPrevented: false });
    expect(over.dataTransfer.dropEffect).toBe("none");
    expect(show()?.props["data-tab-drag-veil"]).toBe("refuses");
    expect(elementsOf(show()).some((node) => node.props.children === "Esta já é a única aba da janela.")).toBe(true);
  });

  it("a aba de outra janela solta no véu vem para o fim da faixa desta (RN-ABAS-003); a aba do resultado de outra janela, não (sem véu)", () => {
    const { onReceive, show } = mount();

    fire("dragenter", element(false), [tabDragType]);
    expect(elementsOf(show()).some((node) => node.props.children === "Solte para trazer a aba para esta janela")).toBe(true);
    fire("drop", element(false), [tabDragType], { [tabDragType]: writeTabDrag({ windowId: 2, tabId }) });
    expect(onReceive).toHaveBeenCalledExactlyOnceWith(2, tabId);

    const result = fire("dragover", element(false), [resultTabDragType]);
    expect(result).toMatchObject({ stopped: true, defaultPrevented: false });
    expect(show()).toBeNull();
  });

  it("o contador de entradas e saídas: passar de um elemento a outro não apaga o véu; sair da janela, sim", () => {
    const { session, show } = mount();
    session.begin(tabId, "tab");
    const a = element(false);
    const b = element(false);

    fire("dragenter", a, [tabDragType]);
    fire("dragenter", b, [tabDragType]);
    fire("dragleave", a, [tabDragType]);
    expect(show()).not.toBeNull();
    fire("dragleave", b, [tabDragType]);
    expect(show()).toBeNull();
  });

  it("fora do app (no navegador do desenvolvimento) não há véu, mas o editor continua sem receber a aba", () => {
    const { session, show } = mount({ windowId: null });
    const { target, editor } = editorTarget();
    session.begin(tabId, "tab");

    fire("dragenter", target, [tabDragType]);
    fire("drop", target, [tabDragType], { [tabDragType]: writeTabDrag({ windowId: null, tabId }) });
    expect(show()).toBeNull();
    expect(editor.state.doc.toString()).toBe("select 1");
  });

  it("isInTabStrip: pelo `nodeType` e pelo marcador da faixa, sem `instanceof` (o elemento pode ser de outro documento)", () => {
    expect(isInTabStrip(element(true) as unknown as EventTarget)).toBe(true);
    expect(isInTabStrip(element(false) as unknown as EventTarget)).toBe(false);
    expect(isInTabStrip({ nodeType: 3 } as unknown as EventTarget)).toBe(false);
    expect(isInTabStrip(null)).toBe(false);
  });
});
