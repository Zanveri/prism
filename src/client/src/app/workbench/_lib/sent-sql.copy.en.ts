import type { SentSqlCopy } from "./sent-sql.copy";

export const sentSqlCopyEn: SentSqlCopy = {
  title: "Sent SQL",
  description: "The statement with the variable values written as database literals, to read and to copy and run elsewhere. What went to the database were the parameters.",
  button: "Sent SQL",
  hint: "View the sent SQL, with the variable values",
  view: "View the sent SQL",
  parameters: "Parameters",
  columns: { marker: "Marker", variable: "Variable", type: "Type", value: "Value" },
  none: "The statement carried no parameters.",
  copy: "Copy",
  close: "Close",
  copied: "SQL copied.",
  notCopied: "Could not copy the SQL.",
};
