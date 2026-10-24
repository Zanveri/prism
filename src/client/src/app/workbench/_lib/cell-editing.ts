import type { EditTarget } from "./record-edits.schema";
import { gridSelectionCopy } from "./grid-selection.copy";
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
  /**
   * RN-SESSAO-002: um comando roda na aba (o Salvar também). `"refresh"`: é a execução da atualização automática (RN-GRADE-014), que vai trocar as linhas e o
   * resultado da API; o motivo é outro.
   */
  busy: boolean | "refresh";
  column: number;
  row: RowContext;
};

/** O que `selectEditorText` precisa do campo de edição: o texto, a seleção e a rolagem (o que uma `HTMLTextAreaElement` tem). */
export type EditorField = { value: string; scrollLeft: number; scrollTop: number; setSelectionRange: (start: number, end: number, direction?: "forward" | "backward" | "none") => void };

/**
 * RN-EDIT-001: a seleção do campo de edição quando ele abre. Aberto por F2, Enter, duplo clique, "Editar célula" ou Tab, o texto vem TODO selecionado (Delete
 * apaga, digitar escreve por cima) e o campo mostra o começo dele: a seleção vai de trás para a frente, para o cursor ficar no início, e a rolagem volta ao
 * zero (o Chromium rola até o fim da seleção). Aberto pelo primeiro caractere digitado (`typed`), o campo já traz só esse caractere, e o cursor fica depois dele.
 */
export function selectEditorText(field: EditorField, typed: boolean): void {
  const end = field.value.length;
  if (typed) {
    field.setSelectionRange(end, end);
    return;
  }
  field.setSelectionRange(0, end, "backward");
  field.scrollLeft = 0;
  field.scrollTop = 0;
}

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

/** Por que a chave da linha lida não acha a linha no banco: cortada, gerada pelo banco num Salvar, ou nula numa junção externa (a tabela não tem linha ali). */
type KeyProblem = "truncated" | "generated" | "noRowHere";

/**
 * A chave da linha lida não tem o valor que o banco guarda: uma coluna dela chegou cortada (RN-SQL-011), ou foi o banco que a preencheu numa
 * linha nova salva (RN-EDIT-009); ou, numa junção externa, ela veio nula, e a tabela não tem linha ali. Não há como achar a linha pelo valor
 * que a grade tem. O problema, ou nulo com a chave inteira.
 */
function keyProblem(target: EditTarget, table: number, row: RowContext): KeyProblem | null {
  if (row.kind !== "read") return null;
  const key = target.tables[table].key;
  if (key.some((column) => row.truncated?.has(column) === true)) return "truncated";
  if (key.some((column) => row.generated?.has(column) === true)) return "generated";
  return row.values !== undefined && key.length > 0 && key.some((column) => row.values?.[column] === null) ? "noRowHere" : null;
}

/** O motivo de a chave não achar a linha, com o número da linha na grade quando a ação é sobre várias (RN-EDIT-014). */
function keyUnknown(target: EditTarget, table: number, row: RowContext, number?: number): string | null {
  const problem = keyProblem(target, table, row);
  if (problem === null) return null;
  if (problem === "noRowHere") return copy.reasons.noRowHere(target.tables[table].name);
  if (number === undefined) return problem === "truncated" ? copy.reasons.keyTruncated : copy.reasons.keyGenerated;
  return problem === "truncated" ? gridSelectionCopy.rows.keyTruncatedAt(number) : gridSelectionCopy.rows.keyGeneratedAt(number);
}

/** O que vale antes da coluna: o resultado, a aba ocupada e a tabela (a de posição `table`). */
function tableAccess(readOnly: string | null, target: EditTarget | null, busy: boolean | "refresh", table: number | null): EditAccess | null {
  if (readOnly !== null) return denied(readOnly);
  if (busy) return denied(busy === "refresh" ? copy.reasons.refreshing : copy.reasons.busy);
  if (target === null) return null;
  if (table === null) return allowed;

  const found = target.tables[table];
  return found === undefined || found.editable ? allowed : denied(found.reason ?? copy.reasons.noRowOperations);
}

/**
 * RN-EDIT-002: a célula se edita quando o resultado e a tabela da coluna se editam, a coluna se edita, a linha não está marcada para exclusão e,
 * na linha lida, nem a célula nem a chave da tabela dela chegaram cortadas, foram preenchidas pelo banco num Salvar (RN-EDIT-009) ou vieram
 * nulas (junção externa sem linha). Sem o alvo (ainda não perguntado), o que depende do catálogo (a tabela, a coluna e a chave) é "pode", e quem
 * decide de verdade é a primeira tentativa, que pergunta; o que a linha já diz (marcada para exclusão, a célula cortada, a célula que o banco
 * preencheu) vale desde o começo (RN-EDIT-014), sem a consulta.
 */
