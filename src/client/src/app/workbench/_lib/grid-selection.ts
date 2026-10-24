import type { GridCell } from "./grid-cursor";
import type { GridSlice } from "./grid-export/grid-slice";
import type { QueryColumn } from "./query.schema";

/**
 * A seleção da grade (RN-GRADE-001), sem React e sem DOM: o modelo, o que cada gesto faz com ele e as perguntas que a grade, o copiar, as ações de linha, o
 * "Copiar avançado" e o "Gerar SQL" fazem a ele. Quem guarda o estado é `use-record-edits.ts`; quem desenha é `result-grid.tsx`.
 *
 * - A grade tem uma célula ativa e uma seleção, de uma de três formas: um retângulo de células, da âncora até a célula ativa (`cells`); linhas inteiras,
 *   seguidas ou não (`rows`); ou colunas inteiras, seguidas ou não (`columns`, RN-GRADE-022), que valem para TODAS as linhas do resultado: as lidas, as que o
 *   cursor ainda não leu e as novas. Sem nada escolhido além da célula ativa, a seleção é ela (`cell`).
 * - As linhas são guardadas pela identidade, e não pelo lugar na grade: as lidas pela posição no resultado, em faixas, e as novas pelo id da linha nova
 *   (`NewRow.id`), uma a uma. O "carregar mais" põe as lidas que chegam ANTES das novas e empurra as novas para baixo; guardadas assim, a âncora, a célula
 *   ativa e as linhas da seleção continuam nas mesmas linhas. As lidas que chegam depois de um Ctrl+A não entram nele (a faixa termina onde as lidas
 *   terminavam), e as novas que já estavam, sim.
 * - Nunca célula por célula: escolher 100 mil células (o Ctrl+A em 5.000 linhas de 20 colunas) é uma faixa e a lista das novas, e a pergunta "esta linha está
 *   escolhida?" é uma busca binária nas faixas. As colunas inteiras são só a lista das posições das colunas: escolher a coluna de um milhão de linhas custa o
 *   mesmo que escolher uma célula, e as linhas que chegam depois (o "Carregar mais") já chegam escolhidas, porque a forma não guarda linha nenhuma.
 *
 * As posições que entram e saem (`GridCell`, `row`) são as da grade AGORA: as lidas e, depois delas, as novas, na ordem da `GridLayout`.
 */

/** Uma linha da grade pela identidade: a lida pela posição dela no resultado, a nova pelo id (`NewRow.id`). */
export type RowRef = { kind: "read"; row: number } | { kind: "new"; id: number };

/** Uma célula pela identidade da linha e pela posição da coluna. */
export type CellRef = { row: RowRef; column: number };

/** Uma faixa de linhas lidas, da primeira à última, inclusive. */
export type RowRange = readonly [number, number];

/** Linhas da grade: as lidas em faixas (em ordem, separadas, sem se tocar) e as novas pelo id. */
export type RowSet = { read: readonly RowRange[]; added: readonly number[] };

/**
 * A forma da seleção: só a célula ativa (`cell`); um retângulo de células, nas linhas `rows` e nas colunas de `from` a `to` (`cells`); linhas inteiras
 * (`rows`); ou colunas inteiras (`columns`: as posições delas no resultado, em ordem e sem repetir, com todas as linhas do resultado, RN-GRADE-022). Um
 * retângulo é sempre um retângulo, também quando cobre todas as colunas ou todas as linhas: só o número da linha, o canto, o Shift+Espaço e o Ctrl+A escolhem
 * linhas inteiras (o Delete age nas linhas de qualquer célula escolhida, menos colunas inteiras, RN-EDIT-015); só o nome da coluna, no cabeçalho, e o
 * Ctrl+Espaço escolhem colunas inteiras.
 */
export type SelectionShape = { kind: "cell" } | { kind: "cells"; rows: RowSet; from: number; to: number } | { kind: "rows"; rows: RowSet } | { kind: "columns"; columns: readonly number[] };

/**
 * A seleção: a célula ativa (a do foco, que a grade anuncia), a âncora (a célula clicada ou, depois do clique no número da linha, a ativa que ele deixa: de
 * onde o Shift estende) e a forma. A célula ativa está sempre dentro da seleção, menos depois do Ctrl+clique que tira a linha dela.
 */
export type GridSelection = { active: CellRef | null; anchor: CellRef | null; shape: SelectionShape };

/** A grade agora: quantas linhas lidas, os ids das linhas novas na ordem da grade (depois das lidas) e quantas colunas. */
export type GridLayout = { read: number; added: readonly number[]; columns: number };

/** O resultado que acabou de chegar: sem célula ativa e sem seleção. */
export const emptySelection: GridSelection = { active: null, anchor: null, shape: { kind: "cell" } };

const noRows: RowSet = { read: [], added: [] };

/** A linha da posição `row` da grade, ou nula fora dela. */
export function refAt(layout: GridLayout, row: number): RowRef | null {
  if (!Number.isInteger(row) || row < 0) return null;
  if (row < layout.read) return { kind: "read", row };
  const id = layout.added[row - layout.read];
  return id === undefined ? null : { kind: "new", id };
}

