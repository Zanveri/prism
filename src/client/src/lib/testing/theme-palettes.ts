import { readFileSync } from "node:fs";

import type { ThemeId } from "@/app/settings/_lib/theme";

/**
 * As cores de cada tema, lidas do `globals.css` (a fonte da verdade): só para testes. Os dois temas do Prism são as colunas das fichas
 * `light-dark(claro, escuro)`; cada um dos outros é um bloco `:root[data-theme="<id>"]` que troca algumas fichas e diz o esquema de cor, e
 * fica com as do esquema dele nas demais.
 */
export const css = readFileSync(new URL("../../styles/globals.css", import.meta.url), "utf8");

export type Palette = Record<string, string>;

function columns(): { light: Palette; dark: Palette } {
  const light: Palette = {};
  const dark: Palette = {};

  for (const match of css.matchAll(/--color-([a-z0-9-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/gi)) {
    light[match[1]] = match[2].toLowerCase();
    dark[match[1]] = match[3].toLowerCase();
  }

  return { light, dark };
}

export const { light, dark } = columns();

/** O bloco `:root[data-theme="<id>"] { ... }` de um tema: o esquema de cor e as fichas que ele troca. */
export function themeBlock(id: string): { scheme: "dark" | "light" | null; overrides: Palette } {
  const block = new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (block === undefined) throw new Error(`Sem o bloco do tema ${id} no CSS.`);

  const overrides: Palette = {};
  for (const match of block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) overrides[match[1]] = match[2].toLowerCase();
  const scheme = /color-scheme:\s*(dark|light)\s*;/.exec(block)?.[1];
  return { scheme: scheme === "dark" || scheme === "light" ? scheme : null, overrides };
}

/** As fichas que valem num tema: as do Prism Escuro e as do Prism Claro vêm das colunas; as dos outros, do esquema deles mais o que o bloco troca. */
export function paletteOf(id: ThemeId): { kind: "dark" | "light"; palette: Palette } {
  if (id === "dark") return { kind: "dark", palette: dark };
  if (id === "light") return { kind: "light", palette: light };

  const { scheme, overrides } = themeBlock(id);
  const kind = scheme === "light" ? "light" : "dark";
  return { kind, palette: { ...(kind === "light" ? light : dark), ...overrides } };
}
