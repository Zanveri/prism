import { describe, expect, it, vi } from "vitest";

import type { RowsState, RunnerState } from "./use-query-runner";
import { handOffTab, type HandOffRunner } from "./tab-handoff";

const rows: RowsState = { status: "rows", id: 1, target: { sql: "select * from fila", offset: 0 }, columns: [], rows: [], truncated: new Map(), hasMore: true, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false };

/** O executor da aba, com a execução automática em andamento até a prova soltar (`finish`), e o que a passagem fez na ordem em que fez. */
function fakeRunner(state: RunnerState, running = false) {
  const log: string[] = [];
  let finish = () => {};
  const settled = running ? new Promise<void>((resolve) => (finish = resolve)) : Promise.resolve();
  const runner: HandOffRunner & { state: RunnerState } = {
    state,
    getState: () => runner.state,
    autoRunSettled: () => {
      log.push("espera");
      return settled.then(() => void log.push("terminou"));
    },
    autoRefresh: { pause: (reason, on) => void log.push(`${reason}:${String(on)}`) },
  };
  return { runner, log, finish: () => finish() };
}

describe("handOffTab: a aba vai para outra janela com a atualização automática suspensa (RN-ABAS-002 e 003, RN-GRADE-014)", () => {
  it("suspende antes de tudo, espera a execução automática em andamento, lê a aba depois dela e solta a pausa no fim", async () => {
    const { runner, log, finish } = fakeRunner({ status: "running", cancelling: false, previous: rows, auto: true }, true);
    const fresh: RowsState = { ...rows, id: 2 };
    const prepare = vi.fn((state: RunnerState) => {
      log.push("lê");
      return state;
    });
    const send = vi.fn(async () => {
      log.push("manda");
      return true;
    });

    const going = handOffTab(runner, { alive: () => true, prepare, send });
    await Promise.resolve();
    expect(log).toEqual(["moving:true", "espera"]);
    expect(prepare).not.toHaveBeenCalled();

    runner.state = fresh;
    finish();

    await expect(going).resolves.toBe("sent");
    expect(prepare).toHaveBeenCalledExactlyOnceWith(fresh);
    expect(log).toEqual(["moving:true", "espera", "terminou", "lê", "manda", "moving:false"]);
  });

  it("com um comando da pessoa em andamento a aba não vai (`busy`), e a pausa sai", async () => {
    const { runner, log } = fakeRunner({ status: "running", cancelling: false, previous: rows });
    const send = vi.fn(async () => true);

    await expect(handOffTab(runner, { alive: () => true, prepare: () => null, send })).resolves.toBe("busy");
    expect(send).not.toHaveBeenCalled();
    expect(log.at(-1)).toBe("moving:false");
  });

  it("a outra janela não a levou (`refused`): ela fica, e a atualização automática continua", async () => {
    const { runner, log } = fakeRunner(rows);

    await expect(handOffTab(runner, { alive: () => true, prepare: (state) => state, send: async () => false })).resolves.toBe("refused");
    expect(log.at(-1)).toBe("moving:false");
  });

  it("a aba fechou, ou trocou de executor, enquanto a execução automática terminava: nada vai (`gone`)", async () => {
    const { runner, finish } = fakeRunner({ status: "running", cancelling: false, previous: rows, auto: true }, true);
    let alive = true;
    const prepare = vi.fn(() => rows);

    const going = handOffTab(runner, { alive: () => alive, prepare, send: async () => true });
    alive = false;
    finish();

    await expect(going).resolves.toBe("gone");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("a falha ao mandar também tira a pausa", async () => {
    const { runner, log } = fakeRunner(rows);

    await expect(handOffTab(runner, { alive: () => true, prepare: (state) => state, send: () => Promise.reject(new Error("ponte caiu")) })).rejects.toThrow("ponte caiu");
    expect(log.at(-1)).toBe("moving:false");
  });
});
