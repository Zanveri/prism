import { z } from "zod";

import { commitEveryOf, type CommitChoices } from "../data-import/import-choices";

import { defaultFilePattern, filePatternProblem } from "./export-file-name";
import { dataFormats, defaultBom, defaultOptions, integerIn, type DataFormat, type FormatOptions } from "./export-options";

/**
 * As escolhas da última exportação, lembradas por usuário nas preferências desta instalação (RN-EXPORT-003, RN-CONFIG-001): o formato, as opções de cada
 * formato (com o "Incluir BOM" de cada um), "Contar as linhas antes", o padrão do nome, "Compactar em .zip", "Mostrar na pasta ao terminar" e a área de
 * transferência. As colunas e a tabela de destino do SQL e do DbUnit são da origem e não se lembram. Numa chave própria do `localStorage`
 * (`prism:data-export:<usuário>`), como o navegador escondido, com a leitura tolerante campo a campo: a escolha lembrada que não vale mais (um formato que
 * não existe, um valor fora da faixa) volta ao padrão, sem erro. Nada de segredo nem de dado de conexão passa por aqui.
 *
 * Com o destino "Banco de dados" (RN-IMPORT-022): `database` diz que foi ele o escolhido (o formato de arquivo de antes continua lembrado, para a troca de
 * volta), e `copyLoad`, a escolha do "Commit" da Carga. A conexão e a tabela de destino, e "Esvaziar a tabela antes de copiar", não se lembram.
 */

export type ExportChoices = {
  format: DataFormat;
  options: FormatOptions;
  bom: Record<DataFormat, boolean>;
  count: boolean;
  pattern: string;
  zip: boolean;
  reveal: boolean;
  clipboard: boolean;
  database: boolean;
  copyLoad: CommitChoices;
};

export const exportChoicesKey = (userName: string) => `prism:data-export:${userName.trim().toLowerCase()}`;

const blank = defaultOptions({ schema: "", table: "" });

// eslint-disable-next-line no-control-regex
const control = /[\u0000-\u001f\u007f-\u009f]/;
const nullText = (fallback: string) => z.string().max(100).refine((text) => !control.test(text)).catch(fallback);
const binary = z.enum(["hex", "null"]).catch("hex");
const flag = (fallback: boolean) => z.boolean().catch(fallback);
const lineBreak = z.enum(["crlf", "lf"]).catch("crlf");
const integerText = (min: number, max: number, fallback: string) => z.string().refine((text) => integerIn(text, min, max) !== null).catch(fallback);

const optionsSchema = z.object({
  csv: z.object({ delimiter: z.enum([";", ",", "\t", "|"]).catch(";"), header: flag(true), quoting: z.enum(["auto", "text", "all"]).catch("auto"), formulaGuard: flag(true), lineBreak, nullText: nullText(""), binary }).catch(blank.csv),
  txt: z
    .object({ header: flag(true), headerLine: flag(true), edgeDelimiters: flag(true), minWidth: integerText(1, 1000, "3"), maxWidth: integerText(0, 100_000, "0"), showNull: flag(false), lineBreak, binary })
    // A máxima abaixo da mínima não vale mais: as duas voltam ao padrão.
    .transform((txt) => {
      const max = integerIn(txt.maxWidth, 0, 100_000) ?? 0;
      const min = integerIn(txt.minWidth, 1, 1000) ?? 3;
      return max > 0 && max < min ? { ...txt, minWidth: "3", maxWidth: "0" } : txt;
    })
    .catch(blank.txt),
  html: z.object({ title: flag(true), columnNames: flag(true), binary }).catch(blank.html),
  markdown: z.object({ alignmentLine: flag(true), nullText: nullText(""), binary }).catch(blank.markdown),
  json: z.object({ wrap: flag(true), isoDates: flag(true), binary }).catch(blank.json),
  sourceCode: z.object({ php: z.enum(["legacy", "short"]).catch("legacy"), quote: z.enum(["double", "single"]).catch("double"), isoDates: flag(true), binary }).catch(blank.sourceCode),
  sql: z.object({ omitSchema: flag(false), rowsPerStatement: integerText(1, 1000, "10"), includeGenerated: flag(false), binary: z.enum(["literal", "null"]).catch("literal") }).catch({ omitSchema: false, rowsPerStatement: "10", includeGenerated: false, binary: "literal" as const }),
  xml: z.object({ doctype: flag(false), binary }).catch(blank.xml),
  dbUnit: z.object({ upperCase: flag(true), nulls: z.enum(["omit", "mark"]).catch("omit"), binary }).catch({ upperCase: true, nulls: "omit" as const, binary: "hex" as const }),
  xlsx: z.object({ binary }).catch(blank.xlsx),
});

