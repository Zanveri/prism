import { useSyncExternalStore } from "react";

import type { ToastAction } from "@/components/ui";
import { chooseExportDestination, copyExport, currentWindowId, deliverExport, releaseExportDestination, revealExport } from "@/lib/api/bridge";

import type { ExportSource } from "./export-source";
import { createTransferTracker, type TrackedExport, type TrackerNotify } from "./transfer-tracker";
import { forgetTransfer, getTransfer, listTransfers } from "./transfers.service";

/**
 * As exportações de dados desta janela (seção 35), de módulo como o `vaultLock` e a verificação das conexões: o assistente aberto (um por janela, RN-EXPORT-003)
 * e o acompanhamento das exportações começadas aqui (`exportTracker`), que a barra de status, o bloqueio por inatividade e as saídas leem. Quem liga os avisos
 * e esquece tudo ao sair do cofre é o `WorkbenchProvider` (`connectExports`).
 */

const silent: TrackerNotify = { success: () => {}, warning: () => {}, error: () => {} };

/** A ordem em que as transferências desta janela começaram (exportações, importações e cópias): a barra de status mostra a mais antiga (RN-EXPORT-021). */
let transferSeq = 0;
export const nextTransferSeq = () => ++transferSeq;
let notices: TrackerNotify = silent;

export const exportTracker = createTransferTracker({
  getTransfer: (id) => getTransfer(id),
  forget: (id) => forgetTransfer(id),
  deliver: deliverExport,
  copy: copyExport,
  chooseDestination: chooseExportDestination,
  release: releaseExportDestination,
  reveal: revealExport,
  notify: {
    success: (title: string, description?: string, action?: ToastAction) => notices.success(title, description, action),
    warning: (title: string, description?: string, action?: ToastAction) => notices.warning(title, description, action),
    error: (title: string, description?: string) => notices.error(title, description),
  },
  schedule(run, ms) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  sequence: nextTransferSeq,
});

/** A área de trabalho está montada nesta janela: o cofre está aberto (`connectExports`). */
let vaultOpen = false;

/** O cofre está aberto nesta janela (a área de trabalho montada): as saídas só perguntam à API por transferências com ele (`transferExits`). */
export const workbenchMounted = () => vaultOpen;

/** O assistente aberto nesta janela: a origem e um número que muda a cada abertura (o diálogo nasce de novo). */
export type ExportWizardRequest = { key: number; source: ExportSource };

let wizard: ExportWizardRequest | null = null;
let wizardKey = 0;
const wizardListeners = new Set<() => void>();

function publishWizard(next: ExportWizardRequest | null) {
  wizard = next;
  for (const listener of wizardListeners) listener();
}

/** Abre o assistente "Exportar dados" com a origem já escolhida (RN-EXPORT-001). Há um por vez: o pedido novo toma o lugar do aberto. */
export function openExportWizard(source: ExportSource): void {
  publishWizard({ key: ++wizardKey, source });
}

export function closeExportWizard(): void {
  publishWizard(null);
}

export function useExportWizard(): ExportWizardRequest | null {
  return useSyncExternalStore(
    (listener) => {
      wizardListeners.add(listener);
      return () => void wizardListeners.delete(listener);
    },
    () => wizard,
    () => null,
  );
}

/** As exportações desta janela, para a barra de status. */
export function useTrackedExports(): readonly TrackedExport[] {
  return useSyncExternalStore(exportTracker.subscribe, exportTracker.snapshot, exportTracker.snapshot);
}

/**
 * A área de trabalho montou (o cofre abriu): os avisos das exportações passam a sair, e os trabalhos da lista com o número desta janela, de todos os tipos,
 * que são da página de antes (que caiu ou recarregou) e que ninguém mais mostra, são cancelados (RN-EXPORT-016): não ocupam o limite nem entram na conta do
 * "Sair" até o abandono.
 * Devolve o que fazer ao desmontar (o cofre fechou): os avisos se calam, o assistente fecha e as exportações são esquecidas (os destinos, soltos).
 */
export function connectExports(toast: TrackerNotify, others: readonly { has: (id: string) => boolean }[] = []): () => void {
  notices = toast;
  vaultOpen = true;
  const windowId = currentWindowId();
  if (windowId !== null) {
    // As importações e as cópias da página de antes também (`others`: o acompanhamento delas, para não levar uma que esta página já começou).
    void listTransfers().then((result) => {
      if (!result.ok) return;
      for (const transfer of result.data) if (transfer.windowID === windowId && !exportTracker.has(transfer.id) && !others.some((tracker) => tracker.has(transfer.id))) void forgetTransfer(transfer.id);
    });
  }
  return () => {
    notices = silent;
    vaultOpen = false;
    closeExportWizard();
    exportTracker.reset();
  };
}
