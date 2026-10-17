import type { SourceReply } from "../../../../../electron/transfer-messages";
import { formatFileSize } from "../data-export/transfer-tracker";
import { dataImportCopy } from "./data-import.copy";
import type { DetectedEncoding, ImportFormat, ImportRead } from "./imports.schema";

/**
 * A etapa Arquivo sem React (RN-IMPORT-003 a 008): o formato pela extensão, as frases do campo do arquivo, o que a leitura achou e a prévia do arquivo.
 */

const f = dataImportCopy.file;
const p = dataImportCopy.preview;

/** O formato pela extensão (RN-IMPORT-003): `.csv` e `.txt` são CSV; `.tsv` e `.tab`, TSV; `.json`, JSON; `.xlsx` e `.xlsm`, XLSX; outra, CSV. */
export function formatOfName(fileName: string): ImportFormat {
  const dot = fileName.lastIndexOf(".");
  const extension = dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
  switch (extension) {
    case "tsv":
    case "tab":
      return "tsv";
    case "json":
      return "json";
    case "xlsx":
    case "xlsm":
      return "xlsx";
    default:
      return "csv";
  }
}

/** A frase do campo do arquivo para a escolha que não deu (RN-IMPORT-003), sem aviso de erro; `null` para a escolhida e a desistência. */
export function sourceRefusal(reply: SourceReply | { status: "error" }): string | null {
  switch (reply.status) {
    case "chosen":
    case "canceled":
      return null;
    case "tooLarge":
      return f.tooLarge(formatFileSize(reply.size));
    case "noSpace":
      return f.noSpace(formatFileSize(reply.needed));
    case "notWritable":
      return f.notWritable;
    case "unreadable":
      return f.unreadable(reply.message);
    case "notAFile":
      return f.notAFile;
    case "error":
      return f.dialogFailed;
  }
}

/** A porcentagem da cópia, arredondada para baixo, e no máximo 99% enquanto ela não termina. */
export function copyPercent(copied: number, size: number): number {
  if (size <= 0) return 0;
  return Math.min(99, Math.floor((copied / size) * 100));
}

/** O nome da codificação como a tela o escreve: "UTF-8 com BOM", "Windows-1252". */
export function encodingText(name: DetectedEncoding, bom: boolean): string {
  return p.encodingName(f.encodings[name], bom);
}

/** O nome do separador: "ponto e vírgula", "tabulação"; o caractere que a tela não conhece, como veio. */
export const delimiterText = (delimiter: string) => p.delimiterNames[delimiter] ?? delimiter;

/**
 * A linha do que a leitura achou, em cima da prévia (RN-IMPORT-007): "UTF-8 com BOM · ponto e vírgula · 15 colunas"; no XLSX, "Planilha Pedidos · 15
 * colunas"; no JSON, "Lista em pedido · 15 colunas". Sem separador nenhum, o arquivo tem uma coluna só.
 */
export function detectionLine(format: ImportFormat, read: ImportRead): string {
  const columns = p.columns(read.columns.length);
  switch (format) {
    case "xlsx":
      return `${p.sheet(read.sheet ?? "")} · ${columns}`;
    case "json":
      return `${read.listKey === null || read.listKey === undefined ? p.rootList : p.list(read.listKey)} · ${columns}`;
    case "csv":
    case "tsv": {
      const parts = [read.encoding === null || read.encoding === undefined ? null : encodingText(read.encoding.name, read.encoding.bom), read.delimiter === null || read.delimiter === undefined ? p.oneColumn : delimiterText(read.delimiter), columns];
      return parts.filter((part) => part !== null).join(" · ");
    }
  }
}

/** O teto de cada célula das prévias (RN-IMPORT-008): a API corta nos 1.000 caracteres, e a tela mostra o corte com "…". */
export const previewCellLimit = 1000;

/** O valor de uma célula como a prévia o mostra: o texto, cortado com "…" quando chegou no teto; o nulo é o da grade (quem desenha decide). */
export function previewText(value: string): string {
  return [...value].length >= previewCellLimit ? `${value}…` : value;
}

/** "As outras 15.000 colunas não aparecem na prévia.", quando as linhas trazem menos colunas que o arquivo tem (RN-IMPORT-008). */
export function hiddenColumnsNote(columns: number, shown: number): string | null {
  return shown < columns ? p.hiddenColumns(columns - shown) : null;
}

/**
 * A frase da linha completada com nulo (RN-IMPORT-004): quantos valores ela tinha (os que vieram antes dos nulos postos no fim) e quantos o cabeçalho tem (ou
 * a primeira linha, sem cabeçalho).
 */
export function shortRowText(row: { line: number; values: readonly (string | null)[] }, columns: number, header: boolean): string {
  let present = row.values.length;
  while (present > 0 && row.values[present - 1] === null) present--;
  return p.short(row.line, present, header, columns);
}

/** O arquivo sem nenhuma linha de dados não é recusa, mas não avança (RN-IMPORT-007). */
export function noRowsProblem(read: ImportRead): string | null {
  return read.rows.length === 0 ? p.noRows : null;
}
