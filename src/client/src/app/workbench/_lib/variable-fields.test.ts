import { describe, expect, it } from "vitest";

import { answersOf, declaresAtTop, emptyInput, entryOf, fieldsOf, fullFieldsOf, helpOf, inputOf, inputOfEntry, pastedItems, rememberedLimit, rememberedOf, valueOf, type VariableField } from "./variable-fields";
import { readScript } from "./variables/script";
import { displayValue, nullValue, numberType, stringValue, type Type } from "./variables/values";

// RN-VAR-021 e 027: os campos da pergunta dos valores, a ajuda do comentário e a leitura do que a pessoa escreveu.
const read = (text: string) => readScript(text, 1, { blankLines: true });
const indicesOf = (text: string) => read(text).items.flatMap((item, index) => (item.parsed?.kind === "declaration" ? [index] : []));
const fieldOf = (text: string, columns?: Map<string, { type: Type } | { error: string }>) => {
  const model = read(text);
  return fieldsOf(model, indicesOf(text), columns);
};
const only = (text: string): VariableField => fieldOf(text).fields[0];

describe("a ajuda do campo", () => {
  it("o comentário na mesma linha, depois da declaração, ou o que está sozinho na linha de cima", () => {
    const model = read("-- o cliente\nlet x: number -- ajuda\nlet y: Date | null\n// o dia\nlet z: Date\nselect @x, @y, @z;");
    expect(helpOf(model.source, model.items[0])).toBe("ajuda");
    expect(helpOf(model.source, model.items[1])).toBeNull();
    expect(helpOf(model.source, model.items[2])).toBe("o dia");
  });

  it("corta em 200 caracteres", () => {
    const model = read(`let x: number -- ${"a".repeat(300)}\nselect @x;`);
    expect(helpOf(model.source, model.items[0])).toHaveLength(200);
  });
});

describe("os campos", () => {
  it("um por declaração, pelo tipo, com o nome e o tipo escrito", () => {
    const { fields } = fieldOf("let n: number\nlet s: string\nlet b: boolean\nlet d: Date\nlet l: number[] | null\nlet q: sql\nselect 1;");
    expect(fields.map((field) => [field.name, field.kind, field.list, field.nullable, field.typeText])).toEqual([
      ["n", "number", false, false, "number"],
      ["s", "string", false, false, "string"],
      ["b", "boolean", false, false, "boolean"],
      ["d", "date", false, false, "Date"],
      ["l", "number", true, true, "number[] | null"],
      ["q", "sql", false, false, "sql"],
    ]);
  });

  it("o tipo de coluna vem do catálogo; a coluna que não se resolveu é erro do script, com a linha", () => {
    const columns = new Map<string, { type: Type } | { error: string }>([["pedido.criado_em", { type: { tag: "date", precision: "instant" } }]]);
    const ok = fieldOf("let c: pedido.criado_em\nselect @c;", columns);
    expect(ok.fields[0]).toMatchObject({ kind: "instant", column: "pedido.criado_em" });
    const failed = fieldOf("let c: pedido.cliente_id\nselect @c;", columns);
    expect(failed.fields).toEqual([]);
    expect(failed.errors).toEqual([{ line: 1, column: 8, offset: 7, message: "O tipo da coluna pedido.cliente_id não foi lido do catálogo." }]);
  });
});

