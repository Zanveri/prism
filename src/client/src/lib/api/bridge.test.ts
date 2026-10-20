import { afterEach, describe, expect, it, vi } from "vitest";

import { chooseExportDestination, chooseImportSource, claimVerification, closeResultWindow, copyExport, currentAppZoom, deliverExport, finishVerification, importSourceStatus, focusResultWindow, onAppZoomChanged, onResultWindowClosed, onResultWindowState, onVerificationPeer, onWindowCloseRequested, readDataFolder, releaseExportDestination, releaseImportSource, requestAppZoom, requestResultWindow, resultWindowsAvailable, revealExport, setResultWindowTitle, tellResultWindowReady, transfersAvailable } from "./bridge";

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

describe("o arquivo das importações de dados (RN-IMPORT-018), do lado da tela", () => {
  const fileId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const transfersWith = (transfers: Record<string, unknown>) => vi.stubGlobal("window", { prism: { transfers: { available: true, ...transfers } } });

  it("a escolha é conferida com o schema: o escolhido traz o identificador, o nome e o tamanho; o caminho a mais é jogado fora, e o que não confere é `error`", async () => {
    transfersWith({ chooseSource: async () => ({ status: "chosen", fileId, fileName: "pedidos.csv", size: 120, path: "/home/<nome>/pedidos.csv" }) });
    expect(await chooseImportSource()).toEqual({ status: "chosen", fileId, fileName: "pedidos.csv", size: 120 });

    transfersWith({ chooseSource: async () => ({ status: "noSpace", needed: 10 }) });
    expect(await chooseImportSource()).toEqual({ status: "noSpace", needed: 10 });

    for (const reply of [{ status: "chosen", fileId: "../cofre", fileName: "a", size: 1 }, { status: "outro" }, null]) {
      transfersWith({ chooseSource: async () => reply });
      expect(await chooseImportSource()).toEqual({ status: "error" });
    }
    vi.stubGlobal("window", {});
    expect(await chooseImportSource()).toEqual({ status: "error" });
  });

  it("a consulta da cópia: a resposta conferida; a ponte que falha, ou a resposta fora da forma, vale `missing`", async () => {
    const asked: unknown[] = [];
    transfersWith({ sourceStatus: async (request: unknown) => (asked.push(request), { status: "copying", copied: 5, size: 10 }) });
    expect(await importSourceStatus(fileId)).toEqual({ status: "copying", copied: 5, size: 10 });
    expect(asked).toEqual([{ fileId }]);

    transfersWith({ sourceStatus: async () => ({ status: "failed", reason: "estranho", message: "x" }) });
    expect(await importSourceStatus(fileId)).toEqual({ status: "missing" });
    transfersWith({ sourceStatus: async () => Promise.reject(new Error("boom")) });
    expect(await importSourceStatus(fileId)).toEqual({ status: "missing" });
  });

  it("soltar o arquivo espera a resposta e nunca lança, também sem ponte", async () => {
    const calls: unknown[] = [];
    transfersWith({ releaseSource: async (request: unknown) => void calls.push(request) });
    await releaseImportSource(fileId);
    expect(calls).toEqual([{ fileId }]);
    vi.stubGlobal("window", {});
    await expect(releaseImportSource(fileId)).resolves.toBeUndefined();
  });
});

