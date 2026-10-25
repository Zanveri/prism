import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O gancho com os ganchos do React simulados (`createHookRuntime`): o que se confere AQUI é a ligação do tempo e do evento (RN-ARVORE-009): a tecla que não é
// de ir ao item volta `null` sem tocar nos nomes nem no evento, a que é fica com o texto por 1 segundo, e o indicador some com ele. As decisões sobre o
// texto são de `type-ahead.test.ts`.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import type { KeyboardEvent } from "react";

import { useTypeAhead } from "./use-type-ahead";

const labels = ["alfa", "beta", "Bravo", "gama"];
const event = (key: string, over: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean; isComposing: boolean }> = {}) =>
  ({ key, ctrlKey: false, altKey: false, metaKey: false, ...over, nativeEvent: { isComposing: over.isComposing ?? false }, preventDefault: vi.fn() }) as unknown as KeyboardEvent<HTMLElement> & { preventDefault: ReturnType<typeof vi.fn> };
const hook = () => rt.render(() => useTypeAhead());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(50_000);
});

afterEach(() => {
  rt.unmount();
  vi.useRealTimers();
});

describe("useTypeAhead (RN-ARVORE-009)", () => {
  it("a tecla que não é de ir ao item volta `null`: não lê os nomes, não toma o evento e não mostra nada", () => {
    const names = vi.fn(() => labels);

    for (const press of [event("ArrowDown"), event("Enter"), event("F2"), event("f", { ctrlKey: true }), event("f", { altKey: true }), event("f", { metaKey: true }), event("a", { isComposing: true }), event(" ")]) {
      expect(hook().press(press, names, 0)).toBeNull();
      expect(press.preventDefault).not.toHaveBeenCalled();
    }

    expect(names).not.toHaveBeenCalled();
    expect(hook().shown).toBeNull();
  });

  it("a letra toma o evento, lê os nomes uma vez e devolve o item; o indicador mostra o texto", () => {
    const names = vi.fn(() => labels);
    const typed = event("g");

    expect(hook().press(typed, names, 0)).toEqual({ target: 3 });
    expect(typed.preventDefault).toHaveBeenCalledTimes(1);
    expect(names).toHaveBeenCalledTimes(1);
    expect(hook().shown).toEqual({ text: "g", found: true });
  });

  it("as letras seguidas se juntam, e a sem item mostra que não há, sem perder o texto", () => {
    expect(hook().press(event("b"), () => labels, 0)).toEqual({ target: 1 });
    vi.advanceTimersByTime(400);
    expect(hook().press(event("r"), () => labels, 1)).toEqual({ target: 2 });
    vi.advanceTimersByTime(400);
    expect(hook().press(event("x"), () => labels, 2)).toEqual({ target: null });
    expect(hook().shown).toEqual({ text: "brx", found: false });
  });

  it("o Espaço entra no texto só enquanto ele dura", () => {
    hook().press(event("b"), () => labels, 0);
    const inside = event(" ");

    expect(hook().press(inside, () => labels, 1)).toEqual({ target: null });
    expect(inside.preventDefault).toHaveBeenCalled();
    expect(hook().shown).toEqual({ text: "b ", found: false });

    vi.advanceTimersByTime(1000);
    const alone = event(" ");
    expect(hook().press(alone, () => labels, 1)).toBeNull();
    expect(alone.preventDefault).not.toHaveBeenCalled();
  });

  it("1 segundo sem tecla apaga o indicador e o texto: a mesma letra de novo é a primeira de uma procura nova", () => {
    hook().press(event("b"), () => labels, 0);
    vi.advanceTimersByTime(999);
    expect(hook().shown).not.toBeNull();

    vi.advanceTimersByTime(1);
    expect(hook().shown).toBeNull();
    expect(hook().press(event("b"), () => labels, 1)).toEqual({ target: 2 });
  });

  it("cada tecla renova o prazo do indicador", () => {
    hook().press(event("b"), () => labels, 0);
    vi.advanceTimersByTime(800);
    hook().press(event("r"), () => labels, 1);
    vi.advanceTimersByTime(800);

    expect(hook().shown).toEqual({ text: "br", found: true });
    vi.advanceTimersByTime(200);
    expect(hook().shown).toBeNull();
  });

  it("desmontar a árvore cancela o prazo pendente", () => {
    hook().press(event("b"), () => labels, 0);
    expect(vi.getTimerCount()).toBe(1);

    rt.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
