import { describe, expect, it } from "vitest";

import { baseWidths, cellPadding, fitCap, fitWidth } from "./grid-columns";
import { measuredGridText, type GridText } from "./grid-text";
import type { QueryColumn, QueryRow } from "./query.schema";

// As larguras de saída e do ajuste com um medidor proporcional (RN-CONFIG-008 e RN-GRADE-009): as bordas dos tetos, o que o limite da soma nunca pode mudar
// e o nome da coluna que não cede nada. O medidor é de mentira, como em `grid-columns.test.ts`.

/** Cada caractere mede `step` px na célula e no tipo; no nome, `step + 2` (o seminegrito é mais largo). */
function steady(step: number): GridText {
  return measuredGridText("fixa", (font, text) => (font.startsWith("600 13px") ? step + 2 : step) * [...text].length);
}

/** O mesmo medidor sem o corte: a referência do que o `limit` não pode mudar. */
function withoutLimit(text: GridText): GridText {
  return { key: text.key, cell: (value) => text.cell(value), name: text.name, type: text.type };
}

const plain: QueryColumn = { name: "n", type: "t", kind: "text" };

describe("as bordas dos tetos com o medidor (480 na saída, 600 no ajuste)", () => {
  // Células de 10 px por caractere: n caracteres medem 10n + 1 de folga, mais os 25 do respiro.
  const text = steady(10);

  it.each([
    [44, 44 * 10 + 1 + cellPadding], // 470
    [45, 45 * 10 + 1 + cellPadding], // 476
    [46, 480], // 486 passaria do teto
    [47, 480],
    [10_000, 480],
  ])("saída: valor de %i caracteres", (length, expected) => {
    expect(baseWidths([plain], [["x".repeat(length)]], "NULL", true, null, text)).toEqual([expected]);
  });

  it.each([
    [56, 56 * 10 + 1 + cellPadding], // 586
    [57, 57 * 10 + 1 + cellPadding], // 596
    [58, fitCap], // 606 passaria do teto
    [59, fitCap],
    [10_000, fitCap],
  ])("ajuste: valor de %i caracteres", (length, expected) => {
    expect(fitWidth(plain, 0, [["x".repeat(length)]], "NULL", { text })).toBe(expected);
  });

  it("a menor saída é 72, mesmo com o cabeçalho e o valor de um caractere só", () => {
    expect(baseWidths([plain], [["x"]], "NULL", true, null, text)).toEqual([72]);
    expect(baseWidths([plain], [], "NULL", true, null, text)).toEqual([72]);
  });

  it("o nome de 200 caracteres no cabeçalho também fica no teto: a coluna não passa de 480 na saída nem de 600 no ajuste", () => {
    const long: QueryColumn = { name: "N".repeat(200), type: "varchar(255)", kind: "text" };

    expect(baseWidths([long], [["a"]], "NULL", true, null, text)).toEqual([480]);
    expect(fitWidth(long, 0, [["a"]], "NULL", { text })).toBe(fitCap);
  });
});

describe("o nulo e a linha curta valem o texto escolhido para o nulo, medido na fonte da célula", () => {
  const text = steady(10);

  it("o texto do nulo escolhido é o que reserva largura (não a palavra NULL)", () => {
    expect(baseWidths([plain], [[null]], "sem valor algum", true, null, text)).toEqual([15 * 10 + 1 + cellPadding]);
    expect(baseWidths([plain], [[null]], "-", true, null, text)).toEqual([72]);
  });

  it("a linha mais curta que as colunas (a célula que falta) conta como nula", () => {
    const rows: QueryRow[] = [["a"]];

    expect(baseWidths([plain, plain], rows, "ausente ausente", true, null, text)).toEqual([72, 15 * 10 + 1 + cellPadding]);
    expect(fitWidth(plain, 1, rows, "ausente ausente", { text })).toBe(15 * 10 + 1 + cellPadding);
  });

  it("o texto do nulo vazio não reserva nada", () => {
    expect(baseWidths([plain], [[null]], "", true, null, text)).toEqual([72]);
  });
});

describe("o limite da soma nunca muda a largura: com ou sem ele, o mesmo número (o teto só poupa trabalho)", () => {
  function generator(seed: number) {
    let state = seed;
    return () => (state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296;
  }
  const alphabet = [..."abcdefMWi _.,0123456789ÁÉãçñ"].concat(["汉", "😀"]);
  // Largura por caractere que varia com ele, para as somas pararem em lugares diferentes.
  const measure = (font: string, value: string) => {
    const code = value.codePointAt(0) ?? 0;
    return (font.startsWith("600 13px") ? 9 : 7) + (code % 5) * 1.3;
  };
  const text = measuredGridText("variada", measure);
  const exact = withoutLimit(measuredGridText("variada", measure));

  it("2.000 colunas de valores curtos e longos: baseWidths e fitWidth iguais às da soma inteira", () => {
    const random = generator(20_261_027);
    const word = (length: number) => Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");

    for (let index = 0; index < 2_000; index++) {
      const column: QueryColumn = { name: word(1 + Math.floor(random() * 20)), type: word(1 + Math.floor(random() * 12)), kind: "text" };
      const rows: QueryRow[] = Array.from({ length: 1 + Math.floor(random() * 6) }, () => [random() < 0.15 ? null : word(Math.floor(random() * (random() < 0.3 ? 400 : 60)))]);
      const showType = random() < 0.7;
      const marks = random() < 0.3 ? ["somente leitura"] : null;
      const options = { sortable: random() < 0.5, showType, mark: marks?.[0] ?? null };

      expect(baseWidths([column], rows, "NULL", showType, marks, text), JSON.stringify({ column, rows })).toEqual(baseWidths([column], rows, "NULL", showType, marks, exact));
      expect(fitWidth(column, 0, rows, "NULL", { ...options, text }), JSON.stringify({ column, rows, options })).toBe(fitWidth(column, 0, rows, "NULL", { ...options, text: exact }));
    }
  });
});

describe("o nome da coluna não cede nada: a largura de saída sempre reserva o nome inteiro, o tipo e o respiro", () => {
  const text = measuredGridText("nome largo", (font, value) => (font.startsWith("600 13px") ? 9.5 : 6.5) * [...value].length);

  it.each([
    ["WAREHOUSE_ID", "integer"],
    ["NOME_MUNICIPIO", "character varying(255)"],
    ["id", "int4"],
    ["MMMMMMMMMM", ""],
    ["a", "timestamp without time zone"],
  ])("%s %s: sem valores, a largura é nome + espaço + tipo + respiro (ou o mínimo, ou o teto)", (name, type) => {
    const column: QueryColumn = { name, type, kind: "text" };
    const needed = text.name(name) + 6 + text.type(type) + cellPadding;

    expect(baseWidths([column], [], "NULL", true, null, text)).toEqual([Math.min(480, Math.max(72, needed))]);
    // Ordenar acrescenta o botão (RN-GRADE-021), e o nome continua inteiro.
    expect(fitWidth(column, 0, [], "NULL", { sortable: true, text })).toBe(Math.min(fitCap, Math.max(48, needed + 16)));
  });

  it("com a marca 'somente leitura' o tipo e a marca somam no mesmo texto de 11 px, depois do ' · '", () => {
    const column: QueryColumn = { name: "ID", type: "int", kind: "number" };
    const note = "int · somente leitura";

    expect(baseWidths([column], [], "NULL", true, ["somente leitura"], text)).toEqual([Math.max(72, text.name("ID") + 6 + text.type(note) + cellPadding)]);
  });
});
