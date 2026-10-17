import { exportFileName, safeFileBase } from "../../../../../electron/file-name";
import { dataExportCopy } from "./data-export.copy";

/**
 * O nome do arquivo da exportação (RN-EXPORT-014): um padrão com variáveis, que vem com `${tabela}_${data}_${hora}`, como o `${table}_${timestamp}` do DBeaver.
 * O nome pronto passa pelas regras de nome do "Exportar CSV" (`exportFileName`, de `electron/file-name.ts`, as mesmas que o processo principal aplica ao nome
 * que recebe).
 */

export const defaultFilePattern = "${tabela}_${data}_${hora}";

export const filePatternVariables = ["tabela", "esquema", "conexao", "data", "hora"] as const;

export type FilePatternValues = { tabela: string; esquema: string; conexao: string };

const two = (value: number) => String(value).padStart(2, "0");

/** `${data}` é `aaaa-mm-dd` e `${hora}` é `hhmmss`, do relógio da máquina. */
export function clockValues(now: Date): { data: string; hora: string } {
  return { data: `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`, hora: `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}` };
}

const variable = /\$\{([^}]*)\}/g;

/** A recusa do campo: vazio, mais de 200 caracteres, ou uma variável que não existe (a primeira). */
export function filePatternProblem(pattern: string): string | null {
  const p = dataExportCopy.problems;
  if (pattern.trim() === "") return p.fileNameEmpty;
  if (pattern.length > 200) return p.fileNameLength;
  for (const match of pattern.matchAll(variable)) {
    if (!(filePatternVariables as readonly string[]).includes(match[1])) return p.unknownVariable(match[1]);
  }
  return null;
}

/** O padrão com as variáveis trocadas pelos valores; o texto fora delas fica como está (as regras de nome vêm depois). */
export function expandFilePattern(pattern: string, values: FilePatternValues, now: Date): string {
  const all: Record<string, string> = { ...values, ...clockValues(now) };
  return pattern.replace(variable, (whole, name: string) => all[name] ?? whole);
}

/** O texto cortado, por pontos de código, até caber em `max` unidades UTF-16 (o que os schemas contam). */
function fitUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = "";
  for (const char of text) {
    if (kept.length + char.length > max) break;
    kept += char;
  }
  return kept;
}

/**
 * Os nomes que saem do padrão: o do arquivo que se salva (`fileName`, com a extensão do formato, ou `.zip`), o que vai ao diálogo de salvar do processo
 * principal, sem a extensão (`suggestedName`, de 1 a 200 caracteres), e, com o .zip, o do arquivo dentro dele (`entryName`, até 128 caracteres).
 */
export function outputNames(expanded: string, extension: string, zip: boolean): { fileName: string; suggestedName: string; entryName: string | null } {
  const base = safeFileBase(expanded);
  const inner = exportFileName(fitUnits(base, 127 - extension.length), extension);
  return {
    fileName: zip ? exportFileName(base, "zip") : exportFileName(base, extension),
    suggestedName: fitUnits(base, 200),
    entryName: zip ? inner : null,
  };
}