/** A posição da linha na grade agora, ou nula quando ela não está mais lá (a linha nova tirada, a lida que saiu). */
export function positionOf(layout: GridLayout, ref: RowRef): number | null {
  if (ref.kind === "read") return ref.row < layout.read ? ref.row : null;
  const index = layout.added.indexOf(ref.id);
  return index < 0 ? null : layout.read + index;
}

/** A célula da grade agora, ou nula quando a linha dela saiu ou a coluna não existe. */
export function cellAt(layout: GridLayout, cell: CellRef | null): GridCell | null {
  if (cell === null || cell.column < 0 || cell.column >= layout.columns) return null;
  const row = positionOf(layout, cell.row);
  return row === null ? null : { row, column: cell.column };
}

function refOfCell(layout: GridLayout, cell: GridCell): CellRef | null {
  const row = refAt(layout, cell.row);
  return row === null || cell.column < 0 || cell.column >= layout.columns ? null : { row, column: cell.column };
}

/** As faixas em ordem, juntando as que se sobrepõem ou se tocam. */
function merged(ranges: readonly RowRange[]): RowRange[] {
  const sorted = [...ranges].sort((left, right) => left[0] - right[0]);
  const out: [number, number][] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last !== undefined && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** As linhas da grade de uma posição a outra (em qualquer ordem), pela identidade. */
export function rowsBetween(layout: GridLayout, a: number, b: number): RowSet {
  const from = Math.max(Math.min(a, b), 0);
  const to = Math.min(Math.max(a, b), layout.read + layout.added.length - 1);
  if (to < from) return noRows;
  const read: RowRange[] = from < layout.read ? [[from, Math.min(to, layout.read - 1)]] : [];
  const added = to >= layout.read ? layout.added.slice(Math.max(from, layout.read) - layout.read, to - layout.read + 1) : [];
  return { read, added };
}

/** A faixa que tem a linha lida `row`, pela busca binária. */
function rangeIndexOf(ranges: readonly RowRange[], row: number): number {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [from, to] = ranges[middle];
    if (row < from) high = middle - 1;
    else if (row > to) low = middle + 1;
    else return middle;
  }
  return -1;
}

/** A linha está no conjunto? */
export function hasRow(rows: RowSet, ref: RowRef): boolean {
  return ref.kind === "read" ? rangeIndexOf(rows.read, ref.row) >= 0 : rows.added.includes(ref.id);
}

function isEmpty(rows: RowSet): boolean {
  return rows.read.length === 0 && rows.added.length === 0;
}

function union(left: RowSet, right: RowSet): RowSet {
  return { read: merged([...left.read, ...right.read]), added: [...left.added, ...right.added.filter((id) => !left.added.includes(id))] };
}

/** O conjunto com a linha, ou sem ela, quando já estava (o Ctrl+clique no número). */
function toggled(rows: RowSet, ref: RowRef): RowSet {
  if (ref.kind === "new") return { read: rows.read, added: rows.added.includes(ref.id) ? rows.added.filter((id) => id !== ref.id) : [...rows.added, ref.id] };

  const index = rangeIndexOf(rows.read, ref.row);
  if (index < 0) return { read: merged([...rows.read, [ref.row, ref.row]]), added: rows.added };
  const [from, to] = rows.read[index];
  const pieces: RowRange[] = [...(from < ref.row ? [[from, ref.row - 1] as const] : []), ...(ref.row < to ? [[ref.row + 1, to] as const] : [])];
  return { read: [...rows.read.slice(0, index), ...pieces, ...rows.read.slice(index + 1)], added: rows.added };
}

function rowSetOf(ref: RowRef): RowSet {
  return ref.kind === "read" ? { read: [[ref.row, ref.row]], added: [] } : { read: [], added: [ref.id] };
}

/** Todas as linhas da grade agora, as lidas e as novas: as das colunas inteiras, contadas na hora, e não guardadas. */
function allRowsOf(layout: GridLayout): RowSet {
  return { read: layout.read > 0 ? [[0, layout.read - 1]] : [], added: [...layout.added] };
}

/** As linhas da seleção pela identidade (as que têm uma célula escolhida); só a célula ativa, a linha dela; com colunas inteiras, todas as da grade agora. */
function rowSetOfSelection(selection: GridSelection, layout: GridLayout): RowSet {
  if (selection.shape.kind === "columns") return allRowsOf(layout);
  if (selection.shape.kind !== "cell") return selection.shape.rows;
  return selection.active === null ? noRows : rowSetOf(selection.active.row);
}

/** As colunas de uma a outra (em qualquer ordem), como a lista em ordem das colunas inteiras. */
function columnsBetween(a: number, b: number): number[] {
  const from = Math.min(a, b);
  return Array.from({ length: Math.abs(a - b) + 1 }, (_, index) => from + index);
}

/** A lista das colunas inteiras em ordem e sem repetir. */
const sortedColumns = (columns: Iterable<number>): number[] => [...new Set(columns)].sort((left, right) => left - right);

/**
 * A célula ativa de um gesto nas colunas inteiras (RN-GRADE-022): na coluna dada, na linha em que a ativa estava (na primeira linha da grade, quando não havia
 * célula ativa, ou quando a linha dela saiu); sem linha nenhuma na grade, não há célula ativa.
 */
