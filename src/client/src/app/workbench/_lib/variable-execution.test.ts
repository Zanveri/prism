import { describe, expect, it } from "vitest";

import { bindItem, planItem, planScript, scopeBefore, usesVariables } from "./variable-execution";
import { Random } from "./variables/random";
import { ScriptRun, type StoredValue } from "./variables/run";

// O que a execução com variáveis decide antes do Worker e do banco (RN-VAR-019 e 020).
const doc = (text: string) => ({ text, blankLines: true });
const none = new Map<string, StoredValue>();

describe("planScript: o Alt+X (RN-VAR-019)", () => {
  const text = "const a = 1\nlet b = a + 1\n\nselect @b;\nselect 2;";

  it("o texto inteiro: os itens na ordem, com o tipo, o texto e o lugar no editor", () => {
    const planned = planScript(doc(text), 1, 0, text.length, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.items.map((item) => [item.kind, item.text, item.offset])).toEqual([
      ["declaration", "const a = 1", 0],
      ["declaration", "let b = a + 1", 12],
      ["statement", "select @b", 27],
      ["statement", "select 2", 38],
    ]);
    expect(planned.plan.outer).toEqual([]);
    expect(planned.plan.errors).toEqual([]);
  });

  it("a seleção usa as declarações de cima: elas são avaliadas antes, fora do que vai", () => {
    const from = text.indexOf("select @b");
    const planned = planScript(doc(text), 1, from, from + "select @b;".length, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.items.map((item) => item.text)).toEqual(["select @b"]);
    expect(planned.plan.outer).toEqual([0, 1]);
  });

  it("a seleção que começa no meio de um comando manda só o trecho dela", () => {
    const sql = "select a,\n       b from t where x = 1;";
    const from = sql.indexOf("b from");
    const planned = planScript(doc(sql), 1, from, sql.length, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.items.map((item) => [item.text, item.offset])).toEqual([["b from t where x = 1", from]]);
  });

  it("os valores que a aba já tem em dia não são avaliados de novo fora da seleção", () => {
    const model = planScript(doc(text), 1, 0, text.length, none);
    if (!model.ok) throw new Error("esperava o plano");
    const run = new ScriptRun(model.plan.model, { random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => 1 });
    run.evaluate(0);
    run.evaluate(1);
    const from = text.indexOf("select @b");
    const again = planScript(doc(text), 1, from, from + "select @b;".length, run.tab);
    if (!again.ok) throw new Error("esperava o plano");
    expect(again.plan.outer).toEqual([]);
  });

  it("a conferência acha só os erros do que vai e das atribuições de que depende", () => {
    const sql = "const ruim = 1\nruim = 2\nlet bom = 3\n\nselect @bom;";
    const from = sql.indexOf("select");
    const planned = planScript(doc(sql), 1, from, sql.length, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.errors).toEqual([]);
    const whole = planScript(doc(sql), 1, 0, sql.length, none);
    if (!whole.ok) throw new Error("esperava o plano");
    expect(whole.plan.errors.map((error) => error.line)).toEqual([2]);
  });

  it("a seleção em branco não tem o que executar", () => {
    expect(planScript(doc("select 1;\n   \n"), 1, 9, 13, none)).toEqual({ ok: false, reason: "nothing" });
  });
});

describe("planItem: o Ctrl+Enter (RN-VAR-020)", () => {
  const text = "let x = 5\nconst y = x * 2\n\nselect @y;";

  it("o cursor numa declaração: ela, com as de que depende", () => {
    const planned = planItem(doc(text), 1, text.indexOf("const y") + 2, text.indexOf("const y") + 2, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.items.map((item) => [item.index, item.kind])).toEqual([[1, "declaration"]]);
    expect(planned.plan.outer).toEqual([0]);
  });

  it("o cursor num comando: ele, e as atribuições de que depende, todas a avaliar com a aba vazia", () => {
    const planned = planItem(doc(text), 1, text.length - 3, text.length - 3, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.items[0]).toMatchObject({ index: 2, kind: "statement" });
    expect(planned.plan.outer).toEqual([0, 1]);
  });

  it("o cursor na linha em branco logo depois de uma declaração avalia a declaração", () => {
    const planned = planItem(doc(text), 1, "let x = 5\nconst y = x * 2\n".length, "let x = 5\nconst y = x * 2\n".length, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.items[0]).toMatchObject({ index: 1, kind: "declaration" });
  });

  it("a seleção com uma declaração e outro item tem mais de um: o aviso de hoje", () => {
    expect(planItem(doc(text), 1, 0, text.length, none)).toEqual({ ok: false, reason: "tooMany", count: 3 });
  });

  it("a seleção de um comando só manda o texto selecionado", () => {
    const from = text.indexOf("select");
    const planned = planItem(doc(text), 1, from, text.length, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.items[0]).toMatchObject({ text: "select @y;", kind: "statement" });
  });

  it("sem item no texto, nada", () => {
    expect(planItem(doc("  \n\n"), 1, 1, 1, none)).toEqual({ ok: false, reason: "nothing" });
  });
});

