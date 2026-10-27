import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFakePage, type FakeElement } from "@/lib/testing/fake-page";

import type { QueryTab } from "../_lib/workbench-model";

// O foco ao abrir, fechar e trocar de aba (RN-ABAS-019) na área das abas (`WorkbenchTabs`), com os ganchos do React simulados e uma página de mentira
// (`createFakePage`): um lugar só decide QUANDO focar, num efeito depois de a aba aparecer, e cada aba diz COMO (`tabEntries`). A área de trabalho
// (`useWorkbench`), a faixa, os painéis e a ponte são de mentira, como em `workbench-tabs.result-place.test.ts`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  const runner = { values: { snapshot: () => ({ values: new Map(), counter: 0 }) }, getState: () => ({ status: "idle" }), autoRunSettled: () => Promise.resolve(), autoRefresh: { pause: vi.fn() }, sessionOf: () => null };
  const workbench = {
    tabs: [] as unknown[],
    activeTabId: null as string | null,
    resultActive: false,
    runnerOf: () => runner,
    closeTab: vi.fn(),
    setActiveTab: vi.fn(),
    showEntry: vi.fn(),
    setResultPlace: vi.fn(),
  };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  /** A área de trabalho é a tela mostrada (a rota); a escondida por baixo de Configurações não decide o foco. */
  const screen = { on: true };

  return { ...createHookRuntime(), workbench, toast, screen };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQuery: () => ({ data: undefined }), useQueryClient: () => ({}) }));
vi.mock("@/components/ui", () => ({ ConfirmDialog: () => null, useToast: () => rt.toast }));
vi.mock("@/lib/api/bridge", () => ({ currentWindowId: () => 1, onTabWanted: () => () => {}, onWindowCloseRequested: () => () => {}, sendTabAway: vi.fn(), tellWindows: () => {}, resultWindowsAvailable: () => false, onResultWindowClosed: () => () => {}, onResultWindowState: () => () => {} }));
vi.mock("../_lib/data-export/data-exports", () => ({ exportTracker: { count: () => 0, cancelAll: async () => {} } }));
vi.mock("../_lib/data-import/data-imports", () => ({ loadTracker: { cancelAll: async () => {} }, windowTransfers: () => ({ exports: 0, imports: 0, copies: 0 }) }));
vi.mock("../_lib/connection-intent", () => ({ createDisconnectLog: () => ({ subscribe: () => () => {}, getSnapshot: () => new Set(), forget: () => {}, mark: () => {} }) }));
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => rt.screen.on }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ ...noop, restoredTableConnections: new Set(), ...rt.workbench }) }));
vi.mock("./result-host", () => ({ releaseFocusIn: vi.fn(), focusResultIn: vi.fn(), resultHostOf: vi.fn(() => null) }));
vi.mock("./use-script-saving", () => ({ useScriptSaving: () => ({ save: async () => true, dialog: null }) }));
vi.mock("./query-tab", () => ({ QueryTabPanel: () => null }));
vi.mock("./table-tab/table-tab", () => ({ TableTabPanel: () => null }));
vi.mock("./script-dialogs", () => ({ UnsavedScriptsDialog: () => null }));
vi.mock("./unsaved-edits-dialog", () => ({ UnsavedEditsDialog: () => null }));
vi.mock("./tab-strip", () => ({ TabStrip: () => null, panelElementId: (id: string) => `painel-${id}`, tabElementId: (id: string) => `aba-${id}` }));

import { vaultLock } from "@/lib/api/vault-lock";

import { resultFocus } from "../_lib/result-slots";
import { tabEntries, tabFocus } from "../_lib/tab-focus";
import { WorkbenchTabs } from "./workbench-tabs";

const noop = Object.fromEntries(["updateTab", "setTableView", "openTableTab", "reorderTab", "shiftTab", "releaseWindow", "markScriptEdited", "switchConnection", "switchDatabase", "holdForWindowClose", "releaseWindowClose"].map((name) => [name, vi.fn()]));

const tab = (id: string, over: Partial<QueryTab> = {}): QueryTab => ({ id, title: `${id}.sql`, connectionId: "c1", sessionId: null, sql: "", ...over });

let page: ReturnType<typeof createFakePage>;
const entries: (() => void)[] = [];

/** A aba `id` registra a entrada dela, como o painel faz, e a prova espia o foco que ela recebe. */
function entryOf(id: string, focus = vi.fn(() => true)) {
  entries.push(tabEntries.register(id, focus));
  return focus;
}

/** O desenho de agora: a área das abas decide o foco no efeito que roda depois dele. */
function render() {
  return rt.render(() => WorkbenchTabs() as ReactElement);
}