function activeInColumn(selection: GridSelection, layout: GridLayout, column: number): CellRef | null {
  if (layout.read + layout.added.length === 0) return null;
  const row = selection.active !== null && positionOf(layout, selection.active.row) !== null ? selection.active.row : refAt(layout, 0)!;
  return { row, column };
}

const validColumn = (layout: GridLayout, column: number) => Number.isInteger(column) && column >= 0 && column < layout.columns;

const columnOf = (selection: GridSelection) => selection.active?.column ?? 0;

// ——— Os gestos ———————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————

/** O clique numa célula (e as setas, Home, End, PageUp e PageDown sem Shift, e o Tab do campo): ela é a ativa, a âncora e a seleção. */
export function select(selection: GridSelection, cell: GridCell, layout: GridLayout): GridSelection {
  const ref = refOfCell(layout, cell);
  return ref === null ? selection : { active: ref, anchor: ref, shape: { kind: "cell" } };
}

/**
 * Shift+clique numa célula, o arraste a partir de uma célula e o Shift com as teclas fora das linhas inteiras: o retângulo da âncora até a célula, que passa
 * a ser a ativa. Sem âncora (ou com a linha dela fora da grade), é um clique.
 */
export function extend(selection: GridSelection, cell: GridCell, layout: GridLayout): GridSelection {
  const anchor = cellAt(layout, selection.anchor);
  const target = refOfCell(layout, cell);
  if (target === null) return selection;
  if (anchor === null) return select(selection, cell, layout);
  if (anchor.row === cell.row && anchor.column === cell.column) return { active: target, anchor: selection.anchor, shape: { kind: "cell" } };

  return { active: target, anchor: selection.anchor, shape: { kind: "cells", rows: rowsBetween(layout, anchor.row, cell.row), from: Math.min(anchor.column, cell.column), to: Math.max(anchor.column, cell.column) } };
}

/**
 * Shift com as teclas de movimento: com linhas inteiras escolhidas, as que andam na vertical estendem as linhas, da linha da âncora até a da célula ativa, e
 * as que andam na horizontal só movem a célula ativa; com colunas inteiras, o espelho (RN-GRADE-022): as que andam na horizontal estendem as colunas, da
 * coluna da âncora até a da célula ativa, e as que andam na vertical só movem a célula ativa; fora delas, o retângulo da âncora até a célula.
 */
export function extendByKey(selection: GridSelection, cell: GridCell, layout: GridLayout, vertical: boolean): GridSelection {
  if (selection.shape.kind === "columns") return extendColumnsByKey(selection, cell, layout, vertical);
  if (selection.shape.kind !== "rows") return extend(selection, cell, layout);
  const target = refOfCell(layout, cell);
  if (target === null) return selection;
  if (!vertical) return { ...selection, active: target };

  const anchor = cellAt(layout, selection.anchor);
  return { active: target, anchor: anchor === null ? target : selection.anchor, shape: { kind: "rows", rows: rowsBetween(layout, anchor?.row ?? cell.row, cell.row) } };
}

/**
 * O clique no número da linha: a linha inteira; a célula ativa vai para ela, na coluna em que estava (na primeira, sem célula ativa), e é a âncora. O
 * Ctrl+clique com um retângulo (ou só com a célula ativa) faz o mesmo.
 */
export function selectRow(selection: GridSelection, row: number, layout: GridLayout): GridSelection {
  const ref = refAt(layout, row);
  if (ref === null || layout.columns === 0) return selection;
  const active: CellRef = { row: ref, column: Math.min(columnOf(selection), layout.columns - 1) };
  return { active, anchor: active, shape: { kind: "rows", rows: rowSetOf(ref) } };
}

/** Shift+clique no número da linha: as linhas da linha da âncora até a clicada, e a célula ativa vai para ela; sem âncora, é o clique. */
export function extendRows(selection: GridSelection, row: number, layout: GridLayout): GridSelection {
  const anchor = cellAt(layout, selection.anchor);
  const ref = refAt(layout, row);
  if (ref === null) return selection;
  if (anchor === null) return selectRow(selection, row, layout);
  return { active: { row: ref, column: Math.min(columnOf(selection), layout.columns - 1) }, anchor: selection.anchor, shape: { kind: "rows", rows: rowsBetween(layout, anchor.row, row) } };
}

/**
 * Ctrl+clique (Cmd+clique no macOS) no número da linha: com linhas inteiras escolhidas, acrescenta a linha, ou a tira quando já estava; a célula ativa vai
 * para a linha clicada (e fica fora da seleção, quando ela saiu), e é a âncora. Tirada a última, a seleção volta a ser a célula ativa. Com um retângulo, ou só
 * com a célula ativa, é o clique: vários retângulos ficam para depois.
 */
export function toggleRow(selection: GridSelection, row: number, layout: GridLayout): GridSelection {
  if (selection.shape.kind !== "rows") return selectRow(selection, row, layout);
  const ref = refAt(layout, row);
  if (ref === null) return selection;
  const active: CellRef = { row: ref, column: Math.min(columnOf(selection), layout.columns - 1) };
  const rows = toggled(selection.shape.rows, ref);
  return { active, anchor: active, shape: isEmpty(rows) ? { kind: "cell" } : { kind: "rows", rows } };
}

