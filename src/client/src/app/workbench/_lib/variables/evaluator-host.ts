import { limits, phrase } from "./variables.copy";
import { storedFromWire, type EvaluateMessage, type EvaluateRequest, type WireDiagnostic, type WireStored } from "./wire";
import type { StoredValue } from "./run";

/*
 * O hospedeiro do Worker (RN-VAR-013 e 014): a avaliação roda num Worker dedicado, e a tela o termina (`terminate()`) quando uma declaração passa de 250 ms ou a
 * execução passa de 5 s, também no meio de uma chamada nativa que não volta; o próximo pedido abre outro Worker. O núcleo avalia sozinho os 250 ms e os passos (a segunda
 * defesa); esta é a parada dura. O hospedeiro só fala com o Worker por dados, e quem cria o Worker e os temporizadores vem de fora (os testes passam os deles).
 */

/** O que o hospedeiro precisa de um Worker (o `Worker` do navegador tem isto). */
export interface WorkerLike {
  postMessage(message: EvaluateRequest): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type Timers = { set: (callback: () => void, milliseconds: number) => unknown; clear: (handle: unknown) => void };

const browserTimers: Timers = { set: (callback, milliseconds) => setTimeout(callback, milliseconds), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

/** O resultado de um pedido: cada item avaliado até onde foi, e como acabou. */
export type EvaluateOutcome =
  | { kind: "done"; items: ItemOutcome[]; counter: number; tab: StoredValue[] }
  | { kind: "timeout"; items: ItemOutcome[]; error: WireDiagnostic | null; message: string; index: number | null }
  | { kind: "failed"; items: ItemOutcome[]; message: string };

export type ItemOutcome = { index: number; result: { ok: true; stored: StoredValue; steps: number } | { ok: false; error: WireDiagnostic } };

export type HostOptions = { createWorker: () => WorkerLike; timers?: Timers; perItemMilliseconds?: number; perRunMilliseconds?: number };

export class EvaluatorHost {
  private readonly createWorker: () => WorkerLike;
  private readonly timers: Timers;
  private readonly perItem: number;
  private readonly perRun: number;
  private worker: WorkerLike | null = null;
  private nextId = 1;
  private settle: ((outcome: EvaluateOutcome) => void) | null = null;

  constructor({ createWorker, timers = browserTimers, perItemMilliseconds = limits.millisecondsPerDeclaration, perRunMilliseconds = limits.millisecondsPerRun }: HostOptions) {
    this.createWorker = createWorker;
    this.timers = timers;
    this.perItem = perItemMilliseconds;
    this.perRun = perRunMilliseconds;
  }

  /** Se há um Worker aberto (depois de terminado, o próximo pedido abre outro). */
  get open(): boolean {
    return this.worker !== null;
  }

  /** Avalia os itens pedidos; resolve quando o Worker acaba, falha ou é terminado por passar do tempo. Um pedido por vez. */
  evaluate(request: Omit<EvaluateRequest, "id" | "kind">): Promise<EvaluateOutcome> {
    if (this.settle !== null) return Promise.reject(new Error("Já há uma avaliação em andamento."));

    const worker = (this.worker ??= this.createWorker());
    const id = this.nextId++;
    const items: ItemOutcome[] = [];
    const names = new Map<number, string>();

    return new Promise<EvaluateOutcome>((resolve) => {
      let itemTimer: unknown = null;
      let currentIndex: number | null = null;

      const finish = (outcome: EvaluateOutcome) => {
        this.timers.clear(runTimer);
        if (itemTimer !== null) this.timers.clear(itemTimer);
        this.settle = null;
        resolve(outcome);
      };

      const stop = (message: string, index: number | null) => {
        // A parada dura: o Worker é terminado, e o próximo pedido abre outro.
        worker.onmessage = null;
        worker.onerror = null;
        worker.terminate();
        this.worker = null;
        finish({ kind: "timeout", items, error: null, message, index });
      };

      const runTimer = this.timers.set(() => stop(phrase.runTooSlow(), currentIndex), this.perRun);
      this.settle = finish;

      worker.onerror = () => {
        worker.terminate();
        this.worker = null;
        finish({ kind: "failed", items, message: phrase.internal("o script") });
      };

      worker.onmessage = (event) => {
        const message = event.data as EvaluateMessage;
        if (typeof message !== "object" || message === null || message.id !== id) return;

        if (message.kind === "start") {
          currentIndex = message.index;
          names.set(message.index, message.name);
          if (itemTimer !== null) this.timers.clear(itemTimer);
          itemTimer = this.timers.set(() => stop(phrase.tooSlow(names.get(message.index) ?? ""), message.index), this.perItem);
        } else if (message.kind === "item") {
          if (itemTimer !== null) this.timers.clear(itemTimer);
          itemTimer = null;
          currentIndex = null;
          items.push({ index: message.index, result: message.result.ok ? { ok: true, stored: storedFromWire(message.result.stored), steps: message.result.steps } : message.result });
        } else if (message.kind === "done") finish({ kind: "done", items, counter: message.counter, tab: message.tab.map((entry: WireStored) => storedFromWire(entry)) });
        else if (message.kind === "failed") finish({ kind: "failed", items, message: message.message });
      };

      worker.postMessage({ ...request, id, kind: "evaluate" });
    });
  }

  /** Termina o Worker aberto (ao fechar a aba, ao bloquear). Um pedido em andamento acaba como falha. */
  dispose(): void {
    const worker = this.worker;
    this.worker = null;
    if (worker !== null) {
      worker.onmessage = null;
      worker.terminate();
    }
    this.settle?.({ kind: "failed", items: [], message: phrase.internal("o script") });
  }
}

/** O Worker de verdade, do pacote da tela (o Vite o empacota). Só o navegador chama. */
export function createBrowserWorker(): WorkerLike {
  return new Worker(new URL("./evaluator.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}
