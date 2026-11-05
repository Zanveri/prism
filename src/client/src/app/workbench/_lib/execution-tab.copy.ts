import { pickCopy, type Localized } from "@/lib/i18n";
import { executionTabCopyEn } from "./execution-tab.copy.en";
import { executionTabCopyEs } from "./execution-tab.copy.es";

/** RN-VAR-029: os textos da aba de execução do "Executar com valores…". */
const pt = {
  hint: (name: string, connection: string | null, database: string | undefined) => `Execução de ${name}${connection === null ? "" : ` em ${connection}`}${database === undefined ? "" : ` · ${database}`}`,
  label: (name: string) => `Execução de ${name}`,
  ranAt: (time: string) => `Executado às ${time}`,
  rerun: "Executar de novo",
  rerunLabel: "Executar o script de novo",
  rerunHint: (shortcut: string) => `Executar o script de novo, com os mesmos valores (${shortcut})`,
  change: "Mudar os valores…",
  changeHint: (shortcut: string) => `Mudar os valores… (${shortcut})`,
  openScript: "Abrir o script",
  cancel: "Cancelar",
  values: "Valores usados",
  sqlChip: "Entra no comando como está, sem aspas.",
  missing: (name: string) => `O script ${name} não existe mais.`,
  newTab: "Executar numa aba nova",
} as const;

export type ExecutionTabCopy = Localized<typeof pt>;
export const executionTabCopy = pickCopy({ "pt-BR": pt, en: executionTabCopyEn, es: executionTabCopyEs });
