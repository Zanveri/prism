import type { Engine } from "@/components/ui";
import type { ApiError } from "@/lib/api/prism-api";

import type { ExportChoices } from "./export-choices";
import { dataExportCopy } from "./data-export.copy";
import { expandFilePattern, filePatternProblem, outputNames, type FilePatternValues } from "./export-file-name";
import { extensionOf, formattingProblems, isTextFormat, type DataFormat, type FieldProblems, type FormatOptions } from "./export-options";
import type { ChosenColumn, ExportDraft } from "./export-request";
import { knowsGenerated, tableRequired, type ExportOrigin, type SourceColumn } from "./export-source";

/**
 * O assistente "Exportar dados" (RN-EXPORT-003 a 015) sem React: as etapas, o que cada uma deixa avançar, as colunas que vão no arquivo, o pedido que sai do
 * "Exportar" e onde cada recusa aparece. O componente só desenha e chama o que está aqui.
 */

export const wizardSteps = ["format", "extraction", "formatting", "output", "confirmation"] as const;

export type WizardStep = (typeof wizardSteps)[number];

/** O que a pessoa escolheu até aqui: as escolhas lembradas (RN-EXPORT-003) e as colunas marcadas, uma por coluna da origem, na ordem dela. */
export type WizardChoices = ExportChoices & { checked: readonly boolean[] | null };

/** Uma recusa que o assistente mostra: no campo (`field`, o caminho da API) ou no alto da Confirmação (`field` nulo), com o motivo. */
export type WizardRefusal = { field: string | null; message: string; driverID?: string };

/**
 * O que o assistente sabe da origem e da conexão, além das escolhas. `generatedUnknown`: nos Registros, enquanto o catálogo não disse quais colunas o banco
 * calcula, o motivo ("Lendo as colunas…", ou a mensagem do banco quando a leitura falhou); ausente ou nulo quando se sabe (a tabela tira as colunas do
 * próprio catálogo, e o resultado não tem a opção).
 */
export type WizardContext = { origin: ExportOrigin; engine: Engine | undefined; columns: readonly SourceColumn[] | null; generatedUnknown?: string | null };

/** As colunas que vão no arquivo (RN-EXPORT-002 e 011): as marcadas, na ordem da origem; no SQL sem "Incluir as colunas que o banco calcula", sem as que ele calcula sempre. */
export function chosenColumns(choices: WizardChoices, context: WizardContext): ChosenColumn[] {
  if (context.columns === null || choices.checked === null) return [];
  const dropGenerated = choices.format === "sql" && !choices.options.sql.includeGenerated && knowsGenerated(context.origin);
  return context.columns.flatMap((column, position) => (choices.checked?.[position] === true && !(dropGenerated && column.generated === "always") ? [{ position, name: column.name }] : []));
}

/** As colunas que o banco calcula e ficam fora dos `INSERT` (o aviso da Confirmação, RN-EXPORT-015). */
export function droppedGenerated(choices: WizardChoices, context: WizardContext): string[] {
  if (context.columns === null || choices.checked === null || choices.format !== "sql" || choices.options.sql.includeGenerated || !knowsGenerated(context.origin)) return [];
  return context.columns.flatMap((column, position) => (choices.checked?.[position] === true && column.generated === "always" ? [column.name] : []));
}

/**
 * RN-EXPORT-011: no SQL sem "Incluir as colunas que o banco calcula", a etapa espera o catálogo dizer quais são. Sem ele, a coluna que o banco calcula
 * sempre iria no `INSERT`, sem o aviso da Confirmação, e o banco de destino recusaria o comando. O motivo fica no próprio campo da opção.
 */
export function generatedProblem(choices: WizardChoices, context: WizardContext): string | null {
  if (choices.format !== "sql" || choices.options.sql.includeGenerated || !knowsGenerated(context.origin)) return null;
  return context.generatedUnknown ?? null;
}

