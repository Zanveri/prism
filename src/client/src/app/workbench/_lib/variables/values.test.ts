import { describe, expect, test } from "vitest";

import { dateValue, listValue, nullValue, numberValue, objectValue, sqlValue, stringValue, forbiddenMembers } from "./values";

/** Os valores da linguagem são registros congelados, sem protótipo: nada que a pessoa escreve chega a uma propriedade do JavaScript (RN-VAR-014). */
describe("valores", () => {
  const sample = [
    numberValue(1),
    numberValue(1, "1.0"),
    stringValue("a"),
    nullValue,
    dateValue({ year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 }, "day"),
    listValue([numberValue(1)]),
    objectValue([["a", numberValue(1)]]),
    sqlValue("1 = 1"),
  ];

  test.each(sample.map((value) => [value.kind, value] as const))("%s é congelado e sem protótipo", (_kind, value) => {
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(() => {
      (value as unknown as Record<string, unknown>).kind = "x";
    }).toThrow(TypeError);
    expect(() => {
      (value as unknown as Record<string, unknown>).extra = 1;
    }).toThrow(TypeError);
  });

  test("a lista e a data são congeladas por dentro", () => {
    const list = listValue([numberValue(1)]);
    expect(Object.isFrozen(list.items)).toBe(true);
    expect(() => (list.items as unknown[]).push(1)).toThrow(TypeError);
    const date = dateValue({ year: 2026, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 }, "day");
    expect(Object.isFrozen(date.fields)).toBe(true);
  });

  test("a lista copia os itens: mudar o vetor de origem não muda a lista", () => {
    const source = [numberValue(1)];
    const list = listValue(source);
    source.push(numberValue(2));
    expect(list.items).toHaveLength(1);
  });

  test("os campos do objeto ficam num Map que não se muda", () => {
    const object = objectValue([["a", numberValue(1)]]);
    expect(object.fields).toBeInstanceOf(Map);
    const map = object.fields as Map<string, unknown>;
    expect(() => map.set("b", 1)).toThrow(TypeError);
    expect(() => map.delete("a")).toThrow(TypeError);
    expect(() => map.clear()).toThrow(TypeError);
    expect(Object.isFrozen(map)).toBe(true);
    expect(object.fields.get("a")).toMatchObject({ value: 1 });
    expect(object.fields.get("toString")).toBeUndefined();
    expect(object.fields.get("__proto__")).toBeUndefined();
  });

  test.each([...forbiddenMembers])("a chave %s é recusada", (key) => {
    expect(() => objectValue([[key, nullValue]])).toThrow();
  });

  test("o objeto passa do limite de campos", () => {
    expect(() => objectValue(Array.from({ length: 101 }, (_, index) => [`k${index}`, nullValue] as const))).toThrow();
    expect(objectValue(Array.from({ length: 100 }, (_, index) => [`k${index}`, nullValue] as const)).fields.size).toBe(100);
  });

  test("o zero negativo vira zero e o que não é número finito não vira valor", () => {
    expect(Object.is(numberValue(-0).value, 0)).toBe(true);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(() => numberValue(bad)).toThrow();
  });
});
