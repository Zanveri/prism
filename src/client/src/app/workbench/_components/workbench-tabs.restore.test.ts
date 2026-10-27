import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newVerification, unprotected, type Connection } from "@/app/connections/_lib/connections.schema";

import type { SavedWorkspace } from "../../../../electron/workspace-messages";
import type { TableTab } from "../_lib/workbench-model";

// As abas de tabela que voltam na entrada voltam desconectadas, e nada conecta nem executa sozinho (RN-ABAS-006): o provedor da área de trabalho
// (`WorkbenchProvider`, que reabre as abas) e a área das abas (`WorkbenchTabs`) de verdade, juntos, com os ganchos do React simulados. A primeira carga dos
// Registros é um efeito do painel da aba, que lê o `disconnected` da renderização em que a aba APARECE, e roda antes de qualquer efeito do pai: então a PRIMEIRA
// renderização das abas que voltaram já tem de entregar `disconnected` aos painéis. Marcadas por um efeito da área das abas (como era), só as abas escondidas
// esperavam o clique, e a ativa abria a sessão sozinha. A ponte, a API, os executores, a faixa e os painéis são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  const makeRunner = (options: { connectionId: string | null }) => ({
    options,
    getState: () => ({ status: "idle" }),
    retire: vi.fn(() => ({ sessionId: null, busy: false })),
    release: vi.fn(() => ({ sessionId: null, busy: false })),
    values: { snapshot: () => ({ values: new Map(), counter: 0 }) },
    autoRunSettled: () => Promise.resolve(),
    autoRefresh: { pause: vi.fn() },
    sessionOf: () => null,
  });

  const bridge = { claim: vi.fn(async () => true), report: vi.fn(), withdraw: vi.fn() };
  const api = { workspace: vi.fn() };
  /** As listas que as consultas entregam, pela chave: `connections`, `folders` e `scripts`. */
  const lists = new Map<string, unknown>();
  const queryClient = { removeQueries: vi.fn(), getQueryData: vi.fn(), fetchQuery: vi.fn(async ({ queryKey }: { queryKey: unknown[] }) => lists.get(String(queryKey[0]))) };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  /** O que `useWorkbench` entrega à área das abas: o valor que o provedor produziu na renderização de agora. */
  const provided = { value: undefined as unknown };

  return { ...createHookRuntime(), makeRunner, bridge, api, lists, queryClient, toast, provided };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: readonly unknown[] }) => ({ data: rt.lists.get(String(options.queryKey[0])) }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useQueryClient: () => rt.queryClient,
}));
vi.mock("@/components/ui", () => ({ ConfirmDialog: () => null, useToast: () => rt.toast }));
vi.mock("@/app/_components/vault-lock", () => ({ VaultLock: () => null }));
vi.mock("@/lib/api/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/bridge")>()),
  claimWorkspaceRestore: rt.bridge.claim,
  reportWorkspace: rt.bridge.report,
  withdrawWorkspace: rt.bridge.withdraw,
  onTabArrived: () => () => {},
  tellWindows: () => {},
  currentWindowId: () => 1,
  onTabWanted: () => () => {},
  onWindowCloseRequested: () => () => {},
  sendTabAway: vi.fn(),
  resultWindowsAvailable: () => false,
  onResultWindowClosed: () => () => {},
  onResultWindowState: () => () => {},
}));
vi.mock("../_lib/workspace.service", () => ({ getWorkspace: rt.api.workspace }));
vi.mock("../_lib/use-query-runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/use-query-runner")>()), createQueryRunner: (options: { connectionId: string | null }) => rt.makeRunner(options) }));
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => true }));
vi.mock("../_lib/workbench-state", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/workbench-state")>()), useWorkbench: () => rt.provided.value }));
vi.mock("./result-host", () => ({ releaseFocusIn: vi.fn(), focusResultIn: vi.fn(), resultHostOf: vi.fn(() => null) }));
vi.mock("./use-script-saving", () => ({ useScriptSaving: () => ({ save: async () => true, dialog: null }) }));
vi.mock("./query-tab", () => ({ QueryTabPanel: () => null }));
vi.mock("./table-tab/table-tab", () => ({ TableTabPanel: () => null }));
vi.mock("./script-dialogs", () => ({ UnsavedScriptsDialog: () => null }));
vi.mock("./unsaved-edits-dialog", () => ({ UnsavedEditsDialog: () => null }));
vi.mock("./tab-strip", () => ({ TabStrip: () => null, panelElementId: (id: string) => `painel-${id}`, tabElementId: (id: string) => `aba-${id}` }));

import { createFakePage } from "@/lib/testing/fake-page";
import { elementsOf } from "@/lib/testing/react-tree";

import { WorkbenchProvider, type useWorkbench } from "../_lib/workbench-state";
import { TableTabPanel } from "./table-tab/table-tab";
import { WorkbenchTabs } from "./workbench-tabs";

type Value = ReturnType<typeof useWorkbench>;

const c1 = "0199dd00-0000-7000-8000-000000000001";
const c2 = "0199dd00-0000-7000-8000-000000000002";
const now = "2026-10-27T12:00:00Z";

function connection(id: string): Connection {
  return { id, folderID: null, name: `Conexão ${id}`, engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName: null, environmentColor: null, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };
}

/** O que a pessoa tinha aberto ao fechar o app: a tabela do c1 ativa, a do c2 escondida e uma consulta no c2. */
const saved: SavedWorkspace = {
  tabs: [
    { kind: "table", connectionID: c1, database: null, schema: "loja", table: "pedidos", view: "data" },
    { kind: "table", connectionID: c2, database: null, schema: "loja", table: "clientes", view: "data" },
    { kind: "query", connectionID: c2, database: null, sql: "SELECT 1", scriptID: null, dirty: false, sqlTooLarge: false },
  ],
  activeIndex: 0,
};

/** Uma renderização da área de trabalho: o provedor e, com o valor dele, a área das abas. Devolve o `disconnected` de cada painel de tabela, pelo nome da tabela. */
function render(): Map<string, unknown> {
  const tree = rt.render(() => {
    rt.provided.value = (WorkbenchProvider({ children: null }) as ReactElement<{ value: Value }>).props.value;
    return WorkbenchTabs() as ReactElement;
  });
  const panels = elementsOf(tree).filter((element) => element.type === TableTabPanel);
  return new Map(panels.map((panel) => [(panel.props.table as TableTab["table"] & object).name, panel.props.disconnected]));
}

/** As promessas do provedor (a ponte, a API) andam: a próxima renderização é a PRIMEIRA que mostra o que a entrada reabriu. */
async function reopened(): Promise<Map<string, unknown>> {
  render();
  for (let round = 0; round < 10; round++) await Promise.resolve();
  return render();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  rt.lists.clear();
  rt.lists.set("connections", [connection(c1), connection(c2)]);
  rt.lists.set("folders", []);
  rt.lists.set("scripts", []);
  rt.bridge.claim.mockResolvedValue(true);
  rt.api.workspace.mockResolvedValue({ ok: true, data: saved });
  const page = createFakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
});

