import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePage } from "@/lib/testing/fake-page";

import type { QueryTab } from "../_lib/workbench-model";

// O X da aba não toma o foco no clique do mouse (RN-ABAS-019), como o botão do meio já não toma: o foco fica onde estava, e se estava na aba que fecha, quem o leva
// à aba que ficou ativa é a regra do foco perdido (`workbench-tabs.focus.test.ts`). Com os ganchos do React simulados, porque o que se confere é o `onMouseDown`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { elementsOf } from "@/lib/testing/react-tree";

import { TabStrip } from "./tab-strip";

const noop = () => {};
const tab = (id: string, over: Partial<QueryTab> = {}): QueryTab => ({ id, title: `${id}.sql`, connectionId: "c-1", sessionId: null, sql: "", ...over });

/** A faixa de duas abas, a primeira com o resultado numa aba (que tem o X dela), e o que cada X faz. */
function closeButtons(onClose: () => void) {
  const strip = TabStrip as unknown as (props: ComponentProps<typeof TabStrip>) => ReactNode;
  const tree = rt.render(() => strip({ tabs: [tab("a", { resultPlace: "tab" }), tab("b")], activeTabId: "a", connectionOf: () => undefined, environmentOf: () => null, onSelect: noop, onClose, onPlace: noop, windowId: 1, onReorder: noop, onMove: noop, onReceive: noop }));
  return elementsOf(tree).filter((element) => element.type === "button" && typeof element.props.onMouseDown === "function" && element.props.role !== "tab");
}

const mouseDown = (button: number) => ({ button, preventDefault: vi.fn() });

beforeEach(() => {
  const page = createFakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

describe("o X da aba não leva o foco no clique do mouse (RN-ABAS-019)", () => {
  it("há um X por aba e o da aba do resultado, e o botão principal não toma o foco (mousedown tratado), sem impedir o clique", () => {
    const close = vi.fn();
    const buttons = closeButtons(close);

    expect(buttons.map((button) => button.props["aria-label"])).toEqual(["Fechar a.sql", "Voltar o resultado de a.sql para o painel", "Fechar b.sql"]);
    for (const button of buttons) {
      const event = mouseDown(0);
      (button.props.onMouseDown as (event: unknown) => void)(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }

    // O clique segue o caminho de sempre: o fechar não depende do foco.
    (buttons[2].props.onClick as () => void)();
    expect(close).toHaveBeenCalledWith("one", "b");
  });

  it("os outros botões do mouse não são tratados: o do meio é da aba (rolagem automática do Windows) e o direito abre o menu", () => {
    for (const button of closeButtons(noop)) {
      for (const which of [1, 2]) {
        const event = mouseDown(which);
        (button.props.onMouseDown as (event: unknown) => void)(event);
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
    }
  });
});
