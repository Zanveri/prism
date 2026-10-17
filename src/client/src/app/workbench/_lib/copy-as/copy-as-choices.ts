import { parseFormatOptions, rememberedFormatOptions, storedObject } from "../data-export/export-choices";
import type { FormatOptions } from "../data-export/export-options";
import { documentFormats, type DocumentFormat } from "../grid-export/document";

/**
 * As escolhas do "Copiar como" (RN-GRADE-017) e do "Copiar avançado…" (RN-GRADE-003), lembradas por usuário nas preferências desta instalação
 * (RN-CONFIG-001), numa chave própria do `localStorage` (`prism:copy-as:<usuário>`), separada da que a exportação lembra (RN-EXPORT-003): o arquivo e a área
 * de transferência costumam pedir coisas diferentes, e mudar uma não muda a outra. Começam nos padrões da exportação. Guardam o último formato do diálogo
 * "Copiar avançado…" e as opções de cada formato; a tabela de destino do SQL e do DbUnit é da origem e não se lembra. A leitura é tolerante campo a campo,
 * como a das escolhas da exportação: a opção lembrada que não vale mais volta ao padrão, sem erro. Nada de segredo nem de dado de conexão passa por aqui.
 */

export type CopyAsChoices = { format: DocumentFormat; options: FormatOptions };

/** A tabela de destino do SQL e do DbUnit da origem: a dos Registros, ou a do alvo da edição de um resultado de uma tabela só; vazia quando não se sabe. */
export type CopyTarget = { schema: string; table: string };

export const noTarget: CopyTarget = { schema: "", table: "" };

export const copyAsChoicesKey = (userName: string) => `prism:copy-as:${userName.trim().toLowerCase()}`;

const isDocumentFormat = (value: unknown): value is DocumentFormat => typeof value === "string" && (documentFormats as readonly string[]).includes(value);

/** As escolhas gravadas, com a tabela de destino da origem. O que está gravado pode ser qualquer coisa: nunca lança, e o que não vale volta ao padrão. */
export function parseCopyAsChoices(raw: string | null, target: CopyTarget = noTarget): CopyAsChoices {
  const record = storedObject(raw) as { format?: unknown; options?: unknown };
  return { format: isDocumentFormat(record.format) ? record.format : "csv", options: parseFormatOptions(record.options, target) };
}

/** O que se grava: o formato e as opções, sem a tabela de destino. */
export function serializeCopyAsChoices(choices: CopyAsChoices): string {
  return JSON.stringify({ format: choices.format, options: rememberedFormatOptions(choices.options) });
}

type ChoicesStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): ChoicesStorage | null => (typeof localStorage === "undefined" ? null : localStorage);

/** Lê as escolhas do usuário. O armazenamento que falta, recusa ou lança vale "nada lembrado"; sem usuário, os padrões. */
export function readCopyAsChoices(userName: string | null, target: CopyTarget = noTarget, storage: () => ChoicesStorage | null = browserStorage): CopyAsChoices {
  let raw: string | null;
  try {
    raw = userName === null ? null : (storage()?.getItem(copyAsChoicesKey(userName)) ?? null);
  } catch {
    raw = null;
  }
  return parseCopyAsChoices(raw, target);
}

/** Grava as escolhas (no "Salvar" da configuração e no "Copiar" do diálogo). Gravar que falha não impede nada: a escolha só não é lembrada. */
export function writeCopyAsChoices(userName: string | null, choices: CopyAsChoices, storage: () => ChoicesStorage | null = browserStorage): void {
  if (userName === null) return;
  try {
    storage()?.setItem(copyAsChoicesKey(userName), serializeCopyAsChoices(choices));
  } catch {
    // Sem armazenamento: a escolha vale só nesta vez.
  }
}
