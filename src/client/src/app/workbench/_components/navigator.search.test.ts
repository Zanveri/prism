import type { ComponentProps } from "react";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { newVerification, unprotected, type Connection, type Folder } from "@/app/connections/_lib/connections.schema";

// O navegador com os ganchos do React simulados (`createHookRuntime`) e o cache de consultas de verdade: o que se confere AQUI é a ligação da busca em todas as conexões
// (RN-BUSCA-001 e RN-BUSCA-002) com a árvore: quais bancos têm o índice pedido e quando, o que aparece, o que a linha de estado diz, o que "Buscar nelas também" e "Tentar de
// novo" fazem, e que nada entra em `expanded` nem na loja das pastas. As decisões são puras e têm os testes delas (`navigator-search-scope.test.ts`,
// `navigator-index.test.ts`, `navigator-search.test.ts`). Os resultados das consultas observadas vêm do cache; a API é de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    userName: "ana",
    folders: [] as unknown[],
    connections: [] as unknown[],
    /** O cache de verdade (um por teste); a consulta observada lê dele. */
    queryClient: undefined as unknown as import("@tanstack/react-query").QueryClient,
    /** As consultas em voo (a chave em JSON) e as falhas que o teste impõe (a chave em JSON), além das que o cache já guarda. */
    fetching: new Set<string>(),
    errors: new Map<string, unknown>(),
    /** O que o navegador pediu ao `useQueries` dos índices na última renderização: a consulta de cada banco do escopo. */
    indexQueries: [] as { queryKey: readonly unknown[]; enabled?: boolean }[],
    tabs: [] as { connectionId: string | null; sessionId: string | null }[],
    expanded: new Set<string>(),
    setNodeOpen: vi.fn(),
    openQueryTab: vi.fn(),
    openTableTab: vi.fn(),
    disconnect: vi.fn(),
    checks: new Map<string, unknown>(),
    warnings: vi.fn(),
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
      isFetchedAfterMount: true,
      refetch: vi.fn(),
    };
  },
  useQueries: ({ queries }: { queries: { queryKey: readonly unknown[]; enabled?: boolean }[] }) => {
    if (queries.length > 0 && queries.every((query) => query.queryKey.at(-1) === "names")) rt.indexQueries = queries;
    return queries.map((query) => {
      const hash = JSON.stringify(query.queryKey);
      const state = rt.queryClient.getQueryState(query.queryKey);
      const error = state?.status === "error" ? state.error : rt.errors.get(hash);
      return { data: state?.data, isSuccess: state?.status === "success", isError: error !== undefined && error !== null, error, isFetching: rt.fetching.has(hash) };
    });
  },
  useQueryClient: () => rt.queryClient,
  useMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/app/settings/_lib/use-preferences", () => ({ usePreferences: () => ({ preferences: { ui: { navigatorDensity: "comfortable" } } }) }));
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning: rt.warnings, error() {} }) }));
vi.mock("../_lib/workbench-state", () => ({
  useWorkbench: () => ({ tabs: rt.tabs, expanded: rt.expanded, setNodeOpen: rt.setNodeOpen, openQueryTab: rt.openQueryTab, openTableTab: rt.openTableTab, disconnect: rt.disconnect, disconnecting: null }),
}));
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => true }));
vi.mock("../_lib/use-connection-checks", () => ({ useConnectionChecksSnapshot: () => rt.checks }));

// A API: abrir a sessão (POST) responde com uma sessão nova; o resto não é chamado pela busca em si.
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api/prism-api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/prism-api")>()), apiRequest: api.request }));

import { ContextMenu, type ContextMenuItem } from "@/components/ui";
import { ApiRequestError } from "@/lib/api/prism-api";
import { elementsOf } from "@/lib/testing/react-tree";

import { databaseSessionKey, objectNamesKey, treeKey } from "../_lib/database-sessions.service";
import { folderMemoryStore } from "../_lib/folder-memory";
import { inDatabase, navKey, objectNodes, tableTargetOf, type NavNode } from "../_lib/navigator-model";
import { dropDataAtLock } from "../_lib/workbench-lock";
import { selectAllSql } from "../_lib/table-sql";
import { workbenchCopy } from "../_lib/workbench.copy";
import { Navigator, NavigatorList } from "./navigator";
import { NavigatorFilters } from "./navigator-filters";
import { NavigatorSearchStatus } from "./navigator-search-status";

const now = "2026-10-27T12:00:00Z";
const folder = (id: string, name: string): Folder => ({ id, parentID: null, name, environmentName: null, environmentColor: null, color: null, confirmCommands: null, readOnly: false, protections: unprotected, createdAt: now, updatedAt: now });
const connection = (id: string, name: string, extra: Partial<Connection> = {}): Connection => ({
  id,
  folderID: "amb",
  name,
  engine: 1,
  host: "pg.exemplo.invalid",
  port: 5432,
  database: `loja_${name.toLowerCase()}`,
  userName: "prism",
  hasPassword: true,
  environmentName: null,
  environmentColor: null,
  confirmCommands: null,
  readOnly: false,
  ...newVerification,
  protections: unprotected,
  createdAt: now,
  updatedAt: now,
  ...extra,
});

