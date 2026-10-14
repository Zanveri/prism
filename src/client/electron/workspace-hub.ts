import { prismEndpoints } from "../src/lib/api/prism-endpoints";
import { workspaceReportSchema, type SavedWorkspace } from "./workspace-messages";

/**
 * As abas que voltam na próxima entrada (RN-ABAS-006), do lado do processo principal e sem depender do Electron: o que cada janela contou das abas dela, a
 * junção de todas (a janela principal primeiro, as outras na ordem em que abriram) e QUANDO gravar. Quem grava é sempre a API (`PUT api/user/workspace`, no
 * cofre do usuário); nenhuma janela fala com outra (RN-ABAS-005): cada uma conta as suas aqui. O `main.ts` liga isto às janelas e à API de verdade.
 *
 * Quando grava: alguns segundos depois de uma mudança (`workspaceSaveDelayMs`, contados da primeira mudança ainda não gravada, e não da última: digitar sem
 * parar não adia a gravação, e um fechamento inesperado perde no máximo esses segundos), na hora quando uma aba fecha (`urgent`) ou uma janela fecha, e quando
 * pedem (`flush`: antes de o cofre fechar, no "Sair", no bloqueio e ao fechar o app). A mesma área de trabalho não vai de novo. Uma gravação de cada vez, na
 * ordem: a última é a que fica.
 *
 * Antes de gravar, a janela principal tem de ter reaberto as abas gravadas e contado as dela (`claim` e o primeiro `report`): sem isso, as janelas que entram
 * primeiro gravariam por cima do que ainda não voltou. Quando todas as janelas saem do cofre (`withdraw`), a próxima entrada reabre de novo.
 */

/** Os "alguns segundos" da RN-ABAS-006. */
export const workspaceSaveDelayMs = 3000;

export type WorkspaceHubDeps = {
  /** Grava pela API. `true` se a API gravou; a falha (o cofre fechado, a API que caiu) não lança. */
  save(workspace: SavedWorkspace): Promise<boolean>;
  /** Um temporizador; devolve como cancelá-lo. */
  schedule(run: () => void, ms: number): () => void;
  /** Os números das janelas vivas, em ordem de abertura: a primeira é a janela principal. */
  liveWindows(): number[];
  log(message: string): void;
};

