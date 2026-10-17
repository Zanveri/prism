import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseExportDestination, claimVerification, copyExport, currentAppZoom, deliverExport, finishVerification, onAppZoomChanged, onVerificationPeer, onWindowCloseRequested, readDataFolder, releaseExportDestination, requestAppZoom, revealExport, transfersAvailable } from "./bridge";

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

describe("a vez da verificação periódica pela ponte (RN-VERIF-002)", () => {
  const ok = { status: "ok", checkedAt: "2026-10-15T14:32:05Z", elapsedMs: 3, message: null, sqlState: null } as const;
  const bridgeWith = (verification: Record<string, unknown> | undefined) => vi.stubGlobal("window", { prism: verification === undefined ? {} : { verification } });

  it("a vez é só um `true` do processo principal; qualquer outra resposta, ou a ponte que falha, é “não”", async () => {
    const claim = vi.fn(async () => true);
    bridgeWith({ claim });
    expect(await claimVerification("c1", 30_000)).toBe(true);
    expect(claim).toHaveBeenCalledExactlyOnceWith({ connectionId: "c1", intervalMs: 30_000 });

    bridgeWith({ claim: async () => "sim" });
    expect(await claimVerification("c1", 30_000)).toBe(false);

    bridgeWith({
      claim: async () => {
        throw new Error("Pedido de origem desconhecida.");
      },
    });
    expect(await claimVerification("c1", 30_000)).toBe(false);
  });

  it("sem a ponte das janelas (uma janela só) a vez é sempre desta", async () => {
    bridgeWith(undefined);
    expect(await claimVerification("c1", 30_000)).toBe(true);
  });

  it("o fim vai ao processo principal e nunca lança, nem sem a ponte", () => {
    const finish = vi.fn(async () => {});
    bridgeWith({ finish });
    finishVerification({ connectionId: "c1", result: ok });
    expect(finish).toHaveBeenCalledExactlyOnceWith({ connectionId: "c1", result: ok });

    vi.stubGlobal("window", {});
    expect(() => finishVerification({ connectionId: "c1", result: null })).not.toThrow();
  });

  it("a resposta de outra janela chega só no formato do schema", () => {
    let deliver: (raw: unknown) => void = () => {};
    bridgeWith({
      onPeer: (listener: (raw: unknown) => void) => {
        deliver = listener;
        return () => {};
      },
    });
    const heard = vi.fn();
    onVerificationPeer(heard);

    deliver({ connectionId: "c1", result: ok });
    deliver({ connectionId: "c1", result: { ...ok, status: "talvez" } });
    deliver("c1");
    expect(heard).toHaveBeenCalledExactlyOnceWith({ connectionId: "c1", result: ok });
  });
});

describe("o destino e a entrega das exportações de dados (RN-EXPORT-019 e 020), do lado da tela", () => {
  const transfersWith = (transfers: Record<string, unknown>) => vi.stubGlobal("window", { prism: { transfers: { available: true, ...transfers } } });

  it("`transfersAvailable`: só com a ponte do Electron; fora dele (sem ponte, ou uma ponte sem o grupo) o \"Exportar\" diz que só funciona no app", () => {
    transfersWith({});
    expect(transfersAvailable()).toBe(true);

    vi.stubGlobal("window", { prism: {} });
    expect(transfersAvailable()).toBe(false);
    vi.stubGlobal("window", { prism: { transfers: { available: false } } });
    expect(transfersAvailable()).toBe(false);
  });

  it("a resposta do destino é conferida com o schema: o escolhido traz o identificador e o nome, e o que não confere (um caminho a mais é ignorado, a forma errada recusada) é `error`", async () => {
    const asked: unknown[] = [];
    transfersWith({ chooseDestination: async (request: unknown) => (asked.push(request), { status: "chosen", destinationId: "d1", fileName: "pedido.csv" }) });
    expect(await chooseExportDestination({ suggestedName: "pedido", extension: "csv" })).toEqual({ status: "chosen", destinationId: "d1", fileName: "pedido.csv" });
    expect(asked).toEqual([{ suggestedName: "pedido", extension: "csv" }]);

    transfersWith({ chooseDestination: async () => ({ status: "chosen", destinationId: "d1", fileName: "pedido.csv", path: "/home/<nome>/pedido.csv" }) });
    expect(await chooseExportDestination({ suggestedName: "pedido", extension: "csv" })).toEqual({ status: "chosen", destinationId: "d1", fileName: "pedido.csv" });

    for (const reply of [{ status: "chosen" }, { status: "outro" }, null, "chosen"]) {
      transfersWith({ chooseDestination: async () => reply });
      expect(await chooseExportDestination({ suggestedName: "pedido", extension: "csv" })).toEqual({ status: "error" });
    }
    transfersWith({ chooseDestination: async () => Promise.reject(new Error("Pedido de origem desconhecida.")) });
    expect(await chooseExportDestination({ suggestedName: "pedido", extension: "csv" })).toEqual({ status: "error" });
  });

  it("a entrega e a cópia: a resposta conferida, e a ponte que falha vira a entrega que falhou (`other`) ou a cópia que falhou, com a frase dada", async () => {
    transfersWith({ deliver: async () => ({ status: "failed", reason: "inUse", message: "o arquivo está aberto em outro programa" }), copy: async () => ({ status: "tooLarge" }) });
    expect(await deliverExport({ transferId: "0f8fad5b-d9cb-469f-a165-70867728950e", destinationId: "d1", reveal: false }, "x")).toEqual({ status: "failed", reason: "inUse", message: "o arquivo está aberto em outro programa" });
    expect(await copyExport("0f8fad5b-d9cb-469f-a165-70867728950e", "x")).toEqual({ status: "tooLarge" });

    transfersWith({ deliver: async () => ({ status: "delivered" }), copy: async () => Promise.reject(new Error("boom")) });
    expect(await deliverExport({ transferId: "0f8fad5b-d9cb-469f-a165-70867728950e", destinationId: "d1", reveal: false }, "não deu")).toEqual({ status: "failed", reason: "other", message: "não deu" });
    expect(await copyExport("0f8fad5b-d9cb-469f-a165-70867728950e", "não copiou")).toEqual({ status: "failed", message: "não copiou" });
  });

  it("mostrar na pasta e soltar o destino nunca lançam, também sem ponte", async () => {
    const calls: unknown[] = [];
    transfersWith({ reveal: async (request: unknown) => void calls.push(["reveal", request]), release: async (request: unknown) => void calls.push(["release", request]) });
    revealExport("e1");
    await releaseExportDestination("d1");
    expect(calls).toEqual([
      ["reveal", { deliveryId: "e1" }],
      ["release", { destinationId: "d1" }],
    ]);

    vi.stubGlobal("window", {});
    expect(() => revealExport("e1")).not.toThrow();
    await expect(releaseExportDestination("d1")).resolves.toBeUndefined();
  });
});
