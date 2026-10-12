import { describe, expect, it, vi } from "vitest";

import { createVaultLock } from "./vault-lock";

/** Diz se a promessa já respondeu, sem esperar por ela. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  return (await Promise.race([promise.then(() => true), Promise.resolve().then(() => false)])) as boolean;
}

describe("o estado de bloqueio (RN-SEG-001)", () => {
  it("começa aberto; bloquear e desbloquear avisam quem assina, uma vez por mudança", () => {
    const lock = createVaultLock();
    const listener = vi.fn();
    lock.subscribe(listener);

    expect(lock.isLocked()).toBe(false);

    lock.lock();
    lock.lock();
    expect(lock.isLocked()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    lock.unlock();
    lock.unlock();
    expect(lock.isLocked()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("conta os bloqueios: a época sobe a cada bloqueio, e só nele (desbloquear, reset e bloquear de novo estando bloqueado não mexem)", () => {
    const lock = createVaultLock();
    expect(lock.epoch()).toBe(0);

    lock.lock();
    expect(lock.epoch()).toBe(1);
    lock.lock();
    expect(lock.epoch()).toBe(1);

    lock.unlock();
    expect(lock.epoch()).toBe(1);

    lock.lock();
    expect(lock.epoch()).toBe(2);
    lock.reset();
    expect(lock.epoch()).toBe(2);
  });

  it("quem deixa de assinar não é mais avisado", () => {
    const lock = createVaultLock();
    const listener = vi.fn();

    lock.subscribe(listener)();
    lock.lock();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("a barreira dos pedidos à API", () => {
  it("aberto, whenUnlocked responde na hora", async () => {
    const lock = createVaultLock();

    expect(await lock.whenUnlocked()).toBe(true);
  });

  it("bloqueado, o pedido espera; ao desbloquear todos os que esperam seguem, e os que chegam depois não esperam", async () => {
    const lock = createVaultLock();
    lock.lock();

    const first = lock.whenUnlocked();
    const second = lock.whenUnlocked();
    expect(await settled(first)).toBe(false);
    expect(await settled(second)).toBe(false);

    lock.unlock();

    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await lock.whenUnlocked()).toBe(true);
  });

  it("o pedido cancelado enquanto espera sai com false e não segura mais nada", async () => {
    const lock = createVaultLock();
    lock.lock();
    const controller = new AbortController();

    const waiting = lock.whenUnlocked(controller.signal);
    controller.abort();

    expect(await waiting).toBe(false);
    // Já cancelado antes de chegar: nem espera.
    expect(await lock.whenUnlocked(controller.signal)).toBe(false);
  });

  it("reset (sair, ou o cofre sumir por outro motivo) desbloqueia e larga os pedidos que esperavam sem respondê-los: ninguém os lê mais", async () => {
    const lock = createVaultLock();
    const listener = vi.fn();
    lock.subscribe(listener);
    lock.lock();
    const waiting = lock.whenUnlocked();

    lock.reset();

    expect(lock.isLocked()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(await settled(waiting)).toBe(false);
    // Um novo bloqueio não os acorda.
    lock.lock();
    lock.unlock();
    expect(await settled(waiting)).toBe(false);
  });

  it("reset sem bloqueio não avisa ninguém", () => {
    const lock = createVaultLock();
    const listener = vi.fn();
    lock.subscribe(listener);

    lock.reset();

    expect(listener).not.toHaveBeenCalled();
  });
});
