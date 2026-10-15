import type { SavedWorkspace } from "../../../../electron/workspace-messages";

/**
 * Quando esta janela conta as abas dela ao processo principal (RN-ABAS-006), sem React e com o relógio injetado: o processo principal junta as de todas as
 * janelas e decide quando gravar (`workspace-hub.ts`). Uma mudança (uma tecla, uma aba que abre ou muda de lugar) é contada um pouco depois, lendo o estado
 * daquele instante, e várias seguidas são um relato só: o editor não manda o texto a cada tecla. A aba que fecha é contada na hora (`urgent`), e o processo
 * principal grava na hora. O que não mudou não é contado de novo.
 *
 * Só começa (`start`) depois de a janela principal reabrir as abas gravadas: antes disso, contar as abas vazias da janela que acabou de entrar apagaria o que
 * ainda não voltou. Um relato que lança (o estado de um editor que sumiu no meio) não para os seguintes.
 */

/** Quanto a janela espera depois de uma mudança para contá-la: o processo principal ainda espera os segundos dele antes de gravar. */
export const workspaceReportDelayMs = 1000;

export type WorkspaceReporterDeps = {
  /** As abas desta janela agora, como vão para o cofre (com o texto vivo dos editores). */
  read: () => SavedWorkspace;
  send: (workspace: SavedWorkspace, urgent: boolean) => void;
  schedule: (run: () => void, ms: number) => () => void;
};

export function createWorkspaceReporter({ read, send, schedule }: WorkspaceReporterDeps) {
  let started = false;
  let last: string | null = null;
  let cancel: (() => void) | null = null;

  function stopTimer() {
    cancel?.();
    cancel = null;
  }

  function report(urgent: boolean) {
    stopTimer();
    if (!started) return;

    try {
      const workspace = read();
      const json = JSON.stringify(workspace);
      if (!urgent && json === last) return;

      last = json;
      send(workspace, urgent);
    } catch (error) {
      console.error("[prism] abas: não foi possível contar as abas desta janela:", error);
    }
  }

  return {
    /** A janela está pronta para contar (a principal já reabriu as abas gravadas): conta o que tem agora. */
    start() {
      started = true;
      last = null;
      report(false);
    },
    /** Algo mudou: conta um pouco depois, se já não está para contar. */
    touch() {
      if (!started || cancel !== null) return;
      cancel = schedule(() => {
        cancel = null;
        report(false);
      }, workspaceReportDelayMs);
    },
    /** Uma aba fechou (ou o cofre vai fechar): conta agora, e o processo principal grava na hora. */
    urgent: () => report(true),
    /** A área de trabalho desmontou: nada mais é contado daqui. */
    stop() {
      started = false;
      stopTimer();
    },
  };
}

export type WorkspaceReporter = ReturnType<typeof createWorkspaceReporter>;
