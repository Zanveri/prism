import { describe, expect, test } from "vitest";

import { EvaluatorHost, type Timers, type WorkerLike } from "./evaluator-host";
import { handleEvaluateRequest } from "./evaluator-service";
import { plain } from "./cases-runner";
import type { EvaluateMessage, EvaluateRequest } from "./wire";
import { phrase } from "./variables.copy";

/** Um Worker de mentira: guarda o que recebe e deixa o teste entregar as mensagens. */
class FakeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  requests: EvaluateRequest[] = [];
  terminated = false;
  /** Se está ligado ao serviço de verdade, ele responde a cada pedido sozinho. */
  constructor(private readonly service = false) {}
  postMessage(message: EvaluateRequest): void {
    // O que atravessa o Worker é dado: a cópia estruturada tem de funcionar.
    this.requests.push(structuredClone(message));
    if (this.service) queueMicrotask(() => handleEvaluateRequest(structuredClone(message), (reply) => this.deliver(reply)));
  }
  terminate(): void {
    this.terminated = true;
  }
  deliver(message: EvaluateMessage): void {
    this.onmessage?.({ data: structuredClone(message) });
  }
}

/** Os temporizadores de mentira: o tempo só anda quando o teste manda. */
function fakeTimers() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const timers: Timers = {
    set: (callback, milliseconds) => {
      const handle = nextHandle++;
      pending.set(handle, { at: now + milliseconds, callback });
      return handle;
    },
    clear: (handle) => void pending.delete(handle as number),
  };
  const advance = (milliseconds: number) => {
    const target = now + milliseconds;
    for (;;) {
      const due = [...pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (due === undefined) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].callback();
    }
    now = target;
  };
  return { timers, advance, pendingCount: () => pending.size };
}

const request = (extra: Partial<Omit<EvaluateRequest, "id" | "kind">> = {}): Omit<EvaluateRequest, "id" | "kind"> => ({
  source: "const a = 1 + 2\nconst b = a * 2",
  engine: null,
  blankLines: true,
  indices: [0, 1],
  tab: [],
  counter: 0,
  seed: [1, 2, 3, 4],
  now: new Date("2026-10-20T10:30:00").getTime(),
  ...extra,
});