/**
 * O arraste no número da linha: as linhas da do começo (`start`, a âncora) até a que está sob o ponteiro (`row`, a da célula ativa). Com Ctrl (Cmd) no
 * começo do arraste (`adding`), elas se juntam às linhas inteiras que já estavam em `base`, a seleção de antes do arraste.
 */
export function dragRows(base: GridSelection, start: number, row: number, layout: GridLayout, adding: boolean): GridSelection {
  const from = refAt(layout, start);
  const to = refAt(layout, row);
  if (from === null || to === null || layout.columns === 0) return base;
  const column = Math.min(columnOf(base), layout.columns - 1);
  const range = rowsBetween(layout, start, row);
  return { active: { row: to, column }, anchor: { row: from, column }, shape: { kind: "rows", rows: adding && base.shape.kind === "rows" ? union(base.shape.rows, range) : range } };
}

/**
 * Ctrl+A (Cmd+A) e o clique no canto da grade: todas as linhas da grade, as lidas e as novas, inteiras. Sem célula ativa, a primeira célula passa a ser a
 * ativa (e a âncora).
 */
export function selectAll(selection: GridSelection, layout: GridLayout): GridSelection {
  const total = layout.read + layout.added.length;
  if (total === 0 || layout.columns === 0) return selection;
  const first = refAt(layout, 0)!;
  const active = cellAt(layout, selection.active) === null ? { row: first, column: 0 } : selection.active!;
  const anchor = cellAt(layout, selection.anchor) === null ? active : selection.anchor!;
  return { active, anchor, shape: { kind: "rows", rows: { read: layout.read > 0 ? [[0, layout.read - 1]] : [], added: [...layout.added] } } };
}

/**
 * Esc, e o que desfaz a seleção (o "Salvar" e o "Descartar" que tiram linhas, o "Excluir linhas" que tira linhas novas): fica só a célula ativa, que volta a
 * ser a âncora.
 */
export function collapse(selection: GridSelection): GridSelection {
  return selection.shape.kind === "cell" && selection.anchor === selection.active ? selection : { active: selection.active, anchor: selection.active, shape: { kind: "cell" } };
}

/**
 * Shift+Espaço: as linhas inteiras das células escolhidas, como o "Selecionar linha(s)" do DBeaver; é o caminho do teclado até as linhas inteiras
 * (RN-EDIT-014 e 015). Com colunas inteiras, a linha inteira da célula ativa (RN-GRADE-022): as colunas não viram todas as linhas.
 */
export function wholeRows(selection: GridSelection): GridSelection {
  if (selection.shape.kind === "rows") return selection;
  if (selection.shape.kind === "columns") return selection.active === null ? selection : { ...selection, shape: { kind: "rows", rows: rowSetOf(selection.active.row) } };
  const rows = selection.shape.kind === "cells" ? selection.shape.rows : selection.active === null ? noRows : rowSetOf(selection.active.row);
  return isEmpty(rows) ? selection : { ...selection, shape: { kind: "rows", rows } };
}

/**
 * O botão direito numa célula: fora da seleção, ela é escolhida antes, como um clique; dentro, a seleção fica, e ela passa a ser a ativa. O menu abre depois
 * (RN-GRADE-004).
 */
export function contextCell(selection: GridSelection, cell: GridCell, layout: GridLayout): GridSelection {
  const ref = refOfCell(layout, cell);
  if (ref === null) return selection;
  return isSelected(selection, layout, cell) ? { ...selection, active: ref } : select(selection, cell, layout);
}

/**
 * O botão direito no número da linha: fora da seleção, escolhe a linha inteira; dentro dela (a linha tem uma célula escolhida), deixa a seleção como está. Com
 * colunas inteiras, toda linha tem uma célula escolhida, e as colunas ficam (RN-GRADE-001 e 022), embora o número não esteja destacado.
 */
export function contextRow(selection: GridSelection, row: number, layout: GridLayout): GridSelection {
  const ref = refAt(layout, row);
  if (ref === null) return selection;
  return hasRow(rowSetOfSelection(selection, layout), ref) ? selection : selectRow(selection, row, layout);
}

/**
 * As linhas novas como linhas inteiras, com a célula ativa na primeira, na coluna dada: a seleção depois do "Duplicar linhas", que é das cópias
 * (RN-EDIT-014).
 */
export function selectNewRows(ids: readonly number[], column: number): GridSelection {
  if (ids.length === 0) return emptySelection;
  const active: CellRef = { row: { kind: "new", id: ids[0] }, column };
  return { active, anchor: active, shape: { kind: "rows", rows: { read: [], added: [...ids] } } };
}

/**
 * A seleção depois de um "Salvar" que gravou tudo e deixou a grade com o que foi salvo, sem executar de novo (a aba de consulta, RN-EDIT-009): as excluídas
 * saíram (as de depois sobem), e as novas viraram linhas lidas no fim, na ordem delas. Fica só a célula ativa, quando a linha dela continua na grade. As
 * colunas inteiras ficam (RN-GRADE-022), com a célula ativa na linha dela, ou na primeira, quando a dela saiu.
 */
