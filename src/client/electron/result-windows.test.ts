import { describe, expect, it } from "vitest";

import { grantTtlMs, maxResultWindows, resultWindowNameOf } from "./result-window-messages";
import { creatingTtlMs, createResultWindows, type OpenDetails, type ResultWindowHandle } from "./result-windows";

const idA = "0b9f2c1e-8a4d-4f6b-9c3e-1d2a3b4c5d6e";
const idB = "1c0a3d2f-9b5e-4a7c-8d4f-2e3b4c5d6e7f";
const nameA = resultWindowNameOf(idA);
const nameB = resultWindowNameOf(idB);

function harness() {
  let clock = 1_000_000;
  const ready = new Set([1, 2]);
  const logs: string[] = [];
  let nextContents = 100;
  const windows = createResultWindows<ResultWindowHandle & { closed: boolean }>({
    now: () => clock,
    isReady: (openerId) => ready.has(openerId),
    pointOf: (at) => at,
    log: (message) => void logs.push(message),
  });
  const open = (name: string): OpenDetails => ({ url: "about:blank", frameName: name, features: "popup", disposition: "new-window", hasPostBody: false });
  const handle = () => {
    const value = { contentsId: nextContents++, closed: false, close: () => void (value.closed = true), isDestroyed: () => value.closed };
    return value;
  };
  /** Pede, aprova e adota: a janela aberta. */
  const openWindow = (openerId: number, name: string, mode: "focus" | "background" = "focus") => {
    expect(windows.request(openerId, { name, mode, at: null })).toEqual({ ok: true });
    expect(windows.approve(openerId, open(name))).not.toBeNull();
    const value = handle();
    const entry = windows.adopt(openerId, name, value);
    expect(entry).not.toBeNull();
    return value;
  };
  return { windows, ready, logs, open, handle, openWindow, advance: (ms: number) => void (clock += ms) };
}

describe("o pedido da janela do resultado e a concessão de uso único (RN-ABAS-017)", () => {
  it("o pedido de uma janela pronta vale, e a aprovação consome a concessão: uma abertura por pedido", () => {
    const { windows, open } = harness();

    expect(windows.request(1, { name: nameA, mode: "focus", at: null })).toEqual({ ok: true });
    const grant = windows.approve(1, open(nameA));
    expect(grant).toMatchObject({ openerId: 1, name: nameA, mode: "focus", point: null });
    // Uso único.
    expect(windows.approve(1, open(nameA))).toBeNull();
  });

  it("a concessão vale 2 segundos", () => {
    const { windows, open, advance } = harness();

    windows.request(1, { name: nameA, mode: "focus", at: null });
    advance(grantTtlMs - 1);
    expect(windows.approve(1, open(nameA))).not.toBeNull();

    windows.request(1, { name: nameB, mode: "focus", at: null });
    advance(grantTtlMs);
    expect(windows.approve(1, open(nameB))).toBeNull();
  });

  it("é daquela janela da aba e daquele nome: outra janela, ou outro nome, não usa a concessão", () => {
    const { windows, open } = harness();

    windows.request(1, { name: nameA, mode: "focus", at: null });
    expect(windows.approve(2, open(nameA))).toBeNull();
    expect(windows.approve(1, open(nameB))).toBeNull();
    expect(windows.approve(1, open(nameA))).not.toBeNull();
  });

  it("sem pedido não há concessão, e o pedido de uma janela que não está pronta (o cofre fechado, a área de trabalho não montada) é recusado", () => {
    const { windows, open, ready } = harness();

    expect(windows.approve(1, open(nameA))).toBeNull();

    ready.delete(1);
    expect(windows.request(1, { name: nameA, mode: "focus", at: null })).toEqual({ ok: false });

    ready.add(1);
    windows.request(1, { name: nameA, mode: "focus", at: null });
    ready.delete(1);
    expect(windows.approve(1, open(nameA))).toBeNull();
  });

  it("o pedido com o conteúdo fora do schema é recusado, sem lançar", () => {
    const { windows } = harness();

    for (const bad of [null, undefined, {}, { name: nameA }, { name: "prism-result-x", mode: "focus", at: null }, { name: nameA, mode: "focus", at: null, more: 1 }, "texto"]) {
      expect(windows.request(1, bad)).toEqual({ ok: false });
    }
  });

  it("o ponto do arraste vai na concessão, como o processo principal o decidiu", () => {
    const { windows, open } = harness();

    windows.request(1, { name: nameA, mode: "background", at: { x: 40, y: 50 } });
    expect(windows.approve(1, open(nameA))).toMatchObject({ mode: "background", point: { x: 40, y: 50 } });
  });
});

