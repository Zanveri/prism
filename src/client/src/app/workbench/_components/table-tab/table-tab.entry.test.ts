import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { QueryRunner } from "../../_lib/use-query-runner";
import type { TableTab, TableView } from "../../_lib/workbench-model";

// A entrada da aba de uma tabela (RN-ABAS-019), com os ganchos do React simulados (o vitest deste projeto não tem DOM): nos Registros, o campo de filtro; na
// Estrutura e no Diagrama, o painel da vista, conectada a conexão ou não. A mini-runtime não desce aos filhos nem liga as `ref`: a prova põe elementos de mentira
// nelas, que é o que o React faria ao montar. Quem decide QUANDO focar é a área das abas (`workbench-tabs.focus.test.ts`).
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { elementsOf } from "@/lib/testing/react-tree";

import { tabEntries } from "../../_lib/tab-focus";
import { RecordsView } from "./records-view";
import { TableTabPanel } from "./table-tab";

const panelOf = (TableTabPanel as unknown as { type: (props: ComponentProps<typeof TableTabPanel>) => ReactNode }).type;

type Fake = { focus: ReturnType<typeof vi.fn> };
const fake = (): Fake => ({ focus: vi.fn() });

/**
 * Renderiza a aba `t1` na vista dada e liga o que o React ligaria: o painel da vista e, com a vista Registros desenhada, o campo de filtro. `show` renderiza de
 * novo, em outra vista. `wired: false` não liga o campo (a vista Registros por montar).
 */
function mount(view: TableView, { disconnected = false, wired = true } = {}) {
  const panel = fake();
  const filter = fake();

  function show(next: TableView) {
    const table = { schema: "loja", name: "pedido", view: next };
    const tab: TableTab = { id: "t1", title: "loja.pedido", connectionId: "c-1", sessionId: null, sql: "", table };
    const found = elementsOf(rt.render(() => panelOf({ tab, table, runner: {} as QueryRunner, connection: undefined, environment: null, visible: true, disconnected, onView: vi.fn(), onOpenTable: vi.fn() })));

    (found.find((element) => element.type === "div" && element.props.tabIndex === -1)!.props.ref as { current: unknown }).current = panel;
    const records = found.find((element) => element.type === RecordsView);
    if (records !== undefined && wired) (records.props.filterRef as { current: unknown }).current = filter;
  }

  show(view);
  return { panel, filter, show };
}

afterEach(() => rt.unmount());

describe("TableTabPanel: a entrada da aba (RN-ABAS-019)", () => {
  it("nos Registros, a entrada é o campo de filtro (ali o Ctrl+Espaço completa, RN-TABELA-011), e o painel da vista não toma o foco", () => {
    const { panel, filter } = mount("data");

    expect(tabEntries.focus("t1")).toBe(true);

    expect(filter.focus).toHaveBeenCalledOnce();
    expect(panel.focus).not.toHaveBeenCalled();
  });

  it.each(["structure", "diagram"] as const)("na vista %s, conectada a conexão ou não, a entrada é o painel da vista (onde o F5 vale), sem rolar a página", (view) => {
    for (const disconnected of [false, true]) {
      const { panel, filter } = mount(view, { disconnected });

      expect(tabEntries.focus("t1")).toBe(true);

      expect(panel.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
      expect(filter.focus).not.toHaveBeenCalled();
      rt.unmount();
    }
  });

  it("a vista de agora é a que vale, lida na hora: trocar de vista muda a entrada sem registrar de novo", () => {
    const view = mount("data");
    expect(tabEntries.focus("t1")).toBe(true);
    expect(view.filter.focus).toHaveBeenCalledOnce();

    view.show("structure");
    expect(tabEntries.focus("t1")).toBe(true);

    expect(view.filter.focus).toHaveBeenCalledOnce();
    expect(view.panel.focus).toHaveBeenCalledOnce();
  });

  it("o campo ainda não existe (a vista Registros por montar), a entrada cai no painel; sem a aba montada, devolve falso e a área das abas escolhe outro lugar", () => {
    const { panel } = mount("data", { wired: false });

    expect(tabEntries.focus("t1")).toBe(true);
    expect(panel.focus).toHaveBeenCalledOnce();

    rt.unmount();
    expect(tabEntries.focus("t1")).toBe(false);
  });

  it("a entrada sai do registro quando a aba desmonta", () => {
    mount("data");
    expect(tabEntries.focus("t1")).toBe(true);

    rt.unmount();

    expect(tabEntries.focus("t1")).toBe(false);
  });
});