export function createWorkspaceHub(deps: WorkspaceHubDeps) {
  const snapshots = new Map<number, SavedWorkspace>();
  /** A janela que reabriu as abas nesta entrada, e se ela já contou as dela. */
  let primaryId: number | null = null;
  let primaryReported = false;
  /** A última área de trabalho que a API gravou, e a entrada a que ela pertence: a gravação que volta depois de uma saída não vale para a entrada seguinte. */
  let lastSaved: string | null = null;
  let entry = 0;
  let cancelTimer: (() => void) | null = null;
  let chain: Promise<void> = Promise.resolve();

  const canSave = () => primaryId !== null && primaryReported;

  function stopTimer(): void {
    cancelTimer?.();
    cancelTimer = null;
  }

  /** A principal primeiro, as outras pela ordem em que abriram. A ativa é a da principal, ou a da primeira janela que tem uma. */
  function merged(): SavedWorkspace {
    const ids = [...snapshots.keys()].sort((a, b) => (a === primaryId ? -1 : b === primaryId ? 1 : a - b));
    const tabs: SavedWorkspace["tabs"] = [];
    let activeIndex: number | null = null;
    for (const id of ids) {
      const snapshot = snapshots.get(id);
      if (snapshot === undefined) continue;
      if (activeIndex === null && snapshot.activeIndex !== null) activeIndex = tabs.length + snapshot.activeIndex;
      tabs.push(...snapshot.tabs);
    }
    return { tabs, activeIndex };
  }

  function saveNow(): Promise<void> {
    stopTimer();
    chain = chain.then(async () => {
      if (!canSave()) return;

      const workspace = merged();
      const json = JSON.stringify(workspace);
      if (json === lastSaved) return;

      const savedIn = entry;
      const saved = await deps.save(workspace).catch(() => false);
      if (saved && savedIn === entry) lastSaved = json;
    });
    return chain;
  }

  function scheduleSave(): void {
    if (cancelTimer !== null || !canSave()) return;
    cancelTimer = deps.schedule(() => {
      cancelTimer = null;
      void saveNow();
    }, workspaceSaveDelayMs);
  }

  /** A principal passa à primeira janela que ainda conta abas (a de número menor): ela já está na área de trabalho. */
  function passPrimary(): void {
    const [next] = [...snapshots.keys()].sort((a, b) => a - b);
    primaryId = next ?? null;
    primaryReported = next !== undefined;
  }

  return {
    /**
     * A área de trabalho da janela montou: ela reabre as abas gravadas? Só a principal (a primeira das janelas vivas), e só uma vez por entrada: a que
     * recarrega com outra janela aberta não as reabre de novo (elas já estão nas janelas).
     */
    claim(windowId: number): boolean {
      const [first] = deps.liveWindows();
      if (primaryId !== null || windowId !== first) return false;

      primaryId = windowId;
      primaryReported = false;
      return true;
    },

    /** As abas desta janela agora (`workspaceReportSchema`). O que não confere é ignorado. */
    report(windowId: number, raw: unknown): void {
      const parsed = workspaceReportSchema.safeParse(raw);
      if (!parsed.success) {
        deps.log("uma janela mandou abas que não conferem com o schema, e elas foram ignoradas");
        return;
      }

      snapshots.set(windowId, parsed.data.workspace);
      if (windowId === primaryId) primaryReported = true;
      if (parsed.data.urgent) void saveNow();
      else scheduleSave();
    },

    /** A área de trabalho da janela desmontou (saiu do cofre, a página recarregou): as abas dela deixam de contar. Sem nenhuma, a próxima entrada recomeça. */
    withdraw(windowId: number): void {
      snapshots.delete(windowId);
      if (windowId === primaryId) primaryReported = false;
      if (snapshots.size > 0) return scheduleSave();

      stopTimer();
      primaryId = null;
      primaryReported = false;
      lastSaved = null;
      entry++;
    },

    /**
     * A janela fechou. A última (o app vai sair): as abas dela ficam, e a gravação de antes de sair as leva (fechar o app não tira aba do que volta). As
     * outras: as abas dela saem do que volta, e a gravação é na hora, como ao fechar uma aba.
     */
    windowClosed(windowId: number, { last }: { last: boolean }): void {
      if (last) return;

      snapshots.delete(windowId);
      if (windowId === primaryId) passPrimary();
      void saveNow();
    },

    /** Grava agora o que as janelas contaram, e espera (antes de o cofre fechar). Nunca lança. */
    flush: (): Promise<void> => saveNow(),

    /** A gravação em andamento, se há (para quem precisa esperar por ela). */
    flushed: (): Promise<void> => chain,
  };
}

export type WorkspaceHub = ReturnType<typeof createWorkspaceHub>;

/**
 * O `PUT api/user/workspace` com o token, com prazo. Devolve se gravou e o que aconteceu, para o log: o status, ou a falha, e nunca o conteúdo (o SQL das
 * abas é dado do usuário, RN-LOG-001). Não lança.
 */
export async function saveWorkspaceThroughApi(
  api: { baseUrl: string; token: string },
  workspace: SavedWorkspace,
  { fetch, timeoutMs }: { fetch: (url: string, init: RequestInit) => Promise<Response>; timeoutMs: number },
): Promise<{ ok: boolean; outcome: string }> {
  try {
    const response = await fetch(`${api.baseUrl}/${prismEndpoints.userWorkspace}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${api.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(workspace),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: response.status === 204, outcome: `a API respondeu ${response.status}` };
  } catch (error) {
    return { ok: false, outcome: `a chamada falhou (${error instanceof Error ? error.name : "erro"})` };
  }
}
