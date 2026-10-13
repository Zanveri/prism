import type { ApiError } from "@/lib/api/prism-api";

import type { QueryRow } from "./query.schema";
import { editErrorDetails, type ApiChange, type EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit;

/** O texto de uma célula, ou nulo para gravar NULL (RN-EDIT-006: a célula viaja como texto). */
export type EditValue = string | null;

/** Uma célula alterada de uma linha lida, pela posição da linha no resultado e da coluna. */
export type CellEdit = { row: number; column: number; value: EditValue };

/** Uma linha nova: só as colunas que a pessoa preencheu; as outras ficam com o padrão da tabela (RN-EDIT-005). */
export type NewRow = { id: number; values: Readonly<Record<number, EditValue>> };

/**
 * RN-EDIT-004: o que a pessoa fez na grade e ainda não foi ao banco. Cada lista guarda a ordem em que foi feita, que é a ordem do Salvar
 * dentro de cada grupo. É um valor: toda função devolve um novo, e a mesma instância quando nada mudou.
 */
export type PendingEdits = { cells: readonly CellEdit[]; deleted: readonly number[]; added: readonly NewRow[]; nextId: number };

export const noEdits: PendingEdits = { cells: [], deleted: [], added: [], nextId: 1 };

/** De onde veio cada alteração do pedido: uma linha lida ou uma linha nova. É o que a falha aponta. */
export type ChangeOrigin = { kind: "row"; row: number } | { kind: "new"; id: number };

export type PlannedChanges = { changes: ApiChange[]; origins: ChangeOrigin[] };

/** O valor pendente de uma célula de linha lida, ou nulo quando ela não está pendente. */
export function pendingCell(edits: PendingEdits, row: number, column: number): { value: EditValue } | null {
  const cell = edits.cells.find((item) => item.row === row && item.column === column);
  return cell === undefined ? null : { value: cell.value };
}

/** Editar uma célula de linha lida. Voltar ao valor lido tira a pendência; editar de novo mantém o lugar dela na ordem. */
export function editCell(edits: PendingEdits, row: number, column: number, value: EditValue, original: EditValue): PendingEdits {
  const index = edits.cells.findIndex((item) => item.row === row && item.column === column);
  if (value === original) return index < 0 ? edits : { ...edits, cells: edits.cells.filter((_, position) => position !== index) };

  const cell = { row, column, value };
  return { ...edits, cells: index < 0 ? [...edits.cells, cell] : edits.cells.map((item, position) => (position === index ? cell : item)) };
}

export function undoCell(edits: PendingEdits, row: number, column: number): PendingEdits {
  return { ...edits, cells: edits.cells.filter((item) => item.row !== row || item.column !== column) };
}

/** Excluir uma linha lida: as edições dela saem, porque o comando que vai é o de excluir. */
export function deleteRow(edits: PendingEdits, row: number): PendingEdits {
  if (edits.deleted.includes(row)) return edits;
  return { ...edits, cells: edits.cells.filter((item) => item.row !== row), deleted: [...edits.deleted, row] };
}

export function undoDelete(edits: PendingEdits, row: number): PendingEdits {
  return { ...edits, deleted: edits.deleted.filter((item) => item !== row) };
}

export function addRow(edits: PendingEdits): { edits: PendingEdits; id: number } {
  const id = edits.nextId;
  return { edits: { ...edits, added: [...edits.added, { id, values: {} }], nextId: id + 1 }, id };
}

export function editNewCell(edits: PendingEdits, id: number, column: number, value: EditValue): PendingEdits {
  return { ...edits, added: edits.added.map((row) => (row.id === id ? { id, values: { ...row.values, [column]: value } } : row)) };
}

export function undoNewCell(edits: PendingEdits, id: number, column: number): PendingEdits {
  return {
    ...edits,
    added: edits.added.map((row) => {
      if (row.id !== id) return row;
      const values = { ...row.values };
      delete values[column];
      return { id, values };
    }),
  };
}

/** "Excluir linha" numa linha nova: ela some, porque nunca foi ao banco. */
export function removeNewRow(edits: PendingEdits, id: number): PendingEdits {
  return { ...edits, added: edits.added.filter((row) => row.id !== id) };
}

/** Uma alteração por comando do Salvar: a linha lida com células editadas, a exclusão e a linha nova. */
export function pendingCount(edits: PendingEdits): number {
  return new Set(edits.cells.map((cell) => cell.row)).size + edits.deleted.length + edits.added.length;
}

/**
 * RN-EDIT-005: o pedido do Salvar. Primeiro as exclusões, depois as alterações (uma por linha, na ordem em que a linha foi editada pela
 * primeira vez), depois as linhas novas, cada grupo na ordem em que foi feito. A chave é a que a grade leu (a linha como veio do banco,
 * mesmo com a coluna da chave editada). Nesta rodada o resultado tem uma tabela só, a de posição 0.
 */
export function changesOf(edits: PendingEdits, rows: readonly QueryRow[], target: EditTarget): PlannedChanges {
  const key = (row: number) => target.tables[0].key.map((column) => rows[row][column] ?? "");
  const changes: ApiChange[] = [];
  const origins: ChangeOrigin[] = [];

  for (const row of edits.deleted) {
    changes.push({ kind: "delete", table: 0, key: key(row) });
    origins.push({ kind: "row", row });
  }

  const edited = [...new Set(edits.cells.map((cell) => cell.row))].filter((row) => !edits.deleted.includes(row));
  for (const row of edited) {
    changes.push({ kind: "update", table: 0, key: key(row), set: edits.cells.filter((cell) => cell.row === row).map(({ column, value }) => ({ column, value })) });
    origins.push({ kind: "row", row });
  }

  for (const row of edits.added) {
    const values = Object.entries(row.values)
      .map(([column, value]) => ({ column: Number(column), value: value ?? null }))
      .sort((left, right) => left.column - right.column);
    changes.push({ kind: "insert", table: 0, values });
    origins.push({ kind: "new", id: row.id });
  }

  return { changes, origins };
}

/** RN-EDIT-012: as `applied` primeiras alterações do pedido já foram gravadas, e saem das pendências; a que falhou e as seguintes ficam. */
export function withoutApplied(edits: PendingEdits, origins: readonly ChangeOrigin[], applied: number): PendingEdits {
  let next = edits;
  for (const origin of origins.slice(0, applied)) {
    if (origin.kind === "new") next = removeNewRow(next, origin.id);
    else next = { ...next, cells: next.cells.filter((cell) => cell.row !== origin.row), deleted: next.deleted.filter((row) => row !== origin.row) };
  }
  return next;
}

/** O que a faixa mostra depois de um Salvar recusado: a frase de cima, a mensagem (a do banco, como veio), a alteração e a coluna que falharam. */
export type SaveFailure = {
  headline: string;
  detail: string | null;
  origin: ChangeOrigin | null;
  column: number | null;
  /** RN-EDIT-012: as alterações já gravadas antes da que falhou, no banco sem log. */
  applied: number;
  /** RN-EDIT-012: a que falhou alterou mais de uma linha e já está gravada: sai das pendências também. */
  written: boolean;
};

/** Como a faixa chama a linha de uma alteração: o número da linha lida, ou a posição da linha nova. */
export function originLabel(origin: ChangeOrigin, plan: PlannedChanges): string {
  if (origin.kind === "row") return copy.rowLabel(origin.row + 1);
  const added = plan.origins.filter((item) => item.kind === "new");
  return copy.newRowLabel(added.findIndex((item) => item.kind === "new" && item.id === origin.id) + 1);
}

/**
 * RN-EDIT-005 e 012: a recusa do Salvar, pela API. A mensagem do banco vem como veio (decisão 4 do guia da raiz); a contagem de linhas
 * vira a frase da regra ("a linha não existe mais" para zero). Sem log de transação, a frase diz quantas foram gravadas, qual falhou e
 * quantas continuam pendentes.
 */
export function failureOf(error: ApiError, plan: PlannedChanges, oneAtATime: boolean): SaveFailure {
  const details = editErrorDetails(error.extensions);
  const origin = details.change === null ? null : (plan.origins[details.change] ?? null);
  const applied = oneAtATime ? (details.applied ?? 0) : 0;
  const written = oneAtATime && error.code === "EDIT_ROW_MISMATCH" && (details.rowsAffected ?? 0) > 1;

  const detail =
    error.code === "EDIT_ROW_MISMATCH"
      ? details.rowsAffected === null || details.rowsAffected === 0
        ? copy.noRow
        : written
          ? copy.manyRowsWritten(details.rowsAffected)
          : copy.manyRows(details.rowsAffected)
      : (error.detail ?? null);

  if (origin === null) return { headline: error.title, detail, origin: null, column: null, applied, written };

  const row = originLabel(origin, plan);
  const done = applied + (written ? 1 : 0);
  const headline = oneAtATime && done > 0 ? copy.partlySaved(done, row, plan.changes.length - done) : copy.failedAt(row);

  return { headline, detail, origin, column: details.column, applied, written };
}
