import { useDeferredValue, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";

import { DeleteConnectionDialog } from "@/app/connections/_components/delete-connection-dialog";
import { MoveConnectionDialog } from "@/app/connections/_components/move-connection-dialog";
import { RenameConnectionDialog } from "@/app/connections/_components/rename-connection-dialog";
import { buildConnectionTree } from "@/app/connections/_lib/connection-tree";
import { connectionsCopy } from "@/app/connections/_lib/connections.copy";
import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";
import { connectionsQuery, duplicateConnection, foldersQuery, invalidateLists } from "@/app/connections/_lib/connections.service";
import { environmentLookup, type EnvironmentLookup } from "@/app/connections/_lib/environment";
import { dbeaverCopy } from "@/app/connections/_lib/dbeaver.copy";
import { readOnlyHintOf } from "@/app/connections/_lib/protections";
import { userEnvironments } from "@/app/connections/_lib/user-environments";
import type { NavigatorDensity } from "@/app/settings/_lib/preferences";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button, ColumnsIcon, ContextMenu, DiagramIcon, DocumentIcon, DownloadIcon, DuplicateIcon, FolderMoveIcon, FolderPlusIcon, FormMessage, PencilIcon, PlugIcon, PlusIcon, PowerIcon, RefreshIcon, TableIcon, TrashIcon, UploadIcon, useToast, type ContextMenuItem } from "@/components/ui";
import { dbeaverAvailable } from "@/lib/api/bridge";
import { ApiRequestError, unwrap } from "@/lib/api/prism-api";

import { notConnectedIds, type CheckState } from "../_lib/connection-checks";
import { connectionReveal } from "../_lib/connection-intent";
import { credentialsMissingField } from "../_lib/credentials-missing";
import { openExportWizard } from "../_lib/data-export/data-exports";
import { openImportWizard } from "../_lib/data-import/data-imports";
import { databaseOfKey, databaseSessionKey, databaseSessionQuery, errorCodeOf, errorDriverIdOf, isSessionLost, reopenDatabaseSession, treeKey, treePrefixes, treeQuery, type FetchedPath } from "../_lib/database-sessions.service";
import { backgroundMenu, ignoresContextMenu, keyActionFor, menuFor, type MenuAction } from "../_lib/navigator-menu";
import { childrenKey, databaseRefOf, flattenVisible, inDatabase, isFocusable, navKey, ownerConnectionId, parentRowIndex, parseNavKey, schemaGroupNodes, tabbableKey, tableGroupNodes, tableTargetOf, treeNodes, typeAheadLabels, type LevelState, type NavNode, type NavPath } from "../_lib/navigator-model";
import { filterConnected } from "../_lib/navigator-connected";
import { collapsedAllInFilter, collapsedInFilter, filterFoldersFor, filterViewOf, folderIdOfKey, folderIdsOfKeys, folderKeyOf, noFilterFolders, openTreeKeys, openedInFilter, toggledInFilter } from "../_lib/navigator-folders";
import { allEnvironments, choiceAvailable, filterByEnvironment, type EnvironmentChoice } from "../_lib/navigator-environment";
import { navigatorMetrics } from "../_lib/navigator-density";
import { rememberedTreeScroll } from "../_lib/navigator-layout";
import { importArrived, importRevealOf, revealOf } from "../_lib/navigator-reveal";
import { cachedTree, loadedLevels, searchTree, type MatchRange } from "../_lib/navigator-search";
import { refreshesSelection, selectionConnectionId, targetFolderId, toolbarFor, type ToolbarActionId } from "../_lib/navigator-toolbar";
import { invalidateStructure } from "../_lib/table-structure.service";
import { refreshKey } from "../_lib/grid-editing";
import { importedReveal, type TransferRequest } from "../_lib/transfer-requests";
import { measureRendered, observeRenderedOffset, remeasureRendered } from "../_lib/row-measure";
import { selectAllSql } from "../_lib/table-sql";
import { useConnectionChecksSnapshot } from "../_lib/use-connection-checks";
import { useOpenFolders } from "../_lib/use-navigator-layout";
import { useTypeAhead } from "../_lib/use-type-ahead";
import { useWorkbenchOnScreen } from "../_lib/use-workbench-on-screen";
import { connectedConnectionIds, isConnected } from "../_lib/workbench-model";
import { useWorkbench } from "../_lib/workbench-state";
import { navigatorCopy } from "../_lib/navigator.copy";
import { workbenchCopy } from "../_lib/workbench.copy";
import { CheckFailureDialog } from "./connection-check";
import { FolderActionDialogs, type FolderAction } from "./folder-action-dialogs";
import { NavigatorFilteredEmpty } from "./navigator-connected-filter";
import { NavigatorFilters } from "./navigator-filters";
import { TypeAheadIndicator } from "./type-ahead-indicator";
import { NavigatorRow, type ConnectionStatus } from "./navigator-row";
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
  // RN-TRANSF-016: a conexão sem usuário ou sem senha nem chegou ao driver; ela continua desconectada, e o "Editar conexão" abre.
  return treeSession.isError && !lacksCredentials(treeSession) ? "failed" : "disconnected";
}

/**
 * A sessão da árvore recusada por faltar o usuário ou a senha (RN-TRANSF-016): o nó fica como estava, fechado e sem a linha de erro (RN-ARVORE-005), e quem
 * abre o "Editar conexão" é a página, pelo cache (`watchCredentialsMissing`).
 */
