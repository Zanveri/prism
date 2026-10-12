import type { ReactElement } from "react";

import { elementsOf } from "@/lib/testing/react-tree";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiResult } from "@/lib/api/prism-api";
import { vaultLock } from "@/lib/api/vault-lock";

import type { CloseState } from "../_lib/lock-vault";

// O `VaultLock` com os ganchos simulados (o vitest deste projeto não tem DOM): o que interessa é como ele liga as peças.
type IdleOptions = { enabled: boolean; minutes: number; isBusy: () => boolean; onLock: () => void };

const mocks = vi.hoisted(() => ({
  closeState: "closed" as string,
  setCloseState: vi.fn<(state: string) => void>(),
  preferences: { security: { lockEnabled: true, lockAfterMinutes: 10 } },
  idle: null as null | IdleOptions,
  secondsLeft: null as number | null,
  refetchQueries: vi.fn(async () => undefined),
  signOut: vi.fn(async (): Promise<unknown> => ({ ok: true, data: undefined })),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: () => [mocks.closeState, mocks.setCloseState],
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => ({ refetchQueries: mocks.refetchQueries }) }));
vi.mock("@/app/settings/_lib/use-preferences", () => ({ usePreferences: () => ({ preferences: mocks.preferences }) }));
vi.mock("@/app/sign-in/_lib/sign-in.service", () => ({ signOut: () => mocks.signOut() }));
vi.mock("../_lib/use-idle-lock", () => ({
  useIdleLock: (options: IdleOptions) => {
    mocks.idle = options;
    return mocks.secondsLeft;
  },
}));

import { IdleAnnouncer, IdleWarning } from "./idle-warning";
import { LockScreen } from "./lock-screen";
import { VaultLock } from "./vault-lock";

const isBusy = () => false;

