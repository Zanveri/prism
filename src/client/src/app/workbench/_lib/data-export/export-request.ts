import type { Engine } from "@/components/ui";

import { integerIn, type DataFormat, type FormatOptions } from "./export-options";
import type { ExportOrigin } from "./export-source";

/**
 * O corpo de `POST api/user/transfers/exports` (RN-EXPORT-016, seção 35, "Rotas e respostas"), com os nomes da API. Montado só aqui, de um estado já
 * conferido pela tela (a API confere de novo e recusa com `EXPORT_OPTIONS_INVALID` no campo).
 */

export type ExportRequestSource =
  | { kind: "table"; connectionID: string; database?: string; schema: string; table: string }
  | { kind: "query"; connectionID: string; database?: string; sql: string; filter?: string; name?: string };

export type ExportRequest = {
  source: ExportRequestSource;
  columns: { position: number; name: string }[];
  count: boolean;
  format: DataFormat;
  options: Record<string, unknown>;
  output: { bom: boolean; zip: boolean; entryName?: string; clipboard: boolean };
  windowID: number;
};

/** Uma coluna que vai no arquivo: a posição no resultado (a partir de 0; na tabela, a ordem do catálogo) e o nome. */
export type ChosenColumn = { position: number; name: string };

export type ExportDraft = {
  connectionId: string;
  database?: string;
  origin: ExportOrigin;
  engine: Engine | undefined;
  columns: readonly ChosenColumn[];
  count: boolean;
  format: DataFormat;
  options: FormatOptions;
  bom: boolean;
  zip: boolean;
  entryName: string | null;
  clipboard: boolean;
  windowId: number;
};

/** O texto como a API o espera: o vazio é a ausência (a tabela de destino vazia é a da origem; o esquema vazio, só a tabela). */
const orNull = (text: string) => (text === "" ? null : text);

/** As opções do formato escolhido, com os nomes e os valores da API (os números convertidos; no Informix, sempre 1 linha por comando). */
export function requestOptions(format: DataFormat, options: FormatOptions, engine: Engine | undefined): Record<string, unknown> {
  switch (format) {
    case "csv":
      return { ...options.csv };
    case "txt": {
      const { minWidth, maxWidth, ...rest } = options.txt;
      return { ...rest, minWidth: integerIn(minWidth, 1, 1000) ?? 3, maxWidth: integerIn(maxWidth, 0, 100_000) ?? 0 };
    }
    case "html":
      return { ...options.html };
    case "markdown":
      return { ...options.markdown };
    case "json":
      return { ...options.json };
    case "sourceCode":
      return { ...options.sourceCode };
    case "sql": {
      const o = options.sql;
      return { schema: orNull(o.schema), table: orNull(o.table), omitSchema: o.omitSchema, rowsPerStatement: engine === 3 ? 1 : (integerIn(o.rowsPerStatement, 1, 1000) ?? 10), binary: o.binary };
    }
    case "xml":
      return { ...options.xml };
    case "dbUnit":
      return { table: orNull(options.dbUnit.table), upperCase: options.dbUnit.upperCase, nulls: options.dbUnit.nulls, binary: options.dbUnit.binary };
    case "xlsx":
      return { ...options.xlsx };
  }
}

/** A origem como a API a lê: a tabela pelo navegador, ou o comando dos Registros e do resultado (com o filtro do resultado e o nome da tabela nos Registros). */
export function requestSource(connectionId: string, database: string | undefined, origin: ExportOrigin): ExportRequestSource {
  const place = { connectionID: connectionId, ...(database === undefined ? {} : { database }) };
  switch (origin.kind) {
    case "table":
      return { kind: "table", ...place, schema: origin.schema, table: origin.name };
    case "records":
      return { kind: "query", ...place, sql: origin.sql, name: origin.name };
    case "result":
      return { kind: "query", ...place, sql: origin.sql, ...(origin.filter === null || origin.filter === "" ? {} : { filter: origin.filter }) };
  }
}

/** O pedido inteiro. Com a área de transferência, nunca BOM nem .zip (a API recusaria, RN-EXPORT-014); no XLSX, nenhum dos três. */
export function exportRequest(draft: ExportDraft): ExportRequest {
  const text = draft.format !== "xlsx";
  const clipboard = text && draft.clipboard;
  const zip = text && !clipboard && draft.zip;
  return {
    source: requestSource(draft.connectionId, draft.database, draft.origin),
    columns: draft.columns.map(({ position, name }) => ({ position, name })),
    count: draft.count,
    format: draft.format,
    options: requestOptions(draft.format, draft.options, draft.engine),
    output: { bom: text && !clipboard && draft.bom, zip, ...(zip && draft.entryName !== null ? { entryName: draft.entryName } : {}), clipboard },
    windowID: draft.windowId,
  };
}

/** O limite do corpo do pedido (RN-EXPORT-015): 8 MiB em UTF-8. A tela confere antes de mandar e não manda o que passa. */
export const maxRequestBytes = 8 * 1024 * 1024;

export function requestBytes(request: ExportRequest): number {
  return new TextEncoder().encode(JSON.stringify(request)).length;
}