function lacksCredentials(treeSession: UseQueryResult): boolean {
  return treeSession.isError && !treeSession.isFetching && credentialsMissingField(treeSession.error) !== null;
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
  renameConnection: <PencilIcon />,
  duplicateConnection: <DuplicateIcon />,
  moveConnection: <FolderMoveIcon />,
  deleteConnection: <TrashIcon />,
  newConnection: <PlusIcon />,
  openRecords: <TableIcon />,
  openStructure: <ColumnsIcon />,
  openDiagram: <DiagramIcon />,
  generateSelect: <DocumentIcon />,
  // RN-EXPORT-001: a seta de baixar que o app já tem (a do "Exportar CSV").
  exportData: <DownloadIcon />,
  importData: <UploadIcon />,
  newFolder: <FolderPlusIcon />,
  renameFolder: <PencilIcon />,
  editFolder: <PencilIcon />,
  moveFolder: <FolderMoveIcon />,
  deleteFolder: <TrashIcon />,
  // RN-TRANSF-001 e seção 9: exportar usa a seta de baixar que o app já tem; importar, a seta para cima, no mesmo traço.
  exportConnection: <DownloadIcon />,
  exportConnections: <DownloadIcon />,
  importHere: <UploadIcon />,
  importConnections: <UploadIcon />,
};

/**
 * A ação do menu sobre uma pasta que existe e o diálogo que a atende ("Nova subpasta" cria: não é sobre a pasta, é dentro dela). O "Renomear" (F2) é o
 * diálogo só com o nome (RN-NAV-009), e o "Editar pasta…", o inteiro (RN-PASTA-006).
 */
const folderActionTypes = { renameFolder: "rename", editFolder: "edit", moveFolder: "move", deleteFolder: "delete" } as const;

/** A ação de conexão que o menu pediu (RN-NAV-003 e 009): renomear, mover de pasta ou excluir, cada uma com o diálogo dela. */
type ConnectionAction = { type: "rename" | "move" | "delete"; connection: Connection };

/** O diálogo de cada ação de conexão do menu que tem diálogo. */
const connectionActionTypes = { renameConnection: "rename", moveConnection: "move", deleteConnection: "delete" } as const;

