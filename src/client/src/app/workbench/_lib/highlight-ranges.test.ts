import { describe, expect, it } from "vitest";

import { segmentsOf } from "./highlight-ranges";

describe("segmentsOf (RN-VAR-018: o trecho de uma variável sql)", () => {
  it("sem faixas, o texto inteiro", () => {
    expect(segmentsOf("select 1", undefined)).toEqual([{ text: "select 1", marked: false }]);
    expect(segmentsOf("select 1", [])).toEqual([{ text: "select 1", marked: false }]);
  });

  it("parte o texto em volta de cada faixa", () => {
    expect(segmentsOf("select * from pedido where a = 1", [{ start: 14, end: 20 }])).toEqual([
      { text: "select * from ", marked: false },
      { text: "pedido", marked: true },
      { text: " where a = 1", marked: false },
    ]);
  });

  it("a faixa no começo e no fim, e as que se sobrepõem", () => {
    expect(segmentsOf("abcdef", [{ start: 0, end: 2 }, { start: 4, end: 6 }])).toEqual([
      { text: "ab", marked: true },
      { text: "cd", marked: false },
      { text: "ef", marked: true },
    ]);
    expect(segmentsOf("abcdef", [{ start: 1, end: 4 }, { start: 2, end: 5 }])).toEqual([
      { text: "a", marked: false },
      { text: "bcd", marked: true },
      { text: "e", marked: true },
      { text: "f", marked: false },
    ]);
  });

  it("a faixa vazia ou fora do texto é cortada ou some", () => {
    expect(segmentsOf("abc", [{ start: 1, end: 1 }, { start: 10, end: 20 }])).toEqual([{ text: "abc", marked: false }]);
    expect(segmentsOf("abc", [{ start: 2, end: 20 }])).toEqual([
      { text: "ab", marked: false },
      { text: "c", marked: true },
    ]);
  });
});
