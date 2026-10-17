import type { GridCell } from "./grid-cursor";
import type { GridSlice } from "./grid-export/grid-slice";
import type { QueryColumn } from "./query.schema";

/**
 * A seleção da grade (RN-GRADE-001), sem React e sem DOM: o modelo, o que cada gesto faz com ele e as perguntas que a grade, o copiar, as ações de linha, o
 * "Copiar avançado" e o "Gerar SQL" fazem a ele. Quem guarda o estado é `use-record-edits.ts`; quem desenha é `result-grid.tsx`.
 *
 * - A grade tem uma célula ativa e uma seleção, de uma de duas formas: um retângulo de células, da âncora até a célula ativa (`cells`), ou linhas inteiras,
 *   seguidas ou não (`rows`). Sem nada escolhido além da célula ativa, a seleção é ela (`cell`).
 * - As linhas são guardadas pela identidade, e não pelo lugar na grade: as lidas pela posição no resultado, em faixas, e as novas pelo id da linha nova
 *   (`NewRow.id`), uma a uma. O "carregar mais" põe as lidas que chegam ANTES das novas e empurra as novas para baixo; guardadas assim, a âncora, a célula
 *   ativa e as linhas da seleção continuam nas mesmas linhas. As lidas que chegam depois de um Ctrl+A não entram nele (a faixa termina onde as lidas
 *   terminavam), e as novas que já estavam, sim.
 * - Nunca célula por célula: escolher 100 mil células (o Ctrl+A em 5.000 linhas de 20 colunas) é uma faixa e a lista das novas, e a pergunta "esta linha está
 *   escolhida?" é uma busca binária nas faixas.
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
 * A forma da seleção: só a célula ativa (`cell`); um retângulo de células, nas linhas `rows` e nas colunas de `from` a `to` (`cells`); ou linhas inteiras
 * (`rows`). Um retângulo é sempre um retângulo, também quando cobre todas as colunas: só o número da linha, o canto, o Shift+Espaço e o Ctrl+A escolhem
 * linhas inteiras, e só elas valem para o Delete (RN-EDIT-015).
 */
export type SelectionShape = { kind: "cell" } | { kind: "cells"; rows: RowSet; from: number; to: number } | { kind: "rows"; rows: RowSet };

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

/** As linhas da seleção pela identidade (as que têm uma célula escolhida); só a célula ativa, a linha dela. */
function rowSetOfSelection(selection: GridSelection): RowSet {
  if (selection.shape.kind !== "cell") return selection.shape.rows;
  return selection.active === null ? noRows : rowSetOf(selection.active.row);
}

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
 * as que andam na horizontal só movem a célula ativa; fora delas, o retângulo da âncora até a célula.
 */
