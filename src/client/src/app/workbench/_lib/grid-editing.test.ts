import { describe, expect, it } from "vitest";

import { gridRowOf, gridRowsOf, rowMarksOf } from "./grid-editing";
import { addRow, deleteRow, editCell, editNewCell, noEdits } from "./record-edits";

const rows = [
  ["1", "aberta"],
  ["2", "aberta"],
];

describe("o que a grade desenha das pendências (RN-EDIT-004)", () => {
  it("as linhas novas vêm depois das lidas, com o que foi preenchido; o resto fica vazio para o padrão da tabela", () => {
    const added = addRow(noEdits);
    const edits = editNewCell(added.edits, added.id, 1, "nova");

    expect(gridRowsOf(rows, edits, 2)).toEqual([...rows, [null, "nova"]]);
  });

  it("cada linha com pendência tem a marca: as células alteradas, a exclusão, a linha nova e a que falhou no Salvar", () => {
    let edits = editCell(noEdits, 0, 1, "paga", "aberta");
    edits = deleteRow(edits, 1);
    const added = addRow(edits);

    const marks = rowMarksOf(added.edits, rows.length, 2);

    expect(marks.get(0)).toEqual({ kind: "read", deleted: false, pending: new Map([[1, "paga"]]), failed: false });
    expect(marks.get(1)).toEqual({ kind: "read", deleted: true, pending: new Map(), failed: false });
    expect(marks.get(2)).toEqual({ kind: "new", deleted: false, pending: new Map(), failed: true });
    expect(marks.has(3)).toBe(false);
  });

  it("a alteração que falhou é achada na grade: a linha lida pela posição, a nova depois das lidas", () => {
    const first = addRow(noEdits);
    const second = addRow(first.edits);

    expect(gridRowOf({ kind: "row", row: 1 }, second.edits, rows.length)).toBe(1);
    expect(gridRowOf({ kind: "new", id: second.id }, second.edits, rows.length)).toBe(3);
    expect(gridRowOf({ kind: "new", id: 99 }, second.edits, rows.length)).toBeNull();
  });
});
