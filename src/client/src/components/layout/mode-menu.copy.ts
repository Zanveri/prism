import { pickCopy, type Localized } from "@/lib/i18n";
import { modeMenuCopyEn } from "./mode-menu.copy.en";
import { modeMenuCopyEs } from "./mode-menu.copy.es";

/** Textos do seletor de modo na barra superior (RN-CONSTRUIR-001). */
const pt = {
  label: "Modo",
  workbench: {
    label: "Área de trabalho",
    hint: "Navegar nos bancos, rodar SQL e editar dados",
  },
  build: {
    label: "Construir",
    hint: "Desenhar tabelas, relações e índices e gerar o DDL",
  },
} as const;

export type ModeMenuCopy = Localized<typeof pt>;
export const modeMenuCopy = pickCopy({ "pt-BR": pt, en: modeMenuCopyEn, es: modeMenuCopyEs });
