import { describe, expect, it } from "vitest";

import type { ApiError } from "@/lib/api/prism-api";

import { multiEditCopy } from "./multi-edit.copy";
import {
  addRow,
  cellsPendingIn,
  changesOf,
  columnEditOf,
  deleteRow,
  editCell,
  editNewCell,
  editWholeColumn,
  failureOf,
  groupBuilder,
  noEdits,
  pendingCell,
  pendingCount,
  referenceOf,
  savedResultOf,
  undoWhere,
  undoWholeColumns,
  withColumnsWritten,
  withoutApplied,
  type PendingEdits,
} from "./record-edits";
import type { EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";

// O modelo das pendências da edição de várias células e da coluna inteira (seção 38: RN-EDIT-017, 018 e 021), sem React.

const multi = multiEditCopy;

/** `loja.pedido` com a chave em `id` (coluna 0), `status` (1) e `preco` (2). */
const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedido", key: [0], editable: true, reason: null }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
    { table: 0, baseColumn: "preco", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

const rows = [
  ["1", "aberta", "10"],
  ["2", "aberta", "20"],
  ["3", "fechada", "30"],
];
const names = ["id", "status", "preco"];

const apiError = (code: string, extensions: Record<string, unknown> = {}, detail: string | null = null): ApiError => ({ status: 422, code, title: `Título de ${code}`, detail, errors: null, extensions });

/** O grupo de uma coluna sobre as linhas lidas `positions`, com o valor de referência de cada uma (o lido, ou o da coluna inteira). */
function group(edits: PendingEdits, column: number, value: string | null, positions: readonly number[]): PendingEdits {
  const builder = groupBuilder(edits, column, value);
  for (const row of positions) builder.read(row, referenceOf(edits, column, rows[row][column]));
  return builder.done();
}

describe("o grupo de células de uma coluna (RN-EDIT-017)", () => {
  it("cada célula lida vira uma pendência comum, na ordem da grade; a que já tinha o valor fica sem pendência", () => {
    const edits = group(noEdits, 1, "fechada", [0, 1, 2]);

    expect(edits.cells).toEqual([
      { row: 0, column: 1, value: "fechada" },
      { row: 1, column: 1, value: "fechada" },
    ]);
    expect(pendingCount(edits)).toBe(2);
  });

  it("a célula que já tinha uma pendência fica com o valor novo, no lugar dela; a que volta ao valor lido a perde", () => {
    const before = editCell(editCell(noEdits, 2, 1, "paga", "fechada"), 0, 1, "cancelada", "aberta");
    const after = group(before, 1, "aberta", [0, 1, 2]);

    expect(after.cells).toEqual([{ row: 2, column: 1, value: "aberta" }]);
  });

  it("as linhas novas escolhidas recebem o valor na célula delas, e as outras colunas não mudam", () => {
    const added = addRow(editNewCell(addRow(noEdits).edits, 1, 0, "9"));
    const builder = groupBuilder(added.edits, 1, "nova");
    builder.added(1);
    const edits = builder.done();

    expect(edits.added).toEqual([
      { id: 1, values: { 0: "9", 1: "nova" } },
      { id: 2, values: {} },
    ]);
  });

  it("numa junção, a mesma linha da tabela em duas linhas da grade é uma pendência só, pela primeira", () => {
    const builder = groupBuilder(noEdits, 1, "x");
    builder.read(0, "aberta", "k1");
    builder.read(2, "aberta", "k1");
    builder.read(1, "aberta", "k2");

    expect(builder.done().cells).toEqual([
      { row: 0, column: 1, value: "x", change: "k1" },
      { row: 1, column: 1, value: "x", change: "k2" },
    ]);
  });

  it("monta 100.000 células numa passada (um mapa das pendências, e não uma volta na lista por célula)", () => {
    const many = Array.from({ length: 100_000 }, (_, row) => row);
    const started = performance.now();
    const builder = groupBuilder(noEdits, 1, "x");
    for (const row of many) builder.read(row, "y");
    const edits = builder.done();
    expect(edits.cells).toHaveLength(100_000);
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it("\"Desfazer alteração\" do grupo inteiro de uma vez, numa passada", () => {
    const edits = group(noEdits, 1, "x", [0, 1, 2]);
    const undone = undoWhere(edits, edits, 3, (_, column) => column === 1, () => false);
    expect(undone?.cells).toEqual([]);
  });
});

describe("a coluna inteira, uma alteração só (RN-EDIT-018)", () => {
  it("guarda a coluna e o valor uma vez; conta como uma alteração; as pendências daquela coluna nas linhas lidas saem", () => {
    const before = editCell(editCell(noEdits, 0, 2, "11", "10"), 1, 1, "paga", "aberta");
    const edits = editWholeColumn(before, 2, "99");

    expect(edits.columns).toEqual([{ column: 2, value: "99" }]);
    expect(edits.cells).toEqual([{ row: 1, column: 1, value: "paga" }]);
    expect(pendingCount(edits)).toBe(2);
  });

  it("a segunda na mesma coluna troca o valor da primeira, no lugar dela; cada coluna tem a sua", () => {
    const edits = editWholeColumn(editWholeColumn(editWholeColumn(noEdits, 2, "1"), 1, "a"), 2, "2");

    expect(edits.columns).toEqual([
      { column: 2, value: "2" },
      { column: 1, value: "a" },
    ]);
  });

  it("as linhas novas que já existem recebem o valor; a criada depois não", () => {
    const one = addRow(noEdits).edits;
    const whole = editWholeColumn(one, 1, "nova");
    const later = addRow(whole).edits;

    expect(later.added).toEqual([
      { id: 1, values: { 1: "nova" } },
      { id: 2, values: {} },
    ]);
  });

  it("o valor de referência de uma célula daquela coluna é o da coluna inteira: voltar a ele tira a pendência, voltar ao lido não", () => {
    const whole = editWholeColumn(noEdits, 2, "99");
    expect(referenceOf(whole, 2, "10")).toBe("99");
    expect(referenceOf(whole, 1, "aberta")).toBe("aberta");

    const toRead = editCell(whole, 0, 2, "10", referenceOf(whole, 2, "10"));
    expect(pendingCell(toRead, 0, 2)).toEqual({ value: "10" });
    expect(editCell(toRead, 0, 2, "99", referenceOf(toRead, 2, "10")).cells).toEqual([]);
  });

  it("\"Desfazer alteração\" com a coluna escolhida inteira tira a dela e as pendências dela em todas as linhas, também nas novas", () => {
    let edits = editWholeColumn(addRow(noEdits).edits, 2, "99");
    edits = editCell(edits, 1, 2, "5", "99");
    edits = editCell(edits, 1, 1, "paga", "aberta");

    expect(cellsPendingIn(edits, [2])).toBe(2);
    const undone = undoWholeColumns(edits, [2])!;
    expect(undone.columns).toEqual([]);
    expect(undone.cells).toEqual([{ row: 1, column: 1, value: "paga" }]);
    expect(undone.added).toEqual([{ id: 1, values: {} }]);
    expect(undoWholeColumns(undone, [2])).toBeNull();
  });

  it("\"Desfazer alteração\" de células escolhidas não tira a da coluna inteira, que não se desfaz linha a linha", () => {
    const edits = editWholeColumn(noEdits, 2, "99");
    expect(undoWhere(edits, edits, 3, () => true, () => false)).toBeNull();
  });
});

describe("o Salvar com a coluna inteira (RN-EDIT-021)", () => {
  it("a updateAll vem primeiro, uma só, com uma atribuição por coluna na ordem em que foram feitas, e `rows` quando se sabe", () => {
    let edits = editWholeColumn(editWholeColumn(noEdits, 2, "99"), 1, null);
    edits = deleteRow(editCell(edits, 0, 0, "7", "1"), 2);
    edits = editNewCell(addRow(edits).edits, 1, 1, "nova");

    const draft = changesOf(edits, rows, target);
    expect(draft.changes).toEqual([
      { kind: "updateAll", table: 0, set: [{ column: 2, value: "99" }, { column: 1, value: null }] },
      { kind: "delete", table: 0, key: ["3"] },
      { kind: "update", table: 0, key: ["1"], set: [{ column: 0, value: "7" }] },
      { kind: "insert", table: 0, values: [{ column: 1, value: "nova" }] },
    ]);
    expect(draft.origins[0]).toEqual({ kind: "all", columns: [2, 1] });

    const confirmed = changesOf(edits, rows, target, 1234);
    expect(confirmed.changes[0]).toEqual({ kind: "updateAll", table: 0, set: [{ column: 2, value: "99" }, { column: 1, value: null }], rows: 1234 });
    expect(confirmed.rows).toBe(1234);
  });

  it("a grade depois do Salvar leva a coluna inteira em todas as linhas lidas, e a pendência da célula por cima dela", () => {
    const edits = editCell(editWholeColumn(noEdits, 2, "99"), 1, 2, "5", "99");
    const saved = savedResultOf({ rows, truncated: new Map() }, edits, 3);

    expect(saved.rows).toEqual([
      ["1", "aberta", "99"],
      ["2", "aberta", "5"],
      ["3", "fechada", "99"],
    ]);
  });

  it("no Informix sem log, a coluna inteira já gravada sai das pendências; a grade mostra o gravado nas linhas lidas que não estão marcadas para exclusão", () => {
    const edits = deleteRow(editCell(editWholeColumn(noEdits, 2, "99"), 0, 1, "paga", "aberta"), 2);
    const plan = changesOf(edits, rows, target, 3);

    expect(withoutApplied(edits, plan.origins, 1).columns).toEqual([]);
    expect(withColumnsWritten(rows, edits.columns!, edits.deleted)).toEqual([
      ["1", "aberta", "99"],
      ["2", "aberta", "99"],
      ["3", "fechada", "30"],
    ]);
    expect(withColumnsWritten(rows, [])).toBe(rows);
  });

  it("a grade do Salvar que parou depois da coluna inteira leva, por cima dela, as células das alterações por linha também gravadas", () => {
    const edits = editCell(editCell(editWholeColumn(noEdits, 2, "99"), 0, 2, "7", "10"), 2, 2, "8", "30");
    const plan = changesOf(edits, rows, { ...target, oneAtATime: true }, 3);
    // Gravadas a coluna inteira e a da linha 1; a da linha 3 falhou.
    const written = new Set(plan.origins.slice(0, 2).flatMap((origin) => (origin.kind === "row" ? [origin.row] : [])));
    const cells = edits.cells.filter((cell) => written.has(cell.row));

    expect(withColumnsWritten(rows, edits.columns!, edits.deleted, cells)).toEqual([
      ["1", "aberta", "7"],
      ["2", "aberta", "99"],
      ["3", "fechada", "99"],
    ]);
  });

  it("a recusa do banco na coluna inteira diz a coluna; a conversão também; a coluna inteira que não vale diz o motivo da API", () => {
    const edits = editWholeColumn(noEdits, 2, "abc");
    const plan = changesOf(edits, rows, target, 3);

    expect(failureOf(apiError("SQL_EXECUTION_FAILED", { change: 0 }, "ERRO: tipo"), plan, false, names)).toMatchObject({ headline: multi.failed(["preco"]), detail: "ERRO: tipo" });
    expect(failureOf(apiError("EDIT_INVALID", { change: 0, column: 2 }, "não converte"), plan, false, names)).toMatchObject({ headline: multi.failed(["preco"]), detail: "não converte", column: 2 });
    expect(failureOf(apiError("EDIT_ALL_ROWS_NOT_SUPPORTED", { change: 0, reason: "o comando sorteia as linhas" }), plan, false, names)).toMatchObject({ headline: "Indisponível: o comando sorteia as linhas." });
  });

  it("o resultado que mudou desde a contagem mostra o detalhe da API como veio", () => {
    const plan = changesOf(editWholeColumn(noEdits, 2, "1"), rows, target, 3);
    const detail = "O resultado mudou desde a contagem: o comando devolve agora 4 linhas, e não as 3 confirmadas. Nada foi gravado; salve de novo para contar outra vez.";
    expect(failureOf({ ...apiError("RESULT_CHANGED", {}, detail), status: 409 }, plan, false, names)).toMatchObject({ headline: "Título de RESULT_CHANGED", detail });
  });

  it("o cancelamento é pelo `outcome`: nada gravado; sem log, as já gravadas; e o desfecho que não se sabe", () => {
    const edits = editCell(addRow(noEdits).edits, 0, 1, "x", "aberta");
    const plan = changesOf(editNewCell(edits, 1, 1, "y"), rows, target);

    expect(failureOf(apiError("SQL_EXECUTION_FAILED", { outcome: "canceled", change: 0 }), plan, false, names)).toMatchObject({ headline: multi.cancelled, detail: null, origin: null });
    expect(failureOf(apiError("SQL_EXECUTION_FAILED", { outcome: "canceled", change: 1, applied: 1 }), plan, true, names)).toMatchObject({ headline: "Salvar cancelado: 1 alteração já estava gravada; a outra continua pendente.", applied: 1 });
    expect(failureOf(apiError("SQL_EXECUTION_FAILED", { outcome: "unknown" }), plan, false, names)).toMatchObject({ headline: multi.unknown });
  });

  it("no Informix sem log: o número de linhas que não bateu ficou gravado; a falha no meio pode ter gravado parte das linhas", () => {
    const edits = editCell(editCell(editWholeColumn(noEdits, 2, "99"), 0, 1, "a", "aberta"), 1, 1, "b", "aberta");
    const plan = changesOf(edits, rows, { ...target, oneAtATime: true }, 1234);

    const mismatch = failureOf(apiError("EDIT_ROW_MISMATCH", { change: 0, rowsAffected: 1240, applied: 1 }), plan, true, names);
    expect(mismatch).toMatchObject({
      headline: `A coluna preco foi alterada em 1.240 linhas, e não nas 1.234 contadas: o resultado mudou desde a contagem. Este banco não tem log de transação, e a alteração ficou gravada; as outras 2 continuam pendentes. ${multi.otherRows}`,
      applied: 1,
      written: false,
      whole: "written",
    });

    const midway = failureOf(apiError("SQL_EXECUTION_FAILED", { change: 0, outcome: "unknown", applied: 0 }, "lock"), plan, true, names);
    expect(midway).toMatchObject({ headline: multi.failedMidway(["preco"]), detail: "lock", applied: 0, whole: "uncertain" });
    // Sem o `unknown`, a recusa veio antes do UPDATE (a contagem ou a leitura das chaves, dentro do Salvar): nada foi gravado.
    const before = failureOf(apiError("SQL_EXECUTION_FAILED", { change: 0, applied: 0 }, "recusa"), plan, true, names);
    expect(before).toMatchObject({ headline: multi.failed(["preco"]), detail: "recusa", applied: 0 });
    expect(before.whole).toBeUndefined();

    // Uma alteração por linha que falha depois da coluna inteira gravada: as anteriores, com ela, ficam gravadas.
    const after = failureOf(apiError("SQL_EXECUTION_FAILED", { change: 2, applied: 2 }, "falhou"), plan, true, names);
    expect(after).toMatchObject({ applied: 2, whole: "written", headline: `${recordsCopy.edit.partlySaved(2, "linha 2", 1)} ${multi.otherRows}` });
  });

  it("a coluna inteira de uma alteração é achada pelo nome nas pendências", () => {
    expect(columnEditOf(editWholeColumn(noEdits, 2, "1"), 2)).toEqual({ column: 2, value: "1" });
    expect(columnEditOf(noEdits, 2)).toBeNull();
  });
});