// Ambientes (pasta): Dev, Hml e Prod com as mesmas tabelas; Arquivo (desconectada, com usuário e senha) e Sem senha (desconectada, sem senha gravada).
const base = () => ({
  folders: [folder("amb", "Ambientes")],
  connections: [connection("c1", "Dev"), connection("c2", "Hml"), connection("c3", "Prod"), connection("c4", "Arquivo"), connection("c5", "Sem senha", { hasPassword: false })],
});
const schemaNames = (tables = ["cliente", "pedido", "item_pedido"], views = ["v_cliente"]) => ({ name: "public", isSystem: false, tables, views });
const names = (schemas = [schemaNames()], truncated = false) => ({ schemas, truncated });
const databaseName = (id: string) => `loja_${{ c1: "dev", c2: "hml", c3: "prod", c4: "arquivo", c5: "sem senha" }[id]}`;

/** Conecta pela árvore: a sessão da árvore da conexão está no cache. */
const connectTree = (id: string) => rt.queryClient.setQueryData(databaseSessionKey(id), { id: `s-${id}`, database: databaseName(id) });
/** O índice de um banco já respondido. */
const answer = (id: string, value = names(), database?: string) => rt.queryClient.setQueryData(objectNamesKey(id, database), value);
/** As três conexões de ambiente conectadas e com o índice respondido. */
const threeConnected = () => {
  for (const id of ["c1", "c2", "c3"]) {
    connectTree(id);
    answer(id);
  }
};

const render = () => {
  // O que foi pedido é o da renderização que vale: sem banco no escopo o navegador pede uma lista vazia, que o `useQueries` simulado não vê.
  rt.indexQueries = [];
  return rt.render(() => Navigator({ onNewConnection() {}, onEditConnection() {}, onTransfer() {}, onRevealed() {}, onHide() {}, hideShortcut: "Ctrl+B" }));
};
const tree = () => elementsOf(render());
const list = () => tree().find((element) => element.type === NavigatorList)!.props as unknown as ComponentProps<typeof NavigatorList>;
const filters = () => tree().find((element) => element.type === NavigatorFilters)!.props as unknown as ComponentProps<typeof NavigatorFilters>;
const statusLine = () => tree().find((element) => element.type === NavigatorSearchStatus)?.props as unknown as ComponentProps<typeof NavigatorSearchStatus> | undefined;
const type = (text: string) => {
  filters().onQueryChange(text);
  render();
};
const keys = () => list().rows.map((row) => row.key);
const labels = () => list().rows.map((row) => row.label);
const tableKey = (connectionId: string, name: string, schema = "public", database?: string) => navKey({ type: "table", connectionId, ...inDatabase(database), schema, table: name });
const nodeOf = (key: string): NavNode => list().rows.find((row) => row.key === key)!;
const tablesOf = () => list().rows.filter((row) => row.kind === "table");
const remembered = () => [...folderMemoryStore.get(rt.userName, "connections")];
/** O que o navegador pediu como índice, por conexão e banco, e se está habilitado. */
const asked = () => rt.indexQueries.map((query) => ({ key: JSON.stringify(query.queryKey), enabled: query.enabled }));
const askedKeys = () => rt.indexQueries.map((query) => query.queryKey);
/** O que a linha de estado desenha: os textos (cada um na região viva dele) e os rótulos dos botões. */
function drawn() {
  const props = statusLine();
  if (props === undefined) return null;

  const view = NavigatorSearchStatus(props);
  if (view === null) return null;

  const all = elementsOf(view);
  return { texts: all.filter((element) => element.props.role === "status").map((element) => element.props.children as string), buttons: all.filter((element) => typeof element.props.onClick === "function").map((element) => element.props.children as string) };
}
const failure = (code: string, title: string, detail: string | null = null) => ({ ok: false, error: { status: 422, code, title, detail, errors: null, extensions: {} } });
const apiError = (code: string, title: string, detail: string | null = null) => new ApiRequestError({ status: 422, code, title, detail, errors: null, extensions: {} });
const posts = () => api.request.mock.calls.filter(([, options]) => options?.method === "POST").map(([, options]) => options.body);

