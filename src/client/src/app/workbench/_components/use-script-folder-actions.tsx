import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ConfirmDialog, useToast } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { unwrap } from "@/lib/api/prism-api";

import { normalizeScriptName } from "../_lib/saved-scripts";
import { createScriptFolderOrRefuse, deleteScriptFolder, moveScriptFolder, renameScriptFolderOrRefuse, scriptFoldersQuery } from "../_lib/script-folders.service";
import { folderContents, folderKey, scriptFolderNameProblem, scriptFolderOptions, scriptFolderPath, scriptFolderRefusal, scriptKey } from "../_lib/script-tree";
import { scriptsCopy } from "../_lib/scripts.copy";
import type { ScriptFolder, ScriptSummary } from "../_lib/scripts.schema";
import { moveScript, scriptsQuery } from "../_lib/scripts.service";
import { MoveToFolderDialog, ScriptFolderNameDialog } from "./script-folder-dialogs";

const copy = scriptsCopy.folders;

/** O diálogo aberto: o nome da pasta nova ou da renomeada, o "Mover para…" (de uma pasta ou de um script) ou a pergunta de excluir a pasta vazia. */
type Open =
  | { kind: "create"; parentID: string | null; pending: boolean; error: string | null }
  | { kind: "rename"; folder: ScriptFolder; pending: boolean; error: string | null }
  | { kind: "moveFolder"; folder: ScriptFolder; value: string; pending: boolean }
  | { kind: "moveScript"; script: ScriptSummary; value: string; pending: boolean }
  | { kind: "delete"; folder: ScriptFolder; pending: boolean };

export type ScriptFolderActions = {
  /** "Nova pasta" (na raiz, `parentID` nulo) e "Nova subpasta". */
  create: (parentID: string | null) => void;
  rename: (folder: ScriptFolder) => void;
  moveFolder: (folder: ScriptFolder) => void;
  moveScript: (script: ScriptSummary) => void;
  /** "Excluir" e o Delete na pasta: a vazia pergunta; a que tem alguma coisa dentro dá o aviso de erro com o motivo, sem perguntar. */
  remove: (folder: ScriptFolder) => void;
  dialogs: ReactNode;
};

/**
 * RN-SCRIPT-009: os diálogos das pastas de scripts e o "Mover para…" do script, com as chamadas à API. As recusas do nome ficam no campo, sem aviso de erro
 * (RN-AVISO-004); as de regra (a pasta pai ou a de destino que outra janela excluiu, o nome repetido no destino, o ciclo, a pasta que não está vazia) vão ao
 * aviso central com o detalhe da API, o diálogo fica aberto (a pergunta de excluir fecha), e as listas são lidas de novo. Depois de criar, renomear ou mover,
 * `reveal` recebe a linha e a pasta acima dela, para a seção a deixar à vista e escolhida, com o foco (RN-SCRIPT-008).
 *
 * As chamadas passam pelo cache de mutações (o que lança vai ao aviso central) e têm o prazo das ações da pessoa.
 */
