import { formatCount } from "@/lib/utils/format";

import type { TransactionCopy } from "./transaction.copy";

const commands = (count: number) => formatCount(count, "statement", "statements");
const notConfirmed = (count: number) => formatCount(count, "statement was not committed", "statements were not committed");

export const transactionCopyEn: TransactionCopy = {
  editor: {
    label: "Transaction",
    modeLabel: "Transaction mode",
    isolationLabel: "Isolation",
    autoCommit: "Auto-commit",
    manual: "Manual commit",
    levels: {
      default: "Database default",
      readUncommitted: "Read Uncommitted",
      readCommitted: "Read Committed",
      committedReadLastCommitted: "Committed Read Last Committed",
      cursorStability: "Cursor Stability",
      repeatableRead: "Repeatable Read",
      readStability: "Read Stability",
      serializable: "Serializable",
    },
    notAvailable: "This database has no transaction log",
    commit: "Commit",
    rollback: "Rollback",
    nothingToEnd: "There is no open transaction",
    failedCommit: "The transaction has an error: only Rollback is left",
    busy: "Wait for the statement to finish",
  },

  status: {
    autoCommit: (level: string = "Database default") => `Auto-commit · ${level}`,
    idle: (level: string = "Database default") => `Manual commit · ${level} · no open transaction`,
    failed: (level: string = "Database default", mode: string = "Manual commit") => `${mode} · ${level} · transaction with an error: only Rollback is left`,
    open: (count: number, minutes: number, level: string = "Database default", mode: string = "Manual commit") =>
      `${mode} · ${level} · ${formatCount(count, "uncommitted statement", "uncommitted statements")} · ${minutes < 1 ? "for less than 1 min" : `for ${minutes} min`}`,
  },

  question: {
    title: "There is an open transaction",
    description: (count: number) => `The tab has ${commands(count)} not committed. Commit or roll back the transaction before switching to Auto-commit.`,
    failedDescription: "The transaction has an error and can only be rolled back. Roll it back before switching to Auto-commit.",
    commit: "Commit",
    rollback: "Rollback",
    cancel: "Cancel",
  },

  switching: {
    title: "There is an open transaction",
    description: (count: number) => `The tab has ${commands(count)} not committed. Commit or roll back the transaction before changing the tab’s session.`,
    failedDescription: "The transaction has an error and can only be rolled back. Roll it back before changing the tab’s session.",
    commit: "Commit",
    rollback: "Rollback",
    cancel: "Cancel",
  },

  closing: {
    title: (tabs: number) => (tabs === 1 ? "The tab has an open transaction" : `${formatCount(tabs, "tab has", "tabs have")} an open transaction`),
    description: (count: number, failed: boolean) =>
      failed
        ? `There are ${commands(count)} not committed, and one of the transactions has an error: they can only be rolled back.`
        : `There are ${commands(count)} not committed. Commit or roll back before closing; closing without choosing rolls back.`,
    commit: "Commit and close",
    rollback: "Rollback and close",
    cancel: "Cancel",
  },

  toasts: {
    committed: (count: number) => `Transaction committed: ${commands(count)}.`,
    rolledBack: (count: number) => `Transaction rolled back: ${commands(count)}.`,
    undone: (count: number) => `The database rolled back the transaction: ${notConfirmed(count)}.`,
    lost: (count: number) => `The database session dropped, and the transaction was rolled back: ${notConfirmed(count)}. Run again, in a new transaction.`,
    uncommitted: "uncommitted",
  },
};
