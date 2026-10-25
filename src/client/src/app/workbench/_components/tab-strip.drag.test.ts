import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// O arraste na faixa (RN-ABAS-010), com os ganchos do React simulados (`createHookRuntime`: o vitest deste projeto não tem DOM): a faixa começa o arraste
// da sessão no `dragstart`, marca a soltura que caiu nela e entrega o `dragend` a quem a desenha.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@/lib/api/bridge", () => ({ listOtherWindows: async () => [], resultWindowsAvailable: () => false }));

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { createTabDragSession } from "../_lib/tab-drag";
import { resultTabDragType, tabDragType, writeTabDrag } from "../_lib/tab-order";
import type { QueryTab } from "../_lib/workbench-model";
import { TabStrip } from "./tab-strip";

// O que os efeitos da faixa tocam na página: o ouvinte do `pointerdown` e o `ResizeObserver` (as refs ficam vazias, sem DOM).
vi.stubGlobal("document", { addEventListener: () => {}, removeEventListener: () => {} });
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);

const a = "6f1c1f62-5d2b-4d36-9a37-2f6f0c7a1b10";
const b = "11111111-1111-4111-8111-111111111111";
const query = (id: string, title: string): QueryTab => ({ id, title, connectionId: "c-1", sessionId: null, sql: "" });

function mount(tabs: QueryTab[] = [query(a, "a.sql"), query(b, "b.sql")]) {
  const session = createTabDragSession(() => {});
  const handlers = { onReorder: vi.fn(), onReceive: vi.fn(), onDragEnd: vi.fn(), onMove: vi.fn() };
  const tree = rt.render(() => TabStrip({ tabs, activeTabId: a, connectionOf: () => undefined, environmentOf: () => null, onSelect: () => {}, onClose: () => {}, windowId: 1, drag: session, ...handlers }) as ReactElement);
  const all = elementsOf(tree);
  const frame = all.find((element) => element.props["data-tab-strip"] !== undefined) as Found;
  const tabOf = (id: string) => all.find((element) => element.props["data-tab-id"] === id) as Found;
  const resultTabOf = (id: string) => all.find((element) => element.props["data-result-tab-id"] === id) as Found;
  return { session, handlers, frame, tabOf, resultTabOf };
}

/** Um `dataTransfer` de mentira, com o que o `dragstart` escreveu. */
function transfer(types: Record<string, string> = {}, dropEffect = "none") {
  const data = { ...types };
  return { data, types: Object.keys(data), dropEffect, effectAllowed: "", setData: (type: string, value: string) => void (data[type] = value), getData: (type: string) => data[type] ?? "" };
}

afterEach(() => rt.unmount());

describe("a faixa e o arraste da aba (RN-ABAS-010)", () => {
  it("a faixa se marca (o véu a deixa passar) e fica por cima do véu", () => {
    const { frame } = mount();

    expect(frame.props["data-tab-strip"]).toBe("");
    expect(String(frame.props.className).split(" ")).toEqual(expect.arrayContaining(["relative", "z-50"]));
  });

  it("o dragstart escreve o tipo da aba com a janela e a aba, e começa o arraste da sessão sem mudar a página", () => {
    const { session, tabOf } = mount();
    const dataTransfer = transfer();

    (tabOf(a).props.onDragStart as (event: unknown) => void)({ dataTransfer });

    expect(dataTransfer.data).toEqual({ [tabDragType]: writeTabDrag({ windowId: 1, tabId: a }) });
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(session.dragging()).toEqual({ tabId: a, kind: "tab" });
    expect(session.getSnapshot()).toBeNull();
  });

  it("solta na faixa da própria janela: muda de lugar e marca a soltura (o fim do arraste não pede janela nova); a de outra janela é pedida a ela", () => {
    const { session, handlers, frame } = mount();
    session.begin(a, "tab");
    const drop = (windowId: number) => (frame.props.onDrop as (event: unknown) => void)({ preventDefault: () => {}, clientX: 0, dataTransfer: transfer({ [tabDragType]: writeTabDrag({ windowId, tabId: a }) }) });

    drop(1);
    expect(handlers.onReorder).toHaveBeenCalledOnce();
    expect(session.finish()).toMatchObject({ dropped: "strip" });

    drop(2);
    expect(handlers.onReceive).toHaveBeenCalledWith(2, a, expect.any(Number));
  });

  it("o dragend entrega o efeito, o ponto na tela e na página e o tamanho da página, e não decide nada sozinho", () => {
    const { handlers, tabOf } = mount();
    const currentTarget = { ownerDocument: { defaultView: { innerWidth: 1200, innerHeight: 800 } } };

    (tabOf(b).props.onDragEnd as (event: unknown) => void)({ currentTarget, screenX: 1500, screenY: 40, clientX: 1300, clientY: 10, dataTransfer: { dropEffect: "move" } });

    expect(handlers.onDragEnd).toHaveBeenCalledExactlyOnceWith(b, { effect: "move", screen: { x: 1500, y: 40 }, client: { x: 1300, y: 10 }, viewport: { width: 1200, height: 800 } });
    expect(handlers.onMove).not.toHaveBeenCalled();
  });

  it("a aba do resultado arrasta com o tipo dela, começa o arraste do tipo `result` e entrega o `dragend` como a aba (RN-ABAS-010 e 012)", () => {
    const { session, handlers, frame, resultTabOf } = mount([{ ...query(a, "a.sql"), resultPlace: "tab" }, query(b, "b.sql")]);
    const dataTransfer = transfer();

    (resultTabOf(a).props.onDragStart as (event: unknown) => void)({ dataTransfer });

    // O tipo é o dela, que as faixas não aceitam: soltá-la na faixa não muda nada.
    expect(dataTransfer.data).toEqual({ [resultTabDragType]: writeTabDrag({ windowId: 1, tabId: a }) });
    expect(session.dragging()).toEqual({ tabId: a, kind: "result" });
    (frame.props.onDrop as (event: unknown) => void)({ preventDefault: () => {}, clientX: 0, dataTransfer: transfer({ [resultTabDragType]: writeTabDrag({ windowId: 1, tabId: a }) }) });
    expect(handlers.onReorder).not.toHaveBeenCalled();

    const currentTarget = { ownerDocument: { defaultView: { innerWidth: 1200, innerHeight: 800 } } };
    (resultTabOf(a).props.onDragEnd as (event: unknown) => void)({ currentTarget, screenX: 1500, screenY: 40, clientX: 1300, clientY: 10, dataTransfer: { dropEffect: "none" } });
    expect(handlers.onDragEnd).toHaveBeenCalledExactlyOnceWith(a, { effect: "none", screen: { x: 1500, y: 40 }, client: { x: 1300, y: 10 }, viewport: { width: 1200, height: 800 } });
  });
});