let users = 0;
beforeEach(() => {
  vi.clearAllMocks();
  rt.userName = `busca.${++users}`;
  rt.queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rt.fetching = new Set();
  rt.errors = new Map();
  rt.indexQueries = [];
  rt.tabs = [];
  rt.expanded = new Set();
  rt.checks = new Map();
  Object.assign(rt, base());
  let opened = 0;
  api.request.mockReset();
  api.request.mockImplementation((_path: string, options?: { method?: string; body?: { connectionID: string } }) =>
    options?.method === "POST" ? Promise.resolve({ ok: true, data: { id: `sessao-${++opened}`, database: databaseName(options.body?.connectionID ?? "c1") } }) : Promise.resolve({ ok: true, data: [] }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  rt.unmount();
});

describe("o escopo: quais bancos têm o índice pedido, e quando (RN-BUSCA-002)", () => {
  it("com o campo vazio nada é pedido: os observadores existem, mas desabilitados, e a árvore é a de sempre, sem linha de estado", () => {
    threeConnected();
    render();

    expect(asked()).toEqual(["c1", "c2", "c3"].map((id) => ({ key: JSON.stringify(objectNamesKey(id)), enabled: false })));
    expect(list().searching).toBe(false);
    expect(statusLine()).toBeUndefined();
  });

  it("com texto, cada conexão conectada pede o índice do banco dela, habilitado; as desconectadas não são pedidas", () => {
    threeConnected();
    type("cliente");

    expect(asked()).toEqual(["c1", "c2", "c3"].map((id) => ({ key: JSON.stringify(objectNamesKey(id)), enabled: true })));
    expect(posts()).toEqual([]);
  });

  it("o campo só com espaços não é busca: nada habilitado", () => {
    threeConnected();
    type("   ");

    expect(asked().every((query) => query.enabled === false)).toBe(true);
    expect(list().searching).toBe(false);
  });

  it("a conexão conectada só por uma aba entra no escopo, com o banco que a conexão guarda; nada abre o nó nem conecta além da sessão da árvore que a consulta pede", () => {
    rt.tabs = [{ connectionId: "c4", sessionId: "sessao-da-aba" }];
    type("cliente");

    expect(askedKeys()).toEqual([objectNamesKey("c4")]);
    expect(rt.setNodeOpen).not.toHaveBeenCalled();
    // O índice dele ainda vem (a consulta abre a sessão da árvore); as outras quatro ficaram de fora (uma sem senha gravada).
    expect(statusLine()).toMatchObject({ loading: 1, leftOut: 4, withoutCredentials: 1 });
  });

  it("cada outro banco do servidor que já tem sessão da árvore entra, com a marca dele; o banco que ninguém abriu não", () => {
    connectTree("c1");
    rt.queryClient.setQueryData(databaseSessionKey("c1", "arquivo"), { id: "s-arquivo", database: "arquivo" });
    type("cliente");

    expect(askedKeys()).toEqual([objectNamesKey("c1"), objectNamesKey("c1", "arquivo")]);
  });

  it("a sessão de outro banco que abre durante a busca entra no escopo na renderização seguinte (as sessões vêm do cache, sem assinatura)", () => {
    connectTree("c1");
    type("cliente");
    expect(askedKeys()).toEqual([objectNamesKey("c1")]);

    rt.queryClient.setQueryData(databaseSessionKey("c1", "arquivo"), { id: "s-arquivo", database: "arquivo" });
    render();

    expect(askedKeys()).toEqual([objectNamesKey("c1"), objectNamesKey("c1", "arquivo")]);
  });

  it("o seletor de ambiente limita o escopo às conexões que a árvore mostra; trocar de ambiente durante a busca pede o índice das que entram", () => {
    rt.connections = [connection("c1", "Dev", { environmentName: "Dev" }), connection("c2", "Hml", { environmentName: "Homologação" }), connection("c3", "Prod", { environmentName: "Produção" })];
    threeConnected();
    type("cliente");
    expect(askedKeys()).toHaveLength(3);

    const bar = filters();
    bar.onEnvironmentChange({ type: "environment", key: bar.environments.find((environment) => environment.name === "Produção")!.key });
    render();
    expect(askedKeys()).toEqual([objectNamesKey("c3")]);
    expect(tablesOf().map((row) => row.key)).toEqual([tableKey("c3", "cliente")]);

    filters().onEnvironmentChange({ type: "all" });
    render();
    expect(askedKeys()).toHaveLength(3);
    expect(tablesOf()).toHaveLength(3);
  });

  it("'Só as conectadas' ligado: as de fora nem existem na árvore, então não há 'ficaram de fora' nem escopo nelas", () => {
    threeConnected();
    type("cliente");
    expect(statusLine()?.leftOut).toBe(2);

    filters().onToggleConnected();
    render();

    expect(askedKeys()).toHaveLength(3);
    expect(statusLine()).toMatchObject({ leftOut: 0, withoutCredentials: 0 });
    expect(drawn()).toBeNull();
  });

  it("o 'Desconectar' no meio da busca: a conexão sai do escopo e do resultado na mesma renderização, sem pedir índice nem sessão de novo", () => {
    threeConnected();
    type("cliente");
    expect(tablesOf()).toHaveLength(3);
    api.request.mockClear();

    // O que o provedor faz ao desconectar (workbench-state): recolhe, solta as sessões das abas e esquece a família da conexão, tudo no mesmo lote.
    rt.tabs = [];
    rt.queryClient.removeQueries({ queryKey: databaseSessionKey("c2") });
    rt.queryClient.removeQueries({ queryKey: ["tree", "c2"] });
    render();

    expect(askedKeys()).toEqual([objectNamesKey("c1"), objectNamesKey("c3")]);
    expect(tablesOf().map((row) => row.key)).toEqual([tableKey("c1", "cliente"), tableKey("c3", "cliente")]);
    expect(api.request).not.toHaveBeenCalled();
    expect(rt.queryClient.getQueryData(objectNamesKey("c2"))).toBeUndefined();
  });

  it("o bloqueio descarta tudo o que é de banco: o escopo esvazia, o resultado some, e nada é pedido enquanto o cofre está fechado", () => {
    threeConnected();
    type("cliente");
    expect(tablesOf()).toHaveLength(3);

    rt.tabs = [];
    dropDataAtLock(rt.queryClient);
    render();

    expect(rt.indexQueries.filter((query) => query.enabled)).toEqual([]);
    expect(tablesOf()).toEqual([]);
    expect(api.request).not.toHaveBeenCalled();
  });
});

describe("o que aparece: as tabelas e visões de todas as conexões, sem tocar na árvore (RN-BUSCA-001 e RN-BUSCA-002)", () => {
  it("'cliente' acha a tabela nas três conexões, todas recolhidas, cada uma com o caminho dela aberto e a chave da própria conexão", () => {
    threeConnected();
    type("cliente");

    expect(tablesOf().map((row) => row.key)).toEqual([tableKey("c1", "cliente"), tableKey("c2", "cliente"), tableKey("c3", "cliente")]);
    expect(labels().filter((label) => label === "Dev" || label === "Hml" || label === "Prod")).toEqual(["Dev", "Hml", "Prod"]);
    for (const id of ["c1", "c2", "c3"]) {
      for (const key of [navKey({ type: "connection", connectionId: id }), navKey({ type: "database", connectionId: id }), navKey({ type: "schema", connectionId: id, schema: "public" }), navKey({ type: "objects", connectionId: id, schema: "public", objects: "tables" })]) {
        expect(list().open.has(key)).toBe(true);
      }
    }
    expect(list().rows.find((row) => row.label === "loja_dev")?.badge).toBeDefined();
  });

  it("a visão que casa aparece junto, e a tabela que não casa não", () => {
    threeConnected();
    type("v_cli");

    expect(list().rows.filter((row) => row.kind === "view").map((row) => row.label)).toEqual(["v_cliente", "v_cliente", "v_cliente"]);
    expect(tablesOf()).toEqual([]);
  });

  it("sem caixa e sem acento: 'CLIENTE' e uma tabela com acento são achadas", () => {
    threeConnected();
    answer("c1", names([schemaNames(["Cliente", "Observação"])]));
    type("OBSERVACAO");

    expect(tablesOf().map((row) => row.label)).toEqual(["Observação"]);
    type("cliente");
    expect(tablesOf().map((row) => row.label)).toContain("Cliente");
  });

  it("nada entra em `expanded` nem na loja das pastas, e limpar o campo devolve a árvore como estava", () => {
    threeConnected();
    const before = keys();
    const rememberedBefore = remembered();

    type("cliente");
    type("pedido");
    expect(list().searching).toBe(true);
    type("");

    expect(rt.setNodeOpen).not.toHaveBeenCalled();
    expect([...rt.expanded]).toEqual([]);
    expect(remembered()).toEqual(rememberedBefore);
    expect(list().searching).toBe(false);
    expect(keys()).toEqual(before);
    expect(statusLine()).toBeUndefined();
  });

  it("o resultado mantém a identidade enquanto nada muda, e a árvore filtrada não se refaz a cada renderização", () => {
    threeConnected();
    type("cliente");
    const first = list();

    render();
    const second = list();

    expect(second.rows).toBe(first.rows);
    expect(second.matches).toBe(first.matches);
    expect(second.open).toBe(first.open);
  });

  it("a chegada de um índice não move a escolha nem manda reiniciar a rolagem: o texto que reinicia é o mesmo", () => {
    connectTree("c1");
    connectTree("c2");
    answer("c1");
    type("cliente");
    const key = tableKey("c1", "cliente");
    list().onSelect(key);
    render();
    const resetKey = list().scrollResetKey;
    const reveal = list().reveal;

    answer("c2");
    render();

    expect(tablesOf().map((row) => row.key)).toEqual([tableKey("c1", "cliente"), tableKey("c2", "cliente")]);
    expect(list().selectedKey).toBe(key);
    expect(list().scrollResetKey).toBe(resetKey);
    expect(list().reveal).toBe(reveal);
    expect(rt.setNodeOpen).not.toHaveBeenCalled();
  });

  it("a tabela já carregada na árvore e também no índice aparece uma vez só, e o nível carregado vale mais", () => {
    threeConnected();
    // A pessoa abriu o grupo Tabelas de Dev e a árvore o guardou: só 'cliente' e uma tabela que o índice não tem (criada depois do índice).
    rt.queryClient.setQueryData(treeKey({ type: "objects", connectionId: "c1", schema: "public", objects: "tables" }), objectNodes("c1", "public", "tables", [{ name: "cliente", kind: "table" }, { name: "cliente_novo", kind: "table" }]));
    type("cliente");

    expect(list().rows.filter((row) => row.key === tableKey("c1", "cliente"))).toHaveLength(1);
    expect(tablesOf().filter((row) => row.key.includes('"c1"')).map((row) => row.label)).toEqual(["cliente", "cliente_novo"]);
    expect(tablesOf()).toHaveLength(4);
  });

  it("três conexões com a mesma tabela: três linhas, as três com chaves diferentes e o mesmo rótulo", () => {
    threeConnected();
    type("item_pedido");

    expect(tablesOf().map((row) => row.label)).toEqual(["item_pedido", "item_pedido", "item_pedido"]);
    expect(new Set(tablesOf().map((row) => row.key)).size).toBe(3);
  });

  it("a conexão cuja resposta ainda não chegou só casa pelo próprio nome, e quando chega entra", () => {
    threeConnected();
    rt.queryClient.removeQueries({ queryKey: objectNamesKey("c3") });
    type("cliente");
    expect(tablesOf().map((row) => row.key)).toEqual([tableKey("c1", "cliente"), tableKey("c2", "cliente")]);

    answer("c3");
    render();
    expect(tablesOf()).toHaveLength(3);
  });

  it("o índice de outro banco do servidor aparece sob o nó dele, com a marca nas chaves", () => {
    connectTree("c1");
    answer("c1");
    rt.queryClient.setQueryData(databaseSessionKey("c1", "arquivo"), { id: "s-arquivo", database: "arquivo" });
    answer("c1", names([schemaNames(["cliente_2019"], [])]), "arquivo");
    type("cliente");

    expect(tablesOf().map((row) => row.key)).toEqual([tableKey("c1", "cliente"), tableKey("c1", "cliente_2019", "public", "arquivo")]);
  });

  it("o grupo diz quantas casaram do total do índice", () => {
    threeConnected();
    type("pedido");

    const group = list().rows.find((row) => row.kind === "group" && row.key === navKey({ type: "objects", connectionId: "c1", schema: "public", objects: "tables" }));
    expect(group?.detail).toBe("2 de 3");
  });
});

describe("o duplo clique, o Enter, o menu e o 'Gerar SELECT' numa tabela ou visão achada pelo índice", () => {
  beforeEach(() => {
    threeConnected();
    rt.queryClient.setQueryData(databaseSessionKey("c3", "arquivo"), { id: "s-arquivo", database: "arquivo" });
    answer("c3", names([schemaNames(["cliente_2019"], ["v_cliente_2019"])]), "arquivo");
    type("cliente");
  });

  it("a linha de tabela aponta para a tabela (é o que o Enter e o duplo clique usam), e abrir pede a aba dela na conexão certa", () => {
    const row = nodeOf(tableKey("c2", "cliente"));

    expect(tableTargetOf(row)).toEqual({ connectionId: "c2", schema: "public", name: "cliente" });
    list().onOpenTable(row);
    expect(rt.openTableTab).toHaveBeenCalledExactlyOnceWith("c2", { schema: "public", name: "cliente" });
  });

  it("a visão: o alvo vem da chave do pai e do rótulo, e abre", () => {
    const view = list().rows.find((row) => row.kind === "view" && row.key.includes('"c1"'))!;

    expect(tableTargetOf(view)).toEqual({ connectionId: "c1", schema: "public", name: "v_cliente" });
    list().onOpenTable(view);
    expect(rt.openTableTab).toHaveBeenCalledExactlyOnceWith("c1", { schema: "public", name: "v_cliente" });
  });

  it("a tabela de outro banco do servidor abre com o banco dela", () => {
    const row = nodeOf(tableKey("c3", "cliente_2019", "public", "arquivo"));

    list().onOpenTable(row);
    expect(rt.openTableTab).toHaveBeenCalledExactlyOnceWith("c3", { schema: "public", name: "cliente_2019", database: "arquivo" });
  });

  it("o menu da linha tem as ações da tabela, e o 'Gerar SELECT' põe o comando numa consulta nova da conexão dela", () => {
    const row = nodeOf(tableKey("c2", "cliente"));
    expect(list().onContextMenu(row, { x: 4, y: 8 }, "menu")).toBe(true);

    const menu = tree().find((element) => element.type === ContextMenu)!.props as unknown as ComponentProps<typeof ContextMenu>;
    const items = (menu.groups as unknown as ContextMenuItem[][]).flat();
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining(["openRecords", "openStructure", "generateSelect", "exportData", "importData", "copyName"]));

    items.find((item) => item.id === "generateSelect")!.onSelect?.();
    expect(rt.openQueryTab).toHaveBeenCalledExactlyOnceWith("c2", selectAllSql(1, "public", "cliente"), undefined);
  });

  it("o 'Gerar SELECT' numa visão e numa tabela de outro banco: a consulta nova é do banco da linha", () => {
    const view = list().rows.find((row) => row.kind === "view" && row.key.includes('"c1"'))!;
    list().onKeyAction(view, { type: "generateSelect" });
    expect(rt.openQueryTab).toHaveBeenLastCalledWith("c1", selectAllSql(1, "public", "v_cliente"), undefined);

    list().onKeyAction(nodeOf(tableKey("c3", "cliente_2019", "public", "arquivo")), { type: "generateSelect" });
    expect(rt.openQueryTab).toHaveBeenLastCalledWith("c3", selectAllSql(1, "public", "cliente_2019"), "arquivo");
  });

  it("'Abrir registros' e 'Ver estrutura' do menu abrem a aba pela mesma chave, na vista pedida", () => {
    list().onKeyAction(nodeOf(tableKey("c1", "cliente")), { type: "openTable", view: "structure" });
    expect(rt.openTableTab).toHaveBeenLastCalledWith("c1", { schema: "public", name: "cliente", view: "structure" });

    const view = list().rows.find((row) => row.kind === "view" && row.key.includes('"c2"'))!;
    list().onKeyAction(view, { type: "openTable", view: "data" });
    expect(rt.openTableTab).toHaveBeenLastCalledWith("c2", { schema: "public", name: "v_cliente", view: "data" });
  });

  it("abrir a tabela achada não muda os nós abertos: o foco da aba é com a regra das abas, e a árvore não se mexe", () => {
    list().onOpenTable(nodeOf(tableKey("c1", "cliente")));

    expect(rt.setNodeOpen).not.toHaveBeenCalled();
    expect([...rt.expanded]).toEqual([]);
  });
});

describe("a linha de estado da busca (RN-BUSCA-002)", () => {
  it("fica logo abaixo da barra de filtros, antes da lista, nunca ao lado do campo", () => {
    threeConnected();
    rt.fetching.add(JSON.stringify(objectNamesKey("c1")));
    rt.queryClient.removeQueries({ queryKey: objectNamesKey("c1") });
    type("cliente");

    const order = tree().map((element) => element.type);
    const filtersAt = order.indexOf(NavigatorFilters);
    expect(order.indexOf(NavigatorSearchStatus)).toBeGreaterThan(filtersAt);
    expect(order.indexOf(NavigatorSearchStatus)).toBeLessThan(order.indexOf(NavigatorList));
    expect(tree().filter((element) => element.type === NavigatorSearchStatus)).toHaveLength(1);
  });

  it("sem nada a dizer (tudo conectado, tudo respondido) não desenha nada", () => {
    threeConnected();
    rt.checks = new Map();
    // As duas desconectadas saem do caminho com 'Só as conectadas'.
    filters().onToggleConnected();
    type("cliente");

    expect(drawn()).toBeNull();
  });

  it("carregando: 'Buscando nas tabelas e visões de 2 bancos…' enquanto dois índices não chegaram, e some quando chegam", () => {
    threeConnected();
    rt.queryClient.removeQueries({ queryKey: objectNamesKey("c1") });
    rt.queryClient.removeQueries({ queryKey: objectNamesKey("c2") });
    filters().onToggleConnected();
    type("cliente");

    expect(drawn()?.texts).toEqual(["Buscando nas tabelas e visões de 2 bancos…"]);

    answer("c1");
    render();
    expect(drawn()?.texts).toEqual(["Buscando nas tabelas e visões de 1 banco…"]);

    answer("c2");
    render();
    expect(drawn()).toBeNull();
  });

  it("sem nada achado: 'Nada encontrado' e a explicação, mas só quando nenhum índice está a caminho (antes disso a linha de estado diz 'Buscando…' sozinha)", () => {
    threeConnected();
    rt.queryClient.removeQueries({ queryKey: objectNamesKey("c3") });
    rt.fetching.add(JSON.stringify(objectNamesKey("c3")));
    filters().onToggleConnected();
    type("zzz");
    const nothingFound = () => tree().some((element) => element.props.children === workbenchCopy.navigator.search.nothingFound("zzz"));

    expect(list().rows).toEqual([]);
    expect(nothingFound()).toBe(false);
    expect(drawn()?.texts).toEqual(["Buscando nas tabelas e visões de 1 banco…"]);

    rt.fetching.clear();
    answer("c3");
    render();
    expect(nothingFound()).toBe(true);
    expect(tree().some((element) => element.props.children === workbenchCopy.navigator.search.onlyLoaded)).toBe(true);
  });

  it("o navegador dá à barra o `ref` do botão do seletor de ambiente, à parte do do campo: o 'Limpar o filtro de ambiente' leva o foco a ele", () => {
    threeConnected();

    expect(filters().environmentRef).toEqual({ current: null });
    expect(filters().environmentRef).not.toBe(filters().inputRef);
  });

  it("sem nada achado e com um banco que falhou: só a falha, sem o 'Nada encontrado' (o banco que falhou pode ter o nome); o 'Nada encontrado' volta quando a busca termina sem falha", () => {
    threeConnected();
    rt.queryClient.removeQueries({ queryKey: objectNamesKey("c2") });
    rt.errors.set(JSON.stringify(objectNamesKey("c2")), apiError("SQL_EXECUTION_FAILED", "Falha ao executar o comando.", "Name or service not known"));
    filters().onToggleConnected();
    type("zzz");
    const nothingFound = () => tree().some((element) => element.props.children === workbenchCopy.navigator.search.nothingFound("zzz"));
    const onlyLoaded = () => tree().some((element) => element.props.children === workbenchCopy.navigator.search.onlyLoaded);

    expect(list().rows).toEqual([]);
    expect(drawn()?.texts).toEqual(["Não foi possível buscar em Hml › loja_hml: Name or service not known"]);
    expect(nothingFound()).toBe(false);
    expect(onlyLoaded()).toBe(false);

    rt.errors.clear();
    answer("c2");
    render();
    expect(drawn()).toBeNull();
    expect(nothingFound()).toBe(true);
    expect(onlyLoaded()).toBe(true);
  });

  it("o corte: com mais de 200 achados num banco, a linha explica, e o leitor de tela ouve a conta 'N resultados, 200 à vista'", () => {
    connectTree("c1");
    answer("c1", names([{ name: "public", isSystem: false, tables: Array.from({ length: 300 }, (_, index) => `tab_${index}`), views: [] }]));
    filters().onToggleConnected();
    type("tab_");

    expect(drawn()?.texts).toEqual(["Muitos resultados: cada banco mostra as 200 primeiras tabelas e visões. Escreva mais do nome para ver as outras."]);
    expect(tablesOf()).toHaveLength(200);
    const announced = tree().find((element) => element.props.role === "status" && element.props.className === "sr-only");
    expect(announced?.props.children).toBe("300 resultados, 200 à vista");
  });

  it("cortado na API: o banco que veio com 'truncated' é citado com o nome 'Conexão › banco'", () => {
    threeConnected();
    answer("c3", names([schemaNames()], true));
    filters().onToggleConnected();
    type("cliente");

    expect(drawn()?.texts).toEqual(["Prod › loja_prod tem mais de 50.000 tabelas e visões: a busca olhou as 50.000 primeiras e o que já está aberto na árvore."]);
  });

  it("a falha de um banco mostra a mensagem do banco como veio, sem derrubar a busca nos outros; o 'Tentar de novo' pede o índice dele de novo", async () => {
    threeConnected();
    rt.queryClient.removeQueries({ queryKey: objectNamesKey("c2") });
    rt.errors.set(JSON.stringify(objectNamesKey("c2")), apiError("SQL_EXECUTION_FAILED", "Falha ao executar o comando.", 'permission denied for table "pg_class"'));
    const refetch = vi.spyOn(rt.queryClient, "refetchQueries").mockResolvedValue();
    filters().onToggleConnected();
    type("cliente");

    expect(drawn()?.texts).toEqual(['Não foi possível buscar em Hml › loja_hml: permission denied for table "pg_class"']);
    expect(drawn()?.buttons).toEqual(["Tentar de novo"]);
    expect(tablesOf().map((row) => row.key)).toEqual([tableKey("c1", "cliente"), tableKey("c3", "cliente")]);

    statusLine()!.failures[0].onRetry();
    expect(refetch).toHaveBeenCalledExactlyOnceWith({ queryKey: objectNamesKey("c2"), exact: true });
  });

  it("a falha por sessão que caiu: o 'Tentar de novo' abre outra sessão para aquele banco, como a árvore (e não repete com o id morto)", async () => {
    threeConnected();
    rt.queryClient.removeQueries({ queryKey: objectNamesKey("c3") });
    rt.errors.set(JSON.stringify(objectNamesKey("c3")), apiError("DATABASE_SESSION_NOT_FOUND", "Sessão não encontrada."));
    const refetch = vi.spyOn(rt.queryClient, "refetchQueries").mockResolvedValue();
    const reset = vi.spyOn(rt.queryClient, "resetQueries").mockResolvedValue();
    filters().onToggleConnected();
    type("cliente");

    statusLine()!.failures[0].onRetry();

    expect(reset).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledWith({ queryKey: databaseSessionKey("c3"), exact: true });
    expect(refetch).not.toHaveBeenCalled();
    // A sessão nova abriu: o aviso de atenção da árvore (RN-AVISO-003).
    await vi.waitFor(() => expect(rt.warnings).toHaveBeenCalledWith(workbenchCopy.toasts.sessionReopened));
  });

  it("a falha de um banco de outro servidor: o nome cita o banco, e o 'Tentar de novo' leva a marca dele", () => {
    connectTree("c1");
    rt.queryClient.setQueryData(databaseSessionKey("c1", "arquivo"), { id: "s-arquivo", database: "arquivo" });
    answer("c1");
    rt.errors.set(JSON.stringify(objectNamesKey("c1", "arquivo")), apiError("SQL_EXECUTION_FAILED", "x", "timeout"));
    const refetch = vi.spyOn(rt.queryClient, "refetchQueries").mockResolvedValue();
    filters().onToggleConnected();
    type("cliente");

    expect(drawn()?.texts).toEqual(["Não foi possível buscar em Dev › arquivo: timeout"]);
    statusLine()!.failures[0].onRetry();
    expect(refetch).toHaveBeenCalledExactlyOnceWith({ queryKey: objectNamesKey("c1", "arquivo"), exact: true });
  });

  it("de fora: quantas conexões não estão conectadas, quantas o botão pula por falta de usuário ou senha, e o botão 'Buscar nelas também'", () => {
    threeConnected();
    type("cliente");

    expect(drawn()).toEqual({
      texts: ["2 conexões não estão conectadas e ficaram de fora da busca. 1 sem usuário ou senha gravada ficou de fora."],
      buttons: ["Buscar nelas também"],
    });
  });

  it("só as sem credencial ficaram de fora: a frase diz, e não há botão (não há o que abrir)", () => {
    threeConnected();
    connectTree("c4");
    answer("c4");
    type("cliente");

    expect(drawn()).toEqual({ texts: ["1 conexão não está conectada e ficou de fora da busca. 1 sem usuário ou senha gravada ficou de fora."], buttons: [] });
  });

  it("a conexão que está conectando não é de fora: conta como 'buscando', e quando conecta entra no escopo", () => {
    threeConnected();
    rt.fetching.add(JSON.stringify(databaseSessionKey("c4")));
    type("cliente");

    expect(drawn()?.texts).toEqual([
      "Buscando nas tabelas e visões de 1 banco…",
      "1 conexão não está conectada e ficou de fora da busca. 1 sem usuário ou senha gravada ficou de fora.",
    ]);
    expect(statusLine()).toMatchObject({ loading: 1, leftOut: 1, withoutCredentials: 1 });
    expect(drawn()?.buttons).toEqual([]);
  });
});

describe("'Buscar nelas também': abre a sessão da árvore de cada conexão de fora, sem abrir o nó (RN-BUSCA-002)", () => {
  it("abre só as que têm usuário e senha gravados, pula a sem senha, não toca nas já conectadas e deixa todos os nós fechados", async () => {
    threeConnected();
    type("cliente");
    const input = { focus: vi.fn(), select: vi.fn() };
    (filters().inputRef as { current: unknown }).current = input;

    statusLine()!.onSearchThem();
    await vi.waitFor(() => expect(rt.queryClient.getQueryData(databaseSessionKey("c4"))).toBeDefined());

    expect(posts()).toEqual([{ connectionID: "c4" }]);
    expect(rt.setNodeOpen).not.toHaveBeenCalled();
    expect([...rt.expanded]).toEqual([]);
    expect(remembered()).toEqual([]);
    expect(rt.queryClient.getQueryData(databaseSessionKey("c4"))).toBeDefined();
    expect(rt.queryClient.getQueryData(databaseSessionKey("c5"))).toBeUndefined();
    // O botão sai da tela quando a sessão abre; o foco que estava nele vai ao campo da busca.
    expect(input.focus).toHaveBeenCalled();
  });

  it("depois de aberta, a conexão entra no escopo e o índice dela é pedido; o que falta de fora é só a sem senha, sem botão", async () => {
    threeConnected();
    type("cliente");
    statusLine()!.onSearchThem();
    await vi.waitFor(() => expect(rt.queryClient.getQueryData(databaseSessionKey("c4"))).toBeDefined());
    render();

    expect(askedKeys()).toEqual([objectNamesKey("c1"), objectNamesKey("c2"), objectNamesKey("c3"), objectNamesKey("c4")]);
    expect(rt.indexQueries.every((query) => query.enabled === true)).toBe(true);
    expect(drawn()?.texts).toContain("Buscando nas tabelas e visões de 1 banco…");
    expect(statusLine()).toMatchObject({ leftOut: 1, withoutCredentials: 1 });
    expect(drawn()?.buttons).toEqual([]);
  });

  it("a conexão que não abre diz a mensagem do banco na linha de estado, com o 'Tentar de novo'; o nó continua fechado e a busca segue nas outras", async () => {
    threeConnected();
    api.request.mockImplementation(() => Promise.resolve(failure("DATABASE_CONNECTION_FAILED", "Não foi possível conectar.", "FATAL: password authentication failed for user \"prism\"")));
    type("cliente");

    statusLine()!.onSearchThem();
    await vi.waitFor(() => expect(rt.queryClient.getQueryState(databaseSessionKey("c4"))?.status).toBe("error"));
    render();

    expect(drawn()?.texts).toEqual([
      'Não foi possível buscar em Arquivo: FATAL: password authentication failed for user "prism"',
      "2 conexões não estão conectadas e ficaram de fora da busca. 1 sem usuário ou senha gravada ficou de fora.",
    ]);
    expect(drawn()?.buttons).toEqual(["Tentar de novo", "Buscar nelas também"]);
    expect(list().open.has(navKey({ type: "connection", connectionId: "c4" }))).toBe(false);
    expect(rt.setNodeOpen).not.toHaveBeenCalled();
    expect(tablesOf()).toHaveLength(3);
  });

  it("o 'Tentar de novo' dessa falha abre a sessão de novo", async () => {
    threeConnected();
    api.request.mockImplementationOnce(() => Promise.resolve(failure("DATABASE_CONNECTION_FAILED", "Não foi possível conectar.", "connection refused")));
    type("cliente");
    statusLine()!.onSearchThem();
    await vi.waitFor(() => expect(rt.queryClient.getQueryState(databaseSessionKey("c4"))?.status).toBe("error"));
    render();

    statusLine()!.failures[0].onRetry();
    await vi.waitFor(() => expect(rt.queryClient.getQueryState(databaseSessionKey("c4"))?.status).toBe("success"));

    expect(posts()).toEqual([{ connectionID: "c4" }, { connectionID: "c4" }]);
  });

  it("a recusa por faltar usuário ou senha não vira linha de falha: quem trata é o 'Editar conexão'", () => {
    threeConnected();
    rt.queryClient.setQueryData(databaseSessionKey("c4"), undefined);
    rt.errors.set(JSON.stringify(databaseSessionKey("c4")), new ApiRequestError({ status: 422, code: "CONNECTION_CREDENTIALS_MISSING", title: "Falta a senha.", detail: null, errors: { password: ["Informe a senha."] }, extensions: {} }));
    type("cliente");

    expect(statusLine()!.failures).toEqual([]);
  });

  it("a conexão que a verificação achou sem sessão na API fica de fora, e o botão abre uma sessão nova no lugar da morta", async () => {
    threeConnected();
    rt.checks = new Map([["c3", { kind: "notConnected" }]]);
    type("cliente");

    expect(askedKeys()).toEqual([objectNamesKey("c1"), objectNamesKey("c2")]);
    // O índice que ela deixou no cache não conta: a conexão de fora não é buscada.
    expect(tablesOf().map((row) => row.key)).toEqual([tableKey("c1", "cliente"), tableKey("c2", "cliente")]);
    expect(statusLine()).toMatchObject({ leftOut: 3, withoutCredentials: 1 });

    statusLine()!.onSearchThem();
    await vi.waitFor(() => expect(rt.queryClient.getQueryData(databaseSessionKey("c3"))).toMatchObject({ id: expect.stringMatching(/^sessao-/) }));
    await vi.waitFor(() => expect(rt.queryClient.getQueryData(databaseSessionKey("c4"))).toBeDefined());
    expect(posts()).toHaveLength(2);
    expect(posts()).toEqual(expect.arrayContaining([{ connectionID: "c3" }, { connectionID: "c4" }]));
  });
});
