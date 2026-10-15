import { useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import type { NavigatorDensity } from "@/app/settings/_lib/preferences";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button, ChevronIcon, ConfirmDialog, ContextMenu, DocumentIcon, useToast, type ContextMenuItem } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { unwrap } from "@/lib/api/prism-api";
import { cn } from "@/lib/utils/cn";

import { navigatorMetrics } from "../_lib/navigator-density";
import { ignoresContextMenu } from "../_lib/navigator-menu";
import { normalizeScriptName, refusalProblem, scriptKeyTarget, scriptMenu, scriptNameProblem, scriptPlace, scriptRowKey, type ScriptAction } from "../_lib/saved-scripts";
import { scriptsCopy } from "../_lib/scripts.copy";
import type { Script, ScriptSummary } from "../_lib/scripts.schema";
import { deleteScript, getScript, renameScriptOrRefuse, scriptsQuery } from "../_lib/scripts.service";
import { useScriptsCollapsed } from "../_lib/use-navigator-layout";
import { useWorkbench } from "../_lib/workbench-state";
import { ScriptNameDialog } from "./script-dialogs";

const copy = scriptsCopy;
const listId = "navigator-scripts";
const actionLabels: Record<ScriptAction, string> = { open: copy.menu.open, rename: copy.menu.rename, copySql: copy.menu.copySql, delete: copy.menu.delete };

type ScriptsListViewProps = {
  scripts: ScriptSummary[] | undefined;
  /** A densidade do navegador (RN-NAV-011): a altura das linhas. Sem ela, a confortável. */
  density?: NavigatorDensity;
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
 * setas, Home e End andam, Shift+F10 e a tecla de menu abrem o menu. Uma linha só entra no Tab: a escolhida, ou a primeira.
 */
export function ScriptsListView({ scripts, density = "comfortable", failed, selectedId, onSelect, onAction, onMenu, onRetry }: ScriptsListViewProps) {
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
          title={copy.section.rowHint(script.name)}
          onClick={() => onSelect(script.id)}
          onDoubleClick={() => onAction(script, "open")}
          onKeyDown={(event) => handleKeyDown(event, script, index, list)}
          onContextMenu={(event: MouseEvent<HTMLLIElement>) => {
            event.preventDefault();
            onSelect(script.id);
            onMenu(script, { x: event.clientX, y: event.clientY }, "menu");
          }}
          className={cn(
            "mx-1.5 flex cursor-pointer items-center gap-2 rounded-md px-2 text-sm outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
            navigatorMetrics[density].scriptRowClass,
            script.id === selectedId ? "bg-selected text-ink" : "text-body hover:bg-selected/60 hover:text-ink",
          )}
        >
          <DocumentIcon className="flex-none text-subtle" />
          <span className="min-w-0 truncate">{script.name}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A seção "Scripts" do navegador (RN-SCRIPT-003): os scripts do usuário, em ordem de nome, com abrir (duplo clique ou Enter), renomear, excluir (com
 * confirmação) e "Copiar SQL". Aberto, o script vira uma aba de consulta na conexão e no banco em que foi salvo; se a conexão não existe mais, a aba abre sem
 * conexão e pede uma. O SQL só é lido para abrir e para copiar, pela rota do item, e não fica no cache da tela (passa pelo cache de mutações e sai dele).
 * Recolhida, ela fica só com o título, e a escolha é lembrada por usuário (RN-NAV-012, `useScriptsCollapsed`).
 */
export function ScriptsSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { openScriptTab, renameScript, forgetScript } = useWorkbench();
  const scripts = useQuery(scriptsQuery);
  const density = usePreferences().preferences.ui.navigatorDensity;
  // RN-NAV-012: recolhida ou aberta, como a pessoa a deixou, também na próxima entrada.
  const [collapsed, setCollapsed] = useScriptsCollapsed();
  const expanded = !collapsed;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ script: ScriptSummary; point: { x: number; y: number }; initialFocus: "first" | "menu" } | null>(null);
  const [renaming, setRenaming] = useState<{ script: ScriptSummary; pending: boolean; error: string | null } | null>(null);
  const [deleting, setDeleting] = useState<{ script: ScriptSummary; pending: boolean } | null>(null);
  const section = useRef<HTMLElement>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: scriptsQuery.queryKey });
  // O texto do script, pela rota do item: o que lança (o script sumiu, a API caiu) vai ao aviso central.
  const read = (script: ScriptSummary) => throughMutationCache(queryClient, async (): Promise<Script> => unwrap(await getScript(script.id))).catch(() => null);

  async function open(summary: ScriptSummary) {
    const script = await read(summary);
    if (script === null) return void refresh();

    const known = queryClient.getQueryData<Connection[]>(connectionsQuery.queryKey);
    const place = scriptPlace(script, known === undefined ? null : new Set(known.map((connection) => connection.id)));
    openScriptTab(script, { connectionId: place.connectionId, ...(place.database === undefined ? {} : { database: place.database }) });
    if (place.missing) toast.warning(copy.toasts.connectionMissing(script.name));
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
    menu === null ? [] : scriptMenu().map((group) => group.map(({ action }) => ({ id: action, label: actionLabels[action], ...(action === "open" ? { shortcut: "Enter" } : action === "rename" ? { shortcut: "F2" } : action === "delete" ? { shortcut: "Delete" } : {}), onSelect: () => act(menu.script, action) })));

  return (
    <section ref={section} aria-label={copy.section.title} className={cn("flex min-h-0 flex-none flex-col border-t border-border", expanded && "max-h-[40%]")}>
      <button type="button" aria-expanded={expanded} aria-controls={listId} title={expanded ? copy.section.hide : copy.section.show} onClick={() => setCollapsed(expanded)} className="flex h-8 flex-none cursor-pointer items-center gap-1.5 px-3 text-xs font-semibold tracking-[0.06em] text-muted uppercase hover:text-ink">
        <ChevronIcon className={cn("flex-none transition-transform", !expanded && "-rotate-90")} />
        <span>{copy.section.title}</span>
        {scripts.data === undefined || scripts.data.length === 0 ? null : <span className="font-normal tracking-normal normal-case">({scripts.data.length.toLocaleString("pt-BR")})</span>}
      </button>
      <div hidden={!expanded} className="min-h-0 overflow-y-auto">
        <ScriptsListView
          scripts={scripts.data}
          density={density}
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
