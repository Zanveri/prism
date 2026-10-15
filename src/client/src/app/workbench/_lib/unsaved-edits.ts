/**
 * RN-EDIT-007: as alterações não salvas dos Registros de cada aba, pelo id da aba. A vista Registros é quem as tem (no estado dela) e as
 * informa aqui a cada mudança, com o Salvar dela; quem fecha abas (a faixa, o Ctrl+W, o menu da aba) pergunta antes, sem precisar da
 * vista. Um mapa de módulo, como `tab-memory.ts`: o provedor da área de trabalho esquece as abas que fecharam (`forgetExcept`).
 */
/** `save` nulo: a vista Registros não está montada (a aba mostra a Estrutura ou o Diagrama), e a pergunta só oferece Descartar e Cancelar. */
type Entry = { count: number; save: (() => Promise<boolean>) | null };

const entries = new Map<string, Entry>();

export const unsavedEdits = {
  /** A aba tem `count` alterações não salvas, e `save` as grava (devolve se gravou). Nulo, ou zero, tira a aba. */
  set(tabId: string, entry: Entry | null): void {
    if (entry === null || entry.count === 0) entries.delete(tabId);
    else entries.set(tabId, entry);
  },
  countOf(tabId: string): number {
    return entries.get(tabId)?.count ?? 0;
  },
  saveOf(tabId: string): (() => Promise<boolean>) | null {
    return entries.get(tabId)?.save ?? null;
  },
  forgetExcept(open: ReadonlySet<string>): void {
    for (const tabId of [...entries.keys()]) if (!open.has(tabId)) entries.delete(tabId);
  },
};

/**
 * A pergunta "Há N alterações não salvas" antes de fechar as abas `tabIds`: nula quando nenhuma tem pendência. Fechar uma aba oferece
 * Salvar, Descartar e Cancelar; fechar várias, só Descartar e Cancelar (RN-EDIT-007: nas saídas que atingem várias abas).
 */
export function unsavedQuestion(tabIds: readonly string[], countOf: (tabId: string) => number, saveOf: (tabId: string) => (() => Promise<boolean>) | null = () => null): { count: number; canSave: boolean } | null {
  const count = tabIds.reduce((total, tabId) => total + countOf(tabId), 0);
  return count === 0 ? null : { count, canSave: tabIds.length === 1 && saveOf(tabIds[0]) !== null };
}