describe("a aprovação só vale com todas as condições (RN-ABAS-017)", () => {
  it.each<[string, Partial<OpenDetails>]>([
    ["outro endereço", { url: "https://example.com/" }],
    ["o endereço com algo a mais", { url: "about:blank#x" }],
    ["o endereço vazio", { url: "" }],
    ["um nome fora do padrão", { frameName: "prism-result-1234" }],
    ["o nome do alvo comum", { frameName: "_blank" }],
    ["as opções com tamanho", { features: "popup,width=100,height=100" }],
    ["as opções vazias", { features: "" }],
    ["as opções em maiúsculas", { features: "POPUP" }],
    ["uma aba em primeiro plano", { disposition: "foreground-tab" }],
    ["uma aba em segundo plano", { disposition: "background-tab" }],
    ["a disposição padrão", { disposition: "default" }],
    ["um corpo de envio", { hasPostBody: true }],
  ])("nega %s", (_name, change) => {
    const { windows, open } = harness();

    windows.request(1, { name: nameA, mode: "focus", at: null });
    expect(windows.approve(1, { ...open(nameA), ...change })).toBeNull();
  });

  it("a concessão que um pedido recusado não gerou não existe, e uma abertura negada não gasta a de outra", () => {
    const { windows, open } = harness();

    windows.request(1, { name: nameA, mode: "focus", at: null });
    expect(windows.approve(1, { ...open(nameA), features: "popup,width=1" })).toBeNull();
    // A concessão do nome continua valendo para a abertura certa.
    expect(windows.approve(1, open(nameA))).not.toBeNull();
  });
});

describe("o limite e a janela que já existe", () => {
  it("no máximo 32 janelas do resultado por janela da aba, contando as abertas e as concessões; outra janela da aba tem as suas", () => {
    const { windows, openWindow } = harness();
    const names = Array.from({ length: maxResultWindows + 2 }, (_, index) => resultWindowNameOf(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`));

    for (const name of names.slice(0, maxResultWindows)) openWindow(1, name);
    expect(windows.request(1, { name: names[maxResultWindows], mode: "focus", at: null })).toEqual({ ok: false });
    expect(windows.openedBy(1)).toHaveLength(maxResultWindows);
    expect(windows.request(2, { name: names[maxResultWindows], mode: "focus", at: null })).toEqual({ ok: true });
  });

  it("as concessões ainda não usadas também contam para o limite", () => {
    const { windows } = harness();
    const names = Array.from({ length: maxResultWindows + 1 }, (_, index) => resultWindowNameOf(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`));

    const replies = names.map((name) => windows.request(1, { name, mode: "focus", at: null }).ok);
    expect(replies.filter(Boolean)).toHaveLength(maxResultWindows);
    expect(replies.at(-1)).toBe(false);
  });

  it("não se pede nem se aprova de novo um nome que já está aberto (o Chromium daria a janela que existe, navegada para a página em branco)", () => {
    const { windows, openWindow, open } = harness();
    openWindow(1, nameA);

    expect(windows.request(1, { name: nameA, mode: "focus", at: null })).toEqual({ ok: false });
    expect(windows.approve(1, open(nameA))).toBeNull();
    // O mesmo nome em outra janela da aba é outra entrada.
    expect(windows.request(2, { name: nameA, mode: "focus", at: null })).toEqual({ ok: true });
  });

  it("depois que a janela fecha, o nome pode ser pedido de novo", () => {
    const { windows, openWindow } = harness();
    const value = openWindow(1, nameA);
    value.closed = true;
    windows.closed(1, nameA);

    expect(windows.request(1, { name: nameA, mode: "focus", at: null })).toEqual({ ok: true });
  });

  it("a abertura aprovada que nunca criou a janela deixa de contar depois de um tempo, e `abandon` a tira na hora", () => {
    const { windows, open, advance } = harness();

    windows.request(1, { name: nameA, mode: "focus", at: null });
    windows.approve(1, open(nameA));
    expect(windows.request(1, { name: nameA, mode: "focus", at: null })).toEqual({ ok: false });
    advance(creatingTtlMs);
    expect(windows.request(1, { name: nameA, mode: "focus", at: null })).toEqual({ ok: true });

    windows.approve(1, open(nameA));
    windows.abandon(1, nameA);
    expect(windows.request(1, { name: nameA, mode: "focus", at: null })).toEqual({ ok: true });
  });

  it("`adopt` sem uma abertura aprovada não registra nada", () => {
    const { windows, handle } = harness();

    expect(windows.adopt(1, nameA, handle())).toBeNull();
    expect(windows.find(1, nameA)).toBeUndefined();
  });
});