describe("o valor do campo", () => {
  it("o vazio é obrigatório, menos com o NULL marcado", () => {
    expect(valueOf(only("let n: number\nselect @n;"), emptyInput)).toEqual({ ok: false, message: "Escreva um valor para n." });
    expect(valueOf(only("let n: number | null\nselect @n;"), { ...emptyInput, isNull: true })).toEqual({ ok: true, value: nullValue });
  });

  it("o número com ponto; com a vírgula, a frase do exemplo", () => {
    const field = only("let n: number\nselect @n;");
    expect(valueOf(field, { ...emptyInput, text: "3,5" })).toEqual({ ok: false, message: "Escreva um número, como 42 ou 3.5." });
    const read = valueOf(field, { ...emptyInput, text: " 3.50 " });
    expect(read.ok && displayValue(read.value)).toBe("3.50");
    expect(valueOf(field, { ...emptyInput, text: "42" })).toEqual({ ok: true, value: { kind: "number", value: 42 } });
  });

  it("o texto não é aparado; o sql entra como está", () => {
    expect(valueOf(only("let s: string\nselect @s;"), { ...emptyInput, text: " a " })).toEqual({ ok: true, value: stringValue(" a ") });
    expect(valueOf(only("let q: sql\nselect @q;"), { ...emptyInput, text: "pedido" })).toEqual({ ok: true, value: { kind: "sql", text: "pedido" } });
  });

  it("o booleano pela caixa", () => {
    expect(valueOf(only("let b: boolean\nselect @b;"), { ...emptyInput, checked: true })).toEqual({ ok: true, value: { kind: "boolean", value: true } });
  });

  it("a data: sem a hora é de dia; com ela, de instante; a de instante pede a hora", () => {
    const date = only("let d: Date\nselect @d;");
    expect(valueOf(date, emptyInput)).toEqual({ ok: false, message: "Escolha uma data." });
    const day = valueOf(date, { ...emptyInput, text: "2026-09-20" });
    expect(day.ok && day.value).toMatchObject({ kind: "date", precision: "day" });
    const instant = valueOf(date, { ...emptyInput, text: "2026-09-20", time: "14:32" });
    expect(instant.ok && displayValue(instant.value)).toBe("2026-09-20 14:32:00");
    const columns = new Map([["pedido.criado_em", { type: { tag: "date", precision: "instant" } as Type }]]);
    const exact = fieldOf("let c: pedido.criado_em\nselect @c;", columns).fields[0];
    expect(valueOf(exact, { ...emptyInput, text: "2026-09-20" })).toEqual({ ok: false, message: "Escolha a hora." });
  });

  it("a lista, item a item, com a frase do item que não serve", () => {
    const field = only("let ids: number[]\nselect @ids;");
    const list = valueOf(field, { ...emptyInput, items: ["1", "2"] });
    expect(list.ok && displayValue(list.value)).toBe("[1, 2]");
    expect(valueOf(field, { ...emptyInput, items: ["1", "x"] })).toEqual({ ok: false, message: "'x': Escreva um número, como 42 ou 3.5." });
  });
});

describe("o campo preenchido com o valor da vez anterior", () => {
  it("volta o que a pessoa escreveu", () => {
    const field = only("let n: number\nselect @n;");
    const first = valueOf(field, { ...emptyInput, text: "3.50" });
    expect(first.ok && inputOf(first.value)).toEqual({ ...emptyInput, text: "3.50" });
    expect(inputOf(nullValue)).toEqual({ ...emptyInput, isNull: true });
    expect(inputOf({ kind: "list", items: [{ kind: "number", value: 1 }] })).toEqual({ ...emptyInput, items: ["1"] });
    expect(inputOf({ kind: "date", precision: "instant", fields: { year: 2026, month: 9, day: 20, hour: 14, minute: 5, second: 0, millisecond: 0 } })).toEqual({ ...emptyInput, text: "2026-09-20", time: "14:05:00" });
    expect(field.declared).toEqual(numberType);
  });
});

describe("colar num campo de itens", () => {
  it("uma linha por item; as vazias do meio saem no número e ficam no texto; a do fim sai", () => {
    expect(pastedItems({ kind: "number" }, "1\r\n\n2\r3\n")).toEqual(["1", "2", "3"]);
    expect(pastedItems({ kind: "string" }, "a\n\n b \n")).toEqual(["a", "", " b "]);
  });
});

