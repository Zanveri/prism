import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { vaultLock } from "@/lib/api/vault-lock";

import type { QueryTab } from "../_lib/workbench-model";

// A janela do resultado na faixa de abas (`WorkbenchTabs`, seção 39: RN-ABAS-013 a 016), com os ganchos do React simulados: o que a troca para "Numa janela"
// pede, o que acontece quando a janela não abre, "Voltar para o painel", a janela fechada pela pessoa e pelo Prism, a volta das abas, o bloqueio e a aba que
// vai para outra janela. A área de trabalho, a faixa, os painéis, a ponte e a janela do resultado (`resultWindows`) são de mentira.
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
  const sendTabAway = vi.fn(() => Promise.resolve({ ok: true }));
  const endTabDrag = vi.fn<(request: unknown) => Promise<{ action: "none" } | { action: "newWindow"; at: { x: number; y: number } | null }>>(async () => ({ action: "none" }));
  const windows = {
    open: vi.fn(async (): Promise<boolean> => true),
    close: vi.fn(async (): Promise<boolean> => true),
    closeAll: vi.fn(async () => {}),
    reconcile: vi.fn(),
    forgetFailure: vi.fn(),
    focus: vi.fn(async () => true),
    setTitle: vi.fn(),
    isOpen: vi.fn((): boolean => false),
    connect: vi.fn(() => () => {}),
    onUserClosed: vi.fn<(listener: (tabId: string) => void) => () => void>(() => () => {}),
    subscribe: () => () => {},
    shown: new Set<string>(),
    shownTabs: () => windows.shown,
  };

  return { ...createHookRuntime(), workbench, toast, focus, host, sendTabAway, endTabDrag, windows };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQuery: () => ({ data: undefined }), useQueryClient: () => ({}) }));
vi.mock("@/components/ui", () => ({ ConfirmDialog: () => null, useToast: () => rt.toast }));
vi.mock("@/lib/api/bridge", () => ({ currentWindowId: () => 1, endTabDrag: rt.endTabDrag, onTabWanted: () => () => {}, onWindowCloseRequested: () => () => {}, sendTabAway: rt.sendTabAway, tellWindows: () => {}, resultWindowsAvailable: () => true, onResultWindowClosed: () => () => {}, onResultWindowState: () => () => {} }));
vi.mock("../_lib/data-export/data-exports", () => ({ exportTracker: { count: () => 0, cancelAll: async () => {} } }));
vi.mock("../_lib/data-import/data-imports", () => ({ loadTracker: { cancelAll: async () => {} }, windowTransfers: () => ({ exports: 0, imports: 0, copies: 0 }) }));
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => true }));
vi.mock("../_lib/result-slots", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/result-slots")>()), resultFocus: rt.focus }));
vi.mock("../_lib/result-windows", () => ({ resultWindows: rt.windows }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ ...noop, disconnectLog: { subscribe: () => () => {}, getSnapshot: () => new Set(), forget: () => {}, mark: () => {} }, ...rt.workbench }) }));
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

const stripOf = (found: Found[]) => found.find((element) => element.type === TabStrip)!.props as Record<string, (...args: never[]) => unknown>;
const panelOf = (found: Found[], id: string) => found.find((element) => element.type === QueryTabPanel && (element.props.tab as QueryTab).id === id)!.props as Record<string, (...args: never[]) => unknown> & Record<string, unknown>;
const status = (found: Found[]) => found.find((element) => element.props.role === "status")!;
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  vi.clearAllMocks();
  rt.workbench.resultActive = false;
  rt.workbench.tabs = [];
  rt.workbench.activeTabId = null;
  rt.windows.shown = new Set();
  rt.windows.isOpen.mockReturnValue(false);
  rt.windows.open.mockResolvedValue(true);
  rt.windows.close.mockResolvedValue(true);
  vaultLock.reset();
  // RN-ABAS-019: a área das abas ouve o foco da página e as teclas da janela; o vitest não tem página, e a de mentira basta.
  const page = createFakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
});

