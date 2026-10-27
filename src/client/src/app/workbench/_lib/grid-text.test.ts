import { describe, expect, it } from "vitest";

import { gridFonts, measuredGridText, monoGridText } from "./grid-text";

// Um medidor de mentira: um mapa de caractere para largura (o que o `canvas` daria), que conta as chamadas por fonte e por texto.
const family = '"Fonte Teste", sans-serif';
const fonts = gridFonts(family);

function fakeMeasure(widths: Record<string, number>, fallback = 8) {
  const calls: { font: string; text: string }[] = [];
  const measure = (font: string, text: string) => {
    calls.push({ font, text });
    return widths[text] ?? fallback;
  };
  return { measure, calls };
}

describe("monoGridText: a conta de antes da fonte proporcional (7,8 px por caractere, 6,6 no tipo)", () => {
  it("conta os caracteres, sem folga e sem arredondar", () => {
    expect(monoGridText.cell("abcd")).toBeCloseTo(31.2);
    expect(monoGridText.name("id")).toBeCloseTo(15.6);
    expect(monoGridText.type("int4")).toBeCloseTo(26.4);
    expect(monoGridText.cell("")).toBe(0);
    expect(monoGridText.key).toBe("mono");
  });

  it("o teto não muda a conta: a mono é só uma multiplicação", () => {
    expect(monoGridText.cell("x".repeat(10_000), 100)).toBeCloseTo(78_000);
  });
});

describe("as três fontes do canvas (RN-CONFIG-008): a célula, o nome do cabeçalho e o tipo", () => {
  it("célula em 400 13px, nome em 600 13px, tipo em 400 11px, todos na pilha dada", () => {
    expect(fonts).toEqual({ cell: `400 13px ${family}`, name: `600 13px ${family}`, type: `400 11px ${family}` });
  });

  it("cada texto é medido na fonte da parte da grade em que aparece", () => {
    const { measure, calls } = fakeMeasure({});
    const text = measuredGridText(family, measure);

    text.cell("a");
    text.name("b");
    text.type("c");

    expect(calls).toEqual([
      { font: fonts.cell, text: "a" },
      { font: fonts.name, text: "b" },
      { font: fonts.type, text: "c" },
    ]);
  });
});

