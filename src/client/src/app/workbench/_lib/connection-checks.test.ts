import { describe, expect, it } from "vitest";

import type { ConnectionVerificationResult } from "@/app/connections/_lib/connections.schema";

import { checkView, createConnectionChecks, notConnectedIds, type CheckState, type CheckTarget } from "./connection-checks";
import { clockOf, connectionChecksCopy } from "./connection-checks.copy";

const copy = connectionChecksCopy;

/** Uma promessa que o teste resolve quando quer: a vez entre as janelas e a resposta da API chegam na hora que o teste diz. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const ok = (checkedAt = "2026-10-15T14:32:05Z", elapsedMs = 3): ConnectionVerificationResult => ({ status: "ok", checkedAt, elapsedMs, message: null, sqlState: null });
const failed = (message = "FATAL: terminating connection due to administrator command", sqlState: string | null = "57P01"): ConnectionVerificationResult => ({ status: "failed", checkedAt: "2026-10-15T14:32:35Z", elapsedMs: 12, message, sqlState });
const busy: ConnectionVerificationResult = { status: "busy", checkedAt: "2026-10-15T14:33:05Z", elapsedMs: null, message: null, sqlState: null };
const notConnected: ConnectionVerificationResult = { status: "notConnected", checkedAt: "2026-10-15T14:33:05Z", elapsedMs: null, message: null, sqlState: null };

const target = (intervalSeconds = 30, sessions = "s1"): CheckTarget => ({ intervalSeconds, sessions });

/**
 * A verificação com tudo na mão do teste: os relógios (o que foi agendado, com quanto, e o que foi cancelado), a vez pedida e a resposta de cada pedido, o
 * que foi contado às outras janelas e os avisos de passagem.
 */
