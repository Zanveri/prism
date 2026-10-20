import { z } from "zod";

import { importDelimiters, importEncodings, type ImportDelimiter, type ImportEncoding, type ImportValues } from "./imports.schema";

/**
 * As escolhas da importação que ficam lembradas por usuário, nas preferências desta instalação (RN-IMPORT-002, como as do "Exportar dados"): as opções do
 * leitor de cada formato, os formatos dos valores e, na Carga, a escolha do "Commit" e "Conferir o arquivo inteiro antes de gravar". Não se lembram o arquivo,
 * o formato (vem da extensão), a planilha, o mapeamento e "Esvaziar a tabela antes de importar", que começa sempre desligado. Numa chave própria do
 * `localStorage` (`prism:data-import:<usuário>`), com a leitura tolerante campo a campo: o valor que não vale mais volta ao padrão, sem erro.
 */

export type DelimitedChoices = {
  encoding: ImportEncoding;
  header: boolean;
  quote: "double" | "none";
  nullText: string;
  emptyAsNull: boolean;
  trim: boolean;
  skipEmptyLines: boolean;
  unguardFormulas: boolean;
};

export type CsvChoices = DelimitedChoices & { delimiter: ImportDelimiter };

export type XlsxChoices = { header: boolean; skipEmptyLines: boolean };

/** A escolha do "Commit" (RN-IMPORT-012): "A cada N linhas", com o N como texto até o pedido, ou "Tudo numa transação só". */
export type CommitChoices = { commit: "every" | "single"; commitEvery: string };

export type LoadChoices = CommitChoices & { check: boolean };

export type ImportChoices = { csv: CsvChoices; tsv: DelimitedChoices; xlsx: XlsxChoices; values: ImportValues; load: LoadChoices };

/** Os padrões (RN-IMPORT-004 a 007 e 012). "Tirar o apóstrofo da proteção contra fórmula" vem ligado (decisão de projeto, a confirmar com o dono). */
export function defaultImportChoices(): ImportChoices {
  const delimited: DelimitedChoices = { encoding: "auto", header: true, quote: "double", nullText: "", emptyAsNull: false, trim: false, skipEmptyLines: true, unguardFormulas: true };
  return {
    csv: { ...delimited, delimiter: "auto" },
    tsv: { ...delimited },
    xlsx: { header: true, skipEmptyLines: true },
    values: { decimal: "point", thousandsDot: false, dates: "iso" },
    load: { commit: "every", commitEvery: "10000", check: true },
  };
}

export const importChoicesKey = (userName: string) => `prism:data-import:${userName.trim().toLowerCase()}`;

// eslint-disable-next-line no-control-regex
const control = /[\u0000-\u001f\u007f-\u009f]/;
const flag = (fallback: boolean) => z.boolean().catch(fallback);

/** O número de linhas por commit, de 1 a 1.000.000 (RN-IMPORT-012), escrito só com dígitos. */
export function commitEveryOf(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,7}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= 1_000_000 ? value : null;
}

const defaults = defaultImportChoices();

const delimitedSchema = z.object({
  encoding: z.enum(importEncodings).catch(defaults.tsv.encoding),
  header: flag(true),
  quote: z.enum(["double", "none"]).catch("double"),
  nullText: z
    .string()
    .max(100)
    .refine((text) => !control.test(text))
    .catch(""),
  emptyAsNull: flag(false),
  trim: flag(false),
  skipEmptyLines: flag(true),
  unguardFormulas: flag(true),
});

const choicesSchema = z.object({
  csv: delimitedSchema.extend({ delimiter: z.enum(importDelimiters).catch("auto") }).catch(defaults.csv),
  tsv: delimitedSchema.catch(defaults.tsv),
  xlsx: z.object({ header: flag(true), skipEmptyLines: flag(true) }).catch(defaults.xlsx),
  values: z
    .object({ decimal: z.enum(["point", "comma"]).catch("point"), thousandsDot: flag(false), dates: z.enum(["iso", "dayMonthYear"]).catch("iso") })
    // "Aceitar o ponto como separador de milhar" só vale com a vírgula decimal.
    .transform((values) => (values.decimal === "point" ? { ...values, thousandsDot: false } : values))
    .catch(defaults.values),
  load: z
    .object({
      commit: z.enum(["every", "single"]).catch("every"),
      commitEvery: z
        .string()
        .refine((text) => commitEveryOf(text) !== null)
        .catch("10000"),
      check: flag(true),
    })
    .catch(defaults.load),
});

type ChoicesStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): ChoicesStorage | null => (typeof localStorage === "undefined" ? null : localStorage);

/** As escolhas gravadas, campo a campo; o que não confere (de uma versão anterior, cortado, editado à mão) volta ao padrão. Nunca lança. */
export function parseImportChoices(raw: string | null): ImportChoices {
  let value: unknown;
  try {
    value = raw === null ? {} : JSON.parse(raw);
  } catch {
    value = {};
  }
  const record = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  const parsed = choicesSchema.safeParse(record);
  return parsed.success ? parsed.data : choicesSchema.parse({});
}

export function readImportChoices(userName: string | null, storage: () => ChoicesStorage | null = browserStorage): ImportChoices {
  let raw: string | null;
  try {
    raw = userName === null ? null : (storage()?.getItem(importChoicesKey(userName)) ?? null);
  } catch {
    raw = null;
  }
  return parseImportChoices(raw);
}

/** Grava as escolhas de agora (no "Importar" aceito). Gravar que falha não impede nada. */
export function writeImportChoices(userName: string | null, choices: ImportChoices, storage: () => ChoicesStorage | null = browserStorage): void {
  if (userName === null) return;
  try {
    storage()?.setItem(importChoicesKey(userName), JSON.stringify(choices));
  } catch {
    // Sem armazenamento: a escolha vale só nesta vez.
  }
}
