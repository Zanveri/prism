import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

// O navegador com os ganchos do React simulados (`createHookRuntime`): o que se confere AQUI é a ligação das pastas abertas lembradas (RN-NAV-014) com a árvore:
// quais pastas estão abertas, o que abrir e fechar grava, "Recolher tudo", as revelações (salvar, importar, "Mover para…") que só gravam no efeito que leva o
// pedido embora (e nunca enquanto o navegador se desenha), e as pastas abertas só na vista do seletor de ambiente (RN-NAV-010). As decisões são de
// `navigator-folders.ts`, a loja é de `folder-memory.ts` e a lista é de `navigator.type-ahead.test.ts`. A API, o provedor e as sessões são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    userName: "ana",
    fetchedAfterMount: true,
    folders: [] as unknown[],
    connections: [] as unknown[],
    /** Se a renderização do navegador está em curso: a loja não pode ser escrita nela. */
    rendering: false,
    changesWhileRendering: 0,
    /** Se a área de trabalho está à vista: sem ela, as revelações esperam. */
    onScreen: true,
    /** Os nós abertos do provedor (as conexões e o que está abaixo delas; as pastas não entram). */
    expanded: new Set<string>(),
    setNodeOpen: vi.fn(),
    onRevealed: vi.fn(),
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks, useDeferredValue: <T>(value: T) => value }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: readonly unknown[] }) => {
    const [family] = options.queryKey;
    return {
      data: family === "folders" ? rt.folders : family === "connections" ? rt.connections : family === "session" ? { unlocked: true, userName: rt.userName } : undefined,
      isError: false,
      isPending: false,
      isFetchedAfterMount: rt.fetchedAfterMount,
      refetch: vi.fn(),
    };
  },
  useQueries: ({ queries }: { queries: unknown[] }) => queries.map(() => ({ isFetching: false, isSuccess: false, isError: false, data: undefined })),
  useQueryClient: () => ({ getQueryData: (key: readonly unknown[]) => (key[0] === "folders" ? rt.folders : undefined), getQueryCache: () => ({ findAll: () => [] }) }),
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/app/settings/_lib/use-preferences", () => ({ usePreferences: () => ({ preferences: { ui: { navigatorDensity: "comfortable" } } }) }));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));
vi.mock("../_lib/workbench-state", () => ({
  useWorkbench: () => ({ tabs: [], expanded: rt.expanded, setNodeOpen: rt.setNodeOpen, openQueryTab() {}, openTableTab() {}, disconnect() {}, disconnecting: null }),
}));
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => rt.onScreen }));
vi.mock("../_lib/use-connection-checks", () => ({ useConnectionChecksSnapshot: () => new Map() }));

import { MoveConnectionDialog } from "@/app/connections/_components/move-connection-dialog";
import { elementsOf } from "@/lib/testing/react-tree";

import { connectionReveal } from "../_lib/connection-intent";
import { folderMemoryStore } from "../_lib/folder-memory";
import { folderKeyOf } from "../_lib/navigator-folders";
import { navKey, type NavNode } from "../_lib/navigator-model";
import { importedReveal } from "../_lib/transfer-requests";
import { FolderActionDialogs } from "./folder-action-dialogs";
import { Navigator, NavigatorList } from "./navigator";
import { NavigatorFilters } from "./navigator-filters";
import { NavigatorToolbar } from "./navigator-toolbar";

const now = "2026-10-27T12:00:00Z";
const folder = (id: string, parentID: string | null, name: string): Folder => ({ id, parentID, name, environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now });
const connection = (id: string, folderID: string | null, name: string, environmentName: string | null = null): Connection => ({
  id,
  folderID,
  name,
  engine: 1,
  host: "pg.exemplo.invalid",
  port: 5432,
  database: "loja",
  userName: "prism",
  hasPassword: true,
  environmentName,
  environmentColor: null,
  confirmCommands: null,
  readOnly: false,
  ...newVerification,
  protections: unprotected,
  createdAt: now,
  updatedAt: now,
});