describe("a lista: pela janela que abriu e pelo nome, e o motivo de cada fechamento", () => {
  it("reconhece o `webContents` de uma janela do resultado pelo número, e só enquanto ela está na lista", () => {
    const { windows, openWindow } = harness();
    const value = openWindow(1, nameA);

    expect(windows.isResultContents(value.contentsId)).toBe(true);
    expect(windows.isResultContents(value.contentsId + 1)).toBe(false);
    expect(windows.isResultContents(1)).toBe(false);

    windows.closed(1, nameA);
    expect(windows.isResultContents(value.contentsId)).toBe(false);
  });

  it("o Prism que fecha marca antes: o motivo é `host`; o que não foi pedido por ele é `user`", () => {
    const { windows, openWindow } = harness();
    const hosted = openWindow(1, nameA);
    openWindow(1, nameB);

    expect(windows.closeByHost(1, nameA)).toBe(true);
    expect(hosted.closed).toBe(true);
    expect(windows.closed(1, nameA)).toBe("host");
    // A pessoa fechou a outra (o X da barra, Alt+F4, Cmd+W).
    expect(windows.closed(1, nameB)).toBe("user");
    // Já saiu da lista.
    expect(windows.closed(1, nameB)).toBeNull();
  });

  it("fechar pelo Prism uma janela que não existe, ou de outra janela da aba, não faz nada", () => {
    const { windows, openWindow } = harness();
    const value = openWindow(1, nameA);

    expect(windows.closeByHost(2, nameA)).toBe(false);
    expect(windows.closeByHost(1, nameB)).toBe(false);
    expect(value.closed).toBe(false);
  });

  it("fechar todas as de uma janela da aba (o bloqueio, a recarga, o fim do app) fecha só as dela, pelo Prism", () => {
    const { windows, openWindow } = harness();
    const first = openWindow(1, nameA);
    const second = openWindow(1, nameB);
    const other = openWindow(2, nameA);

    windows.closeAllByHost(1);

    expect(first.closed && second.closed).toBe(true);
    expect(other.closed).toBe(false);
    expect(windows.closed(1, nameA)).toBe("host");
    expect(windows.closed(1, nameB)).toBe("host");
    expect(windows.closed(2, nameA)).toBe("user");
  });

  it("o mesmo nome em duas janelas da aba são duas entradas", () => {
    const { windows, openWindow } = harness();
    openWindow(1, nameA);
    openWindow(2, nameA);

    expect(windows.openedBy(1)).toHaveLength(1);
    expect(windows.openedBy(2)).toHaveLength(1);
    expect(windows.all()).toHaveLength(2);
  });
});
