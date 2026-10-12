import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { vaultLock } from "@/lib/api/vault-lock";

import type { ToastApi } from "./toast-api";

// O `ToastProvider` com os ganchos simulados (o vitest deste projeto não tem DOM): o que interessa é a ligação dos avisos com o bloqueio por inatividade
// (RN-SEG-001). `createToastApi` tem o teste dele com um `isBlocked` de mentira; aqui o que se confere é que o provedor o liga ao bloqueio de verdade.
const mocks = vi.hoisted(() => ({ setQueue: vi.fn() }));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: (initial: unknown) => [initial, mocks.setQueue],
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: () => null }));

import { ToastProvider } from "./toast";

/** O que o provedor entrega a `useToast()`: as funções de aviso. */
function toastApi(): ToastApi {
  return (ToastProvider({ children: null }) as ReactElement<{ value: ToastApi }>).props.value;
}

beforeEach(() => {
  mocks.setQueue.mockClear();
  vi.stubGlobal("document", { body: {} });
});
afterEach(() => {
  vaultLock.reset();
  vi.unstubAllGlobals();
});

describe("ToastProvider: os avisos e o bloqueio por inatividade (RN-SEG-001)", () => {
  it("desbloqueado, cada aviso entra na fila", () => {
    const toast = toastApi();

    toast.success("a");
    toast.warning("b");
    toast.error("c");

    expect(mocks.setQueue).toHaveBeenCalledTimes(3);
  });

  it("com o Prism bloqueado nenhum aviso entra na fila (o bloqueio de verdade, que o provedor consulta a cada aviso), e depois do desbloqueio eles voltam", () => {
    const toast = toastApi();

    vaultLock.lock();
    toast.success("a");
    toast.warning("b");
    toast.error("c");
    expect(mocks.setQueue).not.toHaveBeenCalled();

    vaultLock.unlock();
    toast.warning("d");
    expect(mocks.setQueue).toHaveBeenCalledOnce();
  });
});
