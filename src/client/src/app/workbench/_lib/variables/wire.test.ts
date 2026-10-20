import { describe, expect, test } from "vitest";

import { plain } from "./cases-runner";
import { storedFromWire, storedToWire, typeFromWire, typeToWire, fromWire, toWire } from "./wire";
import { Random } from "./random";
import { evaluateScript } from "./run";
import { readScript } from "./script";
import { dateValue, falseValue, listValue, nullValue, numberValue, objectValue, sqlValue, stringValue, typeLabel, typeOfValue, type Type } from "./values";

/** O que a especificação pede de um valor que atravessa o Worker: volta igual, sem ganhar nem perder nada, e o dado malformado nunca vira valor. */
const through = <T>(data: T): unknown => JSON.parse(JSON.stringify(data));

const fields = { year: 2026, month: 10, day: 20, hour: 10, minute: 30, second: 5, millisecond: 7 };

const samples = [
  numberValue(0),
  numberValue(-12.5),
  numberValue(9007199254740992, "9007199254740993"),
  numberValue(0.1, "0.10"),
  stringValue(""),
  stringValue("ção 😀 \n\t\"'\\"),
  falseValue,
  nullValue,
  dateValue({ ...fields, hour: 0, minute: 0, second: 0, millisecond: 0 }, "day"),
  dateValue(fields, "instant"),
  dateValue(fields, "instant", "2026-10-20 10:30:05.007000"),
  listValue([]),
  listValue([numberValue(1), nullValue, numberValue(3)]),
  objectValue([["a", numberValue(1)], ["b", listValue([stringValue("x")])], ["ç", nullValue]]),
  sqlValue("a.id = 1"),
];

describe("wire", () => {
  test.each(samples.map((value, index) => [index, value] as const))("o valor %i atravessa o JSON e volta igual", (_index, value) => {
    const back = fromWire(through(toWire(value)));
    expect(plain(back)).toEqual(plain(value));
    expect(back.kind).toBe(value.kind);
    expect(typeLabel(typeOfValue(back))).toBe(typeLabel(typeOfValue(value)));
    // Volta como valor da linguagem: congelado e sem protótipo.
    expect(Object.isFrozen(back)).toBe(true);
    expect(Object.getPrototypeOf(back)).toBeNull();
  });

  test("o número exato volta com o texto e a marca de inexato", () => {
    const back = fromWire(through(toWire(numberValue(9007199254740992, "9007199254740993"))));
    expect(back).toMatchObject({ kind: "number", exact: "9007199254740993", inexact: true });
  });

  test("a chave __proto__ de um objeto continua dado", () => {
    // O texto da pessoa não chega a ser chave (a lista vedada a recusa); o dado de fora também não.
    expect(() => fromWire({ k: "object", f: [["__proto__", { k: "number", v: 1 }]] })).toThrow();
    expect(() => fromWire(JSON.parse('{"k":"object","f":[["constructor",{"k":"null"}]]}'))).toThrow();
    const back = fromWire({ k: "object", f: [["proto", { k: "number", v: 1 }]] });
    expect(back.kind === "object" && back.fields.get("proto")).toMatchObject({ value: 1 });
  });

  test.each([
    ["nulo", null],
    ["número solto", 1],
    ["lista", []],
    ["sem k", {}],
    ["k desconhecido", { k: "function", v: 1 }],
    ["k que é propriedade do Object", { k: "constructor" }],
    ["número com texto", { k: "number", v: "1" }],
    ["número infinito", { k: "number", v: Number.POSITIVE_INFINITY }],
    ["número NaN", { k: "number", v: Number.NaN }],
    ["texto com NUL", { k: "string", v: "a\u0000b" }],
    ["texto com metade de par", { k: "string", v: "\ud800" }],
    ["lógico com texto", { k: "boolean", v: "true" }],
    ["data com seis campos", { k: "date", f: [2026, 1, 1, 0, 0, 0], p: "day" }],
    ["data que não existe", { k: "date", f: [2026, 2, 30, 0, 0, 0, 0], p: "day" }],
    ["data com precisão errada", { k: "date", f: [2026, 1, 1, 0, 0, 0, 0], p: "week" }],
    ["lista que não é lista", { k: "list", i: "x" }],
    ["lista mista", { k: "list", i: [{ k: "number", v: 1 }, { k: "string", v: "a" }] }],
    ["lista de lista", { k: "list", i: [{ k: "list", i: [] }] }],
    ["campo sem valor", { k: "object", f: [["a"]] }],
    ["campo com chave que não é texto", { k: "object", f: [[1, { k: "null" }]] }],
    ["sql com NUL", { k: "sql", t: "a\u0000" }],
  ])("recusa o valor malformado: %s", (_name, data) => {
    expect(() => fromWire(data)).toThrow();
  });

  test("os tipos atravessam o JSON e voltam iguais", () => {
    const types: Type[] = [
      { tag: "number" },
      { tag: "date" },
      { tag: "date", precision: "day" },
      { tag: "list", item: { tag: "nullable", of: { tag: "string" } } },
      { tag: "object", fields: new Map<string, Type>([["a", { tag: "number" }], ["b", { tag: "list", item: { tag: "never" } }]]) },
      { tag: "nullable", of: { tag: "date", precision: "instant" } },
      { tag: "sql" },
      { tag: "null" },
    ];
    for (const type of types) expect(typeFromWire(through(typeToWire(type)))).toEqual(type);
    for (const bad of [null, {}, { t: "constructor" }, { t: "list" }, { t: "object", f: [["a"]] }, { t: "nullable" }]) expect(() => typeFromWire(bad)).toThrow();
  });

  test("a aba atravessa o JSON: o que o script guardou volta igual, e o dado malformado é recusado", () => {
    const model = readScript("const a = 1 + 2\nlet b: string[] = ['x']\nconst c = random.int(1, 6)", undefined);
    const report = evaluateScript(model, { random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => 0 });
    expect(report.checkErrors).toEqual([]);
    expect(report.tab.size).toBe(3);
    for (const entry of report.tab.values()) {
      const back = storedFromWire(through(storedToWire(entry)));
      expect(back).toEqual(entry);
    }
    const good = storedToWire([...report.tab.values()][0]!);
    expect(() => storedFromWire({ ...good, origin: "constructor" })).toThrow();
    expect(() => storedFromWire({ ...good, order: "1" })).toThrow();
    expect(() => storedFromWire({ ...good, value: { k: "x" } })).toThrow();
    expect(() => storedFromWire(null)).toThrow();
  });

  test("o valor avaliado de um script atravessa o Worker sem mudar", () => {
    const model = readScript("const x = { a: 1, b: [1, 2], c: 'z', d: null, e: date.today() }", undefined);
    const report = evaluateScript(model, { random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => 0 });
    const first = report.results[0];
    expect(first?.ok).toBe(true);
    if (first?.ok === true) expect(plain(fromWire(through(toWire(first.stored.value))))).toEqual(plain(first.stored.value));
  });
});
