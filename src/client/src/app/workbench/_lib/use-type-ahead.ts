import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { isTypeAheadKey, noTypeAhead, typeAheadStep, typeAheadWindow, type TypeAheadState } from "./type-ahead";

/** O que o indicador mostra enquanto o texto dura: o digitado e se algum item começa por ele. */
export type TypeAheadShown = { text: string; found: boolean };

export type TypeAhead = {
  /**
   * A tecla de uma linha da árvore (RN-ARVORE-009). Devolve `null` se não é de ir ao item (a árvore trata a tecla como sempre); senão a tecla é consumida
   * (`preventDefault`) e devolve o índice a que ir, ou `null` em `target` se nenhum item começa pelo texto. `labels` só é lido para a tecla que vale: os nomes
   * dos itens visíveis, na ordem da lista, e `current` é o índice do item com o foco.
   */
  press: (event: KeyboardEvent<HTMLElement>, labels: () => readonly string[], current: number) => { target: number | null } | null;
  /** O texto que dura, para o indicador; `null` quando passou 1 segundo sem tecla. */
  shown: TypeAheadShown | null;
};

/**
 * O gancho fino das duas árvores do navegador (RN-ARVORE-009): guarda o texto digitado (num `useRef`: não redesenha a árvore a cada tecla) e o que o
 * indicador mostra (um estado só, que muda a cada tecla e some 1 segundo depois da última). As decisões são de `type-ahead.ts`, puro e com teste de tabela.
 */
export function useTypeAhead(): TypeAhead {
  const held = useRef<TypeAheadState>(noTypeAhead);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [shown, setShown] = useState<TypeAheadShown | null>(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const press = useCallback((event: KeyboardEvent<HTMLElement>, labels: () => readonly string[], current: number) => {
    const now = Date.now();
    const key = { key: event.key, ctrlKey: event.ctrlKey, altKey: event.altKey, metaKey: event.metaKey, isComposing: event.nativeEvent.isComposing };
    if (!isTypeAheadKey(key, held.current, now)) return null;

    // O Espaço no meio do texto não abre nem fecha o nó, e a letra não vai a lugar nenhum além da árvore.
    event.preventDefault();
    const step = typeAheadStep(held.current, event.key, now, labels(), current);
    held.current = step.state;
    setShown({ text: step.state.text, found: step.target !== null });

    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      held.current = noTypeAhead;
      setShown(null);
    }, typeAheadWindow);
    return { target: step.target };
  }, []);

  return { press, shown };
}
