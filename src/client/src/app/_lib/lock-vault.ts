import type { QueryClient } from "@tanstack/react-query";

import type { ApiResult } from "@/lib/api/prism-api";

import { closeOpenPortals } from "./close-portals";

/**
 * A orquestração do bloqueio por inatividade (RN-SEG-001), sem React e com as dependências injetadas: o que importa dela é a ORDEM e o que
 * acontece quando um passo falha, e é isso que os testes conferem. O componente (`VaultLock`) só liga as peças de verdade.
 */

/** Onde está o fechamento do cofre na API, que a tela de bloqueio diz com franqueza. */
export type CloseState = "closing" | "retrying" | "closed" | "gaveUp";

export type LockVaultDeps = {
  /** Arma a espera dos pedidos à API e faz a tela de bloqueio aparecer (`vaultLock.lock()`). */
  arm: () => void;
  /** Fecha o que está aberto por portal no `body`. */
  closePortals: () => void;
  /** Solta o que dependia do cofre aberto na área de trabalho (`discardForLock`), mantendo as abas e o texto. */
  discard: () => void;
  /** RN-ABAS-006: grava as abas de todas as janelas antes de o cofre fechar (com prazo; `workspaceSync.flush`). */
  saveWorkspace: () => Promise<void>;
  /** Uma tentativa de fechar o cofre na API, com prazo. `true` se fechou, ou se já estava fechado. */
  closeVault: () => Promise<boolean>;
  /** Ainda bloqueado? A repetição para quando a pessoa saiu (o "Sair" já fecha o cofre). */
  stillLocked: () => boolean;
  /** Espera, entre uma tentativa e a seguinte. */
  wait: (ms: number) => Promise<void>;
  /** Quanto esperar antes de cada nova tentativa: há uma tentativa a mais que recuos, e depois do último o fechamento desiste. */
  backoffMs: readonly number[];
  /** Onde está o fechamento, para a tela dizer. */
  report: (state: CloseState) => void;
  /** Um passo de tela que lançou: não impede o fechamento do cofre, mas não passa calado. */
  onError: (error: unknown) => void;
};

/** O recuo entre as tentativas de fechar o cofre: seis tentativas em cerca de um minuto, e então desiste. */
export const closeBackoffMs: readonly number[] = [1000, 2000, 4000, 8000, 15000];

/** O prazo de cada tentativa de fechar o cofre: a API local que não responde em 5 s não vai responder. */
export const closeDeadlineMs = 5000;

/** Roda um passo de tela; se ele lançar, o erro é registrado e o próximo passo (e o fechamento do cofre) seguem. */
function runStep(step: () => void, onError: (error: unknown) => void): void {
  try {
    step();
  } catch (error) {
    onError(error);
  }
}

/**
 * Bloqueia, nesta ordem:
 * 1. arma a barreira dos pedidos e a tela de bloqueio. PRIMEIRO: armá-la depois deixaria um 401 mandar ao login e perder as abas. Se
 *    isto lança, a tela não está bloqueada e NADA mais roda (fechar o cofre por baixo de uma tela desbloqueada leva ao login);
 * 2. fecha o que está aberto por portal e descarta o que dependia do cofre. Cada passo é isolado: um que lança não impede o outro;
 * 3. grava as abas (RN-ABAS-006: antes de o cofre fechar), uma vez, sem que a falha da gravação impeça o resto;
 * 4. fecha o cofre na API, e não depende de os passos de tela darem certo. Cada tentativa tem prazo, e enquanto o cofre não fecha e a
 *    janela segue bloqueada ele repete com recuo; a tela diz onde está (`report`). Devolve onde terminou: `closed`, `gaveUp` (as tentativas
 *    acabaram, o cofre pode estar aberto na API) ou `left` (a pessoa saiu no meio, e o "Sair" fechou o cofre).
 */
export async function lockVault(deps: LockVaultDeps): Promise<"closed" | "gaveUp" | "left"> {
  deps.arm();
  deps.report("closing");

  runStep(deps.closePortals, deps.onError);
  runStep(deps.discard, deps.onError);

  try {
    await deps.saveWorkspace();
  } catch (error) {
    deps.onError(error);
  }

  for (let attempt = 0; ; attempt++) {
    let closed = false;
    try {
      closed = await deps.closeVault();
    } catch (error) {
      deps.onError(error);
    }

    if (closed) {
      deps.report("closed");
      return "closed";
    }
    if (attempt >= deps.backoffMs.length) {
      deps.report("gaveUp");
      return "gaveUp";
    }

    deps.report("retrying");
    await deps.wait(deps.backoffMs[attempt]);
    if (!deps.stillLocked()) return "left";
  }
}

/** "Desbloquear" só fica livre depois de o cofre ter fechado, ou de a tentativa ter desistido de vez (o desbloqueio ainda confere a senha na API). */
export function unlockBlocked(state: CloseState): boolean {
  return state === "closing" || state === "retrying";
}

export type UnlockSession = { unlocked: boolean; userName: string | null };