/** As recusas da etapa Formatação, com o contexto que elas pedem. */
export function formattingProblemsOf(choices: WizardChoices, context: WizardContext): FieldProblems {
  const problems = formattingProblems(choices.format, choices.options, { engine: context.engine, tableRequired: tableRequired(context.origin), columns: chosenColumns(choices, context).map((column) => column.name) });
  const generated = generatedProblem(choices, context);
  return generated === null ? problems : { ...problems, "options.includeGenerated": generated };
}

/**
 * O motivo que a etapa Extração mostra na lista das colunas (RN-EXPORT-003 e 005): a recusa da API no campo `columns`, ou "Marque ao menos uma coluna.". O
 * "Avançar" desabilitado não recebe o foco, e a dica dele não chega ao leitor de tela: o motivo tem de estar no campo. Enquanto as colunas não chegam, a
 * etapa já diz "Lendo as colunas…" no lugar da lista.
 */
export function extractionProblem(choices: WizardChoices, context: WizardContext, apiProblem: string | null): string | null {
  if (apiProblem !== null) return apiProblem;
  if (context.columns === null || choices.checked === null) return null;
  return stepProblem("extraction", choices, context);
}

/** A área de transferência vale nos formatos de texto; no XLSX, não (RN-EXPORT-014). */
export const usesClipboard = (choices: Pick<WizardChoices, "format" | "clipboard">) => isTextFormat(choices.format) && choices.clipboard;

/** A recusa que segura cada etapa (o "Avançar" fica desabilitado): `null` quando ela deixa avançar. */
export function stepProblem(step: WizardStep, choices: WizardChoices, context: WizardContext): string | null {
  switch (step) {
    case "format":
      return null;
    case "extraction":
      if (context.columns === null || choices.checked === null) return dataExportCopy.extraction.loading;
      return choices.checked.some(Boolean) ? null : dataExportCopy.extraction.noneChecked;
    case "formatting":
      return Object.values(formattingProblemsOf(choices, context))[0] ?? null;
    case "output":
      return usesClipboard(choices) ? null : filePatternProblem(choices.pattern);
    case "confirmation":
      return null;
  }
}

/** As etapas anteriores levam de volta; as seguintes, não (RN-EXPORT-003). */
export function canVisit(step: WizardStep, current: WizardStep): boolean {
  return wizardSteps.indexOf(step) < wizardSteps.indexOf(current);
}

export function nextStep(step: WizardStep): WizardStep | null {
  return wizardSteps[wizardSteps.indexOf(step) + 1] ?? null;
}

export function previousStep(step: WizardStep): WizardStep | null {
  return wizardSteps[wizardSteps.indexOf(step) - 1] ?? null;
}

/** Os nomes que saem do padrão agora, com a extensão do formato (ou o .zip). */
export function fileNamesOf(choices: WizardChoices, values: FilePatternValues, now: Date) {
  const extension = extensionOf(choices.format, choices.options);
  const zip = !usesClipboard(choices) && isTextFormat(choices.format) && choices.zip;
  return { extension, zip, ...outputNames(expandFilePattern(choices.pattern, values, now), extension, zip) };
}

/** O rascunho do pedido, para `exportRequest`. */
export function draftOf(choices: WizardChoices, context: WizardContext & { connectionId: string; database?: string; windowId: number; entryName: string | null }): ExportDraft {
  const text = isTextFormat(choices.format);
  return {
    connectionId: context.connectionId,
    ...(context.database === undefined ? {} : { database: context.database }),
    origin: context.origin,
    engine: context.engine,
    columns: chosenColumns(choices, context),
    count: choices.count,
    format: choices.format,
    options: choices.options,
    bom: text && choices.bom[choices.format],
    zip: text && choices.zip,
    entryName: context.entryName,
    clipboard: text && choices.clipboard,
    windowId: context.windowId,
  };
}

/** O caminho do campo como a API o escreve (`Options.RowsPerStatement` ou `options.rowsPerStatement`), na forma da tela: cada parte com a inicial minúscula. */
export const fieldPathOf = (key: string) =>
  key
    .split(".")
    .map((part) => part.charAt(0).toLowerCase() + part.slice(1))
    .join(".");