afterEach(() => {
  rt.unmount();
  vaultLock.reset();
  vi.unstubAllGlobals();
});

describe("trocar para 'Numa janela' (RN-ABAS-013, 014 e 017)", () => {
  it("a aba do resultado solta fora da faixa abre o resultado na janela dele, no ponto da soltura, e não leva a aba para outra janela (RN-ABAS-010)", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" }), tab("b")];
    rt.workbench.activeTabId = "a";
    rt.endTabDrag.mockResolvedValueOnce({ action: "newWindow", at: { x: 420, y: 330 } });
    const strip = stripOf(render()) as unknown as { drag: { begin: (tabId: string, kind: "result") => void; mark: (where: "veil") => void }; onDragEnd: (tabId: string, event: unknown) => void };

    strip.drag.begin("a", "result");
    strip.drag.mark("veil");
    strip.onDragEnd("a", { effect: "move", screen: { x: 400, y: 300 }, client: { x: 300, y: 260 }, viewport: { width: 1200, height: 800 } });
    await settle();

    expect(rt.endTabDrag).toHaveBeenCalledExactlyOnceWith({ tabId: "a", kind: "result", dropped: "veil", effect: "move", at: { x: 400, y: 300 }, inPage: true });
    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "window");
    expect(rt.windows.open).toHaveBeenCalledWith("a", { mode: "focus", at: { x: 420, y: 330 }, title: "a.sql" });
    expect(rt.sendTabAway).not.toHaveBeenCalled();
  });

  it("a aba do resultado solta sem que o processo principal ache o que fazer (o Esc, outra janela): o resultado fica onde está", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" })];
    rt.workbench.activeTabId = "a";
    const strip = stripOf(render()) as unknown as { drag: { begin: (tabId: string, kind: "result") => void }; onDragEnd: (tabId: string, event: unknown) => void };

    strip.drag.begin("a", "result");
    strip.onDragEnd("a", { effect: "none", screen: { x: 400, y: 300 }, client: { x: 300, y: 260 }, viewport: { width: 1200, height: 800 } });
    await settle();

    expect(rt.endTabDrag).toHaveBeenCalledOnce();
    expect(rt.workbench.setResultPlace).not.toHaveBeenCalled();
    expect(rt.windows.open).not.toHaveBeenCalled();
  });

  it("pelo botão da barra: o lugar vale na hora, a janela é pedida a pedido da pessoa (com o foco), o foco vai ao botão dela e a troca é anunciada", async () => {
    rt.workbench.tabs = [tab("a")];
    rt.workbench.activeTabId = "a";

    (panelOf(render(), "a").onPlace as (tabId: string, place: string) => void)("a", "window");
    await settle();

    expect(rt.host.releaseFocusIn).toHaveBeenCalledWith("a");
    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "window");
    expect(rt.windows.open).toHaveBeenCalledWith("a", { mode: "focus", title: "a.sql" });
    expect(rt.workbench.showEntry).toHaveBeenCalledWith("a", "query");
    expect(rt.focus.request).toHaveBeenCalledWith("a", "placeButton");
    expect(status(render()).props.children).toMatchObject({ props: { children: "Resultado agora numa janela." } });
    expect(rt.toast.warning).not.toHaveBeenCalled();
  });

  it("o título da janela é o curto da aba (RN-ABAS-008): duas abas com o mesmo nome levam o lugar", async () => {
    rt.workbench.tabs = [tab("a", { title: "consulta.sql", connectionId: "c1" })];
    rt.workbench.activeTabId = "a";

    (panelOf(render(), "a").onPlace as (tabId: string, place: string) => void)("a", "window");
    await settle();

    expect(rt.windows.open).toHaveBeenCalledWith("a", expect.objectContaining({ title: expect.stringContaining("consulta.sql") }));
  });

  it("pelo menu da aba: a aba ativa não muda, e a janela abre", async () => {
    rt.workbench.tabs = [tab("a"), tab("b")];
    rt.workbench.activeTabId = "b";

    stripOf(render()).onPlace("a" as never, "window" as never, "menu" as never);
    await settle();

    expect(rt.windows.open).toHaveBeenCalledWith("a", expect.objectContaining({ mode: "focus" }));
    expect(rt.workbench.showEntry).not.toHaveBeenCalled();
  });

  it("a janela que não abre: o resultado volta para onde estava, com o aviso", async () => {
    rt.windows.open.mockResolvedValue(false);
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" })];
    rt.workbench.activeTabId = "a";

    (panelOf(render(), "a").onPlace as (tabId: string, place: string) => void)("a", "window");
    await settle();

    expect(rt.workbench.setResultPlace).toHaveBeenNthCalledWith(1, "a", "window");
    expect(rt.workbench.setResultPlace).toHaveBeenNthCalledWith(2, "a", "tab");
    expect(rt.toast.warning).toHaveBeenCalledWith("Não foi possível abrir a janela do resultado.");
  });

  it("o item 'Numa janela' aparece no menu da faixa, e desabilitado enquanto a aba vai para outra janela", async () => {
    rt.workbench.tabs = [tab("a")];
    rt.workbench.activeTabId = "a";

    expect(stripOf(render()).placeItemsOf("a" as never)).toEqual([
      { place: "panel", label: "No painel", checked: true, disabled: false },
      { place: "tab", label: "Numa aba", checked: false, disabled: false },
      { place: "window", label: "Numa janela", checked: false, disabled: false },
    ]);

    // A ida não termina (a outra janela ainda não respondeu): a aba está indo.
    rt.sendTabAway.mockImplementationOnce(() => new Promise(() => {}));
    (stripOf(render()).onMove as (tabId: string, target: unknown) => void)("a", { kind: "new" });
    await settle();
    expect((stripOf(render()).placeItemsOf("a" as never) as { disabled: boolean }[])[2].disabled).toBe(true);
  });
});