describe("EvaluatorHost", () => {
  test("avalia pelo serviço de verdade e devolve os itens e a aba", async () => {
    const clock = fakeTimers();
    const host = new EvaluatorHost({ createWorker: () => new FakeWorker(true), timers: clock.timers });
    const outcome = await host.evaluate(request());

    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.items.map((item) => item.index)).toEqual([0, 1]);
    expect(outcome.items.map((item) => (item.result.ok ? plain(item.result.stored.value) : null))).toEqual([3, 6]);
    expect(outcome.counter).toBe(2);
    expect(outcome.tab.map((entry) => entry.name).sort()).toEqual(["a", "b"]);
    // Os temporizadores acabam com o pedido.
    expect(clock.pendingCount()).toBe(0);
    expect(host.open).toBe(true);
  });

  test("o erro de um item na execução volta como dado e para o resto", async () => {
    const host = new EvaluatorHost({ createWorker: () => new FakeWorker(true), timers: fakeTimers().timers });
    const outcome = await host.evaluate(request({ source: "const a = 1\nconst b = [1, 2][random.int(5, 6)]\nconst c = 3", indices: [0, 1, 2] }));
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.items.map((item) => item.result.ok)).toEqual([true, false]);
    expect(outcome.items[1]?.result).toMatchObject({ ok: false, error: { line: 2, itemIndex: 1 } });
  });

  test("o erro que a conferência acha vem sozinho, sem avaliar nada", async () => {
    const host = new EvaluatorHost({ createWorker: () => new FakeWorker(true), timers: fakeTimers().timers });
    const outcome = await host.evaluate(request({ source: "const a = 1\nconst b = a.x\nconst c = 3", indices: [0, 1, 2] }));
    expect(outcome.kind).toBe("done");
    if (outcome.kind !== "done") return;
    expect(outcome.items.map((item) => item.result.ok)).toEqual([false]);
  });

  test("passou de 250 ms numa declaração: termina o Worker, diz qual item, e o próximo pedido abre outro", async () => {
    const clock = fakeTimers();
    const workers: FakeWorker[] = [];
    const host = new EvaluatorHost({ createWorker: () => workers[workers.push(new FakeWorker()) - 1] as FakeWorker, timers: clock.timers });

    const pending = host.evaluate(request());
    const worker = workers[0] as FakeWorker;
    const id = worker.requests[0]?.id as number;
    worker.deliver({ id, kind: "start", index: 0, name: "a" });
    clock.advance(249);
    expect(worker.terminated).toBe(false);
    clock.advance(1);

    const outcome = await pending;
    expect(worker.terminated).toBe(true);
    expect(outcome).toMatchObject({ kind: "timeout", index: 0, message: phrase.tooSlow("a"), items: [] });
    expect(host.open).toBe(false);
    expect(clock.pendingCount()).toBe(0);

    void host.evaluate(request());
    expect(workers).toHaveLength(2);
    expect(workers[1]?.terminated).toBe(false);
  });

  test("o relógio do item recomeça a cada item: 249 ms em cada um não para nada", async () => {
    const clock = fakeTimers();
    const worker = new FakeWorker();
    const host = new EvaluatorHost({ createWorker: () => worker, timers: clock.timers });
    const pending = host.evaluate(request());
    const id = worker.requests[0]?.id as number;

    for (const [index, name] of [[0, "a"], [1, "b"]] as const) {
      worker.deliver({ id, kind: "start", index, name });
      clock.advance(249);
      worker.deliver({ id, kind: "item", index, result: { ok: false, error: { message: "m", offset: 0, line: 1, column: 1, itemIndex: index } } });
    }
    worker.deliver({ id, kind: "done", counter: 2, tab: [] });
    const outcome = await pending;
    expect(outcome.kind).toBe("done");
    expect(worker.terminated).toBe(false);
  });

  test("passou de 5 s na execução, mesmo com cada item abaixo de 250 ms: termina o Worker", async () => {
    const clock = fakeTimers();
    const worker = new FakeWorker();
    const host = new EvaluatorHost({ createWorker: () => worker, timers: clock.timers });
    const pending = host.evaluate(request());
    const id = worker.requests[0]?.id as number;

    for (let index = 0; index < 25; index++) {
      worker.deliver({ id, kind: "start", index, name: `v${index}` });
      clock.advance(199);
      worker.deliver({ id, kind: "item", index, result: { ok: false, error: { message: "m", offset: 0, line: 1, column: 1, itemIndex: index } } });
    }
    expect(worker.terminated).toBe(false);
    worker.deliver({ id, kind: "start", index: 25, name: "v25" });
    clock.advance(200);

    const outcome = await pending;
    expect(worker.terminated).toBe(true);
    expect(outcome).toMatchObject({ kind: "timeout", message: phrase.runTooSlow(), index: 25 });
    expect(outcome.items).toHaveLength(25);
  });

  test("mensagem de outro pedido é ignorada, e um pedido por vez", async () => {
    const worker = new FakeWorker();
    const host = new EvaluatorHost({ createWorker: () => worker, timers: fakeTimers().timers });
    const pending = host.evaluate(request());
    const id = worker.requests[0]?.id as number;

    worker.deliver({ id: id + 99, kind: "done", counter: 7, tab: [] });
    await expect(host.evaluate(request())).rejects.toThrow();
    worker.deliver({ id, kind: "done", counter: 1, tab: [] });
    expect(await pending).toMatchObject({ kind: "done", counter: 1 });
  });

  test("lixo no lugar da mensagem não derruba nada", async () => {
    const worker = new FakeWorker();
    const host = new EvaluatorHost({ createWorker: () => worker, timers: fakeTimers().timers });
    const pending = host.evaluate(request());
    const id = worker.requests[0]?.id as number;
    for (const garbage of [null, 7, "x", undefined]) worker.onmessage?.({ data: garbage });
    worker.deliver({ id, kind: "done", counter: 0, tab: [] });
    expect((await pending).kind).toBe("done");
  });

  test("o erro do Worker é uma falha com a frase do erro interno, e o Worker é terminado", async () => {
    const worker = new FakeWorker();
    const host = new EvaluatorHost({ createWorker: () => worker, timers: fakeTimers().timers });
    const pending = host.evaluate(request());
    worker.onerror?.({ message: "SEGREDO" });
    const outcome = await pending;
    expect(outcome).toMatchObject({ kind: "failed", message: phrase.internal("o script") });
    expect(JSON.stringify(outcome)).not.toContain("SEGREDO");
    expect(worker.terminated).toBe(true);
    expect(host.open).toBe(false);
  });

  test("dispose termina o Worker e encerra o pedido em andamento", async () => {
    const worker = new FakeWorker();
    const clock = fakeTimers();
    const host = new EvaluatorHost({ createWorker: () => worker, timers: clock.timers });
    const pending = host.evaluate(request());
    host.dispose();
    expect((await pending).kind).toBe("failed");
    expect(worker.terminated).toBe(true);
    host.dispose();
  });

  test("os tempos são os da especificação: 250 ms e 5 s", () => {
    const calls: number[] = [];
    const worker = new FakeWorker();
    const host = new EvaluatorHost({ createWorker: () => worker, timers: { set: (_callback, milliseconds) => (calls.push(milliseconds), calls.length), clear: () => undefined } });
    void host.evaluate(request());
    worker.deliver({ id: worker.requests[0]?.id as number, kind: "start", index: 0, name: "a" });
    expect(calls).toEqual([5000, 250]);
  });
});
