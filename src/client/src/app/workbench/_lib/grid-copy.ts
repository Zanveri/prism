import type { Engine } from "@/components/ui";

import { clipboardLimitBytes, utf8Length, wellFormed } from "./grid-export/document";
import { gridSelectionCopy } from "./grid-selection.copy";
import { sqlName } from "./sql-completion";

const copy = gridSelectionCopy;

/**
 * O "Copiar" e o "Copiar com cabeçalho" da grade (RN-GRADE-002) e o "Copiar nome da(s) coluna(s)" e o "Copiar número de linha(s)" (RN-GRADE-015), sem
 * React: o texto, o limite e os avisos. Quem lê a seleção, busca os valores completos e escreve na área de transferência é `use-record-edits.ts`.
 */

/** O limite da área de transferência, o mesmo da exportação (RN-EXPORT-014) e do "Copiar como" (RN-GRADE-016): 10 MiB de texto em UTF-8. */
export const clipboardLimit = clipboardLimitBytes;

/** Quantas células o texto monta antes de ceder a vez à tela (a seleção grande não prende a janela). */
export const copyChunk = 5_000;

// O tamanho em UTF-8 e o par substituto solto são os do "Copiar como" (`grid-export/document.ts`): uma conta só para os dois limites de 10 MiB.
export { utf8Length, wellFormed };

