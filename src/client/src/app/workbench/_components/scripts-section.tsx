import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import { Button, ChevronIcon, ConfirmDialog, ContextMenu, useToast, type ContextMenuItem } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { unwrap } from "@/lib/api/prism-api";
import { cn } from "@/lib/utils/cn";

import { databaseSessionQuery } from "../_lib/database-sessions.service";
import { ignoresContextMenu } from "../_lib/navigator-menu";
import { appearanceChanged, normalizeScriptName, refusalProblem, savedPlaceOfTab, scriptIconOf, scriptKeyTarget, scriptMenu, scriptNameProblem, scriptPlace, scriptRowKey, type ScriptAction, type ScriptAppearance } from "../_lib/saved-scripts";
import { scriptsCopy } from "../_lib/scripts.copy";
import type { Script, ScriptSummary } from "../_lib/scripts.schema";
import { changeScriptPlace, deleteScript, editScriptOrRefuse, getScript, renameScriptOrRefuse, scriptsQuery } from "../_lib/scripts.service";
import { connectedConnectionIds } from "../_lib/workbench-model";
import { useWorkbench } from "../_lib/workbench-state";
import { EditScriptDialog, ScriptNameDialog } from "./script-dialogs";
import { ScriptIconView } from "./script-icon";

const copy = scriptsCopy;
const listId = "navigator-scripts";
const actionLabels: Record<ScriptAction, string> = { open: copy.menu.open, rename: copy.menu.rename, edit: copy.menu.edit, copySql: copy.menu.copySql, makeGeneric: copy.menu.makeGeneric, bind: copy.menu.bind, delete: copy.menu.delete };

