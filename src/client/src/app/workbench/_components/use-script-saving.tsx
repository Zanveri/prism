import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";

import { liveEditors } from "../_lib/live-editors";
import { copyName, exceedsScriptLimit, normalizeScriptName, refusalProblem, savedPlaceOfTab, scriptNameProblem, suggestScriptName, type SavedPlace } from "../_lib/saved-scripts";
import { scriptFoldersQuery } from "../_lib/script-folders.service";
import { initialSaveFolder, scriptFolderOptions, scriptFolderPath } from "../_lib/script-tree";
import { scriptsCopy } from "../_lib/scripts.copy";
import type { ScriptFolder, ScriptSummary } from "../_lib/scripts.schema";
import { createScriptOrRefuse, overwriteScriptOrRefuse, scriptsQuery } from "../_lib/scripts.service";
import { useWorkbench, type QueryTab } from "../_lib/workbench-state";
import { ScriptNameDialog } from "./script-dialogs";

const copy = scriptsCopy;

export type SaveMode = "save" | "saveAs";

/** O diálogo do nome aberto: a aba, o modo, a sugestão, como a caixa do script genérico nasce (RN-SCRIPT-005) e quem espera a resposta. */
type Asking = { tabId: string; mode: SaveMode; initialName: string; generic: { initial: boolean; locked: boolean }; resolve: (saved: boolean) => void };

/** O campo "Pasta" do diálogo (RN-SCRIPT-010): a escolhida (vazio é "Sem pasta") e a recusa da pasta que outra janela excluiu. */
type FolderChoice = { value: string; error: string | null };

