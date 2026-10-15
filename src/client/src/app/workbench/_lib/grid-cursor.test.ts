import { describe, expect, it } from "vitest";

import { moveCell, nextEditable } from "./grid-cursor";

const bounds = { rows: 3, columns: 4 };

describe("a célula ativa da grade, pelo teclado (RN-EDIT-001)", () => {
  it("sem célula ativa, a primeira seta ativa a primeira célula", () => {
    expect(moveCell(null, "ArrowDown", bounds)).toEqual({ row: 0, column: 0 });
  });

  it("as setas andam uma célula e param na borda", () => {
    expect(moveCell({ row: 1, column: 1 }, "ArrowRight", bounds)).toEqual({ row: 1, column: 2 });
    expect(moveCell({ row: 1, column: 1 }, "ArrowUp", bounds)).toEqual({ row: 0, column: 1 });
    expect(moveCell({ row: 2, column: 3 }, "ArrowDown", bounds)).toEqual({ row: 2, column: 3 });
    expect(moveCell({ row: 0, column: 0 }, "ArrowLeft", bounds)).toEqual({ row: 0, column: 0 });
  });

  it("Home e End vão ao começo e ao fim da linha; com Ctrl, ao começo e ao fim da grade", () => {
    expect(moveCell({ row: 1, column: 2 }, "Home", bounds)).toEqual({ row: 1, column: 0 });
    expect(moveCell({ row: 1, column: 2 }, "End", bounds)).toEqual({ row: 1, column: 3 });
    expect(moveCell({ row: 1, column: 2 }, "Home", bounds, true)).toEqual({ row: 0, column: 0 });
    expect(moveCell({ row: 1, column: 2 }, "End", bounds, true)).toEqual({ row: 2, column: 3 });
  });

  it("outra tecla não move; a grade vazia não tem célula", () => {
    expect(moveCell({ row: 1, column: 1 }, "a", bounds)).toBeNull();
    expect(moveCell(null, "ArrowDown", { rows: 0, columns: 4 })).toBeNull();
  });

  it("Tab e Shift+Tab passam à próxima célula editável da linha, pulando as que não se editam", () => {
    const editable = (_row: number, column: number) => column !== 2;

    expect(nextEditable({ row: 0, column: 1 }, 1, 4, editable)).toEqual({ row: 0, column: 3 });
    expect(nextEditable({ row: 0, column: 3 }, -1, 4, editable)).toEqual({ row: 0, column: 1 });
    expect(nextEditable({ row: 0, column: 3 }, 1, 4, editable)).toBeNull();
  });
});
