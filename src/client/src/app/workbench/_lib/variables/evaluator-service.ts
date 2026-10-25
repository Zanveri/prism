import { Random } from "./random";
import { ScriptRun, checkScript } from "./run";
import { readScript } from "./script";
import { reportInternalError } from "./boundary";
import { storedFromWire, storedToWire, type EvaluateMessage, type EvaluateRequest } from "./wire";

/*
 * O serviço da avaliação (RN-VAR-014): lê o script, confere e avalia os itens pedidos, na ordem, e conta o que cada um fez. É o corpo do Worker, e fica fora dele para
 * o teste rodá-lo sem Worker (o núcleo é puro e síncrono). Avisa o começo de cada item, para a tela medir os 250 ms de cada declaração e parar o Worker se passar.
 */

export function handleEvaluateRequest(request: EvaluateRequest, post: (message: EvaluateMessage) => void, clock: () => number = () => performance.now()): void {
  const { id } = request;
  try {
    const model = readScript(request.source, request.engine ?? undefined, { blankLines: request.blankLines });
    const config = { engine: request.engine ?? undefined, random: new Random(request.seed), clock, now: () => request.now };
    const tab = new Map(request.tab.map((entry) => [entry.name, storedFromWire(entry)] as const));

    // A conferência de antes de executar vale só para o que vai ser avaliado (RN-VAR-020): os itens pedidos e as atribuições de que dependem já estão neles.
    const wanted = new Set(request.indices);
    const errors = checkScript(model, clock, config.now).filter((error) => wanted.has(error.itemIndex));
    if (errors.length > 0) {
      post({ id, kind: "item", index: errors[0].itemIndex, result: { ok: false, error: errors[0] } });
      post({ id, kind: "done", counter: request.counter, tab: request.tab });
      return;
    }

    const run = new ScriptRun(model, config, tab, request.counter);
    for (const index of request.indices) {
      const item = model.items[index];
      if (item?.parsed === undefined || item.parsed === null) continue;
      post({ id, kind: "start", index, name: item.parsed.name });
      const result = run.evaluate(index);
      if (result.ok) post({ id, kind: "item", index, result: { ok: true, stored: storedToWire(result.stored), steps: result.steps } });
      else {
        post({ id, kind: "item", index, result });
        break;
      }
    }
    post({ id, kind: "done", counter: run.counter, tab: [...run.tab.values()].map(storedToWire) });
  } catch (error) {
    post({ id, kind: "failed", message: reportInternalError("o script", error) });
  }
}
