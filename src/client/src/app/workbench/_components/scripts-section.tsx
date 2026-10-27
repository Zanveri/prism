import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import type { NavigatorDensity } from "@/app/settings/_lib/preferences";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button, ChevronIcon, ConfirmDialog, ContextMenu, FolderIcon, useToast, type ContextMenuItem } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { unwrap } from "@/lib/api/prism-api";
import { cn } from "@/lib/utils/cn";

import { notConnectedIds } from "../_lib/connection-checks";
import { databaseSessionQuery } from "../_lib/database-sessions.service";
import { editScriptErrors, type EditScriptErrors } from "../_lib/edit-script-errors";
import { navigatorMetrics, rowIndent } from "../_lib/navigator-density";
import { ignoresContextMenu } from "../_lib/navigator-menu";
import { appearanceChanged, normalizeScriptName, refusalProblem, savedPlaceOfTab, scriptFolderMenu, scriptIconOf, scriptMenu, scriptNameProblem, scriptPlace, type ScriptAction, type ScriptAppearance, type ScriptFolderAction } from "../_lib/saved-scripts";
import { scriptFoldersQuery } from "../_lib/script-folders.service";
import { ancestorIds, buildScriptTree, folderIdOf, folderKey, scriptKey, scriptTreeLabels, scriptTreeMove, scriptTreeRowKey, visibleScriptRows, type ScriptTreeRow } from "../_lib/script-tree";
import { scriptsCopy } from "../_lib/scripts.copy";
import type { Script, ScriptFolder, ScriptSummary } from "../_lib/scripts.schema";
import { changeScriptPlace, deleteScript, editScriptOrRefuse, getScript, renameScriptOrRefuse, scriptsQuery } from "../_lib/scripts.service";
import { connectionChecks } from "../_lib/use-connection-checks";
import { useOpenFolders, useScriptsCollapsed } from "../_lib/use-navigator-layout";
import { useTypeAhead, type TypeAhead } from "../_lib/use-type-ahead";
import { connectedConnectionIds } from "../_lib/workbench-model";
import { useWorkbench } from "../_lib/workbench-state";
import { EditScriptDialog, ScriptNameDialog } from "./script-dialogs";
import { ScriptIconView } from "./script-icon";
import { TypeAheadIndicator } from "./type-ahead-indicator";
import { useScriptFolderActions } from "./use-script-folder-actions";

const copy = scriptsCopy;
const treeId = "navigator-scripts";
const actionLabels: Record<ScriptAction, string> = { open: copy.menu.open, rename: copy.menu.rename, edit: copy.menu.edit, move: copy.menu.move, copySql: copy.menu.copySql, makeGeneric: copy.menu.makeGeneric, bind: copy.menu.bind, delete: copy.menu.delete };
const folderActionLabels: Record<ScriptFolderAction, string> = { newSubfolder: copy.folders.menu.newSubfolder, rename: copy.folders.menu.rename, move: copy.folders.menu.move, delete: copy.folders.menu.delete };

/** O id da linha na página: é por ele que a linha que acabou de ser criada, renomeada ou movida ganha o foco (RN-SCRIPT-008). */
export const scriptRowDomId = (key: string) => `${treeId}-${key.replace(":", "-")}`;

/** O que a linha pede pelo teclado e pelo duplo clique: Enter (a pasta abre e fecha, o script abre), F2 renomeia, Delete exclui. */
export type ScriptRowRequest = "enter" | "rename" | "delete";

type ScriptsTreeViewProps = {
  /** As linhas à vista (`visibleScriptRows`); `undefined` enquanto as listas não chegam. */
  rows: ScriptTreeRow[] | undefined;
  /** A densidade do navegador (RN-NAV-011): a altura das linhas e o recuo a cada nível. Sem ela, a confortável. */
  density?: NavigatorDensity;
  failed: boolean;
  /** A linha escolhida: é ela que entra no Tab, e a que o teclado move. */
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Abre ou fecha a pasta (a seta, o chevron, o Enter e o duplo clique). */
  onToggle: (key: string) => void;
  onRequest: (row: ScriptTreeRow, request: ScriptRowRequest) => void;
  onMenu: (row: ScriptTreeRow, point: { x: number; y: number }, initialFocus: "first" | "menu") => void;
  onRetry: () => void;
  /** RN-ARVORE-009: o texto digitado para ir a uma linha pelo nome e o indicador dele (`useTypeAhead`, da seção). Sem ele, a árvore não responde às letras. */
  typeAhead?: TypeAhead;
};

