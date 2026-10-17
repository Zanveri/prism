import { pushToast, type ToastAction, type ToastItem, type ToastTone } from "./toast-queue";

/** `action`: o botão do aviso (RN-AVISO-006); com ele o aviso fica 8 segundos. */
export type ToastApi = {
  success(title: string, description?: string, action?: ToastAction): void;
  warning(title: string, description?: string, action?: ToastAction): void;
  error(title: string, description?: string, action?: ToastAction): void;
};

/**
 * As funções de aviso que `useToast()` entrega, sobre a fila (`toast-queue.ts`). `isBlocked` é perguntado a CADA aviso: com o Prism bloqueado
 * por inatividade (RN-SEG-001) nenhum aviso entra na fila. Ninguém o vê (a pilha fica por baixo da tela de bloqueio) e ele apareceria já velho
 * depois do desbloqueio: uma mutação que estava em voo e termina, o aviso de "cinco tentativas" da revelação de senha chegando depois do bloqueio.
 * Quem entrega o aviso, qualquer que seja a tela, não precisa saber do bloqueio.
 */
export function createToastApi(setQueue: (update: (queue: ToastItem[]) => ToastItem[]) => void, isBlocked: () => boolean, newId: () => string = () => crypto.randomUUID()): ToastApi {
  const push = (tone: ToastTone) => (title: string, description?: string, action?: ToastAction) => {
    if (isBlocked()) return;

    const id = newId();
    setQueue((current) => pushToast(current, { tone, title, description, ...(action === undefined ? {} : { action }) }, id));
  };

  return { success: push("success"), warning: push("warning"), error: push("error") };
}
