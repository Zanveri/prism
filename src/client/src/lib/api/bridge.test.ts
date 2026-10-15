import { afterEach, describe, expect, it, vi } from "vitest";

import { onWindowCloseRequested, readDataFolder } from "./bridge";

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
