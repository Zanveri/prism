import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { defaultLocale, parseLocale, type Locale } from "./locale";

/** Onde o idioma do programa fica: `locale.json`, na pasta de dados, fora do cofre, gravado só pelo processo principal (a forma do `zoom.json`). */
export const localeFileName = "locale.json";

/** Arquivo que não existe ou não se deixa ler: o padrão, sem derrubar o app. */
export function readAppLocale(file: string): Locale {
  try {
    return parseLocale(readFileSync(file, "utf8"));
  } catch {
    return defaultLocale;
  }
}

/** Grava num arquivo ao lado e troca: um app fechado no meio não deixa o arquivo pela metade. */
export function writeAppLocale(file: string, locale: Locale): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify({ locale }, null, 2));
  renameSync(`${file}.tmp`, file);
}