// Fábrica (Linhas (c1 em Produção), Vazia), Arquivo (c2 em Produção) e, na raiz, c3 sem ambiente.
const base = () => ({
  folders: [folder("fabrica", null, "Fábrica"), folder("linhas", "fabrica", "Linhas"), folder("arquivo", null, "Arquivo")],
  connections: [connection("c1", "linhas", "Extrusão", "Produção"), connection("c2", "arquivo", "Histórico", "Produção"), connection("c3", null, "Local")],
});

const render = () => rt.render(() => {
  rt.rendering = true;
  try {
    return Navigator({ onNewConnection() {}, onEditConnection() {}, onTransfer() {}, onRevealed: rt.onRevealed, onHide() {}, hideShortcut: "Ctrl+B" });
  } finally {
    rt.rendering = false;
  }
});
const tree = () => elementsOf(render());
const list = () => tree().find((element) => element.type === NavigatorList)!.props as unknown as ComponentProps<typeof NavigatorList>;
const rows = () => list().rows.map((row) => row.key);
const keyOf = (id: string) => folderKeyOf(id);
const connectionKey = (connectionId: string) => navKey({ type: "connection", connectionId });
const remembered = () => [...folderMemoryStore.get(rt.userName, "connections")];
const toolbar = () => tree().find((element) => element.type === NavigatorToolbar)!.props as unknown as ComponentProps<typeof NavigatorToolbar>;
const nodeOf = (key: string): NavNode => list().rows.find((row) => row.key === key)!;
/** A barra de filtros, como o navegador a monta agora: o seletor de ambiente e "Só as conectadas" são dela. */
const filters = () => tree().find((element) => element.type === NavigatorFilters)!.props as unknown as ComponentProps<typeof NavigatorFilters>;
/** Escolhe o ambiente "Produção" no seletor. */
const chooseProduction = () => {
  const bar = filters();
  bar.onEnvironmentChange({ type: "environment", key: bar.environments[0].key });
};
/** Escolhe o ambiente de nome `name` (os que as conexões trazem: "Produção" e, com o laboratório, "Teste"). */
const chooseEnvironment = (name: string) => {
  const bar = filters();
  bar.onEnvironmentChange({ type: "environment", key: bar.environments.find((environment) => environment.name === name)!.key });
};
const clearEnvironment = () => filters().onEnvironmentChange({ type: "all" });
/** Acrescenta o Laboratório (pasta da raiz) com a conexão c4 em "Teste": só o ambiente "Teste" a mostra. */
const addLaboratory = () => {
  rt.folders = [...rt.folders, folder("lab", null, "Laboratório")];
  rt.connections = [...rt.connections, connection("c4", "lab", "Bancada", "Teste")];
};