export function afterSave(selection: GridSelection, { deleted, read, added }: { deleted: readonly number[]; read: number; added: readonly number[] }): GridSelection {
  const active = selection.active;
  if (selection.shape.kind === "columns") {
    const moved = active === null ? emptySelection : afterSave({ ...selection, shape: { kind: "cell" } }, { deleted, read, added });
    const total = read - new Set(deleted).size + added.length;
    const cell = moved.active ?? (total > 0 && active !== null ? { row: { kind: "read" as const, row: 0 }, column: active.column } : null);
    return { active: cell, anchor: cell, shape: selection.shape };
  }
  if (active === null) return emptySelection;
  const gone = [...new Set(deleted)];
  const before = (row: number) => gone.filter((deletedRow) => deletedRow < row).length;
  let row: number | null;
  if (active.row.kind === "read") row = gone.includes(active.row.row) ? null : active.row.row - before(active.row.row);
  else {
    const index = added.indexOf(active.row.id);
    row = index < 0 ? null : read - before(read) + index;
  }
  if (row === null) return emptySelection;
  const cell: CellRef = { row: { kind: "read", row }, column: active.column };
  return { active: cell, anchor: cell, shape: { kind: "cell" } };
}

/**
 * RN-GRADE-022: o clique no nome da coluna, no cabeçalho: a coluna inteira, com todas as linhas do resultado. A célula ativa vai para ela, na linha em que
 * estava (na primeira, sem célula ativa; sem linha nenhuma, não há célula ativa), e é a âncora. O Ctrl+clique com um retângulo ou com linhas inteiras faz o
 * mesmo: as formas não se misturam.
 */
export function selectColumn(selection: GridSelection, column: number, layout: GridLayout): GridSelection {
  if (!validColumn(layout, column)) return selection;
  const active = activeInColumn(selection, layout, column);
  return { active, anchor: active, shape: { kind: "columns", columns: [column] } };
}

/**
 * Shift+clique no nome da coluna: as colunas da coluna da âncora até a clicada, na ordem da grade, e a célula ativa vai para a clicada, na mesma linha; sem
 * âncora (ou com a linha dela fora da grade), é o clique.
 */
export function extendColumns(selection: GridSelection, column: number, layout: GridLayout): GridSelection {
  if (!validColumn(layout, column)) return selection;
  const anchor = cellAt(layout, selection.anchor);
  if (anchor === null) return selectColumn(selection, column, layout);
  return { active: activeInColumn(selection, layout, column), anchor: selection.anchor, shape: { kind: "columns", columns: columnsBetween(anchor.column, column) } };
}

/**
 * Ctrl+clique (Cmd+clique no macOS) no nome da coluna: com colunas inteiras escolhidas, acrescenta a coluna, ou a tira quando já estava; a célula ativa vai
 * para a clicada, e é a âncora. Tirada a última, a seleção volta a ser a célula ativa. Com outra forma, é o clique.
 */
export function toggleColumn(selection: GridSelection, column: number, layout: GridLayout): GridSelection {
  if (selection.shape.kind !== "columns") return selectColumn(selection, column, layout);
  if (!validColumn(layout, column)) return selection;
  const chosen = selection.shape.columns;
  const columns = chosen.includes(column) ? chosen.filter((at) => at !== column) : sortedColumns([...chosen, column]);
  const active = activeInColumn(selection, layout, column);
  return { active, anchor: active, shape: columns.length === 0 ? { kind: "cell" } : { kind: "columns", columns } };
}

/**
 * O arraste a partir do nome da coluna: as colunas da do começo (`start`, a da âncora) até a que está sob o ponteiro (`column`, a da célula ativa). Com Ctrl
 * (Cmd) no começo do arraste (`adding`), elas se juntam às colunas inteiras que já estavam em `base`, a seleção de antes do arraste.
 */
export function dragColumns(base: GridSelection, start: number, column: number, layout: GridLayout, adding: boolean): GridSelection {
  if (!validColumn(layout, start) || !validColumn(layout, column)) return base;
  const range = columnsBetween(start, column);
  const columns = adding && base.shape.kind === "columns" ? sortedColumns([...base.shape.columns, ...range]) : range;
  return { active: activeInColumn(base, layout, column), anchor: activeInColumn(base, layout, start), shape: { kind: "columns", columns } };
}

/**
 * Ctrl+Espaço (Control+Espaço no macOS): as colunas inteiras das células escolhidas, como o Excel: as colunas do retângulo, ou a da célula ativa sozinha; com
 * linhas inteiras escolhidas, a coluna da célula ativa. A célula ativa e a âncora ficam onde estavam. Sem célula ativa, nada.
 */
export function wholeColumns(selection: GridSelection, layout: GridLayout): GridSelection {
  if (selection.shape.kind === "columns") return selection;
  if (selection.shape.kind === "cells") {
    const from = Math.max(selection.shape.from, 0);
    const to = Math.min(selection.shape.to, layout.columns - 1);
    return to < from ? selection : { ...selection, shape: { kind: "columns", columns: columnsBetween(from, to) } };
  }
  const active = activeCell(selection, layout);
  return active === null ? selection : { ...selection, shape: { kind: "columns", columns: [active.column] } };
}

