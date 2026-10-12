import type { FocusEvent, KeyboardEvent, SyntheticEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { blockOutsideKeys, lockDialogHandlers } from "./lock-dialog";

const dialogOf = (open: boolean) => ({ open, showModal: vi.fn() });

describe("lockDialogHandlers: o diálogo da tela de bloqueio não se deixa fechar nem levar o foco (RN-SEG-001)", () => {
  it("o cancelamento do diálogo (o Esc de um diálogo modal) não fecha", () => {
    const event = { preventDefault: vi.fn() };

    lockDialogHandlers().onCancel(event as unknown as SyntheticEvent<HTMLDialogElement>);

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("o teclado não passa do diálogo (nenhum atalho da janela age), e o Esc também não faz o que faria por padrão", () => {
    const handlers = lockDialogHandlers();
    const escape = { key: "Escape", stopPropagation: vi.fn(), preventDefault: vi.fn() };
    const letter = { key: "a", stopPropagation: vi.fn(), preventDefault: vi.fn() };

    handlers.onKeyDown(escape as unknown as KeyboardEvent<HTMLDialogElement>);
    handlers.onKeyDown(letter as unknown as KeyboardEvent<HTMLDialogElement>);

    expect(escape.stopPropagation).toHaveBeenCalledOnce();
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(letter.stopPropagation).toHaveBeenCalledOnce();
    // A tecla comum segue o caminho dela: é a senha sendo digitada.
    expect(letter.preventDefault).not.toHaveBeenCalled();
  });

  it("se o navegador o fechou por fora (o Esc duas vezes, que ele não deixa cancelar sempre), abre de novo; aberto, não mexe", () => {
    const closed = dialogOf(false);
    const open = dialogOf(true);

    lockDialogHandlers().onClose({ currentTarget: closed } as unknown as SyntheticEvent<HTMLDialogElement>);
    lockDialogHandlers().onClose({ currentTarget: open } as unknown as SyntheticEvent<HTMLDialogElement>);

    expect(closed.showModal).toHaveBeenCalledOnce();
    expect(open.showModal).not.toHaveBeenCalled();
  });

  it("o foco que cai no próprio diálogo (um clique numa área em branco) volta ao campo de senha; o que cai num campo dentro dele fica", () => {
    const password = { focus: vi.fn() };
    const dialog = { querySelector: vi.fn((selector: string) => (selector === '[name="password"]' ? password : null)) };
    const handlers = lockDialogHandlers();

    handlers.onFocus({ target: dialog, currentTarget: dialog } as unknown as FocusEvent<HTMLDialogElement>);
    expect(password.focus).toHaveBeenCalledOnce();

    handlers.onFocus({ target: password, currentTarget: dialog } as unknown as FocusEvent<HTMLDialogElement>);
    expect(password.focus).toHaveBeenCalledOnce();
  });
});

type Listener = (event: unknown) => void;

function fakeWindow() {
  const added: { type: string; listener: Listener; options: unknown }[] = [];
  const removed: { type: string; listener: Listener; options: unknown }[] = [];
  const target = {
    addEventListener: (type: string, listener: Listener, options?: unknown) => void added.push({ type, listener, options }),
    removeEventListener: (type: string, listener: Listener, options?: unknown) => void removed.push({ type, listener, options }),
  };
  return { target: target as unknown as EventTarget, added, removed };
}

describe("blockOutsideKeys: o teclado que vem de fora do diálogo (o foco no body) não chega aos atalhos da janela", () => {
  const inside = {};
  const outside = {};
  const isInside = (target: EventTarget | null) => target === (inside as unknown);

  function keyEvent(target: object, key: string) {
    return { target, key, stopImmediatePropagation: vi.fn(), preventDefault: vi.fn() };
  }

  it("ouve o teclado na janela, na captura (antes de qualquer atalho)", () => {
    const window = fakeWindow();

    blockOutsideKeys(window.target, isInside);

    expect(window.added).toHaveLength(1);
    expect(window.added[0]).toMatchObject({ type: "keydown", options: true });
  });

  it("o que vem de fora é parado antes de chegar a qualquer ouvinte (Ctrl+, abriria as Configurações por baixo)", () => {
    const window = fakeWindow();
    blockOutsideKeys(window.target, isInside);
    const event = keyEvent(outside, ",");

    window.added[0].listener(event);

    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("o Esc que vem de fora também não faz o que faria por padrão (o foco no body não pode fechar o diálogo); a outra tecla segue", () => {
    const window = fakeWindow();
    blockOutsideKeys(window.target, isInside);
    const escape = keyEvent(outside, "Escape");
    const letter = keyEvent(outside, "a");

    window.added[0].listener(escape);
    window.added[0].listener(letter);

    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(letter.preventDefault).not.toHaveBeenCalled();
  });

  it("o que vem de dentro passa: é a senha sendo digitada (o diálogo cuida do resto no próprio onKeyDown)", () => {
    const window = fakeWindow();
    blockOutsideKeys(window.target, isInside);
    const event = keyEvent(inside, "Escape");

    window.added[0].listener(event);

    expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("soltar tira o ouvinte, com a mesma captura", () => {
    const window = fakeWindow();

    blockOutsideKeys(window.target, isInside)();

    expect(window.removed).toHaveLength(1);
    expect(window.removed[0]).toMatchObject({ type: "keydown", options: true, listener: window.added[0].listener });
  });
});
