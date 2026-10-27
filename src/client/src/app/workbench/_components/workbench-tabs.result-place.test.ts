import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryTab } from "../_lib/workbench-model";

// O lugar do resultado na faixa e nos painéis (`WorkbenchTabs`, seção 39: RN-ABAS-011, 012 e 014), com os ganchos do React simulados: o painel da aba do
// resultado logo depois do da aba dela, o que cada painel recebe, o Ctrl+W e o F6 da faixa, a troca pelo menu com o anúncio, e "Numa janela" desabilitado
// enquanto a aba vai para outra janela. A área de trabalho (`useWorkbench`), a faixa, os painéis e a ponte são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  const runner = { values: { snapshot: () => ({ values: new Map(), counter: 0 }) }, getState: () => ({ status: "idle" }), autoRunSettled: () => Promise.resolve(), autoRefresh: { pause: vi.fn() }, sessionOf: () => null };
  const workbench = {
    tabs: [] as unknown[],
    activeTabId: null as string | null,
    resultActive: false,
    runnerOf: () => runner,
    showEntry: vi.fn(),
    setResultPlace: vi.fn(),
    closeTab: vi.fn(),
    detachTab: vi.fn(),
  };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const focus = { request: vi.fn(), forgetExcept: vi.fn(), pending: vi.fn(() => false) };
  const host = { releaseFocusIn: vi.fn(), focusResultIn: vi.fn(), resultHostOf: vi.fn(() => ({ id: "raiz" })) };
  let release: () => void = () => {};
  const sendTabAway = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => (release = () => resolve({ ok: true }))));

  return { ...createHookRuntime(), workbench, toast, focus, host, sendTabAway, release: () => release() };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQuery: () => ({ data: undefined }), useQueryClient: () => ({}) }));
vi.mock("@/components/ui", () => ({ ConfirmDialog: () => null, useToast: () => rt.toast }));
vi.mock("@/lib/api/bridge", () => ({ currentWindowId: () => 1, onTabWanted: () => () => {}, onWindowCloseRequested: () => () => {}, sendTabAway: rt.sendTabAway, tellWindows: () => {}, resultWindowsAvailable: () => false, onResultWindowClosed: () => () => {}, onResultWindowState: () => () => {} }));
vi.mock("../_lib/data-export/data-exports", () => ({ exportTracker: { count: () => 0, cancelAll: async () => {} } }));
vi.mock("../_lib/data-import/data-imports", () => ({ loadTracker: { cancelAll: async () => {} }, windowTransfers: () => ({ exports: 0, imports: 0, copies: 0 }) }));
vi.mock("../_lib/connection-intent", () => ({ createDisconnectLog: () => ({ subscribe: () => () => {}, getSnapshot: () => new Set(), forget: () => {}, mark: () => {} }) }));
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => true }));
vi.mock("../_lib/result-slots", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/result-slots")>()), resultFocus: rt.focus }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ ...noop, restoredTableConnections: new Set(), ...rt.workbench }) }));
vi.mock("./result-host", () => rt.host);
vi.mock("./use-script-saving", () => ({ useScriptSaving: () => ({ save: async () => true, dialog: null }) }));
vi.mock("./query-tab", () => ({ QueryTabPanel: () => null }));
vi.mock("./table-tab/table-tab", () => ({ TableTabPanel: () => null }));
vi.mock("./script-dialogs", () => ({ UnsavedScriptsDialog: () => null }));
vi.mock("./unsaved-edits-dialog", () => ({ UnsavedEditsDialog: () => null }));
vi.mock("./tab-strip", () => ({ TabStrip: () => null, panelElementId: (id: string) => `painel-${id}`, tabElementId: (id: string) => `aba-${id}` }));

import { createFakePage } from "@/lib/testing/fake-page";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { QueryTabPanel } from "./query-tab";
import { TabStrip } from "./tab-strip";
import { WorkbenchTabs } from "./workbench-tabs";

const noop = Object.fromEntries(["setActiveTab", "updateTab", "setTableView", "openTableTab", "reorderTab", "shiftTab", "releaseWindow", "markScriptEdited", "switchConnection", "switchDatabase", "holdForWindowClose", "releaseWindowClose"].map((name) => [name, vi.fn()]));

const tab = (id: string, over: Partial<QueryTab> = {}): QueryTab => ({ id, title: `${id}.sql`, connectionId: "c1", sessionId: null, sql: "", ...over });

function render(): Found[] {
  return elementsOf(rt.render(() => WorkbenchTabs() as ReactElement));
}

const stripOf = (found: Found[]) => found.find((element) => element.type === TabStrip)!.props as Record<string, (...args: never[]) => unknown> & { resultActive: boolean };
const panelOf = (found: Found[], id: string) => found.find((element) => element.type === QueryTabPanel && (element.props.tab as QueryTab).id === id)!.props as Record<string, unknown>;
const keysOf = (found: Found[]) => found.find((element) => element.type === "section")!.props.onKeyDown as (event: unknown) => void;
const keyEvent = (over: Record<string, unknown>) => ({ key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), target: { closest: () => null }, ...over });
const status = (found: Found[]) => found.find((element) => element.props.role === "status")!;

