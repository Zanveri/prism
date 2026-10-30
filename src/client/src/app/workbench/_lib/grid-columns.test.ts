import { describe, expect, it } from "vitest";

import type { GridText } from "./grid-text";
import { measuredGridText, monoGridText } from "./grid-text";
import type { QueryColumn, QueryRow } from "./query.schema";
import { baseWidths, clampWidth, columnsKey, dragWidth, fitCap, fitWidth, maxWidth, minWidth, noSizing, resizeKeyAction, sizingFor, withWidth } from "./grid-columns";

const id: QueryColumn = { name: "id", type: "int4", kind: "number" };
const name: QueryColumn = { name: "name", type: "character varying(255)", kind: "text" };
const columns = [id, name];

describe("baseWidths: a largura de saída de cada coluna, contada em caracteres (a de sempre, sem medidor)", () => {
  it("cabeçalho (nome e tipo) e valores da primeira página, entre 72 e 480 px", () => {
    const rows: QueryRow[] = [["1", "Universidade"]];
    // `id int4`: 2 × 7,8 + 6 + 4 × 6,6 = 48 px de texto, mais 25 de respiro.
    expect(baseWidths([id], rows, "NULL")).toEqual([73]);
    // Uma coluna de quase nada fica na mínima de saída.
    expect(baseWidths([{ name: "x", type: "", kind: "text" }], [["a"]], "NULL")).toEqual([72]);
    // `name character varying(255)`: 4 × 7,8 + 6 + 22 × 6,6 = 182,4 px de cabeçalho, mais 25 de respiro.
    expect(baseWidths([name], rows, "NULL")).toEqual([208]);
  });

  it("o valor mais largo que o teto de saída termina em reticências: a coluna fica em 480", () => {
    expect(baseWidths([name], [["x".repeat(200)]], "NULL")).toEqual([480]);
  });

  it("a marca da coluna que não se edita (RN-EDIT-002, na aba de consulta) cabe depois do tipo, ou sozinha sem ele", () => {
    // `id int4 · somente leitura`: 2 × 7,8 + 6 + 22 × 6,6 = 166,8 px; sem o tipo, `id somente leitura`: 2 × 7,8 + 6 + 15 × 6,6 = 120,6 px.
    expect(baseWidths([id, name], [["1", "a"]], "NULL", true, ["somente leitura", null])).toEqual([192, 208]);
    expect(baseWidths([id], [["1"]], "NULL", false, ["somente leitura"])).toEqual([146]);
    expect(fitWidth(id, 0, [["1"]], "NULL", { mark: "somente leitura" })).toBe(192);
  });

  it("o nulo conta com o texto que a pessoa escolheu para ele", () => {
    const narrow = { name: "n", type: "t", kind: "text" } as const;
    expect(baseWidths([narrow], [[null]], "(nenhum valor aqui)")[0]).toBe(Math.ceil("(nenhum valor aqui)".length * 7.8) + 25);
  });
});

describe("fitWidth: o duplo clique na divisa ajusta a coluna ao maior valor carregado e ao cabeçalho (RN-GRADE-009)", () => {
  it("o maior valor entre TODAS as linhas carregadas, e não só as da primeira página", () => {
    const rows: QueryRow[] = [["1", "curto"], ["2", "x".repeat(40)]];
    expect(fitWidth(name, 1, rows, "NULL")).toBe(Math.ceil(40 * 7.8) + 25);
  });

  it("com valores curtos, o cabeçalho manda: o nome e o tipo cabem inteiros", () => {
    expect(fitWidth(name, 1, [["1", "a"]], "NULL")).toBe(Math.ceil(4 * 7.8 + 6 + 22 * 6.6) + 25);
  });

  it("num cabeçalho que ordena, a seta da ordem também cabe", () => {
    expect(fitWidth(id, 0, [["1", "a"]], "NULL", { sortable: true }) - fitWidth(id, 0, [["1", "a"]], "NULL")).toBe(16);
  });

  it(`um valor enorme para no teto do ajuste (${fitCap} px), e o resto continua com reticências`, () => {
    expect(fitWidth(name, 1, [["1", "x".repeat(10_000)]], "NULL")).toBe(fitCap);
  });

  it("uma coluna de quase nada não fica abaixo da largura mínima", () => {
    expect(fitWidth({ name: "x", type: "", kind: "text" }, 0, [["a"]], "NULL")).toBe(minWidth);
  });
});

