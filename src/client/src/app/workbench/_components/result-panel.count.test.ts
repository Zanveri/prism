import { isValidElement, type ReactElement, type ReactNode } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { RowsState, RunnerState } from "../_lib/use-query-runner";

// "Contar de novo" (RN-SQL-006, issue #10). A área de resultado com os ganchos do React simulados (`createHookRuntime`), para conferir a ÁRVORE que ela
// monta: o botão de contar tem de ser o mesmo elemento, no mesmo lugar, antes e depois da contagem, ou o React o troca por outro e o foco cai no `body`,
// fora da aba (e o F5 da aba deixa de valer). O vitest não tem DOM: o que se confere é o tipo e a posição, que é o que o React compara.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@/app/settings/_lib/use-preferences", async () => {
  const { defaultPreferences } = await import("@/app/settings/_lib/preferences");
  return { usePreferences: () => ({ preferences: defaultPreferences, update: () => {} }) };
});

import { elementsOf } from "@/lib/testing/react-tree";

import { workbenchCopy } from "../_lib/workbench.copy";
import { CountButton, ResultPanel } from "./result-panel";

const copy = workbenchCopy.result;
const noop = () => {};

const rows: RowsState = {
  status: "rows",
  id: 1,
  target: { sql: "select * from t", offset: 0 },
  columns: [{ name: "id", type: "int4", kind: "number" }],
  rows: [["1"], ["2"]],
  truncated: new Map(),
  hasMore: true,
  totalRows: null,
  elapsedMs: 42,
  pages: 1,
  loadingMore: false,
  cancelling: false,
  cursorClosed: false,
  total: null,
  counting: false,
};

/** O grupo de filhos da barra que tem o botão de contar, e a posição dele ali. */
function countSlot(state: RunnerState, connected = true): { siblings: ReactNode[]; index: number } {
  const tree = rt.render(() => ResultPanel({ state, connected, onLoadMore: noop, onCount: noop, onRerun: noop }));
  const holder = elementsOf(tree).find((element) => Array.isArray(element.props.children) && (element.props.children as ReactNode[]).some((child) => isValidElement(child) && child.type === CountButton));
  if (holder === undefined) return { siblings: [], index: -1 };
  const siblings = holder.props.children as ReactNode[];
  return { siblings, index: siblings.findIndex((child) => isValidElement(child) && child.type === CountButton) };
}

describe("contar de novo na barra do resultado (RN-SQL-006, issue #10)", () => {
  it("o botão de contar é o mesmo elemento, no mesmo lugar, antes da contagem, contando, com o total e contando de novo", () => {
    const states = [rows, { ...rows, counting: true }, { ...rows, total: 1000 }, { ...rows, total: 1000, counting: true }];
    const slots = states.map((state) => countSlot(state));

    expect(slots.every((slot) => slot.index >= 0)).toBe(true);
    expect(new Set(slots.map((slot) => slot.index)).size).toBe(1);
    expect(new Set(slots.map((slot) => slot.siblings.length)).size).toBe(1);
  });

  it("é o mesmo elemento, no mesmo lugar, enquanto outro comando roda sobre as linhas (o F5): ele fica, ocupado, e \"Executando…\" vem depois", () => {
    const counted = { ...rows, total: 1000 };
    const before = countSlot(counted);
    const running = countSlot({ status: "running", cancelling: false, previous: counted });
    const auto = countSlot({ status: "running", cancelling: false, previous: counted, auto: true });

    for (const slot of [running, auto]) {
      expect(slot.index).toBe(before.index);
      expect(slot.siblings.length).toBe(before.siblings.length);
    }
    const button = running.siblings[running.index] as ReactElement<{ busy: boolean }>;
    expect(button.props.busy).toBe(true);
    expect((auto.siblings[auto.index] as ReactElement<{ busy: boolean }>).props.busy).toBe(false);

    const tree = rt.render(() => ResultPanel({ state: { status: "running", cancelling: false, previous: counted }, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop }));
    const status = elementsOf(tree).find((element) => element.props.role === "status");
    expect(status?.props.children).toBe(copy.running);
  });

  it("com o total contado, ele fica à vista; contando de novo, o de antes continua lá, marcado", () => {
    const counted = renderToStaticMarkup(createElement("div", null, countSlot({ ...rows, total: 1000 }).siblings));
    const recounting = renderToStaticMarkup(createElement("div", null, countSlot({ ...rows, total: 1000, counting: true }).siblings));

    expect(counted).toContain("Total: 1.000 linhas");
    expect(counted).not.toContain(copy.recounting);
    expect(recounting).toContain(`Total: 1.000 linhas · ${copy.recounting}`);
  });

  it("sem sessão na aba não há o que contar de novo: o total fica, e o botão não", () => {
    const tree = rt.render(() => ResultPanel({ state: { ...rows, total: 1000 }, connected: false, onLoadMore: noop, onCount: noop, onRerun: noop }));
    const elements = elementsOf(tree);

    expect(countSlot({ ...rows, total: 1000 }, false).index).toBe(-1);
    expect(elements.some((element) => element.type === CountButton)).toBe(false);
    expect(elements.some((element) => Array.isArray(element.props.children) && (element.props.children as unknown[]).includes(copy.total(1000)))).toBe(true);
  });
});

