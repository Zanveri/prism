import { readFileSync, rmSync, writeFileSync } from "node:fs";

import type { UpdateNotice } from "./update-state";
import { isReleaseVersion } from "./version";

/**
 * A atualização que o Prism mandou o instalador do Windows fazer, anotada na pasta de dados logo antes de ele rodar (seção 25,
 * RN-INSTALA-003). O app se encerra para o instalador trabalhar, e só a abertura seguinte sabe como terminou: na versão nova,
 * deu certo; na de antes, nada foi instalado (a permissão de administrador foi negada, ou o instalador parou), e a pessoa é
 * avisada uma vez. Na instalação para todos com a permissão negada, é o instalador que abre o Prism de novo
 * (`build/installer.nsh`, `prismReopenApp`); nos outros casos, a próxima vez que a pessoa o abrir.
 */
export type InstallAttempt = { from: string; to: string; forAllUsers: boolean };

export const attemptFileName = "update-attempt.json";

export function writeAttempt(file: string, attempt: InstallAttempt): void {
  writeFileSync(file, JSON.stringify(attempt));
}

/**
 * Lê a anotação e a apaga, valha ou não: ela serve a uma abertura só. Vira aviso só se o Prism abriu de novo na versão de onde a
 * atualização saiu, e para uma versão de release (`X.Y.Z` ou `X.Y.Z-beta.N`, a única que o atualizador instala). O que não é o
 * que o Prism grava, ou não se deixa ler, é ignorado. Nunca lança.
 */
export function takeAttempt(file: string, currentVersion: string): UpdateNotice | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  try {
    rmSync(file, { force: true });
  } catch {
    // Um arquivo que não sai é lido de novo na próxima abertura, e só avisa se a versão ainda for a de antes.
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const { from, to, forAllUsers } = value as Record<string, unknown>;
  if (from !== currentVersion || !isReleaseVersion(to) || to === currentVersion || typeof forAllUsers !== "boolean") return null;

  return { version: to, current: currentVersion, forAllUsers };
}