let users = 0;
const realChange = folderMemoryStore.change;
beforeEach(() => {
  vi.clearAllMocks();
  // Cada teste é de um usuário: as pastas abertas ficam na loja da janela, e uma não passa ao teste seguinte.
  rt.userName = `navegador.${++users}`;
  rt.fetchedAfterMount = true;
  rt.changesWhileRendering = 0;
  rt.onScreen = true;
  rt.expanded = new Set();
  Object.assign(rt, base());
  connectionReveal.clear();
  importedReveal.clear();
  vi.spyOn(folderMemoryStore, "change").mockImplementation((...args: Parameters<typeof realChange>) => {
    if (rt.rendering) rt.changesWhileRendering++;
    return realChange(...args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  rt.unmount();
});

describe("as pastas começam fechadas e voltam como a pessoa as deixou (RN-NAV-014)", () => {
  it("sem nada lembrado, nenhuma pasta está aberta: a árvore mostra só o primeiro nível, e nada abre sozinho", () => {
    expect(rows()).toEqual([keyOf("arquivo"), keyOf("fabrica"), connectionKey("c3")]);
    expect(list().open.size).toBe(0);
    expect(rt.setNodeOpen).not.toHaveBeenCalled();
  });

  it("abrir e fechar pela lista grava na lista de pastas de conexões do usuário, e a renderização seguinte mostra", () => {
    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(remembered()).toEqual(["fabrica"]);
    expect(rows()).toEqual([keyOf("arquivo"), keyOf("fabrica"), keyOf("linhas"), connectionKey("c3")]);
    expect(list().open.has(keyOf("fabrica"))).toBe(true);

    list().onToggle(nodeOf(keyOf("linhas")));
    expect(remembered()).toEqual(["fabrica", "linhas"]);

    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(remembered()).toEqual(["linhas"]);
    expect(rows()).toEqual([keyOf("arquivo"), keyOf("fabrica"), connectionKey("c3")]);
  });

  it("montado de novo (outra entrada, outra janela), volta como ficou; a lista de scripts não se mistura", () => {
    list().onToggle(nodeOf(keyOf("arquivo")));
    rt.unmount();

    expect(list().open.has(keyOf("arquivo"))).toBe(true);
    expect([...folderMemoryStore.get(rt.userName, "scripts")]).toEqual([]);
  });

  it("as conexões não se lembram: uma pasta aberta não abre a conexão dentro dela, e nada conecta (RN-SESSAO-001, RN-ABAS-006)", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["fabrica", "linhas"] });

    expect(rows()).toEqual([keyOf("arquivo"), keyOf("fabrica"), keyOf("linhas"), connectionKey("c1"), connectionKey("c3")]);
    expect(list().open.has(connectionKey("c1"))).toBe(false);
    expect(rt.setNodeOpen).not.toHaveBeenCalled();
  });

  it("o identificador lembrado de uma pasta que não existe não tem efeito, e a poda o tira da lembrança na primeira lista lida", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["excluida", "linhas"] });

    expect(rows()).toEqual([keyOf("arquivo"), keyOf("fabrica"), connectionKey("c3")]);
    expect(remembered()).toEqual(["linhas"]);
  });

  it("a poda espera a lista lida depois da montagem: a do cache pode estar velha", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["excluida"] });
    rt.fetchedAfterMount = false;

    render();
    expect(remembered()).toEqual(["excluida"]);

    rt.fetchedAfterMount = true;
    render();
    expect(remembered()).toEqual([]);
  });

  it("\"Recolher tudo\" fecha todas as pastas, e é isso que fica lembrado; só vale com algo aberto", () => {
    expect(toolbar().buttons.find((button) => button.id === "collapseAll")?.disabled).toBe(true);

    folderMemoryStore.change(rt.userName, "connections", { open: ["fabrica", "linhas"] });
    expect(toolbar().buttons.find((button) => button.id === "collapseAll")?.disabled).toBeFalsy();

    toolbar().onAction("collapseAll");
    expect(remembered()).toEqual([]);
    expect(rows()).toEqual([keyOf("arquivo"), keyOf("fabrica"), connectionKey("c3")]);
    expect(toolbar().buttons.find((button) => button.id === "collapseAll")?.disabled).toBe(true);
  });
});

