import type { Engine } from "@/components/ui";

import type { ExportExtension } from "../../../../../electron/file-name";
import { dataExportCopy } from "./data-export.copy";

/**
 * Os formatos da exportação de dados e as opções de cada um (RN-EXPORT-004 e 006 a 013): os padrões, as recusas de cada campo, a extensão do arquivo e a
 * frase da Confirmação. Puro, sem React: o assistente só desenha o que sai daqui. Os números que a pessoa digita ficam como texto até o pedido (o campo
 * mostra o que foi digitado, e a recusa diz o que está errado), e só o pedido os converte.
 */

/** Na ordem da lista (RN-EXPORT-004). "Banco de dados" vem depois, separado, e é da seção 36. */
export const dataFormats = ["csv", "sourceCode", "dbUnit", "html", "json", "markdown", "sql", "txt", "xlsx", "xml"] as const;

export type DataFormat = (typeof dataFormats)[number];

export const isDataFormat = (value: unknown): value is DataFormat => typeof value === "string" && (dataFormats as readonly string[]).includes(value);

export type Binary = "hex" | "null";
export type LineBreak = "crlf" | "lf";
export type CsvDelimiter = ";" | "," | "\t" | "|";

export type CsvOptions = { delimiter: CsvDelimiter; header: boolean; quoting: "auto" | "text" | "all"; formulaGuard: boolean; lineBreak: LineBreak; nullText: string; binary: Binary };
export type TxtOptions = { header: boolean; headerLine: boolean; edgeDelimiters: boolean; minWidth: string; maxWidth: string; showNull: boolean; lineBreak: LineBreak; binary: Binary };
export type HtmlOptions = { title: boolean; columnNames: boolean; binary: Binary };
export type MarkdownOptions = { alignmentLine: boolean; nullText: string; binary: Binary };
export type JsonOptions = { wrap: boolean; isoDates: boolean; binary: Binary };
export type SourceCodeOptions = { php: "legacy" | "short"; quote: "double" | "single"; isoDates: boolean; binary: Binary };
/** `includeGenerated` é só da tela: desligado, ela tira das colunas que manda as que o banco calcula sempre (RN-EXPORT-011). */
export type SqlOptions = { schema: string; table: string; omitSchema: boolean; rowsPerStatement: string; includeGenerated: boolean; binary: "literal" | "null" };
export type XmlOptions = { doctype: boolean; binary: Binary };
export type DbUnitOptions = { table: string; upperCase: boolean; nulls: "omit" | "mark"; binary: Binary };
export type XlsxOptions = { binary: Binary };

export type FormatOptions = {
  csv: CsvOptions;
  txt: TxtOptions;
  html: HtmlOptions;
  markdown: MarkdownOptions;
  json: JsonOptions;
  sourceCode: SourceCodeOptions;
  sql: SqlOptions;
  xml: XmlOptions;
  dbUnit: DbUnitOptions;
  xlsx: XlsxOptions;
};

/** O que os padrões precisam da origem: o esquema e a tabela de destino do SQL e do DbUnit (vazios no resultado de uma consulta). */
export type OptionDefaults = { schema: string; table: string };

/** Os padrões do Prism (os do DBeaver onde o Prism não tinha um). */
export function defaultOptions({ schema, table }: OptionDefaults): FormatOptions {
  return {
    csv: { delimiter: ";", header: true, quoting: "auto", formulaGuard: true, lineBreak: "crlf", nullText: "", binary: "hex" },
    txt: { header: true, headerLine: true, edgeDelimiters: true, minWidth: "3", maxWidth: "0", showNull: false, lineBreak: "crlf", binary: "hex" },
    html: { title: true, columnNames: true, binary: "hex" },
    markdown: { alignmentLine: true, nullText: "", binary: "hex" },
    json: { wrap: true, isoDates: true, binary: "hex" },
    sourceCode: { php: "legacy", quote: "double", isoDates: true, binary: "hex" },
    sql: { schema, table, omitSchema: false, rowsPerStatement: "10", includeGenerated: false, binary: "literal" },
    xml: { doctype: false, binary: "hex" },
    dbUnit: { table, upperCase: true, nulls: "omit", binary: "hex" },
    xlsx: { binary: "hex" },
  };
}

