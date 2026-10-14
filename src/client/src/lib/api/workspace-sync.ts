import { flushWorkspace } from "./bridge";

/**
 * "Grave as abas agora" (RN-ABAS-006), para quem vai fechar o cofre e não conhece a área de trabalho: o bloqueio por inatividade (`lock-vault.ts`) e o "Sair"
 * da barra superior. A área de trabalho montada se registra aqui (`register`) com o que conta as abas DESTE instante, com o texto vivo dos editores; sem ela
 * (o login), só se pede ao processo principal que grave o que as janelas já contaram. De módulo, como `vault-lock.ts`: o cofre é um só por janela.
 *
 * Tem prazo e nunca lança: a gravação que não volta, ou que falha (o cofre já fechado, a API que caiu), não segura o bloqueio nem o "Sair", e nada aparece na
 * tela por ela.
 */

/** Quanto o "Sair" e o bloqueio esperam pela gravação das abas: o mesmo prazo que o processo principal dá ao `PUT`. */
export const workspaceFlushTimeoutMs = 5000;

let current: (() => void) | null = null;

export const workspaceSync = {
  /** A área de trabalho montou: `reportNow` conta as abas desta janela agora. Devolve como sair daqui (só ela: outra que tenha se registrado depois fica). */
  register(reportNow: () => void): () => void {
    current = reportNow;
    return () => {
      if (current === reportNow) current = null;
    };
  },

  /** Conta as abas desta janela agora e espera o processo principal gravar as de todas, no máximo o prazo. */
  async flush(timeoutMs: number = workspaceFlushTimeoutMs): Promise<void> {
    try {
      current?.();
    } catch (error) {
      console.error("[prism] abas: não foi possível contar as abas desta janela:", error);
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([flushWorkspace(), new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))]);
    clearTimeout(timer);
  },
};
