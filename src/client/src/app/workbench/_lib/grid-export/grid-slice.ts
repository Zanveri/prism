import type { QueryColumn } from "../query.schema";

/**
 * O recorte da grade que a tela monta da seleção (RN-GRADE-002 a 007) e que todo formato de exportação e todo gerador de SQL deste
 * módulo recebe. É dado puro: nenhuma função daqui lê a tela, o relógio ou a rede. RN-SQL-017: quem monta o recorte para copiar ou
 * exportar passa antes por `completeSlice`, com o valor completo das células cortadas (`completeValues`, em `use-record-edits.ts`).
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

/**
 * RN-SQL-017: o recorte com o valor completo no lugar do cortado, e as marcas de corte só das células que ficaram sem (a API não tinha o
 * valor inteiro): copiar e exportar levam o valor como veio do banco. `valueOf` responde pela posição DENTRO do recorte. As linhas sem
 * célula trocada são os mesmos objetos.
 */
export function completeSlice(slice: GridSlice, valueOf: (row: number, column: number) => string | undefined): GridSlice {
  if (slice.truncated.length === 0) return slice;

  const rows = [...slice.rows];
  const left: (readonly [number, number])[] = [];
  for (const [row, column] of slice.truncated) {
    const value = valueOf(row, column);
    if (value === undefined) {
      left.push([row, column]);
      continue;
    }
    if (rows[row] === slice.rows[row]) rows[row] = [...slice.rows[row]];
    (rows[row] as (string | null)[])[column] = value;
  }

  return { ...slice, rows, truncated: left };
}
