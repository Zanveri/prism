import { describe, expect, it } from "vitest";

import type { ApiError } from "@/lib/api/prism-api";

import { addRow, changesOf, deleteRow, editCell, editNewCell, failureOf, noEdits, pendingCell, pendingCount, removeNewRow, undoCell, undoDelete, undoNewCell, withoutApplied, type PendingEdits } from "./record-edits";
import type { EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit;

/** `loja.pedido` com a chave em `id` (coluna 0), `status` (1) e `total` (2). */
const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedido", key: [0], editable: true, reason: null }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
    { table: 0, baseColumn: "total", editable: false, reason: "gerada pelo banco", nullable: true, generated: "always" },
  ],
  rowOperations: true,
  oneAtATime: false,
};

const rows = [
  ["1", "aberta", "10"],
  ["2", "aberta", "20"],
  ["3", "fechada", "30"],
];

const apiError = (code: string, extensions: Record<string, unknown> = {}, detail: string | null = null): ApiError => ({ status: 422, code, title: `Título de ${code}`, detail, errors: null, extensions });

describe("as pendências da grade (RN-EDIT-004)", () => {
  it("editar marca a célula com o valor novo; voltar ao valor lido tira a pendência", () => {
    const edited = editCell(noEdits, 0, 1, "paga", "aberta");

    expect(pendingCell(edited, 0, 1)).toEqual({ value: "paga" });
    expect(pendingCell(edited, 0, 0)).toBeNull();
    expect(editCell(edited, 0, 1, "aberta", "aberta")).toEqual(noEdits);
  });

  it("NULL é um valor pendente, diferente do texto vazio", () => {
    const edited = editCell(editCell(noEdits, 0, 1, null, "aberta"), 1, 1, "", "aberta");

    expect(pendingCell(edited, 0, 1)).toEqual({ value: null });
    expect(pendingCell(edited, 1, 1)).toEqual({ value: "" });
    expect(editCell(edited, 2, 1, null, null)).toBe(edited);
  });

  it("conta uma alteração por linha, e não por célula; a exclusão e a linha nova contam uma cada", () => {
    let edits = editCell(editCell(noEdits, 0, 1, "paga", "aberta"), 0, 0, "10", "1");
    edits = deleteRow(edits, 2);
    edits = addRow(edits).edits;

    expect(pendingCount(edits)).toBe(3);
  });

  it("excluir uma linha tira as edições dela; desfazer a exclusão não as devolve", () => {
    const deleted = deleteRow(editCell(noEdits, 1, 1, "paga", "aberta"), 1);

    expect(pendingCell(deleted, 1, 1)).toBeNull();
    expect(deleted.deleted).toEqual([1]);
    expect(undoDelete(deleted, 1)).toEqual({ ...noEdits, nextId: deleted.nextId });
  });

  it("desfazer uma célula tira só ela", () => {
    const edits = undoCell(editCell(editCell(noEdits, 0, 1, "paga", "aberta"), 0, 0, "9", "1"), 0, 1);

    expect(edits.cells).toEqual([{ row: 0, column: 0, value: "9" }]);
  });

  it("a linha nova recebe valores coluna a coluna, desfaz cada um, e sai inteira por Excluir linha", () => {
    const { edits, id } = addRow(noEdits);
    const filled = editNewCell(editNewCell(edits, id, 0, "7"), id, 1, null);

    expect(filled.added).toEqual([{ id, values: { 0: "7", 1: null } }]);
    expect(undoNewCell(filled, id, 1).added).toEqual([{ id, values: { 0: "7" } }]);
    expect(removeNewRow(filled, id).added).toEqual([]);
  });
});