const needsQuotes = /[\t"\n\r]/;

/**
 * Um campo do texto copiado. O nulo vai vazio, nunca entre aspas. Com mais de uma célula, ou com o cabeçalho (`quoted`), o valor que tem tabulação, aspa,
 * quebra de linha ou retorno de carro vai entre aspas duplas, com a aspa de dentro dobrada, e assim volta inteiro na planilha (o DBeaver não dobra a aspa).
 * Sem a proteção contra fórmula do CSV: o pedido é o valor puro.
 */
export function copyField(value: string | null, quoted: boolean): string {
  if (value === null) return "";
  const text = wellFormed(value);
  return quoted && needsQuotes.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** O que copiar: os nomes das colunas do cabeçalho (nulo sem ele), quantas linhas e colunas, e o valor de cada célula pela posição no que se copia. */
export type CopyPlan = { header: readonly string[] | null; rows: number; columns: number; valueAt: (row: number, column: number) => string | null };

export type CopyOutcome = { kind: "text"; text: string; bytes: number } | { kind: "tooLarge" } | { kind: "cancelled" };

/** Ceder a vez à tela entre uma parte e outra. */
export const yieldToScreen = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * O texto que uma planilha cola: as células de uma linha separadas por tabulação, as linhas por quebra de linha (LF, também no Windows), sem quebra
 * depois da última. Uma célula só, sem cabeçalho, é o valor puro, sem aspas. Montado em partes de `copyChunk` células, que cedem a vez à tela entre si; a
 * soma do tamanho em UTF-8 acompanha a montagem, e a que passa do limite para na hora, sem texto (`tooLarge`). `measure` só soma, sem montar: é a
 * conferência de antes de buscar os valores completos. Cancelado (`signal`), não devolve texto.
 */
export async function buildCopyText(plan: CopyPlan, { limit = clipboardLimit, signal, pause = yieldToScreen, chunk = copyChunk, measure = false }: { limit?: number; signal?: AbortSignal; pause?: () => Promise<void>; chunk?: number; measure?: boolean } = {}): Promise<CopyOutcome> {
  const quoted = plan.header !== null || plan.rows * plan.columns > 1;
  const lines: string[] = [];
  let bytes = 0;
  let count = 0;
  let since = 0;
  const add = (line: string) => {
    bytes += utf8Length(line) + (count > 0 ? 1 : 0);
    count += 1;
    if (!measure) lines.push(line);
  };

  if (plan.header !== null) add(plan.header.map((name) => copyField(name, quoted)).join("\t"));
  if (bytes > limit) return { kind: "tooLarge" };
  for (let row = 0; row < plan.rows; row += 1) {
    const fields: string[] = [];
    for (let column = 0; column < plan.columns; column += 1) fields.push(copyField(plan.valueAt(row, column), quoted));
    add(fields.join("\t"));
    if (bytes > limit) return { kind: "tooLarge" };
    since += plan.columns;
    if (since >= chunk) {
      since = 0;
      await pause();
      if (signal?.aborted === true) return { kind: "cancelled" };
    }
  }
  if (signal?.aborted === true) return { kind: "cancelled" };

  return { kind: "text", text: measure ? "" : lines.join("\n"), bytes };
}

/**
 * O teto do tamanho do texto em UTF-8, sem montá-lo: três bytes por unidade do texto (o máximo do UTF-8; a aspa dobrada fica em dois), as duas aspas e o
 * separador de cada campo. Abaixo do limite, ele já diz que o texto cabe, numa volta só pelas células; acima, quem copia mede o tamanho exato
 * (`buildCopyText` com `measure`).
 */
export function copyCeiling(plan: CopyPlan): number {
  let bytes = 0;
  for (const name of plan.header ?? []) bytes += name.length * 3 + 3;
  for (let row = 0; row < plan.rows; row += 1) for (let column = 0; column < plan.columns; column += 1) bytes += (plan.valueAt(row, column)?.length ?? 0) * 3 + 3;
  return bytes;
}

/** O aviso de sucesso do "Copiar" (RN-GRADE-002): "Copiado." com uma célula; "3 linhas copiadas." com mais; e o mesmo com o cabeçalho. */
export function copiedNotice({ rows, cells, header }: { rows: number; cells: number; header: boolean }): string {
  if (cells <= 1) return header ? copy.copy.copiedWithHeader : copy.copy.copied;
  return copy.copy.rows(rows, header);
}

/**
 * "Copiar nome da(s) coluna(s)" (RN-GRADE-015): os nomes das colunas da seleção, na ordem da grade, como o banco pede que eles sejam escritos (sem aspas o
 * simples, entre aspas o que precisa delas: `sqlName`, a regra do autocompletar), separados por tabulação, sem tabulação depois do último. O nome repetido
 * sai repetido.
 */
export function columnNamesText(names: readonly string[], engine: Engine | undefined): string {
  return names.map((name) => sqlName(name, engine)).join("\t");
}

/**
 * "Copiar número de linha(s)" (RN-GRADE-015): os números das linhas da seleção, como a grade os mostra (a partir de 1), um por linha, em ordem crescente, sem
 * quebra depois do último. As linhas novas ainda não salvas (as posições a partir de `read`) não têm número e não entram.
 */
export function rowNumbersOf(rows: readonly number[], read: number): number[] {
  return rows.filter((row) => row < read).map((row) => row + 1);
}

/**
 * RN-GRADE-023: a conta do limite de 10 MiB enquanto as linhas que faltam chegam, para o copiar das colunas inteiras: a soma, em UTF-8, dos valores das
 * colunas copiadas e de um separador por célula. É um piso do texto (as aspas, o cabeçalho, os valores completos das cortadas e o que cada formato escreve
 * em volta só aumentam): passar dele já é passar do limite, e o carregar para sem pedir a página seguinte. `initial` é o piso das linhas que a grade já tinha
 * (as lidas, com as pendências, e as novas); cada chamada depois soma as linhas de `from` em diante e diz se o carregar segue.
 */
export function loadedRowsMeter(columns: readonly number[], initial: number, limit: number = clipboardLimit): (rows: { rows: readonly (readonly (string | null)[])[] }, from: number) => boolean {
  let bytes = initial;
  return (page, from) => {
    if (from > 0) for (let row = from; row < page.rows.length; row += 1) for (const column of columns) bytes += utf8Length(page.rows[row]?.[column] ?? "") + 1;
    return bytes <= limit;
  };
}

/** O piso do texto de células já na grade (RN-GRADE-023): os valores em UTF-8 e um separador por célula. */
export function cellsFloor(rows: readonly (readonly (string | null)[])[]): number {
  let bytes = 0;
  for (const row of rows) for (const value of row) bytes += utf8Length(value ?? "") + 1;
  return bytes;
}