const bomDefaults = defaultBom();
const bomSchema = z.object(Object.fromEntries(dataFormats.map((format) => [format, flag(bomDefaults[format])])) as Record<DataFormat, z.ZodCatch<z.ZodBoolean>>).catch(bomDefaults);

const choicesSchema = z.object({
  format: z.enum(dataFormats).catch("csv"),
  options: optionsSchema.catch(optionsSchema.parse({})),
  bom: bomSchema,
  count: flag(true),
  pattern: z.string().refine((pattern) => filePatternProblem(pattern) === null).catch(defaultFilePattern),
  zip: flag(false),
  reveal: flag(false),
  clipboard: flag(false),
  database: flag(false),
  copyLoad: z
    .object({
      commit: z.enum(["every", "single"]).catch("every"),
      commitEvery: z
        .string()
        .refine((text) => commitEveryOf(text) !== null)
        .catch("10000"),
    })
    .catch({ commit: "every" as const, commitEvery: "10000" }),
});

/** O texto gravado como objeto: o JSON que não se lê, e o que não é um objeto (uma lista também é `object` no JavaScript), valem "nada gravado". */
export function storedObject(raw: string | null): object {
  let value: unknown;
  try {
    value = raw === null ? {} : JSON.parse(raw);
  } catch {
    value = {};
  }
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/** A tabela de destino do SQL e do DbUnit, que é da origem, posta nas opções lidas. */
const withTarget = (options: z.infer<typeof optionsSchema>, target: { schema: string; table: string }): FormatOptions => ({
  ...options,
  sql: { ...options.sql, schema: target.schema, table: target.table },
  dbUnit: { ...options.dbUnit, table: target.table },
});

/**
 * As opções de cada formato lidas de um valor gravado qualquer, campo a campo, com o padrão no que não confere, e a tabela de destino da origem
 * (`target`). Também as do "Copiar como", que se lembram à parte com a mesma forma (RN-GRADE-017).
 */
export function parseFormatOptions(value: unknown, target: { schema: string; table: string }): FormatOptions {
  const result = optionsSchema.safeParse(value);
  return withTarget(result.success ? result.data : optionsSchema.parse({}), target);
}

/** As opções como se gravam: tudo menos a tabela de destino do SQL e do DbUnit, que é da origem. */
export function rememberedFormatOptions(options: FormatOptions): object {
  const { omitSchema, rowsPerStatement, includeGenerated, binary: sqlBinary } = options.sql;
  const { upperCase, nulls, binary: dbUnitBinary } = options.dbUnit;
  return { ...options, sql: { omitSchema, rowsPerStatement, includeGenerated, binary: sqlBinary }, dbUnit: { upperCase, nulls, binary: dbUnitBinary } };
}

/**
 * As escolhas lembradas, com a tabela de destino do SQL e do DbUnit da origem (`target`). O que está gravado pode ser qualquer coisa (editado à mão, de uma
 * versão anterior, cortado): nunca lança, e o campo que não vale volta ao padrão dele.
 */
export function parseExportChoices(raw: string | null, target: { schema: string; table: string }): ExportChoices {
  const result = choicesSchema.safeParse(storedObject(raw));
  const parsed = result.success ? result.data : choicesSchema.parse({});
  return { ...parsed, options: withTarget(parsed.options, target) };
}

/** O que se grava: tudo menos a tabela de destino, que é da origem. */
export function serializeExportChoices(choices: ExportChoices): string {
  return JSON.stringify({ ...choices, options: rememberedFormatOptions(choices.options) });
}

type ChoicesStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): ChoicesStorage | null => (typeof localStorage === "undefined" ? null : localStorage);

/** Lê as escolhas do usuário. O armazenamento que falta, recusa ou lança vale "nada lembrado". */
export function readExportChoices(userName: string | null, target: { schema: string; table: string }, storage: () => ChoicesStorage | null = browserStorage): ExportChoices {
  let raw: string | null;
  try {
    raw = userName === null ? null : (storage()?.getItem(exportChoicesKey(userName)) ?? null);
  } catch {
    raw = null;
  }
  return parseExportChoices(raw, target);
}

/** Grava as escolhas de agora (no "Exportar"). Gravar que falha não impede nada: a escolha só não é lembrada. */
export function writeExportChoices(userName: string | null, choices: ExportChoices, storage: () => ChoicesStorage | null = browserStorage): void {
  if (userName === null) return;
  try {
    storage()?.setItem(exportChoicesKey(userName), serializeExportChoices(choices));
  } catch {
    // Sem armazenamento: a escolha vale só nesta vez.
  }
}