describe("as revelações abrem as pastas no efeito que leva o pedido embora, e nunca enquanto a árvore se desenha (RN-NAV-014)", () => {
  it("a conexão salva (RN-NAV-004): as pastas até ela abrem e ficam lembradas, a linha é escolhida e vai ao foco, e quem mostra o navegador é avisado", () => {
    connectionReveal.request("c1");

    render();
    expect(remembered()).toEqual(["linhas", "fabrica"]);
    expect(rt.changesWhileRendering).toBe(0);
    expect(rt.onRevealed).toHaveBeenCalledOnce();
    expect(connectionReveal.pending()).toBeNull();

    expect(rows()).toContain(connectionKey("c1"));
    expect(list().selectedKey).toBe(connectionKey("c1"));
    expect(list().reveal?.key).toBe(connectionKey("c1"));
  });

  it("o pedido é atendido uma vez: renderizar de novo não grava nem avisa de novo, e a pasta que a pessoa fecha depois continua fechada", () => {
    connectionReveal.request("c1");
    render();
    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(remembered()).toEqual(["linhas"]);

    render();
    render();
    expect(remembered()).toEqual(["linhas"]);
    expect(rt.onRevealed).toHaveBeenCalledOnce();
  });

  it("a conexão que já estava à vista, com as pastas abertas, não muda a lembrança", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["fabrica", "linhas"] });
    connectionReveal.request("c1");

    render();
    expect(remembered()).toEqual(["fabrica", "linhas"]);
    expect(list().selectedKey).toBe(connectionKey("c1"));
  });

  it("a importação (RN-TRANSF-014): as pastas até o que entrou abrem e ficam lembradas no efeito, e a primeira linha importada é escolhida", () => {
    importedReveal.request({ folderIDs: ["linhas"], connectionIDs: ["c1"], targetFolderID: "fabrica" });

    render();
    expect(rt.changesWhileRendering).toBe(0);
    expect(new Set(remembered())).toEqual(new Set(["fabrica", "linhas"]));
    expect(importedReveal.pending()).toBeNull();
    expect(rt.onRevealed).toHaveBeenCalledOnce();
    expect(list().selectedKey).toBe(keyOf("linhas"));
  });

  it("\"Mover para…\" uma conexão (RN-NAV-003): depois de movida, é revelada como a salva, com as pastas do destino abertas e lembradas", () => {
    list().onKeyAction(nodeOf(connectionKey("c3")), { type: "moveConnection" });
    const dialog = tree().find((element) => element.type === MoveConnectionDialog)!.props as unknown as ComponentProps<typeof MoveConnectionDialog>;

    // A API moveu c3 para Linhas (dentro de Fábrica); a lista lida de novo já a traz lá.
    rt.connections = rt.connections.map((candidate) => ((candidate as Connection).id === "c3" ? { ...(candidate as Connection), folderID: "linhas" } : candidate));
    dialog.onMoved?.(rt.connections.find((candidate) => (candidate as Connection).id === "c3") as Connection);
    render();

    expect(new Set(remembered())).toEqual(new Set(["linhas", "fabrica"]));
    expect(rt.changesWhileRendering).toBe(0);
    expect(list().rows.map((row) => row.key)).toContain(connectionKey("c3"));
    expect(list().selectedKey).toBe(connectionKey("c3"));
  });

  it("\"Mover para…\" uma pasta: as pastas do novo lugar dela abrem e ficam lembradas, e ela fica escolhida e à vista", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["fabrica"] });
    list().onKeyAction(nodeOf(keyOf("arquivo")), { type: "moveFolder" });
    const dialogs = tree().find((element) => element.type === FolderActionDialogs)!.props as unknown as ComponentProps<typeof FolderActionDialogs>;

    // A API moveu Arquivo para dentro de Linhas, que está dentro de Fábrica.
    rt.folders = rt.folders.map((candidate) => ((candidate as Folder).id === "arquivo" ? { ...(candidate as Folder), parentID: "linhas" } : candidate));
    dialogs.onMoved?.(rt.folders.find((candidate) => (candidate as Folder).id === "arquivo") as Folder);
    render();

    expect(new Set(remembered())).toEqual(new Set(["fabrica", "linhas"]));
    expect(rows()).toContain(keyOf("arquivo"));
    expect(list().selectedKey).toBe(keyOf("arquivo"));
    expect(list().reveal?.key).toBe(keyOf("arquivo"));
  });

  it("\"Nova conexão\" e \"Nova pasta\" dentro de uma pasta a abrem e a lembram", () => {
    list().onKeyAction(nodeOf(keyOf("arquivo")), { type: "newFolder" });
    expect(remembered()).toEqual(["arquivo"]);

    list().onKeyAction(nodeOf(keyOf("fabrica")), { type: "newConnection" });
    expect(remembered()).toEqual(["arquivo", "fabrica"]);
  });
});

