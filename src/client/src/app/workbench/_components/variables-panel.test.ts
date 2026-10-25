import { describe, expect, it, vi } from "vitest";

// O painel "Variáveis" com os ganchos do React simulados (`createHookRuntime`; o vitest deste projeto não tem DOM): o que o teclado faz (RN-VAR-024) e qual linha
// está escolhida quando o painel abre. As linhas e a árvore são de `variables-panel.ts`, com teste próprio.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return { ...createHookRuntime(), copied: [] as string[], toast: { success: vi.fn(), warning: vi.fn() } };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@/components/ui", () => ({ ContextMenu: function ContextMenu() { return null; }, useHost: () => ({}), useToast: () => rt.toast }));
vi.mock("@/lib/host/host", () => ({ hostClipboard: () => ({ writeText: (text: string) => { rt.copied.push(text); return Promise.resolve(); } }) }));

import type { ComponentProps } from "react";

import { elementsOf } from "@/lib/testing/react-tree";

import { Random } from "../_lib/variables/random";
import { ScriptRun } from "../_lib/variables/run";
import { readScript } from "../_lib/variables/script";
import { VariablesPanel } from "./variables-panel";

const config = { random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => 1_000 };

function props(source: string, select: { serial: number; name: string | null }): ComponentProps<typeof VariablesPanel> {
  const model = readScript(source, undefined, { blankLines: true });
  const run = new ScriptRun(model, config);
  for (const item of model.items) if (item.parsed !== null) run.evaluate(item.index);
  return { model, values: { values: run.tab, counter: run.counter }, select, onGoTo: vi.fn() };
}

const rowsOf = (view: ReturnType<typeof VariablesPanel>) => elementsOf(view).filter((element) => element.props.role === "row" && element.props["data-row-key"] !== undefined);
const selectedKey = (view: ReturnType<typeof VariablesPanel>) => rowsOf(view).find((row) => row.props["aria-selected"] === true)?.props["data-row-key"];
const grid = (view: ReturnType<typeof VariablesPanel>) => elementsOf(view).find((element) => element.props.role === "treegrid")!.props as { onKeyDown: (event: unknown) => void };
const key = (init: Record<string, unknown>) => ({ altKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), ...init });

describe("o painel Variáveis (RN-VAR-024)", () => {
  const source = "let a = 1\nlet b = 2\nlet c = 3";

  it("abre com a linha da variável pedida de fora escolhida, e não com a primeira", () => {
    rt.unmount();
    const view = rt.render(() => VariablesPanel(props(source, { serial: 1, name: "c" })));
    expect(selectedKey(view)).toBe("c");
  });

  it("um pedido novo com o painel já aberto escolhe a linha dele", () => {
    rt.unmount();
    expect(selectedKey(rt.render(() => VariablesPanel(props(source, { serial: 0, name: null }))))).toBe("a");
    expect(selectedKey(rt.render(() => VariablesPanel(props(source, { serial: 1, name: "b" }))))).toBe("b");
  });

  it("o Ctrl+C e o ⌘C copiam o valor da linha", async () => {
    for (const modifier of ["ctrlKey", "metaKey"]) {
      rt.unmount();
      rt.copied.length = 0;
      const view = rt.render(() => VariablesPanel(props(source, { serial: 1, name: "b" })));
      const event = key({ key: "c", [modifier]: true });
      grid(view).onKeyDown(event);
      await Promise.resolve();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(rt.copied).toEqual(["2"]);
    }
  });

  it("o Enter em “Mostrar mais” que mostra o resto leva a escolha ao primeiro item que apareceu", () => {
    rt.unmount();
    const many = `let ids = [${Array.from({ length: 150 }, (_, index) => index).join(", ")}]`;
    const p = props(many, { serial: 0, name: null });
    const press = (init: Record<string, unknown>) => {
      grid(rt.render(() => VariablesPanel(p))).onKeyDown(key(init));
      return rt.render(() => VariablesPanel(p));
    };
    press({ key: "ArrowRight" });
    const last = press({ key: "End" });
    expect(selectedKey(last)).toBe("ids/more");

    const after = press({ key: "Enter" });
    expect(rowsOf(after).some((row) => String(row.props["data-row-key"]).endsWith("/more"))).toBe(false);
    expect(selectedKey(after)).toBe("ids/100");
  });
});
