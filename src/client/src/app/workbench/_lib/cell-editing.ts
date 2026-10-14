import type { EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit;

/** Se a ação vale, ou por que não vale, já na frase que a tela mostra ("Somente leitura: …"). */
export type EditAccess = { editable: true } | { editable: false; reason: string };

/**
 * A linha da célula: uma lida do banco (com as colunas cortadas, a marca de exclusão, os valores que a grade leu, que dizem se a tabela da
 * coluna tem linha ali numa junção externa, e, na linha nova de um Salvar da aba de consulta, as colunas que o banco preencheu, RN-EDIT-009)
 * ou uma linha nova da grade.
 */
export type RowContext = { kind: "read"; truncated: ReadonlySet<number> | undefined; deleted: boolean; generated?: ReadonlySet<number>; values?: readonly (string | null)[] } | { kind: "new" };

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

/** O resultado lê mais de uma tabela (RN-EDIT-002): só se alteram células, cada coluna na tabela de onde veio. */
export function isJoin(target: EditTarget | null): boolean {
  return target !== null && target.tables.length > 1;
}

/** A tabela de uma coluna: numa tabela só, sempre ela (também na coluna calculada, que diz o motivo dela); numa junção, a de onde a coluna veio. */
function tableOf(target: EditTarget, column: number): number | null {
  return target.tables.length === 1 ? 0 : (target.columns[column]?.table ?? null);
}

/**
 * A chave da linha lida não tem o valor que o banco guarda: uma coluna dela chegou cortada (RN-SQL-011), ou foi o banco que a preencheu numa
 * linha nova salva (RN-EDIT-009); ou, numa junção externa, ela veio nula, e a tabela não tem linha ali. Não há como achar a linha pelo valor
 * que a grade tem. O motivo, ou nulo com a chave inteira.
 */
function keyUnknown(target: EditTarget, table: number, row: RowContext): string | null {
  if (row.kind !== "read") return null;
  const key = target.tables[table].key;
  if (key.some((column) => row.truncated?.has(column) === true)) return copy.reasons.keyTruncated;
  if (key.some((column) => row.generated?.has(column) === true)) return copy.reasons.keyGenerated;
  return row.values !== undefined && key.length > 0 && key.some((column) => row.values?.[column] === null) ? copy.reasons.noRowHere(target.tables[table].name) : null;
}

/** O que vale antes da coluna: o resultado, a aba ocupada e a tabela (a de posição `table`). */
function tableAccess(readOnly: string | null, target: EditTarget | null, busy: boolean, table: number | null): EditAccess | null {
  if (readOnly !== null) return denied(readOnly);
  if (busy) return denied(copy.reasons.busy);
  if (target === null) return null;
  if (table === null) return allowed;

  const found = target.tables[table];
  return found === undefined || found.editable ? allowed : denied(found.reason ?? copy.reasons.noRowOperations);
}

/**
 * RN-EDIT-002: a célula se edita quando o resultado e a tabela da coluna se editam, a coluna se edita, a linha não está marcada para exclusão e,
 * na linha lida, nem a célula nem a chave da tabela dela chegaram cortadas, foram preenchidas pelo banco num Salvar (RN-EDIT-009) ou vieram
 * nulas (junção externa sem linha). Sem o alvo (ainda não perguntado) a resposta é "pode", e quem decide de verdade é a primeira tentativa, que
 * pergunta.
 */
export function cellAccess({ readOnly, target, busy, column, row }: CellContext): EditAccess {
  const table = target === null ? null : tableOf(target, column);
  const access = tableAccess(readOnly, target, busy, table);
  if (access === null) return allowed;
  if (!access.editable) return access;

  const info = target!.columns[column];
  if (info === undefined || !info.editable || table === null) return denied(info?.reason ?? copy.reasons.noRowOperations);
  if (row.kind === "new") return allowed;
  if (row.deleted) return denied(copy.reasons.deleted);
  if (row.truncated?.has(column) === true) return denied(copy.reasons.truncated);
  const key = keyUnknown(target!, table, row);
  if (key !== null) return denied(key);
  if (row.generated?.has(column) === true) return denied(copy.reasons.generated);

  return allowed;
}

/** "Nova linha": só num resultado de uma tabela só que se edita (`rowOperations`); numa junção, só se alteram células. */
export function newRowAccess(readOnly: string | null, target: EditTarget | null, busy: boolean): EditAccess {
  const table = tableAccess(readOnly, target, busy, isJoin(target) ? null : 0);
  if (table === null) return allowed;
  if (!table.editable) return table;
  if (isJoin(target)) return denied(copy.reasons.joinRowOperations);

  return target!.rowOperations ? allowed : denied(copy.reasons.noRowOperations);
}

/** "Excluir linha": como a linha nova, e a linha lida precisa da chave inteira. A linha nova sai da grade. */
export function deleteRowAccess(row: RowContext, readOnly: string | null, target: EditTarget | null, busy: boolean): EditAccess {
  const access = newRowAccess(readOnly, target, busy);
  if (!access.editable || target === null) return access;

  const key = keyUnknown(target, 0, row);
  return key === null ? allowed : denied(key);
}

/**
 * RN-EDIT-002: o motivo de só leitura que a barra do resultado mostra: o do resultado inteiro, ou, quando o catálogo diz que nenhuma tabela se
 * edita, o de cada uma (numa tabela só, o dela). Com alguma tabela que se edita, nada: os motivos das colunas ficam no cabeçalho e na célula.
 */
export function resultReadOnly(readOnly: string | null, target: EditTarget | null): string | null {
  if (readOnly !== null) return copy.readOnly(readOnly);
  if (target === null || target.tables.some((table) => table.editable)) return null;

  return copy.readOnly([...new Set(target.tables.map((table) => table.reason ?? copy.reasons.noRowOperations))].join("; "));
}

/**
 * RN-EDIT-002: a dica do cabeçalho de cada coluna, quando o catálogo já respondeu: o motivo da que não se edita e, num resultado de junção, a
 * tabela e a coluna que a editável altera. Nula enquanto não se perguntou.
 */
export function columnHintsOf(target: EditTarget | null): readonly (string | null)[] | null {
  if (target === null) return null;

  return target.columns.map((column) => {
    if (!column.editable) return copy.readOnly(column.reason ?? "");
    const table = column.table === null ? undefined : target.tables[column.table];
    return isJoin(target) && table !== undefined && column.baseColumn !== null ? copy.editsColumn(table.name, column.baseColumn) : null;
  });
}
