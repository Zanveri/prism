import type { QueryColumn } from "../query.schema";

/**
 * O recorte da grade que a tela monta da seleção (RN-GRADE-002 a 007) e que todo formato de exportação e todo gerador de SQL deste
 * módulo recebe. É dado puro: nenhuma função daqui lê a tela, o relógio ou a rede.
 */
export type GridSlice = {
  columns: readonly QueryColumn[];
  rows: readonly (readonly (string | null)[])[];
  /** As células que a API cortou (RN-SQL-011), como [linha, coluna] DENTRO deste recorte. */
  truncated: readonly (readonly [number, number])[];
  /** O número de cada linha na grade (1 é a primeira carregada), para a opção "número da linha". */
  rowNumbers: readonly number[];
};

/** A pergunta "a célula [linha, coluna] do recorte chegou cortada?", respondida em tempo constante. */
export function truncatedIn(slice: GridSlice): (row: number, column: number) => boolean {
  const cut = new Set(slice.truncated.map(([row, column]) => `${row}:${column}`));
  return (row, column) => cut.has(`${row}:${column}`);
}

/** O número da linha `index` do recorte na grade; sem `rowNumbers` para ela, a posição dentro do recorte (de 1 em diante). */
export function rowNumberOf(slice: GridSlice, index: number): number {
  return slice.rowNumbers[index] ?? index + 1;
}