describe("voltar para o painel e a janela fechada (RN-ABAS-013)", () => {
  it("'Voltar para o painel': o lugar volta, a aba da consulta fica ativa com o foco no resultado, a janela fecha pelo Prism e a janela da aba vem à frente", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";

    (panelOf(render(), "a").onBackToPanel as (tabId: string) => void)("a");
    await settle();

    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "panel");
    expect(rt.workbench.showEntry).toHaveBeenCalledWith("a", "query");
    expect(rt.focus.request).toHaveBeenCalledWith("a", "result");
    expect(rt.windows.close).toHaveBeenCalledWith("a");
    expect(rt.windows.focus).toHaveBeenCalledWith("a", "opener");
    expect(status(render()).props.children).toMatchObject({ props: { children: "Resultado agora no painel." } });
  });

  it("a pessoa que fecha a janela pelo sistema volta o resultado ao painel, sem fechar de novo, sem trazer a janela da aba e sem mexer no foco", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";
    render();
    const userClosed = rt.windows.onUserClosed.mock.calls[0][0];

    userClosed("a");
    await settle();

    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "panel");
    expect(rt.windows.close).not.toHaveBeenCalled();
    expect(rt.windows.focus).not.toHaveBeenCalled();
    expect(rt.workbench.showEntry).not.toHaveBeenCalled();
    expect(rt.focus.request).not.toHaveBeenCalled();
  });

  it("pelo botão de lugar da janela do resultado ('No painel' ou 'Numa aba'): a janela fecha pelo Prism e a janela da aba vem à frente", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";

    (panelOf(render(), "a").onPlace as (tabId: string, place: string) => void)("a", "panel");
    await settle();

    expect(rt.windows.close).toHaveBeenCalledWith("a");
    expect(rt.windows.focus).toHaveBeenCalledWith("a", "opener");

    rt.windows.focus.mockClear();
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    (panelOf(render(), "a").onPlace as (tabId: string, place: string) => void)("a", "tab");
    await settle();

    expect(rt.windows.focus).toHaveBeenCalledWith("a", "opener");
  });

  it("trocar a janela por uma aba fecha a janela pelo Prism e fica na janela da aba", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";

    stripOf(render()).onPlace("a" as never, "tab" as never, "menu" as never);
    await settle();

    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "tab");
    expect(rt.windows.close).toHaveBeenCalledWith("a");
    expect(rt.windows.focus).not.toHaveBeenCalled();
  });

  it("o resultado de uma aba com a janela aberta e não minimizada está à vista, qualquer que seja a aba ativa; minimizada, não", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" }), tab("b")];
    rt.workbench.activeTabId = "b";

    expect(panelOf(render(), "a")).toMatchObject({ place: "window", editorShown: false, resultShown: false });

    rt.windows.shown = new Set(["a"]);
    expect(panelOf(render(), "a")).toMatchObject({ editorShown: false, resultShown: true });
  });
});