describe("as alterações do Salvar (RN-EDIT-005)", () => {
  it("primeiro as exclusões, depois as alterações, depois as linhas novas, cada grupo na ordem em que foi feito, pela chave lida", () => {
    let edits: PendingEdits = editCell(noEdits, 2, 1, "x", "fechada");
    const added = addRow(edits);
    edits = editNewCell(added.edits, added.id, 0, "9");
    edits = editCell(edits, 0, 1, "paga", "aberta");
    edits = editCell(edits, 2, 0, "33", "3");
    edits = deleteRow(edits, 1);

    const plan = changesOf(edits, rows, target);

    expect(plan.changes).toEqual([
      { kind: "delete", table: 0, key: ["2"] },
      { kind: "update", table: 0, key: ["3"], set: [{ column: 1, value: "x" }, { column: 0, value: "33" }] },
      { kind: "update", table: 0, key: ["1"], set: [{ column: 1, value: "paga" }] },
      { kind: "insert", table: 0, values: [{ column: 0, value: "9" }] },
    ]);
    expect(plan.origins).toEqual([{ kind: "row", row: 1 }, { kind: "row", row: 2 }, { kind: "row", row: 0 }, { kind: "new", id: added.id }]);
  });

  it("no Informix sem log, o que já foi gravado sai das pendências; a que falhou e as seguintes ficam", () => {
    let edits = editCell(editCell(editCell(noEdits, 0, 1, "a", "aberta"), 1, 1, "b", "aberta"), 2, 1, "c", "fechada");
    const plan = changesOf(edits, rows, target);
    edits = withoutApplied(edits, plan.origins, 1);

    expect(edits.cells.map((cell) => cell.row)).toEqual([1, 2]);
  });
});

describe("a falha do Salvar na faixa (RN-EDIT-005 e 012)", () => {
  const plan = changesOf(editCell(editCell(noEdits, 0, 1, "a", "aberta"), 6, 1, "b", "x"), [...rows, ["4"], ["5"], ["6"], ["7", "x", "70"]], target);

  it("a recusa do banco vem como veio, com a linha que falhou", () => {
    const failure = failureOf(apiError("SQL_EXECUTION_FAILED", { change: 1, sqlState: "23505" }, "duplicate key value violates unique constraint"), plan, false);

    expect(failure).toEqual({ headline: copy.failedAt(copy.rowLabel(7)), detail: "duplicate key value violates unique constraint", origin: { kind: "row", row: 6 }, column: null, applied: 0, written: false });
  });

  it("o comando que não afetou nenhuma linha diz que a linha não existe mais", () => {
    const failure = failureOf(apiError("EDIT_ROW_MISMATCH", { change: 0, rowsAffected: 0 }), plan, false);

    expect(failure).toMatchObject({ detail: copy.noRow, origin: { kind: "row", row: 0 }, applied: 0 });
  });

  it("no banco sem log, diz quantas foram gravadas, qual falhou e quantas continuam; o que alterou várias linhas já está gravado", () => {
    const zero = failureOf(apiError("EDIT_ROW_MISMATCH", { change: 1, rowsAffected: 0, applied: 1 }), plan, true);
    const many = failureOf(apiError("EDIT_ROW_MISMATCH", { change: 1, rowsAffected: 3, applied: 1 }), plan, true);

    expect(zero).toMatchObject({ headline: copy.partlySaved(1, copy.rowLabel(7), 1), applied: 1, written: false });
    expect(many).toMatchObject({ detail: copy.manyRowsWritten(3), applied: 1, written: true });
  });

  it("o texto que não converte aponta a célula", () => {
    expect(failureOf(apiError("EDIT_INVALID", { change: 0, column: 1 }, "«x» não é um número inteiro."), plan, false)).toMatchObject({ detail: "«x» não é um número inteiro.", origin: { kind: "row", row: 0 }, column: 1 });
  });

  it("a recusa que não é de uma alteração (o resultado mudou, a sessão ocupada) fica com o texto da API, sem linha", () => {
    expect(failureOf(apiError("RESULT_CHANGED", {}, "O resultado mudou."), plan, false)).toEqual({ headline: "Título de RESULT_CHANGED", detail: "O resultado mudou.", origin: null, column: null, applied: 0, written: false });
  });
});
