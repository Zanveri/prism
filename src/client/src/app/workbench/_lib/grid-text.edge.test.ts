import { describe, expect, it } from "vitest";

import { gridFonts, measuredGridText, monoGridText } from "./grid-text";

// Os casos de borda da medida do texto da grade (RN-CONFIG-008 e RN-GRADE-009): o corte do `limit`, o cache entre chamadas, o que o `canvas` devolve de estranho
// e a conta contra uma referência escrita à parte. O medidor é de mentira (uma função de caractere para largura), como em `grid-text.test.ts`.

const family = '"Fonte Teste", sans-serif';
const fonts = gridFonts(family);

type Call = { font: string; text: string };

/** Um medidor que conta as chamadas e devolve a largura que `widthOf(caractere, fonte)` diz. */
function counting(widthOf: (text: string, font: string) => number) {
  const calls: Call[] = [];
  return { calls, measure: (font: string, text: string) => (calls.push({ font, text }), widthOf(text, font)) };
}

describe("o limite compara com '>' : a soma que só iguala o limite continua, a que passa dele para", () => {
  // Vinte caracteres diferentes de 10 px cada: cada um é uma medida nova, então as chamadas dizem até onde a soma foi.
  const value = "abcdefghijklmnopqrst";

  it.each([
    // [limite, caracteres somados antes de parar]
    [99, 10],
    [100, 11],
    [109, 11],
    [110, 12],
    [195, 20],
    [199, 20],
    [1_000, 20],
  ])("limite %i: soma %i caracteres e devolve a largura deles mais a folga", (limit, summed) => {
    const { measure, calls } = counting(() => 10);
    const text = measuredGridText(family, measure);

    expect(text.cell(value, limit)).toBe(summed * 10 + 1);
    expect(calls).toHaveLength(summed);
  });

  it("o que a soma devolve ao parar passa do limite, para quem só quer saber se coube (a dica do valor cortado)", () => {
    const { measure } = counting(() => 10);
    const text = measuredGridText(family, measure);

    for (const limit of [0, 5, 10, 55, 99, 100, 150, 199]) expect(text.cell(value, limit)).toBeGreaterThan(limit);
  });

  it("o texto que cabe no limite tem a largura inteira, igual à de sem limite", () => {
    const { measure } = counting(() => 10);
    const text = measuredGridText(family, measure);

    expect(text.cell("abc", 30)).toBe(31);
    expect(text.cell("abc", 30)).toBe(text.cell("abc"));
  });

  it.each([
    ["Infinity", Number.POSITIVE_INFINITY, 201],
    ["NaN (nenhuma comparação com NaN é verdadeira: sem limite)", Number.NaN, 201],
    ["zero: só o primeiro caractere", 0, 11],
    ["negativo (o espaço da coluna acabou): só o primeiro caractere", -40, 11],
  ])("limite %s", (_label, limit, expected) => {
    const { measure } = counting(() => 10);

    expect(measuredGridText(family, measure).cell(value, limit)).toBe(expected);
  });
});

describe("o cache entre chamadas", () => {
  it("o corte do limite não deixa lixo: o que não foi somado não foi guardado, e a conta inteira depois acerta", () => {
    const { measure, calls } = counting((text) => (text.charCodeAt(0) - 96) * 2);
    const text = measuredGridText(family, measure);
    const value = "abcdefghij";

    const cut = text.cell(value, 10);
    expect(cut).toBeGreaterThan(10);
    const measuredByCut = calls.length;
    expect(measuredByCut).toBeLessThan(value.length);

    // a=2 … j=20: 2 + 4 + … + 20 = 110, mais a folga.
    expect(text.cell(value)).toBe(111);
    // Cada caractere foi medido uma vez só, no corte ou depois dele.
    expect(calls.map((call) => call.text).sort()).toEqual([...value]);
  });

  it("cada medida tem o seu cache: duas grades (ou duas janelas) com fontes diferentes não se contaminam", () => {
    const narrow = counting(() => 5);
    const wide = counting(() => 9);
    const first = measuredGridText(family, narrow.measure);
    const second = measuredGridText('"Outra", serif', wide.measure);

    expect(first.cell("x")).toBe(6);
    expect(second.cell("x")).toBe(10);
    // De novo, em outra ordem: cada uma segue com a sua conta, e ninguém mediu duas vezes.
    expect(second.cell("x")).toBe(10);
    expect(first.cell("x")).toBe(6);
    expect(narrow.calls).toHaveLength(1);
    expect(wide.calls).toHaveLength(1);
  });

  it("o mesmo caractere guardado na fonte da célula não vale para o nome nem para o tipo", () => {
    const { measure } = counting((_text, font) => (font === fonts.cell ? 7 : font === fonts.name ? 8 : 5));
    const text = measuredGridText(family, measure);

    expect([text.cell("a"), text.name("a"), text.type("a")]).toEqual([8, 9, 6]);
    // E de novo, já guardados.
    expect([text.type("a"), text.name("a"), text.cell("a")]).toEqual([6, 9, 8]);
  });

  it("um texto enorme de poucos caracteres custa as medidas dos caracteres, e não as do tamanho do texto", () => {
    const { measure, calls } = counting((text) => (text === "a" ? 6 : 7));
    const text = measuredGridText(family, measure);

    expect(text.cell("ab".repeat(100_000))).toBe(100_000 * 13 + 1);
    expect(calls).toHaveLength(2);
  });
});

