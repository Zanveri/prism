import { describe, expect, test } from "vitest";

import { Random } from "./random";
import { ScriptRun, checkScript } from "./run";
import { readScript } from "./script";

// Os limites da execução que o script de muitas declarações pequenas atinge (RN-VAR-013).
describe("limites da execução", () => {
  test("os 5 s por execução valem também para declarações pequenas, que nunca chegam a 100 passos", () => {
    const source = Array.from({ length: 30 }, (_, index) => `let a${index} = ${index}`).join("\n");
    const model = readScript(source, undefined, { blankLines: true });
    let ticks = 0;
    const run = new ScriptRun(model, { random: new Random([1, 2, 3, 4]), clock: () => (ticks += 300), now: () => 1 });
    const results = model.items.map((item) => run.evaluate(item.index));
    const firstFailure = results.findIndex((result) => !result.ok);
    expect(firstFailure).toBeGreaterThan(0);
    const failed = results[firstFailure];
    expect(failed.ok === false && failed.error.message).toBe("As expressões do script levaram mais de 5 s e foram paradas.");
  });

  test("a soma dos valores da aba é conferida sem percorrer a aba a cada avaliação", () => {
    const source = Array.from({ length: 400 }, (_, index) => `let a${index} = "${"x".repeat(100)}"`).join("\n");
    const model = readScript(source, undefined, { blankLines: true });
    const run = new ScriptRun(model, { random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => 1 });
    const started = performance.now();
    for (const item of model.items) expect(run.evaluate(item.index).ok).toBe(true);
    expect(run.tab.size).toBe(400);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test("o script acima de 500 declarações só tem o erro dos 500: nada é avaliado em seco", () => {
    const source = Array.from({ length: 700 }, (_, index) => `let a${index} = 1 / 0 + ${index}`).join("\n");
    const errors = checkScript(readScript(source, undefined, { blankLines: true }));
    expect(errors.map((error) => error.message)).toEqual(["O script passou de 500 declarações."]);
  });
});
