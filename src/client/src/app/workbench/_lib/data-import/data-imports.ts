import { useEffect, useState, useSyncExternalStore } from "react";
import type { QueryClient } from "@tanstack/react-query";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import type { ToastAction } from "@/components/ui";
import { chooseImportSource, currentWindowId, importSourceStatus, releaseImportSource, transfersAvailable } from "@/lib/api/bridge";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { allowRefusal, type ApiResult } from "@/lib/api/prism-api";
import { vaultLock } from "@/lib/api/vault-lock";

import { exportTracker, nextTransferSeq, workbenchMounted } from "../data-export/data-exports";
import { createTransferExits } from "../data-export/export-exits";
import { cancelTransfers, forgetTransfer, getTransfer, transfersInProgress } from "../data-export/transfers.service";
import type { RunnerState } from "../use-query-runner";
import { readImportChoices, writeImportChoices } from "./import-choices";
import { createImportFlow, type ImportFlow } from "./import-flow";
import { importedAfterRead, initialReadWatch, watchRead, type ReadWatch } from "./imported-note";
import { importStartRefusals, previewImport, previewRefusals, readImportFile, readRefusals, startImport } from "./imports.service";
import { createLoadTracker, type LoadNotify, type LoadTable, type TrackedLoad } from "./load-tracker";
import { countsOf, noTransfers, type TransferCounts } from "./transfer-exits";

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

/**
 * O que cada aba de Registros viu das leituras dela (`imported-note.ts`), pelo executor da aba: a vista desmonta ao trocar para a Estrutura e volta a montar,
 * e o executor (com as linhas) fica.
 */
const readWatches = new WeakMap<object, ReadWatch>();

/**
 * RN-IMPORT-020: a nota "Linhas foram importadas nesta tabela depois da leitura." vale nos Registros desta tabela: o executor da aba é acompanhado enquanto
 * a vista está montada, e a nota sai quando a aba lê de novo.
 */
export function useImportedAfterRead(runner: { subscribe: (listener: () => void) => () => void; getState: () => RunnerState }, table: LoadTable): boolean {
  const mark = useImportedMark(table);
  // A cada mudança do executor, o React lê o estado de novo, e a passagem é anotada; `watchRead` devolve o mesmo objeto para o mesmo estado (ler duas
  // vezes não muda nada).
  const watch = useSyncExternalStore(
    runner.subscribe,
    () => {
      const now = importedMarkOf(table);
      const before = readWatches.get(runner) ?? initialReadWatch(runner.getState(), now);
      const next = watchRead(before, runner.getState(), now);
      readWatches.set(runner, next);
      return next;
    },
    () => null,
  );
  return watch !== null && importedAfterRead(watch, mark);
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

/** "Abrir registros" do diálogo "Importação interrompida" (RN-IMPORT-020): o mesmo do aviso, a aba dos Registros da tabela nesta janela. */
export function openLoadRecords(table: LoadTable): void {
  openRecords(table);
}

/**
 * As saídas que perguntam pelas transferências em andamento (RN-EXPORT-023 e RN-IMPORT-021), pela lista da API, de todas as janelas e de todos os tipos:
 * `ahead` conta, e `cancelForExit` cancela tudo depois da última resposta (as desta janela pelos acompanhamentos dela). Fora da área de trabalho (a tela de
 * entrada, o cofre bloqueado), nenhuma, sem pedir: o pedido com o cofre bloqueado esperaria o desbloqueio.
 */
export const transferExits = createTransferExits({
  open: () => workbenchMounted() && !vaultLock.isLocked(),
  list: transfersInProgress,
  forget: cancelTransfers,
  trackers: [exportTracker, loadTracker],
});

/** De quanto em quanto a conta de um aviso aberto é lida de novo: a transferência que termina, ou que começa noutra janela, muda a frase. */
const aheadEveryMs = 3_000;

/**
 * Quantas transferências estão em andamento, por tipo (de uma conexão, quando dada: a da origem ou a do destino), para a frase de um aviso que está na tela
 * (o reinício do serviço, a atualização, o diálogo de excluir a conexão). Lida ao abrir e a cada 3 segundos enquanto `enabled`; nenhuma antes da primeira
 * resposta e sem o cofre aberto.
 */
export function useTransfersAhead(enabled: boolean, connectionId?: string): TransferCounts {
  const [counts, setCounts] = useState<TransferCounts>(noTransfers);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const read = () =>
      void transferExits.ahead(connectionId).then((list) => {
        if (active) setCounts(countsOf(list));
      });
    read();
    const timer = setInterval(read, aheadEveryMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [enabled, connectionId]);
  return enabled ? counts : noTransfers;
}

/** As transferências começadas nesta janela que ainda não terminaram, por tipo: a pergunta de fechar a janela (RN-EXPORT-023 e RN-IMPORT-021). */
export function windowTransfers(): TransferCounts {
  return { exports: exportTracker.count(), ...loadTracker.counts() };
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
