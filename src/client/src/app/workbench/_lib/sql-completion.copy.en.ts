import type { CompletionCopy } from "./sql-completion.copy";

export const completionCopyEn: CompletionCopy = {
  listLabel: "Suggestions",
  schema: "schema",
  table: "table",
  view: "view",
  inSchema: (schema: string, what: string) => `${schema} · ${what}`,
};
