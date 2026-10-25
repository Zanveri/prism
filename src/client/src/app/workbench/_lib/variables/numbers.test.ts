import { describe, expect, it } from "vitest";
import { isExactNumber } from "./numbers";

describe("isExactNumber", () => {
  it("compara os decimais escritos de outro jeito (RN-VAR-005)", () => {
    expect(isExactNumber("12.50", 12.5)).toBe(true);
    expect(isExactNumber("100.00", 100)).toBe(true);
    expect(isExactNumber("1e3", 1000)).toBe(true);
    expect(isExactNumber("9007199254740993", 9007199254740992)).toBe(false);
  });

  it("não demora numa corrida longa de zeros seguida de outro dígito (RN-VAR-013, 014)", () => {
    const text = `1${"0".repeat(200_000)}1e-200000`;
    const started = performance.now();
    expect(isExactNumber(text, Number(text))).toBe(false);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("tira os zeros do fim dos dígitos e leva a conta para o expoente", () => {
    expect(isExactNumber(`1${"0".repeat(30)}e-30`, 1)).toBe(true);
    expect(isExactNumber("0.000", 0)).toBe(true);
  });
});
