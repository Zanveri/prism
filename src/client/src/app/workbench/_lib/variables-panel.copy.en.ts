import { formatCount } from "@/lib/utils/format";
import type { VariablesPanelCopy } from "./variables-panel.copy";

export const variablesPanelCopyEn: VariablesPanelCopy = {
  tab: "Variables",
  result: "Result",
  label: "Tab variables",
  tabsLabel: "Result area",
  columns: { name: "Name", type: "Type", value: "Value", origin: "Origin", when: "When" },
  noValue: "no value",
  stale: "outdated",
  sqlWarning: "Goes into the statement as is, without quotes or a parameter.",
  menu: { label: "Variable", copy: "Copy value", goTo: "Go to declaration" },
  copied: "Value copied.",
  notCopied: "Could not copy the value.",
  empty: "No variable evaluated yet. Run the script (Alt+X) or the declaration (Ctrl+Enter).",
  items: (count: number) => formatCount(count, "item", "items"),
  fields: (count: number) => formatCount(count, "field", "fields"),
};
