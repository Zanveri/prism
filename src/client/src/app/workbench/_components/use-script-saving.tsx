import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";

import { liveEditors } from "../_lib/live-editors";
import { copyName, exceedsScriptLimit, normalizeScriptName, refusalProblem, savedPlaceOfTab, scriptNameProblem, suggestScriptName, type SavedPlace } from "../_lib/saved-scripts";
import { scriptsCopy } from "../_lib/scripts.copy";
import type { ScriptSummary } from "../_lib/scripts.schema";
import { createScriptOrRefuse, overwriteScriptOrRefuse, scriptsQuery } from "../_lib/scripts.service";
import { useWorkbench, type QueryTab } from "../_lib/workbench-state";
import { ScriptNameDialog } from "./script-dialogs";

const copy = scriptsCopy;

export type SaveMode = "save" | "saveAs";

/** O diálogo do nome aberto: a aba, o modo, a sugestão, como a caixa do script genérico nasce (RN-SCRIPT-005) e quem espera a resposta. */
type Asking = { tabId: string; mode: SaveMode; initialName: string; generic: { initial: boolean; locked: boolean }; resolve: (saved: boolean) => void };

/**
 * RN-SCRIPT-001: Ctrl+S e Ctrl+Shift+S de uma aba de consulta. O texto é o do editor DESTE instante (`liveEditors`; o da aba chega com atraso). A aba que já é
 * um script grava por cima, com o lugar dela (a conexão e o banco), e o script genérico continua genérico (RN-SCRIPT-005); a que não é, e o "Salvar como",
 * pedem o nome, com a sugestão e a caixa do script genérico (marcada no "Salvar como" de um genérico, e presa marcada na aba sem conexão). Um script que outra
 * janela excluiu pede o nome de novo, como na primeira vez. `save` devolve se gravou: é o que o fechar com mudança não salva espera antes de seguir.
 *
 * As chamadas passam pelo cache de mutações (o que não é recusa de nome vai ao aviso central) e não ficam nele, com o SQL, depois de responder.
 */
export function useScriptSaving(): { save: (tabId: string, mode: SaveMode) => Promise<boolean>; dialog: ReactNode } {
  const { tabs, setTabScript, forgetScript } = useWorkbench();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A gravação espera a API e o diálogo: lê sempre a lista de abas mais recente.
  const latestTabs = useRef(tabs);
  useEffect(() => {
    latestTabs.current = tabs;
  });

  const tabOf = (tabId: string) => latestTabs.current.find((tab) => tab.id === tabId && tab.table === undefined);
  const liveSql = (tab: QueryTab) => liveEditors.snapshot(tab.id)?.sql ?? tab.sql;
  const knownScripts = useCallback(() => queryClient.getQueryData<ScriptSummary[]>(scriptsQuery.queryKey) ?? [], [queryClient]);

  const finish = useCallback(
    (tab: QueryTab, saved: ScriptSummary, sql: string, place: SavedPlace) => {
      setTabScript(tab.id, { id: saved.id, name: saved.name }, sql, place);
      void queryClient.invalidateQueries({ queryKey: scriptsQuery.queryKey });
      toast.success(copy.toasts.saved(saved.name));
    },
    [setTabScript, queryClient, toast],
  );

  const save = useCallback(
    async (tabId: string, mode: SaveMode): Promise<boolean> => {
      const tab = latestTabs.current.find((candidate) => candidate.id === tabId && candidate.table === undefined);
      if (tab === undefined) return false;

      const sql = liveEditors.snapshot(tab.id)?.sql ?? tab.sql;
      // RN-SCRIPT-004: o que a API recusaria não sai daqui.
      if (exceedsScriptLimit(sql)) {
        toast.error(copy.toasts.tooLarge);
        return false;
      }

      if (mode === "save" && tab.script !== undefined) {
        const script = tab.script;
        // RN-SCRIPT-005: o genérico grava o texto e continua genérico, qualquer que seja a conexão da aba. A aba sem conexão manda a conexão nula, e o script
        // fica no lugar que tinha (o ausente fica).
        const generic = script.generic === true;
        const place = generic ? ({ generic: true } as const) : { connectionID: tab.connectionId, database: tab.database ?? null };
        const result = await throughMutationCache(queryClient, () => overwriteScriptOrRefuse({ id: script.id, sql, ...place })).catch(() => null);
        if (result === null) return false;
        if (result.ok) {
          finish(tab, result.data, sql, savedPlaceOfTab(tab, generic));
          return true;
        }
        if (result.error.code !== "SCRIPT_NOT_FOUND") {
          toast.error(copy.toasts.tooLarge);
          return false;
        }
        // Outra janela excluiu o script: a aba deixa de ser dele, e pede um nome como na primeira vez.
        forgetScript(script.id);
      }

      const names = knownScripts();
      const initialName = mode === "saveAs" && tab.script !== undefined ? copyName(tab.script.name, names) : suggestScriptName(names);
      const generic = { initial: mode === "saveAs" && tab.script?.generic === true, locked: tab.connectionId === null };
      return new Promise<boolean>((resolve) => {
        setError(null);
        setAsking({ tabId, mode, initialName, generic, resolve });
      });
    },
    [queryClient, toast, finish, forgetScript, knownScripts],
  );

  async function submit(name: string, generic: boolean) {
    if (asking === null || pending) return;

    const tab = tabOf(asking.tabId);
    if (tab === undefined) {
      asking.resolve(false);
      setAsking(null);
      return;
    }

    const problem = scriptNameProblem(name, knownScripts());
    if (problem !== null) return setError(copy.errors[problem]);
    const sql = liveSql(tab);
    if (exceedsScriptLimit(sql)) return setError(copy.errors.tooLarge);

    setPending(true);
    // RN-SCRIPT-005: o genérico nasce sem conexão nem banco.
    const result = await throughMutationCache(queryClient, () => createScriptOrRefuse({ name: normalizeScriptName(name), sql, connectionID: generic ? null : tab.connectionId, database: generic ? null : (tab.database ?? null) })).catch(() => null);
    setPending(false);
    // A falha que não é do nome já foi ao aviso central; o diálogo fica, com o que foi digitado.
    if (result === null) return;
    if (!result.ok) {
      const refused = refusalProblem(result.error.code, name);
      setError(refused === null ? result.error.title : copy.errors[refused]);
      // O nome repetido pode ser de um script que esta tela ainda não conhecia (salvo em outra janela).
      if (refused === "taken") void queryClient.invalidateQueries({ queryKey: scriptsQuery.queryKey });
      return;
    }

    finish(tab, result.data, sql, savedPlaceOfTab(tab, generic || tab.connectionId === null));
    asking.resolve(true);
    setAsking(null);
  }

  function cancel() {
    if (pending) return;
    asking?.resolve(false);
    setAsking(null);
  }

  const dialog =
    asking === null ? null : (
      <ScriptNameDialog
        title={asking.mode === "saveAs" ? copy.save.titleAs : copy.save.title}
        submitLabel={copy.save.save}
        pendingLabel={copy.save.saving}
        initialName={asking.initialName}
        pending={pending}
        error={error}
        generic={asking.generic}
        onSubmit={(name, generic) => void submit(name, generic)}
        onCancel={cancel}
      />
    );

  return { save, dialog };
}