describe("CountButton", () => {
  const button = (state: RowsState, onCount = vi.fn(), busy = false) => CountButton({ rows: state, busy, onCount }) as ReactElement<Record<string, unknown>>;

  it("antes da contagem é o texto \"Contar total\"; depois, o ícone com a dica e o nome \"Contar de novo\"", () => {
    const first = button(rows);
    const again = button({ ...rows, total: 1000 });

    expect(first.props.children).toBe(copy.count);
    expect(first.props["aria-label"]).toBeUndefined();
    expect(again.props).toMatchObject({ "aria-label": copy.recount, title: copy.recount });
    expect(again.type).toBe(first.type);
  });

  it("ocupado (contando, carregando mais, outro comando da pessoa), ele não age, mas não se desabilita de verdade: o botão `disabled` perderia o foco", () => {
    for (const state of [{ ...rows, counting: true }, { ...rows, loadingMore: true }, { ...rows, total: 1000, counting: true }, rows]) {
      const onCount = vi.fn();
      const element = button(state, onCount, true);

      (element.props.onClick as () => void)();

      expect(onCount).not.toHaveBeenCalled();
      expect(element.props).toMatchObject({ "aria-disabled": true });
      expect(element.props.disabled).toBeUndefined();
    }
  });

  it("livre, o clique conta (de novo, com o total na tela)", () => {
    const onCount = vi.fn();

    (button({ ...rows, total: 1000 }, onCount).props.onClick as () => void)();

    expect(onCount).toHaveBeenCalledOnce();
  });
});

describe("o foco do botão de contar que sai da barra (RN-SQL-006)", () => {
  /** Uma página de mentira: quem tem o foco, e o `body`, onde ele cai quando quem o tinha sai da página. */
  function page() {
    const body = { tag: "body" };
    return { body, activeElement: body as unknown };
  }

  it("o botão que sai da página COM o foco avisa (a limpeza da ref); sem o foco, não", () => {
    const onFocusLost = vi.fn();
    const element = rt.render(() => CountButton({ rows: { ...rows, total: 1000 }, busy: false, onCount: noop, onFocusLost })) as ReactElement<{ ref: (button: unknown) => (() => void) | undefined }>;
    const doc = page();
    const button = { ownerDocument: doc };

    doc.activeElement = button;
    element.props.ref(button)?.();
    expect(onFocusLost).toHaveBeenCalledOnce();

    doc.activeElement = doc.body;
    element.props.ref(button)?.();
    expect(onFocusLost).toHaveBeenCalledOnce();
    expect(element.props.ref(null)).toBeUndefined();
  });

  it("avisada, a área leva o foco para a grade; sem grade, para ela mesma; e se o foco já está em outro lugar, deixa", () => {
    for (const [hasGrid, elsewhere] of [[true, false], [false, false], [true, true]] as const) {
      const doc = page();
      const grid = { focus: vi.fn(() => (doc.activeElement = grid)) };
      const area = { ownerDocument: doc, querySelector: vi.fn(() => (hasGrid ? grid : null)), focus: vi.fn(() => (doc.activeElement = area)) };
      if (elsewhere) doc.activeElement = { tag: "editor" };
      const props = { state: { ...rows, total: 1000 }, connected: true, onLoadMore: noop, onCount: noop, onRerun: noop };

      const tree = rt.render(() => ResultPanel(props));
      const section = elementsOf(tree).find((element) => element.type === "section")!;
      (section.props.ref as { current: unknown }).current = area;
      const count = elementsOf(tree).find((element) => element.type === CountButton)!;
      (count.props.onFocusLost as () => void)();
      rt.render(() => ResultPanel(props));

      expect(grid.focus).toHaveBeenCalledTimes(hasGrid && !elsewhere ? 1 : 0);
      expect(area.focus).toHaveBeenCalledTimes(!hasGrid && !elsewhere ? 1 : 0);
      expect(section.props.tabIndex).toBe(-1);
      rt.unmount();
    }
  });
});
