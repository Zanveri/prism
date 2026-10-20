/**
 * A fila dos avisos, sem React (RN-AVISO-006): quanto tempo cada tom fica, quantos cabem e
 * quando um aviso repetido não empilha. `toast.tsx` só desenha e agenda o fechamento.
 */
export type ToastTone = "success" | "warning" | "error";

/** RN-AVISO-006: o botão de ação do aviso (o "Mostrar na pasta" da exportação de dados). Ele nunca é o único caminho para o que faz. */
export type ToastAction = { label: string; run: () => void };

export type ToastItem = { id: string; tone: ToastTone; title: string; description?: string; action?: ToastAction; durationMs: number };

/** Sucesso some em 4 segundos; atenção e erro, em 8. */
export const toastDurations: Record<ToastTone, number> = { success: 4000, warning: 8000, error: 8000 };

/** O aviso com um botão de ação fica 8 segundos, também no tom de sucesso: é preciso tempo para chegar ao botão (RN-AVISO-006). */
export const actionToastDurationMs = 8000;

export const maxVisibleToasts = 4;

/** Põe o aviso no fim da fila. Igual ao último visível, não empilha; passando do limite, sai o mais antigo. */
export function pushToast(queue: ToastItem[], toast: Omit<ToastItem, "id" | "durationMs">, id: string): ToastItem[] {
  const last = queue.at(-1);
  if (last !== undefined && last.tone === toast.tone && last.title === toast.title && last.description === toast.description && last.action?.label === toast.action?.label) return queue;

  return [...queue, { ...toast, id, durationMs: toast.action === undefined ? toastDurations[toast.tone] : actionToastDurationMs }].slice(-maxVisibleToasts);
}

export function dismissToast(queue: ToastItem[], id: string): ToastItem[] {
  return queue.filter((item) => item.id !== id);
}
