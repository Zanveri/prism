import { useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import type { ToastAction } from "@/components/ui";
import { chooseImportSource, currentWindowId, importSourceStatus, releaseImportSource, transfersAvailable } from "@/lib/api/bridge";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { allowRefusal, type ApiResult } from "@/lib/api/prism-api";

import { nextTransferSeq } from "../data-export/data-exports";
import { forgetTransfer, getTransfer } from "../data-export/transfers.service";
import { readImportChoices, writeImportChoices } from "./import-choices";
import { createImportFlow, type ImportFlow } from "./import-flow";
import { importStartRefusals, previewImport, previewRefusals, readImportFile, readRefusals, startImport } from "./imports.service";
import { createLoadTracker, type LoadNotify, type LoadTable, type TrackedLoad } from "./load-tracker";

/**
 * As importações de dados e as cópias para outro banco desta janela (seção 36), de módulo como as exportações (`data-exports.ts`): o assistente "Importar
 * dados" aberto (um por janela, RN-IMPORT-002), o acompanhamento das importações e cópias começadas aqui (`loadTracker`), que a barra de status, o bloqueio
 * por inatividade e as saídas leem, e a marca das tabelas que receberam linhas, que os Registros abertos delas leem (RN-IMPORT-020). Quem liga os avisos e
 * o "Abrir registros", e esquece tudo ao sair do cofre, é o `WorkbenchProvider` (`connectLoads`).
 */

const silent: LoadNotify = { success: () => {}, warning: () => {}, error: () => {} };
let notices: LoadNotify = silent;
let openRecords: (table: LoadTable) => void = () => {};

/** A chave de uma tabela: a conexão, o banco de dados, o esquema e o nome, em JSON (o nome pode ter qualquer caractere). */
export const tableKey = (table: LoadTable) => JSON.stringify([table.connectionId, table.database ?? null, table.schema, table.name]);

/**
 * As tabelas que receberam (ou podem ter recebido) linhas, cada uma com um número que só sobe: os Registros abertos dela comparam com o número de quando
 * leram e mostram a nota "Linhas foram importadas nesta tabela depois da leitura." até ler de novo.
 */
const imported = new Map<string, number>();
let importedMark = 0;
const importedListeners = new Set<() => void>();

export function markImported(table: LoadTable): void {
  imported.set(tableKey(table), ++importedMark);
  for (const listener of importedListeners) listener();
}

/** O número da última importação na tabela (0: nenhuma nesta abertura da área de trabalho). */
export function importedMarkOf(table: LoadTable): number {
  return imported.get(tableKey(table)) ?? 0;
}

export function useImportedMark(table: LoadTable): number {
  const key = tableKey(table);
  return useSyncExternalStore(
    (listener) => {
      importedListeners.add(listener);
      return () => void importedListeners.delete(listener);
    },
    () => imported.get(key) ?? 0,
    () => 0,
  );
}

export const loadTracker = createLoadTracker({
  getTransfer: (id) => getTransfer(id),
  forget: (id) => forgetTransfer(id),
  notify: {
    success: (title: string, description?: string, action?: ToastAction) => notices.success(title, description, action),
    warning: (title: string, description?: string, action?: ToastAction) => notices.warning(title, description, action),
    error: (title: string, description?: string) => notices.error(title, description),
  },
  schedule(run, ms) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  openRecords: (table) => openRecords(table),
  markImported,
  sequence: nextTransferSeq,
});

export function useTrackedLoads(): readonly TrackedLoad[] {
  return useSyncExternalStore(loadTracker.subscribe, loadTracker.snapshot, loadTracker.snapshot);
}

/** O assistente "Importar dados" aberto nesta janela: a tabela de destino, o estado dele (`flow`) e um número que muda a cada abertura. */
export type ImportWizardRequest = { key: number; place: LoadTable; flow: ImportFlow };

/** O cache da área de trabalho (`connectLoads`): as rotas do assistente passam por ele, e a falha que não é recusa vai ao aviso central. */
let queryClient: QueryClient | null = null;

/** A chamada pelo cache de mutações, com as recusas que o assistente mostra devolvidas como valor (o resto lança e vai ao aviso central). */
function through<T>(call: () => Promise<ApiResult<T>>, refusals: readonly string[]): Promise<ApiResult<T>> {
  const client = queryClient;
  if (client === null) return call();
  return throughMutationCache(client, async () => allowRefusal(await call(), ...refusals));
}

/** O estado do assistente para a tabela, com as peças de verdade: a ponte, as rotas, o relógio e o acompanhamento. */
function wizardFlow(place: LoadTable): ImportFlow {
  const userName = queryClient?.getQueryData(sessionQuery.queryKey)?.userName ?? null;
  return createImportFlow({
    place: { connectionId: place.connectionId, ...(place.database === undefined ? {} : { database: place.database }), schema: place.schema, table: place.name },
    initialChoices: readImportChoices(userName),
    available: transfersAvailable,
    choose: chooseImportSource,
    status: importSourceStatus,
    release: releaseImportSource,
    read: (body) => through(() => readImportFile(body), readRefusals),
    preview: (body) => through(() => previewImport(body), previewRefusals),
    start: (body) => through(() => startImport(body), importStartRefusals),
    windowId: currentWindowId,
    schedule(run, ms) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    onStarted(job) {
      // Aceito o pedido (202), as escolhas são gravadas, a importação entra na barra de status, e o assistente fecha sem soltar o arquivo (é do trabalho).
      writeImportChoices(userName, job.choices);
      loadTracker.start({ id: job.id, kind: "import", sourceName: job.fileName, format: job.format, sheet: job.sheet, table: place, oneAtATime: job.oneAtATime, empty: job.empty, single: job.single });
      closeImportWizard();
    },
  });
}

let wizard: ImportWizardRequest | null = null;
let wizardKey = 0;
const wizardListeners = new Set<() => void>();

function publishWizard(next: ImportWizardRequest | null) {
  wizard = next;
  for (const listener of wizardListeners) listener();
}

/** Abre o assistente com a tabela de destino já escolhida (RN-IMPORT-001). Há um por vez: o pedido novo toma o lugar do aberto (e solta o arquivo dele). */
export function openImportWizard(place: LoadTable): void {
  wizard?.flow.close();
  publishWizard({ key: ++wizardKey, place, flow: wizardFlow(place) });
}

/** Fecha o assistente: Cancelar, Esc, o X, o bloqueio, as saídas. O arquivo copiado é solto, a não ser que a API já o tenha tomado (RN-IMPORT-002). */
export function closeImportWizard(): void {
  wizard?.flow.close();
  publishWizard(null);
}

export function useImportWizard(): ImportWizardRequest | null {
  return useSyncExternalStore(
    (listener) => {
      wizardListeners.add(listener);
      return () => void wizardListeners.delete(listener);
    },
    () => wizard,
    () => null,
  );
}

/**
 * A área de trabalho montou: os avisos das importações e cópias passam a sair, e o "Abrir registros" abre a aba nesta janela. Devolve o que fazer ao
 * desmontar (o cofre fechou): os avisos se calam, o assistente fecha (e solta o arquivo) e o acompanhamento e as marcas são esquecidos.
 */
export function connectLoads(toast: LoadNotify, open: (table: LoadTable) => void, client: QueryClient): () => void {
  notices = toast;
  openRecords = open;
  queryClient = client;
  return () => {
    notices = silent;
    openRecords = () => {};
    queryClient = null;
    closeImportWizard();
    loadTracker.reset();
    imported.clear();
  };
}