/**
 * RN-SCRIPT-001: Ctrl+S e Ctrl+Shift+S de uma aba de consulta. O texto é o do editor DESTE instante (`liveEditors`; o da aba chega com atraso). A aba que já é
 * um script grava por cima, com o lugar dela (a conexão e o banco), e o script genérico continua genérico (RN-SCRIPT-005); a que não é, e o "Salvar como",
 * pedem o nome, com a sugestão e a caixa do script genérico (marcada no "Salvar como" de um genérico, e presa marcada na aba sem conexão). Um script que outra
 * janela excluiu pede o nome de novo, como na primeira vez. `save` devolve se gravou: é o que o fechar com mudança não salva espera antes de seguir.
 *
 * RN-SCRIPT-010: o diálogo do nome tem o campo "Pasta", que vem com a pasta do script de onde a aba veio (`initialSaveFolder`), e o aviso diz onde o script
 * ficou. A pasta que outra janela excluiu antes de gravar é recusada no campo, a lista é lida de novo, e nada se grava. Gravar por cima não muda a pasta, e a
 * árvore não abre a pasta nem tira o foco do editor.
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
  const [folder, setFolder] = useState<FolderChoice>({ value: "", error: null });
  // As pastas de scripts (RN-SCRIPT-010), para o campo "Pasta": a mesma consulta da seção Scripts, que a lê de novo quando a escolhida some.
  const folders = useQuery(scriptFoldersQuery);

  // A gravação espera a API e o diálogo: lê sempre a lista de abas mais recente.
  const latestTabs = useRef(tabs);
  useEffect(() => {
    latestTabs.current = tabs;
  });

  const tabOf = (tabId: string) => latestTabs.current.find((tab) => tab.id === tabId && tab.table === undefined);
  const liveSql = (tab: QueryTab) => liveEditors.snapshot(tab.id)?.sql ?? tab.sql;
  const knownScripts = useCallback(() => queryClient.getQueryData<ScriptSummary[]>(scriptsQuery.queryKey) ?? [], [queryClient]);
  const knownFolders = useCallback(() => queryClient.getQueryData<ScriptFolder[]>(scriptFoldersQuery.queryKey) ?? [], [queryClient]);

  /** A aba passa a ser do script gravado, e lembra a pasta dele (RN-SCRIPT-010). `where` é o caminho da pasta do script novo, para o aviso dizer onde ficou. */
  const finish = useCallback(
    (tab: QueryTab, saved: ScriptSummary, sql: string, place: SavedPlace, where: string | null = null) => {
      setTabScript(tab.id, { id: saved.id, name: saved.name, ...(saved.folderID === null ? {} : { folderId: saved.folderID }) }, sql, place);
      void queryClient.invalidateQueries({ queryKey: scriptsQuery.queryKey });
      toast.success(where === null ? copy.toasts.saved(saved.name) : copy.toasts.savedIn(saved.name, where));
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

      // RN-SCRIPT-010: de que script a aba veio, para a pasta que o diálogo traz escolhida; o que outra janela excluiu, pela pasta que a aba lembra.
      let source: { scriptId: string | null; remembered: string | null } = mode === "saveAs" && tab.script !== undefined ? { scriptId: tab.script.id, remembered: tab.script.folderId ?? null } : { scriptId: null, remembered: null };
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
        // Outra janela excluiu o script: a aba deixa de ser dele, e pede um nome como na primeira vez, com a pasta que ele tinha.
        source = { scriptId: script.id, remembered: script.folderId ?? null };
        forgetScript(script.id);
      }

      const names = knownScripts();
      const initialName = mode === "saveAs" && tab.script !== undefined ? copyName(tab.script.name, names) : suggestScriptName(names);
      const generic = { initial: mode === "saveAs" && tab.script?.generic === true, locked: tab.connectionId === null };
      const initialFolder = initialSaveFolder(source, names, knownFolders());
      return new Promise<boolean>((resolve) => {
        setError(null);
        setFolder({ value: initialFolder, error: null });
        setAsking({ tabId, mode, initialName, generic, resolve });
      });
    },
    [queryClient, toast, finish, forgetScript, knownScripts, knownFolders],
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
    // RN-SCRIPT-010: a pasta escolhida que já não está na lista lida (outra janela a excluiu: a recusa anterior da API, ou a lista lida de novo sozinha) é
    // recusada no campo, sem ir à API: o campo já a mostra como "Sem pasta" (o `Select` não a acha entre as opções), e mandá-la daria a mesma recusa. A
    // pessoa escolhe de novo, e a escolha tira o erro.
    if (folder.value !== "" && folders.data !== undefined && !folders.data.some((candidate) => candidate.id === folder.value)) {
      setError(null);
      setFolder((current) => ({ ...current, error: copy.save.folderGone }));
      void queryClient.invalidateQueries({ queryKey: scriptFoldersQuery.queryKey });
      return;
    }

    setPending(true);
    // RN-SCRIPT-005: o genérico nasce sem conexão nem banco. RN-SCRIPT-010: na pasta escolhida, ou na raiz.
    const folderID = folder.value === "" ? null : folder.value;
    const result = await throughMutationCache(queryClient, () => createScriptOrRefuse({ name: normalizeScriptName(name), sql, connectionID: generic ? null : tab.connectionId, database: generic ? null : (tab.database ?? null), folderID })).catch(() => null);
    setPending(false);
    // A falha que não é do nome já foi ao aviso central; o diálogo fica, com o que foi digitado.
    if (result === null) return;
    if (!result.ok) {
      // RN-SCRIPT-010: a pasta escolhida que outra janela excluiu fica no campo dela, e a lista é lida de novo.
      if (result.error.code === "SCRIPT_FOLDER_NOT_FOUND") {
        setError(null);
        setFolder((current) => ({ ...current, error: copy.save.folderGone }));
        void queryClient.invalidateQueries({ queryKey: scriptFoldersQuery.queryKey });
        return;
      }
      const refused = refusalProblem(result.error.code, name);
      setError(refused === null ? result.error.title : copy.errors[refused]);
      // O nome repetido pode ser de um script que esta tela ainda não conhecia (salvo em outra janela).
      if (refused === "taken") void queryClient.invalidateQueries({ queryKey: scriptsQuery.queryKey });
      return;
    }

    finish(tab, result.data, sql, savedPlaceOfTab(tab, generic || tab.connectionId === null), scriptFolderPath(folders.data ?? knownFolders(), result.data.folderID));
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
        folder={{ value: folder.value, options: scriptFolderOptions(folders.data ?? []), error: folder.error, onChange: (value) => setFolder({ value, error: null }) }}
        onSubmit={(name, generic) => void submit(name, generic)}
        onCancel={cancel}
      />
    );

  return { save, dialog };
}
