import { useEffect, useState } from "react";

import { cn } from "@/lib/utils/cn";

import { transactionStatus, useTabTransaction } from "../_lib/transaction";
import type { QueryRunner } from "../_lib/use-query-runner";

/** O texto conta minutos: um relógio de meio minuto basta para ele não atrasar mais que isso. */
const tickMs = 30_000;

/**
 * RN-TX-003: o modo e a transação da aba ativa na barra de status ("Commit manual · Padrão do banco · 3 comandos sem commit · há 4 min"). Com a transação
 * aberta o tempo anda sozinho; passados 10 minutos, o tom é de atenção, e a transação com erro, de erro. Abrir, fechar e estragar a transação é anunciado a
 * leitor de tela (`role="status"`).
 */
export function TransactionStatus({ runner }: { runner: QueryRunner }) {
  const transaction = useTabTransaction(runner.transaction);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // O `now` velho de antes da abertura dá "menos de 1 min" (o tempo nunca fica negativo) até o primeiro tique.
    if (!transaction.open) return;
    const timer = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [transaction.open]);

  const { text, tone } = transactionStatus(transaction, now);

  return (
    <span role="status" className={cn(tone === "warning" && "text-warning", tone === "error" && "text-danger")}>
      {text}
    </span>
  );
}
