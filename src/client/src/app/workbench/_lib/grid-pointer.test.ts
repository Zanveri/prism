import { describe, expect, it } from "vitest";

import { cellAtPoint, columnStarts, edgeScroll, pageRows, type GridBox } from "./grid-pointer";

/** Uma grade na janela em (100, 50), de 400 x 300, linhas de 30 px, número da linha com 40 px, rolada 60 px para baixo e 20 para a direita. */
const box: GridBox = { left: 100, top: 50, width: 400, height: 300, scrollLeft: 20, scrollTop: 60, rowHeight: 30, gutterWidth: 40 };
const widths = [100, 150, 80];
const starts = columnStarts(widths);

describe("a célula sob o ponteiro no arraste (RN-GRADE-001)", () => {
  it("dentro da caixa, pela rolagem, pelo cabeçalho e pelo número da linha presos", () => {
    expect(starts).toEqual([0, 100, 250]);
    // y: a linha i começa, na janela, em 50 (topo) + 30 (cabeçalho) + 30i - 60 (rolagem): a 4 começa em 140.
    expect(cellAtPoint({ x: 140, y: 140 }, box, starts, widths, 100)).toEqual({ row: 4, column: 0 });
    // x: a coluna começa em 100 (esquerda) + 40 (número) + o começo dela - 20 (rolagem): a 1 começa em 220.
    expect(cellAtPoint({ x: 220, y: 140 }, box, starts, widths, 100)).toEqual({ row: 4, column: 1 });
    expect(cellAtPoint({ x: 219, y: 139 }, box, starts, widths, 100)).toEqual({ row: 3, column: 0 });
  });

  it("fora da caixa, a célula da borda mais perto; o cabeçalho e o número da linha valem pela primeira à vista", () => {
    expect(cellAtPoint({ x: 1000, y: 1000 }, box, starts, widths, 100)).toEqual({ row: 10, column: 2 });
    expect(cellAtPoint({ x: 0, y: 0 }, box, starts, widths, 100)).toEqual({ row: 2, column: 0 });
    expect(cellAtPoint({ x: 1000, y: 1000 }, box, starts, widths, 5)).toEqual({ row: 4, column: 2 });
    expect(cellAtPoint({ x: 0, y: 0 }, box, starts, widths, 0)).toBeNull();
  });

  it("a rolagem sozinha: só com o ponteiro passado da borda, mais rápida quanto mais longe, até um teto", () => {
    expect(edgeScroll({ x: 300, y: 200 }, box)).toEqual({ dx: 0, dy: 0 });
    expect(edgeScroll({ x: 300, y: 360 }, box)).toEqual({ dx: 0, dy: 5 });
    expect(edgeScroll({ x: 300, y: 70 }, box)).toEqual({ dx: 0, dy: -5 });
    expect(edgeScroll({ x: 2000, y: 200 }, box)).toEqual({ dx: 40, dy: 0 });
    // O arraste no número da linha só rola na vertical.
    expect(edgeScroll({ x: 2000, y: 360 }, box, true, false)).toEqual({ dx: 0, dy: 5 });
  });

  it("PageUp e PageDown andam as linhas que cabem abaixo do cabeçalho, ao menos uma", () => {
    expect(pageRows(box)).toBe(9);
    expect(pageRows({ height: 40, rowHeight: 30 })).toBe(1);
  });
});
