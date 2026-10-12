import { describe, expect, it, vi } from "vitest";

import { watchActivity } from "./idle-watch";

type Listener = (event: unknown) => void;

/** Um alvo de eventos de mentira (o vitest deste projeto não tem DOM): guarda quem ouve e com que opções, e deixa o teste disparar. */
function fakeTarget() {
  const added: { type: string; listener: Listener; options: unknown }[] = [];
  const removed: { type: string; listener: Listener; options: unknown }[] = [];
  const target = {
    addEventListener: (type: string, listener: Listener, options?: unknown) => void added.push({ type, listener, options }),
    removeEventListener: (type: string, listener: Listener, options?: unknown) => void removed.push({ type, listener, options }),
  };
  const active = () => added.filter((entry) => !removed.some((gone) => gone.type === entry.type && gone.listener === entry.listener));
  const emit = (type: string, event: object = {}) => {
    for (const entry of active().filter((candidate) => candidate.type === type)) entry.listener({ type, isTrusted: true, ...event });
  };
  return { target: target as unknown as EventTarget, added, removed, active, emit };
}

function watch(activity: () => boolean = () => true) {
  const window = fakeTarget();
  const document = fakeTarget();
  const timer = { activity: vi.fn(activity) };
  const check = vi.fn();
  const stop = watchActivity({ window: window.target, document: document.target, timer, check });
  return { window, document, timer, check, stop };
}

describe("watchActivity: os eventos que contam como 'mexer' (RN-SEG-001)", () => {
  it("ouve teclado, ponteiro e roda na janela, na captura e sem poder cancelar (um diálogo que para a propagação não esconde a digitação), e a janela reaparecer no documento", () => {
    const { window, document } = watch();

    expect(window.added.map((entry) => entry.type).sort()).toEqual(["keydown", "pointerdown", "pointermove", "wheel"]);
    for (const entry of window.added) expect(entry.options).toEqual({ capture: true, passive: true });
    expect(document.added.map((entry) => entry.type)).toEqual(["visibilitychange"]);
  });

  it("parar solta tudo, com a mesma captura (senão o navegador não solta): nada fica ouvindo", () => {
    const { window, document, stop } = watch();

    stop();

    expect(window.active()).toEqual([]);
    expect(document.active()).toEqual([]);
    for (const entry of window.removed) expect(entry.options).toEqual({ capture: true });
  });

  it("o toque da pessoa reinicia a contagem", () => {
    const { window, timer, check } = watch();

    window.emit("keydown");

    expect(timer.activity).toHaveBeenCalledOnce();
    expect(check).not.toHaveBeenCalled();
  });

  it("só o que a pessoa faz conta: o evento que um programa dispara (isTrusted falso) não reinicia a contagem", () => {
    const { window, timer, check } = watch();

    for (const type of ["keydown", "pointerdown", "pointermove", "wheel"]) window.emit(type, { isTrusted: false, screenX: 1, screenY: 1 });

    expect(timer.activity).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });

  it("o `pointermove` sem o ponteiro sair do lugar não conta (o navegador o repete quando o que está sob ele muda), e o que se mexeu conta", () => {
    const { window, timer } = watch();

    window.emit("pointermove", { screenX: 10, screenY: 20 });
    expect(timer.activity).toHaveBeenCalledTimes(1);

    window.emit("pointermove", { screenX: 10, screenY: 20 });
    window.emit("pointermove", { screenX: 10, screenY: 20 });
    expect(timer.activity).toHaveBeenCalledTimes(1);

    window.emit("pointermove", { screenX: 11, screenY: 20 });
    expect(timer.activity).toHaveBeenCalledTimes(2);
    window.emit("pointermove", { screenX: 11, screenY: 21 });
    expect(timer.activity).toHaveBeenCalledTimes(3);
  });

  it("o filtro é só do pointermove: a mesma tecla, ou o clique no mesmo lugar, contam todas as vezes", () => {
    const { window, timer } = watch();

    window.emit("keydown", { screenX: 5, screenY: 5 });
    window.emit("keydown", { screenX: 5, screenY: 5 });
    window.emit("pointerdown", { screenX: 5, screenY: 5 });
    window.emit("pointerdown", { screenX: 5, screenY: 5 });
    window.emit("wheel", { screenX: 5, screenY: 5 });

    expect(timer.activity).toHaveBeenCalledTimes(5);
  });

  it("o toque que acorda a janela depois de o tempo ter acabado (a contagem não reiniciou) confere na hora, para bloquear", () => {
    const { window, check } = watch(() => false);

    window.emit("keydown");

    expect(check).toHaveBeenCalledOnce();
  });

  it("a janela voltar a aparecer confere na hora: os temporizadores de uma janela escondida atrasam", () => {
    const { document, check } = watch();

    document.emit("visibilitychange");

    expect(check).toHaveBeenCalledOnce();
  });
});
