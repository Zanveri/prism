import { z } from "zod";

import type { ExportRequestSource } from "../data-export/export-request";

/**
 * Os pedidos e as respostas da importação de dados e da cópia para outro banco (seção 36, "Rotas e respostas"), com os nomes da API: os identificadores
 * terminam em `ID` (`fileID`, `connectionID`, `windowID`). As respostas exigem o que a tela decide e mostra; o resto é tolerado (o campo que esta versão
 * não conhece, a classe nova de uma coluna), para uma API um pouco mais nova não derrubar o assistente.
 */

export const importFormats = ["csv", "tsv", "json", "xlsx"] as const;

export type ImportFormat = (typeof importFormats)[number];

/** As codificações que a pessoa escolhe (RN-IMPORT-004); `auto` só vai no pedido, e a resposta diz qual achou. */
export const importEncodings = ["auto", "utf-8", "utf-16le", "utf-16be", "windows-1252", "iso-8859-1"] as const;

export type ImportEncoding = (typeof importEncodings)[number];

export type DetectedEncoding = Exclude<ImportEncoding, "auto">;

export const importDelimiters = ["auto", ";", ",", "\t", "|"] as const;

export type ImportDelimiter = (typeof importDelimiters)[number];

/** As opções do leitor do CSV e do TSV (no TSV, `delimiter` ausente ou `"\t"`). */
export type DelimitedReader = {
  encoding: ImportEncoding;
  delimiter?: ImportDelimiter;
  header: boolean;
  quote: "double" | "none";
  nullText: string;
  emptyAsNull: boolean;
  trim: boolean;
  skipEmptyLines: boolean;
  unguardFormulas: boolean;
};

/** O JSON: as chaves que o `imports/read` achou, de volta nos pedidos seguintes (ausentes no `imports/read`). */
export type JsonReader = { keys?: string[] };

/** O XLSX: a planilha (ausente, a primeira que não é oculta), o cabeçalho e as linhas vazias. */
export type XlsxReader = { sheet?: string; header: boolean; skipEmptyLines: boolean };

export type ImportReader = DelimitedReader | JsonReader | XlsxReader;

/** Os formatos dos valores (RN-IMPORT-007). `thousandsDot` só vale com `comma`. */
export type ImportValues = { decimal: "point" | "comma"; thousandsDot: boolean; dates: "iso" | "dayMonthYear" };

/** A tabela de destino, como está no catálogo; `database`, o outro banco do servidor (RN-ARVORE-006). */
export type ImportTarget = { connectionID: string; database?: string; schema: string; table: string };

/** Uma coluna do arquivo (ou da origem, na cópia), pela posição a partir de 0, para uma coluna da tabela, pelo nome. */
export type MappingEntry = { source: number; target: string };

/** A carga (RN-IMPORT-012): `commitEvery` nulo é "Tudo numa transação só"; `check` só na importação. */
export type ImportLoad = { empty: boolean; commitEvery: number | null; check: boolean };

export type CopyLoad = { empty: boolean; commitEvery: number | null };

export type ImportReadRequest = { fileID: string; format: ImportFormat; reader: ImportReader };

export type ImportPreviewRequest = ImportReadRequest & { values: ImportValues; target: ImportTarget; mapping?: MappingEntry[] };

export type ImportStartRequest = ImportReadRequest & { values: ImportValues; target: ImportTarget; mapping: MappingEntry[]; load: ImportLoad; windowID: number };

export type CopyColumn = { position: number; name: string };

export type CopyPreviewRequest = { source: ExportRequestSource; columns: CopyColumn[]; target: ImportTarget; mapping?: MappingEntry[] };

export type CopyStartRequest = { source: ExportRequestSource; columns: CopyColumn[]; count: boolean; target: ImportTarget; mapping: MappingEntry[]; load: CopyLoad; windowID: number };

const cell = z.string().nullable();

/** Uma linha da prévia do arquivo: a linha do arquivo (a da planilha, o item da lista), os valores como foram lidos e se ela foi completada com nulo. */
export const readRowSchema = z.object({ line: z.number().int().min(0), values: z.array(cell), short: z.boolean().catch(false) });

