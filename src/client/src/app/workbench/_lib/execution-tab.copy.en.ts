import type { ExecutionTabCopy } from "./execution-tab.copy";

export const executionTabCopyEn: ExecutionTabCopy = {
  hint: (name: string, connection: string | null, database: string | undefined) => `Run of ${name}${connection === null ? "" : ` on ${connection}`}${database === undefined ? "" : ` · ${database}`}`,
  label: (name: string) => `Run of ${name}`,
  ranAt: (time: string) => `Ran at ${time}`,
  rerun: "Run again",
  rerunLabel: "Run the script again",
  rerunHint: (shortcut: string) => `Run the script again, with the same values (${shortcut})`,
  change: "Change the values…",
  changeHint: (shortcut: string) => `Change the values… (${shortcut})`,
  openScript: "Open the script",
  cancel: "Cancel",
  values: "Values used",
  sqlChip: "Goes into the statement as is, without quotes.",
  missing: (name: string) => `The script ${name} no longer exists.`,
  newTab: "Run in a new tab",
};
