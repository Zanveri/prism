import type { ResultPlace } from "./workbench-model";

/**
 * Onde a área de resultado de cada aba se põe (seção 39: RN-ABAS-011 a 017), sem React: a área é UMA só por aba, desenhada pela aba de consulta (o mesmo
 * executor, as mesmas pendências, a mesma grade), e o que muda com o lugar é só o elemento da página onde ela fica. O painel é da própria aba (`QueryTabPanel`);
 * a aba do resultado e a janela do resultado registram aqui o elemento delas, pelo id da aba: o painel da aba do resultado (`WorkbenchTabs`) e a raiz da janela
 * do resultado (quem a abrir). De módulo, como `unsaved-edits.ts`: cada janela do app tem o seu.
 */
type Slot = Exclude<ResultPlace, "panel">;

const slots = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();
const keyOf = (tabId: string, place: Slot) => `${place}:${tabId}`;

export const resultSlots = {
  /** O elemento do lugar (`null`: saiu da página). */
  set(tabId: string, place: Slot, element: HTMLElement | null): void {
    const key = keyOf(tabId, place);
    if ((slots.get(key) ?? null) === element) return;
    if (element === null) slots.delete(key);
    else slots.set(key, element);
    for (const listener of listeners) listener();
  },
  get(tabId: string, place: Slot): HTMLElement | null {
    return slots.get(keyOf(tabId, place)) ?? null;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/**
 * O foco que espera a área de resultado chegar ao lugar novo, ou ficar à vista (RN-ABAS-012 e 014): o resultado (a grade, ou o botão "Onde mostrar o
 * resultado" sem grade), o próprio botão, ou o editor da aba. Quem troca o lugar pede; quem desenha o lugar (`ResultHost`, o editor da aba) o leva quando pode,
 * uma vez. O pedido seguinte da mesma aba troca o de antes.
 */
export type FocusTarget = "result" | "placeButton" | "editor";

const pending = new Map<string, FocusTarget>();

export const resultFocus = {
  request(tabId: string, target: FocusTarget): void {
    pending.set(tabId, target);
  },
  /** O pedido da aba, se é um dos que `accepts` leva; levado, sai. */
  take(tabId: string, accepts: readonly FocusTarget[]): FocusTarget | null {
    const target = pending.get(tabId);
    if (target === undefined || !accepts.includes(target)) return null;
    pending.delete(tabId);
    return target;
  },
  forgetExcept(open: ReadonlySet<string>): void {
    for (const tabId of [...pending.keys()]) if (!open.has(tabId)) pending.delete(tabId);
  },
};

/**
 * RN-ABAS-012: o "Salvar" das alterações em andamento em cada aba de consulta, que a aba do resultado mostra com o ponto, como um comando. Quem salva é a edição
 * da aba (`useRecordEdits`, dentro dela); a faixa só lê daqui.
 */
const saving = new Set<string>();
const savingListeners = new Set<() => void>();

export const resultActivity = {
  setSaving(tabId: string, value: boolean): void {
    if (saving.has(tabId) === value) return;
    if (value) saving.add(tabId);
    else saving.delete(tabId);
    for (const listener of savingListeners) listener();
  },
  isSaving(tabId: string): boolean {
    return saving.has(tabId);
  },
  subscribe(listener: () => void): () => void {
    savingListeners.add(listener);
    return () => savingListeners.delete(listener);
  },
};
