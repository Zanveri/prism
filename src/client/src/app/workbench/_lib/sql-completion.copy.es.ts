import type { CompletionCopy } from "./sql-completion.copy";

export const completionCopyEs: CompletionCopy = {
  listLabel: "Sugerencias",
  schema: "esquema",
  table: "tabla",
  view: "vista",
  inSchema: (schema: string, what: string) => `${schema} · ${what}`,
};
