import { describe, expect, it, vi } from "vitest";

import { createTransactionStore, engineIsolationLevels, fromWire, initialTransaction, normalizeIsolationLevel, transactionOf, transactionStatus, type TabTransaction } from "./transaction";

const manual = (patch: Partial<TabTransaction> = {}): TabTransaction => ({ ...initialTransaction, mode: "manual", ...patch });
const now = Date.parse("2026-10-29T12:00:00Z");

describe("transactionStatus", () => {
  it("diz o modo, o nível de isolamento e se há transação aberta (RN-TX-003 e RN-ISOL-002)", () => {
    expect(transactionStatus(initialTransaction, now)).toEqual({ text: "Auto-commit · Padrão do banco", tone: "normal" });
    expect(transactionStatus({ ...initialTransaction, isolationLevel: "serializable" }, now)).toEqual({ text: "Auto-commit · Serializable", tone: "normal" });
    expect(transactionStatus(manual(), now)).toEqual({ text: "Commit manual · Padrão do banco · sem transação aberta", tone: "normal" });
    expect(transactionStatus(manual({ isolationLevel: "cursorStability" }), now)).toEqual({ text: "Commit manual · Cursor Stability · sem transação aberta", tone: "normal" });
  });

  it("conta os comandos sem commit e o tempo, inclusive quando BEGIN explícito abriu transação em Auto-commit, e passa à atenção depois de 10 minutos", () => {
    expect(transactionStatus(manual({ open: true, commands: 1, openedAt: now - 30_000 }), now)).toEqual({ text: "Commit manual · Padrão do banco · 1 comando sem commit · há menos de 1 min", tone: "normal" });
    expect(transactionStatus({ ...initialTransaction, open: true, commands: 2, openedAt: now - 2 * 60_000 }, now)).toEqual({ text: "Auto-commit · Padrão do banco · 2 comandos sem commit · há 2 min", tone: "normal" });
    expect(transactionStatus(manual({ open: true, commands: 3, openedAt: now - 4 * 60_000 }), now)).toEqual({ text: "Commit manual · Padrão do banco · 3 comandos sem commit · há 4 min", tone: "normal" });
    expect(transactionStatus(manual({ open: true, commands: 3, openedAt: now - 10 * 60_000 }), now).tone).toBe("warning");
  });

  it("diz a transação com erro no tom de erro (RN-TX-009)", () => {
    expect(transactionStatus(manual({ open: true, failed: true, commands: 2, openedAt: now }), now)).toEqual({ text: "Commit manual · Padrão do banco · transação com erro: só resta o Rollback", tone: "error" });
  });
});

describe("engineIsolationLevels e normalizeIsolationLevel", () => {
  it("lista os níveis de cada banco e recua para 'default' quando o nível não existe no banco (RN-ISOL-001 e 006)", () => {
    expect(engineIsolationLevels(1)).toEqual(["default", "readUncommitted", "readCommitted", "repeatableRead", "serializable"]);
    expect(engineIsolationLevels(2)).toEqual(["default", "readUncommitted", "cursorStability", "readStability", "repeatableRead"]);
    expect(engineIsolationLevels(3)).toEqual(["default", "readUncommitted", "readCommitted", "committedReadLastCommitted", "cursorStability", "repeatableRead"]);
    expect(normalizeIsolationLevel("serializable", 1)).toBe("serializable");
    expect(normalizeIsolationLevel("serializable", 2)).toBe("default");
    expect(normalizeIsolationLevel("cursorStability", 3)).toBe("cursorStability");
  });
});

describe("transactionOf e fromWire", () => {
  it("lê o estado da API, e o que não está na forma vira nulo", () => {
    const wire = transactionOf({ mode: "manual", isolationLevel: "repeatableRead", open: true, failed: false, commands: 2, openedAt: "2026-10-29T11:56:00Z" });
    expect(wire).not.toBeNull();
    expect(fromWire(wire!)).toEqual({ mode: "manual", isolationLevel: "repeatableRead", open: true, failed: false, commands: 2, openedAt: Date.parse("2026-10-29T11:56:00Z") });
    expect(transactionOf({ mode: "outro" })).toBeNull();
    expect(transactionOf(undefined)).toBeNull();
  });

  it("sem transação aberta, os comandos e o começo não contam", () => {
    expect(fromWire({ mode: "manual", isolationLevel: "default", open: false, failed: false, commands: 5, openedAt: "2026-10-29T11:56:00Z" })).toEqual({
      mode: "manual",
      isolationLevel: "default",
      open: false,
      failed: false,
      commands: 0,
      openedAt: null,
    });
  });
});

describe("createTransactionStore", () => {
  it("avisa quem ouve só quando algo muda", () => {
    const store = createTransactionStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.set({ mode: "autoCommit" });
    store.set({ mode: "manual" });

    expect(listener).toHaveBeenCalledOnce();
    expect(store.getState().mode).toBe("manual");
  });
});
