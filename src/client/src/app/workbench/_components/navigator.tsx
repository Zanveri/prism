import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { DeleteConnectionDialog } from "@/app/connections/_components/delete-connection-dialog";
import { MoveConnectionDialog } from "@/app/connections/_components/move-connection-dialog";
import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { Button, ColumnsIcon, ContextMenu, DiagramIcon, DocumentIcon, FolderMoveIcon, FolderPlusIcon, FormMessage, PencilIcon, PlugIcon, PlusIcon, PowerIcon, RefreshIcon, TableIcon, TrashIcon, useToast, type ContextMenuItem } from "@/components/ui";
import { ApiRequestError } from "@/lib/api/prism-api";

import { connectionReveal } from "../_lib/connection-intent";
import { databaseOfKey, databaseSessionKey, databaseSessionQuery, errorCodeOf, errorDriverIdOf, isSessionLost, reopenDatabaseSession, treeKey, treePrefixes, treeQuery, type FetchedPath } from "../_lib/database-sessions.service";
import { backgroundMenu, ignoresContextMenu, menuFor, type MenuAction } from "../_lib/navigator-menu";
import { childrenKey, databaseRefOf, flattenVisible, inDatabase, isFocusable, navKey, ownerConnectionId, parseNavKey, schemaGroupNodes, tabbableKey, tableGroupNodes, tableTargetOf, treeNodes, type LevelState, type NavNode, type NavPath } from "../_lib/navigator-model";
import { rememberedTreeScroll } from "../_lib/navigator-layout";
import { revealOf } from "../_lib/navigator-reveal";
import { cachedTree, loadedLevels, searchTree, type MatchRange } from "../_lib/navigator-search";
import { selectionConnectionId, targetFolderId, toolbarFor, type ToolbarActionId } from "../_lib/navigator-toolbar";
import { measureRendered, observeRenderedOffset } from "../_lib/row-measure";
import { selectAllSql } from "../_lib/table-sql";
import { useWorkbenchOnScreen } from "../_lib/use-workbench-on-screen";
import { isConnected } from "../_lib/workbench-model";
import { useWorkbench } from "../_lib/workbench-state";
import { navigatorCopy } from "../_lib/navigator.copy";
import { workbenchCopy } from "../_lib/workbench.copy";
import { FolderActionDialogs, type FolderAction } from "./folder-action-dialogs";
import { NavigatorSearchField } from "./navigator-search-field";
import { NavigatorRow, rowHeight, type ConnectionStatus } from "./navigator-row";
import { NavigatorToolbar } from "./navigator-toolbar";

const copy = workbenchCopy.navigator;

/** A mensagem do banco quando há (o `detail` da API), senão a frase da API. Sempre texto (RN-SHELL-002). */
function messageOf(error: unknown): string {
  if (error instanceof ApiRequestError) return error.error.detail ?? error.error.title;
  return error instanceof Error ? error.message : String(error);
}

/** O nível de uma consulta: carregado, falho (e sem tentar de novo), ou ainda a caminho (`undefined`). */
function levelOf<T>(result: UseQueryResult<T>, children: (data: T) => NavNode[]): LevelState | undefined {
  if (result.isError && !result.isFetching) return { status: "error", message: messageOf(result.error), code: errorCodeOf(result.error), driverID: errorDriverIdOf(result.error) };
  return result.data === undefined ? undefined : { status: "loaded", children: children(result.data) };
}

/** O ponto de estado da conexão. `connected` é a definição única (`isConnected`): a sessão da árvore ou a de uma aba. */
function statusOf(treeSession: UseQueryResult, connected: boolean): ConnectionStatus {
  if (treeSession.isFetching && treeSession.data === undefined) return "connecting";
  if (connected) return "connected";
  return treeSession.isError ? "failed" : "disconnected";
}

const isFetched = (path: NavPath): path is FetchedPath => path.type === "connection" || path.type === "database" || path.type === "objects" || path.type === "tableLevel";

const noKeys: ReadonlySet<string> = new Set();

/** O ícone de cada item do menu, onde o app já tem o desenho. "Copiar" não tem, e os rótulos alinham do mesmo jeito. */
const menuIcons: Readonly<Record<string, ReactNode>> = {
  connect: <PlugIcon />,
  disconnect: <PowerIcon />,
  newQuery: <DocumentIcon />,
  refresh: <RefreshIcon />,
  editConnection: <PencilIcon />,
  moveConnection: <FolderMoveIcon />,
  deleteConnection: <TrashIcon />,
  newConnection: <PlusIcon />,
  openRecords: <TableIcon />,
  openStructure: <ColumnsIcon />,
  openDiagram: <DiagramIcon />,
  generateSelect: <DocumentIcon />,
  newFolder: <FolderPlusIcon />,
  renameFolder: <PencilIcon />,
  moveFolder: <FolderMoveIcon />,
  deleteFolder: <TrashIcon />,
};

/** A ação do menu sobre uma pasta que existe e o modo do diálogo que a atende ("Nova subpasta" cria: não é sobre a pasta, é dentro dela). */
const folderActionTypes = { renameFolder: "rename", moveFolder: "move", deleteFolder: "delete" } as const;