/**
 * O botão direito no nome da coluna (RN-GRADE-021): fora das colunas inteiras escolhidas (também dentro de um retângulo ou de linhas inteiras), escolhe antes a
 * coluna inteira; entre elas, a seleção fica. Nos dois casos a célula ativa vai para aquela coluna, na linha em que estava (na primeira, quando não havia), e o
 * menu da grade abre sobre ela.
 */
export function contextColumn(selection: GridSelection, column: number, layout: GridLayout): GridSelection {
  if (selection.shape.kind !== "columns" || !selection.shape.columns.includes(column)) return selectColumn(selection, column, layout);
  return { ...selection, active: activeInColumn(selection, layout, column) };
}

/**
 * O "Descartar" e o "Excluir linhas" que tiram linhas novas da grade (RN-GRADE-001): fica só a célula ativa, como no `collapse`; com colunas inteiras, elas
 * ficam (RN-GRADE-022), com as linhas que ficaram, e a célula ativa que estava numa linha tirada vai para a primeira linha da grade.
 */
export function afterRowsRemoved(selection: GridSelection, layout: GridLayout): GridSelection {
  if (selection.shape.kind !== "columns") return collapse(selection);
  if (selection.active === null || cellAt(layout, selection.active) !== null) return selection;
  const active = activeInColumn(selection, layout, selection.active.column);
  return { active, anchor: active, shape: selection.shape };
}

/** Shift com as teclas, com colunas inteiras: a horizontal estende as colunas, da coluna da âncora até a da célula ativa; a vertical só move a ativa. */
function extendColumnsByKey(selection: GridSelection, cell: GridCell, layout: GridLayout, vertical: boolean): GridSelection {
  const target = refOfCell(layout, cell);
  if (target === null) return selection;
  if (vertical) return { ...selection, active: target };
  const anchor = cellAt(layout, selection.anchor);
  return { active: target, anchor: anchor === null ? target : selection.anchor, shape: { kind: "columns", columns: columnsBetween(anchor?.column ?? cell.column, cell.column) } };
}

// ——— As perguntas ————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————

/** A célula ativa na grade agora, ou nula (sem célula ativa, ou com a linha dela fora da grade). */
export function activeCell(selection: GridSelection, layout: GridLayout): GridCell | null {
  return cellAt(layout, selection.active);
}

/**
 * As colunas da seleção, de uma a outra, quando são seguidas: as do retângulo, todas com linhas inteiras, a da célula ativa; nula sem nada escolhido. Com
 * colunas inteiras, que podem não ser seguidas, é nula: quem desenha pergunta `wholeColumnSet`, e quem age, `selectedColumns`.
 */
export function columnSpan(selection: GridSelection, layout: GridLayout): RowRange | null {
  if (layout.columns === 0) return null;
  if (selection.shape.kind === "columns") return null;
  if (selection.shape.kind === "rows") return [0, layout.columns - 1];
  if (selection.shape.kind === "cells") return [Math.max(selection.shape.from, 0), Math.min(selection.shape.to, layout.columns - 1)];
  const active = activeCell(selection, layout);
  return active === null ? null : [active.column, active.column];
}

/** As colunas inteiras escolhidas (RN-GRADE-022), na ordem da grade, só as que a grade tem; nula com outra forma. */
export function chosenWholeColumns(selection: GridSelection, layout: GridLayout): readonly number[] | null {
  return selection.shape.kind === "columns" ? selection.shape.columns.filter((column) => column < layout.columns) : null;
}

/** RN-GRADE-022: a seleção é de colunas inteiras (o nome da coluna, o Ctrl+Espaço): vale para todas as linhas do resultado, também as não carregadas. */
export function choseWholeColumns(selection: GridSelection): boolean {
  return selection.shape.kind === "columns";
}

/**
 * As colunas inteiras escolhidas como um conjunto, que quem chama memoriza pela seleção: a grade passa o mesmo objeto a cada linha à vista, e a linha
 * memorizada não é redesenhada por ele. Nula com outra forma.
 */
export function wholeColumnSet(selection: GridSelection, layout: GridLayout): ReadonlySet<number> | null {
  const columns = chosenWholeColumns(selection, layout);
  return columns === null ? null : new Set(columns);
}

/** O cabeçalho da coluna fica destacado (RN-GRADE-001 e 022): a coluna está na seleção (com colunas inteiras, entre as escolhidas). */
export function headerChosen(selection: GridSelection, layout: GridLayout, column: number): boolean {
  if (selection.shape.kind === "columns") return selection.shape.columns.includes(column);
  const span = columnSpan(selection, layout);
  return span !== null && column >= span[0] && column <= span[1];
}

/**
 * As colunas escolhidas na linha da posição `row`, de uma a outra, ou nula quando a linha não tem célula escolhida. É o que a grade desenha em cada linha à
 * vista, a cada renderização: uma busca binária nas faixas, e nada célula por célula. Com colunas inteiras é nula (as colunas podem não ser seguidas, e o
 * número da linha não fica destacado): a grade desenha por `wholeColumnSet`.
 */