/** Estado da área de trabalho: as abas dadas, com a ativa dada. */
function show(ids: string[], active: string | null) {
  rt.workbench.tabs = ids.map((id) => tab(id));
  rt.workbench.activeTabId = active;
}

beforeEach(() => {
  vi.clearAllMocks();
  page = createFakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
  rt.workbench.resultActive = false;
  rt.screen.on = true;
  tabFocus.forgetExcept(new Set());
  resultFocus.forgetExcept(new Set());
});

afterEach(() => {
  rt.unmount();
  for (const unregister of entries.splice(0)) unregister();
  tabFocus.forgetExcept(new Set());
  resultFocus.forgetExcept(new Set());
  vaultLock.reset();
  vi.unstubAllGlobals();
});

describe("abrir uma aba por um gesto: o foco vai à entrada dela (RN-ABAS-019)", () => {
  let row: FakeElement;
  beforeEach(() => {
    row = page.element({ id: "linha-da-arvore" });
    page.focus(row);
  });

  it("com o foco ainda em quem pediu (o botão da linha do navegador), vai à entrada da aba que ficou ativa", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");

    tabFocus.request("a", row);
    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("o pedido é atendido uma vez só, e os desenhos seguintes (a lista de abas que muda a cada tecla) não puxam o foco de volta", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);

    render();
    rt.workbench.tabs = [tab("a", { sql: "select 1" })];
    render();
    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("se o foco saiu de quem pediu para outro lugar vivo (o type-ahead andou na árvore, a pessoa clicou num campo), fica onde está, e o pedido é consumido", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);
    page.focus(page.element({ id: "outra-linha" }));

    render();
    expect(focus).not.toHaveBeenCalled();

    // O pedido já foi consumido: o foco perdido depois não o traz de volta.
    page.focus(null);
    render();
    expect(focus).not.toHaveBeenCalled();
  });

  it("com o foco perdido (o menu e o diálogo que abriram a aba fecharam), vai à entrada", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);
    row.remove();

    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("o gesto que vem de um menu (o foco estava num item dele): o menu fecha e devolve o foco à linha da árvore, e a aba o recebe mesmo assim (RN-MENU-001)", () => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    const item = page.element({ id: "item-do-menu", inside: ['[role="menu"]'] });
    page.focus(item);
    tabFocus.request("a", item);
    item.remove();
    page.focus(row);

    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("a aba que já era a ativa (abrir a mesma tabela de novo): nada mais mudou além do pedido, e a versão dele refaz o efeito", () => {
    show(["a", "b"], "a");
    render();
    const focus = entryOf("a");

    tabFocus.request("a", row);
    render();

    expect(focus).toHaveBeenCalledOnce();
  });

  it("o pedido de uma aba que ainda não é a ativa espera: a loja avisou antes de a lista de abas chegar (o script que vem da API), e a entrada é a da aba nova", () => {
    show(["a"], "a");
    render();
    const old = entryOf("a");
    const created = entryOf("b");

    tabFocus.request("b", row);
    render();
    expect(old).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();

    show(["a", "b"], "b");
    render();

    expect(old).not.toHaveBeenCalled();
    expect(created).toHaveBeenCalledOnce();
  });

  it.each([
    ["um diálogo, um menu ou uma lista aberta", () => page.setPopup(true)],
    ["o cofre bloqueado", () => vaultLock.lock()],
    ["outra tela à mostra (Configurações)", () => void (rt.screen.on = false)],
    ["o foco prometido por outra regra (o F6, a troca do lugar do resultado)", () => resultFocus.request("a", "result")],
  ])("com %s, o foco não é de ninguém aqui: nada, e o pedido é consumido", (_name, block) => {
    show(["a"], "a");
    render();
    const focus = entryOf("a");
    tabFocus.request("a", row);
    block();

    render();

    expect(focus).not.toHaveBeenCalled();
    expect(tabFocus.take("a")).toBeNull();
  });

  it("sem aba ativa (a janela sem abas) o pedido espera, sem erro", () => {
    show([], null);
    render();

    tabFocus.request("a", row);

    expect(() => render()).not.toThrow();
    expect(tabFocus.take("a")).not.toBeNull();
  });

  it("a aba que saiu leva o pedido dela: o provedor pediu e a aba fechou antes de aparecer", () => {
    show(["a"], "a");
    render();
    tabFocus.request("zumbi", row);

    show(["a", "b"], "a");
    render();

    expect(tabFocus.take("zumbi")).toBeNull();
  });
});
