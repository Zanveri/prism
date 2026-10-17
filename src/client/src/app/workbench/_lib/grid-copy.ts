import type { Engine } from "@/components/ui";

import { gridSelectionCopy } from "./grid-selection.copy";
import { sqlName } from "./sql-completion";

const copy = gridSelectionCopy;

/**
 * O "Copiar" e o "Copiar com cabeçalho" da grade (RN-GRADE-002) e o "Copiar nome da(s) coluna(s)" e o "Copiar número de linha(s)" (RN-GRADE-015), sem
 * React: o texto, o limite e os avisos. Quem lê a seleção, busca os valores completos e escreve na área de transferência é `use-record-edits.ts`.
 */

/** O limite da área de transferência, o mesmo da exportação (RN-EXPORT-014): 10 MiB de texto em UTF-8. */
export const clipboardLimit = 10_485_760;

/** Quantas células o texto monta antes de ceder a vez à tela (a seleção grande não prende a janela). */
export const copyChunk = 5_000;

/** Os bytes do texto em UTF-8, com o par substituto solto contado como o U+FFFD que ele vira (três bytes). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length && (text.charCodeAt(index + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

const surrogate = /[\ud800-\udfff]/;
const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** O texto como o UTF-8 o escreve: o Unicode fora do plano básico e as marcas de direção vão como estão, e o par substituto solto vira U+FFFD. */
export function wellFormed(text: string): string {
  return surrogate.test(text) ? text.replace(loneSurrogate, "�") : text;
}

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