function setup({ claims = true }: { claims?: boolean } = {}) {
  let timers: { run: () => void; ms: number }[] = [];
  const claimed: { connectionId: string; intervalMs: number }[] = [];
  const asked: { connectionId: string; signal: AbortSignal; answer: (result: ConnectionVerificationResult | null) => void }[] = [];
  const finished: { connectionId: string; result: ConnectionVerificationResult | null }[] = [];
  const transitions: string[] = [];
  const state = { paused: false, grant: claims };

  const checks = createConnectionChecks({
    claim: async (connectionId, intervalMs) => {
      claimed.push({ connectionId, intervalMs });
      return state.grant;
    },
    verify: (connectionId, signal) => {
      const answer = deferred<ConnectionVerificationResult | null>();
      asked.push({ connectionId, signal, answer: answer.resolve });
      return answer.promise;
    },
    finish: (connectionId, result) => void finished.push({ connectionId, result }),
    schedule: (run, ms) => {
      const timer = { run, ms };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
    paused: () => state.paused,
  });
  checks.onTransition((connectionId, transition) => void transitions.push(`${connectionId}:${transition}`));

  /** Dispara os relógios que estão de pé e espera o que eles pedem. */
  async function fire() {
    const due = timers;
    timers = [];
    for (const timer of due) timer.run();
    await settle();
  }

  /** Responde o último pedido à API e espera o fim dele. */
  async function answer(result: ConnectionVerificationResult | null) {
    asked[asked.length - 1].answer(result);
    await settle();
  }

  return { checks, timers: () => timers, claimed, asked, finished, transitions, state, fire, answer };
}

describe("a verificação periódica (RN-VERIF-002)", () => {
  it("a conexão que entra espera o intervalo, pede a vez, verifica e recomeça a contar do fim da resposta, um pedido por vez", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target(30)]]));

    expect(run.checks.get("c1")).toEqual({ kind: "waiting", busy: false });
    expect(run.timers().map((timer) => timer.ms)).toEqual([30_000]);
    expect(run.asked).toHaveLength(0);

    await run.fire();
    expect(run.claimed).toEqual([{ connectionId: "c1", intervalMs: 30_000 }]);
    expect(run.asked.map((ask) => ask.connectionId)).toEqual(["c1"]);
    // Com o pedido a caminho não há relógio: o seguinte só começa a contar quando ele volta.
    expect(run.timers()).toHaveLength(0);

    await run.answer(ok());
    expect(run.checks.get("c1")).toEqual({ kind: "ok", checkedAt: "2026-10-15T14:32:05Z", elapsedMs: 3, busy: false });
    expect(run.finished).toEqual([{ connectionId: "c1", result: ok() }]);
    expect(run.timers().map((timer) => timer.ms)).toEqual([30_000]);
  });

  it("a conexão que desconecta sai na hora: o pedido a caminho é abandonado, a resposta dele não volta ao indicador, e nada mais é agendado", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    await run.fire();

    run.checks.track(new Map());
    expect(run.asked[0].signal.aborted).toBe(true);
    expect(run.checks.get("c1")).toBeNull();

    await run.answer(ok());
    expect(run.checks.get("c1")).toBeNull();
    expect(run.timers()).toHaveLength(0);
  });

  it("a que sai antes de o relógio disparar não verifica", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    run.checks.track(new Map());

    expect(run.timers()).toHaveLength(0);
    await run.fire();
    expect(run.claimed).toHaveLength(0);
  });

  it("com o cofre bloqueado nada sai: nem a vez, nem o pedido (RN-SEG-001)", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    run.state.paused = true;

    await run.fire();
    expect(run.claimed).toHaveLength(0);
    expect(run.asked).toHaveLength(0);
  });

  it("trocar o intervalo recomeça a contar dele", () => {
    const run = setup();
    run.checks.track(new Map([["c1", target(30)]]));
    run.checks.track(new Map([["c1", target(5)]]));

    expect(run.timers().map((timer) => timer.ms)).toEqual([5_000]);
  });

  it("`busy` deixa o indicador como estava, com a marca de ocupada, e segue verificando", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    await run.fire();
    await run.answer(ok());
    await run.fire();
    await run.answer(busy);

    expect(run.checks.get("c1")).toEqual({ kind: "ok", checkedAt: "2026-10-15T14:32:05Z", elapsedMs: 3, busy: true });
    expect(run.timers()).toHaveLength(1);
  });

  it("a chamada que falhou (a API fora do ar, a conexão que sumiu) deixa o indicador como estava e tenta no intervalo seguinte", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    await run.fire();
    await run.answer(null);

    expect(run.checks.get("c1")).toEqual({ kind: "waiting", busy: false });
    expect(run.finished).toEqual([{ connectionId: "c1", result: null }]);
    expect(run.timers()).toHaveLength(1);
  });

  it("`notConnected` para a verificação até a conexão ganhar uma sessão nova, e então ela volta a contar", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target(30, "s1")]]));
    await run.fire();
    await run.answer(notConnected);

    expect(run.checks.get("c1")).toEqual({ kind: "notConnected" });
    expect(run.timers()).toHaveLength(0);

    run.checks.track(new Map([["c1", target(30, "s1")]]));
    expect(run.timers()).toHaveLength(0);

    run.checks.track(new Map([["c1", target(30, "s2")]]));
    expect(run.checks.get("c1")).toEqual({ kind: "waiting", busy: false });
    expect(run.timers().map((timer) => timer.ms)).toEqual([30_000]);
  });

  it("as que responderam `notConnected` são as que não contam como conectadas (RN-NAV-013), até uma sessão nova abrir", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target(30, "s1")], ["c2", target(30, "s2")]]));
    expect(notConnectedIds(run.checks.snapshot())).toEqual([]);

    await run.fire();
    run.asked[0].answer(notConnected);
    run.asked[1].answer(ok());
    await settle();
    expect(notConnectedIds(run.checks.snapshot())).toEqual(["c1"]);

    run.checks.track(new Map([["c1", target(30, "s9")], ["c2", target(30, "s2")]]));
    expect(notConnectedIds(run.checks.snapshot())).toEqual([]);
  });

  it("o indicador é o mesmo objeto enquanto nada muda, para quem desenha não redesenhar", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    const before = run.checks.snapshot();
    run.checks.track(new Map([["c1", target()]]));

    expect(run.checks.snapshot()).toBe(before);
  });
});

