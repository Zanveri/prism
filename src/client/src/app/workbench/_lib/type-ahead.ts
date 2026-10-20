import { fold } from "./navigator-search";

/** RN-ARVORE-009: cada caractere se junta ao texto se vem até 1 segundo depois do anterior; passado isso, o texto recomeça. */
export const typeAheadWindow = 1000;

/** O texto digitado até agora e o instante (ms) do último caractere. Sem texto, `at` não vale nada. */
export type TypeAheadState = { text: string; at: number };

export const noTypeAhead: TypeAheadState = { text: "", at: 0 };

/** O que da tecla importa: o caractere, os modificadores e se ela faz parte da composição de um acento (`isComposing`). */
export type TypeAheadKey = { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean; isComposing: boolean };

/** O texto ainda dura: tem algo e o último caractere veio há 1 segundo ou menos. */
export const typeAheadAlive = (state: TypeAheadState, now: number): boolean => state.text !== "" && now >= state.at && now - state.at <= typeAheadWindow;

/**
 * A tecla é de ir ao item? Um caractere imprimível (letra, número, `_`, `.`...; um ponto de código, para a letra fora do plano básico) sem Ctrl, Alt nem
 * Cmd e fora da composição de um acento. O Espaço só vale no meio do texto: sozinho é da linha (abrir e fechar o nó), e o Ctrl+F e as teclas da árvore
 * (setas, Enter, F2... têm nome de mais de um caractere) seguem como são.
 */
export function isTypeAheadKey(event: TypeAheadKey, state: TypeAheadState, now: number): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return false;
  if (event.key === " ") return typeAheadAlive(state, now);
  return [...event.key].length === 1;
}

export type TypeAheadStep = {
  /** O texto de agora, para a vez seguinte. Fica mesmo sem item achado: o que vem a seguir ainda pode casar. */
  state: TypeAheadState;
  /** O índice do item a que ir, ou `null` se nenhum começa pelo texto (o foco fica onde está). */
  target: number | null;
};

/**
 * RN-ARVORE-009: a tecla `key` (já aceita por `isTypeAheadKey`) pedida em `now`, com `labels` os nomes dos itens visíveis, na ordem da lista (`""` no que não
 * tem nome: carregando, erro), e `current` o índice do item com o foco (`-1`, ou fora da lista, se ele não está visível: a procura começa no topo). O nome
 * é comparado sem caixa e sem acento (`fold`), só pelo começo.
 *
 * - Um caractere só: o próximo item abaixo do atual, voltando ao começo depois do último (o atual é o último a ser olhado, e fica se é o único).
 * - A mesma letra repetida (`bbb`): o mesmo, a cada tecla, só pela letra, e assim percorre um a um os que começam por ela, como no Explorador.
 * - Vários caracteres: o primeiro a partir do atual (incluído), com a volta ao começo, cujo nome começa pelo texto inteiro.
 */
export function typeAheadStep(state: TypeAheadState, key: string, now: number, labels: readonly string[], current: number): TypeAheadStep {
  const text = (typeAheadAlive(state, now) ? state.text : "") + key;
  const next: TypeAheadState = { text, at: now };

  const letters = [...fold(text)];
  if (letters.length === 0) return { state: next, target: null };

  const cycling = letters.every((letter) => letter === letters[0]);
  const wanted = cycling ? letters[0] : letters.join("");
  const count = labels.length;
  const valid = current >= 0 && current < count;
  const start = valid ? (cycling ? current + 1 : current) : 0;

  for (let offset = 0; offset < count; offset++) {
    const index = (start + offset) % count;
    if (fold(labels[index]).startsWith(wanted)) return { state: next, target: index };
  }
  return { state: next, target: null };
}
