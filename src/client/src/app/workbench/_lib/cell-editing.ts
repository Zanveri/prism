import type { EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit;

/** Se a ação vale, ou por que não vale, já na frase que a tela mostra ("Somente leitura: …"). */
export type EditAccess = { editable: true } | { editable: false; reason: string };

/** A linha da célula: uma lida do banco (com as colunas cortadas e a marca de exclusão) ou uma linha nova da grade. */
export type RowContext = { kind: "read"; truncated: ReadonlySet<number> | undefined; deleted: boolean } | { kind: "new" };

export type CellContext = {
  /** RN-EDIT-002: o motivo de o resultado inteiro ser só leitura, quando já se sabe (pela página ou pelo `edit-target`). */
  readOnly: string | null;
  /** O que o catálogo respondeu; nulo enquanto não se perguntou. */
  target: EditTarget | null;
  /** RN-SESSAO-002: um comando roda na aba (o Salvar também). */
  busy: boolean;
  column: number;
  row: RowContext;
};

const allowed: EditAccess = { editable: true };
const denied = (reason: string): EditAccess => ({ editable: false, reason: copy.readOnly(reason) });

/** A chave da linha lida tem uma coluna cortada (RN-SQL-011): não há como achar a linha pelo valor que a grade leu. */
function keyTruncated(target: EditTarget, row: RowContext): boolean {
  return row.kind === "read" && target.tables[0].key.some((column) => row.truncated?.has(column) === true);
}

/** O que vale para a linha inteira, antes da coluna: o resultado, a aba ocupada e a tabela. */
function tableAccess(readOnly: string | null, target: EditTarget | null, busy: boolean): EditAccess | null {
  if (readOnly !== null) return denied(readOnly);
  if (busy) return denied(copy.reasons.busy);
  if (target === null) return null;

  const table = target.tables[0];
  return table.editable ? allowed : denied(table.reason ?? copy.reasons.noRowOperations);
}

/**
 * RN-EDIT-002: a célula se edita quando o resultado e a tabela se editam, a coluna se edita, a linha não está marcada para exclusão e,
 * na linha lida, nem a célula nem a chave chegaram cortadas. Sem o alvo (ainda não perguntado) a resposta é "pode", e quem decide de
 * verdade é a primeira tentativa, que pergunta.
 */
export function cellAccess({ readOnly, target, busy, column, row }: CellContext): EditAccess {
  const table = tableAccess(readOnly, target, busy);
  if (table === null) return allowed;
  if (!table.editable) return table;

  const info = target!.columns[column];
  if (info === undefined || !info.editable) return denied(info?.reason ?? copy.reasons.noRowOperations);
  if (row.kind === "new") return allowed;
  if (row.deleted) return denied(copy.reasons.deleted);
  if (row.truncated?.has(column) === true) return denied(copy.reasons.truncated);
  if (keyTruncated(target!, row)) return denied(copy.reasons.keyTruncated);

  return allowed;
}

/** "Nova linha": só num resultado de uma tabela só que se edita (`rowOperations`). */
export function newRowAccess(readOnly: string | null, target: EditTarget | null, busy: boolean): EditAccess {
  const table = tableAccess(readOnly, target, busy);
  if (table === null) return allowed;
  if (!table.editable) return table;

  return target!.rowOperations ? allowed : denied(copy.reasons.noRowOperations);
}

/** "Excluir linha": como a linha nova, e a linha lida precisa da chave inteira. A linha nova sai da grade. */
export function deleteRowAccess(row: RowContext, readOnly: string | null, target: EditTarget | null, busy: boolean): EditAccess {
  const access = newRowAccess(readOnly, target, busy);
  if (!access.editable || target === null) return access;

  return keyTruncated(target, row) ? denied(copy.reasons.keyTruncated) : allowed;
}
