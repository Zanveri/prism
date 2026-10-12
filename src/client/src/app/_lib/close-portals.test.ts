import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeOpenPortals, openPortalsSelector } from "./close-portals";

type Sent = { type: string; key: string; bubbles: boolean };

/** Um elemento de mentira: o vitest deste projeto não tem DOM. Guarda o que lhe mandaram. */
function fakeElement(options: { lockScreen?: boolean; updateDialog?: boolean } = {}) {
  const sent: Sent[] = [];
  return {
    sent,
    hasAttribute: (name: string) => name === "data-lock-screen" && options.lockScreen === true,
    querySelector: (selector: string) => (selector === "[data-update-dialog]" && options.updateDialog === true ? {} : null),
    dispatchEvent: (event: unknown) => {
      sent.push(event as Sent);
      return true;
    },
  };
}

const rootWith = (elements: ReturnType<typeof fakeElement>[]) => ({ querySelectorAll: () => elements as unknown as NodeListOf<Element> });

beforeEach(() => {
  vi.stubGlobal(
    "KeyboardEvent",
    class {
      readonly type: string;
      readonly key: string;
      readonly bubbles: boolean;
      constructor(type: string, init: { key: string; bubbles: boolean }) {
        this.type = type;
        this.key = init.key;
        this.bubbles = init.bubbles;
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("closeOpenPortals: o que o bloqueio fecha por portal no body (RN-SEG-001)", () => {
  it("manda o Esc, que fecha cada um do jeito dele, a cada diálogo e menu aberto: o evento sobe (o React o ouve na raiz do portal)", () => {
    const dialog = fakeElement();
    const menu = fakeElement();

    closeOpenPortals(rootWith([dialog, menu]));

    for (const element of [dialog, menu]) expect(element.sent).toEqual([{ type: "keydown", key: "Escape", bubbles: true }]);
  });

  it("não manda nada à tela de bloqueio, que é o que está aberto agora", () => {
    const lock = fakeElement({ lockScreen: true });

    closeOpenPortals(rootWith([lock]));

    expect(lock.sent).toEqual([]);
  });

  it("nem ao diálogo de versão nova: ele não é do cofre, e o Esc seria a escolha 'Depois', que é da pessoa", () => {
    const update = fakeElement({ updateDialog: true });
    const dialog = fakeElement();

    closeOpenPortals(rootWith([update, dialog]));

    expect(update.sent).toEqual([]);
    expect(dialog.sent).toHaveLength(1);
  });

  it("sem nada aberto, não faz nada", () => {
    expect(() => closeOpenPortals(rootWith([]))).not.toThrow();
  });

  it("procura os quatro: diálogo, diálogo de pergunta, menu e a lista aberta de um Select (o combobox expandido)", () => {
    for (const selector of ['[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="combobox"][aria-expanded="true"]']) expect(openPortalsSelector).toContain(selector);
  });
});
