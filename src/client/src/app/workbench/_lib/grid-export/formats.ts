import type { Engine } from "@/components/ui/engine-tag";

import { generateInsertInto } from "./generate-sql";
import { gridExportCopy } from "./grid-export.copy";
import type { GridSlice } from "./grid-slice";
import { csvOptions, toDelimited, tsvOptions } from "./to-delimited";
import { toHtml } from "./to-html";
import { toJson } from "./to-json";
import { toMarkdown } from "./to-markdown";
import { xlsxWorkbook } from "./to-xlsx";
import { toXml } from "./to-xml";

export type ExportFormatId = "csv" | "tsv" | "json" | "xlsx" | "html" | "markdown" | "xml" | "insert";

/**
 * O que um formato precisa além do recorte. `sheetName` é o nome da planilha do XLSX (sem ele, o padrão). Os comandos `INSERT` precisam do banco e do
 * que vai depois de `INSERT INTO`: `qualifiedTable(esquema, tabela)` nos Registros, ou o texto que o usuário escreveu na aba de consulta.
 */
export type ExportContext = { sheetName?: string; sql?: { engine: Engine; table: string } };

type Described = { id: ExportFormatId; label: string; extension: string; mimeType: string };

/**
 * Um formato de exportação (RN-GRADE-007). `build` monta a saída do recorte: texto nos formatos de texto (a tela o grava em UTF-8) e bytes no binário
 * (`binary: true`, o XLSX). `removed` diz quantos caracteres o formato não aceita e foram tirados ou cortados (XML e HTML; no XLSX, o que passou do limite da célula), para a tela avisar; é zero nos outros.
 */
export type ExportFormat = Described &
  (
    | { binary: false; build: (slice: GridSlice, context: ExportContext) => { content: string; removed: number } }
    | { binary: true; build: (slice: GridSlice, context: ExportContext) => { content: Uint8Array; removed: number } }
  );

const { formats } = gridExportCopy;

const byId: Record<ExportFormatId, ExportFormat> = {
  csv: { id: "csv", label: formats.csv, extension: "csv", mimeType: "text/csv;charset=utf-8", binary: false, build: (slice) => ({ content: toDelimited(slice, csvOptions), removed: 0 }) },
  tsv: { id: "tsv", label: formats.tsv, extension: "tsv", mimeType: "text/tab-separated-values;charset=utf-8", binary: false, build: (slice) => ({ content: toDelimited(slice, tsvOptions), removed: 0 }) },
  json: { id: "json", label: formats.json, extension: "json", mimeType: "application/json", binary: false, build: (slice) => ({ content: toJson(slice), removed: 0 }) },
  xlsx: {
    id: "xlsx",
    label: formats.xlsx,
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    binary: true,
    build: (slice, context) => xlsxWorkbook(slice, { sheetName: context.sheetName }),
  },
  html: {
    id: "html",
    label: formats.html,
    extension: "html",
    mimeType: "text/html;charset=utf-8",
    binary: false,
    build: (slice) => {
      const { text, removed } = toHtml(slice);
      return { content: text, removed };
    },
  },
  markdown: { id: "markdown", label: formats.markdown, extension: "md", mimeType: "text/markdown;charset=utf-8", binary: false, build: (slice) => ({ content: toMarkdown(slice), removed: 0 }) },
  xml: {
    id: "xml",
    label: formats.xml,
    extension: "xml",
    mimeType: "application/xml",
    binary: false,
    build: (slice) => {
      const { text, removed } = toXml(slice);
      return { content: text, removed };
    },
  },
  insert: {
    id: "insert",
    label: formats.insert,
    extension: "sql",
    mimeType: "application/sql",
    binary: false,
    build: (slice, context) => {
      if (context.sql === undefined) throw new TypeError("Os comandos INSERT precisam do banco e da tabela (context.sql).");
      return { content: generateInsertInto(slice, context.sql.engine, context.sql.table), removed: 0 };
    },
  },
};

/** Os formatos, na ordem do diálogo de exportar: CSV, TSV, JSON, XLSX, HTML, Markdown, XML e comandos INSERT. */
export const exportFormats: readonly ExportFormat[] = Object.values(byId);

export const exportFormatOf = (id: ExportFormatId): ExportFormat => byId[id];

/**
 * O nome que o diálogo de salvar propõe: `base` (o esquema e a tabela, ou o que a tela escolher) mais `.extensão`, com as regras de nome seguro do CSV
 * (`electron/file-name.ts`, a mesma função que o processo principal aplica ao nome que recebe, RN-EXPORT-019): o que o Windows não aceita vira `_`,
 * controle e marca de direção saem, nome de dispositivo ganha um `_` na frente, nada de ponto ou espaço no fim e até 120 pontos de código; sobrando
 * nada, `registros`.
 */
export { exportFileName } from "../../../../../electron/file-name";