/** A etapa de um campo da API: as opções do formato na Formatação; a saída na Saída; as colunas na Extração; o resto, no alto da Confirmação. */
export function stepOfField(field: string | null): WizardStep {
  if (field === null) return "confirmation";
  if (field.startsWith("options.") || field === "options") return "formatting";
  if (field.startsWith("output.") || field === "output") return "output";
  if (field === "columns" || field.startsWith("columns.") || field.startsWith("columns[")) return "extraction";
  return "confirmation";
}

const c = dataExportCopy.confirmation;

/**
 * Onde cada recusa do começo aparece (RN-EXPORT-015): a de campo (`EXPORT_OPTIONS_INVALID`), no campo; as outras, no alto da Confirmação, com a frase da tela
 * onde a especificação a escreve, e a da API nas que só chegam de um pedido montado errado. A conexão sem usuário ou sem senha vem na forma do erro de campo
 * (`userName` ou `password`) e fica no alto, com a frase de cada campo.
 */
export function refusalsOf(error: ApiError): WizardRefusal[] {
  const fieldErrors = Object.entries(error.errors ?? {}).flatMap(([key, messages]) => messages.map((message) => ({ field: fieldPathOf(key), message })));
  switch (error.code) {
    case "EXPORT_OPTIONS_INVALID":
      return fieldErrors.length === 0 ? [{ field: null, message: error.detail ?? error.title }] : fieldErrors;
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
    case "DRIVER_NOT_INSTALLED": {
      const driverID = typeof error.extensions.driverID === "string" ? error.extensions.driverID : undefined;
      return [{ field: null, message: error.detail ?? error.title, ...(driverID === undefined ? {} : { driverID }) }];
    }
    default:
      // EXPORT_SOURCE_NOT_READ (com o motivo no detalhe), FILTER_INVALID, MULTIPLE_STATEMENTS_NOT_SUPPORTED, DATABASE_NAME_INVALID: a mensagem da API.
      return [{ field: null, message: error.detail ?? error.title }];
  }
}

/**
 * Os campos que o assistente desenha no formato escolhido, onde a recusa de campo da API aparece: as colunas (na Extração), o nome dentro do .zip (na
 * Saída) e as opções que a Formatação mostra com um campo de texto. As linhas por comando do Informix ficam fixas em 1, sem recusa no campo.
 */
export function fieldsShown(format: DataFormat, engine: Engine | undefined): ReadonlySet<string> {
  const fields = ["columns", "output.entryName"];
  switch (format) {
    case "csv":
    case "markdown":
      fields.push("options.nullText");
      break;
    case "txt":
      fields.push("options.minWidth", "options.maxWidth");
      break;
    case "sql":
      fields.push("options.schema", "options.table", ...(engine === 3 ? [] : ["options.rowsPerStatement"]));
      break;
    case "dbUnit":
      fields.push("options.table");
      break;
    default:
      break;
  }
  return new Set(fields);
}

/**
 * A recusa de campo que o assistente não tem onde mostrar (o comando de mais de 1 MB em `source.sql`, o `format`, o `windowID`, uma opção de escolha) vai ao
 * alto da Confirmação, com a frase da API: sem isso ela iria para um campo que não existe, e o "Exportar" voltaria sem dizer nada (RN-EXPORT-015).
 */
export function placeRefusals(refusals: readonly WizardRefusal[], format: DataFormat, engine: Engine | undefined): WizardRefusal[] {
  const shown = fieldsShown(format, engine);
  return refusals.map((refusal) => (refusal.field === null || shown.has(refusal.field) ? refusal : { ...refusal, field: null }));
}

/** As escolhas que se lembram, a partir do estado do assistente (sem as colunas, que são da origem). */
export function choicesToRemember(choices: WizardChoices): ExportChoices {
  const { format, options, bom, count, pattern, zip, reveal, clipboard } = choices;
  return { format, options, bom, count, pattern, zip, reveal, clipboard };
}

/** "Voltar aos padrões" da Formatação: as opções do formato escolhido voltam aos padrões dele, com a tabela de destino da origem. */
export function resetFormat(options: FormatOptions, format: DataFormat, defaults: FormatOptions): FormatOptions {
  return { ...options, [format]: defaults[format] };
}
