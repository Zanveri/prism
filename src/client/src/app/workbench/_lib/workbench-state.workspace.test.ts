import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedWorkspace } from "../../../../electron/workspace-messages";

// O `WorkbenchProvider` com os ganchos do React simulados (como em `workbench-state.lock.test.ts`): o que se confere aqui é a LIGAÇÃO do provedor com as abas
// que voltam (RN-ABAS-006). A janela principal reabre as abas gravadas, desconectadas, e só então começa a contar as suas; a outra janela conta desde já e não
// reabre nada; a aba que fecha é contada com urgência; e sair do cofre deixa de contar. A ponte, a API e os executores são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  const created: { connectionId: string | null }[] = [];
  const makeRunner = (options: { connectionId: string | null }) => {
    created.push(options);
    return { options, getState: () => ({ status: "idle" }), retire: vi.fn(() => ({ sessionId: null, busy: false })), release: vi.fn(() => ({ sessionId: null, busy: false })) };
  };

  const bridge = { claim: vi.fn(async () => true), report: vi.fn(), withdraw: vi.fn() };
  const api = { workspace: vi.fn(), script: vi.fn() };
  const connections = [{ id: "0199dd00-0000-7000-8000-000000000001" }];
  const scripts = [{ id: "0199dd00-0000-7000-8000-0000000000a1", name: "Relatório", connectionID: null, database: null, folderID: null, icon: null, color: null, updatedAt: "" }];
  const queryClient = { removeQueries: vi.fn(), getQueryData: vi.fn(), fetchQuery: vi.fn(async ({ queryKey }: { queryKey: unknown[] }) => (queryKey[0] === "scripts" ? scripts : connections)) };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

  return { ...createHookRuntime(), created, makeRunner, bridge, api, connections, queryClient, toast };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: rt.connections }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useQueryClient: () => rt.queryClient,
}));
vi.mock("@/components/ui", () => ({ useToast: () => rt.toast }));
vi.mock("@/app/_components/vault-lock", () => ({ VaultLock: () => null }));
vi.mock("@/lib/api/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/bridge")>()),
  claimWorkspaceRestore: rt.bridge.claim,
  reportWorkspace: rt.bridge.report,
  withdrawWorkspace: rt.bridge.withdraw,
  onTabArrived: () => () => {},
  tellWindows: () => {},
}));
vi.mock("./workspace.service", () => ({ getWorkspace: rt.api.workspace }));
vi.mock("./scripts.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("./scripts.service")>()), getScript: rt.api.script }));
vi.mock("./use-query-runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("./use-query-runner")>()), createQueryRunner: (options: { connectionId: string | null }) => rt.makeRunner(options) }));

import { workspaceSync } from "@/lib/api/workspace-sync";

import { WorkbenchProvider, type useWorkbench } from "./workbench-state";
import { workbenchCopy } from "./workbench.copy";

type Value = ReturnType<typeof useWorkbench>;

const c1 = "0199dd00-0000-7000-8000-000000000001";
const gone = "0199dd00-0000-7000-8000-000000000009";
const s1 = "0199dd00-0000-7000-8000-0000000000a1";

const render = (): Value => rt.render(() => WorkbenchProvider({ children: null }) as ReactElement<{ value: Value }>).props.value;

/** As promessas do provedor (a ponte, a API) andam, e a renderização seguinte mostra o que elas mudaram. */
async function settle(): Promise<Value> {
  for (let round = 0; round < 10; round++) await Promise.resolve();
  render();
  return render();
}

const saved: SavedWorkspace = {
  tabs: [
    { kind: "query", connectionID: c1, database: "vendas", sql: "SELECT 'editado'", scriptID: s1, dirty: true, sqlTooLarge: false },
    { kind: "table", connectionID: c1, database: null, schema: "loja", table: "pedidos", view: "data" },
    { kind: "query", connectionID: gone, database: null, sql: "SELECT 'órfã'", scriptID: null, dirty: false, sqlTooLarge: false },
    { kind: "query", connectionID: c1, database: null, sql: "", scriptID: null, dirty: false, sqlTooLarge: true },
    { kind: "table", connectionID: gone, database: null, schema: "loja", table: "clientes", view: "structure" },
  ],
  activeIndex: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  rt.created.length = 0;
  vi.clearAllMocks();
  rt.bridge.claim.mockResolvedValue(true);
  rt.api.workspace.mockResolvedValue({ ok: true, data: saved });
  rt.api.script.mockResolvedValue({ ok: true, data: { id: s1, name: "Relatório", connectionID: null, database: null, folderID: null, icon: null, color: null, sql: "SELECT 'salvo'", updatedAt: "" } });
});

afterEach(() => {
  rt.unmount();
  vi.useRealTimers();
});

describe("WorkbenchProvider: as abas que voltam na próxima entrada (RN-ABAS-006)", () => {
  it("a janela principal reabre as abas gravadas, na ordem, desconectadas, com a ativa, e diz o que não voltou como estava", async () => {
    render();
    const value = await settle();

    expect(value.tabs.map((tab) => [tab.title, tab.connectionId, tab.sessionId, tab.sql])).toEqual([
      ["Relatório", c1, null, "SELECT 'editado'"],
      ["loja.pedidos", c1, null, ""],
      ["consulta-1.sql", null, null, "SELECT 'órfã'"],
      ["consulta-2.sql", c1, null, ""],
    ]);
    // O script da lista não tem conexão: é genérico (RN-SCRIPT-005), e a aba volta lembrando isso.
    expect(value.tabs[0].script).toEqual({ id: s1, name: "Relatório", savedSql: "SELECT 'salvo'", generic: true, dirty: true });
    expect(value.activeTabId).toBe(value.tabs[1].id);
    expect(value.restoredTableConnections).toEqual(new Set([c1]));
    // Cada aba tem o executor dela, e nenhum executou nada (os executores de mentira nem sabem executar).
    expect(rt.created.map((options) => options.connectionId)).toEqual([c1, c1, null, c1]);
    expect(rt.toast.warning).toHaveBeenCalledWith(workbenchCopy.toasts.restoredEmpty("consulta-2.sql"));
    expect(rt.toast.warning).toHaveBeenCalledWith(workbenchCopy.toasts.restoredWithoutConnection(1));
    // A aba de tabela da conexão excluída não volta, e a entrada avisa (RN-ABAS-006).
    expect(rt.toast.warning).toHaveBeenCalledWith(workbenchCopy.toasts.restoredTablesDropped(1));
    // O texto salvo do script só é lido para a aba que tinha mudança não salva.
    expect(rt.api.script).toHaveBeenCalledExactlyOnceWith(s1);
  });

  it("só depois de reabrir a janela principal começa a contar as abas, e conta as que reabriu", async () => {
    let finish: (value: unknown) => void = () => {};
    rt.api.workspace.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render();
    await settle();
    expect(rt.bridge.report).not.toHaveBeenCalled();

    finish({ ok: true, data: saved });
    await settle();

    expect(rt.bridge.report).toHaveBeenCalledTimes(1);
    const [workspace, urgent] = rt.bridge.report.mock.calls[0] as [SavedWorkspace, boolean];
    expect(urgent).toBe(false);
    expect(workspace.tabs.map((tab) => tab.kind)).toEqual(["query", "table", "query", "query"]);
    expect(workspace.activeIndex).toBe(1);
  });

  it("a outra janela não reabre nada e conta as abas dela desde já", async () => {
    rt.bridge.claim.mockResolvedValue(false);
    render();
    await settle();

    expect(rt.api.workspace).not.toHaveBeenCalled();
    expect(rt.bridge.report).toHaveBeenCalledWith({ tabs: [], activeIndex: null }, false);
  });

  it("a leitura que falha não reabre nada e não conta nada: a gravação seguinte apagaria o que não voltou", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    rt.api.workspace.mockResolvedValue({ ok: false, error: { code: "VAULT_LOCKED" } });
    render();
    const value = await settle();
    value.openQueryTab(c1);
    await settle();
    await vi.advanceTimersByTimeAsync(5000);

    expect(rt.bridge.report).not.toHaveBeenCalled();
  });

  it("uma mudança é contada um pouco depois; fechar uma aba é contado na hora, com urgência; e antes de o cofre fechar, também", async () => {
    render();
    let value = await settle();
    rt.bridge.report.mockClear();

    value.openQueryTab(c1, "SELECT 9");
    value = await settle();
    expect(rt.bridge.report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(rt.bridge.report).toHaveBeenCalledTimes(1);

    value.closeTab(value.tabs[0].id);
    await settle();
    expect(rt.bridge.report).toHaveBeenCalledTimes(2);
    expect(rt.bridge.report.mock.calls[1][1]).toBe(true);
    expect((rt.bridge.report.mock.calls[1][0] as SavedWorkspace).tabs).toHaveLength(4);

    void workspaceSync.flush(10);
    expect(rt.bridge.report).toHaveBeenCalledTimes(3);
    expect(rt.bridge.report.mock.calls[2][1]).toBe(true);
  });

  it("a janela que fecha segura as abas dela no que volta; a pergunta cancelada solta", async () => {
    render();
    let value = await settle();

    value.holdForWindowClose();
    value.closeTab(value.tabs[0].id);
    value = await settle();
    expect((rt.bridge.report.mock.calls.at(-1)?.[0] as SavedWorkspace).tabs).toHaveLength(4);

    value.releaseWindowClose();
    expect((rt.bridge.report.mock.calls.at(-1)?.[0] as SavedWorkspace).tabs).toHaveLength(3);
  });

  it("sair do cofre (desmontar) deixa de contar as abas desta janela", async () => {
    render();
    await settle();

    rt.unmount();

    expect(rt.bridge.withdraw).toHaveBeenCalledOnce();
  });
});
