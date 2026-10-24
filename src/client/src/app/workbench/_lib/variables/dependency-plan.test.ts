import { describe, expect, test } from "vitest";

import { Random } from "./random";
import { dependencyPlan, ScriptRun, staleNames, type TabValues } from "./run";
import { readScript } from "./script";

/** A regra do Ctrl+Enter (RN-VAR-020 e 023): o plano são as atribuições de que o comando depende e que a aba ainda não tem atuais. */

const config = { random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => 1 };

/** Roda o script inteiro e devolve a aba que ficou. */
function tabAfter(source: string): TabValues {
  const model = readScript(source, undefined, { blankLines: true });
  const run = new ScriptRun(model, config);
  for (const item of model.items) if (item.parsed !== null) run.evaluate(item.index);
  return run.tab;
}

const plan = (source: string, command: string, tab: TabValues) => {
  const model = readScript(source, undefined, { blankLines: true });
  const index = model.items.findIndex((item) => item.text.includes(command));
  expect(index).toBeGreaterThanOrEqual(0);
  return dependencyPlan(model, index, tab);
};

const script = "const a = 1\nconst b = a + 1\nconst c = b + 1\nconst z = 9\n\nselect @c from t;";

describe("dependencyPlan", () => {
  test("aba vazia: avalia a cadeia inteira de que o comando depende, na ordem, sem o que ele não usa", () => {
    expect(plan(script, "select", new Map())).toEqual([0, 1, 2]);
  });

  test("aba em dia: não avalia nada", () => {
    expect(plan(script, "select", tabAfter(script))).toEqual([]);
  });

  test("o texto de uma atribuição mudou: avalia essa e as que dependem dela", () => {
    const tab = tabAfter(script);
    const changed = script.replace("const b = a + 1", "const b = a + 10");
    expect(plan(changed, "select", tab)).toEqual([1, 2]);
  });

  test("o texto da primeira mudou: avalia toda a cadeia", () => {
    const tab = tabAfter(script);
    expect(plan(script.replace("const a = 1", "const a = 5"), "select", tab)).toEqual([0, 1, 2]);
  });

  test("falta uma variável na aba: avalia ela e o que depende dela", () => {
    const tab = new Map(tabAfter(script));
    tab.delete("b");
    expect(plan(script, "select", tab)).toEqual([1, 2]);
  });

  test("uma variável reavaliada depois da dependente invalida a dependente", () => {
    const tab = new Map(tabAfter(script));
    const a = tab.get("a")!;
    tab.set("a", { ...a, order: 99 });
    expect(plan(script, "select", tab)).toEqual([1, 2]);
  });

  test("uma declaração executada sozinha entra no plano mesmo em dia", () => {
    const tab = tabAfter(script);
    expect(plan(script, "const b", tab)).toEqual([1]);
  });

  test("a reatribuição abaixo do comando não conta: vale a última acima dele", () => {
    const source = "let x = 1\nselect @x from t;\nx = 2";
    const model = readScript(source, undefined, { blankLines: true });
    const index = model.items.findIndex((item) => item.kind === "statement");
    expect(dependencyPlan(model, index, new Map())).toEqual([0]);
  });

  test("a reatribuição acima do comando entra no plano, depois da declaração", () => {
    const source = "let x = 1\nx = x + 1\nselect @x from t;";
    const model = readScript(source, undefined, { blankLines: true });
    const index = model.items.findIndex((item) => item.kind === "statement");
    expect(dependencyPlan(model, index, new Map())).toEqual([0, 1]);
  });

  test("a cadeia de milhares de declarações, cada uma usando a anterior, não estoura a pilha (RN-VAR-013)", () => {
    const source = `let a0 = 0\n${Array.from({ length: 19_999 }, (_, index) => `let a${index + 1} = a${index}`).join("\n")}\nselect @a19999;`;
    const model = readScript(source, undefined, { blankLines: true });
    const index = model.items.length - 1;
    expect(dependencyPlan(model, index, new Map()).length).toBe(20_000);

    const run = new ScriptRun(model, config);
    for (const item of model.items) if (item.parsed !== null) run.evaluate(item.index);
    expect(dependencyPlan(model, index, run.tab)).toEqual([]);
    expect(staleNames(model, run.tab).size).toBe(0);
  });
});

// A aba guarda um valor por nome, o da última atribuição avaliada: a declaração de um nome reatribuído está em dia enquanto a última avaliação partiu dela (RN-VAR-020 e 023).
describe("a variável reatribuída", () => {
  const reassigned = "let n = random.int(1, 1000000000)\nn = n + 1\nselect @n;";

  test("depois do script, o Ctrl+Enter no comando não avalia nada e a variável não está desatualizada", () => {
    const tab = tabAfter(reassigned);
    expect(plan(reassigned, "select", tab)).toEqual([]);
    const model = readScript(reassigned, undefined, { blankLines: true });
    expect(staleNames(model, tab).size).toBe(0);
  });

  test("o texto da declaração mudou: avalia a declaração e a reatribuição de novo", () => {
    const tab = tabAfter(reassigned);
    expect(plan(reassigned.replace("1000000000", "5"), "select", tab)).toEqual([0, 1]);
    const changed = readScript(reassigned.replace("1000000000", "5"), undefined, { blankLines: true });
    expect([...staleNames(changed, tab)]).toEqual(["n"]);
  });

  test("o texto da reatribuição mudou: recomeça da declaração, porque a aba já tem o valor depois da reatribuição velha", () => {
    const tab = tabAfter(reassigned);
    expect(plan(reassigned.replace("n + 1", "n + 2"), "select", tab)).toEqual([0, 1]);
  });

  test("a declaração depende de outra variável avaliada de novo depois: as duas ficam desatualizadas", () => {
    const source = "let m = 1\nlet n = m\nn = n + 1\nselect @n;";
    const tab = new Map(tabAfter(source));
    const model = readScript(source, undefined, { blankLines: true });
    const run = new ScriptRun(model, config, tab, 10);
    run.evaluate(0);
    expect(dependencyPlan(model, 3, run.tab)).toEqual([1, 2]);
  });

  test("a mesma reatribuição avaliada de novo não faz a aba crescer sem fim", () => {
    const model = readScript(reassigned, undefined, { blankLines: true });
    const run = new ScriptRun(model, config);
    for (const index of [0, 1, 1, 1]) run.evaluate(index);
    expect(run.tab.get("n")?.earlier?.length).toBe(1);
    expect(dependencyPlan(model, 2, run.tab)).toEqual([]);
  });
});
