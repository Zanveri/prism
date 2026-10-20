import { describe, expect, test, vi } from "vitest";

import { Random } from "./random";
import { ScriptRun, staleNames } from "./run";
import { readScript } from "./script";
import { createTabValuesStore, declaredValues, emptyTabValues, valuesFromTransfer, valuesToTransfer } from "./tab-values";

/** O armazém dos valores da aba (RN-VAR-023) e o que o editor lê dele (RN-VAR-024 e 025). */

const config = { random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => 1_000 };
const source = "let x = 5\nconst y = x * 2\nconst nome = 'Ana'\nlet ids = [1, 2, 3]\nlet sem: number\n\nselect @y from t;";

function evaluated(text: string, indices?: number[]) {
  const model = readScript(text, undefined, { blankLines: true });
  const run = new ScriptRun(model, config);
  for (const item of model.items) if (item.parsed !== null && (indices === undefined || indices.includes(item.index))) run.evaluate(item.index);
  return { model, run };
}

describe("createTabValuesStore", () => {
  test("começa vazio, e o snapshot só muda de identidade quando os valores mudam", () => {
    const store = createTabValuesStore();
    const first = store.snapshot();
    expect(first).toBe(emptyTabValues);
    store.clear();
    expect(store.snapshot()).toBe(first);

    const { run } = evaluated(source);
    store.replace(run.tab, run.counter);
    const second = store.snapshot();
    expect(second).not.toBe(first);
    expect(second.counter).toBe(run.counter);
    expect(second.values.get("x")?.value).toMatchObject({ kind: "number", value: 5 });
  });

  test("avisa a cada mudança, e a função devolvida desfaz o aviso", () => {
    const store = createTabValuesStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    const { run } = evaluated(source);
    store.replace(run.tab, run.counter);
    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    store.replace(run.tab, run.counter);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("clear esquece os valores e o contador (fechar a aba, trocar de banco, bloquear)", () => {
    const store = createTabValuesStore();
    const { run } = evaluated(source);
    store.replace(run.tab, run.counter);
    store.clear();
    expect(store.snapshot().values.size).toBe(0);
    expect(store.snapshot().counter).toBe(0);
  });
});

describe("declaredValues", () => {
  test("dá, por nome declarado, o tipo, o valor curto e se está desatualizado", () => {
    const { model, run } = evaluated(source);
    const shown = declaredValues({ values: run.tab, counter: run.counter }, model);
    expect(shown.get("x")).toMatchObject({ type: "number", value: "5", stale: false, origin: "literal" });
    expect(shown.get("y")).toMatchObject({ type: "number", value: "10", stale: false, origin: "expressão" });
    expect(shown.get("nome")).toMatchObject({ type: "string", value: "'Ana'" });
    expect(shown.get("ids")).toMatchObject({ type: "number[]", value: "[1, 2, 3] · 3 itens" });
    expect(shown.has("sem")).toBe(false);
  });

  test("o texto da declaração mudou depois da avaliação: desatualizado", () => {
    const { run } = evaluated(source);
    const changed = readScript(source.replace("let x = 5", "let x = 6"), undefined, { blankLines: true });
    const shown = declaredValues({ values: run.tab, counter: run.counter }, changed);
    expect(shown.get("x")?.stale).toBe(true);
    // y depende de x, e x não vale mais: y também.
    expect(shown.get("y")?.stale).toBe(true);
    expect(shown.get("nome")?.stale).toBe(false);
  });

  test("uma atribuição de que depende foi avaliada de novo depois: desatualizado", () => {
    const model = readScript(source, undefined, { blankLines: true });
    const run = new ScriptRun(model, config);
    for (const item of model.items) if (item.parsed !== null) run.evaluate(item.index);
    // x avaliado de novo (o Ctrl+Enter nele): y ficou para trás.
    const second = new ScriptRun(model, config, run.tab, run.counter);
    second.evaluate(0);
    expect([...staleNames(model, second.tab)]).toEqual(["y"]);
    const shown = declaredValues({ values: second.tab, counter: second.counter }, model);
    expect(shown.get("y")?.stale).toBe(true);
    expect(shown.get("x")?.stale).toBe(false);
  });

  test("a variável cuja declaração saiu do texto sai da leitura", () => {
    const { run } = evaluated(source);
    const shorter = readScript("let x = 5\n\nselect @x from t;", undefined, { blankLines: true });
    const shown = declaredValues({ values: run.tab, counter: run.counter }, shorter);
    expect([...shown.keys()]).toEqual(["x"]);
  });
});

describe("a passagem para outra janela", () => {
  test("os valores vão como dado e voltam iguais, com o contador", () => {
    const { run } = evaluated(source);
    const sent = valuesToTransfer({ values: run.tab, counter: run.counter });
    expect(sent).toBeDefined();
    const back = valuesFromTransfer(JSON.parse(JSON.stringify(sent)));
    expect(back.counter).toBe(run.counter);
    expect([...back.values.keys()].sort()).toEqual([...run.tab.keys()].sort());
    expect(back.values.get("ids")?.value).toEqual(run.tab.get("ids")?.value);
  });

  test("sem valores, nada vai; o que chega malformado é descartado com tudo", () => {
    expect(valuesToTransfer(emptyTabValues)).toBeUndefined();
    expect(valuesFromTransfer(undefined)).toBe(emptyTabValues);
    expect(valuesFromTransfer({ counter: 3, entries: [{ name: "x" } as never] })).toBe(emptyTabValues);
  });
});

describe("createRevealStore (RN-VAR-020 e 024)", () => {
  test("cada pedido tem um número novo, mesmo o mesmo pedido de novo, e avisa", async () => {
    const { createRevealStore } = await import("./tab-values");
    const store = createRevealStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    expect(store.getState()).toEqual({ serial: 0, name: null });

    store.reveal("x");
    store.reveal("x");
    expect(store.getState()).toEqual({ serial: 2, name: "x" });
    store.reveal(null);
    expect(store.getState()).toEqual({ serial: 3, name: null });
    expect(listener).toHaveBeenCalledTimes(3);

    off();
    store.reveal("y");
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