describe("entre as janelas (RN-VERIF-002: uma verificação por intervalo, mesmo com a conexão conectada em várias)", () => {
  it("sem a vez, esta janela não chama a API e volta a contar; a resposta de outra janela vai ao indicador e recomeça o relógio", async () => {
    const run = setup({ claims: false });
    run.checks.track(new Map([["c1", target()]]));
    await run.fire();

    expect(run.claimed).toHaveLength(1);
    expect(run.asked).toHaveLength(0);
    expect(run.timers()).toHaveLength(1);

    run.checks.peer("c1", ok("2026-10-15T14:40:00Z", 4));
    expect(run.checks.get("c1")).toEqual({ kind: "ok", checkedAt: "2026-10-15T14:40:00Z", elapsedMs: 4, busy: false });
    expect(run.timers()).toHaveLength(1);
  });

  it("a resposta de outra janela com a verificação daqui a caminho fica de fora; `busy` e `notConnected` de lá não mudam o indicador daqui", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    await run.fire();

    run.checks.peer("c1", failed());
    expect(run.checks.get("c1")?.kind).toBe("waiting");

    await run.answer(ok());
    run.checks.peer("c1", busy);
    run.checks.peer("c1", notConnected);
    expect(run.checks.get("c1")).toMatchObject({ kind: "ok", busy: false });
  });

  it("a resposta de uma conexão que esta janela não verifica é ignorada", () => {
    const run = setup();
    run.checks.peer("c9", ok());

    expect(run.checks.get("c9")).toBeNull();
  });
});

describe("o aviso de passagem (RN-VERIF-003)", () => {
  it("passar de responder a não responder avisa uma vez, e não de novo enquanto continuar sem responder; voltar a responder avisa", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    await run.fire();
    await run.answer(ok());
    await run.fire();
    await run.answer(failed());
    await run.fire();
    await run.answer(failed("outra mensagem"));
    await run.fire();
    await run.answer(ok());

    expect(run.transitions).toEqual(["c1:failed", "c1:recovered"]);
    expect(run.checks.get("c1")?.kind).toBe("ok");
  });

  it("a primeira verificação que falha também avisa: a conexão respondeu ao abrir", async () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    await run.fire();
    await run.answer(failed());

    expect(run.transitions).toEqual(["c1:failed"]);
  });

  it("a falha que chega de outra janela avisa aqui também", () => {
    const run = setup();
    run.checks.track(new Map([["c1", target()]]));
    run.checks.peer("c1", failed());

    expect(run.transitions).toEqual(["c1:failed"]);
  });
});

describe("o que o indicador diz (RN-VERIF-003)", () => {
  const states: Record<string, CheckState> = {
    waiting: { kind: "waiting", busy: false },
    ok: { kind: "ok", checkedAt: "2026-10-15T14:32:05Z", elapsedMs: 3, busy: false },
    failed: { kind: "failed", checkedAt: "2026-10-15T14:32:35Z", elapsedMs: 12, message: "FATAL: terminating connection", sqlState: "57P01", busy: false },
    notConnected: { kind: "notConnected" },
  };

  it("respondeu: o ponto do canvas, com a hora e o tempo na dica", () => {
    expect(checkView(states.ok)).toEqual({ tone: "ok", label: "Respondeu na última verificação", tip: `Respondeu às ${clockOf("2026-10-15T14:32:05Z")}, em 3 ms` });
  });

  it("não respondeu: no tom de erro, com a mensagem do banco e o SQLSTATE na dica", () => {
    expect(checkView(states.failed)).toEqual({ tone: "failed", label: "Não respondeu", tip: `Não respondeu às ${clockOf("2026-10-15T14:32:35Z")} (SQLSTATE 57P01):\nFATAL: terminating connection` });
  });

  it("ocupada: o indicador como estava, com “Ocupada: verificada na próxima” na dica", () => {
    expect(checkView({ ...states.ok, busy: true } as CheckState).tip).toBe(`${copy.tip.ok("2026-10-15T14:32:05Z", 3)}\nOcupada: verificada na próxima`);
    expect(checkView({ kind: "waiting", busy: true }).tip).toBe(`${copy.tip.waiting}\nOcupada: verificada na próxima`);
  });

  it("sem sessão aberta e ainda não verificada", () => {
    expect(checkView(states.notConnected)).toMatchObject({ tone: "notConnected", label: "Sem sessão aberta" });
    expect(checkView(states.waiting)).toMatchObject({ tone: "waiting", label: "Conectada, ainda não verificada" });
  });

  it("a hora é a do relógio da máquina, e o que não é uma data fica como veio", () => {
    expect(clockOf("2026-10-15T14:32:05Z")).toMatch(/^\d{2}:\d{2}:05$/);
    expect(clockOf("agora")).toBe("agora");
  });
});