export function cellAccess({ readOnly, target, busy, column, row }: CellContext): EditAccess {
  const table = target === null ? null : tableOf(target, column);
  const access = tableAccess(readOnly, target, busy, table);
  if (access !== null && !access.editable) return access;

  if (target !== null) {
    const info = target.columns[column];
    if (info === undefined || !info.editable || table === null) return denied(info?.reason ?? copy.reasons.noRowOperations);
  }
  const problem = rowProblem(target, table, column, row);
  if (problem === null) return allowed;
  if (problem.kind === "deleted") return denied(copy.reasons.deleted);
  if (problem.kind === "truncated") return denied(copy.reasons.truncated);
  if (problem.kind === "generated") return denied(copy.reasons.generated);
  return denied(keyUnknown(target!, problem.table, row) ?? copy.reasons.keyTruncated);
}

/**
 * Por que a célula não recebe um valor por causa da LINHA dela (RN-EDIT-002 e 014), na ordem em que `cellAccess` os confere: a linha marcada para exclusão, a
 * célula cortada, a chave da tabela da coluna (cortada, gerada pelo banco num Salvar, ou nula numa junção externa) e a célula que o banco preencheu numa linha
 * nova salva. Nulo na linha nova e quando a linha deixa. A chave só é conferida com o alvo (`table`, a tabela da coluna). A edição de várias células confere
 * cada uma por aqui (RN-EDIT-017), com o número da linha na frase.
 */
export type RowProblem = { kind: "deleted" } | { kind: "truncated" } | { kind: "generated" } | { kind: "key"; problem: "truncated" | "generated" | "noRowHere"; table: number };

export function rowProblem(target: EditTarget | null, table: number | null, column: number, row: RowContext): RowProblem | null {
  if (row.kind === "new") return null;
  if (row.deleted) return { kind: "deleted" };
  if (row.truncated?.has(column) === true) return { kind: "truncated" };
  const key = target === null || table === null ? null : keyProblem(target, table, row);
  if (key !== null && table !== null) return { kind: "key", problem: key, table };
  if (row.generated?.has(column) === true) return { kind: "generated" };
  return null;
}

/** A tabela da coluna, como `cellAccess` a acha (numa tabela só, sempre ela; numa junção, a de onde a coluna veio). */
export function tableOfColumn(target: EditTarget | null, column: number): number | null {
  return target === null ? null : tableOf(target, column);
}

/** "Adicionar linha" (e "Duplicar linha", RN-EDIT-016): só num resultado de uma tabela só que se edita (`rowOperations`); numa junção, só se alteram células. */
export function newRowAccess(readOnly: string | null, target: EditTarget | null, busy: boolean | "refresh"): EditAccess {
  const table = tableAccess(readOnly, target, busy, isJoin(target) ? null : 0);
  if (table === null) return allowed;
  if (!table.editable) return table;
  if (isJoin(target)) return denied(copy.reasons.joinRowOperations);

  return target!.rowOperations ? allowed : denied(copy.reasons.noRowOperations);
}

/**
 * "Excluir linha": como a linha nova, e a linha lida precisa da chave inteira. A linha nova sai da grade. A linha que já está marcada para exclusão não se
 * exclui de novo (RN-EDIT-014): "Desfazer alteração" a devolve. Isso se sabe sem o alvo (as pendências lembradas com a aba voltam sem ele).
 */
export function deleteRowAccess(row: RowContext, readOnly: string | null, target: EditTarget | null, busy: boolean | "refresh"): EditAccess {
  const access = newRowAccess(readOnly, target, busy);
  if (!access.editable) return access;

  const key = target === null ? null : keyUnknown(target, 0, row);
  if (key !== null) return denied(key);
  return row.kind === "read" && row.deleted ? denied(copy.reasons.alreadyDeleted) : allowed;
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

/** Uma linha da seleção para as ações de linha: o número dela na grade (de 1 em diante) e o que ela é. */
export type SelectedRow = { number: number; row: RowContext };

/**
 * RN-EDIT-014: "Excluir linhas", sobre as linhas da seleção. Como "Excluir linha", e mais: quando uma delas não se exclui, porque a chave dela não se sabe
 * (cortada, ou gerada pelo banco numa linha nova salva), nada é excluído, e o motivo é o da primeira na ordem da grade, com o número dela ("a chave da linha
 * 7 chegou cortada"). A linha que já está marcada para exclusão não impede; quando todas já estão, o motivo diz isso. Com uma linha só, é o "Excluir linha".
 */
export function deleteRowsAccess(rows: readonly SelectedRow[], readOnly: string | null, target: EditTarget | null, busy: boolean | "refresh"): EditAccess {
  if (rows.length === 1) return deleteRowAccess(rows[0].row, readOnly, target, busy);
  const access = newRowAccess(readOnly, target, busy);
  if (!access.editable) return access;

  let something = false;
  for (const { number, row } of rows) {
    if (row.kind === "read" && row.deleted) continue;
    const key = target === null ? null : keyUnknown(target, 0, row, number);
    if (key !== null) return denied(key);
    something = true;
  }
  return something || rows.length === 0 ? allowed : denied(gridSelectionCopy.rows.alreadyDeleted);
}
