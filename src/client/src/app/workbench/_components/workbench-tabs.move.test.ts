import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RowsState, RunnerState } from "../_lib/use-query-runner";
import type { QueryTab } from "../_lib/workbench-model";

// A aba que vai para outra janela (RN-ABAS-002 e 003) a partir da faixa (`WorkbenchTabs`), com os ganchos do React simulados: a ida espera a execução
// automática em andamento terminar (`handOffTab`, RN-GRADE-014), e o que se confere é o que acontece com as abas que mudaram nesse meio-tempo. A área de
// trabalho (`useWorkbench`), os executores, a ponte e os painéis são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  /** O executor de uma aba, com a execução automática em andamento até a prova soltar (`finish`). */
  type FakeRunner = { state: unknown; getState: () => unknown; autoRunSettled: () => Promise<void>; autoRefresh: { pause: ReturnType<typeof vi.fn> }; sessionOf: () => string | null; finish: () => void };
  function makeRunner(state: unknown): FakeRunner {
    let finish = () => {};
    const settled = new Promise<void>((resolve) => (finish = resolve));
    const runner: FakeRunner = { state, getState: () => runner.state, autoRunSettled: () => settled, autoRefresh: { pause: vi.fn() }, sessionOf: () => "s-1", finish: () => finish() };
    return runner;
  }

  const runners = new Map<string, FakeRunner>();
  const workbench = {
    tabs: [] as unknown[],
    activeTabId: null as string | null,
    runnerOf: (tabId: string) => {
      const runner = runners.get(tabId);
      if (runner === undefined) throw new Error(`A aba ${tabId} não existe.`);
      return runner;
    },
    detachTab: vi.fn(),
  };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const sendTabAway = vi.fn<(request: unknown) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: true }));

  return { ...createHookRuntime(), makeRunner, runners, workbench, toast, sendTabAway };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQuery: () => ({ data: undefined }), useQueryClient: () => ({}) }));
vi.mock("@/components/ui", () => ({ ConfirmDialog: () => null, useToast: () => rt.toast }));
vi.mock("@/lib/api/bridge", () => ({ currentWindowId: () => 1, onTabWanted: () => () => {}, onWindowCloseRequested: () => () => {}, sendTabAway: rt.sendTabAway, tellWindows: () => {} }));
// RN-EXPORT-023: a janela sem exportação em andamento (a pergunta delas não entra nesta prova).
vi.mock("../_lib/data-export/data-exports", () => ({ exportTracker: { count: () => 0, cancelAll: async () => {} } }));
vi.mock("../_lib/data-import/data-imports", () => ({ loadTracker: { cancelAll: async () => {} }, windowTransfers: () => ({ exports: 0, imports: 0, copies: 0 }) }));
vi.mock("../_lib/connection-intent", () => ({ createDisconnectLog: () => ({ subscribe: () => () => {}, getSnapshot: () => new Set(), forget: () => {}, mark: () => {} }) }));
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => true }));
vi.mock("../_lib/workbench-state", () => ({ useWorkbench: () => ({ ...noop, restoredTableConnections: new Set(), ...rt.workbench }) }));
vi.mock("./use-script-saving", () => ({ useScriptSaving: () => ({ save: async () => true, dialog: null }) }));
vi.mock("./query-tab", () => ({ QueryTabPanel: () => null }));
vi.mock("./table-tab/table-tab", () => ({ TableTabPanel: () => null }));
vi.mock("./script-dialogs", () => ({ UnsavedScriptsDialog: () => null }));
vi.mock("./unsaved-edits-dialog", () => ({ UnsavedEditsDialog: () => null }));
vi.mock("./tab-strip", () => ({ TabStrip: () => null, panelElementId: (id: string) => `painel-${id}`, tabElementId: (id: string) => `aba-${id}` }));

import { elementsOf } from "@/lib/testing/react-tree";

import { TabStrip } from "./tab-strip";
import { WorkbenchTabs } from "./workbench-tabs";

