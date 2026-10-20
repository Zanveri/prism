import { integerIn } from "../data-export/export-options";
import { codePointCount, emptyCounts, utf8Length, type DocumentContext, type DocumentWriter } from "./document";

/** Um lote do TXT: 200 linhas, ou menos quando os valores dele passam de 16 MiB (RN-EXPORT-008). */
const batchRows = 200;
const batchBytes = 16 * 1024 * 1024;

/**
 * O valor numa linha da tabela de texto (o `ExportText.TxtValue` da API): a quebra de linha, o retorno de carro, a tabulação e os outros caracteres de
 * controle (C0, DEL e C1) viram um espaço, e também o separador de linha e o de parágrafo do Unicode (U+2028 e U+2029), que um editor lê como quebra: cada
 * linha da origem é uma linha do texto.
 */
export const txtValue = (text: string) => text.replace(/[\p{Cc}\u2028\u2029]/gu, " ");

/** Os primeiros `width` pontos de código do texto, sem partir um par substituto (o solto conta um). */
export function takeCodePoints(text: string, width: number): string {
  let taken = 0;
  let index = 0;
  for (const char of text) {
    if (taken === width) return text.slice(0, index);
    taken++;
    index += char.length;
  }
  return text;
}

/**
 * RN-EXPORT-008: a tabela de texto do DBeaver, o `TxtExportWriter` da API. As colunas separadas por `|`, sem espaço em volta, cada valor alinhado à esquerda
 * e completado com espaços até a largura da coluna: a maior entre a mínima, o nome e os valores do lote, em pontos de código, cortada na máxima, quando há
 * (o valor maior que ela é cortado e contado). As larguras são de cada lote de 200 linhas: o lote é guardado, medido e escrito, e o cabeçalho sai uma vez,
 * no alto, com as larguras do primeiro. O nulo é vazio, ou `NULL` com "Mostrar NULL".
 */
export function txtWriter({ columns, options }: DocumentContext): DocumentWriter {
  const o = options.txt;
  const minWidth = integerIn(o.minWidth, 1, 1000) ?? 3;
  const maxWidth = integerIn(o.maxWidth, 0, 100_000) ?? 0;
  const lineBreak = o.lineBreak === "lf" ? "\n" : "\r\n";
  const names = columns.map((column) => txtValue(column.name));
  const counts = emptyCounts();

  let batch: string[][] = [];
  let bytes = 0;
  let started = false;

  const line = (cells: string[]) => `${o.edgeDelimiters ? "|" : ""}${cells.join("|")}${o.edgeDelimiters ? "|" : ""}${lineBreak}`;
  const padded = (value: string, width: number) => `${value}${" ".repeat(Math.max(0, width - codePointCount(value)))}`;
  const cut = (value: string, width: number) => {
    const kept = takeCodePoints(value, width);
    if (kept.length < value.length) counts.cutValues++;
    return kept;
  };

  /** Mede o lote, escreve o cabeçalho na primeira vez (também sem nenhuma linha) e as linhas do lote, e o esvazia. */
  function writeBatch(): string {
    if (started && batch.length === 0) return "";

    const widths = names.map((name, column) => {
      let width = Math.max(minWidth, codePointCount(name));
      for (const values of batch) width = Math.max(width, codePointCount(values[column]));
      return maxWidth > 0 ? Math.min(width, maxWidth) : width;
    });

    let text = "";
    if (!started) {
      started = true;
      if (o.header) {
        text += line(names.map((name, column) => padded(takeCodePoints(name, widths[column]), widths[column])));
        if (o.headerLine) text += line(widths.map((width) => "-".repeat(width)));
      }
    }
    for (const values of batch) text += line(values.map((value, column) => padded(cut(value, widths[column]), widths[column])));

    batch = [];
    bytes = 0;
    return text;
  }

  return {
    counts,
    begin: () => "",
    write: (row) => {
      const values = row.values.map((value) => (value === null ? (o.showNull ? "NULL" : "") : txtValue(value)));
      for (const value of values) bytes += utf8Length(value);
      batch.push(values);
      return batch.length >= batchRows || bytes > batchBytes ? writeBatch() : "";
    },
    end: writeBatch,
  };
}
