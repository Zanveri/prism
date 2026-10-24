/**
 * Voltar e Avançar entre as abas (RN-ABAS-018), como o histórico de navegação do DBeaver: cada janela de abas guarda, só na memória, a ordem
 * em que as abas dela ficaram ativas. Aqui está só a conta (pura, com teste de tabela); quem observa a aba ativa e ouve os botões do mouse e as
 * teclas é `use-tab-history.ts`.
 */

/** No máximo tantas entradas; ao passar, sai a mais velha. */
export const maxHistoryEntries = 50;

/** As abas pela ordem em que ficaram ativas, e qual entrada é a de agora (`-1` só sem nenhuma entrada, ou antes da primeira depois de a atual sair). */
export type TabHistory = { readonly entries: readonly string[]; readonly index: number };

export const emptyHistory: TabHistory = { entries: [], index: -1 };

/**
 * A aba ativa mudou para `tabId` por qualquer caminho que não seja o próprio Voltar/Avançar. A mesma aba duas vezes seguidas é uma entrada só (e a
 * aba que o Voltar/Avançar acabou de ativar já é a entrada de agora, então a observação dela não muda nada). Ativar outra aba depois de voltar
 * descarta as entradas à frente, como no navegador.
 */
export function recordTab(history: TabHistory, tabId: string): TabHistory {
  if (history.entries[history.index] === tabId) return history;

  const entries = [...history.entries.slice(0, history.index + 1), tabId].slice(-maxHistoryEntries);
  return { entries, index: entries.length - 1 };
}

/**
 * Tira as abas que fecharam ou foram para outra janela (`open` é o que a janela tem agora). Duas entradas iguais que ficam lado a lado viram uma. Se
 * a entrada de agora saiu, a de agora passa a ser a anterior que ficou. Devolve o mesmo objeto quando nada muda.
 */
export function pruneHistory(history: TabHistory, open: ReadonlySet<string>): TabHistory {
  const entries: string[] = [];
  let index = -1;

  history.entries.forEach((tabId, position) => {
    if (!open.has(tabId)) return;
    if (entries[entries.length - 1] !== tabId) entries.push(tabId);
    if (position <= history.index) index = entries.length - 1;
  });

  const same = index === history.index && entries.length === history.entries.length && entries.every((tabId, position) => tabId === history.entries[position]);
  return same ? history : { entries, index };
}

/**
 * Voltar (`-1`) ou Avançar (`1`): a aba da entrada vizinha, com o histórico andado até ela, depois de tirar as abas que saíram. Sem entrada para onde ir,
 * `tabId` é nulo e nada acontece.
 */
export function stepHistory(history: TabHistory, open: ReadonlySet<string>, direction: -1 | 1): { history: TabHistory; tabId: string | null } {
  const pruned = pruneHistory(history, open);
  const target = pruned.index + direction;
  if (target < 0 || target >= pruned.entries.length) return { history: pruned, tabId: null };

  return { history: { entries: pruned.entries, index: target }, tabId: pruned.entries[target] };
}

export type HistoryAction = "back" | "forward";

/** Os botões "voltar" e "avançar" do mouse: `MouseEvent.button` 3 e 4 (os botões 4 e 5 de quem os numera de 1). */
export function mouseHistoryAction(button: number): HistoryAction | null {
  return button === 3 ? "back" : button === 4 ? "forward" : null;
}

/** Onde está o foco: o editor de SQL, um campo de texto (`input`, `textarea`, o campo de edição da célula, o filtro) ou qualquer outro lugar. */
export type HistoryFocus = "editor" | "text" | "other";

type KeyLike = { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; shiftKey: boolean };

/**
 * As teclas de Voltar e Avançar. No Windows e no Linux, Alt+← e Alt+→ com o foco em qualquer lugar, inclusive no editor de SQL (onde valem no lugar do
 * Alt+← do CodeMirror, que anda pela sintaxe), menos num campo de texto, onde a tecla segue para o campo. No macOS, Cmd+[ e Cmd+], menos no editor
 * (onde são recuar e avançar o recuo) e nos campos de texto.
 */
export function keyHistoryAction(event: KeyLike, options: { mac: boolean; focus: HistoryFocus }): HistoryAction | null {
  const { mac, focus } = options;
  if (event.shiftKey) return null;

  if (mac) {
    if (focus !== "other" || !event.metaKey || event.ctrlKey || event.altKey) return null;
    return event.key === "[" ? "back" : event.key === "]" ? "forward" : null;
  }

  if (focus === "text" || !event.altKey || event.ctrlKey || event.metaKey) return null;
  return event.key === "ArrowLeft" ? "back" : event.key === "ArrowRight" ? "forward" : null;
}
