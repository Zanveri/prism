import { describe, expect, it } from "vitest";

import { parseWholeNumber } from "./whole-number";

describe("parseWholeNumber (o que um campo numérico das Configurações aceita)", () => {
  it.each([
    ["13", 13],
    [" 13 ", 13],
    ["010", 10],
    ["24", 24],
    ["10", 10],
  ])("aceita %j (de 10 a 24)", (text, expected) => {
    expect(parseWholeNumber(text, 10, 24)).toBe(expected);
  });

  it.each(["", " ", "abc", "1.5", "13,5", "-13", "+13", "1e1", "0x10", "13 px", "٣", "NaN", "Infinity", "99999999999999999999999"])("recusa %j", (text) => {
    expect(parseWholeNumber(text, 10, 24)).toBeNull();
  });

  it("recusa o que está fora do intervalo, nos dois lados, e aceita os limites", () => {
    expect(parseWholeNumber("9", 10, 24)).toBeNull();
    expect(parseWholeNumber("25", 10, 24)).toBeNull();
    expect(parseWholeNumber("1", 1, 8)).toBe(1);
    expect(parseWholeNumber("8", 1, 8)).toBe(8);
    expect(parseWholeNumber("0", 1, 8)).toBeNull();
  });
});