export type UnlockResult =
  | { kind: "unlocked" }
  /** A API recusou a entrada: a senha está errada (`INVALID_CREDENTIALS`) ou o cofre é de um Prism mais novo (`VAULT_FORMAT_UNSUPPORTED`). */
  | { kind: "refused"; code: string }
  /** A API respondeu que entrou, mas não confere com o que bloqueou: o cofre não está aberto, ou é o de outro usuário. */
  | { kind: "mismatch" };

/**
 * Desbloqueia: abre o cofre do MESMO usuário que bloqueou, pela chamada de entrada, com a senha digitada. Só avisa que desbloqueou
 * (`onUnlocked`: soltar os pedidos que esperavam) depois de CONFERIR a resposta: `unlocked` verdadeiro e o usuário devolvido igual ao
 * que bloqueou. Qualquer outra coisa não desbloqueia: o chamador leva ao login, e tudo é descartado.
 */
export async function unlockVault({ userName, password, signIn, onUnlocked }: { userName: string; password: string; signIn: (credentials: { userName: string; password: string }) => Promise<ApiResult<UnlockSession>>; onUnlocked: () => void }): Promise<UnlockResult> {
  const result = await signIn({ userName, password });
  if (!result.ok) return { kind: "refused", code: result.error.code };
  if (!result.data.unlocked || result.data.userName !== userName) return { kind: "mismatch" };

  onUnlocked();
  return { kind: "unlocked" };
}

/**
 * O desbloqueio como mutação. `gcTime: 0`: a mutação guarda o que recebeu em `variables`, e a senha ficaria no cache; `networkMode: "always"`:
 * é a saída desta tela, e uma janela que perdeu a rede (a API é local) não pode deixá-la parada; `silent`: toda falha aparece na própria tela,
 * porque o aviso central ficaria por baixo dela.
 */
export function unlockMutationOptions({ userName, signIn, onUnlocked }: { userName: string; signIn: (credentials: { userName: string; password: string }) => Promise<ApiResult<UnlockSession>>; onUnlocked: () => void }) {
  return {
    gcTime: 0,
    networkMode: "always" as const,
    meta: { silent: true } as const,
    mutationFn: (password: string) => unlockVault({ userName, password, signIn, onUnlocked }),
  };
}

/**
 * As dependências de `lockVault` com as peças de verdade: a barreira dos pedidos, a raiz do documento (onde os portais estão), a chamada
 * do "Sair". O que é da tela (o descarte da área de trabalho, onde mostrar o estado, onde registrar um erro) vem de quem chama.
 */
export function createLockVaultDeps({
  lock,
  root,
  extraRoots = () => [],
  signOut,
  discard,
  saveWorkspace = async () => {},
  report,
  onError,
  signalFor = (ms) => AbortSignal.timeout(ms),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  lock: { lock: () => void; isLocked: () => boolean };
  root: Pick<ParentNode, "querySelectorAll">;
  /** As páginas das janelas do resultado abertas (RN-ABAS-011): o que abriu nelas fecha no bloqueio como o da janela da aba. */
  extraRoots?: () => readonly Pick<ParentNode, "querySelectorAll">[];
  signOut: (signal: AbortSignal) => Promise<ApiResult<void>>;
  discard: () => void;
  /** A gravação das abas (RN-ABAS-006). Sem ela, nada é gravado: a janela que bloqueia porque outra bloqueou deixa a gravação para a que bloqueou. */
  saveWorkspace?: () => Promise<void>;
  report: (state: CloseState) => void;
  onError: (error: unknown) => void;
  /** O sinal que cancela a tentativa depois do prazo. */
  signalFor?: (ms: number) => AbortSignal;
  wait?: (ms: number) => Promise<void>;
}): LockVaultDeps {
  return {
    arm: () => lock.lock(),
    closePortals: () => {
      closeOpenPortals(root);
      for (const page of extraRoots()) closeOpenPortals(page);
    },
    discard,
    saveWorkspace,
    // Fechou, ou já estava fechado por outro motivo (401 `VAULT_LOCKED`): o cofre está fechado do mesmo jeito.
    closeVault: async () => {
      const result = await signOut(signalFor(closeDeadlineMs));
      return result.ok || result.error.code === "VAULT_LOCKED";
    },
    stillLocked: () => lock.isLocked(),
    wait,
    backoffMs: closeBackoffMs,
    report,
    onError,
  };
}

/**
 * O que acontece quando o desbloqueio dá certo: solta a barreira (os pedidos que esperavam seguem, agora com o cofre reaberto) e refaz o que
 * falhou durante o bloqueio (um pedido que já estava a caminho quando o cofre fechou): a tela volta sem erro. A barreira primeiro: os pedidos
 * refeitos não podem esperar por ela.
 */
export function createUnlockHandler({ lock, queryClient }: { lock: { unlock: () => void }; queryClient: Pick<QueryClient, "refetchQueries"> }): () => void {
  return () => {
    lock.unlock();
    void queryClient.refetchQueries({ type: "active", predicate: (query) => query.state.status === "error" });
  };
}
