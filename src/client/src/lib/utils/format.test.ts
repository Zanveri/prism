import { describe, expect, it } from "vitest";

import { formatCount, formatElapsed } from "./format";

describe("formatElapsed: o tempo do comando na unidade que se lê de relance", () => {
  it("abaixo de um segundo, em milissegundos inteiros", () => {
    expect(formatElapsed(0)).toBe("0 ms");
    expect(formatElapsed(0.4)).toBe("0 ms");
    expect(formatElapsed(42)).toBe("42 ms");
    expect(formatElapsed(999)).toBe("999 ms");
    expect(formatElapsed(999.4)).toBe("999 ms");
  });

  it("de um segundo a um minuto, em segundos com um décimo e vírgula", () => {
    expect(formatElapsed(1000)).toBe("1,0 s");
    expect(formatElapsed(1250)).toBe("1,3 s");
    expect(formatElapsed(12_480)).toBe("12,5 s");
    expect(formatElapsed(59_940)).toBe("59,9 s");
  });

  it("de um minuto a uma hora, em minutos e segundos: um comando de 70 s não aparece mais como `70.066 ms`", () => {
    expect(formatElapsed(60_000)).toBe("1 min 0 s");
    expect(formatElapsed(70_066)).toBe("1 min 10 s");
    expect(formatElapsed(125_400)).toBe("2 min 5 s");
    expect(formatElapsed(119_600)).toBe("2 min 0 s");
    expect(formatElapsed(3_599_400)).toBe("59 min 59 s");
  });

  it("de uma hora em diante, em horas e minutos: um dia inteiro não aparece como `1.440 min 0 s`", () => {
    expect(formatElapsed(3_600_000)).toBe("1 h 0 min");
    expect(formatElapsed(3_725_000)).toBe("1 h 2 min");
    expect(formatElapsed(7_500_000)).toBe("2 h 5 min");
    expect(formatElapsed(86_400_000)).toBe("24 h 0 min");
    // Os minutos são arredondados: 1 h 59 min 30 s é 2 h 0 min, e 1 h 0 min 29 s é 1 h 0 min.
    expect(formatElapsed(7_170_000)).toBe("2 h 0 min");
    expect(formatElapsed(3_629_000)).toBe("1 h 0 min");
  });

  it("o que não é um tempo (não finito, ou negativo) sai como um traço, e não como `NaN min NaN s` nem `-1.500 ms`", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -1500, -0.4, -70_066, -86_400_000]) expect(formatElapsed(value), String(value)).toBe("—");
    // Zero é um tempo, com qualquer sinal.
    expect(formatElapsed(-0)).toBe("0 ms");
  });

  it("a unidade é a do valor JÁ arredondado: 999,6 ms é um segundo, 59,96 s é um minuto e 59 min 59,6 s é uma hora (nunca `1.000 ms`, `60,0 s` nem `60 min 0 s`)", () => {
    expect(formatElapsed(999.6)).toBe("1,0 s");
    expect(formatElapsed(59_949)).toBe("59,9 s");
    expect(formatElapsed(59_950)).toBe("1 min 0 s");
    expect(formatElapsed(59_999)).toBe("1 min 0 s");
    expect(formatElapsed(3_599_600)).toBe("1 h 0 min");
  });
});

describe("formatCount: o número com a concordância", () => {
  it("singular com um, plural com zero e com vários, e o ponto do milhar", () => {
    expect(formatCount(1, "linha", "linhas")).toBe("1 linha");
    expect(formatCount(0, "linha", "linhas")).toBe("0 linhas");
    expect(formatCount(12_480, "linha", "linhas")).toBe("12.480 linhas");
  });
});