afterEach(() => {
  rt.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a aba de tabela que volta na entrada volta desconectada desde a primeira renderização (RN-ABAS-006)", () => {
  it("a renderização que mostra as abas que voltaram já entrega `disconnected` à ativa e à escondida: a primeira carga dos Registros lê isso e espera o clique", async () => {
    expect(await reopened()).toEqual(
      new Map([
        ["pedidos", true],
        ["clientes", true],
      ]),
    );
  });

  it("e continua entregando nas renderizações seguintes, depois dos efeitos", async () => {
    await reopened();

    expect(render().get("pedidos")).toBe(true);
    expect(render().get("pedidos")).toBe(true);
  });

  it("a conexão que volta a ter sessão (o 'Atualizar' abriu a da aba, ou a pessoa conectou pelo navegador) deixa de esperar: só as abas dela carregam", async () => {
    await reopened();

    (rt.provided.value as Value).disconnectLog.forget(c1);

    expect(render()).toEqual(
      new Map([
        ["pedidos", false],
        ["clientes", true],
      ]),
    );
  });

  it("a conexão excluída não volta, nem a aba dela, e a consulta não marca nada: só as conexões das abas de tabela que voltaram esperam", async () => {
    rt.api.workspace.mockResolvedValue({
      ok: true,
      data: {
        tabs: [
          { kind: "table", connectionID: "0199dd00-0000-7000-8000-000000000009", database: null, schema: "loja", table: "gone", view: "data" },
          { kind: "query", connectionID: c1, database: null, sql: "SELECT 1", scriptID: null, dirty: false, sqlTooLarge: false },
        ],
        activeIndex: 1,
      } satisfies SavedWorkspace,
    });

    expect(await reopened()).toEqual(new Map());
    expect((rt.provided.value as Value).disconnectLog.getSnapshot().size).toBe(0);
  });

  it("a aba de tabela aberta pela pessoa, sem nada que tenha voltado, carrega ao abrir: o gesto é o clique", async () => {
    rt.api.workspace.mockResolvedValue({ ok: true, data: { tabs: [], activeIndex: null } });
    await reopened();

    (rt.provided.value as Value).openTableTab(c1, { schema: "loja", name: "pedidos" });
    for (let round = 0; round < 10; round++) await Promise.resolve();

    expect(render().get("pedidos")).toBe(false);
  });
});