describe("o seletor de ambiente abre as pastas do caminho só na vista, sem gravar (RN-NAV-010)", () => {
  it("com o ambiente escolhido, as pastas até as conexões dele abrem, e o que se lembra não muda; sem filtro, tudo volta fechado", () => {
    chooseProduction();

    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica"), keyOf("linhas"), connectionKey("c1")]);
    expect(remembered()).toEqual([]);

    clearEnvironment();
    expect(rows()).toEqual([keyOf("arquivo"), keyOf("fabrica"), connectionKey("c3")]);
    expect(remembered()).toEqual([]);
  });

  it("recolher uma pasta na vista vale enquanto o filtro está ligado, sem gravar; desligar o filtro devolve as pastas como estavam, e ligar de novo abre tudo outra vez", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["arquivo"] });
    chooseProduction();

    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica")]);
    expect(remembered()).toEqual(["arquivo"]);

    clearEnvironment();
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica"), connectionKey("c3")]);
    expect(remembered()).toEqual(["arquivo"]);

    chooseProduction();
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica"), keyOf("linhas"), connectionKey("c1")]);
  });

  it("abrir na vista uma pasta recolhida nela também não grava; as lembradas fecham e abrem pela vista, e não pelo que se lembra", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["fabrica"] });
    chooseProduction();
    expect(list().open.has(keyOf("linhas"))).toBe(true);

    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(list().open.has(keyOf("fabrica"))).toBe(false);
    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(list().open.has(keyOf("fabrica"))).toBe(true);
    expect(remembered()).toEqual(["fabrica"]);
  });

  it("\"Recolher tudo\" na vista recolhe as pastas só nela: o lembrado fica como estava", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["arquivo", "fabrica"] });
    chooseProduction();
    expect(toolbar().buttons.find((button) => button.id === "collapseAll")?.disabled).toBeFalsy();

    toolbar().onAction("collapseAll");
    expect(rows()).toEqual([keyOf("arquivo"), keyOf("fabrica")]);
    expect(remembered()).toEqual(["arquivo", "fabrica"]);

    clearEnvironment();
    expect(list().open.has(keyOf("arquivo"))).toBe(true);
  });

  it("revelar uma conexão dentro de uma pasta recolhida na vista a abre nela e a lembra", () => {
    chooseProduction();
    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica")]);

    connectionReveal.request("c1");
    render();
    expect(rows()).toContain(connectionKey("c1"));
    expect(remembered()).toEqual(["linhas", "fabrica"]);
  });

  it("\"Só as conectadas\" tem a mesma vista: o botão e o seletor se combinam, e a escolha dele não grava", () => {
    // Nenhuma conexão conectada: a árvore filtrada fica vazia, sem pasta nenhuma, e nada é gravado.
    filters().onToggleConnected();

    expect(list().rows).toEqual([]);
    expect(remembered()).toEqual([]);
  });
});

describe("a vista filtrada começa de novo a cada troca de filtro (RN-NAV-010 e 013)", () => {
  it("o que se recolheu num ambiente não volta ao voltar a ele, tenha-se mexido ou não numa pasta do ambiente do meio", () => {
    addLaboratory();
    chooseEnvironment("Produção");
    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica")]);

    chooseEnvironment("Teste");
    expect(rows()).toEqual([keyOf("lab"), connectionKey("c4")]);

    chooseEnvironment("Produção");
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica"), keyOf("linhas"), connectionKey("c1")]);
    expect(remembered()).toEqual([]);
  });

  it("ligar \"Só as conectadas\" por cima do ambiente também é outra vista, e desligar de novo não traz o recolhido de volta", () => {
    chooseEnvironment("Produção");
    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica")]);

    filters().onToggleConnected();
    expect(rows()).toEqual([]);

    filters().onToggleConnected();
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica"), keyOf("linhas"), connectionKey("c1")]);
  });

  it("a mesma vista segue valendo entre uma renderização e outra: o recolhido fica enquanto o filtro está ligado", () => {
    chooseEnvironment("Produção");
    list().onToggle(nodeOf(keyOf("fabrica")));

    render();
    render();
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica")]);
  });
});

