import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { scanMarkers } from "./markers";

/**
 * A fixture que a tela e a API dividem (RN-VAR-017 e 032): `src/test-fixtures/variables/markers.json`, escrita à mão, com os casos de contagem dos marcadores de parâmetro
 * (o texto, o banco e o número de marcadores). Os dois leitores têm de contar igual; a API lê o mesmo arquivo (a conferência dos `params`).
 */
const file = new URL("../../../../../../../src/test-fixtures/variables/markers.json", import.meta.url);
const engines: Record<string, Engine> = { postgresql: 1, db2: 2, informix: 3 };

type MarkerCase = { name: string; engine: string; text: string; count: number; numbers?: number[] };
const cases = (JSON.parse(readFileSync(file, "utf8")) as { cases: MarkerCase[] }).cases;

describe("markers.json", () => {
  test.each(cases)("$name", ({ engine, text, count, numbers }) => {
    const scan = scanMarkers(text, engines[engine]);
    expect(scan.count).toBe(count);
    if (numbers !== undefined) expect(scan.numbers).toEqual(numbers);
  });

  test("os três bancos têm casos", () => {
    expect(new Set(cases.map((c) => c.engine))).toEqual(new Set(["postgresql", "db2", "informix"]));
  });
});