export function rowSpan(selection: GridSelection, layout: GridLayout, row: number): RowRange | null {
  const ref = refAt(layout, row);
  if (ref === null) return null;
  if (selection.shape.kind === "columns") return null;
  if (selection.shape.kind === "cell") {
    const active = activeCell(selection, layout);
    return active !== null && active.row === row ? [active.column, active.column] : null;
  }
  return hasRow(selection.shape.rows, ref) ? columnSpan(selection, layout) : null;
}

/** A célula está escolhida? */
export function isSelected(selection: GridSelection, layout: GridLayout, cell: GridCell): boolean {
  if (selection.shape.kind === "columns") return refAt(layout, cell.row) !== null && selection.shape.columns.includes(cell.column) && cell.column < layout.columns;
  const span = rowSpan(selection, layout, cell.row);
  return span !== null && cell.column >= span[0] && cell.column <= span[1];
}

/**
 * As linhas da seleção (as que têm uma célula escolhida), pela posição na grade agora, em ordem; sem nada escolhido além da célula ativa, a linha dela; com
 * colunas inteiras, todas as linhas da grade agora (as que faltam carregar não estão aqui: quem precisa delas as carrega antes, RN-GRADE-023). É sobre elas
 * que agem o copiar, o "Gerar SQL", "Duplicar linhas", "Excluir linhas" e "Copiar número de linha(s)".
 */
export function selectedRows(selection: GridSelection, layout: GridLayout): number[] {
  const rows = rowSetOfSelection(selection, layout);
  const out: number[] = [];
  for (const [from, to] of rows.read) for (let row = from; row <= Math.min(to, layout.read - 1); row += 1) out.push(row);
  if (rows.added.length > 0) {
    const chosen = new Set(rows.added);
    layout.added.forEach((id, index) => {
      if (chosen.has(id)) out.push(layout.read + index);
    });
  }
  return out;
}

/** As colunas da seleção, em ordem: as do retângulo, todas com linhas inteiras, as colunas inteiras escolhidas, a da célula ativa. */
export function selectedColumns(selection: GridSelection, layout: GridLayout): number[] {
  const whole = chosenWholeColumns(selection, layout);
  if (whole !== null) return [...whole];
  const span = columnSpan(selection, layout);
  return span === null ? [] : Array.from({ length: span[1] - span[0] + 1 }, (_, index) => span[0] + index);
}

/** As células escolhidas, linha a linha, na ordem da grade; um gerador, para a seleção grande não virar uma lista de células. */
export function* selectedCells(selection: GridSelection, layout: GridLayout): Generator<GridCell> {
  const columns = selectedColumns(selection, layout);
  if (columns.length === 0) return;
  for (const row of selectedRows(selection, layout)) for (const column of columns) yield { row, column };
}

/**
 * Quantas linhas e quantas células a seleção tem agora, e se são linhas inteiras (a contagem da barra do resultado); `columns` é quantas colunas inteiras
 * (zero com outra forma): com elas, as linhas e as células são as que a grade tem agora, e a contagem da barra é outra (RN-GRADE-022).
 */
export function selectionSize(selection: GridSelection, layout: GridLayout): { rows: number; cells: number; whole: boolean; columns: number } {
  if (selection.shape.kind === "columns") {
    const rows = layout.read + layout.added.length;
    const columns = chosenWholeColumns(selection, layout)!.length;
    return { rows, cells: rows * columns, whole: false, columns };
  }
  const rows = rowSetOfSelection(selection, layout);
  let count = 0;
  for (const [from, to] of rows.read) count += Math.max(Math.min(to, layout.read - 1) - from + 1, 0);
  if (rows.added.length > 0) {
    const present = new Set(layout.added);
    count += rows.added.filter((id) => present.has(id)).length;
  }
  const span = columnSpan(selection, layout);
  const width = span === null ? 0 : span[1] - span[0] + 1;
  return { rows: count, cells: count * width, whole: selection.shape.kind === "rows", columns: 0 };
}

/**
 * Mais de uma célula escolhida: a contagem aparece, a atualização automática espera (RN-GRADE-014), e "Colar" não vale. As colunas inteiras contam sempre como
 * várias, também num resultado de uma linha só (RN-GRADE-022): a escolha é de todas as linhas do resultado.
 */
export function hasSeveralCells(selection: GridSelection, layout: GridLayout): boolean {
  return selection.shape.kind === "columns" || selectionSize(selection, layout).cells > 1;
}

/**
 * RN-GRADE-001: o Esc volta a seleção para a célula ativa só, e é da grade sempre que ela não é só a célula ativa: também a linha inteira de uma coluna só
 * (uma célula, mas linhas inteiras) e as colunas inteiras. Com a célula ativa só, o Esc segue para quem está acima da
 * grade.
 */
export function escapeCollapses(selection: GridSelection): boolean {
  return selection.shape.kind !== "cell";
}

/**
 * RN-EDIT-015: as linhas sobre as quais o Delete sozinho age, as mesmas do Alt+Delete (`selectedRows`): a da célula ativa, as do retângulo, as linhas
 * inteiras escolhidas. Com colunas inteiras escolhidas (RN-GRADE-022), ou sem nada escolhido, nenhuma: a tecla não faz nada.
 */