/**
 * A árvore da seção "Scripts" (RN-SCRIPT-008): as pastas de scripts e os scripts, com o papel de árvore e o nome "Scripts salvos", cada linha com o nível
 * dela, e a pasta que tem alguma coisa dentro dizendo se está aberta (a vazia não tem a seta). Só desenha: em cada nível as subpastas e depois os scripts, por
 * nome (`buildScriptTree`); uma linha só no Tab, a escolhida, ou a primeira; as setas, Home e End andam e abrem e fecham (`scriptTreeMove`); Enter e o duplo
 * clique abrem e fecham a pasta e abrem o script, F2 renomeia, Delete exclui, Shift+F10 e a tecla de menu abrem o menu; digitar as primeiras letras de um nome
 * leva a escolha e o foco à linha à vista que começa por elas (RN-ARVORE-009, `typeAhead`). A pasta tem o ícone neutro; o
 * script, o ícone e a cor dele (RN-SCRIPT-006) e a marca discreta do genérico (RN-SCRIPT-005). A densidade (RN-NAV-011) dá a altura e o recuo.
 */
export function ScriptsTreeView({ rows, density = "comfortable", failed, selectedKey, onSelect, onToggle, onRequest, onMenu, onRetry, typeAhead }: ScriptsTreeViewProps) {
  if (failed)
    return (
      <div className="flex flex-col items-start gap-2 px-3 py-2 text-sm text-muted">
        <p>{copy.section.failed}</p>
        <Button type="button" variant="secondary" size="compact" onClick={onRetry} className="px-3">
          {copy.section.retry}
        </Button>
      </div>
    );
  if (rows === undefined) return <p className="px-3 py-2 text-sm text-muted">{copy.section.loading}</p>;
  if (rows.length === 0) return <p className="px-3 py-2 text-sm text-muted">{copy.section.empty}</p>;

  const metrics = navigatorMetrics[density];
  const tabbable = rows.some((row) => row.node.key === selectedKey) ? selectedKey : rows[0].node.key;

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>, row: ScriptTreeRow, index: number) {
    const jump = typeAhead?.press(event, () => scriptTreeLabels(rows!), index) ?? null;
    if (jump !== null) {
      // Sem linha que comece pelo texto, o foco fica onde está (o indicador diz). O foco rola a seção até a linha.
      if (jump.target === null) return;
      onSelect(rows![jump.target].node.key);
      (event.currentTarget.parentElement?.children[jump.target] as HTMLElement | undefined)?.focus();
      return;
    }

    const move = scriptTreeMove(event.key, rows!, index);
    if (move !== null) {
      event.preventDefault();
      if ("toggle" in move) return onToggle(move.toggle);
      onSelect(rows![move.focus].node.key);
      (event.currentTarget.parentElement?.children[move.focus] as HTMLElement | undefined)?.focus();
      return;
    }

    const request = scriptTreeRowKey(event);
    if (request === null) return;
    event.preventDefault();
    if (request !== "menu") return onRequest(row, request);
    const { left, bottom } = event.currentTarget.getBoundingClientRect();
    onMenu(row, { x: left + 28, y: bottom }, "first");
  }

  return (
    <>
      <ul id={treeId} role="tree" aria-label={copy.section.list} className="flex flex-col pb-2">
        {rows.map((row, index) => {
          const { node, expanded } = row;
          const isFolder = node.kind === "folder";
          const name = isFolder ? node.folder.name : node.script.name;
          const generic = !isFolder && node.script.connectionID === null;

          return (
            <li
              key={node.key}
              id={scriptRowDomId(node.key)}
              role="treeitem"
              aria-level={node.depth + 1}
              aria-expanded={expanded ?? undefined}
              aria-selected={node.key === selectedKey}
              tabIndex={node.key === tabbable ? 0 : -1}
              title={isFolder ? copy.section.folderHint(name) : generic ? copy.section.rowHintGeneric(name) : copy.section.rowHint(name)}
              onClick={() => onSelect(node.key)}
              onDoubleClick={() => onRequest(row, "enter")}
              onKeyDown={(event) => handleKeyDown(event, row, index)}
              onContextMenu={(event: MouseEvent<HTMLLIElement>) => {
                event.preventDefault();
                event.stopPropagation();
                onSelect(node.key);
                onMenu(row, { x: event.clientX, y: event.clientY }, "menu");
              }}
              style={{ paddingLeft: rowIndent(metrics, node.depth) }}
              className={cn(
                "mx-1.5 flex cursor-pointer items-center gap-1.5 rounded-md pr-2 text-sm outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
                metrics.rowClass,
                node.key === selectedKey ? "bg-selected text-ink" : "text-body hover:bg-selected/60 hover:text-ink",
              )}
            >
              {expanded === null ? (
                <span aria-hidden className="size-4 flex-none" />
              ) : (
                <span
                  aria-hidden
                  data-chevron
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(node.key);
                    onToggle(node.key);
                  }}
                  className="-m-1 flex-none p-1"
                >
                  <ChevronIcon className={cn("text-subtle transition-transform", !expanded && "-rotate-90")} />
                </span>
              )}
              {isFolder ? <FolderIcon className="flex-none text-muted" /> : <ScriptIconView icon={scriptIconOf(node.script)} color={node.script.color} className="flex-none text-subtle" />}
              <span className="min-w-0 truncate">{name}</span>
              {generic ? <span className="ml-auto flex-none text-xs text-subtle">{copy.section.generic}</span> : null}
            </li>
          );
        })}
      </ul>
      {/* No pé da seção, sobre as linhas: grudado na borda de baixo de quem rola, sem altura, para o indicador não empurrar nada. */}
      {typeAhead === undefined ? null : (
        <div className="sticky bottom-0 h-0">
          <TypeAheadIndicator shown={typeAhead.shown} />
        </div>
      )}
    </>
  );
}