/** "Incluir BOM": ligado no CSV e no TXT, como hoje, e desligado nos outros (RN-EXPORT-014). */
export function defaultBom(): Record<DataFormat, boolean> {
  return { csv: true, sourceCode: false, dbUnit: false, html: false, json: false, markdown: false, sql: false, txt: true, xlsx: false, xml: false };
}

/** A extensão do arquivo do formato: `.tsv` no CSV com tabulação, `.php` no Código fonte, `.xml` no XML e no DbUnit, `.md` no Markdown. */
export function extensionOf(format: DataFormat, options: FormatOptions): Exclude<ExportExtension, "zip"> {
  switch (format) {
    case "csv":
      return options.csv.delimiter === "\t" ? "tsv" : "csv";
    case "sourceCode":
      return "php";
    case "dbUnit":
    case "xml":
      return "xml";
    case "markdown":
      return "md";
    default:
      return format;
  }
}

/** Os formatos de texto, os que vão para a área de transferência e levam BOM; o XLSX não é texto. */
export const isTextFormat = (format: DataFormat) => format !== "xlsx";

/** O que a etapa Formatação precisa saber além das opções. */
export type FormattingContext = {
  engine: Engine | undefined;
  /** A tabela do SQL e do DbUnit é obrigatória: o resultado de uma consulta sem tabela conhecida. */
  tableRequired: boolean;
  /** Os nomes das colunas que vão no arquivo (as marcadas, e no SQL sem as que o banco calcula). */
  columns: readonly string[];
};

/** A recusa de cada campo, pelo caminho do campo no pedido (`options.rowsPerStatement`), o mesmo do `EXPORT_OPTIONS_INVALID` da API. */
export type FieldProblems = Partial<Record<string, string>>;

const p = dataExportCopy.problems;

// Os controles do Unicode (C0, DEL e C1).
// eslint-disable-next-line no-control-regex
const control = /[\u0000-\u001f\u007f-\u009f]/;

