import type { ApiError } from "@/lib/api/prism-api";

import type { QueryRow } from "./query.schema";
import { editErrorDetails, type ApiChange, type EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit;

/** O texto de uma célula, ou nulo para gravar NULL (RN-EDIT-006: a célula viaja como texto). */
export type EditValue = string | null;

/**
 * Uma célula alterada de uma linha lida, pela posição da linha no resultado e da coluna. Num resultado de junção, `change` é a linha da tabela
 * da coluna (`changeKeyOf`): a mesma linha da tabela pode aparecer em várias linhas da grade, e a pendência vale para todas (RN-EDIT-002); `row`
 * é a primeira em que ela foi editada.
 */
export type CellEdit = { row: number; column: number; value: EditValue; change?: string };

/** Uma linha nova: só as colunas que a pessoa preencheu; as outras ficam com o padrão da tabela (RN-EDIT-005). */
export type NewRow = { id: number; values: Readonly<Record<number, EditValue>> };

/**
 * RN-EDIT-004: o que a pessoa fez na grade e ainda não foi ao banco. Cada lista guarda a ordem em que foi feita, que é a ordem do Salvar
 * dentro de cada grupo. É um valor: toda função devolve um novo, e a mesma instância quando nada mudou.
 */
export type PendingEdits = { cells: readonly CellEdit[]; deleted: readonly number[]; added: readonly NewRow[]; nextId: number };

export const noEdits: PendingEdits = { cells: [], deleted: [], added: [], nextId: 1 };

/** De onde veio cada alteração do pedido: uma linha lida (numa junção, com a linha da tabela, `change`) ou uma linha nova. É o que a falha aponta. */
export type ChangeOrigin = { kind: "row"; row: number; change?: string } | { kind: "new"; id: number };

export type PlannedChanges = { changes: ApiChange[]; origins: ChangeOrigin[] };

/** O valor pendente de uma célula de linha lida, ou nulo quando ela não está pendente. */
export function pendingCell(edits: PendingEdits, row: number, column: number): { value: EditValue } | null {
  const cell = edits.cells.find((item) => item.row === row && item.column === column);
  return cell === undefined ? null : { value: cell.value };
}

/** A pendência da célula: pela linha da tabela (`change`, numa junção), em qualquer linha da grade que a mostre; senão, pela linha da grade. */
function sameCell(item: CellEdit, row: number, column: number, change: string | undefined): boolean {
  return item.column === column && (change === undefined ? item.row === row && item.change === undefined : item.change === change);
}

/**
 * Editar uma célula de linha lida. Voltar ao valor lido tira a pendência; editar de novo mantém o lugar dela na ordem. Numa junção, `change`
 * é a linha da tabela da coluna (`changeKeyOf`): editar a mesma célula noutra linha da grade que mostra a mesma linha da tabela troca a mesma
 * pendência.
 */
export function editCell(edits: PendingEdits, row: number, column: number, value: EditValue, original: EditValue, change?: string): PendingEdits {
  const index = edits.cells.findIndex((item) => sameCell(item, row, column, change));
  if (value === original) return index < 0 ? edits : { ...edits, cells: edits.cells.filter((_, position) => position !== index) };

  const cell: CellEdit = change === undefined ? { row, column, value } : { row: index < 0 ? row : edits.cells[index].row, column, value, change };
  return { ...edits, cells: index < 0 ? [...edits.cells, cell] : edits.cells.map((item, position) => (position === index ? cell : item)) };
}

export function undoCell(edits: PendingEdits, row: number, column: number, change?: string): PendingEdits {
  return { ...edits, cells: edits.cells.filter((item) => !sameCell(item, row, column, change)) };
}

/**
 * RN-EDIT-002: num resultado de junção, a linha da tabela de uma coluna numa linha da grade: a tabela e os textos que a grade leu na chave dela.
 * Linhas da grade com a mesma linha da tabela têm o mesmo valor. Nulo na coluna calculada, na tabela sem chave e na junção externa sem linha
 * (a chave veio nula).
 */
export function changeKeyOf(rows: readonly QueryRow[], target: EditTarget, row: number, column: number): string | null {
  const table = target.columns[column]?.table ?? null;
  const key = table === null ? [] : (target.tables[table]?.key ?? []);
  const values = key.map((position) => rows[row]?.[position] ?? null);
  if (key.length === 0 || values.some((value) => value === null)) return null;

  return JSON.stringify([table, values]);
}

/**
 * RN-EDIT-002 e 004: as pendências como a grade as mostra num resultado de junção: a célula alterada numa linha de uma tabela aparece em todas
 * as linhas da grade que mostram aquela linha (também nas que chegaram depois, pelo "carregar mais"). A mesma instância quando não há o que
 * repetir.
 */
export function linkedCells(edits: PendingEdits, rows: readonly QueryRow[], target: EditTarget): PendingEdits {
  const linked = edits.cells.filter((cell) => cell.change !== undefined);
  if (linked.length === 0) return edits;

  const rowsOf = new Map<string, number[]>();
  for (const column of new Set(linked.map((cell) => cell.column))) {
    rows.forEach((_, row) => {
      const change = changeKeyOf(rows, target, row, column);
      if (change === null) return;
      const name = `${change}#${column}`;
      rowsOf.set(name, [...(rowsOf.get(name) ?? []), row]);
    });
  }

  const extra = linked.flatMap((cell) => (rowsOf.get(`${cell.change}#${cell.column}`) ?? []).filter((row) => row !== cell.row).map((row) => ({ ...cell, row })));
  return extra.length === 0 ? edits : { ...edits, cells: [...edits.cells, ...extra] };
}

/** Excluir uma linha lida: as edições dela saem, porque o comando que vai é o de excluir. */
export function deleteRow(edits: PendingEdits, row: number): PendingEdits {
  if (edits.deleted.includes(row)) return edits;
  return { ...edits, cells: edits.cells.filter((item) => item.row !== row), deleted: [...edits.deleted, row] };
}

/**
 * RN-EDIT-013: excluir várias linhas lidas de uma vez ("Excluir linhas", o Delete e o Alt+Delete sobre a seleção), na ordem de `rows`: as já excluídas ficam
 * como estavam, e as edições das outras saem. Uma passada só, pelos conjuntos, e não uma `deleteRow` por linha: o Ctrl+A com 50.000 linhas carregadas não
 * custa 50.000 cópias da lista. Sem linha nova a excluir, devolve as mesmas pendências.
 */
export function deleteRows(edits: PendingEdits, rows: readonly number[]): PendingEdits {
  const already = new Set(edits.deleted);
  const added: number[] = [];
  for (const row of rows) {
    if (already.has(row)) continue;
    already.add(row);
    added.push(row);
  }
  if (added.length === 0) return edits;
  const gone = new Set(added);
  return { ...edits, cells: edits.cells.filter((item) => !gone.has(item.row)), deleted: [...edits.deleted, ...added] };
}

export function undoDelete(edits: PendingEdits, row: number): PendingEdits {
  return { ...edits, deleted: edits.deleted.filter((item) => item !== row) };
}

/** Uma linha nova no fim da grade; `values` são as colunas que já vêm preenchidas (a duplicada, RN-EDIT-016), e sem elas a linha vem em branco. */
export function addRow(edits: PendingEdits, values: Readonly<Record<number, EditValue>> = {}): { edits: PendingEdits; id: number } {
  const id = edits.nextId;
  return { edits: { ...edits, added: [...edits.added, { id, values: { ...values } }], nextId: id + 1 }, id };
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

/**
 * RN-EDIT-004: "Desfazer alteração" nas células escolhidas (RN-GRADE-001): o valor alterado volta ao lido (numa junção, em todas as linhas da grade que mostram
 * a mesma linha da tabela, pela `change`), a linha marcada para exclusão que tem uma célula escolhida volta, e, numa linha nova, a célula volta ao padrão
 * da tabela (a linha fica: quem a tira é "Excluir linha"). `view` são as pendências como a grade as mostra (`linkedCells`); `read`, quantas linhas lidas há;
 * `chosen` diz se a célula da grade está escolhida e `rowChosen`, se a linha tem uma. Nulo quando nenhuma célula escolhida tem o que desfazer: é assim que o
 * menu sabe se o item se habilita. Percorre as pendências, e não a seleção: a seleção grande não custa nada aqui.
 */
export function undoWhere(edits: PendingEdits, view: PendingEdits, read: number, chosen: (row: number, column: number) => boolean, rowChosen: (row: number) => boolean): PendingEdits | null {
  let next = edits;
  let changed = false;
  for (const cell of view.cells) {
    if (!chosen(cell.row, cell.column) || !next.cells.some((item) => sameCell(item, cell.row, cell.column, cell.change))) continue;
    next = undoCell(next, cell.row, cell.column, cell.change);
    changed = true;
  }
  for (const row of edits.deleted) {
    if (!rowChosen(row)) continue;
    next = undoDelete(next, row);
    changed = true;
  }
  edits.added.forEach((row, index) => {
    for (const column of Object.keys(row.values).map(Number)) {
      if (!chosen(read + index, column)) continue;
      next = undoNewCell(next, row.id, column);
      changed = true;
    }
  });
  return changed ? next : null;
}

/** "Excluir linha" numa linha nova: ela some, porque nunca foi ao banco. */
export function removeNewRow(edits: PendingEdits, id: number): PendingEdits {
  return { ...edits, added: edits.added.filter((row) => row.id !== id) };
}

/** Tirar várias linhas novas de uma vez, numa passada só (RN-EDIT-013); sem nenhuma delas entre as novas, devolve as mesmas pendências. */
export function removeNewRows(edits: PendingEdits, ids: readonly number[]): PendingEdits {
  const gone = new Set(ids);
  const added = edits.added.filter((row) => !gone.has(row.id));
  return added.length === edits.added.length ? edits : { ...edits, added };
}

/** A alteração de uma célula: numa junção, a linha da tabela dela; senão, a linha da grade. */
function changeOfCell(cell: CellEdit): string {
  return cell.change ?? `#${cell.row}`;
}

/** Uma alteração por comando do Salvar: a linha lida com células editadas (numa junção, a linha de cada tabela), a exclusão e a linha nova. */
export function pendingCount(edits: PendingEdits): number {
  return new Set(edits.cells.map(changeOfCell)).size + edits.deleted.length + edits.added.length;
}

/**
 * RN-EDIT-005: o pedido do Salvar. Primeiro as exclusões, depois as alterações (uma por linha, na ordem em que a linha foi editada pela
 * primeira vez; numa junção, uma por linha de cada tabela, pela chave dela, e as alterações de uma linha da grade em duas tabelas são duas),
 * depois as linhas novas, cada grupo na ordem em que foi feito. A chave é a que a grade leu (a linha como veio do banco, mesmo com a coluna
 * da chave editada). Linha nova (também a duplicada) e exclusão só existem no resultado de uma tabela só, a de posição 0.
 */
export function changesOf(edits: PendingEdits, rows: readonly QueryRow[], target: EditTarget): PlannedChanges {
  const key = (row: number, table: number) => (target.tables[table]?.key ?? []).map((column) => rows[row][column] ?? "");
  const changes: ApiChange[] = [];
  const origins: ChangeOrigin[] = [];

  for (const row of edits.deleted) {
    changes.push({ kind: "delete", table: 0, key: key(row, 0) });
    origins.push({ kind: "row", row });
  }

  const edited = [...new Set(edits.cells.filter((cell) => !edits.deleted.includes(cell.row)).map(changeOfCell))];
  for (const change of edited) {
    const cells = edits.cells.filter((cell) => changeOfCell(cell) === change);
    const { row } = cells[0];
    const table = target.columns[cells[0].column]?.table ?? 0;
    changes.push({ kind: "update", table, key: key(row, table), set: cells.map(({ column, value }) => ({ column, value })) });
    origins.push(cells[0].change === undefined ? { kind: "row", row } : { kind: "row", row, change: cells[0].change });
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
    else if (origin.change !== undefined) next = { ...next, cells: next.cells.filter((cell) => cell.change !== origin.change) };
    else next = { ...next, cells: next.cells.filter((cell) => cell.row !== origin.row || cell.change !== undefined), deleted: next.deleted.filter((row) => row !== origin.row) };
  }
  return next;
}

/** As células de cada linha da grade, pela posição da linha: as cortadas (RN-SQL-011) e as que o banco preencheu (RN-EDIT-009). */
export type CellMarks = ReadonlyMap<number, ReadonlySet<number>>;

/** A grade de um resultado depois de um Salvar que gravou tudo, sem executar de novo (RN-EDIT-009). */
export type SavedResult = {
  rows: QueryRow[];
  truncated: CellMarks;
  /** As colunas de cada linha nova salva que a pessoa não preencheu: o banco pôs o padrão da tabela (ou gerou o valor), e a tela não o sabe. */
  generated: CellMarks;
  /**
   * RN-SQL-017: a linha do resultado na API de cada linha da grade (nula na linha nova), para copiar e exportar pedirem o valor completo da célula
   * cortada pela linha certa depois que as excluídas saíram. Sem ele, a linha da grade é a do resultado.
   */
  sourceRows?: readonly (number | null)[];
};

/** As marcas das linhas que ficam, pela posição nova delas (as excluídas saem e as de depois sobem). */
function shifted(marks: CellMarks | undefined, positionOf: (row: number) => number | null): Map<number, ReadonlySet<number>> {
  const next = new Map<number, ReadonlySet<number>>();
  for (const [row, columns] of marks ?? []) {
    const position = positionOf(row);
    if (position !== null) next.set(position, columns);
  }
  return next;
}

/**
 * RN-EDIT-009: a grade depois de um Salvar que gravou tudo, na aba de consulta, que não executa de novo. As linhas lidas ficam, com os valores
 * salvos (a que não mudou é o mesmo objeto); as excluídas saem; as novas entram no fim com o que foi digitado, e as colunas que ninguém preencheu
 * ficam marcadas como preenchidas pelo banco ("gerado pelo banco — execute de novo para ver"). As marcas de corte acompanham a linha.
 */
export function savedResultOf(result: { rows: readonly QueryRow[]; truncated: CellMarks; generated?: CellMarks; sourceRows?: readonly (number | null)[] }, edits: PendingEdits, columns: number): SavedResult {
  const { rows, truncated } = result;
  if (pendingCount(edits) === 0) return { rows: rows as QueryRow[], truncated, generated: result.generated ?? new Map(), ...(result.sourceRows === undefined ? {} : { sourceRows: result.sourceRows }) };

  const deleted = new Set(edits.deleted);
  const positions: (number | null)[] = [];
  const kept: QueryRow[] = [];
  const sourceRows: (number | null)[] = [];
  rows.forEach((row, index) => {
    if (deleted.has(index)) return void positions.push(null);
    positions.push(kept.length);
    sourceRows.push(result.sourceRows === undefined ? index : (result.sourceRows[index] ?? null));
    const cells = edits.cells.filter((cell) => cell.row === index);
    if (cells.length === 0) return void kept.push(row);
    const next = [...row];
    for (const cell of cells) next[cell.column] = cell.value;
    kept.push(next);
  });

  const positionOf = (row: number) => positions[row] ?? null;
  const generated = shifted(result.generated, positionOf);
  for (const row of edits.added) {
    const filled = Array.from({ length: columns }, (_, column) => column in row.values);
    generated.set(kept.length, new Set(filled.flatMap((done, column) => (done ? [] : [column]))));
    kept.push(filled.map((done, column) => (done ? (row.values[column] ?? null) : null)));
    sourceRows.push(null);
  }

  // A linha de cada uma no resultado só muda quando alguma saiu ou entrou; sem isso, é a mesma posição, e o campo não vai.
  const moved = edits.deleted.length > 0 || edits.added.length > 0 || result.sourceRows !== undefined;
  return { rows: kept, truncated: truncated.size === 0 ? truncated : shifted(truncated, positionOf), generated: new Map([...generated].filter(([, cells]) => cells.size > 0)), ...(moved ? { sourceRows } : {}) };
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
