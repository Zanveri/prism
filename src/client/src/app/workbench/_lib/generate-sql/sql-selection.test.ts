import { describe, expect, it } from "vitest";

import { addRow, deleteRow, editCell, noEdits } from "../record-edits";
import type { RowsState } from "../use-query-runner";
import { sqlSelectionOf } from "./sql-selection";

const shown = (change: Partial<RowsState> = {}): RowsState => ({
  status: "rows",
  id: 1,
  target: { sql: "select * from estoque.pedido", offset: 0 },
  columns: [
    { name: "id", type: "int4", kind: "number" },
    { name: "cliente", type: "text", kind: "text" },
    { name: "obs", type: "text", kind: "text" },
  ],
  rows: [
    ["1", "Ana", "curto"],
    ["2", "Bia", "cortado…"],
    ["3", "Caio", null],
  ],
  truncated: new Map([[1, new Set([2])]]),
  hasMore: false,
  totalRows: null,
  elapsedMs: 1,
  pages: 1,
  loadingMore: false,
  cancelling: false,
  cursorClosed: false,
  total: null,
  counting: false,
  resultId: "r1",
  ...change,
});

describe("as linhas do Gerar SQL tiradas da seleção (RN-GRADE-006)", () => {
  it("a linha lida vai com o que a grade mostra e o que o banco leu; a pendência é `changed`, e a cortada sem pendência, `cut`", () => {
    const pending = editCell(noEdits, 0, 1, "Ana Maria", "Ana");
    const { rows, newRows } = sqlSelectionOf(shown(), pending, [0, 1]);

    expect(newRows).toBe(0);
    expect(rows).toEqual([
      { number: 1, values: ["1", "Ana Maria", "curto"], read: ["1", "Ana", "curto"], changed: [1], cut: [], generated: [] },
      { number: 2, values: ["2", "Bia", "cortado…"], read: ["2", "Bia", "cortado…"], changed: [], cut: [2], generated: [] },
    ]);
  });

  it("a linha marcada para exclusão entra com os valores lidos: ela está no banco até o Salvar", () => {
    const { rows } = sqlSelectionOf(shown(), deleteRow(noEdits, 2), [2]);
    expect(rows).toEqual([{ number: 3, values: ["3", "Caio", null], read: ["3", "Caio", null], changed: [], cut: [], generated: [] }]);
  });

  it("a linha nova já salva leva as células \"gerado pelo banco\"; a nova ainda não salva só conta", () => {
    const { edits } = addRow(noEdits);
    const { rows, newRows } = sqlSelectionOf(shown({ generated: new Map([[2, new Set([0])]]) }), edits, [2, 3]);

    expect(rows.map((row) => [row.number, row.generated])).toEqual([[3, [0]]]);
    expect(newRows).toBe(1);
  });

  it("a ordem é a da seleção, que é a da grade", () => {
    expect(sqlSelectionOf(shown(), noEdits, [2, 0]).rows.map((row) => row.number)).toEqual([3, 1]);
  });
});
