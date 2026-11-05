import { useCallback, useEffect, useRef, useState } from "react";

import type { ValuesQuestion } from "./variable-fields";
import type { Value } from "./variables/values";

/** A resposta do diálogo: os valores, e se a pessoa pediu "Executar numa aba nova" (RN-VAR-027 e 029). */
export type ValuesReply = { answers: ReadonlyMap<number, Value>; newTab: boolean };

/** A pergunta aberta, como o `ValuesDialog` a desenha: os campos e as respostas. */
export type OpenValuesQuestion = { question: ValuesQuestion; onRun: (answers: ReadonlyMap<number, Value>, newTab: boolean) => void; onCancel: () => void };

/**
 * A pergunta dos valores que faltam de uma aba (RN-VAR-021): o executor a pede no meio da execução (`RunHooks.ask`) e espera a resposta. Uma por vez: o pedido novo
 * com outra aberta cancela a de antes; desmontar a vista (fechar a aba, o bloqueio) também cancela, e nada fica esperando. `askWith` diz também se a pessoa pediu
 * outra aba (a aba de execução, RN-VAR-029).
 */
export function useValuesQuestion(): { ask: (question: ValuesQuestion) => Promise<ReadonlyMap<number, Value> | null>; askWith: (question: ValuesQuestion) => Promise<ValuesReply | null>; open: OpenValuesQuestion | null } {
  const [open, setOpen] = useState<OpenValuesQuestion | null>(null);
  const waiting = useRef<((reply: ValuesReply | null) => void) | null>(null);

  const settle = useCallback((reply: ValuesReply | null) => {
    const resolve = waiting.current;
    waiting.current = null;
    setOpen(null);
    resolve?.(reply);
  }, []);

  const askWith = useCallback(
    (question: ValuesQuestion) => {
      settle(null);
      return new Promise<ValuesReply | null>((resolve) => {
        waiting.current = resolve;
        setOpen({ question, onRun: (answers, newTab) => settle({ answers, newTab }), onCancel: () => settle(null) });
      });
    },
    [settle],
  );
  const ask = useCallback((question: ValuesQuestion) => askWith(question).then((reply) => reply?.answers ?? null), [askWith]);

  useEffect(() => () => waiting.current?.(null), []);

  return { ask, askWith, open };
}