beforeEach(() => {
  vi.clearAllMocks();
  rt.workbench.resultActive = false;
  // RN-ABAS-019: a área das abas ouve o foco da página e as teclas da janela; o vitest não tem página, e a de mentira basta.
  const page = createFakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

describe("os painéis (RN-ABAS-012)", () => {
  it("a aba com o resultado numa aba tem o painel do resultado logo depois do dela, com o nome 'Resultado de …', escondido com a da consulta à frente", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" }), tab("b")];
    rt.workbench.activeTabId = "a";
    const found = render();

    const panels = found.filter((element) => element.props.role === "tabpanel" || typeof element.props.tabId === "string");
    expect(panels.map((panel) => (panel.props.id as string | undefined) ?? `resultado-${panel.props.tabId as string}`)).toEqual(["painel-a", "resultado-a", "painel-b"]);
    expect(panels[1].props.label).toBe("Resultado de a.sql");
    expect(panels[1].props.hidden).toBe(true);
    expect(panels[0].props.hidden).toBe(false);
    expect(panelOf(found, "a")).toMatchObject({ active: true, place: "tab", editorShown: true, resultShown: false, moving: false });
  });

  it("com a aba do resultado ativa, o painel dela aparece e o da consulta fica escondido; a aba da consulta continua 'active', e o resultado está à vista", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" })];
    rt.workbench.activeTabId = "a";
    rt.workbench.resultActive = true;
    const found = render();

    const panels = found.filter((element) => element.props.role === "tabpanel" || typeof element.props.tabId === "string");
    expect(panels.map((panel) => panel.props.hidden)).toEqual([true, false]);
    expect(panelOf(found, "a")).toMatchObject({ active: true, editorShown: false, resultShown: true });
    expect(stripOf(found).resultActive).toBe(true);
  });

  it("no painel, sem painel do resultado, e o resultado à vista com a aba ativa", () => {
    rt.workbench.tabs = [tab("a")];
    rt.workbench.activeTabId = "a";
    const found = render();

    expect(found.filter((element) => element.props.role === "tabpanel" || typeof element.props.tabId === "string")).toHaveLength(1);
    expect(panelOf(found, "a")).toMatchObject({ place: "panel", editorShown: true, resultShown: true });
  });
});

