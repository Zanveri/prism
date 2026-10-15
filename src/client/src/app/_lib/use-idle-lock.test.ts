import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O gancho com o React simulado (o vitest deste projeto não tem DOM): o efeito é capturado e rodado à mão, com relógio de mentira e alvos de
// evento de mentira. O que as regras dos eventos são (captura, `isTrusted`, `pointermove` parado) tem o teste em `idle-watch.test.ts`, e a conta do
// prazo em `idle-timer.test.ts`; aqui se confere a LIGAÇÃO: a conferência periódica, o aviso, o bloqueio uma vez só, a limpeza.
type Cleanup = () => void;

const hooks = vi.hoisted(() => ({
  seconds: null as number | null,
  setSeconds: vi.fn<(value: number | null) => void>(),
  effects: [] as { effect: () => void | (() => void); deps: readonly unknown[] }[],
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: () => [hooks.seconds, hooks.setSeconds],
  useEffectEvent: (callback: unknown) => callback,
  useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => void hooks.effects.push({ effect, deps }),
}));

import { useIdleLock } from "./use-idle-lock";

/** Um alvo de eventos de mentira: guarda os ouvintes e deixa a prova disparar um evento. */
function fakeTarget() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, listener: (event: unknown) => void) => void listeners.get(type)?.delete(listener)),
    fire: (type: string) => {
      for (const listener of listeners.get(type) ?? []) listener({ type, isTrusted: true });
    },
    listening: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

let fakeWindow: ReturnType<typeof fakeTarget>;
let fakeDocument: ReturnType<typeof fakeTarget>;

