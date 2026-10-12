import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { vaultLock } from "@/lib/api/vault-lock";

// O guard com os ganchos simulados (o vitest deste projeto não tem DOM): o que interessa são os efeitos que ele registra e o que a limpeza de cada um faz.
const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], navigate: vi.fn() }));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => void | (() => void)) => void hooks.effects.push(effect),
}));
vi.mock("react-router", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-router")>()), useNavigate: () => hooks.navigate, Outlet: () => null }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: { unlocked: true, userName: "marina" }, isError: false, refetch: vi.fn() }),
}));

import { VaultGuard } from "./vault-guard";

beforeEach(() => {
  hooks.effects.length = 0;
  hooks.navigate.mockClear();
});
afterEach(() => vaultLock.reset());

/** Monta o guard (roda os efeitos) e devolve a função que o desmonta (roda as limpezas). */
function mountGuard() {
  VaultGuard();
  const cleanups = hooks.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");
  return () => cleanups.forEach((cleanup) => cleanup());
}

describe("VaultGuard: o bloqueio por inatividade acaba junto com o guard (RN-SEG-001)", () => {
  it("desmontar o guard (sair, a API reiniciar, o cofre fechar por outro motivo) desbloqueia a barreira e larga os pedidos que esperavam: o login seguinte não começa bloqueado", async () => {
    const unmount = mountGuard();
    vaultLock.lock();
    let released = false;
    void vaultLock.whenUnlocked().then(() => (released = true));

    unmount();

    expect(vaultLock.isLocked()).toBe(false);
    // O pedido que esperava é largado sem resposta: ninguém o lê (a tela que o fez já saiu).
    await Promise.resolve();
    expect(released).toBe(false);
  });

  it("montar o guard não mexe no bloqueio: só a limpeza o desfaz (um guard remontado por outro motivo, com o app bloqueado, não pode desbloquear)", () => {
    vaultLock.lock();

    mountGuard();

    expect(vaultLock.isLocked()).toBe(true);
  });
});