describe("o F6 com o resultado numa janela (RN-ABAS-014)", () => {
  it("do resultado, a janela da aba vem à frente com a consulta ativa e o foco no editor", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" }), tab("b")];
    rt.workbench.activeTabId = "b";

    (panelOf(render(), "a").onFocusWindow as (tabId: string, target: string) => void)("a", "opener");

    expect(rt.workbench.showEntry).toHaveBeenCalledWith("a", "query");
    expect(rt.focus.request).toHaveBeenCalledWith("a", "editor");
    expect(rt.windows.focus).toHaveBeenCalledWith("a", "opener");
  });

  it("com a consulta já à frente, o pedido de foco do editor não fica esperando um desenho que não vem", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";

    (panelOf(render(), "a").onFocusWindow as (tabId: string, target: string) => void)("a", "opener");

    expect(rt.focus.request).not.toHaveBeenCalled();
    expect(rt.windows.focus).toHaveBeenCalledWith("a", "opener");
  });

  it("do editor, a janela do resultado vem à frente; um link usado na janela traz a da aba sem mexer na aba ativa nem no foco", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";

    (panelOf(render(), "a").onFocusWindow as (tabId: string, target: string) => void)("a", "result");
    expect(rt.windows.focus).toHaveBeenLastCalledWith("a", "result");

    (panelOf(render(), "a").onFocusWindow as (tabId: string, target: string) => void)("a", "link");
    expect(rt.windows.focus).toHaveBeenLastCalledWith("a", "opener");
    expect(rt.workbench.showEntry).not.toHaveBeenCalled();
    expect(rt.focus.request).not.toHaveBeenCalled();
  });
});

