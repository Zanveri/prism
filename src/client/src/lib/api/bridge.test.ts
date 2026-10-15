import { afterEach, describe, expect, it, vi } from "vitest";

import { currentAppZoom, onAppZoomChanged, onWindowCloseRequested, readDataFolder, requestAppZoom } from "./bridge";

/** A ponte com só o que a pasta de dados usa: o resto não importa aqui. */
const bridgeAnswering = (reply: () => Promise<unknown>) => vi.stubGlobal("window", { prism: { getDataFolder: reply } });

afterEach(() => vi.unstubAllGlobals());

describe("readDataFolder (a pasta de dados em uso, que o processo principal diz)", () => {
  it("devolve o caminho que a ponte entrega, como veio (no Windows, com as barras invertidas)", async () => {
    bridgeAnswering(async () => "C:\\Dados\\Zanveri\\Prism");

    expect(await readDataFolder()).toBe("C:\\Dados\\Zanveri\\Prism");
  });

  it.each([
    ["texto vazio", ""],
    ["nada", undefined],
    ["nulo", null],
    ["número", 42],
    ["objeto", { path: "/dados" }],
    ["lista", ["/dados"]],
  ])("resposta que não é um caminho (%s) vale 'sem pasta'", async (_what, reply) => {
    bridgeAnswering(async () => reply);

    expect(await readDataFolder()).toBeNull();
  });

  it("a ponte que recusa o pedido (a origem não é a do app) ou falha vale 'sem pasta', e não derruba a tela", async () => {
    bridgeAnswering(async () => {
      throw new Error("Pedido de origem desconhecida.");
    });

    expect(await readDataFolder()).toBeNull();
  });

  it("fora do Electron, sem ponte, não há pasta", async () => {
    vi.stubGlobal("window", {});

    expect(await readDataFolder()).toBeNull();
  });
});

describe("onWindowCloseRequested: a pessoa fechou a janela (RN-ABAS-004 e 007)", () => {
  function closeWith(payload: unknown) {
    let fire: (raw: unknown) => void = () => {};
    vi.stubGlobal("window", { prism: { windows: { onCloseRequested: (listener: (raw: unknown) => void) => ((fire = listener), () => {}) } } });
    const heard: unknown[] = [];
    onWindowCloseRequested((request) => heard.push(request));
    fire(payload);
    return heard;
  }

  it("diz se a janela é a última (fechá-la fecha o app)", () => {
    expect(closeWith({ last: true })).toEqual([{ last: true }]);
    expect(closeWith({ last: false })).toEqual([{ last: false }]);
  });

  it("o aviso que não diz isso direito vale 'não é a última': o fechamento pergunta tudo, como antes", () => {
    expect(closeWith(undefined)).toEqual([{ last: false }]);
    expect(closeWith({ last: "sim" })).toEqual([{ last: false }]);
  });
});

describe("o zoom do programa pela ponte (RN-ZOOM-001): só um dos passos é resposta", () => {
  const zoomBridge = (zoom: Record<string, unknown>) => vi.stubGlobal("window", { prism: { zoom } });

  it("o de agora, como o processo principal o diz", async () => {
    zoomBridge({ get: async () => 125 });

    expect(await currentAppZoom()).toBe(125);
  });

  it.each([
    ["fora dos passos", 105],
    ["texto", "125"],
    ["fator", 1.25],
    ["nada", undefined],
    ["nulo", null],
    ["objeto", { zoom: 125 }],
  ])("resposta que não é um dos passos (%s) vale 'sem zoom', e a tela passa sem o controle", async (_what, reply) => {
    zoomBridge({ get: async () => reply, set: async () => reply });

    expect(await currentAppZoom()).toBeNull();
    expect(await requestAppZoom(110)).toBeNull();
  });

  it("pedir outro devolve o que ficou valendo; a ponte que recusa, falha ou não existe vale 'sem zoom', sem lançar", async () => {
    const set = vi.fn(async (zoom: number) => zoom);
    zoomBridge({ set });
    expect(await requestAppZoom(90)).toBe(90);
    expect(set).toHaveBeenCalledExactlyOnceWith(90);

    zoomBridge({
      get: async () => {
        throw new Error("Pedido de origem desconhecida.");
      },
      set: async () => {
        throw new Error("Zoom fora dos passos.");
      },
    });
    expect(await currentAppZoom()).toBeNull();
    expect(await requestAppZoom(90)).toBeNull();

    vi.stubGlobal("window", {});
    expect(await currentAppZoom()).toBeNull();
  });

  it("o aviso de que mudou chega só com um dos passos; sem a ponte, ligar o ouvinte não derruba nada", () => {
    let fire: (raw: unknown) => void = () => {};
    zoomBridge({ onChanged: (listener: (raw: unknown) => void) => ((fire = listener), () => {}) });
    const heard: number[] = [];
    onAppZoomChanged((zoom) => heard.push(zoom));
    for (const raw of [150, 151, "150", null, 67]) fire(raw);

    expect(heard).toEqual([150, 67]);

    vi.stubGlobal("window", {});
    expect(() => onAppZoomChanged(() => {})()).not.toThrow();
  });
});