/** O que a faixa recebe da área de trabalho e esta prova não usa. */
const noop = Object.fromEntries(
  ["setActiveTab", "closeTab", "updateTab", "setTableView", "openTableTab", "reorderTab", "shiftTab", "releaseWindow", "markScriptEdited", "switchConnection", "switchDatabase", "holdForWindowClose", "releaseWindowClose"].map((name) => [name, vi.fn()]),
);

const rows: RowsState = { status: "rows", id: 1, target: { sql: "select * from fila", offset: 0 }, columns: [], rows: [], truncated: new Map(), hasMore: false, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false };
const autoRunning: RunnerState = { status: "running", cancelling: false, previous: rows, auto: true };

const tab = (id: string, over: Partial<QueryTab> = {}): QueryTab => ({ id, title: `${id}.sql`, connectionId: "c1", sessionId: null, sql: "select * from fila", ...over });

/** Renderiza a faixa com a área de trabalho de agora e devolve o `onMove` do `TabStrip` (o menu "Mover para nova janela" e o arrastar). */
function render(): (tabId: string, target: unknown) => void {
  const tree = rt.render(() => WorkbenchTabs() as ReactElement);
  const strip = elementsOf(tree).find((element) => element.type === TabStrip);
  if (strip === undefined) throw new Error("A faixa não está na árvore.");
  return strip.props.onMove as (tabId: string, target: unknown) => void;
}

/** Deixa as promessas em andamento chegarem ao fim. */
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  rt.runners.clear();
  vi.clearAllMocks();
});

afterEach(() => rt.unmount());

describe("WorkbenchTabs: a aba que vai para outra janela enquanto a execução automática termina (RN-ABAS-002 e 003, RN-GRADE-014)", () => {
  it("abrir uma aba e fechar outra durante a espera: vai a aba como está agora, e quem a solta é a área de trabalho", async () => {
    const moving = rt.makeRunner(autoRunning);
    rt.runners.set("a", moving);
    rt.runners.set("b", rt.makeRunner(rows));
    rt.workbench.tabs = [tab("a"), tab("b")];
    rt.workbench.activeTabId = "a";
    const move = render();

    move("a", { kind: "new" });
    await settle();
    expect(rt.sendTabAway).not.toHaveBeenCalled();

    // Durante a espera: a aba virou um script salvo (outro título), uma aba nova abriu e a outra fechou.
    rt.runners.delete("b");
    rt.runners.set("c", rt.makeRunner(rows));
    rt.workbench.tabs = [tab("a", { title: "Fechamento" }), tab("c")];
    render();

    moving.state = { ...rows, id: 2 };
    moving.finish();
    await settle();

    expect(rt.sendTabAway).toHaveBeenCalledOnce();
    const [request] = rt.sendTabAway.mock.calls[0] as [{ target: unknown; transfer: { tab: QueryTab; result: { id: number } } }];
    expect(request.target).toEqual({ kind: "new" });
    expect(request.transfer.tab).toMatchObject({ id: "a", title: "Fechamento" });
    expect(request.transfer.result.id).toBe(2);
    expect(rt.workbench.detachTab).toHaveBeenCalledExactlyOnceWith("a");
    expect(rt.toast.warning).not.toHaveBeenCalled();
    expect(moving.autoRefresh.pause.mock.calls).toEqual([
      ["moving", true],
      ["moving", false],
    ]);
  });

  it("a aba que fechou durante a espera não vai, e nada é dito", async () => {
    const moving = rt.makeRunner(autoRunning);
    rt.runners.set("a", moving);
    rt.workbench.tabs = [tab("a"), tab("b")];
    rt.runners.set("b", rt.makeRunner(rows));
    const move = render();

    move("a", { kind: "new" });
    await settle();
    rt.workbench.tabs = [tab("b")];
    render();

    moving.state = rows;
    moving.finish();
    await settle();

    expect(rt.sendTabAway).not.toHaveBeenCalled();
    expect(rt.workbench.detachTab).not.toHaveBeenCalled();
    expect(rt.toast.warning).not.toHaveBeenCalled();
    expect(rt.toast.error).not.toHaveBeenCalled();
  });
});