type ScriptsListViewProps = {
  scripts: ScriptSummary[] | undefined;
  failed: boolean;
  /** O script da linha escolhida: é ela que entra no Tab, e a que o teclado move. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAction: (script: ScriptSummary, action: ScriptAction) => void;
  onMenu: (script: ScriptSummary, point: { x: number; y: number }, initialFocus: "first" | "menu") => void;
  onRetry: () => void;
};

/**
 * A lista da seção "Scripts" (RN-SCRIPT-003), já em ordem de nome (a da API). Só desenha: o duplo clique e o Enter abrem, F2 renomeia, Delete exclui, as
 * setas, Home e End andam, Shift+F10 e a tecla de menu abrem o menu. Uma linha só entra no Tab: a escolhida, ou a primeira. O script genérico (sem conexão,
 * RN-SCRIPT-005) leva a marca discreta "genérico" ao lado do nome, que o leitor de tela também lê. Cada linha tem o ícone do script, na cor dele
 * (RN-SCRIPT-006); sem cor, o neutro.
 */
export function ScriptsListView({ scripts, failed, selectedId, onSelect, onAction, onMenu, onRetry }: ScriptsListViewProps) {
  if (failed)
    return (
      <div className="flex flex-col items-start gap-2 px-3 py-2 text-sm text-muted">
        <p>{copy.section.failed}</p>
        <Button type="button" variant="secondary" size="compact" onClick={onRetry} className="px-3">
          {copy.section.retry}
        </Button>
      </div>
    );
  if (scripts === undefined) return <p className="px-3 py-2 text-sm text-muted">{copy.section.loading}</p>;
  if (scripts.length === 0) return <p className="px-3 py-2 text-sm text-muted">{copy.section.empty}</p>;

  const tabbable = scripts.some((script) => script.id === selectedId) ? selectedId : scripts[0].id;

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>, script: ScriptSummary, index: number, list: ScriptSummary[]) {
    const target = scriptKeyTarget(event.key, index, list.length);
    if (target !== null) {
      event.preventDefault();
      onSelect(list[target].id);
      (event.currentTarget.parentElement?.children[target] as HTMLElement | undefined)?.focus();
      return;
    }

    const action = scriptRowKey(event);
    if (action === null) return;
    event.preventDefault();
    if (action !== "menu") return onAction(script, action);
    const { left, bottom } = event.currentTarget.getBoundingClientRect();
    onMenu(script, { x: left + 28, y: bottom }, "first");
  }

  return (
    <ul id={listId} role="listbox" aria-label={copy.section.list} className="flex flex-col pb-2">
      {scripts.map((script, index, list) => (
        <li
          key={script.id}
          role="option"
          aria-selected={script.id === selectedId}
          tabIndex={script.id === tabbable ? 0 : -1}
          title={script.connectionID === null ? copy.section.rowHintGeneric(script.name) : copy.section.rowHint(script.name)}
          onClick={() => onSelect(script.id)}
          onDoubleClick={() => onAction(script, "open")}
          onKeyDown={(event) => handleKeyDown(event, script, index, list)}
          onContextMenu={(event: MouseEvent<HTMLLIElement>) => {
            event.preventDefault();
            onSelect(script.id);
            onMenu(script, { x: event.clientX, y: event.clientY }, "menu");
          }}
          className={cn(
            "mx-1.5 flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
            script.id === selectedId ? "bg-selected text-ink" : "text-body hover:bg-selected/60 hover:text-ink",
          )}
        >
          <ScriptIconView icon={scriptIconOf(script)} color={script.color} className="flex-none text-subtle" />
          <span className="min-w-0 truncate">{script.name}</span>
          {script.connectionID === null ? <span className="ml-auto flex-none text-xs text-subtle">{copy.section.generic}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * A seção "Scripts" do navegador (RN-SCRIPT-003): os scripts do usuário, em ordem de nome, com abrir (duplo clique ou Enter), renomear, "Editar script…" (o
 * nome, o ícone e a cor, RN-SCRIPT-006), excluir (com confirmação), "Copiar SQL" e "Tornar genérico" ou "Vincular à conexão da aba" (RN-SCRIPT-005). Aberto, o script vira uma aba de consulta na conexão e no
 * banco em que foi salvo; se a conexão não existe mais, a aba abre sem conexão e pede uma. O genérico abre na única conexão conectada, ou sem conexão, e a
 * faixa pergunta. O SQL só é lido para abrir e para copiar, pela rota do item, e não fica no cache da tela (passa pelo cache de mutações e sai dele).
 */
export function ScriptsSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { tabs, openScriptTab, renameScript, forgetScript, setScriptPlace } = useWorkbench();
  const scripts = useQuery(scriptsQuery);
  const [expanded, setExpanded] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ script: ScriptSummary; point: { x: number; y: number }; initialFocus: "first" | "menu" } | null>(null);
  const [renaming, setRenaming] = useState<{ script: ScriptSummary; pending: boolean; error: string | null } | null>(null);
  const [editing, setEditing] = useState<{ script: ScriptSummary; pending: boolean; errors: { name?: string; color?: string } } | null>(null);
  const [deleting, setDeleting] = useState<{ script: ScriptSummary; pending: boolean } | null>(null);
  const section = useRef<HTMLElement>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: scriptsQuery.queryKey });
  // O texto do script, pela rota do item: o que lança (o script sumiu, a API caiu) vai ao aviso central.
  const read = (script: ScriptSummary) => throughMutationCache(queryClient, async (): Promise<Script> => unwrap(await getScript(script.id))).catch(() => null);

  async function open(summary: ScriptSummary) {
    const script = await read(summary);
    if (script === null) return void refresh();

    const known = queryClient.getQueryData<Connection[]>(connectionsQuery.queryKey);
    // RN-SCRIPT-005: as conectadas deste instante (a sessão da árvore em cache, ou a de uma aba), para o genérico abrir na única que houver.
    const connected = connectedConnectionIds(
      (known ?? []).map((connection) => connection.id),
      tabs,
      (connectionId) => queryClient.getQueryData(databaseSessionQuery(connectionId).queryKey) !== undefined,
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
    setSelectedId(script.id);
    if (action === "open") void open(script);
    else if (action === "copySql") void copySql(script);
    else if (action === "rename") setRenaming({ script, pending: false, error: null });
    else if (action === "edit") setEditing({ script, pending: false, errors: {} });
    else if (action === "makeGeneric" || action === "bind") void changePlace(script, action);
    else setDeleting({ script, pending: false });
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
    void refresh();
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
      const refused = refusalProblem(result.error.code, edited.name);
      if (refused === "taken") void refresh();
      const errors = result.error.code === "SCRIPT_ICON_INVALID" ? { color: result.error.title } : { name: refused === null ? result.error.title : copy.errors[refused] };
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

  const menuGroups: ContextMenuItem[][] =
    menu === null
      ? []
      : scriptMenu({ generic: menu.script.connectionID === null, bindable: boundTab(menu.script) !== undefined }).map((group) =>
          group.map(({ action, disabled }) => ({
            id: action,
            label: actionLabels[action],
            ...(action === "open" ? { shortcut: "Enter" } : action === "rename" ? { shortcut: "F2" } : action === "delete" ? { shortcut: "Delete" } : {}),
            ...(disabled ? { disabled: true, hint: copy.menu.bindUnavailable } : {}),
            onSelect: () => act(menu.script, action),
          })),
        );

  return (
    <section ref={section} aria-label={copy.section.title} className={cn("flex min-h-0 flex-none flex-col border-t border-border", expanded && "max-h-[40%]")}>
      <button type="button" aria-expanded={expanded} aria-controls={listId} title={expanded ? copy.section.hide : copy.section.show} onClick={() => setExpanded((current) => !current)} className="flex h-8 flex-none cursor-pointer items-center gap-1.5 px-3 text-xs font-semibold tracking-[0.06em] text-muted uppercase hover:text-ink">
        <ChevronIcon className={cn("flex-none transition-transform", !expanded && "-rotate-90")} />
        <span>{copy.section.title}</span>
        {scripts.data === undefined || scripts.data.length === 0 ? null : <span className="font-normal tracking-normal normal-case">({scripts.data.length.toLocaleString("pt-BR")})</span>}
      </button>
      <div hidden={!expanded} className="min-h-0 overflow-y-auto">
        <ScriptsListView
          scripts={scripts.data}
          failed={scripts.isError && scripts.data === undefined}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onAction={act}
          onMenu={(script, point, initialFocus) => {
            if (ignoresContextMenu(menu?.initialFocus ?? null, initialFocus)) return;
            setMenu({ script, point, initialFocus });
          }}
          onRetry={() => void scripts.refetch()}
        />
      </div>

      {menu === null ? null : <ContextMenu key={`${menu.script.id}@${menu.point.x},${menu.point.y}`} label={copy.section.menuLabel(menu.script.name)} point={menu.point} initialFocus={menu.initialFocus} groups={menuGroups} onClose={() => setMenu(null)} />}

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
    </section>
  );
}
