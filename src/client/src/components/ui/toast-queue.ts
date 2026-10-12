/**
 * A fila dos avisos, sem React (RN-AVISO-006): quanto tempo cada tom fica, quantos cabem e
 * quando um aviso repetido não empilha. `toast.tsx` só desenha e agenda o fechamento.
 */
export type ToastTone = "success" | "warning" | "error";

export type ToastItem = { id: string; tone: ToastTone; title: string; description?: string; durationMs: number };

/** Sucesso some em 4 segundos; atenção e erro, em 8. */
export const toastDurations: Record<ToastTone, number> = { success: 4000, warning: 8000, error: 8000 };

export const maxVisibleToasts = 4;

/** Põe o aviso no fim da fila. Igual ao último visível, não empilha; passando do limite, sai o mais antigo. */
export function pushToast(queue: ToastItem[], toast: Omit<ToastItem, "id" | "durationMs">, id: string): ToastItem[] {
  const last = queue.at(-1);
  if (last !== undefined && last.tone === toast.tone && last.title === toast.title && last.description === toast.description) return queue;

  return [...queue, { ...toast, id, durationMs: toastDurations[toast.tone] }].slice(-maxVisibleToasts);
}

export function dismissToast(queue: ToastItem[], id: string): ToastItem[] {
  return queue.filter((item) => item.id !== id);
}
