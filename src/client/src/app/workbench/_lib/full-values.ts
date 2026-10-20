import type { QueryRow } from "./query.schema";
import type { CellMarks } from "./record-edits";

/**
 * RN-SQL-017: a grade mostra o valor cortado (RN-SQL-011), e copiar e exportar levam o completo, que a API guarda em memória e devolve por
 * `POST .../results/{resultID}/cells`. Aqui estão as decisões, sem React e sem `fetch`: que células da seleção pedir (só as cortadas, pela
 * linha do resultado na API), os lotes de até 10.000 e o que fica cortado quando o valor completo não veio. Quem chama a rota e mostra a
 * busca é `use-record-edits.ts`.
 */

/** As células que um pedido leva, no máximo: a API recusa acima disso (`CELLS_INVALID`). */
export const fullValuesBatch = 10_000;

/** Uma célula da grade, pela linha e pela coluna na tela. */
export type GridPosition = { row: number; column: number };

/** Uma célula cortada: a posição na grade e a linha no resultado inteiro da API (contando o "carregar mais"). */
export type CutCell = GridPosition & { resultRow: number };

/** Um lote: o valor completo de cada célula, na ordem pedida (nulo na que não tem), ou nulo quando o lote não veio (recusa, API fora do ar). */
export type FetchCells = (cells: { row: number; column: number }[], signal: AbortSignal) => Promise<(string | null)[] | null>;

/**
 * O que a busca achou, pela posição na grade, e quantas células cortadas ficaram sem o valor completo. `stopped`: quem pediu mandou parar entre um lote e
 * outro (o copiar, quando o texto já passa do limite da área de transferência, RN-GRADE-002), e o que não foi pedido conta como sem valor.
 */
export type FullValues = { valueOf: (row: number, column: number) => string | undefined; missing: number; stopped?: boolean };

/** Depois de cada lote: as células dele e o valor completo de cada uma (nulo na que não veio). Falso para de pedir. */
export type KeepGoing = (batch: readonly { cell: CutCell; value: string | null }[]) => boolean;

/** Nada a buscar: a seleção não tem célula cortada. */
export const noFullValues: FullValues = { valueOf: () => undefined, missing: 0 };

const keyOf = (row: number, column: number) => `${row}:${column}`;

/**
 * As células cortadas da seleção, sem repetir. A linha no resultado da API é a da grade, salvo depois de um Salvar da aba de consulta que tirou
 * linhas (`sourceRows`, RN-EDIT-009); a linha nova não tem célula cortada.
 */
export function cutCellsOf(cells: Iterable<GridPosition>, truncated: CellMarks, sourceRows?: readonly (number | null)[]): CutCell[] {
  const seen = new Set<string>();
  const cut: CutCell[] = [];
  for (const { row, column } of cells) {
    const key = keyOf(row, column);
    if (seen.has(key) || truncated.get(row)?.has(column) !== true) continue;
    seen.add(key);
    const resultRow = sourceRows === undefined ? row : sourceRows[row];
    if (resultRow !== null && resultRow !== undefined) cut.push({ row, column, resultRow });
  }
  return cut;
}

/** Todas as células cortadas das linhas lidas, para exportar o que está carregado. */
export function allCutCells(truncated: CellMarks): GridPosition[] {
  return [...truncated].flatMap(([row, columns]) => [...columns].map((column) => ({ row, column })));
}

/**
 * Pede os valores completos em lotes de até 10.000, um depois do outro. O lote que não veio deixa as células dele cortadas, e a contagem diz
 * quantas. Cancelado (`signal`), devolve nulo: quem pediu não copia nem grava nada. `keepGoing`, depois de cada lote, pode mandar parar (RN-SQL-017: o
 * copiar para de pedir quando o texto passa do limite da área de transferência).
 */
export async function fetchFullValues(cut: readonly CutCell[], fetchCells: FetchCells, signal: AbortSignal, keepGoing?: KeepGoing): Promise<FullValues | null> {
  if (cut.length === 0) return noFullValues;

  const found = new Map<string, string>();
  for (let start = 0; start < cut.length; start += fullValuesBatch) {
    if (signal.aborted) return null;
    const batch = cut.slice(start, start + fullValuesBatch);
    const values = await fetchCells(
      batch.map((cell) => ({ row: cell.resultRow, column: cell.column })),
      signal,
    );
    if (signal.aborted) return null;
    batch.forEach((cell, index) => {
      const value = values?.[index];
      if (typeof value === "string") found.set(keyOf(cell.row, cell.column), value);
    });
    if (keepGoing !== undefined && start + fullValuesBatch < cut.length && !keepGoing(batch.map((cell, index) => ({ cell, value: typeof values?.[index] === "string" ? values[index] : null })))) {
      return { valueOf: (row, column) => found.get(keyOf(row, column)), missing: cut.length - found.size, stopped: true };
    }
  }

  return { valueOf: (row, column) => found.get(keyOf(row, column)), missing: cut.length - found.size };
}

/**
 * As linhas com o valor completo no lugar do cortado, e as marcas de corte só das que ficaram sem: é o que exportar grava. As linhas sem célula
 * trocada são os mesmos objetos.
 */
export function withFullValues<T extends { rows: readonly QueryRow[]; truncated: CellMarks }>(result: T, full: FullValues): T {
  if (result.truncated.size === 0) return result;

  const rows = [...result.rows];
  const truncated = new Map<number, ReadonlySet<number>>();
  for (const [row, columns] of result.truncated) {
    const left = new Set<number>();
    for (const column of columns) {
      const value = full.valueOf(row, column);
      if (value === undefined) {
        left.add(column);
        continue;
      }
      if (rows[row] === result.rows[row]) rows[row] = [...result.rows[row]];
      rows[row][column] = value;
    }
    if (left.size > 0) truncated.set(row, left);
  }

  return { ...result, rows, truncated };
}