describe("a troca pelos marcadores com os valores deste ponto", () => {
  it("cada comando leva o valor da última atribuição acima dele (RN-VAR-012)", () => {
    const text = "let x = 1\nselect @x;\nx = 2\nselect @x;";
    const planned = planScript(doc(text), 1, 0, text.length, none);
    if (!planned.ok) throw new Error("esperava o plano");
    const { model } = planned.plan;
    const run = new ScriptRun(model, { random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => 1 });
    const results = new Map<number, StoredValue>();
    for (const index of [0, 2]) {
      const result = run.evaluate(index);
      if (result.ok) results.set(index, result.stored);
    }
    const sentOf = (index: number) => {
      const bound = bindItem(model, index, scopeBefore(model, index, results, none), 1);
      if (!bound.ok) throw new Error(bound.error.message);
      return bound.command.params.map((parameter) => parameter.value);
    };
    expect(sentOf(1)).toEqual(["1"]);
    expect(sentOf(3)).toEqual(["2"]);
    expect(usesVariables(model.items[1])).toBe(true);
  });
});

// O script que passa de 500 declarações (RN-VAR-013): a cadeia longa não estoura a pilha e a pessoa vê o erro, em vez de a tela travar.
describe("o script de milhares de declarações (RN-VAR-013)", () => {
  const chain = (count: number) => `let a0 = 0\n${Array.from({ length: count - 1 }, (_, index) => `let a${index + 1} = a${index}`).join("\n")}\nselect @a${count - 1};`;

  it("o Ctrl+Enter no fim de uma cadeia de 6.000 declarações dá o erro dos 500, e não estoura a pilha", () => {
    const text = chain(6000);
    const cursor = text.length - 3;
    const planned = planItem(doc(text), 1, cursor, cursor, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.errors.map((error) => error.message)).toContain("O script passou de 500 declarações.");
    expect(planned.plan.outer.length).toBe(6000);
  });

  it("o Alt+X do texto inteiro dá o erro dos 500 sem avaliar as declarações em seco", () => {
    const text = chain(3000);
    const started = performance.now();
    const planned = planScript(doc(text), 1, 0, text.length, none);
    if (!planned.ok) throw new Error("esperava o plano");
    expect(planned.plan.errors.map((error) => error.message)).toContain("O script passou de 500 declarações.");
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe("planItem: o item do cursor é o do Ctrl+Enter de sempre (RN-SQL-001, RN-SQL-018)", () => {
  const textItem = (text: string, cursor: number) => {
    const planned = planItem(doc(text), 1, cursor, cursor, none);
    if (!planned.ok) throw new Error(`esperava o plano: ${planned.reason}`);
    return planned.plan.items.map((item) => item.text);
  };

  it("a linha em branco depois do último comando fica com o comando de cima", () => {
    const text = "let id = 7\n\nselect * from t where id = @id;\n";
    expect(textItem(text, text.length)).toEqual(["select * from t where id = @id"]);
  });

  it("o fim da linha do comando de cima, com o ; já escrito, é o comando de cima", () => {
    const text = "let id = 7\n\nselect 1;\n\nselect 2;";
    expect(textItem(text, text.indexOf("select 1;") + "select 1;".length)).toEqual(["select 1"]);
  });

  it("a linha em branco logo depois de uma declaração é a declaração", () => {
    const text = "let id = 7\n\nselect 1;";
    expect(textItem(text, "let id = 7\n".length)).toEqual(["let id = 7"]);
  });
});
