import { describe, expect, it } from "vitest";

import { autoLoadArmed, loadMoreMargin, nearEnd } from "./result-paging";
import type { RowsState, RunnerState } from "./use-query-runner";

const rows: RowsState = {
  status: "rows",
  id: 1,
  target: { sql: "select 1", offset: 0 },
  columns: [{ name: "id", type: "int4", kind: "number" }],
  rows: [["1"]],
  truncated: new Map(),
  hasMore: true,
  totalRows: null,
  elapsedMs: 1,
  pages: 1,
  loadingMore: false,
  cancelling: false,
  cursorClosed: false,
  total: null,
  counting: false,
};

const armed = (state: RunnerState, over: { enabled?: boolean; connected?: boolean } = {}) => autoLoadArmed(state, { enabled: over.enabled ?? true, connected: over.connected ?? true });

describe("nearEnd: a grade chegou ao fim (RN-CONFIG-005)", () => {
  it("rolada até o fim, ou a menos de duas linhas dele", () => {
    expect(nearEnd({ scrollTop: 5400, clientHeight: 600, scrollHeight: 6000 })).toBe(true);
    expect(nearEnd({ scrollTop: 5400 - loadMoreMargin, clientHeight: 600, scrollHeight: 6000 })).toBe(true);
  });

  it("no meio ou no começo, não", () => {
    expect(nearEnd({ scrollTop: 0, clientHeight: 600, scrollHeight: 6400 })).toBe(false);
    expect(nearEnd({ scrollTop: 5000, clientHeight: 600, scrollHeight: 6400 })).toBe(false);
  });

  it("um conteúdo menor que a janela já está no fim: não há o que rolar, e a próxima página vem", () => {
    expect(nearEnd({ scrollTop: 0, clientHeight: 600, scrollHeight: 320 })).toBe(true);
  });

  it("uma grade sem altura (aba escondida, área recolhida) nunca está no fim: não busca por trás de ninguém", () => {
    expect(nearEnd({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 })).toBe(false);
  });
});

describe("autoLoadArmed: quando a grade pode pedir a página seguinte sozinha (RN-CONFIG-005)", () => {
  it("com a preferência ligada, linhas na tela, mais a ler e nada em andamento", () => {
    expect(armed(rows)).toBe(true);
  });

  it("desligada, nunca", () => {
    expect(armed(rows, { enabled: false })).toBe(false);
  });

  it("uma por vez: página, contagem ou comando em andamento seguram a próxima", () => {
    expect(armed({ ...rows, loadingMore: true })).toBe(false);
    expect(armed({ ...rows, counting: true })).toBe(false);
    expect(armed({ status: "running", cancelling: false, previous: rows })).toBe(false);
  });

  it("não durante um cancelamento, e não depois dele: o cursor fechado é o fim", () => {
    expect(armed({ ...rows, cancelling: true })).toBe(false);
    expect(armed({ ...rows, cursorClosed: true })).toBe(false);
  });

  it("sem mais linhas, ou com o comando que gravou e já devolveu tudo, não há o que buscar", () => {
    expect(armed({ ...rows, hasMore: false })).toBe(false);
    expect(armed({ ...rows, hasMore: false, totalRows: 1 })).toBe(false);
  });

  it("sem sessão (desconectada), a página seguinte só diria que o cursor fechou", () => {
    expect(armed(rows, { connected: false })).toBe(false);
  });

  it("sem linhas na tela (erro, nada executado, afetadas), não", () => {
    expect(armed({ status: "idle" })).toBe(false);
    expect(armed({ status: "cancelled" })).toBe(false);
    expect(armed({ status: "affected", rowsAffected: 1, elapsedMs: 1 })).toBe(false);
    expect(armed({ status: "error", source: "database", title: "Erro do banco", message: null, sqlState: null, errorAt: null })).toBe(false);
  });
});
