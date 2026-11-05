import { formatCount } from "@/lib/utils/format";

import type { VariableFieldsCopy } from "./variable-fields.copy";

export const variableFieldsCopyEn: VariableFieldsCopy = {
  title: "Values to run",
  fullTitle: (name: string) => `Run with values · ${name}`,
  where: "Where",
  connection: "Connection",
  database: "Database",
  defaultDatabase: "the connection's default",
  values: "Values",
  below: "Further down in the script",
  calculated: (count: number) => `${count === 1 ? "1 more variable is calculated" : `${count.toLocaleString("en")} more variables are calculated`} during the script.`,
  computed: (text: string) => `calculated: ${text}`,
  noTopDeclarations: "This script declares no variables.",
  lastTime: "from last time",
  resetToScript: "Back to the script's value",
  forget: "Forget this script's values",
  rememberFailed: (reason: string) => `Could not remember the values: ${reason}.`,
  tooLargeToRemember: (names: readonly string[]) => (names.length === 1 ? `The value of ${names[0]} is too large to remember.` : `The values of ${names.join(", ")} are too large to remember.`),
  summary: (count: number) => `The script declares ${formatCount(count, "variable", "variables")} with no value. Write the values to continue.`,
  run: "Run",
  cancel: "Cancel",

  required: (name: string) => `Write a value for ${name}.`,
  emptyItem: "The item is empty.",
  notNumber: "Write a number, such as 42 or 3.5.",
  decimalHint: "Use a dot for decimals, such as 3.5.",
  chooseDate: "Choose a date.",
  chooseTime: "Choose the time.",
  badItem: (item: string, message: string) => `${item}: ${message}`,

  yes: "Yes",
  no: "No",
  nullLabel: "NULL",
  time: "Time",
  timeOptional: "Time (optional)",
  sqlWarning: "Goes into the statement as is, without quotes: check what you write.",
  items: (count: number) => formatCount(count, "item", "items"),
  removeItem: (item: string) => `Remove ${item}`,
  itemsHint: "Enter or a comma closes the item; pasting several lines creates one item per line.",
  edgeSpace: (start: boolean, end: boolean) => (start && end ? "Space at the start and at the end" : start ? "1 space at the start" : "1 space at the end"),

  choiceNote: (table: string, column: string, described: boolean) => `Values of ${table} (${column})${described ? ", with the name" : ""}`,
  search: "Search",
  loadMore: "Load more",
  loading: "Loading…",
  noValues: "No values.",
  tryAgain: "Try again",
  truncated: "The value is too long to choose from here: write it.",
  missing: (values: readonly string[], table: string, column: string) =>
    values.length === 1 ? `The value ${values[0]} does not exist in ${table} (${column}).` : `The values ${values.slice(0, -1).join(", ")} and ${values[values.length - 1]} do not exist in ${table} (${column}).`,
};
