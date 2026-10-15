import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { autoRefreshBlocker, createAutoRefresh, customInterval, intervalLabel, outcomeOf, sameCommand } from "./auto-refresh";
import { isBusyState, type RowsState, type RunnerState, type RunTarget } from "./use-query-runner";

const command: RunTarget = { sql: "select * from fila", offset: 0 };

function rows(over: Partial<RowsState> = {}): RowsState {
  return { status: "rows", id: 1, target: command, columns: [{ name: "id", type: "int4", kind: "number" }], rows: [["1"]], truncated: new Map(), hasMore: true, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false, ...over };
}

/**
 * Uma aba de mentira: o estado do executor, as mudanças avisadas a quem assina, e a execução que a prova responde. `run` passa a "executando" na hora (como
 * o executor de verdade) e termina com o que a prova mandar em `finish`; `finishWith` responde a próxima execução sem esperar.
 */
function fakeTab(initial: RunnerState = rows()) {
  let state = initial;
  const listeners = new Set<() => void>();
  let pending: ((next: RunnerState) => void) | null = null;
  const tab = {
    connected: true,
    /** O que a próxima execução devolve, se a prova deixou pronto; senão ela fica em andamento até `finish`. */
    next: null as ((before: RunnerState) => RunnerState) | null,
    /** O executor recusa sem executar (a aba aposentada, por exemplo). */
    refuse: false,
    get: () => state,
    set(next: RunnerState) {
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    run: vi.fn((target: RunTarget): Promise<void> => {
      if (tab.refuse || isBusyState(state)) return Promise.resolve();
      const previous = state.status === "rows" ? state : null;
      tab.set({ status: "running", cancelling: false, previous, auto: true });
      return new Promise<void>((resolve) => {
        pending = (next) => {
          tab.set(next);
          resolve();
        };
        if (tab.next !== null) {
          const answer = tab.next(previous ?? state);
          tab.next = null;
          pending(answer);
          pending = null;
        }
      }).then(() => void target);
    }),
    /** Termina a execução em andamento com este estado. */
    finish(next: RunnerState) {
      const done = pending;
      pending = null;
      done?.(next);
    },
  };
  return tab;
}

function setup(initial?: RunnerState) {
  const tab = fakeTab(initial);
  const auto = createAutoRefresh({ getState: tab.get, subscribe: tab.subscribe, isBusy: isBusyState, connected: () => tab.connected, run: tab.run });
  return { tab, auto };
}

/** Uma leitura nova, com outro objeto de linhas: é o que a execução que deu certo deixa. */
const fresh = (before: RunnerState) => rows({ id: before.status === "rows" ? before.id + 1 : 1, rows: [["2"]] });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 15, 14, 0, 0));
});
afterEach(() => vi.useRealTimers());

describe("autoRefreshBlocker: só liga sobre uma leitura, com a aba livre e conectada (RN-GRADE-014)", () => {
  const free = { busy: false, connected: true };

  it("a leitura lida por cursor liga", () => {
    expect(autoRefreshBlocker(rows(), free)).toBeNull();
    expect(autoRefreshBlocker(rows({ hasMore: false, cursorClosed: true }), free)).toBeNull();
  });

  it("o comando que grava não liga: o que devolveu linhas (RN-SQL-013) e o que só afetou linhas; quem diz é a API, pelo `totalRows`", () => {
    expect(autoRefreshBlocker(rows({ totalRows: 3, hasMore: false }), free)).toBe("writes");
    expect(autoRefreshBlocker({ status: "affected", rowsAffected: 3, elapsedMs: 1 }, free)).toBe("writes");
  });

  it("sem linhas na tela não há o que atualizar: nada executado, o erro, o cancelamento e o aviso", () => {
    for (const state of [{ status: "idle" }, { status: "cancelled" }, { status: "notice", message: "x" }, { status: "error", source: "database", title: "t", message: null, sqlState: null, errorAt: null }] as RunnerState[]) {
      expect(autoRefreshBlocker(state, free)).toBe("noRows");
    }
  });

  it("com a aba ocupada, e sem sessão (nada reconecta sozinho), também não", () => {
    expect(autoRefreshBlocker(rows(), { busy: true, connected: true })).toBe("busy");
    expect(autoRefreshBlocker(rows(), { busy: false, connected: false })).toBe("disconnected");
  });
});

