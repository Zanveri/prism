import { useSyncExternalStore } from "react";
import { z } from "zod";

import type { Engine } from "@/components/ui/engine-tag";

import { transactionCopy } from "./transaction.copy";

export const transactionModes = ["autoCommit", "manual"] as const;
export type TransactionMode = (typeof transactionModes)[number];

/** RN-ISOL-001: todos os níveis de isolamento que a API aceita, na união dos três bancos. */
export const isolationLevels = [
  "default",
  "readUncommitted",
  "readCommitted",
  "committedReadLastCommitted",
  "cursorStability",
  "repeatableRead",
  "readStability",
  "serializable",
] as const;
export type IsolationLevel = (typeof isolationLevels)[number];

export const isolationLevelSchema = z.enum(isolationLevels);

const levelsByEngine: Partial<Record<Engine, readonly IsolationLevel[]>> = {
  1: ["default", "readUncommitted", "readCommitted", "repeatableRead", "serializable"],
  2: ["default", "readUncommitted", "cursorStability", "readStability", "repeatableRead"],
  3: ["default", "readUncommitted", "readCommitted", "committedReadLastCommitted", "cursorStability", "repeatableRead"],
};

/** RN-ISOL-001: os níveis que o banco da conexão tem, na ordem do menos estrito ao mais estrito, depois de "Padrão do banco". */
export function engineIsolationLevels(engine: Engine | undefined): readonly IsolationLevel[] {
  return engine === undefined ? ["default"] : (levelsByEngine[engine] ?? ["default", "readUncommitted", "readCommitted", "repeatableRead", "serializable"]);
}

/** RN-ISOL-006: quando o nível padrão das preferências não existe no banco da aba, a aba abre em "Padrão do banco". */
export function normalizeIsolationLevel(level: IsolationLevel, engine: Engine | undefined): IsolationLevel {
  return engineIsolationLevels(engine).includes(level) ? level : "default";
}

/**
 * Seção 22 da especificação ("Rotas e respostas"): o estado da transação da sessão que a API devolve com a sessão aberta, com cada resultado, com o Commit e
 * o Rollback, e nas extensões das recusas.
 */
export const transactionSchema = z.object({
  mode: z.enum(transactionModes),
  isolationLevel: isolationLevelSchema.optional().default("default"),
  open: z.boolean(),
  failed: z.boolean(),
  commands: z.number().int(),
  openedAt: z.string().nullish(),
});

export type TransactionWire = z.infer<typeof transactionSchema>;

/** O `transaction` de uma resposta ou das extensões de uma recusa; o que não está na forma vira nulo, e o estado da aba fica como estava. */
export function transactionOf(value: unknown): TransactionWire | null {
  const parsed = transactionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * RN-TX-001 a 003 e RN-ISOL-001: a transação da aba como a tela a mostra. `openedAt` em milissegundos; `available` falso no banco sem log de transação (RN-TX-013), em que o
 * Commit manual e o nível de isolamento ficam desabilitados; `pending` enquanto o Commit, o Rollback ou a troca de modo ou de nível estão a caminho.
 */
export type TabTransaction = {
  mode: TransactionMode;
  isolationLevel: IsolationLevel;
  open: boolean;
  failed: boolean;
  commands: number;
  openedAt: number | null;
  available: boolean;
  pending: boolean;
};

export const closedTransaction = { open: false, failed: false, commands: 0, openedAt: null } as const;

export const initialTransaction: TabTransaction = { mode: "autoCommit", isolationLevel: "default", ...closedTransaction, available: true, pending: false };

/** O que a resposta da API diz da transação, no estado da aba. */
export function fromWire(wire: TransactionWire): Partial<TabTransaction> {
  const openedAt = wire.openedAt == null ? null : Date.parse(wire.openedAt);
  return {
    mode: wire.mode,
    isolationLevel: wire.isolationLevel,
    open: wire.open,
    failed: wire.failed,
    commands: wire.open ? wire.commands : 0,
    openedAt: wire.open && Number.isFinite(openedAt) ? openedAt : null,
  };
}

export type TransactionStore = {
  subscribe: (listener: () => void) => () => void;
  getState: () => TabTransaction;
  set: (patch: Partial<TabTransaction>) => void;
};

export function createTransactionStore(initial?: Partial<Pick<TabTransaction, "mode" | "isolationLevel">>): TransactionStore {
  let state: TabTransaction = initial === undefined ? initialTransaction : { ...initialTransaction, ...initial };
  const listeners = new Set<() => void>();

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getState: () => state,
    set: (patch) => {
      const next = { ...state, ...patch };
      if ((Object.keys(next) as (keyof TabTransaction)[]).every((key) => next[key] === state[key])) return;
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

export function useTabTransaction(store: Pick<TransactionStore, "subscribe" | "getState">): TabTransaction {
  return useSyncExternalStore(store.subscribe, store.getState);
}

/** RN-TX-014 e RN-EDIT-009: no Commit manual, o aviso de um comando ou de um "Salvar" diz que ele ficou sem commit. */
export function withUncommitted(text: string, transaction: TabTransaction): string {
  return transaction.open ? text.replace(/\.$/, `, ${transactionCopy.toasts.uncommitted}.`) : text;
}

/** RN-TX-003: passados 10 minutos com a transação aberta, o texto passa ao tom de atenção, porque as travas dela seguram outras sessões. */
const longTransactionMinutes = 10;

/** RN-TX-003 e RN-ISOL-002: o texto da barra de status e o tom dele. `now` em milissegundos. */
export function transactionStatus(transaction: TabTransaction, now: number): { text: string; tone: "normal" | "warning" | "error" } {
  const copy = transactionCopy.status;
  const level = transactionCopy.editor.levels[transaction.isolationLevel];
  const mode = transaction.mode === "autoCommit" ? transactionCopy.editor.autoCommit : transactionCopy.editor.manual;
  if (!transaction.open) return { text: transaction.mode === "autoCommit" ? copy.autoCommit(level) : copy.idle(level), tone: "normal" };
  if (transaction.failed) return { text: copy.failed(level, mode), tone: "error" };

  const minutes = transaction.openedAt === null ? 0 : Math.max(0, Math.floor((now - transaction.openedAt) / 60_000));
  return { text: copy.open(transaction.commands, minutes, level, mode), tone: minutes >= longTransactionMinutes ? "warning" : "normal" };
}
