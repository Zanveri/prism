import { formatCount } from "@/lib/utils/format";

import type { TransactionCopy } from "./transaction.copy";

const commands = (count: number) => formatCount(count, "sentencia", "sentencias");
const notConfirmed = (count: number) => formatCount(count, "sentencia no fue confirmada", "sentencias no fueron confirmadas");

export const transactionCopyEs: TransactionCopy = {
  editor: {
    label: "Transacción",
    modeLabel: "Modo de transacción",
    isolationLabel: "Aislamiento",
    autoCommit: "Auto-commit",
    manual: "Commit manual",
    levels: {
      default: "Predeterminado de la base de datos",
      readUncommitted: "Read Uncommitted",
      readCommitted: "Read Committed",
      committedReadLastCommitted: "Committed Read Last Committed",
      cursorStability: "Cursor Stability",
      repeatableRead: "Repeatable Read",
      readStability: "Read Stability",
      serializable: "Serializable",
    },
    notAvailable: "Esta base de datos no tiene registro de transacciones",
    commit: "Commit",
    rollback: "Rollback",
    nothingToEnd: "No hay ninguna transacción abierta",
    failedCommit: "La transacción tiene un error: solo queda el Rollback",
    busy: "Espera a que termine la sentencia",
  },

  status: {
    autoCommit: (level: string = "Predeterminado de la base de datos") => `Auto-commit · ${level}`,
    idle: (level: string = "Predeterminado de la base de datos") => `Commit manual · ${level} · sin transacción abierta`,
    failed: (level: string = "Predeterminado de la base de datos", mode: string = "Commit manual") => `${mode} · ${level} · transacción con error: solo queda el Rollback`,
    open: (count: number, minutes: number, level: string = "Predeterminado de la base de datos", mode: string = "Commit manual") =>
      `${mode} · ${level} · ${formatCount(count, "sentencia sin commit", "sentencias sin commit")} · ${minutes < 1 ? "hace menos de 1 min" : `hace ${minutes} min`}`,
  },

  question: {
    title: "Hay una transacción abierta",
    description: (count: number) => `La pestaña tiene ${commands(count)} sin commit. Confirma o revierte la transacción antes de pasar a Auto-commit.`,
    failedDescription: "La transacción tiene un error y solo se puede revertir. Reviértela antes de pasar a Auto-commit.",
    commit: "Commit",
    rollback: "Rollback",
    cancel: "Cancelar",
  },

  switching: {
    title: "Hay una transacción abierta",
    description: (count: number) => `La pestaña tiene ${commands(count)} sin commit. Confirma o revierte la transacción antes de cambiar la sesión de la pestaña.`,
    failedDescription: "La transacción tiene un error y solo se puede revertir. Reviértela antes de cambiar la sesión de la pestaña.",
    commit: "Commit",
    rollback: "Rollback",
    cancel: "Cancelar",
  },

  closing: {
    title: (tabs: number) => (tabs === 1 ? "La pestaña tiene una transacción abierta" : `${formatCount(tabs, "pestaña tiene", "pestañas tienen")} una transacción abierta`),
    description: (count: number, failed: boolean) =>
      failed
        ? `Hay ${commands(count)} sin commit, y una de las transacciones tiene un error: solo se pueden revertir.`
        : `Hay ${commands(count)} sin commit. Confirma o revierte antes de cerrar; cerrar sin elegir revierte.`,
    commit: "Commit y cerrar",
    rollback: "Rollback y cerrar",
    cancel: "Cancelar",
  },

  toasts: {
    committed: (count: number) => `Transacción confirmada: ${commands(count)}.`,
    rolledBack: (count: number) => `Transacción revertida: ${commands(count)}.`,
    undone: (count: number) => `La base de datos revirtió la transacción: ${notConfirmed(count)}.`,
    lost: (count: number) => `La sesión con la base de datos se cayó y la transacción fue revertida: ${notConfirmed(count)}. Ejecuta de nuevo, en una transacción nueva.`,
    uncommitted: "sin commit",
  },
};
