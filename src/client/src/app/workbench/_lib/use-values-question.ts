import { useCallback, useEffect, useRef, useState } from "react";

import type { ValuesQuestion } from "./variable-fields";
import type { Value } from "./variables/values";

/** A pergunta aberta, como o `ValuesDialog` a desenha: os campos e as duas respostas. */
export type OpenValuesQuestion = { question: ValuesQuestion; onRun: (answers: ReadonlyMap<number, Value>) => void; onCancel: () => void };

/**
 * A pergunta dos valores que faltam de uma aba (RN-VAR-021): o executor a pede no meio da execução (`RunHooks.ask`) e espera a resposta. Uma por vez: o pedido novo
 * com outra aberta cancela a de antes; desmontar a vista (fechar a aba, o bloqueio) também cancela, e nada fica esperando.
 */
export function useValuesQuestion(): { ask: (question: ValuesQuestion) => Promise<ReadonlyMap<number, Value> | null>; open: OpenValuesQuestion | null } {
  const [open, setOpen] = useState<OpenValuesQuestion | null>(null);
  const waiting = useRef<((answers: ReadonlyMap<number, Value> | null) => void) | null>(null);

  const settle = useCallback((answers: ReadonlyMap<number, Value> | null) => {
    const resolve = waiting.current;
    waiting.current = null;
    setOpen(null);
    resolve?.(answers);
  }, []);

  const ask = useCallback(
    (question: ValuesQuestion) => {
      settle(null);
      return new Promise<ReadonlyMap<number, Value> | null>((resolve) => {
        waiting.current = resolve;
        setOpen({ question, onRun: (answers) => settle(answers), onCancel: () => settle(null) });
      });
    },
    [settle],
  );

  useEffect(() => () => waiting.current?.(null), []);

  return { ask, open };
}
