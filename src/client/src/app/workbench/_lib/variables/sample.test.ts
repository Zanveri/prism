import { describe, expect, it } from "vitest";

import type { ColumnRead } from "./column-types";
import { Random } from "./random";
import { samplePositions, sampleReach, sampleValue } from "./sample";
import { numberType } from "./values";

// O `random.of` (RN-VAR-010): as posições sorteadas entre os valores da coluna e o valor de cada uma.
const message = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { message: string }).message;
  }
  throw new Error("esperava um erro");
};

describe("as posições", () => {
  it("uma posição entre as que a coluna tem; a lista, posições diferentes", () => {
    const random = new Random([1, 2, 3, 4]);
    expect(samplePositions("random.of(c.id)", 1, null, random)).toEqual([0]);
    const positions = samplePositions("random.of(c.id, 5)", 5, 5, random);
    expect([...positions].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it("a mesma semente dá as mesmas posições", () => {
    expect(samplePositions("random.of(c.id, 3)", 50, 3, new Random([9, 8, 7, 6]))).toEqual(samplePositions("random.of(c.id, 3)", 50, 3, new Random([9, 8, 7, 6])));
  });

  it("a coluna sem valores e a que tem menos que os pedidos são frases", () => {
    expect(message(() => samplePositions("random.of(cliente.id)", 0, null, new Random([1, 2, 3, 4])))).toBe("random.of(cliente.id): a coluna não tem valores.");
    expect(message(() => samplePositions("random.of(cliente.id, 10)", 3, 10, new Random([1, 2, 3, 4])))).toBe("random.of(cliente.id, 10): a coluna só tem 3 valores.");
    expect(message(() => samplePositions("random.of(cliente.id, 2)", 1, 2, new Random([1, 2, 3, 4])))).toBe("random.of(cliente.id, 2): a coluna só tem 1 valor.");
  });

  it("não passa da posição que a rota dos valores alcança", () => {
    const positions = samplePositions("random.of(c.id, 100)", 50_000_000, 100, new Random([5, 6, 7, 8]));
    expect(positions.every((position) => position < sampleReach)).toBe(true);
  });
});

describe("o valor", () => {
  const read = (kind: "number" | "day" | "string", dbType: string): Extract<ColumnRead, { ok: true }> => ({ ok: true, type: numberType, kind, schema: "public", table: "t", column: "c", isPrimaryKey: false, dbType });

  it("pelo tipo da coluna", () => {
    expect(sampleValue("random.of(t.c)", { value: "7", truncated: false }, read("number", "integer"), 1)).toMatchObject({ kind: "number", value: 7 });
    expect(sampleValue("random.of(t.c)", { value: "2026-10-20", truncated: false }, read("day", "date"), 1)).toMatchObject({ kind: "date", precision: "day" });
    expect(sampleValue("random.of(t.c)", { value: "Ana", truncated: false }, read("string", "text"), 1)).toMatchObject({ kind: "string", value: "Ana" });
  });

  it("o valor que a API cortou é recusado", () => {
    expect(message(() => sampleValue("random.of(t.c)", { value: "x", truncated: true }, read("string", "text"), 1))).toBe("random.of(t.c): o valor sorteado passa de 10.000 caracteres e não vem inteiro do banco.");
  });
});
