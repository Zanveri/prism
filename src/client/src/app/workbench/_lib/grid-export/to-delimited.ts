import { csvBom, csvFieldOf } from "../csv";
import { gridExportCopy } from "./grid-export.copy";
import { rowNumberOf, type GridSlice } from "./grid-slice";

export type Delimiter = "\t" | ";" | "," | "|";

/**
 * As escolhas do texto delimitado (RN-GRADE-003 e 007). `quoting`: `auto` põe entre aspas só o valor que tem o delimitador, aspa ou quebra de linha;
 * `always` põe todo valor e todo nome de coluna; `never` não põe nenhum. O nulo é o `nullText`, escrito como está: a guarda contra fórmula não o
 * toca (o texto é da pessoa, e `-` é um marcador legítimo) e o modo `always` não o põe entre aspas (`""` seria um texto vazio, e não um nulo);
 * só o que quebraria o arquivo (o delimitador, aspa, quebra de linha) o leva entre aspas, e fora do modo `never`.
 */
export type DelimitedOptions = {
  delimiter: Delimiter;
  header: boolean;
  /** Uma primeira coluna com o número da linha na grade (`rowNumbers`), rotulada com `#`. */
  rowNumber: boolean;
  quoting: "auto" | "always" | "never";
  nullText: string;
  /** O apóstrofo da RN-TABELA-006 no valor e no nome de coluna que uma planilha executaria como fórmula. */
  formulaGuard: boolean;
  bom: boolean;
  lineBreak: "\r\n" | "\n";
};

/** O CSV da RN-TABELA-006: `;`, BOM, CRLF, aspas só quando precisa, nulo vazio e a guarda ligada. Com estas opções a saída é a de `toCsv`. */
export const csvOptions: DelimitedOptions = { delimiter: ";", header: true, rowNumber: false, quoting: "auto", nullText: "", formulaGuard: true, bom: true, lineBreak: "\r\n" };

/** O TSV da RN-GRADE-007: o CSV com tabulação no lugar do `;`. */
export const tsvOptions: DelimitedOptions = { ...csvOptions, delimiter: "\t" };

/** O copiar simples da RN-GRADE-002: tabulação, sem cabeçalho, aspas no modo auto, nulo vazio, sem guarda e sem BOM. */
export const simpleCopyOptions: DelimitedOptions = { delimiter: "\t", header: false, rowNumber: false, quoting: "auto", nullText: "", formulaGuard: false, bom: false, lineBreak: "\n" };

/**
 * O valor com o apóstrofo da RN-TABELA-006 quando uma planilha o executaria, ou como veio. A regra é a de `csvFieldOf` (`csv.ts`) e não se copia
 * aqui: pega-se o campo dele sem as aspas que ele pôs. Só quem foi posto entre aspas COMEÇA por aspa (o valor que começa por aspa precisa delas).
 */
function guarded(value: string): string {
  const field = csvFieldOf(value);
  return field.length > 1 && field.startsWith('"') && field.endsWith('"') ? field.slice(1, -1).replaceAll('""', '"') : field;
}

/**
 * O recorte como texto delimitado. Cada linha, a última também, termina em `lineBreak`; o BOM, quando pedido, é o primeiro caractere. O texto das
 * células cortadas é o que a grade tem (RN-SQL-011): quem chama avisa.
 */
export function toDelimited(slice: GridSlice, options: DelimitedOptions): string {
  const { delimiter, quoting, nullText, formulaGuard } = options;
  const needsQuotes = (text: string) => text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r");
  const quote = (text: string) => `"${text.replaceAll('"', '""')}"`;
  const pack = (text: string) => (quoting === "always" || (quoting === "auto" && needsQuotes(text)) ? quote(text) : text);
  const cell = (value: string | null) => (value === null ? (quoting !== "never" && needsQuotes(nullText) ? quote(nullText) : nullText) : pack(formulaGuard ? guarded(value) : value));

  const lines: string[][] = [];
  if (options.header) lines.push([...(options.rowNumber ? [pack(gridExportCopy.rowNumberHeader)] : []), ...slice.columns.map((column) => pack(formulaGuard ? guarded(column.name) : column.name))]);
  slice.rows.forEach((row, index) => lines.push([...(options.rowNumber ? [pack(String(rowNumberOf(slice, index)))] : []), ...row.map(cell)]));

  return `${options.bom ? csvBom : ""}${lines.map((line) => `${line.join(delimiter)}${options.lineBreak}`).join("")}`;
}

/**
 * O "copiar" da RN-GRADE-002: o texto que uma planilha cola. Uma célula só sai como o valor puro, sem aspas e sem cabeçalho; do contrário é o
 * `toDelimited` com `simpleCopyOptions` (e, com `withHeader`, a linha dos nomes), sem a quebra de linha depois da última linha.
 */
export function copyAsText(slice: GridSlice, withHeader = false): string {
  if (!withHeader && slice.rows.length === 1 && slice.columns.length === 1) return slice.rows[0][0] ?? "";

  const text = toDelimited(slice, { ...simpleCopyOptions, header: withHeader });
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}
