/**
 * O bloqueio por inatividade (RN-SEG-001) como a camada da API o enxerga. Bloqueado, o cofre está fechado na API e as telas de
 * dentro continuam montadas por baixo da tela de bloqueio, com as consultas, o polling e os executores delas: qualquer pedido que
 * saísse agora receberia 401 `VAULT_LOCKED`, e esse 401 manda ao login e apaga as abas, que é justamente o que o bloqueio não pode fazer.
 *
 * Por isso o `apiRequest` consulta isto: um pedido que chega bloqueado **espera** o desbloqueio (não falha, não avisa) e segue com
 * o cofre reaberto. As duas saídas da tela de bloqueio, entrar e sair, passam por cima (`whileLocked`).
 */
export function createVaultLock() {
  let locked = false;
  /** Sobe a cada bloqueio: é a chave que remonta as telas de dentro do cofre (`RemountOnLock`), para nada do que elas guardavam sobreviver. */
  let epoch = 0;
  const listeners = new Set<() => void>();
  /** Quem espera o desbloqueio; cada um é solto com `true` (desbloqueou) ou `false` (o pedido foi cancelado). */
  const waiting = new Set<(unlocked: boolean) => void>();

  function emit() {
    for (const listener of listeners) listener();
  }

  return {
    isLocked: () => locked,

    epoch: () => epoch,

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    lock() {
      if (locked) return;
      locked = true;
      epoch++;
      emit();
    },

    unlock() {
      if (!locked) return;
      locked = false;

      const released = [...waiting];
      waiting.clear();
      emit();
      for (const release of released) release(true);
    },

    /**
     * Sair, ou o cofre sumir por outro motivo (a API reiniciou): o que estava preso é largado sem resposta. Responder `false`
     * faria cada pedido voltar como falha, e o aviso central a escreveria na tela do login. Ninguém espera por eles, porque a
     * área de trabalho que os fez já saiu.
     */
    reset() {
      waiting.clear();
      if (!locked) return;

      locked = false;
      emit();
    },

    /** Responde na hora se não está bloqueado; senão, quando desbloquear (`true`) ou o pedido for cancelado (`false`). */
    whenUnlocked(signal?: AbortSignal): Promise<boolean> {
      if (!locked) return Promise.resolve(true);
      if (signal?.aborted) return Promise.resolve(false);

      return new Promise((resolve) => {
        const release = (unlocked: boolean) => {
          signal?.removeEventListener("abort", abort);
          waiting.delete(release);
          resolve(unlocked);
        };
        const abort = () => release(false);

        waiting.add(release);
        signal?.addEventListener("abort", abort, { once: true });
      });
    },
  };
}

/** O bloqueio da janela: um só, como o `preferencesStore`. */
export const vaultLock = createVaultLock();
