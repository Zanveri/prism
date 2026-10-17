import { defaultSqlOptions, type SqlOptions } from "./generate-sql";

/**
 * As opções do diálogo "Gerar SQL" (RN-GRADE-018), lembradas por usuário nas preferências desta instalação (RN-CONFIG-001), numa chave própria do
 * `localStorage` (`prism:generate-sql:<usuário>`), como as escolhas da exportação e as do "Copiar como". Guardam as três caixas; a tabela de destino do
 * INSERT da tabela que o Prism não conhece abre vazia e não se lembra. A leitura é tolerante campo a campo: o que não vale volta ao padrão, sem erro.
 */

export type RememberedSqlOptions = Pick<SqlOptions, "qualified" | "compact" | "excludeGenerated">;

export const generateSqlChoicesKey = (userName: string) => `prism:generate-sql:${userName.trim().toLowerCase()}`;

type ChoicesStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): ChoicesStorage | null => (typeof localStorage === "undefined" ? null : localStorage);

/** As opções gravadas. O que está gravado pode ser qualquer coisa: nunca lança, e o que não é um booleano volta ao padrão. */
export function parseSqlOptions(raw: string | null): RememberedSqlOptions {
  let record: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) record = parsed as Record<string, unknown>;
  } catch {
    record = {};
  }
  const flag = (name: keyof RememberedSqlOptions) => (typeof record[name] === "boolean" ? (record[name] as boolean) : defaultSqlOptions[name]);
  return { qualified: flag("qualified"), compact: flag("compact"), excludeGenerated: flag("excludeGenerated") };
}

/** Lê as opções do usuário. O armazenamento que falta, recusa ou lança vale "nada lembrado"; sem usuário, os padrões. */
export function readSqlOptions(userName: string | null, storage: () => ChoicesStorage | null = browserStorage): RememberedSqlOptions {
  let raw: string | null;
  try {
    raw = userName === null ? null : (storage()?.getItem(generateSqlChoicesKey(userName)) ?? null);
  } catch {
    raw = null;
  }
  return parseSqlOptions(raw);
}

/** Grava as opções (a cada mudança de uma caixa). Gravar que falha não impede nada: a escolha só não é lembrada. */
export function writeSqlOptions(userName: string | null, options: RememberedSqlOptions, storage: () => ChoicesStorage | null = browserStorage): void {
  if (userName === null) return;
  try {
    storage()?.setItem(generateSqlChoicesKey(userName), JSON.stringify({ qualified: options.qualified, compact: options.compact, excludeGenerated: options.excludeGenerated }));
  } catch {
    // Sem armazenamento: a escolha vale só nesta vez.
  }
}