describe("os limites da largura escolhida à mão", () => {
  it(`de ${minWidth} px (ainda mostra uns três caracteres) a ${maxWidth} px, em pixels inteiros`, () => {
    expect(clampWidth(10)).toBe(minWidth);
    expect(clampWidth(99_999)).toBe(maxWidth);
    expect(clampWidth(150.6)).toBe(151);
  });

  it("arrastar soma ao ponto de partida o quanto o ponteiro andou, na escala do zoom (a largura guardada é a de 100%)", () => {
    expect(dragWidth({ x: 100, width: 200 }, 160, 1)).toBe(260);
    expect(dragWidth({ x: 100, width: 200 }, 40, 1)).toBe(140);
    // Em 200% o ponteiro anda o dobro para a mesma largura de 100%.
    expect(dragWidth({ x: 100, width: 200 }, 160, 2)).toBe(230);
    expect(dragWidth({ x: 100, width: 200 }, -900, 1)).toBe(minWidth);
  });
});

describe("resizeKeyAction: as teclas da divisa com o foco nela", () => {
  it("setas esquerda e direita estreitam e alargam em passos de 10 px; com Shift, de 50 px", () => {
    expect(resizeKeyAction("ArrowRight", false)).toEqual({ type: "step", delta: 10 });
    expect(resizeKeyAction("ArrowLeft", false)).toEqual({ type: "step", delta: -10 });
    expect(resizeKeyAction("ArrowRight", true)).toEqual({ type: "step", delta: 50 });
    expect(resizeKeyAction("ArrowLeft", true)).toEqual({ type: "step", delta: -50 });
  });

  it("Home leva à largura mínima, e Enter ajusta ao conteúdo, como o duplo clique", () => {
    expect(resizeKeyAction("Home", false)).toEqual({ type: "min" });
    expect(resizeKeyAction("Enter", false)).toEqual({ type: "fit" });
  });

  it("qualquer outra tecla segue o caminho dela (o Tab, as setas de cima e de baixo)", () => {
    expect(resizeKeyAction("Tab", false)).toBeNull();
    expect(resizeKeyAction("ArrowUp", false)).toBeNull();
    expect(resizeKeyAction("a", false)).toBeNull();
  });
});

describe("as larguras escolhidas valem para as colunas daquele resultado (RN-GRADE-009)", () => {
  it("a mesma lista de colunas (nome e tipo, na ordem) tem a mesma chave; outra, outra chave", () => {
    expect(columnsKey(columns)).toBe(columnsKey([{ ...id }, { ...name }]));
    expect(columnsKey(columns)).not.toBe(columnsKey([name, id]));
    expect(columnsKey(columns)).not.toBe(columnsKey([id, { ...name, type: "text" }]));
    expect(columnsKey(columns)).not.toBe(columnsKey([id]));
  });

  it("um nome com vírgula, aspas ou colchete não faz duas listas diferentes terem a mesma chave", () => {
    expect(columnsKey([{ name: "a,b", type: "t", kind: "text" }])).not.toBe(columnsKey([{ name: "a", type: "t", kind: "text" }, { name: "b", type: "t", kind: "text" }]));
  });

  it("com as mesmas colunas, as larguras ficam (o mesmo objeto); com outras, voltam ao padrão", () => {
    const sized = withWidth(sizingFor(noSizing, columns), 1, 400);

    expect(sizingFor(sized, [{ ...id }, { ...name }])).toBe(sized);
    expect(sizingFor(sized, [id])).toEqual({ key: columnsKey([id]), widths: {} });
  });

  it("escolher uma largura guarda só a daquela coluna, dentro dos limites, sem mexer no objeto de antes", () => {
    const start = sizingFor(noSizing, columns);
    const one = withWidth(start, 1, 400);
    const two = withWidth(one, 0, 5);

    expect(one.widths).toEqual({ 1: 400 });
    expect(two.widths).toEqual({ 0: minWidth, 1: 400 });
    expect(start.widths).toEqual({});
    expect(withWidth(two, 0, minWidth)).toBe(two);
  });
});

describe("sem o tipo no cabeçalho (RN-CONFIG-006), a coluna não reserva lugar para ele", () => {
  it("a largura de saída conta só o nome (e os valores)", () => {
    // `name`: 4 × 7,8 = 31,2 px; os valores curtos e a mínima de saída mandam.
    expect(baseWidths([name], [["Universidade"]], "NULL", false)).toEqual([Math.ceil(12 * 7.8) + 25]);
    expect(baseWidths([name], [["a"]], "NULL", false)).toEqual([72]);
  });

  it("o ajuste ao conteúdo também", () => {
    expect(fitWidth(name, 0, [["a"]], "NULL", { showType: false })).toBe(Math.ceil(4 * 7.8) + 25);
    expect(fitWidth(name, 0, [["a"]], "NULL", { showType: false, sortable: true })).toBe(Math.ceil(4 * 7.8 + 16) + 25);
  });
});