type Menu = { target: ScriptTreeRow | null; point: { x: number; y: number }; initialFocus: "first" | "menu" };

/**
 * A seção "Scripts" do navegador (RN-SCRIPT-003 e 008): a árvore das pastas de scripts e dos scripts do usuário. O script abre (duplo clique ou Enter), se
 * renomeia, tem "Editar script…" (o nome, o ícone e a cor, RN-SCRIPT-006), "Mover para…" (RN-SCRIPT-009), "Copiar SQL", "Tornar genérico" ou "Vincular à
 * conexão da aba" (RN-SCRIPT-005) e se exclui (com confirmação). A pasta tem "Nova subpasta", "Renomear", "Mover para…" e "Excluir" (só a vazia), e o título
 * e o espaço vazio da seção, "Nova pasta" (`useScriptFolderActions`). Aberto, o script vira uma aba de consulta na conexão e no banco em que foi salvo; se a
 * conexão não existe mais, a aba abre sem conexão e pede uma. O genérico abre na única conexão conectada, ou sem conexão, e a faixa pergunta. O SQL só é lido
 * para abrir e para copiar, pela rota do item, e não fica no cache da tela.
 *
 * As pastas começam fechadas e voltam abertas ou fechadas como a pessoa as deixou, por usuário (RN-SCRIPT-008 e RN-NAV-014, `useOpenFolders`). Recolhida, a seção
 * fica só com o título, e a escolha é lembrada por usuário (RN-NAV-012, `useScriptsCollapsed`). Depois de criar, renomear ou mover uma pasta ou um script, a
 * linha fica à vista (as pastas acima abrem, e se lembram), escolhida e com o foco.
 */