/** A ação de conexão que o menu pediu (RN-NAV-003): mover de pasta ou excluir, cada uma com o diálogo dela. */
type ConnectionAction = { type: "move" | "delete"; connection: Connection };

type NavigatorProps = {
  /** "Nova conexão" (RN-NAV-002 e 003): na pasta dada, ou na raiz (`null`). */
  onNewConnection: (folderID: string | null) => void;
  /** "Editar conexão" (RN-MENU-001): o diálogo de edição, ali mesmo. */
  onEditConnection: (connectionId: string) => void;
  onRevealed?: () => void;
  /** O botão de esconder da barra de ações (RN-NAV-008): quem esconde é a página, que também cuida do foco. */
  onHide: () => void;
  /** O atalho de esconder e mostrar, para a dica do botão (Ctrl+B, ou Cmd+B no macOS). */
  hideShortcut: string;
};

/** O menu aberto: a linha, onde ele abre e onde o foco nasce (`first` quando veio do teclado). */
type OpenMenu = { /** A linha, ou `null` para o espaço vazio do navegador. */ node: NavNode | null; point: { x: number; y: number }; initialFocus: "first" | "menu" };

/** A pasta de uma linha de pasta (`NavPath` `folder`). */
function folderIdOf(node: NavNode): string | null {
  const path = parseNavKey(node.key);
  return path.type === "folder" ? path.id : null;
}

/**
 * O navegador de bancos (RN-ARVORE-001 a 006): pastas e conexões salvas e, abaixo de cada conexão
 * aberta, os bancos do servidor, os esquemas, as listas e as colunas, índices e chaves estrangeiras de uma tabela.
 *
 * Quem busca os níveis é este componente, de uma vez só (`useQueries`), a partir das chaves dos nós
 * abertos: a lista é virtualizada, e uma linha fora da janela não existe para buscar nada. Cada
 * nível fica guardado até o "Atualizar" daquele nó (RN-ARVORE-002). A sessão com o banco da conexão é
 * aberta pelo nó da conexão (RN-SESSAO-001), e a lista dos bancos do servidor vem por ela; outro banco
 * abre a sessão dele quando o nó dele abre, e o que está abaixo dele usa essa sessão (RN-ARVORE-006).
 *
 * Tudo o que a tela de Conexões fazia mora aqui (RN-NAV-003): criar, renomear, mover e excluir pasta; criar, editar, mover e excluir
 * conexão, pela barra de ações e pelo menu de contexto. O formulário de conexão é uma página à parte (RN-NAV-004), e a conexão que ele
 * acabou de salvar aparece aqui à vista e escolhida (`connectionReveal`); `onRevealed` avisa quem mostra o navegador, para ele aparecer se
 * estava escondido. O formulário é um diálogo sobre a área de trabalho (RN-NAV-004), e quem o abre é a página: o navegador só pede
 * (`onNewConnection`, na pasta onde a conexão nasce; `onEditConnection`).
 */
