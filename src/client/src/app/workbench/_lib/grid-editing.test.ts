import { describe, expect, it } from "vitest";

import { gridRowOf, gridRowsOf, rowMarksOf, savesEdits } from "./grid-editing";
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

describe("Ctrl+S com o foco na grade (RN-EDIT-004)", () => {
  const key = (over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) => ({ key: "s", ctrlKey: true, metaKey: false, shiftKey: false, ...over });

  it("com alterações não salvas, Ctrl+S (ou Cmd+S) salva as alterações", () => {
    expect(savesEdits(key(), 2)).toBe(true);
    expect(savesEdits(key({ key: "S" }), 1)).toBe(true);
    expect(savesEdits(key({ ctrlKey: false, metaKey: true }), 1)).toBe(true);
  });

  it("sem nada pendente, ou com Shift, a tecla segue para quem a trata (na aba de consulta, salvar o script, RN-SCRIPT-001)", () => {
    expect(savesEdits(key(), 0)).toBe(false);
    expect(savesEdits(key({ shiftKey: true }), 1)).toBe(false);
    expect(savesEdits(key({ ctrlKey: false }), 1)).toBe(false);
  });
});
