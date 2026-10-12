import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { isReleaseVersion } from "./version";

/**
 * As preferências de atualização (RN-ATUALIZA-007): um JSON na pasta de dados, fora do cofre, gravado só pelo processo
 * principal. Valem para a instalação, não para um usuário. `lastCheckedAt` é a hora da última consulta, em ISO. `receiveBeta` é
 * "Receber versões beta" (RN-ATUALIZA-010): ligado, a consulta considera também os pré-lançamentos.
 */
export type UpdatePreferences = { checkOnStartup: boolean; skippedVersion: string | null; lastCheckedAt: string | null; receiveBeta: boolean };

export const defaultPreferences: UpdatePreferences = { checkOnStartup: true, skippedVersion: null, lastCheckedAt: null, receiveBeta: false };

const day = 24 * 60 * 60 * 1000;

/**
 * O arquivo pode estar ilegível ou ter sido mexido à mão: o que não é JSON vale como o padrão, e cada campo fora do formato
 * vale como o padrão dele (o arquivo de antes do canal beta não tem `receiveBeta`, e vale desligado). A versão pulada só é
 * guardada se for a de uma release (`X.Y.Z` ou `X.Y.Z-beta.N`: "Pular esta versão" vale igual nos dois canais). Nunca lança.
 */
export function parsePreferences(text: string): UpdatePreferences {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return defaultPreferences;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return defaultPreferences;

  const { checkOnStartup, skippedVersion, lastCheckedAt, receiveBeta } = value as Record<string, unknown>;
  return {
    checkOnStartup: typeof checkOnStartup === "boolean" ? checkOnStartup : defaultPreferences.checkOnStartup,
    skippedVersion: isReleaseVersion(skippedVersion) ? skippedVersion : null,
    lastCheckedAt: typeof lastCheckedAt === "string" && lastCheckedAt !== "" && !Number.isNaN(Date.parse(lastCheckedAt)) ? lastCheckedAt : null,
    receiveBeta: receiveBeta === true,
  };
}

/** Arquivo que não existe, que é uma pasta ou que não se deixa ler: o padrão, sem derrubar o app. */
export function readPreferences(file: string): UpdatePreferences {
  try {
    return parsePreferences(readFileSync(file, "utf8"));
  } catch {
    return defaultPreferences;
  }
}

/** Grava num arquivo ao lado e troca: um app fechado no meio não deixa o arquivo pela metade. */
export function writePreferences(file: string, preferences: UpdatePreferences): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(preferences, null, 2));
  renameSync(`${file}.tmp`, file);
}

/**
 * A consulta ao abrir (RN-ATUALIZA-002): só com "verificar ao abrir" ligado, e no máximo uma a cada 24 horas. Uma hora no
 * futuro (relógio mexido, arquivo adulterado) vale como "nunca consultou": senão adiaria a consulta para sempre.
 */
export function dueForStartupCheck({ checkOnStartup, lastCheckedAt }: UpdatePreferences, now: Date): boolean {
  if (!checkOnStartup) return false;
  if (lastCheckedAt === null) return true;

  const elapsed = now.getTime() - Date.parse(lastCheckedAt);
  return elapsed < 0 || elapsed >= day;
}
