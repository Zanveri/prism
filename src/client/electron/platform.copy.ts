import { defaultLocale, pickCopy, type Locale, type Localized } from "./locale";
import { platformCopyEn } from "./platform.copy.en";
import { platformCopyEs } from "./platform.copy.es";

/**
 * O texto do menu do app no macOS (`platform.ts`), o único que o processo principal escreve na barra de menu: os itens dele são papéis do Electron,
 * que o sistema nomeia. O `main.ts` passa o idioma desta abertura; sem ele, o português (os testes).
 */
const pt = {
  editMenu: "Editar",
} as const;

export type PlatformCopy = Localized<typeof pt>;

/** Os textos no idioma desta abertura do app (`main.ts`); sem idioma, os do português. */
export function platformCopy(locale: Locale = defaultLocale): PlatformCopy {
  return pickCopy(locale, { "pt-BR": pt, en: platformCopyEn, es: platformCopyEs });
}
