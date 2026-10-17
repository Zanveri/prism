import { csvFieldOf } from "../csv";
import type { CsvDelimiter } from "../data-export/export-options";
import type { QueryColumn } from "../query.schema";
import { emptyCounts, type DocumentContext, type DocumentWriter } from "./document";

/** As aspas do CSV da exportação (RN-EXPORT-007): só quando precisa (`auto`), em todos os textos (`text`) ou em todos os valores (`all`). */
export type CsvQuoting = "auto" | "text" | "all";

/** As escolhas do CSV que decidem um campo (o `CsvFieldOptions` da API). */
export type CsvFieldOptions = { delimiter: CsvDelimiter; quoting: CsvQuoting; formulaGuard: boolean; nullText: string };

/**
 * O valor com o apóstrofo da RN-TABELA-006 quando uma planilha o executaria, ou como veio: a regra é a do `csvFieldOf` (`csv.ts`), que não se copia aqui;
 * pega-se o campo dele sem as aspas que ele pôs (só quem foi posto entre aspas COMEÇA por aspa: o valor que começa por aspa precisa delas).
 */
function guarded(value: string): string {
  const field = csvFieldOf(value);
  return field.length > 1 && field.startsWith('"') && field.endsWith('"') ? field.slice(1, -1).replaceAll('""', '"') : field;
}

/**
 * Um campo do CSV da exportação (RN-EXPORT-007; o `ExportText.CsvField` da API, com o mesmo texto: as fixtures `csv-field.json` e `csv-field-text.json`
 * conferem os dois lados). O nulo é o texto dele, sem a proteção contra fórmula, entre aspas só quando o texto tem o separador, a aspa ou uma quebra. O valor
 * ganha o apóstrofo da proteção e vai entre aspas, com a aspa dobrada: só quando precisa; em todos os textos (todo valor de coluna que não é de número, e os
 * nomes das colunas, que chegam aqui como `text`); ou em todos os valores. O número nunca vai entre aspas em "Em todos os textos", a não ser que precise.
 */
export function csvField(value: string | null, kind: QueryColumn["kind"], options: CsvFieldOptions): string {
  const needsQuotes = (text: string) => text.includes(options.delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r");
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  if (value === null) return needsQuotes(options.nullText) ? quote(options.nullText) : options.nullText;

  // O apóstrofo da proteção não é o separador, a aspa nem uma quebra: o valor precisa das aspas com ele ou sem ele.
  const text = options.formulaGuard ? guarded(value) : value;
  const quoted = options.quoting === "all" || (options.quoting === "text" && kind !== "number") || needsQuotes(value);
  return quoted ? quote(text) : text;
}

/**
 * RN-EXPORT-007: o CSV da exportação, o `CsvExportWriter` da API. O cabeçalho (os nomes, com a mesma proteção e as mesmas aspas, como texto) e uma linha por
 * registro, cada uma terminada pela quebra escolhida, também a última. Sem linhas, só o cabeçalho; sem cabeçalho, nada. O texto nunca leva BOM: o BOM é do
 * arquivo, e a área de transferência não o tem (RN-EXPORT-014). Não é o `toDelimited` do "Copiar" simples (RN-GRADE-002), que não é um formato da exportação.
 */
export function csvWriter({ columns, options }: DocumentContext): DocumentWriter {
  const o = options.csv;
  const field: CsvFieldOptions = { delimiter: o.delimiter, quoting: o.quoting, formulaGuard: o.formulaGuard, nullText: o.nullText };
  const lineBreak = o.lineBreak === "lf" ? "\n" : "\r\n";
  return {
    counts: emptyCounts(),
    begin: () => (o.header ? `${columns.map((column) => csvField(column.name, "text", field)).join(o.delimiter)}${lineBreak}` : ""),
    write: (row) => `${row.values.map((value, index) => csvField(value, columns[index].kind, field)).join(o.delimiter)}${lineBreak}`,
    end: () => "",
  };
}