export function deleteKeyRows(selection: GridSelection, layout: GridLayout): number[] {
  return selection.shape.kind === "columns" ? [] : selectedRows(selection, layout);
}

/**
 * O que a seleção escolhe numa coluna (RN-EDIT-017 e 018, para a edição de várias células): as linhas da grade agora cujas células daquela coluna estão
 * escolhidas, pela posição (as lidas e as novas, em ordem), e se a escolha é a coluna inteira (`allRows`: vale também para as linhas que o cursor ainda não
 * leu, e para as que chegarem; as lidas que estão em `rows` são só as carregadas). Nula quando a coluna não tem célula escolhida.
 */
export type ColumnChoice = { column: number; rows: readonly number[]; allRows: boolean };

export function columnChoice(selection: GridSelection, layout: GridLayout, column: number): ColumnChoice | null {
  if (!validColumn(layout, column)) return null;
  if (selection.shape.kind === "columns") return selection.shape.columns.includes(column) ? { column, rows: selectedRows(selection, layout), allRows: true } : null;
  if (!selectedColumns(selection, layout).includes(column)) return null;
  const rows = selectedRows(selection, layout);
  return rows.length === 0 ? null : { column, rows, allRows: false };
}

/**
 * A escolha da coluna da célula ativa, quando a célula ativa está dentro da seleção (RN-EDIT-017: é ela que diz se a edição vale para várias); nula sem célula
 * ativa ou com ela fora da seleção (depois do Ctrl+clique que tirou a linha dela), e a edição é só dela.
 */
export function activeColumnChoice(selection: GridSelection, layout: GridLayout): ColumnChoice | null {
  const active = activeCell(selection, layout);
  if (active === null || !isSelected(selection, layout, active)) return null;
  return columnChoice(selection, layout, active.column);
}

// ——— O recorte ———————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————

/** O que copiar (RN-GRADE-003): as células escolhidas; as linhas inteiras da seleção; ou todas as linhas carregadas, com todas as colunas. */
export type SliceScope = "cells" | "rows" | "loaded";

/** O que a grade mostra, pela posição na grade agora: quem monta é `use-record-edits.ts`, com as pendências. */
export type SliceSource = {
  columns: readonly QueryColumn[];
  /** O texto que a célula mostra: a pendência, quando há; a linha nova com o que foi preenchido nela (o resto nulo); a excluída com o lido. */
  valueAt: (row: number, column: number) => string | null;
  /** A célula chegou cortada (RN-SQL-011). */
  truncatedAt: (row: number, column: number) => boolean;
  /** A célula é "gerado pelo banco — execute de novo para ver" (RN-EDIT-009): a grade a deixa vazia sem ser um valor. */
  generatedAt: (row: number, column: number) => boolean;
};

/**
 * O recorte de uma seleção: o `GridSlice` dos formatos (`grid-export`), com o que eles precisam saber a mais da grade. `positions` e `columnIndexes` levam
 * cada linha e cada coluna do recorte de volta à grade (o valor completo das cortadas é pedido por elas, RN-SQL-017); `newRows` são as linhas novas ainda
 * não salvas, pelo índice no recorte (não têm número na grade, e o "Copiar como SQL" as deixa de fora, RN-GRADE-016); `generated` são as células "gerado pelo
 * banco", como [linha, coluna] dentro do recorte (os formatos de dados as escrevem como o nulo). O número da linha (`rowNumbers`) é o da grade, de 1 em
 * diante; o da linha nova é a posição dela, que a grade não mostra.
 */
export type SelectionSlice = GridSlice & {
  positions: readonly number[];
  columnIndexes: readonly number[];
  newRows: readonly number[];
  generated: readonly (readonly [number, number])[];
};

/**
 * O recorte da seleção, com os valores que a grade mostra. Sem nada escolhido (sem célula ativa), um recorte sem linhas. A célula cortada vem com o que a
 * grade tem dela e a marca em `truncated`: quem copia passa antes pelo valor completo (`completeSlice`, com o que `completeValues` achou).
 */
export function sliceOf(selection: GridSelection, layout: GridLayout, source: SliceSource, scope: SliceScope = "cells"): SelectionSlice {
  const positions = scope === "loaded" ? Array.from({ length: layout.read + layout.added.length }, (_, index) => index) : selectedRows(selection, layout);
  const columnIndexes = scope === "cells" ? selectedColumns(selection, layout) : Array.from({ length: layout.columns }, (_, index) => index);
  const rows: (string | null)[][] = [];
  const truncated: [number, number][] = [];
  const generated: [number, number][] = [];
  const newRows: number[] = [];

  positions.forEach((row, index) => {
    if (row >= layout.read) newRows.push(index);
    rows.push(
      columnIndexes.map((column, at) => {
        if (source.truncatedAt(row, column)) truncated.push([index, at]);
        if (source.generatedAt(row, column)) {
          generated.push([index, at]);
          return null;
        }
        return source.valueAt(row, column);
      }),
    );
  });

  return { columns: columnIndexes.map((column) => source.columns[column]), rows, truncated, rowNumbers: positions.map((row) => row + 1), positions, columnIndexes, newRows, generated };
}
