import { formatCount, formatElapsed } from "@/lib/utils/format";

import type { ScriptRunCopy } from "./script-run.copy";

const inTab = (tab: string | null) => (tab === null ? "" : ` in tab ${tab}`);

export const scriptRunCopyEn: ScriptRunCopy = {
  editor: {
    run: "Run script",
    shortcut: "Alt+X",
    shortcutMac: "Cmd+Option+X",
    title: (shortcut: string) => `Runs the statements of the selection or, with no selection, of the whole text, one after the other (${shortcut})`,
  },

  tabs: {
    label: "Script results",
    result: (number: number, head: string) => `${number} · ${head}`,
    statistics: "Statistics",
    variables: "Variables",
  },

  progress: (current: number, total: number) => `Running ${current.toLocaleString("en")} of ${total.toLocaleString("en")}…`,
  paused: (current: number, total: number) => `Stopped at statement ${current.toLocaleString("en")} of ${total.toLocaleString("en")}`,

  statistics: {
    label: "Script statistics",
    caption: "The script's statements, in order",
    number: "No.",
    command: "Statement",
    status: "Status",
    rows: "Rows",
    time: "Time",
    statuses: { pending: "queued", running: "running…", ok: "ok", error: "error", skipped: "skipped", cancelled: "cancelled", notRun: "not run" },
    read: (count: number, more: boolean) => (more ? `first ${formatCount(count, "row", "rows")}` : formatCount(count, "row", "rows")),
    returned: (total: number) => formatCount(total, "row returned", "rows returned"),
    affected: (count: number) => (count < 0 ? "—" : formatCount(count, "row affected", "rows affected")),
    notKept: "result not kept",
    elapsed: (elapsedMs: number) => formatElapsed(elapsedMs),
    sqlState: "SQLSTATE",
    executed: (ok: number, total: number) => `Statements run: ${ok.toLocaleString("en")} of ${total.toLocaleString("en")}`,
    declarationsEvaluated: (ok: number, total: number) => `Declarations evaluated: ${ok.toLocaleString("en")} of ${total.toLocaleString("en")}`,
    declaration: "declaration",
    withErrors: (count: number) => `With errors: ${count.toLocaleString("en")}`,
    changed: (count: number, returning = 0) =>
      `Rows changed: ${count.toLocaleString("en")}${returning === 0 ? "" : ` (not counting ${returning === 1 ? "1 statement that wrote and returned rows" : `${returning.toLocaleString("en")} statements that wrote and returned rows`})`}`,
    totalTime: (elapsedMs: number) => `Total time: ${formatElapsed(elapsedMs)}`,
    dropped: (count: number, cap: number) =>
      `${count === 1 ? "The result of 1 statement was not kept" : `The results of ${count.toLocaleString("en")} statements were not kept`}: the script keeps the tabs of the first ${cap} statements that return rows, and the last one's.`,
    before: (count: number) => `${formatCount(count, "statement", "statements")} before these, which appear when the script finishes.`,
    after: (count: number) => `${formatCount(count, "more statement", "more statements")} queued.`,
  },

  kept: {
    note: "This result's cursor closed when the next statement ran. Load more, Count total, the filter and auto-refresh apply to the last statement's result.",
    runAlone: "Run this statement",
    runAloneBusy: "Run this statement. Unavailable: a statement is in progress in the tab.",
  },

  error: {
    title: (number: number, total: number) => `Statement ${number.toLocaleString("en")} of ${total.toLocaleString("en")} failed`,
    description: "The script stopped at this statement. Choose how to proceed.",
    command: "Statement",
    stop: "Stop",
    retry: "Try again",
    skip: "Skip",
    skipAll: "Skip all errors",
    sessionLost: "The session with the database dropped in the middle of the script, and Prism does not reopen it: what the earlier statements left in it was lost. Run the script again.",
    waiting: "The script stopped at an error and is waiting for the answer",
  },

  toasts: {
    done: (tab: string | null, total: number, declarations = 0) =>
      `Script run${inTab(tab)}: ${[...(total === 0 && declarations > 0 ? [] : [formatCount(total, "statement", "statements")]), ...(declarations === 0 ? [] : [formatCount(declarations, "declaration evaluated", "declarations evaluated")])].join(" and ")}.`,
    doneWithErrors: (tab: string | null, errors: number, ok: number, total: number) =>
      `Script run${inTab(tab)} with ${formatCount(errors, "error", "errors")}: ${ok.toLocaleString("en")} of ${formatCount(total, "statement run", "statements run")}.`,
    stopped: (tab: string | null, ok: number, total: number) => `Script stopped${inTab(tab)}: ${ok.toLocaleString("en")} of ${formatCount(total, "statement run", "statements run")}.`,
    cancelled: (tab: string | null, ok: number, total: number) => `Script cancelled${inTab(tab)}: ${ok.toLocaleString("en")} of ${formatCount(total, "statement run", "statements run")}.`,
  },
};