describe("a volta das abas, o bloqueio e a área de trabalho (RN-ABAS-016)", () => {
  it("as abas que pedem a janela vão em ordem, a da aba ativa por último; as que voltam ao painel e as de tabela não pedem", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" }), tab("b", { resultPlace: "window" }), tab("c"), tab("d", { resultPlace: "tab" })];
    rt.workbench.activeTabId = "a";

    render();

    expect(rt.windows.reconcile).toHaveBeenCalledTimes(1);
    const [wanted] = rt.windows.reconcile.mock.calls[0] as unknown as [{ tabId: string; title: string }[]];
    expect(wanted.map((item) => item.tabId)).toEqual(["b", "a"]);
    expect(wanted[0].title).toBe("b.sql");
  });

  it("a janela que não abriu na volta fica no painel, com o aviso", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";
    render();
    const onFailed = (rt.windows.reconcile.mock.calls[0] as unknown as [unknown, (tabId: string) => void])[1];

    onFailed("a");

    expect(rt.toast.warning).toHaveBeenCalledWith("Não foi possível abrir a janela do resultado.");
    expect(rt.workbench.setResultPlace).toHaveBeenCalledWith("a", "panel");
  });

  it("o bloqueio fecha as janelas (nada do que estava aberto fica à vista) e não pede nenhuma; o desbloqueio pede de novo", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";
    render();
    expect(rt.windows.reconcile).toHaveBeenCalledTimes(1);

    vaultLock.lock();
    render();
    expect(rt.windows.closeAll).toHaveBeenCalledTimes(1);
    expect(rt.windows.reconcile).toHaveBeenCalledTimes(1);

    vaultLock.unlock();
    render();
    expect(rt.windows.reconcile).toHaveBeenCalledTimes(2);
  });

  it("a aba que vai para outra janela não é pedida de novo enquanto a janela dela fecha", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";
    rt.windows.isOpen.mockReturnValue(true);
    let closing: () => void = () => {};
    rt.windows.close.mockImplementation(() => new Promise<boolean>((resolve) => (closing = () => resolve(true))));
    render();

    (stripOf(render()).onMove as (tabId: string, target: unknown) => void)("a", { kind: "new" });
    await settle();
    render();

    const lastWanted = (rt.windows.reconcile.mock.calls.at(-1) as unknown as [{ tabId: string }[]])[0];
    expect(lastWanted).toEqual([]);
    closing();
    await settle();
  });

  it("liga o que o processo principal conta das janelas ao montar", () => {
    rt.workbench.tabs = [tab("a")];
    rt.workbench.activeTabId = "a";
    render();

    expect(rt.windows.connect).toHaveBeenCalledTimes(1);
    expect(rt.windows.onUserClosed).toHaveBeenCalledTimes(1);
  });

  it("o título da janela acompanha o da aba", () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window", title: "pallets" })];
    rt.workbench.activeTabId = "a";

    render();

    expect(rt.windows.setTitle).toHaveBeenCalledWith("a", "pallets");
  });
});

describe("levar a aba para outra janela com o resultado numa janela (RN-ABAS-016)", () => {
  const sent = () => (rt.sendTabAway.mock.calls[0] as unknown as [{ transfer: { tab: { resultPlace?: string }; resultWindowLost?: boolean } }])[0].transfer;

  it("a janela do resultado fecha primeiro, e a aba vai com o lugar", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";
    rt.windows.isOpen.mockReturnValue(true);

    (stripOf(render()).onMove as (tabId: string, target: unknown) => void)("a", { kind: "new" });
    await settle();

    expect(rt.windows.close).toHaveBeenCalledWith("a");
    expect(rt.windows.close.mock.invocationCallOrder[0]).toBeLessThan(rt.sendTabAway.mock.invocationCallOrder[0]);
    expect(sent().tab.resultPlace).toBe("window");
    expect(sent().resultWindowLost).toBeUndefined();
  });

  it("sem a confirmação do fechamento, a aba vai assim mesmo com o resultado no painel, e a janela que a recebe avisa", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "window" })];
    rt.workbench.activeTabId = "a";
    rt.windows.isOpen.mockReturnValue(true);
    rt.windows.close.mockResolvedValue(false);

    (stripOf(render()).onMove as (tabId: string, target: unknown) => void)("a", { kind: "new" });
    await settle();

    expect(sent().tab.resultPlace).toBe("panel");
    expect(sent().resultWindowLost).toBe(true);
  });

  it("a aba que não tem janela do resultado vai como estava, sem esperar nada", async () => {
    rt.workbench.tabs = [tab("a", { resultPlace: "tab" })];
    rt.workbench.activeTabId = "a";

    (stripOf(render()).onMove as (tabId: string, target: unknown) => void)("a", { kind: "new" });
    await settle();

    expect(rt.windows.close).not.toHaveBeenCalled();
    expect(sent().tab.resultPlace).toBe("tab");
  });
});
