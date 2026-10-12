import { Fragment, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { vaultLock } from "@/lib/api/vault-lock";

// O componente com os ganchos simulados: o vitest deste projeto não tem DOM, e o que interessa é a chave que ele devolve e o que ele manda o roteador fazer.
const hooks = vi.hoisted(() => ({
  mounted: 0,
  setMounted: vi.fn<(value: number) => void>(),
  effects: [] as (() => void)[],
  location: { pathname: "/connections", search: "" },
  navigate: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useState: () => [hooks.mounted, hooks.setMounted],
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  useEffect: (effect: () => void) => void hooks.effects.push(effect),
}));
vi.mock("react-router", () => ({ useLocation: () => hooks.location, useNavigate: () => hooks.navigate }));

import { RemountOnLock, remountStep } from "./remount-on-lock";

describe("remountStep: quando as outras telas se remontam (RN-SEG-001)", () => {
  it("a época do bloqueio mudou e a URL está limpa: remonta já", () => {
    expect(remountStep({ mounted: 1, lockEpoch: 2, search: "" })).toEqual({ mounted: 2, clearSearch: false });
  });

  it("a época mudou, mas a URL tem busca (?connection=, ?driver=): espera, e manda limpá-la; remontar agora reabriria o formulário", () => {
    expect(remountStep({ mounted: 1, lockEpoch: 2, search: "?connection=abc" })).toEqual({ mounted: 1, clearSearch: true });
  });

  it("nada mudou: não remonta, e uma busca na URL fica onde está", () => {
    expect(remountStep({ mounted: 2, lockEpoch: 2, search: "" })).toEqual({ mounted: 2, clearSearch: false });
    expect(remountStep({ mounted: 2, lockEpoch: 2, search: "?driver=x" })).toEqual({ mounted: 2, clearSearch: false });
  });

  it("pulou mais de uma época (dois bloqueios seguidos): remonta uma vez, na mais nova", () => {
    expect(remountStep({ mounted: 1, lockEpoch: 4, search: "" })).toEqual({ mounted: 4, clearSearch: false });
  });
});

describe("RemountOnLock: o componente", () => {
  beforeEach(() => {
    hooks.effects.length = 0;
    hooks.setMounted.mockClear();
    hooks.navigate.mockClear();
    hooks.location = { pathname: "/connections", search: "" };
    hooks.mounted = 0;
  });

  const lockTimes = (times: number) => {
    for (let index = 0; index < times; index++) {
      vaultLock.lock();
      vaultLock.unlock();
    }
  };

  it("o que está dentro tem como chave a época do bloqueio: bloquear troca a chave, e o React remonta tudo", () => {
    const epoch = vaultLock.epoch();
    hooks.mounted = epoch;
    const before = RemountOnLock({ children: "tela" }) as ReactElement;

    lockTimes(1);
    const after = RemountOnLock({ children: "tela" }) as ReactElement;

    expect(before.type).toBe(Fragment);
    expect(before.key).toBe(String(epoch));
    expect(after.key).toBe(String(epoch + 1));
    expect(after.key).not.toBe(before.key);
    expect(hooks.setMounted).toHaveBeenCalledWith(epoch + 1);
  });

  it("sem bloqueio novo a chave não muda (a tela não se remonta à toa)", () => {
    hooks.mounted = vaultLock.epoch();

    const element = RemountOnLock({ children: "tela" }) as ReactElement;

    expect(element.key).toBe(String(vaultLock.epoch()));
    expect(hooks.setMounted).not.toHaveBeenCalled();
  });

  it("com a busca suja na URL a chave espera, e o efeito limpa a URL trocando a entrada do histórico", () => {
    hooks.mounted = vaultLock.epoch();
    lockTimes(1);
    hooks.location = { pathname: "/connections", search: "?connection=abc" };

    const element = RemountOnLock({ children: "tela" }) as ReactElement;
    for (const effect of hooks.effects) effect();

    expect(element.key).toBe(String(hooks.mounted));
    expect(hooks.setMounted).not.toHaveBeenCalled();
    expect(hooks.navigate).toHaveBeenCalledExactlyOnceWith({ pathname: "/connections" }, { replace: true });
  });

  it("com a URL limpa o efeito não navega", () => {
    hooks.mounted = vaultLock.epoch();
    lockTimes(1);

    RemountOnLock({ children: "tela" });
    for (const effect of hooks.effects) effect();

    expect(hooks.navigate).not.toHaveBeenCalled();
  });
});
