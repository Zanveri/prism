import { pickCopy, type Localized } from "@/lib/i18n";

import { layoutCopyEn } from "./layout.copy.en";
import { layoutCopyEs } from "./layout.copy.es";

const pt = {
  /** O `aria-label` da navegação da barra superior. */
  signOut: "Sair",
  mainNavigation: "Principal",
} as const;

export type LayoutCopy = Localized<typeof pt>;
export const layoutCopy = pickCopy({ "pt-BR": pt, en: layoutCopyEn, es: layoutCopyEs });