describe("as peças puras", () => {
  it("outcomeOf: a leitura NOVA segue; o resto diz por que parar", () => {
    const before = rows();

    expect(outcomeOf(rows({ id: 2 }), before)).toBeNull();
    expect(outcomeOf(before, before)).toBe("notRun");
    expect(outcomeOf({ status: "error", source: "database", title: "t", message: "m", sqlState: null, errorAt: null }, before)).toBe("failed");
    expect(outcomeOf({ status: "cancelled" }, before)).toBe("cancelled");
    expect(outcomeOf(rows({ totalRows: 1, hasMore: false }), before)).toBe("writes");
    expect(outcomeOf({ status: "affected", rowsAffected: 1, elapsedMs: 1 }, before)).toBe("writes");
    expect(outcomeOf({ status: "idle" }, before)).toBe("notRun");
  });

  it("intervalLabel escreve o intervalo como a tela", () => {
    expect([5_000, 10_000, 30_000, 60_000, 300_000, 90_000, 3_600_000, 2_000].map(intervalLabel)).toEqual(["5 s", "10 s", "30 s", "1 min", "5 min", "1 min 30 s", "1 h", "2 s"]);
  });

  it("customInterval aceita segundos inteiros de 2 a 3.600, com espaço nas pontas, e recusa o resto", () => {
    expect(customInterval(" 45 ")).toBe(45_000);
    expect(customInterval("2")).toBe(2_000);
    expect(customInterval("3600")).toBe(3_600_000);
    for (const text of ["", "1", "3601", "1.5", "1,5", "-5", "abc", "10s", "1e3"]) expect(customInterval(text)).toBeNull();
  });

  it("sameCommand: o mesmo texto e o mesmo filtro; o lugar no editor e o banco não contam", () => {
    expect(sameCommand(command, { ...command, offset: 40, engine: 1 })).toBe(true);
    expect(sameCommand(command, { ...command, filter: "" })).toBe(true);
    expect(sameCommand(command, { ...command, filter: "id > 1" })).toBe(false);
    expect(sameCommand(command, { sql: "select 1", offset: 0 })).toBe(false);
  });
});