describe("measuredGridText: a soma dos caracteres, medidos um a um", () => {
  it("a largura é a soma de cada caractere mais 1 px de folga, arredondada para cima", () => {
    const { measure } = fakeMeasure({ W: 11.58, i: 3.25, M: 10.4 });
    const text = measuredGridText(family, measure);

    // 11,58 + 3,25 = 14,83; + 1 = 15,83; cima = 16.
    expect(text.cell("Wi")).toBe(16);
    // O mesmo texto na outra fonte tem a conta dela, e o mesmo caractere a mesma largura (o mapa é igual para as três).
    expect(text.name("WiM")).toBe(Math.ceil(11.58 + 3.25 + 10.4 + 1));
    expect(text.type("i")).toBe(Math.ceil(3.25 + 1));
  });

  it("um texto vazio não mede nada: 0, e não a folga", () => {
    const { measure, calls } = fakeMeasure({});
    const text = measuredGridText(family, measure);

    expect(text.cell("")).toBe(0);
    expect(text.name("")).toBe(0);
    expect(text.type("")).toBe(0);
    expect(calls).toEqual([]);
  });

  it("cada caractere é medido uma vez por fonte, por maior que seja o texto, e a segunda conta não chama o medidor", () => {
    const { measure, calls } = fakeMeasure({ a: 6.5, b: 6.6 });
    const text = measuredGridText(family, measure);

    const first = text.cell("abababababab".repeat(100));
    expect(calls).toHaveLength(2);
    expect(text.cell("ba")).toBeLessThan(first);
    expect(calls).toHaveLength(2);

    // Outra fonte, outro cache: os mesmos dois caracteres são medidos de novo, na fonte do nome.
    text.name("ab");
    expect(calls).toHaveLength(4);
    expect(calls.filter((call) => call.font === fonts.name).map((call) => call.text)).toEqual(["a", "b"]);
  });

  it("o par substituto (um emoji) conta como um ponto de código, e não como dois", () => {
    const { measure, calls } = fakeMeasure({ "😀": 16.9 });
    const text = measuredGridText(family, measure);

    expect(text.cell("😀")).toBe(Math.ceil(16.9 + 1));
    expect(calls).toEqual([{ font: fonts.cell, text: "😀" }]);
    // O mesmo emoji de novo, três vezes: uma medida só, três somas.
    expect(text.cell("😀😀😀")).toBe(Math.ceil(16.9 * 3 + 1));
    expect(calls).toHaveLength(1);
  });

  it("o limite para a soma cedo: um valor de 10.000 caracteres custa só o que cabe, e a largura devolvida passa do limite", () => {
    // Todos os caracteres diferentes não existem em 10.000; o que conta é quantas SOMAS a conta faz. O medidor conta as buscas por texto medido (uma por
    // caractere novo), e o texto de um caractere só repetido mede um, então o limite aparece na largura: passou de 455, a conta parou.
    const { measure } = fakeMeasure({ x: 8 });
    const text = measuredGridText(family, measure);

    const limited = text.cell("x".repeat(10_000), 455);
    expect(limited).toBeGreaterThan(455);
    // 57 caracteres de 8 px = 456 > 455: parou aí, e não nos 80.000 px do texto inteiro.
    expect(limited).toBe(Math.ceil(57 * 8 + 1));
    expect(text.cell("x".repeat(10_000))).toBe(80_001);
  });

  it("o limite não corta o que cabe: um texto que não passa dele tem a largura inteira", () => {
    const { measure } = fakeMeasure({ x: 8 });
    const text = measuredGridText(family, measure);

    expect(text.cell("xxxx", 455)).toBe(33);
  });

  it("o valor de 10.000 caracteres diferentes custa só o que cabe no limite (o medidor não é chamado para o resto)", () => {
    const { measure, calls } = fakeMeasure({}, 10);
    const text = measuredGridText(family, measure);
    // 10.000 pontos de código diferentes (os do plano multilíngue básico, fora dos substitutos).
    const value = Array.from({ length: 10_000 }, (_, index) => String.fromCodePoint(0x4e00 + index)).join("");

    text.cell(value, 455);

    // 10 px por caractere: passou de 455 no 46º.
    expect(calls).toHaveLength(46);
  });

  it("o caractere que o medidor devolve como zero ou como número que não serve vale o que valia na mono, e só ele", () => {
    const { measure } = fakeMeasure({ a: 6, z: 0, n: Number.NaN, c: Number.POSITIVE_INFINITY });
    const text = measuredGridText(family, measure);

    // Na célula e no nome o fallback é 7,8; no tipo, 6,6.
    expect(text.cell("z")).toBe(Math.ceil(7.8 + 1));
    expect(text.cell("n")).toBe(Math.ceil(7.8 + 1));
    expect(text.cell("c")).toBe(Math.ceil(7.8 + 1));
    expect(text.name("az")).toBe(Math.ceil(6 + 7.8 + 1));
    expect(text.type("az")).toBe(Math.ceil(6 + 6.6 + 1));
  });

  it("um medidor que só devolve zero mede como a mono, caractere por caractere (mais a folga)", () => {
    const { measure } = fakeMeasure({}, 0);
    const text = measuredGridText(family, measure);

    expect(text.cell("abcd")).toBe(Math.ceil(monoGridText.cell("abcd") + 1));
    expect(text.name("abcd")).toBe(Math.ceil(monoGridText.name("abcd") + 1));
    expect(text.type("abcd")).toBe(Math.ceil(monoGridText.type("abcd") + 1));
  });

  it("a maiúscula larga do seminegrito não cabe na conta de antes: o nome do Informix e do Db2 é medido, e não contado (o E1)", () => {
    // Medidas reais da IBM Plex Sans a 13 px: maiúscula de 8,53 em 600, minúscula de 6,56 em 400.
    const { measure } = fakeMeasure(Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ_"].map((letter) => [letter, 8.53])));
    const text = measuredGridText(family, measure);

    expect(text.name("WAREHOUSE_ID")).toBeGreaterThan(monoGridText.name("WAREHOUSE_ID"));
    expect(text.name("WAREHOUSE_ID")).toBe(Math.ceil(12 * 8.53 + 1));
  });

  it("a key é a pilha: a mesma conta tem a mesma, outra fonte tem outra", () => {
    const { measure } = fakeMeasure({});

    expect(measuredGridText(family, measure).key).toBe(family);
    expect(measuredGridText('"Outra", sans-serif', measure).key).toBe('"Outra", sans-serif');
    expect(measuredGridText(family, measure).key).not.toBe(measuredGridText('"Outra", sans-serif', measure).key);
    expect(measuredGridText(family, measure).key).not.toBe(monoGridText.key);
  });
});