describe("o Ctrl+W e o F6 da faixa (RN-ABAS-001, 012 e 014)", () => {
  it("com a aba do resultado ativa, o Ctrl+W volta o resultado ao painel, a da consulta fica ativa e o foco vai ao resultado, sem fechar nada", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" })];
    rt.workbench.activeTabId = "a";
    rt.workbench.resultActive = true;
    keysOf(render())(keyEvent({ key: "w", ctrlKey: true }));

    expect(rt.host.releaseFocusIn).toHaveBeenCalledWith("a");
    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "panel");
    expect(rt.workbench.showEntry).toHaveBeenCalledWith("a", "query");
    expect(rt.focus.request).toHaveBeenCalledWith("a", "result");
    expect(rt.workbench.closeTab).not.toHaveBeenCalled();
    expect(status(render()).props.children).toMatchObject({ props: { children: "Resultado agora no painel." } });
  });

  it("com a da consulta ativa, o Ctrl+W fecha a aba, como antes", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" })];
    rt.workbench.activeTabId = "a";
    keysOf(render())(keyEvent({ key: "w", ctrlKey: true }));

    expect(rt.workbench.closeTab).toHaveBeenCalledWith("a");
    expect(rt.workbench.setResultPlace).not.toHaveBeenCalled();
  });

  it("o F6 na faixa troca a entrada ativa com o resultado numa aba, e leva o foco ao resultado no painel; fora da faixa, nada", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" }), tab("b")];
    rt.workbench.activeTabId = "a";
    const onStrip = { closest: (selector: string) => (selector === '[role="tablist"]' ? {} : null) };
    keysOf(render())(keyEvent({ key: "F6", target: onStrip }));
    expect(rt.workbench.showEntry).toHaveBeenCalledWith("a", "result");
    expect(rt.focus.request).toHaveBeenCalledWith("a", "result");

    rt.workbench.resultActive = true;
    keysOf(render())(keyEvent({ key: "F6", target: onStrip }));
    expect(rt.workbench.showEntry).toHaveBeenLastCalledWith("a", "query");
    expect(rt.focus.request).toHaveBeenLastCalledWith("a", "editor");

    rt.workbench.resultActive = false;
    rt.workbench.activeTabId = "b";
    keysOf(render())(keyEvent({ key: "F6", target: onStrip }));
    expect(rt.host.focusResultIn).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    keysOf(render())(keyEvent({ key: "F6" }));
    expect(rt.host.focusResultIn).not.toHaveBeenCalled();
    expect(rt.workbench.showEntry).not.toHaveBeenCalled();
  });
});

describe("a troca pelo menu e pelo botão (RN-ABAS-014)", () => {
  it("pelo menu da aba, a ativa não muda, e a troca é anunciada; o mesmo lugar não faz nada", () => {
    rt.workbench.tabs = [tab("a")];
    rt.workbench.activeTabId = "a";
    const found = render();

    stripOf(found).onPlace("a" as never, "tab" as never, "menu" as never);
    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "tab");
    expect(rt.workbench.showEntry).not.toHaveBeenCalled();
    expect(status(render()).props.children).toMatchObject({ props: { children: "Resultado agora numa aba." } });

    vi.clearAllMocks();
    stripOf(render()).onPlace("a" as never, "panel" as never, "menu" as never);
    expect(rt.workbench.setResultPlace).not.toHaveBeenCalled();
  });

  it("pelo botão da barra, a aba do resultado fica ativa com o foco no botão", () => {
    rt.workbench.tabs = [tab("a")];
    rt.workbench.activeTabId = "a";
    (panelOf(render(), "a").onPlace as (tabId: string, place: string) => void)("a", "tab");

    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "tab");
    expect(rt.workbench.showEntry).toHaveBeenCalledWith("a", "result");
    expect(rt.focus.request).toHaveBeenCalledWith("a", "placeButton");
  });

  it("os itens do menu da faixa: o lugar de agora marcado; a aba de tabela não tem lugar", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" })];
    rt.workbench.activeTabId = "a";
    expect(stripOf(render()).placeItemsOf("a" as never)).toEqual([
      { place: "panel", label: "No painel", checked: false, disabled: false },
      { place: "tab", label: "Numa aba", checked: true, disabled: false },
    ]);
  });

  it("enquanto a aba vai para outra janela, o painel dela sabe ('Numa janela' fica desabilitado), e depois não", async () => {
    rt.workbench.tabs = [tab("a"), tab("b")];
    rt.workbench.activeTabId = "a";
    (stripOf(render()).onMove as (tabId: string, target: unknown) => void)("a", { kind: "new" });
    await new Promise((done) => setTimeout(done, 0));
    expect(panelOf(render(), "a").moving).toBe(true);

    rt.release();
    await new Promise((done) => setTimeout(done, 0));
    expect(panelOf(render(), "a").moving).toBe(false);
  });
});