describe("o relógio (RN-GRADE-014)", () => {
  it("ligada, executa a cada intervalo e não antes, e guarda a hora da última atualização", async () => {
    const { tab, auto } = setup();
    auto.start(10_000);
    expect(auto.getState()).toEqual({ status: "on", everyMs: 10_000, lastAt: null, running: false, paused: null });

    tab.next = fresh;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(tab.run).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(tab.run).toHaveBeenCalledExactlyOnceWith(command);
    expect(auto.getState()).toMatchObject({ status: "on", lastAt: new Date(2026, 9, 15, 14, 0, 10).getTime(), running: false });

    tab.next = fresh;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(tab.run).toHaveBeenCalledTimes(2);
  });

  it("nunca duas ao mesmo tempo: a próxima só é marcada quando a anterior termina, e conta do fim dela", async () => {
    const { tab, auto } = setup();
    auto.start(5_000);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(tab.run).toHaveBeenCalledOnce();
    expect(auto.getState()).toMatchObject({ running: true });

    // A execução demora 20 s: nada mais sai enquanto isso.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(tab.run).toHaveBeenCalledOnce();

    tab.finish(fresh(tab.get()));
    expect(auto.getState()).toMatchObject({ running: false, lastAt: new Date(2026, 9, 15, 14, 0, 25).getTime() });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(tab.run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.run).toHaveBeenCalledTimes(2);
  });

  it("qualquer coisa que ocupe a aba recomeça o tempo do fim dela ('Carregar mais', 'Contar total')", async () => {
    const { tab, auto } = setup();
    auto.start(10_000);

    await vi.advanceTimersByTimeAsync(8_000);
    tab.set(rows({ loadingMore: true }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tab.run).not.toHaveBeenCalled();
    tab.set(rows({ rows: [["1"], ["2"]], pages: 2 }));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(tab.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.run).toHaveBeenCalledOnce();
    // "Carregar mais" não é atualização: a hora da última fica como estava.
    expect(auto.getState()).toMatchObject({ lastAt: null });
  });

  it("o erro do banco a desliga, com a nota: uma execução só, e nada se repete", async () => {
    const { tab, auto } = setup();
    auto.start(5_000);
    tab.next = () => ({ status: "error", source: "database", title: "Erro do banco", message: "relation does not exist", sqlState: "42P01", errorAt: null });

    await vi.advanceTimersByTimeAsync(5_000);
    expect(auto.getState()).toEqual({ status: "off", stopped: "failed" });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(tab.run).toHaveBeenCalledOnce();
  });

  it("o cancelamento, o comando que não rodou (o resultado de antes de volta) e o comando que gravou também a desligam, cada um com o seu motivo", async () => {
    const cases: [(before: RunnerState) => RunnerState, string][] = [
      [() => ({ status: "cancelled" }), "cancelled"],
      [(before) => before, "notRun"],
      [() => rows({ totalRows: 2, hasMore: false }), "writes"],
    ];
    for (const [answer, stopped] of cases) {
      const { tab, auto } = setup();
      auto.start(5_000);
      tab.next = answer;

      await vi.advanceTimersByTimeAsync(5_000);

      expect(auto.getState()).toEqual({ status: "off", stopped });
    }
  });

  it("o executor que recusa sem chegar a executar também a desliga, como comando que não rodou", async () => {
    const { tab, auto } = setup();
    auto.start(5_000);
    tab.refuse = true;

    await vi.advanceTimersByTimeAsync(5_000);

    expect(auto.getState()).toEqual({ status: "off", stopped: "notRun" });
  });

  it("em pausa não executa; ao sair dela depois do prazo, executa na hora, e antes do prazo espera o que falta", async () => {
    const { tab, auto } = setup();
    auto.start(10_000);
    auto.pause("hidden", true);
    expect(auto.getState()).toMatchObject({ paused: "hidden" });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(tab.run).not.toHaveBeenCalled();

    tab.next = fresh;
    auto.pause("hidden", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.run).toHaveBeenCalledOnce();

    // Logo depois da execução (aos 30 s), uma pausa de 4 s: voltando aos 34 s, faltam 6 s.
    auto.pause("editing", true);
    await vi.advanceTimersByTimeAsync(4_000);
    auto.pause("editing", false);
    tab.next = fresh;
    await vi.advanceTimersByTimeAsync(5_999);
    expect(tab.run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(tab.run).toHaveBeenCalledTimes(2);
  });

  it("a pausa que a barra mostra é a da edição, que a pessoa vê, antes da de fora de vista", () => {
    const { auto } = setup();
    auto.start(10_000);

    auto.pause("hidden", true);
    auto.pause("editing", true);
    expect(auto.getState()).toMatchObject({ paused: "editing" });

    auto.pause("editing", false);
    expect(auto.getState()).toMatchObject({ paused: "hidden" });
    auto.pause("hidden", false);
    expect(auto.getState()).toMatchObject({ paused: null });
  });

  it("não liga sobre o que não se aplica; ligada, nada a impede de trocar o intervalo", async () => {
    const writes = setup(rows({ totalRows: 3, hasMore: false }));
    writes.auto.start(5_000);
    expect(writes.auto.getState()).toEqual({ status: "off", stopped: null });
    expect(writes.auto.blocker()).toBe("writes");

    const { tab, auto } = setup();
    tab.connected = false;
    expect(auto.blocker()).toBe("disconnected");
    tab.connected = true;
    auto.start(60_000);
    expect(auto.blocker()).toBeNull();

    await vi.advanceTimersByTimeAsync(20_000);
    auto.start(5_000);
    expect(auto.getState()).toMatchObject({ status: "on", everyMs: 5_000 });
    tab.next = fresh;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tab.run).toHaveBeenCalledOnce();
  });

  it("o mesmo comando da pessoa (o F5) a mantém, e o tempo recomeça do fim dele; outro comando a desliga, sem nota", async () => {
    const { tab, auto } = setup();
    auto.start(10_000);
    await vi.advanceTimersByTimeAsync(7_000);

    auto.ranByPerson({ ...command, offset: 12 });
    tab.set({ status: "running", cancelling: false, previous: tab.get() as RowsState });
    tab.set(rows({ id: 2 }));
    expect(auto.getState()).toMatchObject({ status: "on", lastAt: new Date(2026, 9, 15, 14, 0, 7).getTime() });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(tab.run).not.toHaveBeenCalled();

    auto.ranByPerson({ sql: "select * from outra", offset: 0 });
    expect(auto.getState()).toEqual({ status: "off", stopped: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tab.run).not.toHaveBeenCalled();
  });

  it("o F5 da pessoa que dá erro também a para, com a nota", () => {
    const { tab, auto } = setup();
    auto.start(10_000);

    auto.ranByPerson(command);
    tab.set({ status: "running", cancelling: false, previous: tab.get() as RowsState });
    tab.set({ status: "error", source: "database", title: "t", message: "m", sqlState: null, errorAt: null });

    expect(auto.getState()).toEqual({ status: "off", stopped: "failed" });
  });

  it("a nota fica até a próxima execução da pessoa, ou até ligar de novo", async () => {
    const { tab, auto } = setup();
    auto.start(5_000);
    tab.next = () => ({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(auto.getState()).toEqual({ status: "off", stopped: "cancelled" });

    auto.ranByPerson({ sql: "select 1", offset: 0 });
    expect(auto.getState()).toEqual({ status: "off", stopped: null });

    // Parou de novo, agora com as linhas de antes de volta (a API não respondeu): ligar de novo tira a nota.
    tab.set(rows({ id: 9 }));
    tab.next = (before) => before;
    auto.start(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(auto.getState()).toEqual({ status: "off", stopped: "notRun" });

    auto.start(10_000);
    expect(auto.getState()).toEqual({ status: "on", everyMs: 10_000, lastAt: null, running: false, paused: null });
  });

  it("desligar (a pessoa) e soltar a aba (`halt`) param tudo, sem nota; a execução em andamento termina sem religar nada", async () => {
    const { tab, auto } = setup();
    auto.start(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tab.run).toHaveBeenCalledOnce();

    auto.stop();
    tab.finish(fresh(tab.get()));
    expect(auto.getState()).toEqual({ status: "off", stopped: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tab.run).toHaveBeenCalledOnce();

    auto.start(5_000);
    auto.halt();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tab.run).toHaveBeenCalledOnce();
    expect(auto.getState()).toEqual({ status: "off", stopped: null });
  });

  it("a execução que o executor abandonou para o comando da pessoa (`yielded`) não conta: quem diz se segue é o comando da pessoa", async () => {
    const { tab, auto } = setup();
    auto.start(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(auto.getState()).toMatchObject({ running: true });
    const before = (tab.get() as Extract<RunnerState, { status: "running" }>).previous;

    // O mesmo comando da pessoa entra no lugar: a aba passa direto ao comando dela, sem o desfecho da automática no meio.
    auto.ranByPerson(command);
    auto.yielded();
    expect(auto.getState()).toMatchObject({ status: "on", running: false });
    tab.set({ status: "running", cancelling: false, previous: before });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tab.run).toHaveBeenCalledOnce();

    tab.set(rows({ id: 7 }));
    expect(auto.getState()).toMatchObject({ status: "on", lastAt: new Date(2026, 9, 15, 14, 1, 5).getTime() });
    tab.next = fresh;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(tab.run).toHaveBeenCalledTimes(2);
  });

  it("a execução abandonada que termina depois (a promessa dela) não a desliga como comando que não rodou", async () => {
    const { tab, auto } = setup();
    auto.start(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    auto.yielded();
    tab.finish(rows({ id: 3 }));
    await vi.advanceTimersByTimeAsync(0);

    expect(auto.getState()).toMatchObject({ status: "on" });
  });

  it("a sessão que caiu (`lost`) a desliga com a nota; desligada, não deixa nota", () => {
    const { auto } = setup();
    auto.start(5_000);
    auto.lost();
    expect(auto.getState()).toEqual({ status: "off", stopped: "disconnected" });

    const other = setup();
    other.auto.lost();
    expect(other.auto.getState()).toEqual({ status: "off", stopped: null });
  });

  it("sem sessão na hora de executar, ela não executa (abriria outra sozinha): para, com a nota", async () => {
    const { tab, auto } = setup();
    auto.start(5_000);
    tab.connected = false;

    await vi.advanceTimersByTimeAsync(5_000);

    expect(tab.run).not.toHaveBeenCalled();
    expect(auto.getState()).toEqual({ status: "off", stopped: "disconnected" });
  });

  it("a aba indo para outra janela é pausa: nada executa até ela sair", async () => {
    const { tab, auto } = setup();
    auto.start(5_000);
    auto.pause("moving", true);
    expect(auto.getState()).toMatchObject({ paused: "moving" });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(tab.run).not.toHaveBeenCalled();

    tab.next = fresh;
    auto.pause("moving", false);
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.run).toHaveBeenCalledOnce();
  });

  it("avisa quem assina a cada mudança", () => {
    const { auto } = setup();
    const listener = vi.fn();
    const unsubscribe = auto.subscribe(listener);

    auto.start(5_000);
    auto.pause("hidden", true);
    auto.stop();
    unsubscribe();
    auto.start(5_000);

    expect(listener).toHaveBeenCalledTimes(3);
  });
});
