import { describe, expect, it } from "vitest";

import type { SplashStep } from "./splash";
import { startUp } from "./startup";

/** Dependências falsas que anotam a ordem em que são chamadas. */
function setup(options: { apiFails?: boolean } = {}) {
  const calls: string[] = [];
  let releaseReady = () => {};
  const ready = new Promise<void>((resolve) => {
    releaseReady = resolve;
  });

  const deps = {
    showSplash() {
      calls.push("splash:show");
      return {
        setStep: (step: SplashStep) => void calls.push(`splash:${step}`),
        close: () => void calls.push("splash:close"),
      };
    },
    startApi() {
      calls.push("api:start");
      return options.apiFails === true ? Promise.reject(new Error("não subiu")) : Promise.resolve({});
    },
    createMainWindow() {
      calls.push("main:create");
      return {
        whenReadyToShow() {
          calls.push("main:wait");
          return ready;
        },
        show: () => void calls.push("main:show"),
      };
    },
  };

  return { calls, deps, releaseReady };
}

/** Deixa as promessas já resolvidas andarem, sem esperar relógio. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("startUp", () => {
  it("o splash aparece antes de a API começar a subir", async () => {
    const { calls, deps, releaseReady } = setup();
    releaseReady();

    await startUp(deps);

    expect(calls.slice(0, 3)).toEqual(["splash:show", "splash:api", "api:start"]);
  });

  it('com a API pronta, o splash vai para o passo "ui" e a janela principal é criada', async () => {
    const { calls, deps, releaseReady } = setup();
    releaseReady();

    await startUp(deps);

    expect(calls.slice(2, 5)).toEqual(["api:start", "splash:ui", "main:create"]);
  });

  it("a janela principal só aparece depois de pronta, e o splash fecha em seguida", async () => {
    const { calls, deps, releaseReady } = setup();

    const running = startUp(deps);
    await settle();
    expect(calls).toContain("main:wait");
    expect(calls).not.toContain("main:show");
    expect(calls).not.toContain("splash:close");

    releaseReady();
    await running;

    expect(calls.slice(-2)).toEqual(["main:show", "splash:close"]);
  });

  it("se a API falhar, o splash fecha e a janela principal aparece assim mesmo", async () => {
    const { calls, deps, releaseReady } = setup({ apiFails: true });
    releaseReady();

    await startUp(deps);

    expect(calls).toEqual(["splash:show", "splash:api", "api:start", "splash:ui", "main:create", "main:wait", "main:show", "splash:close"]);
  });

  it("o splash fecha uma vez só", async () => {
    for (const apiFails of [false, true]) {
      const { calls, deps, releaseReady } = setup({ apiFails });
      releaseReady();

      await startUp(deps);

      expect(calls.filter((call) => call === "splash:close")).toHaveLength(1);
    }
  });
});