describe("os campos do Executar com valores (RN-VAR-027)", () => {
  const full = (text: string, dependent: number[] = []) => fullFieldsOf(read(text), 1, undefined, new Set(dependent));

  it("um por declaração do topo: o literal preenchido, a expressão como dica, a sem valor obrigatória; a consulta e o random.of são calculados", () => {
    const { fields, calculated } = full("let n = 10\nconst d = date.addDays(date.today(), -30)\nlet x: number\nlet t = (select 1)\nlet r = random.of(pedido.id)\nselect @n, @d, @x;");
    expect(fields.map((field) => [field.name, field.typeText, field.fallback.kind])).toEqual([
      ["n", "number", "literal"],
      ["d", "Date (dia)", "expression"],
      ["x", "number", "none"],
    ]);
    expect(fields[0].fallback).toEqual({ kind: "literal", input: { ...emptyInput, text: "10" } });
    expect(fields[1].fallback).toEqual({ kind: "expression", text: "date.addDays(date.today(), -30)" });
    expect(calculated).toEqual(["t", "r"]);
  });

  it("depois do primeiro comando, só as sem valor, sob \"Mais abaixo no script\"; a que depende de uma sem valor é calculada", () => {
    const { fields, calculated } = full("let x: number\nconst y = x * 2\nselect @y;\nlet z: string\nlet w = 1\nselect @z, @w;");
    expect(fields.map((field) => [field.name, field.below])).toEqual([
      ["x", false],
      ["z", true],
    ]);
    expect(calculated).toEqual(["y"]);
  });

  it("o campo com padrão que a pessoa não mexeu não vai; o mexido vai no lugar da expressão", () => {
    const { fields } = full("let n = 10\nconst d = random.int(1, 6)\nlet x: number\nselect @n, @d, @x;");
    const inputs = new Map([[0, { ...emptyInput, text: "10" }], [1, { ...emptyInput, text: "4" }], [2, { ...emptyInput, text: "7" }]]);
    expect([...answersOf(fields, inputs, new Set([1])).answers.keys()]).toEqual([1, 2]);
    expect(answersOf(fields, new Map(), new Set()).problems).toEqual(new Map([[2, "Escreva um valor para x."]]));
  });

  it("o script declara variáveis no topo só quando o primeiro item é uma declaração", () => {
    expect(declaresAtTop(read("-- topo\nlet x = 1\nselect @x;"))).toBe(true);
    expect(declaresAtTop(read("select 1;\nlet x = 1"))).toBe(false);
  });
});

describe("os valores lembrados (RN-VAR-028)", () => {
  it("cada valor vira a entrada da API, e a entrada volta ao campo", () => {
    const instant = { kind: "date" as const, precision: "instant" as const, fields: { year: 2026, month: 9, day: 20, hour: 14, minute: 5, second: 0, millisecond: 0 } };
    expect(entryOf(instant)).toEqual({ type: "timestamp", value: "2026-09-20 14:05:00" });
    expect(inputOfEntry(entryOf(instant))).toEqual({ ...emptyInput, text: "2026-09-20", time: "14:05:00" });
    expect(entryOf({ kind: "list", items: [{ kind: "number", value: 1 }] })).toEqual({ type: "list", items: [{ type: "number", value: "1" }] });
    expect(inputOfEntry({ type: "list", items: [{ type: "number", value: "1" }] })).toEqual({ ...emptyInput, items: ["1"] });
    expect(inputOfEntry({ type: "boolean", value: "true" })).toEqual({ ...emptyInput, checked: true });
    expect(inputOfEntry({ type: "null", value: null })).toEqual({ ...emptyInput, isNull: true });
    expect(inputOfEntry("lixo")).toBeNull();
    expect(inputOfEntry({ type: "number", value: 7 })).toBeNull();
  });

  it("lembra na ordem dos campos, e o que passaria de 64 KiB fica de fora", () => {
    const { fields } = fieldOf("let a: string\nlet b: string\nselect @a, @b;");
    const big = "x".repeat(rememberedLimit);
    const remembered = rememberedOf(fields, new Map([[0, stringValue("curto")], [1, stringValue(big)]]));
    expect(remembered).toEqual({ values: { a: { type: "text", value: "curto" } }, tooLarge: ["b"] });
  });
});
