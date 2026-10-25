import { describe, expect, test } from "vitest";

import { plain, testNow } from "./cases-runner";
import { Random, type Seed } from "./random";
import { evaluateScript } from "./run";
import { readScript } from "./script";

/*
 * A distribuição do `random.int` (RN-VAR-010, "Testes e sondas"): 10.000 sorteios de `random.int(1, 6)` com semente fixa ficam todos de 1 a 6, e o qui-quadrado das
 * seis contagens fica abaixo do valor crítico. Os números vêm da tabela do qui-quadrado, e não do que o gerador dá: com 6 faces são 5 graus de liberdade, e o
 * valor crítico de 0,1 % (p = 0,001) é 20,515; o esperado de cada face é 10.000 / 6.
 */

const draws = 10_000;
const faces = 6;
const critical = 20.515;

/** O qui-quadrado das contagens de cada face (1 a 6) contra o esperado de uma distribuição uniforme. */
function chiSquare(counts: number[]): number {
  const expected = draws / faces;
  return counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
}

// Algumas sementes de mão (as quatro palavras do estado): a conta vale para cada uma, e não para a que deu sorte.
const seeds: Seed[] = [
  [1, 2, 3, 4],
  [0xdeadbeef, 0x12345678, 0x9abcdef0, 0x0fedcba9],
  [42, 0, 0, 0],
  [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff],
];

describe("a distribuição do random.int(1, 6)", () => {
  test.each(seeds.map((seed) => ({ seed })))("10.000 sorteios do gerador, semente $seed: todos de 1 a 6 e o qui-quadrado abaixo do crítico", ({ seed }) => {
    const random = new Random(seed);
    const counts = new Array<number>(faces).fill(0);
    for (let draw = 0; draw < draws; draw++) {
      const value = random.int(1, 6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
      counts[value - 1]++;
    }
    // Toda face sai (com 10.000 sorteios, uma face que nunca sai é defeito, e não sorte).
    for (const count of counts) expect(count).toBeGreaterThan(0);
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(draws);
    expect(chiSquare(counts)).toBeLessThan(critical);
  });

  test("10.000 sorteios pela linguagem (20 scripts de 500 declarações, cada um com a sua semente): todos de 1 a 6 e o qui-quadrado abaixo do crítico", () => {
    const script = Array.from({ length: 500 }, (_, index) => `const d${index} = random.int(1, 6)`).join("\n");
    const model = readScript(script, undefined);
    const counts = new Array<number>(faces).fill(0);
    let total = 0;
    for (let round = 0; round < 20; round++) {
      const report = evaluateScript(model, { engine: undefined, random: new Random([round + 1, 7, 11, 13]), clock: () => 0, now: () => testNow() });
      expect(report.checkErrors).toEqual([]);
      expect(report.results).toHaveLength(500);
      for (const result of report.results) {
        expect(result.ok).toBe(true);
        if (!result.ok) continue;
        const value = plain(result.stored.value);
        expect(typeof value).toBe("number");
        expect(value as number).toBeGreaterThanOrEqual(1);
        expect(value as number).toBeLessThanOrEqual(6);
        expect(Number.isInteger(value)).toBe(true);
        counts[(value as number) - 1]++;
        total++;
      }
    }
    expect(total).toBe(draws);
    expect(chiSquare(counts)).toBeLessThan(critical);
  });
});
