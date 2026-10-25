import { describe, expect, it, vi } from "vitest";

import { blockHistoryButtons } from "./history-buttons";

function fakeWindow() {
  const listeners: { type: string; listener: (event: unknown) => void; capture: unknown }[] = [];
  return {
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void, capture?: unknown) => void listeners.push({ type, listener, capture })),
    removeEventListener: vi.fn((type: string, listener: (event: unknown) => void) => {
      const at = listeners.findIndex((held) => held.type === type && held.listener === listener);
      if (at >= 0) listeners.splice(at, 1);
    }),
    fire(type: string, button: number) {
      const event = { type, button, preventDefault: vi.fn() };
      for (const held of listeners.filter((entry) => entry.type === type)) held.listener(event);
      return event;
    },
    listening: () => listeners.length,
    captures: () => listeners.every((held) => held.capture === true),
  };
}

describe("os botões do mouse nunca navegam o Chromium (RN-ABAS-018)", () => {
  it.each(["mousedown", "mouseup", "auxclick"])("o %s dos botões 'voltar' e 'avançar' é seguro", (type) => {
    const target = fakeWindow();
    blockHistoryButtons(target as unknown as Window);

    expect(target.fire(type, 3).preventDefault).toHaveBeenCalledOnce();
    expect(target.fire(type, 4).preventDefault).toHaveBeenCalledOnce();
  });

  it.each([0, 1, 2, 5])("o botão %s não é tocado", (button) => {
    const target = fakeWindow();
    blockHistoryButtons(target as unknown as Window);

    for (const type of ["mousedown", "mouseup", "auxclick"]) expect(target.fire(type, button).preventDefault).not.toHaveBeenCalled();
  });

  it("os ouvintes são da fase de captura, e soltá-los os tira", () => {
    const target = fakeWindow();
    const release = blockHistoryButtons(target as unknown as Window);
    expect(target.listening()).toBe(3);
    expect(target.captures()).toBe(true);

    release();
    expect(target.listening()).toBe(0);
  });
});