beforeEach(() => {
  vi.useFakeTimers();
  fakeWindow = fakeTarget();
  fakeDocument = fakeTarget();
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", fakeDocument);
  hooks.seconds = null;
  hooks.setSeconds.mockClear();
  hooks.effects.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** O componente de mentira que chama o gancho, como o React faria ao renderizar. */
function Harness(options: Parameters<typeof useIdleLock>[0]) {
  return useIdleLock(options);
}

/** Renderiza o gancho e roda o efeito que ele registrou, como o React faria ao montar. */
function mount(options: { enabled?: boolean; minutes?: number; isBusy?: () => boolean; peers?: Parameters<typeof useIdleLock>[0]["peers"] } = {}) {
  const onLock = vi.fn();
  const returned = Harness({ enabled: true, minutes: 1, isBusy: () => false, onLock, ...options });
  const registered = hooks.effects.at(-1);
  if (registered === undefined) throw new Error("o gancho não registrou nenhum efeito");

  return { returned, deps: registered.deps, cleanup: registered.effect() as Cleanup | undefined, onLock };
}

const warnedWith = () => hooks.setSeconds.mock.lastCall?.[0];

describe("useIdleLock: desligado", () => {
  it("nada conta: nenhum relógio, nenhum ouvinte, e nenhum aviso mesmo que o estado guardado tenha um", () => {
    hooks.seconds = 12;

    const { returned, cleanup } = mount({ enabled: false });

    expect(returned).toBeNull();
    expect(cleanup).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    expect(fakeWindow.listening() + fakeDocument.listening()).toBe(0);
  });
});

describe("useIdleLock: ligado", () => {
  it("o efeito vale enquanto ligar/desligar e os minutos valem: quem os muda refaz a contagem do zero", () => {
    expect(mount({ enabled: true, minutes: 3 }).deps).toEqual([true, 3]);
  });

  it("devolve o aviso que o estado guarda", () => {
    hooks.seconds = 17;

    expect(mount().returned).toBe(17);
  });

  it("confere a cada segundo; o aviso entra na metade final (1 minuto), com os segundos que faltam, e o bloqueio vem no prazo, uma vez só", () => {
    const { onLock } = mount({ minutes: 1 });

    vi.advanceTimersByTime(29_000);
    expect(hooks.setSeconds).toHaveBeenCalledTimes(29);
    expect(hooks.setSeconds.mock.calls.every(([value]) => value === null)).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(warnedWith()).toBe(30);
    vi.advanceTimersByTime(10_000);
    expect(warnedWith()).toBe(20);
    expect(onLock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(20_000);
    expect(onLock).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(onLock).toHaveBeenCalledOnce();
  });

  it("os minutos vêm do chamador: com 2 minutos o aviso espera o primeiro minuto", () => {
    const { onLock } = mount({ minutes: 2 });

    vi.advanceTimersByTime(59_000);
    expect(warnedWith()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(warnedWith()).toBe(60);
    vi.advanceTimersByTime(59_000);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onLock).toHaveBeenCalledOnce();
  });

  it("com comando em andamento o tempo não conta, e a conferência lê 'ocupado' a cada vez; terminado, a contagem recomeça do fim", () => {
    let busy = true;
    const { onLock } = mount({ isBusy: () => busy });

    vi.advanceTimersByTime(100_000);
    expect(onLock).not.toHaveBeenCalled();
    expect(warnedWith()).toBeNull();

    busy = false;
    vi.advanceTimersByTime(30_000);
    expect(warnedWith()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(warnedWith()).toBe(30);
  });

  it("mexer na janela recomeça a contagem: a janela é ouvida de verdade", () => {
    mount({ minutes: 1 });
    vi.advanceTimersByTime(25_000);

    fakeWindow.fire("keydown");

    vi.advanceTimersByTime(29_000);
    expect(warnedWith()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(warnedWith()).toBe(30);
  });

  it("a janela que volta a aparecer confere na hora: o documento é ouvido, e não se espera o próximo segundo", () => {
    mount({ minutes: 1 });
    hooks.setSeconds.mockClear();

    vi.setSystemTime(Date.now() + 31_000);
    fakeDocument.fire("visibilitychange");

    expect(warnedWith()).toBe(29);
  });

  it("soltar o efeito para tudo: o relógio, os ouvintes da janela e do documento, o aviso na tela; e nada mais bloqueia", () => {
    const { cleanup, onLock } = mount({ minutes: 1 });
    vi.advanceTimersByTime(40_000);

    cleanup?.();

    expect(warnedWith()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(fakeWindow.listening() + fakeDocument.listening()).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(onLock).not.toHaveBeenCalled();
  });
});

describe("useIdleLock: as outras janelas (RN-ABAS-004)", () => {
  function peers() {
    const listeners = new Set<() => void>();
    return {
      share: vi.fn(),
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      }),
      activity: () => listeners.forEach((listener) => listener()),
      listening: () => listeners.size,
    };
  }

  it("a atividade de outra janela recomeça a contagem desta: o aviso some, e o bloqueio fica para um prazo inteiro depois dela", () => {
    const other = peers();
    const { onLock } = mount({ minutes: 1, peers: other });

    vi.advanceTimersByTime(40_000);
    expect(warnedWith()).toBe(20);

    other.activity();
    expect(warnedWith()).toBeNull();
    vi.advanceTimersByTime(59_000);
    expect(onLock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onLock).toHaveBeenCalledOnce();
  });

  it("a atividade daqui vai às outras janelas no máximo uma vez por segundo", () => {
    const other = peers();
    mount({ peers: other });

    fakeWindow.fire("keydown");
    fakeWindow.fire("keydown");
    expect(other.share).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1000);
    fakeWindow.fire("pointerdown");
    expect(other.share).toHaveBeenCalledTimes(2);
  });

  it("o comando em andamento aqui segura as outras janelas: a cada conferência ele conta como atividade para elas", () => {
    const other = peers();
    let busy = true;
    mount({ isBusy: () => busy, peers: other });

    vi.advanceTimersByTime(5000);
    expect(other.share).toHaveBeenCalledTimes(5);

    busy = false;
    vi.advanceTimersByTime(5000);
    expect(other.share).toHaveBeenCalledTimes(5);
  });

  it("desligar solta o ouvinte das outras janelas", () => {
    const other = peers();
    const { cleanup } = mount({ peers: other });
    expect(other.listening()).toBe(1);

    cleanup?.();
    expect(other.listening()).toBe(0);
  });
});