describe("as revelações com os filtros e a busca ligados (RN-NAV-004, RN-TRANSF-014, RN-NAV-014)", () => {
  it("a conexão salva que o ambiente escolhido esconde: o filtro sai, e as pastas até ela abrem e ficam lembradas", () => {
    addLaboratory();
    chooseEnvironment("Produção");
    expect(rows()).not.toContain(connectionKey("c4"));

    connectionReveal.request("c4");
    render();

    expect(filters().environmentChoice).toEqual({ type: "all" });
    expect(remembered()).toEqual(["lab"]);
    expect(rows()).toContain(connectionKey("c4"));
    expect(list().selectedKey).toBe(connectionKey("c4"));
    expect(rt.changesWhileRendering).toBe(0);
  });

  it("a importação que o ambiente escolhido esconde: o filtro fica, as pastas abrem e ficam lembradas, e a escolha vai à primeira linha à vista", () => {
    addLaboratory();
    chooseEnvironment("Produção");

    importedReveal.request({ folderIDs: [], connectionIDs: ["c4"], targetFolderID: "lab" });
    render();

    expect(filters().environmentChoice).toMatchObject({ type: "environment" });
    expect(remembered()).toEqual(["lab"]);
    expect(list().selectedKey).toBe(rows()[0]);
    expect(importedReveal.pending()).toBeNull();
    expect(rt.changesWhileRendering).toBe(0);
  });

  it("a conexão salva enquanto a área de trabalho não está à vista espera: nada é gravado até ela voltar, e então as pastas abrem uma vez", () => {
    rt.onScreen = false;
    connectionReveal.request("c1");

    render();
    render();
    expect(remembered()).toEqual([]);
    expect(connectionReveal.pending()).not.toBeNull();
    expect(rt.onRevealed).not.toHaveBeenCalled();

    rt.onScreen = true;
    render();
    expect(remembered()).toEqual(["linhas", "fabrica"]);
    expect(connectionReveal.pending()).toBeNull();
    expect(rt.onRevealed).toHaveBeenCalledOnce();
  });

  it("o pedido para uma conexão que a lista ainda não traz espera por ela: nada é gravado, e chegando, as pastas abrem", () => {
    connectionReveal.request("nova");

    render();
    expect(remembered()).toEqual([]);
    expect(rt.onRevealed).not.toHaveBeenCalled();

    rt.connections = [...rt.connections, connection("nova", "linhas", "Nova")];
    render();
    expect(remembered()).toEqual(["linhas", "fabrica"]);
    expect(rows()).toContain(connectionKey("nova"));
  });

  it("a conexão salva que uma busca esconde: a busca é limpa, e as pastas abrem e ficam lembradas", () => {
    filters().onQueryChange("Histórico");
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2")]);

    connectionReveal.request("c1");
    render();

    expect(filters().query).toBe("");
    expect(remembered()).toEqual(["linhas", "fabrica"]);
    expect(rows()).toContain(connectionKey("c1"));
  });

  it("\"Nova pasta\" numa pasta que a vista filtrada recolheu a abre nela e a lembra", () => {
    chooseEnvironment("Produção");
    list().onToggle(nodeOf(keyOf("fabrica")));
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica")]);

    list().onKeyAction(nodeOf(keyOf("fabrica")), { type: "newFolder" });
    expect(remembered()).toEqual(["fabrica"]);
    expect(rows()).toContain(keyOf("linhas"));
  });
});

