import { staleNames, type StoredValue, type TabValues } from "./run";
import type { ScriptModel } from "./script";
import { inlineValue, displayValue, typeLabel } from "./values";
import { storedFromWire, storedToWire, type WireStored } from "./wire";

/*
 * Os valores da aba (RN-VAR-023): o que cada atribuição avaliada deixou (o valor, o tipo, a origem, a hora, o tempo, o texto que a deu e a ordem da avaliação) e o
 * contador de avaliações da aba. Ficam na memória da tela, no executor da aba: saem ao fechar a aba, ao trocar o banco ou a conexão dela, no bloqueio por
 * inatividade e no "Sair" (RN-SEG-001), vão junto quando a aba muda de janela (RN-ABAS-002), e nunca vão ao cofre, às abas que voltam (RN-ABAS-006) nem ao
 * `localStorage` (RN-VAR-036). Este módulo não conhece o executor nem o React: o executor escreve, e o painel, o editor e a passagem da aba leem.
 */

/** O que a aba guarda, em dado imutável: o `snapshot()` devolve outro objeto a cada mudança (o que o `useSyncExternalStore` e o editor comparam). */
export type TabValuesSnapshot = { readonly values: TabValues; readonly counter: number };

export const emptyTabValues: TabValuesSnapshot = Object.freeze({ values: new Map<string, StoredValue>(), counter: 0 });

export interface TabValuesStore {
  /** Os valores de agora. Muda de identidade a cada mudança, e só então. */
  snapshot(): TabValuesSnapshot;
  /** Avisa a cada mudança; devolve a função que desfaz o aviso. */
  subscribe(listener: () => void): () => void;
  /** Troca os valores e o contador pelos que a execução deixou (`ScriptRun.tab` e `counter`). */
  replace(values: TabValues, counter: number): void;
  /** Esquece tudo: a aba fechou, mudou de banco ou de conexão, o cofre bloqueou. */
  clear(): void;
}

/** O armazém dos valores de uma aba. `initial` é o que a aba trouxe de outra janela. */
export function createTabValuesStore(initial: TabValuesSnapshot = emptyTabValues): TabValuesStore {
  let current = initial;
  const listeners = new Set<() => void>();
  const publish = (next: TabValuesSnapshot) => {
    current = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    snapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    replace(values, counter) {
      publish({ values: new Map(values), counter });
    },
    clear() {
      if (current.values.size === 0 && current.counter === 0) return;
      publish(emptyTabValues);
    },
  };
}

/** O que o editor lê de cada variável declarada (RN-VAR-025): o tipo (`number`, `string[]`, `Date (dia)`…), o valor curto e se está desatualizado. */
export type ShownVariable = {
  type: string;
  /** O valor no fim da linha: `7`, `'Ana'`, `[1, 2, 3] · 3 itens`, até 60 caracteres. */
  value: string;
  stale: boolean;
  /** O valor para a dica do ponteiro, até 200 caracteres. */
  detail: string;
  origin: StoredValue["origin"];
  /** A hora da avaliação, em milissegundos desde 1970. */
  at: number;
};

/**
 * Para cada nome declarado no texto que a aba já avaliou, o que o editor mostra (o valor no fim da linha, a dica do ponteiro, a marca de desatualizado). O nome
 * que saiu do texto não aparece (RN-VAR-023: sai do painel na leitura seguinte), e o declarado ainda sem valor também não. `model` é a leitura do texto de agora.
 */
export function declaredValues(snapshot: TabValuesSnapshot, model: ScriptModel): ReadonlyMap<string, ShownVariable> {
  const stale = staleNames(model, snapshot.values);
  const shown = new Map<string, ShownVariable>();
  for (const [name, entry] of snapshot.values) {
    if (!model.declaredNames.has(name)) continue;
    shown.set(name, { type: typeLabel(entry.type), value: inlineValue(entry.value), stale: stale.has(name), detail: displayValue(entry.value), origin: entry.origin, at: entry.at });
  }
  return shown;
}

/** Os valores como vão com a aba para outra janela (dado puro: `wire.ts`). */
export type TransferredValues = { counter: number; entries: WireStored[] };

export function valuesToTransfer(snapshot: TabValuesSnapshot): TransferredValues | undefined {
  if (snapshot.values.size === 0 && snapshot.counter === 0) return undefined;
  return { counter: snapshot.counter, entries: [...snapshot.values.values()].map(storedToWire) };
}

/** Os valores que chegaram com a aba: reconstruídos pelos construtores da linguagem, que conferem a forma; o que não confere é descartado com tudo. */
export function valuesFromTransfer(transferred: TransferredValues | undefined): TabValuesSnapshot {
  if (transferred === undefined) return emptyTabValues;
  try {
    const values = new Map<string, StoredValue>();
    for (const entry of transferred.entries) {
      const stored = storedFromWire(entry);
      values.set(stored.name, stored);
    }
    return { values, counter: transferred.counter };
  } catch {
    return emptyTabValues;
  }
}

/**
 * O pedido de "mostrar o painel Variáveis" (RN-VAR-020 e 024): o Ctrl+Enter numa declaração traz o painel à frente com a linha dela escolhida, e o script sem
 * comando nenhum também. É um contador (`serial`), porque o mesmo pedido de novo (o Ctrl+Enter outra vez na mesma declaração) tem de valer de novo.
 */
export type RevealRequest = { readonly serial: number; readonly name: string | null };

export interface RevealStore {
  getState(): RevealRequest;
  subscribe(listener: () => void): () => void;
  /** Pede o painel à frente, com a linha da variável `name` escolhida (nulo: só o painel). */
  reveal(name: string | null): void;
}

export function createRevealStore(): RevealStore {
  let current: RevealRequest = { serial: 0, name: null };
  const listeners = new Set<() => void>();
  return {
    getState: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    reveal(name) {
      current = { serial: current.serial + 1, name };
      for (const listener of [...listeners]) listener();
    },
  };
}
