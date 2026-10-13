/**
 * Os editores de SQL montados, pelo id da aba (RN-ABAS-002). O texto vive no editor e chega à aba com atraso (`updateTab`, 400 ms depois da última
 * tecla): quem manda a aba para outra janela lê daqui o texto e a seleção DESTE instante, e não a cópia atrasada. De módulo, como `tab-memory.ts`, e
 * sem estado do React: cada editor se registra ao nascer e sai ao ser destruído.
 */
export type EditorSnapshot = { sql: string; anchor: number; head: number };

const editors = new Map<string, () => EditorSnapshot>();

export const liveEditors = {
  /** O editor da aba nasceu. Devolve a função que o tira daqui (só ele: um editor que nasceu depois, na mesma aba, fica). */
  register(tabId: string, read: () => EditorSnapshot): () => void {
    editors.set(tabId, read);
    return () => {
      if (editors.get(tabId) === read) editors.delete(tabId);
    };
  },
  /** O texto e a seleção do editor da aba agora, ou `null` se ela não tem editor montado (a aba de uma tabela). */
  snapshot(tabId: string): EditorSnapshot | null {
    return editors.get(tabId)?.() ?? null;
  },
};