describe("\"Mover para…\" e \"Recolher tudo\" nas bordas (RN-NAV-002, RN-NAV-003, RN-NAV-014)", () => {
  const moveDialog = () => tree().find((element) => element.type === MoveConnectionDialog)!.props as unknown as ComponentProps<typeof MoveConnectionDialog>;
  const moveTo = (connectionId: string, folderID: string | null) => {
    rt.connections = rt.connections.map((candidate) => ((candidate as Connection).id === connectionId ? { ...(candidate as Connection), folderID } : candidate));
    moveDialog().onMoved?.(rt.connections.find((candidate) => (candidate as Connection).id === connectionId) as Connection);
    render();
  };

  it("mover a mesma conexão duas vezes a revela nas duas, com as pastas de cada destino abertas", () => {
    list().onKeyAction(nodeOf(connectionKey("c3")), { type: "moveConnection" });
    moveTo("c3", "linhas");
    expect(remembered()).toEqual(["linhas", "fabrica"]);
    const first = list().reveal!.seq;

    list().onKeyAction(nodeOf(connectionKey("c3")), { type: "moveConnection" });
    moveTo("c3", "arquivo");
    expect(new Set(remembered())).toEqual(new Set(["linhas", "fabrica", "arquivo"]));
    expect(list().reveal!.seq).toBeGreaterThan(first);
    expect(list().selectedKey).toBe(connectionKey("c3"));
    expect(rows()).toContain(connectionKey("c3"));
  });

  it("mover uma conexão para a raiz não abre nada, e ela fica escolhida", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["fabrica", "linhas"] });
    list().onKeyAction(nodeOf(connectionKey("c1")), { type: "moveConnection" });
    moveTo("c1", null);

    expect(remembered()).toEqual(["fabrica", "linhas"]);
    expect(list().selectedKey).toBe(connectionKey("c1"));
  });

  it("mover uma pasta com uma busca no campo só abre as pastas do destino: a pasta pode não estar na lista filtrada, e o pedido de foco ficaria armado", () => {
    filters().onQueryChange("Arq");
    expect(rows()).toContain(keyOf("arquivo"));
    list().onKeyAction(nodeOf(keyOf("arquivo")), { type: "moveFolder" });
    const dialogs = tree().find((element) => element.type === FolderActionDialogs)!.props as unknown as ComponentProps<typeof FolderActionDialogs>;

    rt.folders = rt.folders.map((candidate) => ((candidate as Folder).id === "arquivo" ? { ...(candidate as Folder), parentID: "linhas" } : candidate));
    dialogs.onMoved?.(rt.folders.find((candidate) => (candidate as Folder).id === "arquivo") as Folder);
    render();

    expect(new Set(remembered())).toEqual(new Set(["fabrica", "linhas"]));
    expect(list().selectedKey).toBeNull();
    expect(list().reveal).toBeNull();
  });

  it("\"Recolher tudo\" também fecha o que está aberto sob as conexões, e não toca na lista das pastas de scripts", () => {
    const database = navKey({ type: "database", connectionId: "c1" });
    folderMemoryStore.change(rt.userName, "connections", { open: ["fabrica", "linhas"] });
    folderMemoryStore.change(rt.userName, "scripts", { open: ["s1"] });
    rt.expanded = new Set([connectionKey("c1"), database]);

    toolbar().onAction("collapseAll");

    expect(rt.setNodeOpen).toHaveBeenCalledWith(connectionKey("c1"), false);
    expect(rt.setNodeOpen).toHaveBeenCalledWith(database, false);
    expect(remembered()).toEqual([]);
    expect([...folderMemoryStore.get(rt.userName, "scripts")]).toEqual(["s1"]);
  });

  it("\"Recolher tudo\" com uma busca no campo fecha as pastas lembradas: a ação é da pessoa, e a busca só olha", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["fabrica", "linhas"] });
    filters().onQueryChange("Extrusão");
    expect(remembered()).toEqual(["fabrica", "linhas"]);

    toolbar().onAction("collapseAll");
    expect(remembered()).toEqual([]);

    filters().onQueryChange("");
    expect(rows()).toEqual([keyOf("arquivo"), keyOf("fabrica"), connectionKey("c3")]);
  });
});

describe("o que se lembra segue o identificador, e a poda olha a lista inteira (RN-NAV-014)", () => {
  it("a pasta movida ou renomeada leva o estado com ela: o identificador é o mesmo", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["arquivo", "linhas"] });
    expect(rows()).toEqual([keyOf("arquivo"), connectionKey("c2"), keyOf("fabrica"), connectionKey("c3")]);

    rt.folders = rt.folders.map((candidate) => ((candidate as Folder).id === "linhas" ? { ...(candidate as Folder), parentID: "arquivo", name: "Renomeada" } : candidate));
    expect(rows()).toEqual([keyOf("arquivo"), keyOf("linhas"), connectionKey("c1"), connectionKey("c2"), keyOf("fabrica"), connectionKey("c3")]);
    expect(remembered()).toEqual(["arquivo", "linhas"]);
  });

  it("a pasta que o filtro esconde continua lembrada na poda: quem decide o que existe é a lista de pastas, e não a árvore à vista", () => {
    addLaboratory();
    folderMemoryStore.change(rt.userName, "connections", { open: ["lab", "excluida"] });
    rt.fetchedAfterMount = false;
    render();
    chooseEnvironment("Produção");
    expect(rows()).not.toContain(keyOf("lab"));

    rt.fetchedAfterMount = true;
    render();
    expect(remembered()).toEqual(["lab"]);
  });

  it("a poda das conexões não toca na lista das pastas de scripts, que tem os identificadores dela", () => {
    folderMemoryStore.change(rt.userName, "connections", { open: ["excluida", "linhas"] });
    folderMemoryStore.change(rt.userName, "scripts", { open: ["pasta-de-script"] });

    render();
    expect(remembered()).toEqual(["linhas"]);
    expect([...folderMemoryStore.get(rt.userName, "scripts")]).toEqual(["pasta-de-script"]);
  });
});
