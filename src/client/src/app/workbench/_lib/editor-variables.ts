import { clockText } from "./variables-panel";
import type { VariableEntry, VariablesStore } from "./variables-extension";
import type { ShownVariable } from "./variables/tab-values";

/*
 * A ponte entre o armazém dos valores da aba (RN-VAR-023, quem executa) e a prop `variables` do editor (RN-VAR-025, quem mostra): o que `declaredValues` entrega por
 * nome declarado vira o que o editor lê (o tipo, o texto para a dica, o texto do fim da linha, a origem e a hora, e o `stale`). Puro e sem React: o gancho
 * `useEditorVariables` só o liga à renderização.
 */

/** O que o editor lê de uma variável: o valor da dica (até 200 caracteres) em `value`, o do fim da linha (até 60, com o " · 3 itens" da lista) em `short`. */
export function editorEntryOf(shown: ShownVariable): VariableEntry {
  return { type: shown.type, value: shown.detail, short: shown.value, stale: shown.stale, from: `${shown.origin} · ${clockText(shown.at)}` };
}

export function editorEntries(shown: ReadonlyMap<string, ShownVariable>): ReadonlyMap<string, VariableEntry> {
  const entries = new Map<string, VariableEntry>();
  for (const [name, one] of shown) entries.set(name, editorEntryOf(one));
  return entries;
}

function sameEntries(a: ReadonlyMap<string, VariableEntry>, b: ReadonlyMap<string, VariableEntry>): boolean {
  if (a.size !== b.size) return false;
  for (const [name, left] of a) {
    const right = b.get(name);
    if (right === undefined || right.type !== left.type || right.value !== left.value || right.short !== left.short || right.stale !== left.stale || right.from !== left.from) return false;
  }
  return true;
}

export type EditorVariablesStore = VariablesStore & {
  /** Entrega os valores de agora. Só avisa o editor se algo mudou (a digitação refaz a leitura do texto a cada pausa, e quase sempre nada muda). */
  update(shown: ReadonlyMap<string, ShownVariable>): void;
};

export function createEditorVariablesStore(initial: ReadonlyMap<string, ShownVariable>): EditorVariablesStore {
  let current = editorEntries(initial);
  const listeners = new Set<() => void>();
  return {
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    update(shown) {
      const next = editorEntries(shown);
      if (sameEntries(current, next)) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}
