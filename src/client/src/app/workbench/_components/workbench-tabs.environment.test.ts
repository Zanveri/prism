import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

import type { QueryTab, TableTab } from "../_lib/workbench-model";

// A cor do ambiente da conexão de cada aba até a área de resultado (RN-AMB-002), na área das abas (`WorkbenchTabs`), com os ganchos do React simulados: o que
// ela entrega a cada `QueryTabPanel` (`environmentColor`) e a cada `TableTabPanel` (`environment`), com o ambiente próprio, o herdado da pasta e a falta de um
// ou do outro. A área de trabalho (`useWorkbench`), a faixa, os painéis e a ponte são de mentira, como no teste do lugar do resultado.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  const runner = { values: { snapshot: () => ({ values: new Map(), counter: 0 }) }, getState: () => ({ status: "idle" }), autoRunSettled: () => Promise.resolve(), autoRefresh: { pause: vi.fn() }, sessionOf: () => null, transaction: { getState: () => ({ open: false }) } };
  const workbench = { tabs: [] as unknown[], activeTabId: null as string | null, resultActive: false, runnerOf: () => runner, showEntry: vi.fn(), setResultPlace: vi.fn(), closeTab: vi.fn(), detachTab: vi.fn() };
  /** As listas que as consultas entregam, pela chave: `connections` e `folders`. Sem a chave, a lista ainda não chegou. */
  const lists = new Map<string, unknown>();
  const focus = { request: vi.fn(), forgetExcept: vi.fn(), pending: vi.fn(() => false) };
  const host = { releaseFocusIn: vi.fn(), focusResultIn: vi.fn(), resultHostOf: vi.fn(() => ({ id: "raiz" })) };

  return { ...createHookRuntime(), workbench, lists, focus, host };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: readonly unknown[] }) => ({ data: rt.lists.get(String(options.queryKey[0])) }),
  useQueryClient: () => ({}),
}));
vi.mock("@/components/ui", () => ({ ConfirmDialog: () => null, useToast: () => ({ success: vi.fn(), warning: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/api/bridge", () => ({ currentWindowId: () => 1, onTabWanted: () => () => {}, onWindowCloseRequested: () => () => {}, sendTabAway: vi.fn(), tellWindows: () => {}, resultWindowsAvailable: () => false, onResultWindowClosed: () => () => {}, onResultWindowState: () => () => {} }));
vi.mock("../_lib/data-export/data-exports", () => ({ exportTracker: { count: () => 0, cancelAll: async () => {} } }));
vi.mock("../_lib/data-import/data-imports", () => ({ loadTracker: { cancelAll: async () => {} }, windowTransfers: () => ({ exports: 0, imports: 0, copies: 0 }) }));
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => true }));
vi.mock("../_lib/result-slots", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_lib/result-slots")>()), resultFocus: rt.focus }));
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
import { TableTabPanel } from "./table-tab/table-tab";
import { WorkbenchTabs } from "./workbench-tabs";

const noop = Object.fromEntries(["setActiveTab", "updateTab", "setTableView", "openTableTab", "reorderTab", "shiftTab", "releaseWindow", "markScriptEdited", "switchConnection", "switchDatabase", "holdForWindowClose", "releaseWindowClose"].map((name) => [name, vi.fn()]));

const now = "2026-10-27T12:00:00Z";

function folder(id: string, parentID: string | null, environmentName: string | null = null, environmentColor: string | null = null): Folder {
  return { id, parentID, name: `Pasta ${id}`, environmentName, environmentColor, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now };
}

function connection(id: string, folderID: string | null, environmentName: string | null = null, environmentColor: string | null = null): Connection {
  return { id, folderID, name: `Conexão ${id}`, engine: 1, host: "pg", port: 5432, database: "mes", userName: "mes", hasPassword: true, environmentName, environmentColor, confirmCommands: null, readOnly: false, ...newVerification, protections: unprotected, createdAt: now, updatedAt: now };
}

const queryTab = (id: string, connectionId: string | null): QueryTab => ({ id, title: `${id}.sql`, connectionId, sessionId: null, sql: "" });
const tableTab = (id: string, connectionId: string): TableTab => ({ id, title: "loja.pedido", connectionId, sessionId: null, sql: "", table: { schema: "loja", name: "pedido", view: "data" } });

// Produção (vermelha) > Linha 1 (sem ambiente) > Extrusão (QAS, âmbar); Geral na raiz, sem ambiente; Só cor: uma pasta com cor e sem nome, dentro de Produção.
const folders = [folder("producao", null, "Produção", "#FF8A7A"), folder("linha", "producao"), folder("extrusao", "linha", "QAS", "#F2B644"), folder("geral", null), folder("so-cor", "producao", null, "#7DB2FF")];

function render(): Found[] {
  return elementsOf(rt.render(() => WorkbenchTabs() as ReactElement));
}

/** A cor que a aba de consulta `id` recebe para a área de resultado dela. */
const colorOf = (found: Found[], id: string) => {
  const panel = found.find((element) => element.type === QueryTabPanel && (element.props.tab as QueryTab).id === id);
  expect(panel, `painel da aba ${id}`).toBeDefined();
  return panel!.props.environmentColor;
};

/** Mostra as abas dadas, com a conexão de cada uma e as pastas. */
function show(tabs: (QueryTab | TableTab)[], connections: Connection[], folderList: Folder[] | "ainda não chegou" = folders) {
  rt.workbench.tabs = tabs;
  rt.workbench.activeTabId = tabs[0].id;
  rt.lists.set("connections", connections);
  if (folderList === "ainda não chegou") rt.lists.delete("folders");
  else rt.lists.set("folders", folderList);
  return render();
}

beforeEach(() => {
  vi.clearAllMocks();
  rt.lists.clear();
  rt.workbench.resultActive = false;
  const page = createFakePage();
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("window", page.window);
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

describe("a aba de consulta recebe a cor do ambiente da conexão dela (RN-AMB-002)", () => {
  it("o ambiente próprio da conexão, com cor: a cor dele", () => {
    expect(colorOf(show([queryTab("a", "c1")], [connection("c1", null, "Develop", "#5ED3A3")]), "a")).toBe("#5ED3A3");
  });

  it("o ambiente herdado da pasta (RN-PASTA-005): a cor da pasta mais próxima que tenha um, e não a de mais longe", () => {
    const found = show([queryTab("a", "c1"), queryTab("b", "c2"), queryTab("c", "c3")], [connection("c1", "producao"), connection("c2", "linha"), connection("c3", "extrusao")]);

    expect(colorOf(found, "a")).toBe("#FF8A7A");
    expect(colorOf(found, "b")).toBe("#FF8A7A");
    expect(colorOf(found, "c")).toBe("#F2B644");
  });

  it("o ambiente próprio ganha o da pasta, também no que não tem: nome sem cor dentro de uma pasta vermelha fica sem cor, e não vermelho", () => {
    const found = show([queryTab("a", "c1"), queryTab("b", "c2")], [connection("c1", "producao", "Develop", "#5ED3A3"), connection("c2", "producao", "Develop", null)]);

    expect(colorOf(found, "a")).toBe("#5ED3A3");
    expect(colorOf(found, "b")).toBeNull();
  });

  it.each([
    ["conexão sem ambiente na raiz", connection("c1", null)],
    ["conexão sem ambiente numa pasta sem ambiente", connection("c1", "geral")],
    ["ambiente só com nome", connection("c1", null, "Develop", null)],
    ["cor sem nome: não faz ambiente (RN-PASTA-005)", connection("c1", null, null, "#7DB2FF")],
    ["cor sem nome, numa pasta sem ambiente", connection("c1", "geral", null, "#7DB2FF")],
  ])("%s: nula, e a área fica como no tema", (_name, owner) => {
    expect(colorOf(show([queryTab("a", "c1")], [owner]), "a")).toBeNull();
  });

  it("a cor sem nome, na conexão ou na pasta, não vale por si: a conexão herda o ambiente de verdade que está acima, e não a cor sem nome", () => {
    // "so-cor" tem só a cor azul e está dentro de Produção (vermelha): o ambiente é o de Produção, o azul sem nome não conta.
    const found = show([queryTab("a", "c1"), queryTab("b", "c2")], [connection("c1", "so-cor"), connection("c2", "so-cor", null, "#7DB2FF")]);

    expect(colorOf(found, "a")).toBe("#FF8A7A");
    expect(colorOf(found, "b")).toBe("#FF8A7A");
  });

  it("a aba sem conexão (restaurada, script avulso) e a conexão que não está na lista: nula", () => {
    const found = show([queryTab("a", null), queryTab("b", "c-que-sumiu")], [connection("c1", "producao")]);

    expect(colorOf(found, "a")).toBeNull();
    expect(colorOf(found, "b")).toBeNull();
  });

  it("a lista de conexões ainda não chegou: nula; a de pastas ainda não chegou: vale o ambiente próprio, e o herdado espera", () => {
    rt.workbench.tabs = [queryTab("a", "c1"), queryTab("b", "c2")];
    rt.workbench.activeTabId = "a";
    expect(colorOf(render(), "a")).toBeNull();

    const found = show([queryTab("a", "c1"), queryTab("b", "c2")], [connection("c1", "producao", "Develop", "#5ED3A3"), connection("c2", "producao")], "ainda não chegou");
    expect(colorOf(found, "a")).toBe("#5ED3A3");
    expect(colorOf(found, "b")).toBeNull();
  });

  it("cada aba recebe a cor da conexão DELA: duas abas de ambientes diferentes, e duas do mesmo, não se misturam", () => {
    const found = show([queryTab("a", "c1"), queryTab("b", "c2"), queryTab("c", "c3"), queryTab("d", "c4")], [connection("c1", "producao"), connection("c2", "extrusao"), connection("c3", "producao"), connection("c4", "geral")]);

    expect([..."abcd"].map((id) => colorOf(found, id))).toEqual(["#FF8A7A", "#F2B644", "#FF8A7A", null]);
  });

  it("trocar a conexão da aba (RN-ARVORE-008) troca a cor na hora, e voltar a uma conexão sem ambiente devolve o tema", () => {
    const connections = [connection("c1", "producao"), connection("c2", "extrusao"), connection("c3", "geral")];
    expect(colorOf(show([queryTab("a", "c1")], connections), "a")).toBe("#FF8A7A");
    expect(colorOf(show([queryTab("a", "c2")], connections), "a")).toBe("#F2B644");
    expect(colorOf(show([queryTab("a", "c3")], connections), "a")).toBeNull();
    expect(colorOf(show([queryTab("a", "c1")], connections), "a")).toBe("#FF8A7A");
  });

  it("mudar o ambiente da pasta, ou mover a conexão de pasta, muda a cor na hora: as listas novas são a conta nova", () => {
    expect(colorOf(show([queryTab("a", "c1")], [connection("c1", "producao")]), "a")).toBe("#FF8A7A");

    // O ambiente da pasta mudou: outra cor e outro nome.
    const edited = folders.map((item) => (item.id === "producao" ? folder("producao", null, "Produção", "#B79CFF") : item));
    expect(colorOf(show([queryTab("a", "c1")], [connection("c1", "producao")], edited), "a")).toBe("#B79CFF");

    // O ambiente saiu da pasta: a conexão não tem mais o que herdar.
    const cleared = folders.map((item) => (item.id === "producao" ? folder("producao", null) : item));
    expect(colorOf(show([queryTab("a", "c1")], [connection("c1", "producao")], cleared), "a")).toBeNull();

    // A conexão foi movida para outra pasta (a lista que a API devolve é outra).
    expect(colorOf(show([queryTab("a", "c1")], [connection("c1", "extrusao")]), "a")).toBe("#F2B644");
  });

  it("a cor chega como o texto que está na lista (é um texto, para o painel memorizado comparar pelo valor); quem confere o formato é a área de resultado", () => {
    const first = colorOf(show([queryTab("a", "c1")], [connection("c1", "producao")]), "a");
    const second = colorOf(show([queryTab("a", "c1")], [connection("c1", "producao")]), "a");

    expect(typeof first).toBe("string");
    expect(second).toBe(first);
    // Uma cor fora do formato (um cofre antigo, uma importação) não é barrada aqui: a barreira é uma só, a que põe a variável no `style`.
    expect(colorOf(show([queryTab("a", "c1")], [connection("c1", null, "Develop", "vermelho")]), "a")).toBe("vermelho");
  });
});

describe("a aba de tabela recebe o ambiente, com a cor, que desce até os Registros (RN-AMB-002)", () => {
  const environmentOf = (found: Found[], id: string) => found.find((element) => element.type === TableTabPanel && (element.props.tab as TableTab).id === id)!.props.environment;

  it("o próprio, o herdado da pasta (com a pasta que o dá) e nenhum", () => {
    const found = show([tableTab("t1", "c1"), tableTab("t2", "c2"), tableTab("t3", "c3")], [connection("c1", null, "Develop", "#5ED3A3"), connection("c2", "extrusao"), connection("c3", "geral")]);

    expect(environmentOf(found, "t1")).toEqual({ name: "Develop", color: "#5ED3A3", folder: null });
    expect(environmentOf(found, "t2")).toMatchObject({ name: "QAS", color: "#F2B644", folder: { id: "extrusao" } });
    expect(environmentOf(found, "t3")).toBeNull();
  });

  it("é o mesmo objeto enquanto as listas não mudam: o painel memorizado da tabela não se refaz à toa", () => {
    const connections = [connection("c1", "producao")];
    const first = environmentOf(show([tableTab("t1", "c1")], connections), "t1");
    const second = environmentOf(show([tableTab("t1", "c1")], connections), "t1");

    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });
});