/** Um número inteiro escrito só com dígitos, dentro da faixa; senão `null`. */
export function integerIn(text: string, min: number, max: number): number | null {
  if (!/^\d{1,7}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
}

function nullTextProblem(text: string): string | undefined {
  if (control.test(text)) return p.nullTextControl;
  if (text.length > 100) return p.nullTextLength;
  return undefined;
}

/** O nome de destino (esquema ou tabela do SQL, tabela do DbUnit): até 128 caracteres, sem controle. */
function nameProblem(text: string, required: boolean): string | undefined {
  if (required && text === "") return p.tableRequired;
  if (control.test(text)) return p.nameControl;
  if (text.length > 128) return p.nameLength;
  return undefined;
}

/** O primeiro nome que aparece duas vezes entre as colunas que vão no arquivo. */
function duplicateOf(columns: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const name of columns) {
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return null;
}

/** O limite de colunas de uma planilha do Excel (RN-EXPORT-013). */
export const xlsxMaxColumns = 16_384;

/**
 * As recusas da etapa Formatação: cada uma no próprio campo, e a etapa não avança enquanto houver alguma (RN-EXPORT-003). As que não são de um campo (as
 * colunas repetidas do SQL, as colunas demais do XLSX) ficam em `columns`, o caminho da API para elas.
 */
export function formattingProblems(format: DataFormat, options: FormatOptions, context: FormattingContext): FieldProblems {
  const problems: FieldProblems = {};
  const set = (field: string, message: string | undefined) => {
    if (message !== undefined) problems[field] = message;
  };

  switch (format) {
    case "csv":
      set("options.nullText", nullTextProblem(options.csv.nullText));
      break;
    case "markdown":
      set("options.nullText", nullTextProblem(options.markdown.nullText));
      break;
    case "txt": {
      const min = integerIn(options.txt.minWidth, 1, 1000);
      const max = integerIn(options.txt.maxWidth, 0, 100_000);
      if (min === null) set("options.minWidth", p.minWidth);
      if (max === null) set("options.maxWidth", p.maxWidth);
      else if (min !== null && max > 0 && max < min) set("options.maxWidth", p.maxBelowMin);
      break;
    }
    case "sql": {
      set("options.schema", nameProblem(options.sql.schema, false));
      set("options.table", nameProblem(options.sql.table, context.tableRequired));
      if (context.engine !== 3 && integerIn(options.sql.rowsPerStatement, 1, 1000) === null) set("options.rowsPerStatement", p.rowsPerStatement);
      const duplicate = duplicateOf(context.columns);
      if (duplicate !== null) set("columns", p.duplicateColumn(duplicate));
      break;
    }
    case "dbUnit":
      set("options.table", nameProblem(options.dbUnit.table, context.tableRequired));
      break;
    case "xlsx":
      if (context.columns.length > xlsxMaxColumns) set("columns", p.xlsxColumns(context.columns.length - xlsxMaxColumns));
      break;
    default:
      break;
  }
  return problems;
}

const s = dataExportCopy.summary;
const names = dataExportCopy.formats.names;

/** A tabela de destino como sai no `INSERT` e no DbUnit, para a frase da Confirmação. */
function targetOf(schema: string, table: string, omitSchema: boolean): string {
  return omitSchema || schema === "" ? table : `${schema}.${table}`;
}

/**
 * O formato e as opções numa frase, para a Confirmação (RN-EXPORT-015): "CSV · ponto e vírgula · cabeçalho · aspas só quando precisa · proteção contra
 * fórmula · CRLF". Só o que muda o arquivo entra; o binário só quando é deixado vazio (o padrão é o da grade).
 */
export function formatSentence(format: DataFormat, options: FormatOptions, engine: Engine | undefined): string {
  const parts: string[] = [names[format]];
  const binary = (value: Binary) => (value === "null" ? [s.binaryEmpty] : []);
  const lineBreak = (value: LineBreak) => (value === "crlf" ? "CRLF" : "LF");

  switch (format) {
    case "csv": {
      const o = options.csv;
      parts.push(s.delimiters[o.delimiter], o.header ? s.header : s.noHeader, s.quotings[o.quoting], o.formulaGuard ? s.formulaGuard : s.noFormulaGuard, lineBreak(o.lineBreak));
      if (o.nullText !== "") parts.push(s.nullAs(o.nullText));
      parts.push(...binary(o.binary));
      break;
    }
    case "txt": {
      const o = options.txt;
      parts.push(o.header ? s.header : s.noHeader);
      if (o.header && o.headerLine) parts.push(s.headerLine);
      if (o.edgeDelimiters) parts.push(s.edgeDelimiters);
      parts.push(s.widths(o.minWidth.trim(), o.maxWidth.trim()));
      if (o.showNull) parts.push(s.showNull);
      parts.push(lineBreak(o.lineBreak), ...binary(o.binary));
      break;
    }
    case "html":
      parts.push(options.html.title ? s.title : s.noTitle, options.html.columnNames ? s.columnNames : s.noColumnNames, ...binary(options.html.binary));
      break;
    case "markdown":
      parts.push(options.markdown.alignmentLine ? s.alignmentLine : s.noAlignmentLine);
      if (options.markdown.nullText !== "") parts.push(s.nullAs(options.markdown.nullText));
      parts.push(...binary(options.markdown.binary));
      break;
    case "json":
      parts.push(options.json.wrap ? s.wrap : s.noWrap, options.json.isoDates ? s.isoDates : s.gridDates, ...binary(options.json.binary));
      break;
    case "sourceCode": {
      const o = options.sourceCode;
      parts.push(o.php === "legacy" ? s.phpLegacy : s.phpShort, o.quote === "double" ? s.doubleQuotes : s.singleQuotes, o.isoDates ? s.isoDates : s.gridDates, ...binary(o.binary));
      break;
    }
    case "sql": {
      const o = options.sql;
      if (o.table !== "") parts.push(s.into(targetOf(o.schema, o.table, o.omitSchema)));
      else if (o.omitSchema) parts.push(s.omitSchema);
      parts.push(s.rowsPerStatement(engine === 3 ? "1" : o.rowsPerStatement.trim()), o.binary === "literal" ? s.binaryLiteral : s.binaryNull);
      break;
    }
    case "xml":
      if (options.xml.doctype) parts.push(s.doctype);
      parts.push(...binary(options.xml.binary));
      break;
    case "dbUnit": {
      const o = options.dbUnit;
      if (o.table !== "") parts.push(s.into(o.table));
      parts.push(...(o.upperCase ? [s.upperCase] : []), o.nulls === "omit" ? s.nullsOmitted : s.nullsMarked, ...binary(o.binary));
      break;
    }
    case "xlsx":
      parts.push(...binary(options.xlsx.binary));
      break;
  }
  return parts.join(" · ");
}
