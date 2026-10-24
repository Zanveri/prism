import type { EvaluateOutcome, Evaluator, ItemOutcome } from "./evaluator-host";
import { handleEvaluateRequest } from "./evaluator-service";
import { storedFromWire } from "./wire";

/*
 * Um avaliador que roda no mesmo processo, sem Worker (RN-VAR-014): o corpo do Worker (`handleEvaluateRequest`) chamado direto, com a resposta montada como o
 * hospedeiro a monta. Serve aos testes do executor da aba, que não têm Worker. Não tem a parada dura dos 250 ms e dos 5 s: a produção usa o `EvaluatorHost`.
 */
export function inlineEvaluator(): Evaluator {
  return {
    evaluate(request): Promise<EvaluateOutcome> {
      const items: ItemOutcome[] = [];
      let outcome: EvaluateOutcome = { kind: "failed", items, message: "O avaliador não respondeu." };
      handleEvaluateRequest({ ...request, id: 1, kind: "evaluate" }, (message) => {
        if (message.kind === "item") items.push({ index: message.index, result: message.result.ok ? { ok: true, stored: storedFromWire(message.result.stored), steps: message.result.steps } : message.result });
        else if (message.kind === "done") outcome = { kind: "done", items, counter: message.counter, tab: message.tab.map((entry) => storedFromWire(entry)) };
        else if (message.kind === "failed") outcome = { kind: "failed", items, message: message.message };
      });
      return Promise.resolve(outcome);
    },
    dispose() {},
  };
}