/** A resposta de `imports/read` (RN-IMPORT-007): o que a leitura achou e as primeiras 20 linhas, como foram lidas. */
export const importReadSchema = z.object({
  encoding: z
    .object({ name: z.enum(["utf-8", "utf-16le", "utf-16be", "windows-1252", "iso-8859-1"]), bom: z.boolean() })
    .nullish()
    .catch(null),
  delimiter: z.string().nullish().catch(null),
  listKey: z.string().nullish().catch(null),
  sheets: z
    .array(z.object({ name: z.string(), hidden: z.boolean().catch(false) }))
    .nullish()
    .catch(null),
  sheet: z.string().nullish().catch(null),
  columns: z.array(z.string()),
  shownColumns: z.number().int().min(0),
  rows: z.array(readRowSchema),
});

export type ImportRead = z.infer<typeof importReadSchema>;

/**
 * A classe de uma coluna da tabela (RN-IMPORT-010), que decide a conversão. A classe que esta versão não conhece vale `other`: a tela só a usa para as
 * notas da cópia e a nota do `money`, e quem converte é a API.
 */
export const columnClasses = ["text", "number", "date", "dateTime", "time", "boolean", "binary", "other"] as const;

export type ColumnClass = (typeof columnClasses)[number];

export const tableColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  defaultValue: z.string().nullish().catch(null),
  generated: z.enum(["always", "byDefault"]).nullish().catch(null),
  class: z.enum(columnClasses).catch("other"),
  importable: z.boolean(),
  reason: z.string().nullish().catch(null),
});

export type TableColumn = z.infer<typeof tableColumnSchema>;

export const deleteRules = ["cascade", "setNull", "setDefault", "restrict", "noAction"] as const;

export type DeleteRule = (typeof deleteRules)[number];

/** A tabela de destino como a prévia a lê no catálogo (RN-IMPORT-009 e 012), com as chaves de outras tabelas que apontam para ela. */
export const importTableSchema = z.object({
  schema: z.string(),
  name: z.string(),
  /** O Informix sem log (RN-EDIT-012): cada linha gravada sozinha, sem transação. */
  oneAtATime: z.boolean().catch(false),
  columns: z.array(tableColumnSchema),
  referencedBy: z
    .array(z.object({ schema: z.string(), table: z.string(), onDelete: z.enum(deleteRules).catch("noAction") }))
    .catch([]),
});

export type ImportTable = z.infer<typeof importTableSchema>;

export const mappingSchema = z.array(z.object({ source: z.number().int().min(0), target: z.string() }));

/** Uma célula da prévia convertida: o valor como vai ao banco (o texto canônico, ou nulo) e, quando não converte, o motivo. */
export const previewCellSchema = z.object({ value: cell, problem: z.string().nullish().catch(null) });

export const previewRowSchema = z.object({
  line: z.number().int().min(0),
  /** O problema da linha inteira (os valores a mais, o item que não é objeto, a chave repetida, o erro do Excel), ou nulo. */
  problem: z.string().nullish().catch(null),
  short: z.boolean().catch(false),
  /** Uma por coluna mapeada que cabe (as primeiras `shownColumns` do mapeamento), na ordem dele. */
  cells: z.array(previewCellSchema),
});

export type PreviewRow = z.infer<typeof previewRowSchema>;

/** A resposta de `imports/preview` (RN-IMPORT-011): a tabela, as colunas do arquivo, o mapeamento (o mandado, ou o sugerido) e a prévia convertida. */
export const importPreviewSchema = z.object({
  table: importTableSchema,
  columns: z.array(z.string()),
  mapping: mappingSchema,
  shownColumns: z.number().int().min(0),
  rows: z.array(previewRowSchema),
});

export type ImportPreview = z.infer<typeof importPreviewSchema>;

/** A resposta de `copies/preview` (RN-IMPORT-024): a tabela de destino e o mapeamento; a origem não é lida. */
export const copyPreviewSchema = z.object({ table: importTableSchema, mapping: mappingSchema });

export type CopyPreview = z.infer<typeof copyPreviewSchema>;

/** Os motivos de `IMPORT_FILE_UNREADABLE` (seção 36, notas): a tela mostra a frase da API, sem caminho, e a linha quando vem. */
export const unreadableReasons = ["encoding", "format", "sheet", "limits", "system"] as const;