describe("o que o canvas devolve de estranho", () => {
  it("o caractere sem largura legítima (acento combinado, junção de emoji, seletor de variação) vale a mono: sobra, e é o lado seguro", () => {
    const { measure } = counting((text) => ("\u0301\u200d\ufe0f".includes(text) ? 0 : 6));
    const text = measuredGridText(family, measure);

    // "á" decomposto: a + acento agudo combinado.
    expect(text.cell("a\u0301")).toBe(Math.ceil(6 + 7.8 + 1));
    expect(text.name("\u200d")).toBe(Math.ceil(7.8 + 1));
    expect(text.type("\ufe0f")).toBe(Math.ceil(6.6 + 1));
  });

  it("o par substituto solto e os caracteres de controle chegam ao medidor como são, e o resultado é um inteiro", () => {
    const { measure, calls } = counting(() => 4);
    const text = measuredGridText(family, measure);

    for (const value of ["\ud83d", "\ude00", "\t", "\n", "\u0000", "a\u00a0b"]) {
      const width = text.cell(value);
      expect(Number.isInteger(width)).toBe(true);
      expect(width).toBeGreaterThan(0);
    }
    expect(calls.map((call) => call.text)).toEqual(["\ud83d", "\ude00", "\t", "\n", "\u0000", "a", "\u00a0", "b"]);
  });

  it("um medidor que lança não é engolido aqui: quem trata é o gancho, que só o entrega depois de conferir a fonte", () => {
    const text = measuredGridText(family, () => {
      throw new Error("sem canvas");
    });

    expect(() => text.cell("a")).toThrow("sem canvas");
  });
});

/** A conta escrita à parte, sem cache: o que a soma tem de dar, caractere por caractere. */
function reference(value: string, limit: number, widthOf: (char: string) => number, fallback: number): number {
  if (value === "") return 0;
  let total = 0;
  for (const char of value) {
    const width = widthOf(char);
    total += Number.isFinite(width) && width > 0 ? width : fallback;
    if (total > limit) break;
  }
  return Math.ceil(total + 1);
}

describe("a conta contra a referência sem cache, em muitas chamadas misturadas", () => {
  // Um gerador fixo: o teste é o mesmo a cada rodada.
  function generator(seed: number) {
    let state = seed;
    return () => (state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296;
  }
  const alphabet = [..."abcdefgWMi_ .,-0123456789ÁÉÍãçñü"].concat(["汉", "字", "😀", "🎉", "\u0301", "\u200d", "\t"]);
  // A largura de cada caractere é uma função dele; alguns saem como o canvas os devolve quando não tem o glifo (0 e NaN).
  const widthOf = (char: string): number => {
    const code = char.codePointAt(0) ?? 0;
    if (code % 11 === 0) return 0;
    if (code % 13 === 0) return Number.NaN;
    return 4 + (code % 9) * 0.75;
  };

  it.each([
    ["cell", fonts.cell, 7.8],
    ["name", fonts.name, 7.8],
    ["type", fonts.type, 6.6],
  ] as const)("%s: 3.000 textos com limites variados, na mesma instância, dão o que a referência dá", (part, font, fallback) => {
    const random = generator(20_261_027);
    // Só a fonte da parte medida devolve a largura do caractere; nas outras o medidor responde outra coisa, para não haver troca de cache sem ninguém ver.
    const { measure } = counting((char, requested) => (requested === font ? widthOf(char) : 3));
    const text = measuredGridText(family, measure);

    for (let index = 0; index < 3_000; index++) {
      const length = Math.floor(random() * 60);
      const value = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
      // O limite só existe na célula (`name` e `type` somam o texto todo).
      const limit = part !== "cell" || random() < 0.4 ? Number.POSITIVE_INFINITY : Math.floor(random() * 400);

      expect(text[part](value, limit), JSON.stringify({ value, limit })).toBe(reference(value, limit, widthOf, fallback));
    }
  });

  it("a mono, que é o padrão sem canvas, é só a multiplicação, qualquer que seja o limite", () => {
    for (const value of ["", "a", "ñ", "😀", "x".repeat(500)]) {
      expect(monoGridText.cell(value, 10)).toBeCloseTo(value.length * 7.8, 6);
      expect(monoGridText.name(value)).toBeCloseTo(value.length * 7.8, 6);
      expect(monoGridText.type(value)).toBeCloseTo(value.length * 6.6, 6);
    }
  });
});