export function ScriptsSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { tabs, openScriptTab, renameScript, forgetScript, setScriptPlace } = useWorkbench();
  const scripts = useQuery(scriptsQuery);
  const folders = useQuery(scriptFoldersQuery);
  const density = usePreferences().preferences.ui.navigatorDensity;
  // RN-NAV-012: recolhida ou aberta, como a pessoa a deixou, também na próxima entrada.
  const [collapsed, setCollapsed] = useScriptsCollapsed();
  const expanded = !collapsed;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // RN-SCRIPT-008 e RN-NAV-014: as pastas abertas são as lembradas; as que não estão aí estão fechadas. Quem escreve é um evento ou um efeito.
  const [openFolderIds, changeFolders] = useOpenFolders("scripts");
  const openFolderKeys = useMemo(() => new Set([...openFolderIds].map(folderKey)), [openFolderIds]);
  // A linha que acabou de ser criada, renomeada ou movida, à espera de estar na página para ganhar o foco.
  const pendingFocus = useRef<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [renaming, setRenaming] = useState<{ script: ScriptSummary; pending: boolean; error: string | null } | null>(null);
  const [editing, setEditing] = useState<{ script: ScriptSummary; pending: boolean; errors: EditScriptErrors } | null>(null);
  const [deleting, setDeleting] = useState<{ script: ScriptSummary; pending: boolean } | null>(null);
  const section = useRef<HTMLElement>(null);

  const folderList = useMemo(() => folders.data ?? [], [folders.data]);
  const scriptList = useMemo(() => scripts.data ?? [], [scripts.data]);
  const tree = useMemo(() => buildScriptTree(folderList, scriptList), [folderList, scriptList]);
  const loaded = scripts.data !== undefined && folders.data !== undefined;
  const rows = useMemo(() => (loaded ? visibleScriptRows(tree, openFolderKeys) : undefined), [loaded, tree, openFolderKeys]);
  const typeAhead = useTypeAhead();

  // RN-NAV-014: a pasta excluída sai do que se lembra, na primeira lista de pastas desta montagem (a lida depois dela, e não a que o cache já tinha).
  const pruned = useRef(false);
  useEffect(() => {
    if (pruned.current || folders.data === undefined || !folders.isFetchedAfterMount) return;
    pruned.current = true;
    changeFolders({ retain: folders.data.map((folder) => folder.id) });
  }, [folders.data, folders.isFetchedAfterMount, changeFolders]);

  // Depois de cada renderização: a linha esperada que já está na página ganha o foco, uma vez.
  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null || typeof document === "undefined") return;
    const row = document.getElementById(scriptRowDomId(key));
    if (row === null) return;
    pendingFocus.current = null;
    row.focus();
  });

  /**
   * RN-SCRIPT-008 e RN-NAV-014: depois de criar, renomear ou mover, a linha fica à vista (a seção aberta, as pastas acima dela abertas e lembradas), escolhida e
   * com o foco. As pastas acima são as da lista que acabou de ser lida. Vem de um evento (o fim de uma chamada à API), então pode escrever na loja.
   */
  function reveal(key: string, parentID: string | null) {
    const above = ancestorIds(queryClient.getQueryData<ScriptFolder[]>(scriptFoldersQuery.queryKey) ?? folderList, parentID);
    const opening = above.length > 0 && changeFolders({ open: above });
    if (collapsed) setCollapsed(false);
    setSelectedKey(key);
    // A linha que já está na página (nenhuma pasta acima dela a abrir, a seção aberta) ganha o foco já. Esperar o efeito seria esperar uma renderização que pode
    // não vir (nenhum estado mudou: a linha já era a escolhida), e o pedido ficaria armado até uma renderização qualquer depois, que tiraria o foco de onde a
    // pessoa estivesse (o editor, ao digitar). A que ainda vai aparecer espera a renderização que as pastas abertas pedem: `changeFolders` diz se alguma abriu.
    const row = opening || collapsed || typeof document === "undefined" ? null : document.getElementById(scriptRowDomId(key));
    if (row !== null) {
      pendingFocus.current = null;
      row.focus();
    } else pendingFocus.current = key;
  }

  const folderActions = useScriptFolderActions({ folders: folderList, scripts: scriptList, reveal });

  const refresh = () => queryClient.invalidateQueries({ queryKey: scriptsQuery.queryKey });
  // O texto do script, pela rota do item: o que lança (o script sumiu, a API caiu) vai ao aviso central.
  const read = (script: ScriptSummary) => throughMutationCache(queryClient, async (): Promise<Script> => unwrap(await getScript(script.id))).catch(() => null);

  /** Abre ou fecha a pasta, e a escolha fica lembrada (RN-NAV-014). */
  function toggle(key: string) {
    const id = folderIdOf(key);
    if (id !== null) changeFolders(openFolderKeys.has(key) ? { close: [id] } : { open: [id] });
  }

  async function open(summary: ScriptSummary) {
    const script = await read(summary);
    if (script === null) return void refresh();

    const known = queryClient.getQueryData<Connection[]>(connectionsQuery.queryKey);
    // RN-SCRIPT-005: as conectadas deste instante (a sessão da árvore em cache, ou a de uma aba, menos as que a verificação achou sem sessão na API), para
    // o genérico abrir na única que houver.
    const connected = connectedConnectionIds(
      (known ?? []).map((connection) => connection.id),
      tabs,
      (connectionId) => queryClient.getQueryData(databaseSessionQuery(connectionId).queryKey) !== undefined,
      new Set(notConnectedIds(connectionChecks.snapshot())),
    );
    const place = scriptPlace(script, known === undefined ? null : new Set(known.map((connection) => connection.id)), connected);
    openScriptTab(script, { connectionId: place.connectionId, ...(place.database === undefined ? {} : { database: place.database }), saved: place.saved });
    if (place.missing) toast.warning(copy.toasts.connectionMissing(script.name));
  }

  /** A aba deste script nesta janela, se ela tem conexão: é a conexão que "Vincular à conexão da aba" grava (RN-SCRIPT-005). */
  const boundTab = (script: ScriptSummary) => tabs.find((tab) => tab.script?.id === script.id && tab.table === undefined && tab.connectionId !== null);

  // RN-SCRIPT-005: só o lugar muda, pelo PATCH; o nome e o SQL ficam. As abas do script guardam o lugar novo e refazem o ponto. A recusa vai ao aviso central.
  async function changePlace(script: ScriptSummary, action: "makeGeneric" | "bind") {
    const tab = action === "bind" ? boundTab(script) : undefined;
    if (action === "bind" && tab === undefined) return;

    const place = tab === undefined ? ({ generic: true } as const) : { connectionID: tab.connectionId, database: tab.database ?? null };
    const done = await throughMutationCache(queryClient, async () => unwrap(await changeScriptPlace(script.id, place))).then(
      () => true,
      () => false,
    );
    void refresh();
    if (!done) return;

    setScriptPlace(script.id, tab === undefined ? { generic: true } : savedPlaceOfTab(tab, false));
    const connection = tab === undefined ? undefined : queryClient.getQueryData<Connection[]>(connectionsQuery.queryKey)?.find((candidate) => candidate.id === tab.connectionId);
    toast.success(tab === undefined ? copy.toasts.madeGeneric(script.name) : copy.toasts.bound(script.name, connection?.name ?? ""));
  }

  async function copySql(summary: ScriptSummary) {
    const script = await read(summary);
    if (script === null) return void refresh();
    try {
      await navigator.clipboard.writeText(script.sql);
      toast.success(copy.toasts.copied);
    } catch {
      toast.error(copy.toasts.copyFailed);
    }
  }

  function act(script: ScriptSummary, action: ScriptAction) {
    setSelectedKey(scriptKey(script.id));
    if (action === "open") void open(script);
    else if (action === "copySql") void copySql(script);
    else if (action === "rename") setRenaming({ script, pending: false, error: null });
    else if (action === "edit") setEditing({ script, pending: false, errors: {} });
    else if (action === "move") folderActions.moveScript(script);
    else if (action === "makeGeneric" || action === "bind") void changePlace(script, action);
    else setDeleting({ script, pending: false });
  }

  function actOnFolder(folder: ScriptFolder, action: ScriptFolderAction) {
    if (action === "newSubfolder") folderActions.create(folder.id);
    else if (action === "rename") folderActions.rename(folder);
    else if (action === "move") folderActions.moveFolder(folder);
    else folderActions.remove(folder);
  }

  function request(row: ScriptTreeRow, asked: ScriptRowRequest) {
    const { node } = row;
    if (node.kind === "script") return act(node.script, asked === "enter" ? "open" : asked);
    setSelectedKey(node.key);
    if (asked === "enter") return row.expanded === null ? undefined : toggle(node.key);
    actOnFolder(node.folder, asked);
  }

  async function submitRename(name: string) {
    if (renaming === null || renaming.pending) return;
    const { script } = renaming;
    const problem = scriptNameProblem(name, scripts.data ?? [], script.id);
    if (problem !== null) return setRenaming({ ...renaming, error: copy.errors[problem] });

    setRenaming({ ...renaming, pending: true, error: null });
    const result = await throughMutationCache(queryClient, () => renameScriptOrRefuse(script.id, normalizeScriptName(name))).catch(() => null);
    if (result === null) return setRenaming((current) => (current === null ? null : { ...current, pending: false }));
    if (!result.ok) {
      const refused = refusalProblem(result.error.code, name);
      if (refused === "taken") void refresh();
      return setRenaming((current) => (current === null ? null : { ...current, pending: false, error: refused === null ? result.error.title : copy.errors[refused] }));
    }

    setRenaming(null);
    renameScript(script.id, result.data.name);
    toast.success(copy.toasts.renamed(result.data.name));
    await refresh();
    reveal(scriptKey(script.id), result.data.folderID);
  }

  /**
   * RN-SCRIPT-006: o "Editar script…" grava o nome, o ícone e a cor. O nome passa pela conferência de sempre (a do renomear); sem nada mudado, fecha sem
   * chamar a API. O nome novo vai ao título das abas do script; o ícone e a cor chegam à lista e às abas pela lista, que se atualiza.
   */
  async function submitEdit(edited: ScriptAppearance) {
    if (editing === null || editing.pending) return;
    const { script } = editing;
    const problem = scriptNameProblem(edited.name, scripts.data ?? [], script.id);
    if (problem !== null) return setEditing({ ...editing, errors: { name: copy.errors[problem] } });
    if (!appearanceChanged(script, edited)) return setEditing(null);

    setEditing({ ...editing, pending: true, errors: {} });
    const result = await throughMutationCache(queryClient, () => editScriptOrRefuse(script.id, edited)).catch(() => null);
    if (result === null) return setEditing((current) => (current === null ? null : { ...current, pending: false }));
    if (!result.ok) {
      if (result.error.code === "SCRIPT_ALREADY_EXISTS") void refresh();
      const errors = editScriptErrors(result.error, edited.name);
      return setEditing((current) => (current === null ? null : { ...current, pending: false, errors }));
    }

    setEditing(null);
    if (result.data.name !== script.name) renameScript(script.id, result.data.name);
    toast.success(copy.toasts.edited(result.data.name));
    void refresh();
  }

  async function confirmDelete() {
    if (deleting === null || deleting.pending) return;
    const { script } = deleting;
    setDeleting({ script, pending: true });
    const result = await throughMutationCache(queryClient, async () => unwrap(await deleteScript(script.id))).then(
      () => true,
      () => false,
    );
    setDeleting(null);
    void refresh();
    if (!result) return;
    forgetScript(script.id);
    toast.success(copy.toasts.deleted(script.name));
  }

  function menuGroups(target: ScriptTreeRow | null): ContextMenuItem[][] {
    // RN-SCRIPT-009: o título e o espaço vazio da seção têm "Nova pasta", que cria na raiz.
    if (target === null) return [[{ id: "newFolder", label: copy.folders.menu.newFolder, onSelect: () => folderActions.create(null) }]];

    const { node } = target;
    if (node.kind === "folder") {
      const { contents } = node;
      const empty = contents.folders === 0 && contents.scripts === 0;
      return scriptFolderMenu({ empty }).map((group) =>
        group.map(({ action, disabled }) => ({
          id: action,
          label: folderActionLabels[action],
          ...(action === "rename" ? { shortcut: "F2" } : action === "delete" ? { shortcut: "Delete" } : {}),
          ...(disabled ? { disabled: true, hint: copy.folders.notEmpty(contents.folders, contents.scripts) } : {}),
          onSelect: () => actOnFolder(node.folder, action),
        })),
      );
    }

    const { script } = node;
    return scriptMenu({ generic: script.connectionID === null, bindable: boundTab(script) !== undefined }).map((group) =>
      group.map(({ action, disabled }) => ({
        id: action,
        label: actionLabels[action],
        ...(action === "open" ? { shortcut: "Enter" } : action === "rename" ? { shortcut: "F2" } : action === "delete" ? { shortcut: "Delete" } : {}),
        ...(disabled ? { disabled: true, hint: copy.menu.bindUnavailable } : {}),
        onSelect: () => act(script, action),
      })),
    );
  }

  function openMenu(target: ScriptTreeRow | null, point: { x: number; y: number }, initialFocus: "first" | "menu") {
    if (ignoresContextMenu(menu?.initialFocus ?? null, initialFocus)) return;
    setMenu({ target, point, initialFocus });
  }

  function titleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const { left, bottom } = event.currentTarget.getBoundingClientRect();
    openMenu(null, { x: left + 28, y: bottom }, "first");
  }

  const menuLabel = menu === null ? "" : menu.target === null ? copy.section.sectionMenuLabel : menu.target.node.kind === "folder" ? copy.folders.menuLabel(menu.target.node.folder.name) : copy.section.menuLabel(menu.target.node.script.name);

  return (
    <section ref={section} aria-label={copy.section.title} className={cn("flex min-h-0 flex-none flex-col border-t border-border", expanded && "max-h-[40%]")}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={treeId}
        title={expanded ? copy.section.hide : copy.section.show}
        onClick={() => setCollapsed(expanded)}
        onKeyDown={titleKeyDown}
        onContextMenu={(event) => {
          event.preventDefault();
          openMenu(null, { x: event.clientX, y: event.clientY }, "menu");
        }}
        className="flex h-8 flex-none cursor-pointer items-center gap-1.5 px-3 text-xs font-semibold tracking-[0.06em] text-muted uppercase hover:text-ink"
      >
        <ChevronIcon className={cn("flex-none transition-transform", !expanded && "-rotate-90")} />
        <span>{copy.section.title}</span>
        {scripts.data === undefined || scripts.data.length === 0 ? null : <span className="font-normal tracking-normal normal-case">({scripts.data.length.toLocaleString("pt-BR")})</span>}
      </button>
      <div
        hidden={!expanded}
        onContextMenu={(event) => {
          // O espaço vazio da seção: a linha para o evento antes, com o menu dela.
          event.preventDefault();
          openMenu(null, { x: event.clientX, y: event.clientY }, "menu");
        }}
        className="min-h-0 overflow-y-auto"
      >
        <ScriptsTreeView
          rows={rows}
          density={density}
          failed={(scripts.isError && scripts.data === undefined) || (folders.isError && folders.data === undefined)}
          selectedKey={selectedKey}
          onSelect={setSelectedKey}
          onToggle={toggle}
          onRequest={request}
          onMenu={openMenu}
          typeAhead={typeAhead}
          onRetry={() => {
            void scripts.refetch();
            void folders.refetch();
          }}
        />
      </div>

      {menu === null ? null : <ContextMenu key={`${menu.target?.node.key ?? "section"}@${menu.point.x},${menu.point.y}`} label={menuLabel} point={menu.point} initialFocus={menu.initialFocus} groups={menuGroups(menu.target)} onClose={() => setMenu(null)} />}

      {renaming === null ? null : (
        <ScriptNameDialog
          title={copy.rename.title}
          submitLabel={copy.rename.confirm}
          pendingLabel={copy.rename.renaming}
          initialName={renaming.script.name}
          pending={renaming.pending}
          error={renaming.error}
          onSubmit={(name) => void submitRename(name)}
          onCancel={() => setRenaming(null)}
        />
      )}

      {editing === null ? null : <EditScriptDialog script={editing.script} pending={editing.pending} errors={editing.errors} onSubmit={(edited) => void submitEdit(edited)} onCancel={() => setEditing(null)} />}

      {deleting === null ? null : (
        <ConfirmDialog
          open
          tone="danger"
          title={copy.delete.title(deleting.script.name)}
          description={copy.delete.description}
          confirmLabel={copy.delete.confirm}
          pending={deleting.pending}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleting(null)}
        />
      )}

      {folderActions.dialogs}
    </section>
  );
}
