import type { ApiError } from "@/lib/api/prism-api";

import { fieldPathOf, type WizardRefusal } from "../data-export/export-wizard";
import { dataImportCopy } from "./data-import.copy";
import type { DelimitedChoices } from "./import-choices";
import type { ImportFormat } from "./imports.schema";

/**
 * O assistente "Importar dados" sem React (RN-IMPORT-002 a 013): as etapas, a recusa dos campos do leitor e onde cada recusa da API aparece. O estado e os
 * pedidos são do `createImportFlow` (`import-flow.ts`); a tela só desenha.
 */

export const importSteps = ["file", "mapping", "load", "confirmation"] as const;

export type ImportStep = (typeof importSteps)[number];

/** As etapas anteriores levam de volta; as seguintes, não (RN-IMPORT-002, como no "Exportar dados"). */
export function canVisitImport(step: ImportStep, current: ImportStep): boolean {
  return importSteps.indexOf(step) < importSteps.indexOf(current);
}

export function nextImportStep(step: ImportStep): ImportStep | null {
  return importSteps[importSteps.indexOf(step) + 1] ?? null;
}

export function previousImportStep(step: ImportStep): ImportStep | null {
  return importSteps[importSteps.indexOf(step) - 1] ?? null;
}

// eslint-disable-next-line no-control-regex
const control = /[\u0000-\u001f\u007f-\u009f]/;

/** A recusa do "Texto do nulo" (RN-IMPORT-004): até 100 caracteres e sem caractere de controle. */
export function nullTextProblem(text: string): string | null {
  if (control.test(text)) return dataImportCopy.problems.nullTextControl;
  if ([...text].length > 100) return dataImportCopy.problems.nullTextLength;
  return null;
}

/** As recusas dos campos do leitor que a tela confere antes de pedir a leitura; só o CSV e o TSV têm campo de texto. */
export function readerProblems(format: ImportFormat, reader: DelimitedChoices | null): Record<string, string> {
  if ((format !== "csv" && format !== "tsv") || reader === null) return {};
  const nullText = nullTextProblem(reader.nullText);
  return nullText === null ? {} : { "reader.nullText": nullText };
}

/** A etapa de um campo da API: o leitor e os valores no Arquivo, o mapeamento no Mapeamento, a carga na Carga; o resto, no alto da Confirmação. */
export function stepOfImportField(field: string | null): ImportStep {
  if (field === null) return "confirmation";
  if (field === "reader" || field.startsWith("reader.") || field === "values" || field.startsWith("values.") || field === "format" || field === "fileID") return "file";
  if (field === "mapping" || field.startsWith("mapping[") || field.startsWith("mapping.")) return "mapping";
  if (field === "load" || field.startsWith("load.")) return "load";
  return "confirmation";
}

/** Os campos que o assistente desenha com um campo de texto, onde a recusa de campo aparece; a de outro campo vai ao alto da Confirmação. */
export const importFieldsShown: ReadonlySet<string> = new Set(["reader.nullText", "load.commitEvery"]);

const c = dataImportCopy.confirmation;

/**
 * Onde cada recusa do começo aparece (RN-IMPORT-013): a de campo (`IMPORT_OPTIONS_INVALID`) no campo que o assistente desenha, ou no alto da Confirmação; a
 * conexão sem usuário ou sem senha, a frase de cada campo; o limite, a conexão que não existe mais e o somente leitura, as frases da tela; o resto, a frase da
 * API. O arquivo que sumiu (`IMPORT_FILE_MISSING`) é tratado à parte: leva de volta ao Arquivo.
 */
export function importRefusalsOf(error: ApiError): WizardRefusal[] {
  const fieldErrors = Object.entries(error.errors ?? {}).flatMap(([key, messages]) => messages.map((message) => ({ field: fieldPathOf(key), message })));
  switch (error.code) {
    case "IMPORT_OPTIONS_INVALID":
    case "IMPORT_MAPPING_INVALID":
      return fieldErrors.length === 0 ? [{ field: null, message: error.detail ?? error.title }] : fieldErrors.map((refusal) => (importFieldsShown.has(refusal.field) ? refusal : { ...refusal, field: null }));
    case "CONNECTION_CREDENTIALS_MISSING": {
      const fields = new Set(fieldErrors.map((refusal) => refusal.field));
      const refusals: WizardRefusal[] = [];
      if (fields.has("userName")) refusals.push({ field: null, message: c.userNameMissing });
      if (fields.has("password") || refusals.length === 0) refusals.push({ field: null, message: c.passwordMissing });
      return refusals;
    }
    case "TRANSFER_LIMIT_REACHED":
      return [{ field: null, message: c.limitReached }];
    case "CONNECTION_NOT_FOUND":
      return [{ field: null, message: c.connectionMissing }];
    case "CONNECTION_READ_ONLY":
      return [{ field: null, message: dataImportCopy.mapping.readOnly }];
    case "DRIVER_NOT_INSTALLED": {
      const driverID = typeof error.extensions.driverID === "string" ? error.extensions.driverID : undefined;
      return [{ field: null, message: error.detail ?? error.title, ...(driverID === undefined ? {} : { driverID }) }];
    }
    default:
      // IMPORT_TARGET_BUSY ("Já há uma importação para … em andamento."), IMPORT_FILE_TOO_LARGE, DATABASE_NAME_INVALID: a frase da API.
      return [{ field: null, message: error.detail ?? error.title }];
  }
}

/**
 * A frase da recusa de uma prévia (a leitura do arquivo ou a convertida), que aparece no lugar dela (RN-IMPORT-007 e 009): as da tabela e do somente leitura
 * com a frase da tela; a falha do banco, com a mensagem dele (e "Tentar de novo", `retry`); a conexão sem usuário ou sem senha, a frase da exportação com
 * "importe de novo"; o resto, a frase da API, com a linha do arquivo quando a API a dá e a frase não a traz.
 */
export function previewRefusalOf(error: ApiError, place: { schema: string; table: string }): { message: string; retry: boolean; driverID?: string } {
  switch (error.code) {
    case "IMPORT_TABLE_NOT_FOUND":
      return { message: dataImportCopy.mapping.tableMissing(place.schema, place.table), retry: false };
    case "CONNECTION_READ_ONLY":
      return { message: dataImportCopy.mapping.readOnly, retry: false };
    case "CONNECTION_NOT_FOUND":
      return { message: c.connectionMissing, retry: false };
    case "DATABASE_CONNECTION_FAILED":
    case "SQL_EXECUTION_FAILED": {
      const sqlState = typeof error.extensions.sqlState === "string" ? error.extensions.sqlState : null;
      const message = error.detail ?? error.title;
      return { message: sqlState === null ? message : `${message} (SQLSTATE ${sqlState})`, retry: true };
    }
    case "CONNECTION_CREDENTIALS_MISSING":
      return { message: importRefusalsOf(error).map((refusal) => refusal.message).join(" "), retry: false };
    case "DRIVER_NOT_INSTALLED": {
      const driverID = typeof error.extensions.driverID === "string" ? error.extensions.driverID : undefined;
      return { message: error.detail ?? error.title, retry: false, ...(driverID === undefined ? {} : { driverID }) };
    }
    case "IMPORT_OPTIONS_INVALID":
    case "IMPORT_MAPPING_INVALID": {
      const first = Object.values(error.errors ?? {})[0]?.[0];
      return { message: first ?? error.detail ?? error.title, retry: false };
    }
    default:
      return { message: error.detail ?? error.title, retry: false };
  }
}