type NavigatorProps = {
  /** "Nova conexão" (RN-NAV-002 e 003): na pasta dada, ou na raiz (`null`). */
  onNewConnection: (folderID: string | null) => void;
  /** "Editar conexão" (RN-MENU-001): o diálogo de edição, ali mesmo. */
  onEditConnection: (connectionId: string) => void;
  /** O "Exportar conexões", o "Importar conexões" e o "Importar do DBeaver" (RN-TRANSF-001, RN-DBEAVER-003): os diálogos são da página da área de trabalho. */
  onTransfer: (request: TransferRequest) => void;
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
  return folderIdOfKey(node.key);
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
 * conexão, pela barra de ações e pelo menu de contexto. O F2 renomeia a pasta e a conexão (RN-NAV-009), e o menu da conexão também a duplica
 * (RN-CONN-016): a cópia aparece escolhida, pelo mesmo `connectionReveal` do formulário. O formulário de conexão é uma página à parte (RN-NAV-004), e a conexão que ele
 * acabou de salvar aparece aqui à vista e escolhida (`connectionReveal`); `onRevealed` avisa quem mostra o navegador, para ele aparecer se
 * estava escondido. O formulário é um diálogo sobre a área de trabalho (RN-NAV-004), e quem o abre é a página: o navegador só pede
 * (`onNewConnection`, na pasta onde a conexão nasce; `onEditConnection`).
 */
export function Navigator({ onNewConnection, onEditConnection, onTransfer, onRevealed, onHide, hideShortcut }: NavigatorProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const folders = useQuery(foldersQuery);
  const connections = useQuery(connectionsQuery);
  const { tabs, expanded, setNodeOpen, openQueryTab, openTableTab, disconnect, disconnecting } = useWorkbench();
  // RN-NAV-011: a densidade da árvore, que muda ao vivo com a escolha em Configurações › Aparência.
  const density = usePreferences().preferences.ui.navigatorDensity;
  // RN-NAV-014: as pastas abertas são as lembradas (por usuário, nas preferências desta instalação); sem nada lembrado, todas fechadas. Quem escreve é um
  // evento ou um efeito, nunca a renderização. As conexões não se lembram: abrir a conexão é conectar (RN-SESSAO-001).
  const [openFolderIds, changeFolders] = useOpenFolders("connections");
  // Com o seletor de ambiente ou "Só as conectadas" ligado, as pastas no caminho até as conexões à vista abrem só nessa vista, sem gravar; o que a pessoa
  // recolhe nela vale enquanto o filtro está ligado (como `searchCollapsed` na busca), e desligá-lo devolve as pastas como estavam.
  const [filterFolders, setFilterFolders] = useState(noFilterFolders);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [folderAction, setFolderAction] = useState<FolderAction | null>(null);
  const [connectionAction, setConnectionAction] = useState<ConnectionAction | null>(null);
  // RN-TRANSF-014 e RN-DBEAVER-014: o que a importação acabou de criar (o diálogo é da página, e o pedido vem por `importedReveal`), à espera de as listas o
  // trazerem para a árvore mostrá-lo. `handledImport` é o pedido que a árvore já atendeu.
  const importedRequest = useSyncExternalStore(importedReveal.subscribe, importedReveal.pending, importedReveal.pending);
  const [handledImport, setHandledImport] = useState<{ seq: number; folderIds: string[] }>({ seq: 0, folderIds: [] });
  // A linha a trazer à vista e a receber o foco (a conexão salva ou duplicada, RN-NAV-004; a primeira importada, RN-TRANSF-014), uma vez por pedido.
  const [rowFocus, setRowFocus] = useState<{ key: string; seq: number } | null>(null);
  const focusRow = (key: string) => setRowFocus((current) => ({ key, seq: (current?.seq ?? 0) + 1 }));
  // O item escolhido na árvore. Mora aqui, e não na lista, porque a barra de ações age sobre ele (RN-NAV-002).
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A busca (RN-BUSCA-001): o texto, e o que a pessoa recolheu na tela filtrada, que vale só para aquele texto. Nada disto toca nos nós abertos.
  const [query, setQuery] = useState("");
  const [searchCollapsed, setSearchCollapsed] = useState<{ query: string; keys: ReadonlySet<string> }>({ query: "", keys: noKeys });
  const searchInput = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLDivElement>(null);
  // RN-NAV-010: o seletor de ambiente. É estado daqui: a área de trabalho fica montada enquanto o cofre está aberto, então a escolha vale enquanto a
  // janela está aberta, e sair do cofre a apaga, como o resto.
  const [environmentChoice, setEnvironmentChoice] = useState<EnvironmentChoice>(allEnvironments);
  // RN-NAV-013: "Só as conectadas", estado daqui pelo mesmo motivo: vale enquanto a janela está aberta, como a do ambiente.
  const [onlyConnected, setOnlyConnected] = useState(false);
  // RN-VERIF-003: o indicador da verificação de cada conexão (um estado só para a árvore inteira) e a falha aberta num clique, pela conexão.
  const checks = useConnectionChecksSnapshot();
  const [checkFailure, setCheckFailure] = useState<string | null>(null);
  // O filtro roda sobre o texto adiado: a digitação não espera a lista de milhares de linhas.
  const searchText = useDeferredValue(query);
  // A conexão que o formulário acabou de salvar (RN-NAV-004), e a última que esta árvore já mostrou (o número do pedido).
  const onScreen = useWorkbenchOnScreen();
  const revealRequest = useSyncExternalStore(connectionReveal.subscribe, connectionReveal.pending, connectionReveal.pending);
  const [reveal, setReveal] = useState<{ key: string; seq: number; folderIds: string[] } | null>(null);

  const connectionList = useMemo(() => connections.data ?? [], [connections.data]);
  const connectionById = useMemo(() => new Map(connectionList.map((connection) => [connection.id, connection])), [connectionList]);
  // RN-PASTA-005: a etiqueta de cada pasta e o ambiente que cada conexão mostra; mover a conexão ou a pasta é outra lista de pastas, e outra resposta.
  const environments = useMemo(() => environmentLookup(folders.data ?? []), [folders.data]);
  // RN-PROT-002: a dica do cadeado de cada conexão somente leitura (a própria ou a herdada de uma pasta acima), pelo id.
  const readOnlyHints = useMemo(() => new Map(connectionList.flatMap((connection) => {
    const hint = readOnlyHintOf(connection.protections, folders.data ?? []);
    return hint === null ? [] : [[connection.id, hint] as const];
  })), [connectionList, folders.data]);
  // RN-PASTA-007: a cor do ícone de cada pasta que tem uma. É só dela: a subpasta e a conexão não a herdam.
  const folderColors = useMemo(() => new Map((folders.data ?? []).flatMap((folder) => (folder.color === null ? [] : [[folder.id, folder.color] as const]))), [folders.data]);
  // RN-NAV-010: os ambientes do usuário no seletor (RN-AMB-001), e a árvore só com as conexões do escolhido e as pastas no caminho até elas. A busca
  // filtra depois, sobre esta árvore. O ambiente que ninguém mais usa sai da lista, e a escolha dele volta a "Todos" (ajuste durante a renderização,
  // só com as duas listas já na tela).
  const savedEnvironments = useMemo(() => userEnvironments(folders.data ?? [], connectionList), [folders.data, connectionList]);
  if (folders.data !== undefined && connections.data !== undefined && !choiceAvailable(environmentChoice, savedEnvironments)) setEnvironmentChoice(allEnvironments);

  // Um observador por conexão: o ponto de estado mostra a sessão mesmo com o nó recolhido, e só um nó aberto a abre.
  const sessions = useQueries({ queries: connectionList.map((connection) => ({ ...databaseSessionQuery(connection.id), enabled: expanded.has(navKey({ type: "connection", connectionId: connection.id })) })) });
  const sessionById = new Map(connectionList.map((connection, index) => [connection.id, sessions[index]]));
  const statuses = new Map(connectionList.map((connection, index) => [connection.id, statusOf(sessions[index], isConnected(connection.id, tabs, sessions[index].isSuccess))]));
  // RN-NAV-013: as conectadas, na definição única (`connectedConnectionIds`: a do ponto de estado, menos as que a verificação achou sem sessão na API, que o
  // indicador mostra como "Sem sessão aberta"), numa chave de texto: a árvore filtrada só se refaz quando elas mudam.
  const connectedIds = connectedConnectionIds(
    connectionList.map((connection) => connection.id),
    tabs,
    (connectionId) => sessionById.get(connectionId)?.isSuccess === true,
    new Set(notConnectedIds(checks)),
  );
  const connectedKey = onlyConnected ? connectedIds.join(" ") : null;

  // RN-NAV-010 e 013: o seletor de ambiente e "Só as conectadas" se combinam; a busca filtra depois, sobre a árvore que sai daqui.
  const inEnvironment = useMemo(() => filterByEnvironment(folders.data ?? [], connectionList, environmentChoice, environments), [folders.data, connectionList, environmentChoice, environments]);
  const shown = useMemo(() => filterConnected(inEnvironment.folders, inEnvironment.connections, connectedKey === null ? null : new Set(connectedKey.split(" "))), [inEnvironment, connectedKey]);
  const tree = useMemo(() => treeNodes(buildConnectionTree(shown.folders, shown.connections)), [shown]);

  // RN-TRANSF-016: a conexão que a API recusou por faltar o usuário ou a senha fica fechada, como estava antes do clique; um efeito a fecha de vez.
  const lackingCredentials = connectionList.filter((connection) => {
    const session = sessionById.get(connection.id);
    return session !== undefined && lacksCredentials(session);
  });
  const lackingKey = lackingCredentials.map((connection) => connection.id).join(" ");
  const lackingKeys = new Set(lackingCredentials.map((connection) => navKey({ type: "connection", connectionId: connection.id })));
  // RN-NAV-014: as pastas abertas são as lembradas; com o seletor de ambiente ou "Só as conectadas" ligado (RN-NAV-010 e 013), as do caminho até as conexões à
  // vista abrem só nessa vista, menos as que a pessoa recolheu nela. Desligar o filtro encerra a vista e trocá-lo começa outra (ajuste durante a renderização: as
  // recolhidas saem), e desligar devolve as pastas lembradas.
  const filterView = filterViewOf(environmentChoice, onlyConnected);
  const filtering = filterView !== null;
  const heldFilterFolders = filterFoldersFor(filterFolders, filterView);
  if (heldFilterFolders !== filterFolders) setFilterFolders(heldFilterFolders);
  const open = openTreeKeys({ expanded, lackingKeys, folderKeys: tree.folderKeys, openFolderIds, filterCollapsed: collapsedInFilter(filterFolders, filterView) });

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
  // conexão já na lista, a linha é escolhida, uma busca que a escondia é limpa, e a lista a traz à vista e lhe dá o foco. Ajuste durante a renderização
  // (como no provedor), uma vez por pedido. As pastas acima dela abrem e se lembram (RN-NAV-014), e isso é escrita numa loja de fora: vai junto do pedido
  // (`folderIds`) e se faz no efeito que o leva embora, nunca aqui.
  const revealTarget = revealRequest === null || revealRequest.seq === reveal?.seq || !onScreen ? undefined : connectionById.get(revealRequest.connectionId);
  if (revealRequest !== null && revealTarget !== undefined) {
    const plan = revealOf(revealTarget, folders.data ?? []);
    setReveal({ key: plan.key, seq: revealRequest.seq, folderIds: folderIdsOfKeys(plan.folderKeys) });
    setSelectedKey(plan.key);
    focusRow(plan.key);
    if (search !== null && !search.rows.some((row) => row.key === plan.key)) setQuery("");
    // Os filtros que a escondem também saem (RN-NAV-010 e 013): a conexão salva ou duplicada sem o ambiente escolhido, ou desconectada, tem de aparecer.
    if (!shown.connections.includes(revealTarget)) {
      setEnvironmentChoice(allEnvironments);
      setOnlyConnected(false);
    }
  }

  // RN-TRANSF-014: depois da importação, com as listas já trazendo o que entrou, a primeira linha importada, na ordem da árvore, é escolhida e recebe o foco
  // (as pastas até ela abrem e se lembram no efeito que leva o pedido embora, como no salvar). Os filtros ficam como estavam: se um deles a esconde, o foco vai
  // à pasta de destino, ou, quando o destino é a raiz ou também está escondido, à primeira linha à vista. Ajuste durante a renderização, uma vez, como o da
  // conexão salva.
  if (importedRequest !== null && importedRequest.seq !== handledImport.seq && onScreen && folders.data !== undefined && connections.data !== undefined && importArrived(importedRequest.value, folders.data, connections.data)) {
    const plan = importRevealOf(importedRequest.value, folders.data, connections.data);
    setHandledImport({ seq: importedRequest.seq, folderIds: folderIdsOfKeys(plan.folderKeys) });
    const shownKeys = new Set([...shown.folders.map((folder) => navKey({ type: "folder", id: folder.id })), ...shown.connections.map((connection) => navKey({ type: "connection", connectionId: connection.id }))]);
    const onView = (key: string | null): key is string => key !== null && shownKeys.has(key) && (search === null || search.rows.some((row) => row.key === key));
    const key = onView(plan.first) ? plan.first : onView(plan.target) ? plan.target : (rows[0]?.key ?? null);
    if (key !== null) {
      setSelectedKey(key);
      focusRow(key);
    }
  }

  useEffect(() => {
    for (const connectionId of lackingKey.split(" ").filter((id) => id !== "")) {
      setNodeOpen(navKey({ type: "connection", connectionId }), false);
      setNodeOpen(navKey({ type: "database", connectionId }), false);
    }
  }, [lackingKey, setNodeOpen]);

  /**
   * Abre as pastas e as lembra (RN-NAV-014): o que foi criado, salvo, duplicado, importado, movido ou revelado fica à vista, e à vista na próxima entrada.
   * Na vista filtrada elas saem também das recolhidas. Só em evento ou em efeito: a loja é de fora, e a renderização não escreve nela.
   */
  const openFolders = (ids: readonly string[]) => {
    if (ids.length === 0) return;
    changeFolders({ open: ids });
    setFilterFolders((current) => openedInFilter(current, filterView, ids.map(folderKeyOf)));
  };
  // Os efeitos das revelações abrem as pastas com a versão de agora, sem depender dela: cada pedido é atendido uma vez (o número do pedido), e não a cada troca de filtro.
  const openForRequest = useEffectEvent(openFolders);

  // RN-NAV-014: a pasta excluída sai do que se lembra, na primeira lista de pastas desta montagem (a lida depois dela, e não a que o cache já tinha).
  const pruned = useRef(false);
  useEffect(() => {
    if (pruned.current || folders.data === undefined || !folders.isFetchedAfterMount) return;
    pruned.current = true;
    changeFolders({ retain: folders.data.map((folder) => folder.id) });
  }, [folders.data, folders.isFetchedAfterMount, changeFolders]);

  // RN-DBEAVER-014: com o navegador escondido (RN-NAV-008), a importação o mostra antes de levar o foco à linha; o pedido sai quando a árvore o atendeu.
  const announcedImport = useRef(0);
  useEffect(() => {
    if (handledImport.seq === 0 || announcedImport.current === handledImport.seq) return;
    announcedImport.current = handledImport.seq;
    openForRequest(handledImport.folderIds);
    importedReveal.take(handledImport.seq);
    onRevealed?.();
  }, [handledImport, onRevealed]);

  const announcedReveal = useRef(0);
  useEffect(() => {
    if (reveal === null || announcedReveal.current === reveal.seq) return;
    announcedReveal.current = reveal.seq;
    openForRequest(reveal.folderIds);
    connectionReveal.take(reveal.seq);
    onRevealed?.();
  }, [reveal, onRevealed]);

  // O navegador desmonta quando o cofre fecha (ele fica montado enquanto o cofre está aberto): um pedido que ficou não passa ao usuário seguinte.
  useEffect(() => () => connectionReveal.clear(), []);

  function toggle(node: NavNode) {
    if (node.kind === "folder") {
      const id = folderIdOfKey(node.key);
      if (id === null) return;

      // RN-NAV-014: a pasta abre e fecha lembrada; na vista filtrada (RN-NAV-010 e 013) vale só enquanto o filtro está ligado, sem gravar.
      if (filtering) setFilterFolders((current) => toggledInFilter(current, filterView, node.key, open.has(node.key)));
      else changeFolders(open.has(node.key) ? { close: [id] } : { open: [id] });
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

  /** A pasta fica aberta, e lembrada: o que acaba de ser criado dentro dela tem de aparecer (como a tela de Conexões fazia). */
  const expandFolder = (folderId: string) => openFolders([folderId]);

  /**
   * "Mover para…" numa pasta (RN-NAV-003, RN-NAV-014): as pastas do destino abrem, lembradas, e ela fica escolhida e à vista, como a conexão salva. O pedido de
   * foco só vale sem busca: a pasta pode não estar na lista filtrada, e o pedido ficaria armado até ela aparecer. A conexão movida pede pelo `connectionReveal`.
   */
  function revealMovedFolder(moved: Folder) {
    const known = queryClient.getQueryData<Folder[]>(foldersQuery.queryKey) ?? folders.data ?? [];
    openFolders(folderIdsOfKeys(revealOf({ id: moved.id, folderID: moved.parentID }, known).folderKeys));
    if (search !== null) return;

    const key = folderKeyOf(moved.id);
    setSelectedKey(key);
    focusRow(key);
  }

  /**
   * "Duplicar conexão" (RN-CONN-016): a cópia nasce na mesma pasta, desconectada, e aparece escolhida, com as pastas acima dela abertas e o foco nela
   * (`connectionReveal`, depois de a lista já trazê-la); nada abre sozinho. A recusa (a conexão sumiu, o cofre fechou) vai ao aviso central, e a lista
   * se atualiza, porque o motivo pode ser ela estar velha.
   */
  const duplicate = useMutation({
    mutationFn: async (connectionId: string) => unwrap(await duplicateConnection(connectionId)),
    onSuccess: async (copy) => {
      toast.success(connectionsCopy.toasts.connectionDuplicated);
      await invalidateLists(queryClient);
      connectionReveal.request(copy.id);
    },
    onError: () => void invalidateLists(queryClient),
  });

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
    // As colunas e as chaves que o autocompletar buscou sozinho estão na família da Estrutura (RN-CONFIG-004): ninguém as mostra, então só a invalidação as faz velhas.
    invalidateStructure(queryClient, path, lost);
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
    } else if (!event.defaultPrevented && refreshKey(event)) {
      // RN-GRADE-012: F5 é o "Atualizar" do nó escolhido, quando ele se aplica (o mesmo da barra e do menu).
      event.preventDefault();
      if (refreshesSelection(toolbar)) runToolbarAction("refresh");
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
    // RN-IMPORT-001: na tabela, a conexão dela somente leitura desabilita o "Importar dados…".
    const owner = node.kind === "table" ? ownerConnectionId(node) : null;
    return { status: (connectionId === null ? undefined : statuses.get(connectionId)) ?? "disconnected", busy: connectionId !== null && disconnecting === connectionId, readOnly: owner !== null && readOnlyHints.has(owner), dbeaverAvailable: dbeaverAvailable() } as const;
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

  /** Os itens do menu: os da linha, ou os do espaço vazio do navegador (`null`), que sem nada no cofre não tem o que exportar (RN-TRANSF-001). */
  const menuGroupsOf = (node: NavNode | null) => (node === null ? backgroundMenu((folders.data ?? []).length + connectionList.length > 0, dbeaverAvailable()) : menuFor(node, menuStateOf(node)));

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
    // O espaço vazio do navegador: "Nova conexão" e "Nova pasta", na raiz; exportar com nada marcado, e importar na raiz (RN-TRANSF-001).
    if (node === null) {
      if (action.type === "newConnection") onNewConnection(null);
      else if (action.type === "newFolder") setFolderAction({ type: "create", parentID: null });
      else if (action.type === "exportConnections") onTransfer({ type: "export", origin: { type: "all" } });
      else if (action.type === "importConnections") onTransfer({ type: "import", targetFolderID: null });
      else if (action.type === "importDbeaver") onTransfer({ type: "dbeaver", targetFolderID: null, start: { type: "find" } });
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
      case "renameConnection":
      case "moveConnection":
      case "deleteConnection": {
        const connection = connectionId === null ? undefined : connectionById.get(connectionId);
        if (connection !== undefined) setConnectionAction({ type: connectionActionTypes[action.type], connection });
        return;
      }
      case "duplicateConnection":
        if (connectionId !== null && !duplicate.isPending) duplicate.mutate(connectionId);
        return;
      case "openTable":
        if (target !== null) openTableTab(target.connectionId, { schema: target.schema, name: target.name, view: action.view, ...inDatabase(target.database) });
        return;
      // O SELECT vai para uma consulta nova, no editor, sem executar; a citação dos nomes por banco é do `selectAllSql`.
      case "generateSelect": {
        const engine = target === null ? undefined : connectionById.get(target.connectionId)?.engine;
        if (target !== null && engine !== undefined) openQueryTab(target.connectionId, selectAllSql(engine, target.schema, target.name), target.database);
        return;
      }
      // RN-EXPORT-001: o assistente "Exportar dados", com a tabela (ou a visão) inteira como origem; as colunas ele lê do catálogo ao abrir a Extração.
      case "exportData":
        if (target !== null) openExportWizard({ connectionId: target.connectionId, ...inDatabase(target.database), origin: { kind: "table", view: node.kind === "view", schema: target.schema, name: target.name }, columns: null, unsavedEdits: 0 });
        return;
      // RN-IMPORT-001: o assistente "Importar dados", com a tabela de destino já escolhida.
      case "importData":
        if (target !== null) openImportWizard({ connectionId: target.connectionId, ...inDatabase(target.database), schema: target.schema, name: target.name });
        return;
      case "copy":
        void copyText(action.text);
        return;
      // RN-TRANSF-001: exportar a conexão (só ela marcada) ou a pasta (ela e tudo o que está dentro), e importar na pasta.
      case "exportConnections": {
        const folderId = folderIdOf(node);
        if (connectionId !== null && node.kind === "connection") onTransfer({ type: "export", origin: { type: "connection", id: connectionId } });
        else if (folderId !== null) onTransfer({ type: "export", origin: { type: "folder", id: folderId } });
        return;
      }
      case "importConnections": {
        const folderId = folderIdOf(node);
        if (folderId !== null) onTransfer({ type: "import", targetFolderID: folderId });
        return;
      }
      // RN-DBEAVER-003: "Importar do DBeaver aqui…", com a pasta da linha já escolhida em "Onde colocar".
      case "importDbeaver": {
        const folderId = folderIdOf(node);
        if (folderId !== null) onTransfer({ type: "dbeaver", targetFolderID: folderId, start: { type: "find" } });
        return;
      }
      case "newConnection":
      case "newFolder":
      case "renameFolder":
      case "editFolder":
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
    return open.has(key) && level?.status === "loaded" && level.children.length > 0;
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
      // As pastas também (RN-NAV-002, RN-NAV-014), e é isso que volta na próxima entrada; na vista filtrada só a vista se recolhe, e o lembrado fica como estava.
      case "collapseAll":
        for (const key of expanded) setNodeOpen(key, false);
        if (filtering) setFilterFolders(collapsedAllInFilter(filterView, tree.folderKeys));
        else changeFolders({ closeAll: true });
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
    group.map((item): ContextMenuItem => ({ id: item.id, label: item.label, shortcut: item.shortcut, disabled: item.disabled, hint: item.hint, icon: menuIcons[item.id], onSelect: () => menu && runMenuAction(menu.node, item.action) })),
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

    // Primeiro uso (RN-NAV-007): a barra de ações continua acima, e o "Nova conexão" grande fica na área das abas (a página). A árvore vazia pelo
    // filtro de ambiente ou pelo "Só as conectadas" não é o primeiro uso: há o que mostrar, só não com esses filtros.
    if (tree.roots.length === 0 && (!filtering || (connectionList.length === 0 && (folders.data ?? []).length === 0))) {
      return (
        <div className="flex flex-col gap-1 px-3 py-2">
          <p className="font-semibold text-ink">{copy.empty.title}</p>
          <p className="text-muted">{navigatorCopy.empty.hint}</p>
          {/* RN-DBEAVER-003: o estado vazio do navegador também tem "Importar do DBeaver…" (fora do app, desabilitado, com o motivo). */}
          <div>
            <Button type="button" variant="secondary" size="sm" onClick={() => onTransfer({ type: "dbeaver", targetFolderID: null, start: { type: "find" } })} disabled={!dbeaverAvailable()} title={dbeaverAvailable() ? undefined : dbeaverCopy.outside}>
              {dbeaverCopy.empty.importDbeaver}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <>
        {/* RN-BUSCA-001, RN-NAV-010 e 013: o campo de busca sozinho na primeira linha, na largura toda; "Só as conectadas" e o seletor de ambiente na de baixo. */}
        <NavigatorFilters
          query={query}
          onQueryChange={setQuery}
          onFocusList={focusList}
          inputRef={searchInput}
          environments={savedEnvironments}
          environmentChoice={environmentChoice}
          onEnvironmentChange={setEnvironmentChoice}
          connectedCount={connectedIds.length}
          onlyConnected={onlyConnected}
          onToggleConnected={() => setOnlyConnected((current) => !current)}
        />
        {/* A lista fica sempre montada: a rolagem da árvore mora nela, e "nada encontrado" não pode levá-la embora. */}
        {filtering && tree.roots.length === 0 ? (
          <NavigatorFilteredEmpty environment={environmentChoice.type === "environment" ? (savedEnvironments.find((environment) => environment.key === environmentChoice.key)?.name ?? "") : environmentChoice.type === "none" ? null : undefined} onlyConnected={onlyConnected} onShowAll={() => setOnlyConnected(false)} />
        ) : search === null ? null : search.rows.length === 0 ? (
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
          density={density}
          open={search === null ? open : search.open}
          matches={search?.matches}
          searching={search !== null}
          scrollResetKey={searchText}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          reveal={rowFocus}
          connectionById={connectionById}
          environments={environments}
          folderColors={folderColors}
          readOnlyHints={readOnlyHints}
          statuses={statuses}
          checks={checks}
          onCheckFailure={(node) => setCheckFailure(ownerConnectionId(node))}
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
          onKeyAction={runMenuAction}
          onContextMenu={openMenu}
        />
      </>
    );
  }

  // RN-VERIF-003: a falha que a pessoa abriu, enquanto a conexão continua sem responder: a resposta seguinte que dá certo (ou a desconexão) fecha a janela,
  // que não tem mais o que dizer, e de vez (ajuste durante a renderização): a falha seguinte não a abre sozinha.
  const failure = checkFailure === null ? undefined : checks.get(checkFailure);
  const failureConnection = checkFailure === null ? undefined : connectionById.get(checkFailure);
  if (checkFailure !== null && (failure?.kind !== "failed" || failureConnection === undefined)) setCheckFailure(null);

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
      {failure?.kind === "failed" && failureConnection !== undefined ? <CheckFailureDialog connection={failureConnection.name} state={failure} onClose={() => setCheckFailure(null)} /> : null}
      {folderAction === null ? null : <FolderActionDialogs action={folderAction} folders={folders.data ?? []} onClose={() => setFolderAction(null)} onMoved={revealMovedFolder} />}
      {connectionAction?.type === "rename" ? <RenameConnectionDialog connection={connectionAction.connection} onClose={() => setConnectionAction(null)} /> : null}
      {connectionAction?.type === "move" ? <MoveConnectionDialog connection={connectionAction.connection} folders={folders.data ?? []} onClose={() => setConnectionAction(null)} onMoved={(moved) => connectionReveal.request(moved.id)} /> : null}
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
  /** RN-NAV-011: a altura das linhas (e a estimativa da lista virtual), o recuo e os botões de ação. */
  density: NavigatorDensity;
  open: ReadonlySet<string>;
  connectionById: ReadonlyMap<string, Connection>;
  environments: EnvironmentLookup;
  /** RN-PASTA-007: a cor do ícone das pastas que têm uma, pelo id. */
  folderColors: ReadonlyMap<string, string>;
  /** RN-PROT-002: a dica do cadeado das conexões somente leitura, pelo id. */
  readOnlyHints: ReadonlyMap<string, string>;
  statuses: ReadonlyMap<string, ConnectionStatus>;
  /** RN-VERIF-003: o que a verificação diz de cada conexão conectada com ela ligada, e o clique que mostra a falha. */
  checks: ReadonlyMap<string, CheckState>;
  onCheckFailure: (node: NavNode) => void;
  disconnecting: string | null;
  onToggle: (node: NavNode) => void;
  onRetry: (node: NavNode) => void;
  onRefresh: (node: NavNode) => void;
  onNewQuery: (node: NavNode) => void;
  onOpenTable: (node: NavNode) => void;
  onDisconnect: (node: NavNode) => void;
  /** A ação do menu que uma tecla na linha pede (`keyActionFor`: o F2 do Renomear, RN-NAV-009), executada como se viesse do menu. */
  onKeyAction: (node: NavNode, action: MenuAction) => void;
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
 * árvore. Teclado de árvore: setas movem entre linhas, direita abre, esquerda fecha, F2 renomeia a pasta e a conexão; digitar as primeiras letras de um
 * nome leva a escolha e o foco ao item visível que começa por elas (RN-ARVORE-009); só uma linha entra na ordem do Tab. Exportada para o teste do teclado, que
 * a monta com os ganchos simulados.
 */
export function NavigatorList({ rows, density, open, connectionById, environments, folderColors, readOnlyHints, statuses, checks, onCheckFailure, disconnecting, onToggle, onRetry, onRefresh, onNewQuery, onOpenTable, onDisconnect, onKeyAction, onContextMenu, matches, searching, scrollResetKey, selectedKey, onSelect, reveal }: NavigatorListProps) {
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
  const rowHeight = navigatorMetrics[density].rowHeight;
  // eslint-disable-next-line react-hooks/incompatible-library -- o virtualizador devolve funções que não se memorizam; nada aqui depende disso.
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => rowHeight, overscan: 12, getItemKey: (index) => rows[index].key, measureElement: measureRendered, observeElementOffset: observeRenderedOffset });

  // RN-NAV-011: a densidade mudou (em Configurações, com a árvore escondida por baixo, ou noutra janela, com ela à mostra). As alturas guardadas são as da
  // outra, inclusive as das linhas que rolaram para fora e não vão se medir de novo: a lista esquece todas, e cada uma vale a estimativa nova até ser medida.
  // As desenhadas são medidas de novo na hora (`remeasureRendered`): a de erro não muda de caixa com a densidade, e nada mais a mediria.
  const measuredDensity = useRef(density);
  useLayoutEffect(() => {
    if (measuredDensity.current === density) return;
    measuredDensity.current = density;
    remeasureRendered(virtualizer);
  }, [density, virtualizer]);

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

  /**
   * Põe o foco na linha pedida, rolando até ela antes quando ela está fora das desenhadas: a lista só a desenha depois da rolagem, e a distância (o type-ahead
   * salta para qualquer ponto da árvore) pode pedir mais de um quadro, então a cada quadro se pede a rolagem de novo e se tenta, até a linha existir.
   * Nesse meio-tempo a linha que tinha o foco sai da janela e deixa de existir, e o foco cairia no `body`, que perderia a tecla seguinte: por isso o foco
   * espera na própria árvore (`pendingFocus` guarda o destino, e o `onKeyDown` dela segue o type-ahead a partir dele).
   */
  const focusFrame = useRef(0);
  const pendingFocus = useRef<number | null>(null);
  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);
  function focusRow(target: number | null) {
    if (target === null) return;
    cancelAnimationFrame(focusFrame.current);
    let frames = 0;
    const attempt = () => {
      const row = scrollRef.current?.querySelector<HTMLElement>(`[data-index="${target}"] [data-row-toggle]`);
      if (row !== null && row !== undefined) {
        pendingFocus.current = null;
        row.focus();
        return;
      }

      if (frames === 0) {
        pendingFocus.current = target;
        scrollRef.current?.focus({ preventScroll: true });
      }
      virtualizer.scrollToIndex(target, { align: "auto" });
      if (++frames < 30) focusFrame.current = requestAnimationFrame(attempt);
      else pendingFocus.current = null;
    };
    attempt();
  }

  // RN-ARVORE-009: digitar as primeiras letras de um nome leva a escolha e o foco ao item visível que começa por elas.
  const typeAhead = useTypeAhead();

  // Sem item que comece pelo texto, o foco fica onde está (o indicador diz). A seleção vai junto com o foco, como na seta, e a linha ainda pode não
  // estar desenhada: o foco dela só chega depois da rolagem.
  function goTo(jump: { target: number | null }) {
    if (jump.target === null) return;
    onSelect(rows[jump.target].key);
    focusRow(jump.target);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>, node: NavNode, index: number) {
    const jump = typeAhead.press(event, () => typeAheadLabels(rows), index);
    if (jump !== null) goTo(jump);
    else if (event.key === "ArrowDown") move(event, index, 1);
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
    } else if (event.key === "ArrowLeft") {
      // Num nó aberto, fecha; num nó fechado ou numa folha, leva ao pai (o padrão das árvores), e a próxima seta fecha ele.
      event.preventDefault();
      if (node.hasChildren && open.has(node.key)) onToggle(node);
      else focusRow(parentRowIndex(rows, index));
    } else {
      // O F2 na pasta e na conexão abre o "Renomear" dela (RN-NAV-009), o mesmo item que o menu mostra com o atalho.
      const action = keyActionFor(node, event);
      if (action === null) return;
      event.preventDefault();
      onKeyAction(node, action);
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        role="tree"
        aria-label={copy.tree}
        // O espaço vazio da árvore recebe o foco do clique (o botão direito nele abre o menu do navegador, e o foco volta para cá quando ele fecha), sem
        // entrar no Tab: as linhas são a parada de tabulação. Com o foco aqui, Shift+F10 e a tecla de menu abrem o mesmo menu (RN-MENU-001).
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          // O foco espera aqui a linha de um salto longo ser desenhada (`focusRow`): a tecla desse intervalo segue o type-ahead a partir do destino.
          const jump = pendingFocus.current === null ? null : typeAhead.press(event, () => typeAheadLabels(rows), pendingFocus.current);
          if (jump !== null) {
            goTo(jump);
            return;
          }
          if (!(event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) return;
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
            const folderId = node.kind === "folder" ? folderIdOf(node) : null;
            const environment = folderId !== null ? environments.folder(folderId) : connection ? environments.connection(connection) : null;

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
                  density={density}
                  index={item.index}
                  open={open.has(node.key)}
                  tabbable={node.key === tabbable}
                  selected={node.key === selectedKey}
                  connection={connection}
                  environment={environment}
                  folderColor={folderId === null ? null : (folderColors.get(folderId) ?? null)}
                  readOnly={connection ? (readOnlyHints.get(connection.id) ?? null) : null}
                  status={connection ? statuses.get(connection.id) : undefined}
                  check={connection ? (checks.get(connection.id) ?? null) : null}
                  onCheckFailure={onCheckFailure}
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
      <TypeAheadIndicator shown={typeAhead.shown} />
    </div>
  );
}
