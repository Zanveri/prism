import { describe, expect, it } from "vitest";

import type { RowsState, RunnerState } from "../use-query-runner";
import { importedAfterRead, initialReadWatch, watchRead, type ReadWatch } from "./imported-note";

const rows = (over: Partial<RowsState> = {}): RowsState => ({ status: "rows", id: 1, target: { sql: "select * from pedido", offset: 0 }, columns: [], rows: [], truncated: new Map(), hasMore: false, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false, ...over });
const running = (previous: RowsState | null, auto = false): RunnerState => ({ status: "running", cancelling: false, previous, ...(auto ? { auto: true as const } : {}) });

/** Passa a aba pelos estados dados, com o número da tabela de cada momento. */
function through(steps: readonly (readonly [RunnerState, number])[], from: ReadWatch = { started: null, read: null }): ReadWatch {
  return steps.reduce((watch, [state, mark]) => watchRead(watch, state, mark), from);
}

describe("a nota das linhas importadas depois da leitura (RN-IMPORT-020)", () => {
  it("a importação que terminou depois da leitura acende a nota; a aba que lê de novo a apaga", () => {
    const first = rows();
    let watch = through([[{ status: "idle" }, 0], [running(null), 0], [first, 0]]);
    expect(importedAfterRead(watch, 0)).toBe(false);
    expect(importedAfterRead(watch, 1)).toBe(true);

    watch = through([[running(first), 1], [rows({ id: 2 }), 1]], watch);
    expect(importedAfterRead(watch, 1)).toBe(false);
  });

  it("vale o número do COMEÇO da leitura: a importação que terminou com a leitura em andamento deixa a nota acesa", () => {
    const first = rows();
    const watch = through([[running(null), 0], [running(null), 1], [first, 1]]);
    expect(importedAfterRead(watch, 1)).toBe(true);
  });

  it("a atualização automática (RN-GRADE-014) também lê, mesmo com a grade de antes (o mesmo id)", () => {
    const first = rows();
    const watch = through([[running(null), 0], [first, 0], [running(first, true), 3], [rows(), 3]]);
    expect(importedAfterRead(watch, 3)).toBe(false);
  });

  it("o comando que a API não aceitou devolve as linhas de antes: nada foi lido, e a nota continua", () => {
    const first = rows();
    const watch = through([[running(null), 0], [first, 0], [running(first), 2], [first, 2]]);
    expect(importedAfterRead(watch, 2)).toBe(true);
  });

  it("\"Carregar mais\", contar e editar trocam as linhas sem ler de novo", () => {
    const first = rows();
    const watch = through([[running(null), 0], [first, 0], [rows({ pages: 2 }), 1], [rows({ total: 10 }), 1]]);
    expect(importedAfterRead(watch, 1)).toBe(true);
  });

  it("o erro e o cancelamento encerram a leitura sem linhas: a próxima conta do começo dela", () => {
    const first = rows();
    const watch = through([[running(null), 0], [first, 0], [running(first), 1], [{ status: "cancelled" }, 1], [running(null), 2], [rows({ id: 3 }), 2]]);
    expect(importedAfterRead(watch, 2)).toBe(false);
  });

  it("a vista que volta a montar com linhas na tela e sem nada guardado as conta como lidas agora; nada muda devolve o mesmo objeto", () => {
    const watch = initialReadWatch(rows(), 4);
    expect(importedAfterRead(watch, 4)).toBe(false);
    expect(watchRead(watch, rows(), 5)).toBe(watch);
    expect(importedAfterRead(initialReadWatch({ status: "idle" }, 4), 9)).toBe(false);
  });
});
