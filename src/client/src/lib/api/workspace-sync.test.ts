import { afterEach, describe, expect, it, vi } from "vitest";

import { workspaceSync } from "./workspace-sync";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const withBridge = (flush: () => Promise<void>) => vi.stubGlobal("window", { prism: { workspace: { flush } } });

describe("'grave as abas agora' antes de o cofre fechar (RN-ABAS-006)", () => {
  it("a área de trabalho montada conta as abas desta janela primeiro, e só então o processo principal grava as de todas", async () => {
    const order: string[] = [];
    withBridge(async () => void order.push("flush"));
    const unregister = workspaceSync.register(() => void order.push("report"));

    await workspaceSync.flush();
    unregister();
    await workspaceSync.flush();

    expect(order).toEqual(["report", "flush", "flush"]);
  });

  it("a gravação que não volta não segura o bloqueio nem o 'Sair': passa o prazo, e segue", async () => {
    vi.useFakeTimers();
    withBridge(() => new Promise(() => {}));

    const flushed = workspaceSync.flush(5000);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(flushed).resolves.toBeUndefined();
  });

  it("a gravação que falha, o relato que lança e a ponte que não existe não lançam", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    withBridge(async () => {
      throw new Error("cofre fechado");
    });
    const unregister = workspaceSync.register(() => {
      throw new Error("editor sumiu");
    });

    await expect(workspaceSync.flush()).resolves.toBeUndefined();
    unregister();
    vi.stubGlobal("window", {});
    await expect(workspaceSync.flush(10)).resolves.toBeUndefined();
  });
});