export function Navigator({ onNewConnection, onEditConnection, onRevealed, onHide, hideShortcut }: NavigatorProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const folders = useQuery(foldersQuery);
  const connections = useQuery(connectionsQuery);
  const { tabs, expanded, setNodeOpen, openQueryTab, openTableTab, disconnect, disconnecting } = useWorkbench();
  // As pastas começam abertas; só as recolhidas são estado. Ao ir para Conexões e voltar, elas reabrem.
  const [collapsedFolders, setCollapsedFolders] = useState<ReadonlySet<string>>(new Set());
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null);
  const [connectionAction, setConnectionAction] = useState<ConnectionAction | null>(null);
  // O item escolhido na árvore. Mora aqui, e não na lista, porque a barra de ações age sobre ele (RN-NAV-002).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A busca (RN-BUSCA-001): o texto, e o que a pessoa recolheu na tela filtrada, que vale só para aquele texto. Nada disto toca nos nós abertos.
  const [query, setQuery] = useState("");
  const [searchCollapsed, setSearchCollapsed] = useState<{ query: string; keys: ReadonlySet<string> }>({ query: "", keys: noKeys });
  const searchInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);
  // O filtro roda sobre o texto adiado: a digitação não espera a lista de milhares de linhas.
  const searchText = useDeferredValue(query);
  // A conexão que o formulário acabou de salvar (RN-NAV-004), e a última que esta árvore já mostrou (o número do pedido).
  const onScreen = useWorkbenchOnScreen();
  const revealRequest = useSyncExternalStore(connectionReveal.subscribe, connectionReveal.pending, connectionReveal.pending);
  const [reveal, setReveal] = useState<{ key: string; seq: number } | null>(null);

  const connectionList = useMemo(() => connections.data ?? [], [connections.data]);
  const tree = useMemo(() => treeNodes(buildConnectionTree(folders.data ?? [], connectionList)), [folders.data, connectionList]);
  const connectionById = useMemo(() => new Map(connectionList.map((connection) => [connection.id, connection])), [connectionList]);

  const open = new Set([...expanded, ...tree.folderKeys.filter((key) => !collapsedFolders.has(key))]);

  // Um observador por conexão: o ponto de estado mostra a sessão mesmo com o nó recolhido, e só um nó aberto a abre.
  const sessions = useQueries({ queries: connectionList.map((connection) => ({ ...databaseSessionQuery(connection.id), enabled: expanded.has(navKey({ type: "connection", connectionId: connection.id })) })) });
  const sessionById = new Map(connectionList.map((connection, index) => [connection.id, sessions[index]]));
  const statuses = new Map(connectionList.map((connection, index) => [connection.id, statusOf(sessions[index], isConnected(connection.id, tabs, sessions[index].isSuccess))]));

  const paths = [...expanded].map(parseNavKey);
  const fetchedPaths = paths.filter(isFetched);
  // Tudo espera a sessão da conexão: sem ela não há lista dos bancos, e a conexão não está de pé para abrir a de outro banco.
  const fetched = useQueries({ queries: fetchedPaths.map((path) => treeQuery(path, queryClient, sessionById.get(path.connectionId)?.isSuccess === true)) });

  const levels = new Map(tree.levels);
  for (const path of paths) {
    const key = navKey(path);
    const set = (state: LevelState | undefined) => state && levels.set(childrenKey({ key }), state);

    if (path.type === "schema") {
      set({ status: "loaded", children: schemaGroupNodes(path.connectionId, path.schema, path.database) });
    } else if (path.type === "table") {
      set({ status: "loaded", children: tableGroupNodes(path.connectionId, path.schema, path.table, path.database) });
    }
  }
  fetchedPaths.forEach((path, index) => {
    // A conexão cuja sessão não abriu mostra no próprio nó a falha dela, com "Tentar de novo" (RN-ARVORE-005); aberta, mostra a lista dos bancos.
    const session = path.type === "connection" ? sessionById.get(path.connectionId) : undefined;
    const state = session?.isError ? levelOf(session, () => []) : levelOf(fetched[index], (nodes) => nodes);
    if (state) levels.set(childrenKey({ key: navKey(path) }), state);
  });

  const searching = searchText.trim() !== "";
  // A busca olha o que o cache da árvore já guarda, aberto ou não, e nunca abre nó nem busca nível: só lê (`cachedTree`). O que ela precisa do cache é tudo o
  // que há de carregado (os níveis dos nós abertos são consultas dele), então o ponto de partida são só as pastas e as conexões (`tree.levels`). O filtro só
  // se refaz quando muda o texto, o que a pessoa recolheu, a árvore ou o cache (`cachedTree` devolve o mesmo objeto enquanto nada dele mudou).
  const cache = searching ? cachedTree(queryClient) : null;
  const collapsedKeys = searchCollapsed.query === searchText ? searchCollapsed.keys : noKeys;
  const search = useMemo(() => (cache === null ? null : searchTree(tree.roots, loadedLevels(tree.levels, cache.cached), searchText, collapsedKeys)), [cache, tree, searchText, collapsedKeys]);
  const rows = search === null ? flattenVisible(tree.roots, open, levels) : search.rows;

  // Salvar no formulário volta à área de trabalho com a conexão à vista e escolhida (RN-NAV-004): com a área de trabalho de novo na tela e a
  // conexão já na lista, as pastas acima dela abrem, a linha é escolhida, uma busca que a escondia é limpa, e a lista a traz à vista e lhe dá o
  // foco. Ajuste durante a renderização (como no provedor), uma vez por pedido; levar o pedido embora e avisar quem mostra o navegador são efeitos.
  const revealTarget = revealRequest === null || revealRequest.seq === reveal?.seq || !onScreen ? undefined : connectionById.get(revealRequest.connectionId);
  if (revealRequest !== null && revealTarget !== undefined) {
    const plan = revealOf(revealTarget, folders.data ?? []);
    setReveal({ key: plan.key, seq: revealRequest.seq });
    setSelectedKey(plan.key);
    setCollapsedFolders((current) => new Set([...current].filter((key) => !plan.folderKeys.includes(key))));
    if (search !== null && !search.rows.some((row) => row.key === plan.key)) setQuery("");
  }

  const announcedReveal = useRef(0);
  useEffect(() => {
    if (reveal === null || announcedReveal.current === reveal.seq) return;
    announcedReveal.current = reveal.seq;
    connectionReveal.take(reveal.seq);
    onRevealed?.();
  }, [reveal, onRevealed]);

  // O navegador desmonta quando o cofre fecha (ele fica montado enquanto o cofre está aberto): um pedido que ficou não passa ao usuário seguinte.
  useEffect(() => () => connectionReveal.clear(), []);

  function toggle(node: NavNode) {
    if (node.kind === "folder") {
      setCollapsedFolders((current) => new Set(current.has(node.key) ? [...current].filter((key) => key !== node.key) : [...current, node.key]));
      return;
    }

    const opening = !open.has(node.key);
    setNodeOpen(node.key, opening);
    // O banco da conexão abre junto com ela: é o que a conexão diz que se quer ver, e os outros bancos do servidor ficam fechados ao lado dele.
    const path = parseNavKey(node.key);
    if (opening && path.type === "connection") setNodeOpen(navKey({ type: "database", connectionId: path.connectionId }), true);
  }

  /** "Conectar" (do menu e da barra de ações) é abrir o nó da conexão: a sessão abre junto. Com o nó já aberto e sem sessão, a conexão falhou: busca de novo. */
  function connect(connectionId: string) {
    const key = navKey({ type: "connection", connectionId });

    if (expanded.has(key)) {
      void queryClient.refetchQueries({ queryKey: databaseSessionKey(connectionId), exact: true });
      return;
    }

    setNodeOpen(key, true);
    setNodeOpen(navKey({ type: "database", connectionId }), true);
  }

  /** A pasta fica aberta: o que acaba de ser criado dentro dela tem de aparecer (como a tela de Conexões fazia). */
  const expandFolder = (folderId: string) => setCollapsedFolders((current) => new Set([...current].filter((key) => key !== navKey({ type: "folder", id: folderId }))));

  /** A sessão caiu e a API já não a conhece: abre outra para aquele banco da conexão, no lugar de repetir com o id morto (RN-AVISO-003). */
  async function reopen(connectionId: string, database: string | undefined) {
    if (await reopenDatabaseSession(queryClient, connectionId, database)) toast.warning(workbenchCopy.toasts.sessionReopened);
  }

  /** Os bancos cujas sessões caíram, pelos níveis guardados sob estes prefixos que responderam "sessão não encontrada". */
  const lostSessionsUnder = (prefixes: readonly (readonly unknown[])[]) =>
    new Set(prefixes.flatMap((queryKey) => queryClient.getQueryCache().findAll({ queryKey }).filter((query) => isSessionLost(query.state.error)).map((query) => databaseOfKey(query.queryKey))));

  /** Busca de novo o nível que falhou, sem esperar o nó fechar e abrir. */
  function retry(node: NavNode) {
    const path = parseNavKey(node.retryKey ?? node.key);
    if (!isFetched(path)) return;

    const lost = lostSessionsUnder([treeKey(path)]);
    if (path.type === "connection" && sessionById.get(path.connectionId)?.isError) void queryClient.refetchQueries({ queryKey: databaseSessionKey(path.connectionId), exact: true });
    else if (lost.size > 0) for (const database of lost) void reopen(path.connectionId, database);
    else void queryClient.refetchQueries({ queryKey: treeKey(path), exact: true });
  }

  /** "Atualizar": o que está abaixo do nó, nunca a sessão (`treePrefixes`) — salvo a que caiu, que se abre de novo. Na conexão, a lista dos bancos vem de novo. */
  function refresh(node: NavNode) {
    const path = parseNavKey(node.key);
    const prefixes = treePrefixes(path);
    if (prefixes.length === 0 || path.type === "folder") return;

    // O banco cuja sessão caiu abre outra (e os níveis dele recomeçam com ela); o resto do que está abaixo do nó busca de novo.
    const lost = lostSessionsUnder(prefixes);
    for (const database of lost) void reopen(path.connectionId, database);
    for (const queryKey of prefixes) void queryClient.invalidateQueries({ queryKey, predicate: (query) => !lost.has(databaseOfKey(query.queryKey)) });
  }

  /** Na tela filtrada, abrir e fechar é só do que se vê: recolher um ancestral não mexe nos nós abertos da árvore (`expanded`). */
  function toggleInSearch(node: NavNode) {
    setSearchCollapsed((current) => {
      const keys = new Set(current.query === searchText ? current.keys : noKeys);
      if (!keys.delete(node.key)) keys.add(node.key);
      return { query: searchText, keys };
    });
  }

  /** Ctrl+F com o foco no navegador vai ao campo de busca (e seleciona o que já estava escrito). */
  function handleShortcut(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchInput.current?.focus();
      searchInput.current?.select();
    }
  }

  /** O foco vai à linha que o Tab alcança na lista (ou, se é uma linha de erro, ao botão dela: o botão da linha de erro não tem `tabindex`). */
  function focusList() {
    const target = area.current?.querySelector<HTMLElement>('[data-row-toggle][tabindex="0"]') ?? area.current?.querySelector<HTMLElement>('[data-row-toggle]:not([tabindex="-1"])');
    target?.focus();
  }

  /** O que o menu precisa saber da conexão da linha; as demais linhas não usam o estado. */
  function menuStateOf(node: NavNode) {
    const connectionId = node.kind === "connection" ? ownerConnectionId(node) : null;
    return { status: (connectionId === null ? undefined : statuses.get(connectionId)) ?? "disconnected", busy: connectionId !== null && disconnecting === connectionId } as const;
  }

  /**
   * O botão direito no espaço vazio do navegador (RN-NAV-003): o menu com "Nova conexão" e "Nova pasta", na raiz. A linha trata o dela antes
   * (e marca o evento como tratado); a barra de ações e o campo de busca ficam com o seu.
   */
  function handleBackgroundMenu(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as Element;
    // O que está aberto por portal (o próprio menu, um diálogo) sobe pela árvore do React até aqui, mas não está dentro do navegador.
    if (event.defaultPrevented || !event.currentTarget.contains(target) || target.closest('[role="treeitem"], [role="toolbar"], input') !== null) return;

    event.preventDefault();
    openMenu(null, { x: event.clientX, y: event.clientY }, "menu");
  }

  /** Os itens do menu: os da linha, ou os do espaço vazio do navegador (`null`). */
  const menuGroupsOf = (node: NavNode | null) => (node === null ? backgroundMenu() : menuFor(node, menuStateOf(node)));

  /** Abre o menu da linha (RN-MENU-001), ou o do espaço vazio (`null`); a linha sem itens (Carregando…, erro) não tem menu. */
  function openMenu(node: NavNode | null, point: OpenMenu["point"], initialFocus: OpenMenu["initialFocus"]): boolean {
    if (ignoresContextMenu(menu?.initialFocus ?? null, initialFocus) || menuGroupsOf(node).length === 0) return false;

    setMenu({ node, point, initialFocus });
    return true;
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(copy.menu.copied);
    } catch {
      toast.warning(copy.menu.notCopied);
    }
  }

  /** Executa o item escolhido. O menu só descreve a ação (`navigator-menu.ts`); aqui estão a conexão, as abas e o cache. */
  function runMenuAction(node: NavNode | null, action: MenuAction) {
    // O espaço vazio do navegador: "Nova conexão" e "Nova pasta", na raiz.
    if (node === null) {
      if (action.type === "newConnection") onNewConnection(null);
      else if (action.type === "newFolder") setFolderAction({ type: "create", parentID: null });
      return;
    }

    const connectionId = ownerConnectionId(node);
    const target = tableTargetOf(node);

    switch (action.type) {
      case "connect":
        if (connectionId !== null) connect(connectionId);
        return;
      case "disconnect":
        if (connectionId !== null) disconnect(connectionId);
        return;
      case "newQuery": {
        // A consulta nova é do banco da linha (RN-ARVORE-006): a de um esquema de outro banco do servidor roda na sessão dele.
        const owner = databaseRefOf(node);
        if (owner !== null) openQueryTab(owner.connectionId, undefined, owner.database);
        return;
      }
      case "refresh":
        refresh(node);
        return;
      // O diálogo de edição, ali mesmo, sobre a área de trabalho (RN-NAV-004).
      case "editConnection":
        if (connectionId !== null) onEditConnection(connectionId);
        return;
      case "moveConnection":
      case "deleteConnection": {
        const connection = connectionId === null ? undefined : connectionById.get(connectionId);
        if (connection !== undefined) setConnectionAction({ type: action.type === "moveConnection" ? "move" : "delete", connection });
        return;
      }
      case "openTable":
        if (target !== null) openTableTab(target.connectionId, { schema: target.schema, name: target.name, view: action.view, ...inDatabase(target.database) });
        return;
      // O SELECT vai para uma consulta nova, no editor, sem executar; a citação dos nomes por banco é do `selectAllSql`.
      case "generateSelect": {
        const engine = target === null ? undefined : connectionById.get(target.connectionId)?.engine;
        if (target !== null && engine !== undefined) openQueryTab(target.connectionId, selectAllSql(engine, target.schema, target.name), target.database);
        return;
      }
      case "copy":
        void copyText(action.text);
        return;
      case "newConnection":
      case "newFolder":
      case "renameFolder":
      case "moveFolder":
      case "deleteFolder": {
        const folder = (folders.data ?? []).find((candidate) => candidate.id === folderIdOf(node));
        if (folder === undefined) return;

        if (action.type === "newConnection") {
          expandFolder(folder.id);
          onNewConnection(folder.id);
        } else if (action.type === "newFolder") {
          expandFolder(folder.id);
          setFolderAction({ type: "create", parentID: folder.id });
        } else {
          setFolderAction({ type: folderActionTypes[action.type], folder });
        }
        return;
      }
    }
  }

  // O item escolhido só conta enquanto está na árvore à vista: recolhido o pai dele, ou filtrado pela busca, a barra não age sobre o que não se vê.
  const selected = selectedKey === null ? null : (rows.find((row) => row.key === selectedKey) ?? null);
  const selectedConnectionId = selectionConnectionId(selected);
  const selectedConnection = selectedConnectionId === null ? undefined : connectionById.get(selectedConnectionId);
  const targetFolder = (folders.data ?? []).find((folder) => folder.id === targetFolderId(selected, connectionList)) ?? null;
  // Uma pasta só está "aberta" se tem o que mostrar; as conexões, os esquemas e as tabelas abertos estão em `expanded`.
  const hasOpenFolder = tree.folderKeys.some((key) => {
    const level = tree.levels.get(childrenKey({ key }));
    return !collapsedFolders.has(key) && level?.status === "loaded" && level.children.length > 0;
  });

  const toolbar = toolbarFor(
    {
      node: selected,
      connection: selectedConnection === undefined ? null : { id: selectedConnection.id, name: selectedConnection.name, status: statuses.get(selectedConnection.id) ?? "disconnected", busy: disconnecting === selectedConnection.id },
      folder: targetFolder === null ? null : { id: targetFolder.id, name: targetFolder.name },
    },
    { canCollapse: expanded.size > 0 || hasOpenFolder },
    hideShortcut,
  );

  /** Executa o botão da barra de ações (RN-NAV-002). Como no menu, o modelo só descreve (`navigator-toolbar.ts`); a barra não chama o botão desabilitado. */
  function runToolbarAction(id: ToolbarActionId) {
    switch (id) {
      case "newFolder":
        if (targetFolder !== null) expandFolder(targetFolder.id);
        setFolderAction({ type: "create", parentID: targetFolder?.id ?? null });
        return;
      case "connect":
        if (selectedConnection !== undefined) connect(selectedConnection.id);
        return;
      case "disconnect":
        if (selectedConnection !== undefined) disconnect(selectedConnection.id);
        return;
      case "refresh":
        if (selected !== null) refresh(selected);
        return;
      // Recolher não desconecta: a sessão de cada conexão continua aberta, e o ponto de estado dela continua verde.
      case "collapseAll":
        for (const key of expanded) setNodeOpen(key, false);
        setCollapsedFolders(new Set(tree.folderKeys));
        return;
      // O diálogo de nova conexão (RN-NAV-004), na pasta escolhida (ou na do item escolhido), ou na raiz; sempre habilitado (RN-NAV-002).
      case "newConnection":
        if (targetFolder !== null) expandFolder(targetFolder.id);
        onNewConnection(targetFolder?.id ?? null);
        return;
      case "hide":
        onHide();
        return;
    }
  }

  const menuItems = (menu === null ? [] : menuGroupsOf(menu.node)).map((group) =>
    group.map((item): ContextMenuItem => ({ id: item.id, label: item.label, shortcut: item.shortcut, disabled: item.disabled, icon: menuIcons[item.id], onSelect: () => menu && runMenuAction(menu.node, item.action) })),
  );

  /** O que há abaixo da barra de ações: a falha das listas, a espera por elas, o estado vazio, ou a busca e a árvore. */
  function body() {
    if (folders.isError || connections.isError) {
      return (
        <div className="flex flex-col items-start gap-3 p-3">
          <FormMessage tone="error">{copy.loadFailed}</FormMessage>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void folders.refetch();
              void connections.refetch();
            }}
          >
            {copy.retry}
          </Button>
        </div>
      );
    }

    if (folders.isPending || connections.isPending) {
      return (
        <p role="status" className="px-3 py-2 text-muted">
          {copy.loadingList}
        </p>
      );
    }

    // Primeiro uso (RN-NAV-007): a barra de ações continua acima, e o "Nova conexão" grande fica na área das abas (a página).
    if (tree.roots.length === 0) {
      return (
        <div className="flex flex-col gap-1 px-3 py-2">
          <p className="font-semibold text-ink">{copy.empty.title}</p>
          <p className="text-muted">{navigatorCopy.empty.hint}</p>
        </div>
      );
    }

    return (
      <>
        <NavigatorSearchField value={query} onChange={setQuery} onFocusList={focusList} inputRef={searchInput} />
        {/* A lista fica sempre montada: a rolagem da árvore mora nela, e "nada encontrado" não pode levá-la embora. */}
        {search === null ? null : search.rows.length === 0 ? (
          <div role="status" className="flex flex-col gap-1 px-3 py-2">
            <p className="text-ink">{copy.search.nothingFound(searchText.trim())}</p>
            <p className="text-xs text-muted">{copy.search.onlyLoaded}</p>
          </div>
        ) : (
          <p role="status" className="sr-only">
            {copy.search.results(search.count)}
          </p>
        )}
        <NavigatorList
          rows={rows}
          open={search === null ? open : search.open}
          matches={search?.matches}
          searching={search !== null}
          scrollResetKey={searchText}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          reveal={reveal}
          connectionById={connectionById}
          statuses={statuses}
          disconnecting={disconnecting}
          onToggle={search === null ? toggle : toggleInSearch}
          onRetry={retry}
          onRefresh={refresh}
          onNewQuery={(node) => {
            const owner = databaseRefOf(node);
            if (owner !== null) openQueryTab(owner.connectionId, undefined, owner.database);
          }}
          onOpenTable={(node) => {
            const target = tableTargetOf(node);
            if (target !== null) openTableTab(target.connectionId, { schema: target.schema, name: target.name, ...inDatabase(target.database) });
          }}
          onDisconnect={(node) => {
            const connectionId = ownerConnectionId(node);
            if (connectionId !== null) disconnect(connectionId);
          }}
          onContextMenu={openMenu}
        />
      </>
    );
  }

  return (
    <div ref={area} onKeyDown={handleShortcut} onContextMenu={handleBackgroundMenu} className="flex min-h-0 flex-1 flex-col">
      {/* A barra de ações fica em qualquer estado: sem conexão nenhuma, ou com as listas por chegar, é por ela que se cria a primeira pasta e a
          primeira conexão. */}
      <NavigatorToolbar buttons={toolbar} onAction={runToolbarAction} />
      {body()}
      {menu === null ? null : (
        <ContextMenu
          key={`${menu.node?.key ?? "background"}@${menu.point.x},${menu.point.y}`}
          label={menu.node === null ? navigatorCopy.menu.label : copy.menu.label(menu.node.label)}
          point={menu.point}
          initialFocus={menu.initialFocus}
          groups={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
      {folderAction === null ? null : <FolderActionDialogs action={folderAction} folders={folders.data ?? []} onClose={() => setFolderAction(null)} />}
      {connectionAction?.type === "move" ? <MoveConnectionDialog connection={connectionAction.connection} folders={folders.data ?? []} onClose={() => setConnectionAction(null)} /> : null}
      {connectionAction?.type === "delete" ? (
        <DeleteConnectionDialog
          connection={connectionAction.connection}
          openTabs={tabs.filter((tab) => tab.connectionId === connectionAction.connection.id).length}
          onClose={() => setConnectionAction(null)}
          onDeleted={() => setConnectionAction(null)}
        />
      ) : null}
    </div>
  );
}

type NavigatorListProps = {
  rows: NavNode[];
  open: ReadonlySet<string>;
  connectionById: ReadonlyMap<string, Connection>;
  statuses: ReadonlyMap<string, ConnectionStatus>;
  disconnecting: string | null;
  onToggle: (node: NavNode) => void;
  onRetry: (node: NavNode) => void;
  onRefresh: (node: NavNode) => void;
  onNewQuery: (node: NavNode) => void;
  onOpenTable: (node: NavNode) => void;
  onDisconnect: (node: NavNode) => void;
  /** O menu de contexto da linha, aberto pelo mouse (`menu`) ou pelo teclado (`first`, com o foco já no primeiro item). Devolve se o menu vai abrir. */
  onContextMenu: (node: NavNode | null, point: { x: number; y: number }, initialFocus: "first" | "menu") => boolean;
  /** Só na árvore filtrada: onde o termo casou em cada linha, para o destaque. */
  matches?: ReadonlyMap<string, MatchRange>;
  /** A lista mostra o resultado de uma busca: a rolagem da árvore fica guardada e volta quando a busca acaba. */
  searching: boolean;
  /** Muda a cada texto novo da busca: o resultado novo começa no topo. */
  scrollResetKey: string;
  /** O item escolhido (estado do navegador: a barra de ações age sobre ele) e quem o troca: o clique e o foco numa linha. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** A linha a trazer à vista e a receber o foco, uma vez por pedido (`seq`): a conexão que o formulário acabou de salvar (RN-NAV-004). */
  reveal: { key: string; seq: number } | null;
};

/**
 * A lista virtualizada (RN-ARVORE: milhares de tabelas): só as linhas à vista existem no DOM. Fica
 * num componente à parte para a rolagem, que re-renderiza quem usa o virtualizador, não refaça a
 * árvore. Teclado de árvore: setas movem entre linhas, direita abre, esquerda fecha; só uma linha
 * entra na ordem do Tab.
 */
function NavigatorList({ rows, open, connectionById, statuses, disconnecting, onToggle, onRetry, onRefresh, onNewQuery, onOpenTable, onDisconnect, onContextMenu, matches, searching, scrollResetKey, selectedKey, onSelect, reveal }: NavigatorListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // A tela filtrada tem outra altura ("limpar devolve a árvore como estava"): a rolagem da árvore é acompanhada enquanto ela está à mostra, e volta ao
  // sair da busca. Ler `scrollTop` ao entrar nela não serve: a lista já encolheu, e o navegador já o ajustou para o novo máximo.
  const treeScroll = useRef(0);
  useLayoutEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = searching ? 0 : treeScroll.current;
  }, [searching, scrollResetKey]);

  // As linhas são medidas (a de erro é mais alta que as outras), e a área de trabalho fica escondida por baixo das outras telas: a linha sem caixa não mede
  // zero (`measureRendered`), senão as primeiras linhas somem ao voltar; e a rolagem lida sem caixa não é posição (`observeRenderedOffset`), senão quem rola e
  // sai logo em seguida volta para uma lista em branco.
  // eslint-disable-next-line react-hooks/incompatible-library -- o virtualizador devolve funções que não se memorizam; nada aqui depende disso.
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowHeight, overscan: 12, getItemKey: (index) => rows[index].key, measureElement: measureRendered, observeElementOffset: observeRenderedOffset });

  // A conexão que o formulário acabou de salvar: rola até ela e lhe dá o foco, uma vez por pedido. A linha pode ainda não estar desenhada (a lista
  // virtual só desenha o que se vê, e o navegador pode estar voltando a aparecer, sem caixa ainda): a cada quadro pede a rolagem até ela e tenta de
  // novo, até a linha existir com caixa. Vem depois dos efeitos que devolvem o foco ao voltar à área de trabalho (`WorkbenchSlot`), e ganha deles.
  const revealedSeq = useRef(0);
  const revealFrame = useRef(0);
  useEffect(() => {
    if (reveal === null || revealedSeq.current === reveal.seq) return;
    const index = rows.findIndex((row) => row.key === reveal.key);
    if (index < 0) return;

    revealedSeq.current = reveal.seq;
    let frames = 0;
    const attempt = () => {
      const row = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"] [data-row-toggle]`);
      if (row !== null && row !== undefined && row.offsetParent !== null) {
        row.focus({ preventScroll: true });
        return;
      }

      virtualizer.scrollToIndex(index, { align: "auto" });
      if (++frames < 30) revealFrame.current = requestAnimationFrame(attempt);
    };
    virtualizer.scrollToIndex(index, { align: "auto" });
    revealFrame.current = requestAnimationFrame(attempt);
  }, [reveal, rows, virtualizer]);
  useEffect(() => () => cancelAnimationFrame(revealFrame.current), []);

  // O Tab alcança uma linha só, e ela tem de estar entre as desenhadas: a selecionada pode ter rolado para fora da janela.
  const items = virtualizer.getVirtualItems();
  const tabbable = tabbableKey(rows, selectedKey, items.map((item) => item.index));

  function move(event: KeyboardEvent<HTMLElement>, from: number, step: 1 | -1) {
    let target = from + step;
    while (rows[target] !== undefined && !isFocusable(rows[target])) target += step;
    if (!isFocusable(rows[target])) return;

    event.preventDefault();
    scrollRef.current?.querySelector<HTMLElement>(`[data-index="${target}"] [data-row-toggle]`)?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>, node: NavNode, index: number) {
    if (event.key === "ArrowDown") move(event, index, 1);
    else if (event.key === "ArrowUp") move(event, index, -1);
    else if (event.key === "Enter" && tableTargetOf(node) !== null) {
      // Enter numa tabela ou visão abre a aba dela (RN-TABELA-001); sem o preventDefault o botão da linha ainda alternaria o nó.
      event.preventDefault();
      onOpenTable(node);
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      // A tecla de menu e Shift+F10 (RN-MENU-001): o menu abre no pé da linha, com o foco no primeiro item. O `preventDefault` tira o menu do próprio navegador, mas
      // não basta: a tecla de menu ainda gera um `contextmenu` no keyup (o Shift+F10 não gera), em cima do menu já aberto, e `openMenu` o ignora (`ignoresContextMenu`).
      event.preventDefault();
      const { left, bottom } = event.currentTarget.getBoundingClientRect();
      onContextMenu(node, { x: left + 28, y: bottom }, "first");
    } else if (event.key === "ArrowRight" && node.hasChildren) {
      event.preventDefault();
      if (!open.has(node.key)) onToggle(node);
      else move(event, index, 1);
    } else if (event.key === "ArrowLeft" && node.hasChildren && open.has(node.key)) {
      event.preventDefault();
      onToggle(node);
    }
  }

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label={copy.tree}
      // O espaço vazio da árvore recebe o foco do clique (o botão direito nele abre o menu do navegador, e o foco volta para cá quando ele fecha), sem
      // entrar no Tab: as linhas são a parada de tabulação. Com o foco aqui, Shift+F10 e a tecla de menu abrem o mesmo menu (RN-MENU-001).
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
        event.preventDefault();
        const { left, top } = event.currentTarget.getBoundingClientRect();
        onContextMenu(null, { x: left + 28, y: top + 8 }, "first");
      }}
      onScroll={(event) => {
        treeScroll.current = rememberedTreeScroll(treeScroll.current, { scrollTop: event.currentTarget.scrollTop, clientHeight: event.currentTarget.clientHeight, searching });
      }}
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-3 outline-none"
    >
      <div role="presentation" style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {items.map((item) => {
          const node = rows[item.index];
          // Só a linha da conexão recebe a conexão salva (a etiqueta do banco, o ambiente e as ações); as outras linhas têm dono, mas não a recebem.
          const connectionId = node.kind === "connection" ? ownerConnectionId(node) : null;
          const connection = connectionId === null ? undefined : connectionById.get(connectionId);

          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              role="treeitem"
              aria-level={node.depth + 1}
              aria-expanded={node.hasChildren ? open.has(node.key) : undefined}
              aria-selected={node.key === selectedKey}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
            >
              <NavigatorRow
                node={node}
                index={item.index}
                open={open.has(node.key)}
                tabbable={node.key === tabbable}
                selected={node.key === selectedKey}
                connection={connection}
                status={connection ? statuses.get(connection.id) : undefined}
                busy={connection !== undefined && disconnecting === connection.id}
                match={matches?.get(node.key)}
                onSelect={(selected) => onSelect(selected.key)}
                onToggle={onToggle}
                onRetry={onRetry}
                onRefresh={onRefresh}
                onNewQuery={onNewQuery}
                onDisconnect={onDisconnect}
                onOpenTable={onOpenTable}
                onContextMenu={(target, point) => onContextMenu(target, point, "menu")}
                onKeyDown={handleKeyDown}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
