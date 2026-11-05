import { formatCount } from "@/lib/utils/format";
import { pickCopy, type Localized } from "@/lib/i18n";

import { variablesPanelCopyEn } from "./variables-panel.copy.en";
import { variablesPanelCopyEs } from "./variables-panel.copy.es";

/** Os textos do painel "Variáveis" (RN-VAR-024) e da lista de abas que o traz. */
const pt = {
  tab: "Variáveis",
  result: "Resultado",
  label: "Variáveis da aba",
  tabsLabel: "Área de resultado",
  columns: { name: "Nome", type: "Tipo", value: "Valor", origin: "Origem", when: "Quando" },
  noValue: "sem valor",
  stale: "desatualizado",
  /** O `sql` entra no comando como está (RN-VAR-004). */
  sqlWarning: "Entra no comando como está, sem aspas nem parâmetro.",
  menu: { label: "Variável", copy: "Copiar valor", goTo: "Ir para a declaração" },
  copied: "Valor copiado.",
  notCopied: "Não foi possível copiar o valor.",
  empty: "Nenhuma variável avaliada ainda. Execute o script (Alt+X) ou a declaração (Ctrl+Enter).",
  /** A contagem de uma lista e de um objeto, antes da prévia do valor. */
  items: (count: number) => formatCount(count, "item", "itens"),
  fields: (count: number) => formatCount(count, "campo", "campos"),
} as const;

export type VariablesPanelCopy = Localized<typeof pt>;
export const variablesPanelCopy = pickCopy({ "pt-BR": pt, en: variablesPanelCopyEn, es: variablesPanelCopyEs });
