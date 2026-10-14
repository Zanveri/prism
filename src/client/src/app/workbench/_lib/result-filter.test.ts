import { describe, expect, it, vi } from "vitest";

import { applyResultFilter, clearResultFilter, filterBaseOf } from "./result-filter";
import type { FilterRefusal, RowsState, RunnerState, RunTarget } from "./use-query-runner";

// RN-GRADE-011: o campo de filtro no resultado da aba de consulta.
const command: RunTarget = { sql: "select * from pedidos", offset: 4, engine: 1 };
const rows = (target: RunTarget = command): RowsState => ({ status: "rows", id: 1, target, columns: [], rows: [], truncated: new Map(), hasMore: false, totalRows: null, elapsedMs: 1, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false });
const error: RunnerState = { status: "error", source: "database", title: "Erro do banco", message: 'column "x" does not exist', sqlState: "42703", errorAt: null };

describe("filterBaseOf: o comando que o campo filtra", () => {
  it("o do resultado na tela, sem o filtro (também esmaecido, enquanto outro roda)", () => {
    expect(filterBaseOf(rows(), null)).toEqual(command);
    expect(filterBaseOf(rows({ ...command, filter: "id > 1" }), null)).toEqual(command);
    expect(filterBaseOf({ status: "running", cancelling: false, previous: rows({ ...command, filter: "x" }) }, null)).toEqual(command);
  });

  it("sem linhas na tela, o do último filtro aplicado; sem ele, nada (o campo não aparece)", () => {
    expect(filterBaseOf(error, command)).toEqual(command);
    expect(filterBaseOf(error, null)).toBeNull();
    expect(filterBaseOf({ status: "idle" }, null)).toBeNull();
    expect(filterBaseOf({ status: "affected", rowsAffected: 1, elapsedMs: 1 }, null)).toBeNull();
  });
});

describe("applyResultFilter: aplicar executa de novo o comando com o filtro, e o texto do editor não muda", () => {
  const spies = (refusal?: FilterRefusal) => ({ setDraft: vi.fn(), setApplied: vi.fn(), setProblem: vi.fn(), setPinned: vi.fn(), run: vi.fn(async () => refusal) });

  it("o comando vai com o filtro do campo (sem o espaço das pontas e sem o `;` do fim); o filtro passa a valer e o comando fica fixado", async () => {
    const deps = spies();
    await applyResultFilter(command, '  "code" = 1 ORDER BY "id" ; ', "", rows(), deps);

    expect(deps.run.mock.calls).toEqual([[{ ...command, filter: '"code" = 1 ORDER BY "id"' }]]);
    expect(deps.setApplied.mock.calls).toEqual([['"code" = 1 ORDER BY "id"']]);
    expect(deps.setPinned.mock.calls).toEqual([[command]]);
    expect(deps.setDraft.mock.calls).toEqual([['  "code" = 1 ORDER BY "id" ; ']]);
    expect(deps.setProblem.mock.calls).toEqual([[null]]);
  });

  it("vazio (Limpar, Remover todos): o comando vai sem filtro", async () => {
    const deps = spies();
    await applyResultFilter(command, "", "id > 1", rows({ ...command, filter: "id > 1" }), deps);

    expect(deps.run.mock.calls).toEqual([[command]]);
    expect(deps.setApplied.mock.calls).toEqual([[""]]);
  });

  it("a recusa da API (FILTER_INVALID) volta ao campo com a frase dela, e o filtro em vigor volta a ser o de antes", async () => {
    const deps = spies({ code: "FILTER_INVALID", message: "O filtro deixa aspas abertas." });
    await applyResultFilter(command, "code = 'a", "id > 1", rows(), deps);

    expect(deps.setProblem.mock.calls).toEqual([[null], [{ message: "O filtro deixa aspas abertas." }]]);
    expect(deps.setApplied.mock.calls).toEqual([["code = 'a"], ["id > 1"]]);
  });

  it("com a aba ocupada, ou sem comando a filtrar, nada muda", async () => {
    for (const state of [{ status: "running", cancelling: false, previous: rows() }, { ...rows(), loadingMore: true }, { ...rows(), counting: true }] as RunnerState[]) {
      const deps = spies();
      await applyResultFilter(command, "x", "", state, deps);
      expect(Object.values(deps).every((spy) => spy.mock.calls.length === 0), state.status).toBe(true);
    }
    const deps = spies();
    await applyResultFilter(null, "x", "", rows(), deps);
    expect(deps.run).not.toHaveBeenCalled();
  });
});

describe("clearResultFilter: executar pelo editor limpa o filtro", () => {
  it("o campo, o filtro em vigor, a recusa e o comando fixado", () => {
    const deps = { setDraft: vi.fn(), setApplied: vi.fn(), setProblem: vi.fn(), setPinned: vi.fn() };
    clearResultFilter(deps);

    expect([deps.setDraft.mock.calls, deps.setApplied.mock.calls, deps.setProblem.mock.calls, deps.setPinned.mock.calls]).toEqual([[[""]], [[""]], [[null]], [[null]]]);
  });
});