describe("a janela do resultado (RN-ABAS-013 e 017)", () => {
  const name = "prism-result-0b9f2c1e-8a4d-4f6b-9c3e-1d2a3b4c5d6e";

  /** A ponte da janela do resultado, com o que cada teste responde. */
  const bridge = (over: Record<string, unknown> = {}) => {
    const resultWindows = { available: true, request: vi.fn(async () => ({ ok: true })), ready: vi.fn(async () => {}), focus: vi.fn(async () => true), close: vi.fn(async () => true), title: vi.fn(async () => true), onClosed: vi.fn(() => () => {}), onState: vi.fn(() => () => {}), ...over };
    vi.stubGlobal("window", { prism: { resultWindows } });
    return resultWindows;
  };

  it("só há janela do resultado onde o processo principal diz que há (o app); fora do Electron, ou com uma ponte antiga, não", () => {
    bridge();
    expect(resultWindowsAvailable()).toBe(true);

    bridge({ available: false });
    expect(resultWindowsAvailable()).toBe(false);

    vi.stubGlobal("window", { prism: {} });
    expect(resultWindowsAvailable()).toBe(false);

    vi.stubGlobal("window", {});
    expect(resultWindowsAvailable()).toBe(false);
  });

  it("o pedido leva o nome, o modo e o ponto, e só `ok: true` abre; a recusa, a resposta fora do formato e a falha da ponte são 'não'", async () => {
    const resultWindows = bridge();
    await expect(requestResultWindow({ name, mode: "focus", at: null })).resolves.toBe(true);
    expect(resultWindows.request).toHaveBeenCalledWith({ name, mode: "focus", at: null });

    bridge({ request: async () => ({ ok: false }) });
    await expect(requestResultWindow({ name, mode: "background", at: { x: 1, y: 2 } })).resolves.toBe(false);

    bridge({ request: async () => "sim" });
    await expect(requestResultWindow({ name, mode: "focus", at: null })).resolves.toBe(false);

    bridge({
      request: async () => {
        throw new Error("Pedido de origem desconhecida.");
      },
    });
    await expect(requestResultWindow({ name, mode: "focus", at: null })).resolves.toBe(false);

    vi.stubGlobal("window", {});
    await expect(requestResultWindow({ name, mode: "focus", at: null })).resolves.toBe(false);
  });

  it("pronta, trazer à frente, fechar e o título passam o nome; a falha da ponte não chega à tela", async () => {
    const resultWindows = bridge();

    tellResultWindowReady(name);
    setResultWindowTitle(name, "Resultado · a.sql — Prism");
    await expect(focusResultWindow({ name, target: "opener" })).resolves.toBe(true);
    await expect(closeResultWindow(name)).resolves.toBe(true);

    expect(resultWindows.ready).toHaveBeenCalledWith({ name });
    expect(resultWindows.title).toHaveBeenCalledWith({ name, title: "Resultado · a.sql — Prism" });
    expect(resultWindows.focus).toHaveBeenCalledWith({ name, target: "opener" });
    expect(resultWindows.close).toHaveBeenCalledWith({ name });

    bridge({
      focus: async () => {
        throw new Error("x");
      },
      close: async () => "talvez",
      ready: async () => {
        throw new Error("x");
      },
    });
    await expect(focusResultWindow({ name })).resolves.toBe(false);
    await expect(closeResultWindow(name)).resolves.toBe(false);
    expect(() => tellResultWindowReady(name)).not.toThrow();

    vi.stubGlobal("window", {});
    await expect(focusResultWindow({ name })).resolves.toBe(false);
    expect(() => setResultWindowTitle(name, "x")).not.toThrow();
  });

  function listening(channel: "onClosed" | "onState") {
    let fire: (raw: unknown) => void = () => {};
    bridge({ [channel]: (listener: (raw: unknown) => void) => ((fire = listener), () => {}) });
    return (raw: unknown) => fire(raw);
  }

  it("o fechamento que o processo principal conta diz quem fechou; o que não confere é ignorado", () => {
    const fire = listening("onClosed");
    const heard: unknown[] = [];
    onResultWindowClosed((closed) => heard.push(closed));

    fire({ name, reason: "user" });
    fire({ name, reason: "host" });
    fire({ name, reason: "sistema" });
    fire({ name: "outra", reason: "user" });
    fire(null);

    expect(heard).toEqual([
      { name, reason: "user" },
      { name, reason: "host" },
    ]);
  });

  it("o estado (minimizada ou não) também é conferido", () => {
    const fire = listening("onState");
    const heard: unknown[] = [];
    onResultWindowState((state) => heard.push(state));

    fire({ name, minimized: true });
    fire({ name, minimized: "talvez" });

    expect(heard).toEqual([{ name, minimized: true }]);
  });

  it("sem a ponte dos avisos, ligar o ouvinte não derruba nada", () => {
    vi.stubGlobal("window", {});

    expect(() => onResultWindowClosed(() => {})()).not.toThrow();
    expect(() => onResultWindowState(() => {})()).not.toThrow();
  });
});
