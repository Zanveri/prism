import { formatCount } from "@/lib/utils/format";
import type { VariablesPanelCopy } from "./variables-panel.copy";

export const variablesPanelCopyEs: VariablesPanelCopy = {
  tab: "Variables",
  result: "Resultado",
  label: "Variables de la pestaña",
  tabsLabel: "Área de resultado",
  columns: { name: "Nombre", type: "Tipo", value: "Valor", origin: "Origen", when: "Cuándo" },
  noValue: "sin valor",
  stale: "desactualizado",
  sqlWarning: "Entra en la sentencia tal cual, sin comillas ni parámetro.",
  menu: { label: "Variable", copy: "Copiar valor", goTo: "Ir a la declaración" },
  copied: "Valor copiado.",
  notCopied: "No se pudo copiar el valor.",
  empty: "Ninguna variable evaluada todavía. Ejecuta el script (Alt+X) o la declaración (Ctrl+Enter).",
  items: (count: number) => formatCount(count, "elemento", "elementos"),
  fields: (count: number) => formatCount(count, "campo", "campos"),
};