export function useScriptFolderActions({ folders, scripts, reveal }: { folders: readonly ScriptFolder[]; scripts: readonly ScriptSummary[]; reveal: (key: string, parentID: string | null) => void }): ScriptFolderActions {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState<Open | null>(null);

  const listed = (folderID: string | null) => (folderID !== null && folders.some((folder) => folder.id === folderID) ? folderID : "");
  /** As duas listas de novo: uma recusa pode vir de uma lista velha (outra janela mexeu nas pastas ou nos scripts no meio). */
  const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: scriptFoldersQuery.queryKey }), queryClient.invalidateQueries({ queryKey: scriptsQuery.queryKey })]);
  /** As listas como foram lidas por último (depois de `refresh`, as de agora); sem elas, as desta renderização. */
  const latestFolders = () => queryClient.getQueryData<ScriptFolder[]>(scriptFoldersQuery.queryKey) ?? folders;
  const latestScripts = () => queryClient.getQueryData<ScriptSummary[]>(scriptsQuery.queryKey) ?? scripts;
  /**
   * A pasta como a lista mais recente a tem. O PATCH grava a pasta inteira (o nome e a pasta pai), e a do diálogo é a de quando ele abriu: renomear com a
   * pasta pai de então desfaria o "Mover" que outra janela fez depois de a lista desta ser lida de novo.
   */
  const currentOf = (folder: ScriptFolder) => latestFolders().find((candidate) => candidate.id === folder.id) ?? folder;
  /** Tira o "…ando…" do diálogo que continua aberto depois de uma falha que foi ao aviso central. */
  const settle = () => setOpen((current) => (current === null || current.kind === "delete" ? current : { ...current, pending: false }));

  /**
   * Depois de uma falha que foi ao aviso central, as listas são lidas de novo, e o diálogo segue o que elas dizem. O do item que outra janela excluiu fecha:
   * não há mais o que renomear nem mover (a regra só deixa o diálogo aberto pela pasta pai e pela de destino). O destino que saiu da lista volta a "Sem
   * pasta", que é o que o campo já mostra (o `Select` não acha a escolhida entre as opções): o "Mover" seguinte faz o que o campo diz, em vez de mandar de
   * novo a pasta que não existe mais.
   */
  async function afterRefusal() {
    settle();
    await refresh();
    const nowFolders = latestFolders();
    const nowScripts = latestScripts();
    setOpen((current) => {
      if (current === null || current.kind === "create" || current.kind === "delete") return current;
      if (current.kind !== "moveScript" && !nowFolders.some((folder) => folder.id === current.folder.id)) return null;
      if (current.kind === "moveScript" && !nowScripts.some((script) => script.id === current.script.id)) return null;
      if (current.kind === "rename" || current.value === "") return current;
      const options = scriptFolderOptions(nowFolders, current.kind === "moveFolder" ? current.folder.id : undefined);
      return options.some((option) => option.value === current.value) ? current : { ...current, value: "" };
    });
  }

  async function submitName(name: string) {
    if (open === null || (open.kind !== "create" && open.kind !== "rename") || open.pending) return;

    const normalized = normalizeScriptName(name);
    const renamed = open.kind === "rename" ? currentOf(open.folder) : null;
    if (renamed !== null && normalized === renamed.name) return setOpen(null);
    const parentID = open.kind === "create" ? open.parentID : (renamed ?? open.folder).parentID;
    const problem = scriptFolderNameProblem(name, folders, parentID, open.kind === "rename" ? open.folder.id : undefined);
    if (problem !== null) return setOpen({ ...open, error: copy.errors[problem] });

    setOpen({ ...open, pending: true, error: null });
    const result = await throughMutationCache(queryClient, () => (open.kind === "create" ? createScriptFolderOrRefuse({ name: normalized, parentID }) : renameScriptFolderOrRefuse(renamed ?? open.folder, normalized))).catch(() => null);
    if (result === null) return afterRefusal();
    if (!result.ok) {
      const refused = scriptFolderRefusal(result.error.code, name);
      if (refused === "taken") void refresh();
      return setOpen((current) => (current === null || (current.kind !== "create" && current.kind !== "rename") ? current : { ...current, pending: false, error: refused === null ? result.error.title : copy.errors[refused] }));
    }

    setOpen(null);
    toast.success(open.kind === "create" ? copy.toasts.created : copy.toasts.renamed);
    await refresh();
    reveal(folderKey(result.data.id), result.data.parentID);
  }

  async function submitMove() {
    if (open === null || (open.kind !== "moveFolder" && open.kind !== "moveScript") || open.pending) return;

    const destination = open.value === "" ? null : open.value;
    const folderNow = open.kind === "moveFolder" ? currentOf(open.folder) : null;
    const current = open.kind === "moveFolder" ? (folderNow ?? open.folder).parentID : open.script.folderID;
    if (destination === current) return setOpen(null);

    setOpen({ ...open, pending: true });
    const moved = await throughMutationCache(queryClient, async () => {
      if (open.kind === "moveFolder") return folderKey(unwrap(await moveScriptFolder(folderNow ?? open.folder, destination)).id);
      return scriptKey(unwrap(await moveScript(open.script.id, destination)).id);
    }).catch(() => null);
    if (moved === null) return afterRefusal();

    setOpen(null);
    toast.success(open.kind === "moveFolder" ? copy.toasts.moved : scriptsCopy.toasts.moved);
    await refresh();
    reveal(moved, destination);
  }

  async function confirmDelete() {
    if (open === null || open.kind !== "delete" || open.pending) return;

    setOpen({ ...open, pending: true });
    const done = await throughMutationCache(queryClient, async () => unwrap(await deleteScriptFolder(open.folder.id))).then(
      () => true,
      () => false,
    );
    setOpen(null);
    if (done) toast.success(copy.toasts.deleted);
    void refresh();
  }

  function remove(folder: ScriptFolder) {
    const contents = folderContents(folders, scripts, folder.id);
    if (contents.folders > 0 || contents.scripts > 0) return toast.error(copy.notEmpty(contents.folders, contents.scripts));
    setOpen({ kind: "delete", folder, pending: false });
  }

  let dialogs: ReactNode = null;
  if (open?.kind === "create" || open?.kind === "rename") {
    const creating = open.kind === "create";
    const path = creating ? scriptFolderPath(folders, open.parentID) : null;
    dialogs = (
      <ScriptFolderNameDialog
        title={!creating ? copy.rename.title : open.parentID === null ? copy.create.title : copy.create.titleSub}
        place={creating ? (path === null ? copy.create.atRoot : copy.create.inside(path)) : undefined}
        submitLabel={creating ? copy.create.submit : copy.rename.submit}
        pendingLabel={creating ? copy.create.submitting : copy.rename.submitting}
        initialName={creating ? "" : open.folder.name}
        pending={open.pending}
        error={open.error}
        onSubmit={(name) => void submitName(name)}
        onCancel={() => (open.pending ? undefined : setOpen(null))}
      />
    );
  } else if (open?.kind === "moveFolder" || open?.kind === "moveScript") {
    const isFolder = open.kind === "moveFolder";
    dialogs = (
      <MoveToFolderDialog
        title={isFolder ? copy.move.titleFolder : copy.move.titleScript}
        name={isFolder ? open.folder.name : open.script.name}
        value={open.value}
        options={scriptFolderOptions(folders, isFolder ? open.folder.id : undefined)}
        pending={open.pending}
        onChange={(value) => setOpen((current) => (current === null || (current.kind !== "moveFolder" && current.kind !== "moveScript") ? current : { ...current, value }))}
        onSubmit={() => void submitMove()}
        onCancel={() => (open.pending ? undefined : setOpen(null))}
      />
    );
  } else if (open?.kind === "delete") {
    dialogs = (
      <ConfirmDialog
        open
        tone="danger"
        title={copy.remove.title(open.folder.name)}
        description={copy.remove.description}
        confirmLabel={copy.remove.submit}
        pendingLabel={copy.remove.submitting}
        pending={open.pending}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setOpen(null)}
      />
    );
  }

  return {
    create: (parentID) => setOpen({ kind: "create", parentID, pending: false, error: null }),
    rename: (folder) => setOpen({ kind: "rename", folder, pending: false, error: null }),
    // A de agora já escolhida; a que não está na lista (a árvore pôs o item na raiz, RN-SCRIPT-008) é "Sem pasta", como a árvore a mostra.
    moveFolder: (folder) => setOpen({ kind: "moveFolder", folder, value: listed(folder.parentID), pending: false }),
    moveScript: (script) => setOpen({ kind: "moveScript", script, value: listed(script.folderID), pending: false }),
    remove,
    dialogs,
  };
}