beforeEach(() => {
  mocks.closeState = "closed";
  mocks.setCloseState.mockClear();
  mocks.preferences = { security: { lockEnabled: true, lockAfterMinutes: 10 } };
  mocks.idle = null;
  mocks.secondsLeft = null;
  mocks.refetchQueries.mockClear();
  mocks.signOut.mockClear();
  mocks.signOut.mockImplementation(async () => ({ ok: true, data: undefined }) as ApiResult<void>);
  vi.stubGlobal("document", { querySelectorAll: () => [] });
});
afterEach(() => {
  vaultLock.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("VaultLock: liga as preferências, o temporizador e a tela (RN-SEG-001)", () => {
  it("desbloqueado e ligado: o temporizador conta, com os minutos das preferências e o 'ocupado' da área de trabalho, e nada aparece (só o anunciador, vazio, que existe antes do aviso)", () => {
    mocks.preferences = { security: { lockEnabled: true, lockAfterMinutes: 25 } };

    const element = VaultLock({ isBusy, discard: vi.fn() });

    expect(mocks.idle).toMatchObject({ enabled: true, minutes: 25 });
    expect(mocks.idle?.isBusy).toBe(isBusy);
    expect(elementsOf(element).some((found) => found.type === IdleWarning)).toBe(false);
    expect(elementsOf(element).find((found) => found.type === IdleAnnouncer)?.props.active).toBe(false);
  });

  it("desligado nas preferências: nada conta", () => {
    mocks.preferences = { security: { lockEnabled: false, lockAfterMinutes: 10 } };

    VaultLock({ isBusy, discard: vi.fn() });

    expect(mocks.idle?.enabled).toBe(false);
  });

  it("faltando pouco: mostra o aviso, com quanto falta, e o anunciador passa a anunciar", () => {
    mocks.secondsLeft = 25;

    const element = VaultLock({ isBusy, discard: vi.fn() });

    expect(elementsOf(element).find((found) => found.type === IdleWarning)?.props.secondsLeft).toBe(25);
    expect(elementsOf(element).find((found) => found.type === IdleAnnouncer)?.props.active).toBe(true);
  });

  it("bloqueado: mostra a tela de bloqueio e o temporizador para (não conta com o cofre fechado)", () => {
    vaultLock.lock();

    const element = VaultLock({ isBusy, discard: vi.fn() }) as ReactElement<{ closeState: string; onUnlocked: () => void }>;

    expect(element.type).toBe(LockScreen);
    expect(mocks.idle?.enabled).toBe(false);
    expect(element.props.closeState).toBe("closed");
  });

  it("bloqueado: a tela recebe onde está o fechamento do cofre, qualquer que seja (fechando, tentando de novo, fechado, desistiu)", () => {
    vaultLock.lock();

    for (const state of ["closing", "retrying", "closed", "gaveUp"] satisfies CloseState[]) {
      mocks.closeState = state;

      const element = VaultLock({ isBusy, discard: vi.fn() }) as ReactElement<{ closeState: string }>;

      expect(element.props.closeState).toBe(state);
    }
  });

  it("desbloquear: solta a barreira e refaz o que falhou", () => {
    vaultLock.lock();
    const element = VaultLock({ isBusy, discard: vi.fn() }) as ReactElement<{ onUnlocked: () => void }>;

    element.props.onUnlocked();

    expect(vaultLock.isLocked()).toBe(false);
    expect(mocks.refetchQueries).toHaveBeenCalledOnce();
  });
});

describe("VaultLock: quando o tempo acaba", () => {
  it("arma a barreira, descarta a área de trabalho e fecha o cofre na API, e diz onde está o fechamento", async () => {
    const discard = vi.fn();
    VaultLock({ isBusy, discard });

    mocks.idle?.onLock();
    await flush();

    expect(vaultLock.isLocked()).toBe(true);
    expect(discard).toHaveBeenCalledOnce();
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.setCloseState.mock.calls.map(([state]) => state)).toEqual(["closing", "closed"]);
  });

  it("fecha o que está aberto por portal no documento da janela: a raiz que o bloqueio varre é o `document`", async () => {
    const dialog = { hasAttribute: () => false, querySelector: () => null, dispatchEvent: vi.fn(() => true) };
    vi.stubGlobal("KeyboardEvent", class {});
    vi.stubGlobal("document", { querySelectorAll: () => [dialog] });
    VaultLock({ isBusy, discard: vi.fn() });

    mocks.idle?.onLock();
    await flush();

    expect(dialog.dispatchEvent).toHaveBeenCalledOnce();
  });

  it("um passo de tela que lança não impede o fechamento do cofre, e o erro fica no registro do processo: nada passa calado", async () => {
    const error = new Error("o descarte quebrou");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    VaultLock({
      isBusy,
      discard: () => {
        throw error;
      },
    });

    mocks.idle?.onLock();
    await flush();

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith("[prism] bloqueio por inatividade:", error);
    logged.mockRestore();
  });

  it("o que a própria orquestração lança (aqui, o relato do estado à tela) também fica no registro, e não vira uma rejeição solta", async () => {
    const error = new Error("a tela não pôde ser avisada");
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.setCloseState.mockImplementationOnce(() => {
      throw error;
    });
    VaultLock({ isBusy, discard: vi.fn() });

    mocks.idle?.onLock();
    await flush();

    expect(logged).toHaveBeenCalledWith("[prism] bloqueio por inatividade:", error);
    logged.mockRestore();
  });

  it("já bloqueado, não bloqueia de novo (nada de descarte nem de segunda chamada)", async () => {
    const discard = vi.fn();
    VaultLock({ isBusy, discard });
    vaultLock.lock();

    mocks.idle?.onLock();
    await flush();

    expect(discard).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  const networkError = { ok: false, error: { status: 0, code: "NETWORK_ERROR", title: "Sem resposta da API.", detail: null, errors: null, extensions: {} } };

  it("o cofre que não fechou na API: a tela é avisada de que está tentando de novo, e a chamada se repete com recuo até fechar", async () => {
    vi.useFakeTimers();
    mocks.signOut.mockImplementationOnce(async () => networkError).mockImplementationOnce(async () => networkError);
    VaultLock({ isBusy, discard: vi.fn() });

    mocks.idle?.onLock();
    await vi.advanceTimersByTimeAsync(3000);

    expect(mocks.signOut).toHaveBeenCalledTimes(3);
    expect(mocks.setCloseState.mock.calls.map(([state]) => state)).toEqual(["closing", "retrying", "retrying", "closed"]);
  });

  it("o cofre que não fecha nunca: repete com recuo e, acabadas as tentativas, a tela é avisada de que desistiu", async () => {
    vi.useFakeTimers();
    mocks.signOut.mockImplementation(async () => networkError);
    VaultLock({ isBusy, discard: vi.fn() });

    mocks.idle?.onLock();
    await vi.advanceTimersByTimeAsync(31_000);

    expect(mocks.signOut).toHaveBeenCalledTimes(6);
    expect(mocks.setCloseState.mock.calls.map(([state]) => state)).toEqual(["closing", "retrying", "retrying", "retrying", "retrying", "retrying", "gaveUp"]);
  });
});