export function extendByKey(selection: GridSelection, cell: GridCell, layout: GridLayout, vertical: boolean): GridSelection {
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

/** Shift+Espaço: as linhas inteiras das células escolhidas, como o "Selecionar linha(s)" do DBeaver; é o caminho do teclado até o Delete. */
export function wholeRows(selection: GridSelection): GridSelection {
  if (selection.shape.kind === "rows") return selection;
  const rows = rowSetOfSelection(selection);
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

/** O botão direito no número da linha: fora da seleção, escolhe a linha inteira; dentro dela (a linha tem uma célula escolhida), deixa a seleção como está. */
export function contextRow(selection: GridSelection, row: number, layout: GridLayout): GridSelection {
  const ref = refAt(layout, row);
  if (ref === null) return selection;
  return hasRow(rowSetOfSelection(selection), ref) ? selection : selectRow(selection, row, layout);
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
 * saíram (as de depois sobem), e as novas viraram linhas lidas no fim, na ordem delas. Fica só a célula ativa, quando a linha dela continua na grade.
 */
export function afterSave(selection: GridSelection, { deleted, read, added }: { deleted: readonly number[]; read: number; added: readonly number[] }): GridSelection {
  const active = selection.active;
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

// ——— As perguntas ————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————————

/** A célula ativa na grade agora, ou nula (sem célula ativa, ou com a linha dela fora da grade). */
export function activeCell(selection: GridSelection, layout: GridLayout): GridCell | null {
  return cellAt(layout, selection.active);
}

/** As colunas da seleção, de uma a outra: as do retângulo, todas com linhas inteiras, a da célula ativa; nula sem nada escolhido. */
export function columnSpan(selection: GridSelection, layout: GridLayout): RowRange | null {
  if (layout.columns === 0) return null;
  if (selection.shape.kind === "rows") return [0, layout.columns - 1];
  if (selection.shape.kind === "cells") return [Math.max(selection.shape.from, 0), Math.min(selection.shape.to, layout.columns - 1)];
  const active = activeCell(selection, layout);
  return active === null ? null : [active.column, active.column];
}

/**
 * As colunas escolhidas na linha da posição `row`, de uma a outra, ou nula quando a linha não tem célula escolhida. É o que a grade desenha em cada linha à
 * vista, a cada renderização: uma busca binária nas faixas, e nada célula por célula.
 */
export function rowSpan(selection: GridSelection, layout: GridLayout, row: number): RowRange | null {
  const ref = refAt(layout, row);
  if (ref === null) return null;
  if (selection.shape.kind === "cell") {
    const active = activeCell(selection, layout);
    return active !== null && active.row === row ? [active.column, active.column] : null;
  }
  return hasRow(selection.shape.rows, ref) ? columnSpan(selection, layout) : null;
}

/** A célula está escolhida? */
export function isSelected(selection: GridSelection, layout: GridLayout, cell: GridCell): boolean {
  const span = rowSpan(selection, layout, cell.row);
  return span !== null && cell.column >= span[0] && cell.column <= span[1];
}

/**
 * As linhas da seleção (as que têm uma célula escolhida), pela posição na grade agora, em ordem; sem nada escolhido além da célula ativa, a linha dela. É
 * sobre elas que agem o copiar, o "Gerar SQL", "Duplicar linhas", "Excluir linhas" e "Copiar número de linha(s)".
 */
export function selectedRows(selection: GridSelection, layout: GridLayout): number[] {
  const rows = rowSetOfSelection(selection);
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

/** As colunas da seleção, em ordem: as do retângulo, todas com linhas inteiras, a da célula ativa. */
export function selectedColumns(selection: GridSelection, layout: GridLayout): number[] {
  const span = columnSpan(selection, layout);
  return span === null ? [] : Array.from({ length: span[1] - span[0] + 1 }, (_, index) => span[0] + index);
}

/** As células escolhidas, linha a linha, na ordem da grade; um gerador, para a seleção grande não virar uma lista de células. */
export function* selectedCells(selection: GridSelection, layout: GridLayout): Generator<GridCell> {
  const span = columnSpan(selection, layout);
  if (span === null) return;
  for (const row of selectedRows(selection, layout)) for (let column = span[0]; column <= span[1]; column += 1) yield { row, column };
}

/** Quantas linhas e quantas células a seleção tem agora, e se são linhas inteiras (a contagem da barra do resultado). */
export function selectionSize(selection: GridSelection, layout: GridLayout): { rows: number; cells: number; whole: boolean } {
  const rows = rowSetOfSelection(selection);
  let count = 0;
  for (const [from, to] of rows.read) count += Math.max(Math.min(to, layout.read - 1) - from + 1, 0);
  if (rows.added.length > 0) {
    const present = new Set(layout.added);
    count += rows.added.filter((id) => present.has(id)).length;
  }
  const span = columnSpan(selection, layout);
  const width = span === null ? 0 : span[1] - span[0] + 1;
  return { rows: count, cells: count * width, whole: selection.shape.kind === "rows" };
}

/** Mais de uma célula escolhida: a contagem aparece, a atualização automática espera (RN-GRADE-014), e "Colar" e "Definir como nulo" não valem. */
export function hasSeveralCells(selection: GridSelection, layout: GridLayout): boolean {
  return selectionSize(selection, layout).cells > 1;
}

/**
 * RN-GRADE-001: o Esc volta a seleção para a célula ativa só, e é da grade sempre que ela não é só a célula ativa: também a linha inteira de uma coluna só
 * (uma célula, mas linhas inteiras, que o Delete excluiria, RN-EDIT-015). Com a célula ativa só, o Esc segue para quem está acima da grade.
 */
export function escapeCollapses(selection: GridSelection): boolean {
  return selection.shape.kind !== "cell";
}

/** Linhas inteiras escolhidas (pelo número da linha, pelo canto, pelo Shift+Espaço ou pelo Ctrl+A): só elas valem para o Delete sozinho (RN-EDIT-015). */
export function choseWholeRows(selection: GridSelection, layout: GridLayout): boolean {
  return selection.shape.kind === "rows" && selectionSize(selection, layout).rows > 0;
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
