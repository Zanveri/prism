import { z } from "zod";

/**
 * As fontes da interface e do editor SQL (RN-CONFIG-008). O app traz as duas IBM Plex (`@fontsource`, em `main.tsx`), que são o padrão; as outras
 * são as instaladas neste computador, pelo nome. O nome escolhido vira CSS (`font-family`), então só passa o nome que não escapa dela, e ele vai
 * sempre entre aspas, com a fonte do app atrás: a fonte que deixou de estar instalada cai na do app, sem erro.
 */

/** A fonte que o app traz para cada campo: o padrão da interface e o do editor. */
export const appFonts = { ui: "IBM Plex Sans", editor: "IBM Plex Mono" } as const;

/** A interface (`ui`: todo o texto fora do código) ou o editor SQL (`editor`: o CodeMirror e os campos de SQL que seguem a fonte dele). */
export type FontRole = keyof typeof appFonts;

/** O nome mais comprido que se aceita. Os nomes de família do sistema ficam bem abaixo disto. */
export const fontNameMaxLength = 100;

/**
 * O que escaparia da `font-family` mesmo entre aspas: as aspas (fecham o nome), o ponto e vírgula (termina a declaração), as chaves (fecham a
 * regra), a barra invertida (escapa a aspa do fim, ou escreve outro caractere) e todo caractere de controle, formatação ou direção de texto
 * (`\p{C}`: a quebra de linha termina a string do CSS, e o resto não aparece na tela).
 */
const unsafeCharacters = /["';{}\\\p{C}]/u;

/** O nome de uma fonte que pode virar CSS: texto de 1 a 100 caracteres, sem espaço nas pontas e sem nada que escape da `font-family`. */
export function isSafeFontName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= fontNameMaxLength && name.trim() === name && !unsafeCharacters.test(name);
}

/** O esquema do nome nas preferências: o armazenamento não confia na tela. */
export const fontNameSchema = z.string().refine(isSafeFontName);

/**
 * A pilha do app de cada campo, que fica atrás da escolhida. A da interface é uma variável à parte (`--font-app-sans`, em `globals.css`), porque a
 * que o app usa (`--font-sans`) é a que a escolha troca; a do editor é a mono do app, que a grade também usa e que não muda.
 */
export const appFontStacks = { ui: "var(--font-app-sans)", editor: "var(--font-mono)" } as const;

/** A variável do CSS de cada campo, no <html>: `font-sans` e o corpo leem `--font-sans`; `font-editor`, a `--font-editor`. */
export const fontVariables = { ui: "--font-sans", editor: "--font-editor" } as const;

/** A pilha de fontes do campo: a escolhida entre aspas e a do app atrás. A do app, ou um nome que não serve, é só a do app. */
export function fontStack(role: FontRole, name: string): string {
  if (name === appFonts[role] || !isSafeFontName(name)) return appFontStacks[role];
  return `"${name}", ${appFontStacks[role]}`;
}

/** O mínimo que se usa do <html>: o teste passa um objeto qualquer no lugar. */
type FontRoot = { style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty"> };

const documentRoot = (): FontRoot => document.documentElement;

/** Põe as escolhas nas variáveis do <html>. A fonte do app tira a variável, e vale a do CSS. */
export function applyFonts(fonts: Record<FontRole, string>, root: FontRoot = documentRoot()): void {
  for (const role of Object.keys(appFonts) as FontRole[]) {
    const stack = fontStack(role, fonts[role]);
    if (stack === appFontStacks[role]) root.style.removeProperty(fontVariables[role]);
    else root.style.setProperty(fontVariables[role], stack);
  }
}

/** As duas voltam à fonte do app (sem usuário, ninguém escolheu nada). */
export function clearFonts(root: FontRoot = documentRoot()): void {
  for (const variable of Object.values(fontVariables)) root.style.removeProperty(variable);
}
