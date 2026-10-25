import { handleEvaluateRequest } from "./evaluator-service";
import type { EvaluateMessage, EvaluateRequest } from "./wire";

/*
 * O Worker dedicado da avaliação (RN-VAR-014): do próprio pacote da tela, e a política de conteúdo o permite (`default-src 'self'` vale para o `worker-src`, RN-SHELL-001).
 * Recebe o pedido como dado e devolve dados; não fala com a API nem com o processo principal.
 */

const scope = self as unknown as { onmessage: ((event: { data: EvaluateRequest }) => void) | null; postMessage(message: EvaluateMessage): void };

scope.onmessage = (event) => {
  if (event.data.kind === "evaluate") handleEvaluateRequest(event.data, (message) => scope.postMessage(message));
};