describe("as larguras medidas na fonte da interface, e não contadas em caracteres (RN-CONFIG-008)", () => {
  // Uma fonte proporcional de mentira: a maiúscula larga (como a seminegrito da IBM Plex Sans), a minúscula estreita e o tipo a 11 px, cada um pelo que a fonte da
  // parte da grade diz. O `measure` recebe a fonte do canvas ("600 13px …"), como o real.
  const proportional = measuredGridText("proporcional", (font, text) => {
    const upper = text === text.toUpperCase() && text !== text.toLowerCase();
    if (font.startsWith("600 13px")) return upper ? 12 : 6;
    if (font.startsWith("400 11px")) return 5;
    return upper ? 9 : 6;
  });

  it("o padrão sem medidor é a conta de antes, número por número", () => {
    expect(baseWidths([id, name], [["1", "Universidade"]], "NULL")).toEqual(baseWidths([id, name], [["1", "Universidade"]], "NULL", true, null, monoGridText));
    expect(baseWidths([id], [["1", "Universidade"]], "NULL")).toEqual([73]);
    expect(fitWidth(name, 1, [["1", "x".repeat(40)]], "NULL")).toBe(fitWidth(name, 1, [["1", "x".repeat(40)]], "NULL", { text: monoGridText }));
  });

  it("o cabeçalho em maiúsculas reserva a medida da fonte, e não a conta de caracteres (o nome não cede nada)", () => {
    const upper: QueryColumn = { name: "MMWW", type: "int", kind: "number" };
    // Nome: 4 × 12 = 48 px (seminegrito); tipo: 3 × 5 = 15 px; mais os 6 px entre os dois e os 25 de respiro.
    expect(baseWidths([upper], [["1"]], "NULL", true, null, proportional)).toEqual([48 + 1 + 6 + 15 + 1 + 25]);
    // A conta de antes reservaria 4 × 7,8 + 6 + 3 × 6,6 = 57 px de texto: menos que o nome pede.
    expect(Math.ceil(monoGridText.name("MMWW") + 6 + monoGridText.type("int")) + 25).toBeLessThan(48 + 1 + 6 + 15 + 1 + 25);
  });

  it("o valor da primeira página é medido na fonte da célula, 400 13px", () => {
    const plain: QueryColumn = { name: "n", type: "t", kind: "text" };
    // 20 minúsculas de 6 px = 120 px, mais a folga e o respiro.
    expect(baseWidths([plain], [["a".repeat(20)]], "NULL", true, null, proportional)).toEqual([120 + 1 + 25]);
    // O nulo conta com o texto escolhido, medido do mesmo jeito.
    expect(baseWidths([plain], [[null]], "ausente", true, null, proportional)).toEqual([Math.max(72, 7 * 6 + 1 + 25)]);
  });

  it("o tipo e a marca 'somente leitura' são medidos na fonte de 11 px", () => {
    const plain: QueryColumn = { name: "n", type: "text", kind: "text" };
    // `n`: 6 + 1 = 7; folga de 6; `text · somente leitura` = 22 caracteres × 5 + 1 = 111.
    expect(baseWidths([plain], [["a"]], "NULL", true, ["somente leitura"], proportional)).toEqual([7 + 6 + 111 + 25]);
    expect(fitWidth(plain, 0, [["a"]], "NULL", { mark: "somente leitura", text: proportional })).toBe(7 + 6 + 111 + 25);
    // Sem o tipo, a marca sozinha.
    expect(baseWidths([plain], [["a"]], "NULL", false, ["somente leitura"], proportional)).toEqual([Math.max(72, 7 + 6 + 15 * 5 + 1 + 25)]);
  });

  it("os tetos valem com o medidor: 480 na saída e 600 no ajuste, e o valor longo só custa o que cabe", () => {
    const plain: QueryColumn = { name: "n", type: "t", kind: "text" };
    const calls: number[] = [];
    const counting: GridText = { ...proportional, cell: (text, limit) => (calls.push(limit ?? -1), proportional.cell(text, limit)) };

    expect(baseWidths([plain], [["x".repeat(10_000)]], "NULL", true, null, counting)).toEqual([480]);
    expect(fitWidth(plain, 0, [["x".repeat(10_000)]], "NULL", { text: counting })).toBe(fitCap);
    // O limite passado é o do teto menos o respiro: o resto do valor não é medido.
    expect(calls).toEqual([455, 575]);
  });

  it("o ajuste olha todas as linhas e, num cabeçalho que ordena, soma a seta", () => {
    const plain: QueryColumn = { name: "n", type: "t", kind: "text" };
    const rows: QueryRow[] = [["a"], ["a".repeat(30)]];

    expect(fitWidth(plain, 0, rows, "NULL", { text: proportional })).toBe(30 * 6 + 1 + 25);
    expect(fitWidth(name, 1, [["1", "a"]], "NULL", { sortable: true, text: proportional }) - fitWidth(name, 1, [["1", "a"]], "NULL", { text: proportional })).toBe(16);
  });
});
