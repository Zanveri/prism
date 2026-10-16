import { describe, expect, it } from "vitest";

import { createWindowHub, newWindowBounds, verificationClaimTtlMs, verificationSlackMs, type HubWindow, type Rect } from "./window-hub";
import type { TabTransfer } from "./window-messages";

const transfer: TabTransfer = {
  version: 1,
  tab: { id: "6f1c1f62-5d2b-4d36-9a37-2f6f0c7a1b10", title: "consulta-1.sql", connectionId: "c-1", sessionId: "s-1", sql: "select 1" },
  editor: { anchor: 8, head: 8 },
  result: null,
  memory: {},
};

type Sent = { to: number; channel: string; payload: unknown };

/** Janelas de mentira: anotam o que receberam e quando foram trazidas à frente. O relógio da vez da verificação é o do teste (`clock.now`). */
function setup() {
  const clock = { now: 1_000_000 };
  const sent: Sent[] = [];
  const focused: number[] = [];
  const created: { at: unknown; source: Rect | null }[] = [];
  const logs: string[] = [];

  function fakeWindow(id: number, bounds: Rect = { x: 0, y: 0, width: 1000, height: 800 }): HubWindow {
    return { id, send: (channel, payload) => void sent.push({ to: id, channel, payload }), bounds: () => bounds, focus: () => void focused.push(id) };
  }

  let nextId = 10;
  const hub = createWindowHub({
    createWindow(placement) {
      created.push(placement);
      return fakeWindow(nextId++, { x: 2000, y: 0, width: 1000, height: 800 });
    },
    log: (message) => void logs.push(message),
    now: () => clock.now,
  });

  return { hub, sent, focused, created, logs, fakeWindow, clock };
}

describe("o processo principal e as janelas (RN-ABAS-002 a 005)", () => {
  it("'Mover para nova janela' cria a janela (só aqui, RN-ABAS-005) e entrega a aba quando a área de trabalho dela fica pronta", () => {
    const { hub, sent, created, fakeWindow } = setup();
    hub.add(fakeWindow(1, { x: 50, y: 60, width: 1200, height: 900 }));

    expect(hub.moveTab(1, { target: { kind: "new" }, transfer })).toEqual({ ok: true });
    expect(created).toEqual([{ at: null, source: { x: 50, y: 60, width: 1200, height: 900 } }]);
    // A janela nova ainda está abrindo (o cofre, as rotas): nada lhe é mandado antes.
    expect(sent).toEqual([]);

    hub.setReady(10, true);
    expect(sent).toEqual([{ to: 10, channel: "prism:windows-tab", payload: { transfer } }]);
  });

  it("solta fora de todas as janelas, abre uma onde foi solta; solta em cima de outra janela do Prism, não sai por aqui (quem a leva é o pedido da faixa de lá)", () => {
    const { hub, sent, created, fakeWindow } = setup();
    hub.add(fakeWindow(1, { x: 0, y: 0, width: 1000, height: 800 }));
    hub.add(fakeWindow(2, { x: 1200, y: 0, width: 600, height: 600 }));
    hub.setReady(2, true);

    expect(hub.moveTab(1, { target: { kind: "new", at: { x: 1500, y: 300 } }, transfer })).toEqual({ ok: false, reason: "overWindow" });
    expect(created).toEqual([]);
    expect(sent).toEqual([]);

    expect(hub.moveTab(1, { target: { kind: "new", at: { x: 400, y: 1200 } }, transfer })).toEqual({ ok: true });
    expect(created.map((placement) => placement.at)).toEqual([{ x: 400, y: 1200 }]);
  });

  it("'Mover para a janela…' entrega na outra janela, na posição pedida, e a traz à frente; para si mesma ou para uma janela que fechou, recusa", () => {
    const { hub, sent, focused, fakeWindow } = setup();
    hub.add(fakeWindow(1));
    hub.add(fakeWindow(2));
    hub.setReady(2, true);

    expect(hub.moveTab(1, { target: { kind: "window", windowId: 2, index: 0 }, transfer })).toEqual({ ok: true });
    expect(sent).toEqual([{ to: 2, channel: "prism:windows-tab", payload: { transfer, index: 0 } }]);
    expect(focused).toEqual([2]);

    expect(hub.moveTab(1, { target: { kind: "window", windowId: 1 }, transfer })).toEqual({ ok: false, reason: "noWindow" });
    expect(hub.moveTab(1, { target: { kind: "window", windowId: 7 }, transfer })).toEqual({ ok: false, reason: "noWindow" });
  });

  it("confere o que a tela mandou antes de repassar: o pedido fora do formato não sai daqui", () => {
    const { hub, sent, created, fakeWindow } = setup();
    hub.add(fakeWindow(1));
    hub.add(fakeWindow(2));
    hub.setReady(2, true);

    expect(hub.moveTab(1, { target: { kind: "window", windowId: 2 }, transfer: { ...transfer, tab: { ...transfer.tab, id: "não é uuid" } } })).toEqual({ ok: false, reason: "invalid" });
    expect(hub.moveTab(1, { target: { kind: "new", at: { x: "10", y: 0 } }, transfer })).toEqual({ ok: false, reason: "invalid" });
    expect(hub.moveTab(1, "aba")).toEqual({ ok: false, reason: "invalid" });
    // De uma janela que o processo principal não conhece, também não.
    expect(hub.moveTab(99, { target: { kind: "new" }, transfer })).toEqual({ ok: false, reason: "invalid" });
    expect(sent).toEqual([]);
    expect(created).toEqual([]);
  });

  it("a janela que deixa de estar pronta (saiu do cofre) guarda a entrega até voltar a estar", () => {
    const { hub, sent, fakeWindow } = setup();
    hub.add(fakeWindow(1));
    hub.add(fakeWindow(2));
    hub.setReady(2, true);
    hub.setReady(2, false);

    hub.moveTab(1, { target: { kind: "window", windowId: 2 }, transfer });
    expect(sent).toEqual([]);

    hub.setReady(2, true);
    expect(sent).toHaveLength(1);
    // A segunda vez que fica pronta não reentrega.
    hub.setReady(2, true);
    expect(sent).toHaveLength(1);
  });

  it("a janela que fecha antes de receber devolve a aba à janela de onde ela veio", () => {
    const { hub, sent, fakeWindow } = setup();
    hub.add(fakeWindow(1));
    hub.setReady(1, true);
    hub.moveTab(1, { target: { kind: "new" }, transfer });

    hub.remove(10);
    expect(sent).toEqual([{ to: 1, channel: "prism:windows-tab", payload: { transfer } }]);
  });

  it("a aba solta na faixa de outra janela: o processo principal pede à janela de origem que a mande, e só a ela", () => {
    const { hub, sent, fakeWindow } = setup();
    hub.add(fakeWindow(1));
    hub.add(fakeWindow(2));
    hub.add(fakeWindow(3));

    expect(hub.requestTab(2, { fromWindowId: 1, tabId: transfer.tab.id, index: 1 })).toBe(true);
    expect(sent).toEqual([{ to: 1, channel: "prism:windows-give-tab", payload: { tabId: transfer.tab.id, target: { kind: "window", windowId: 2, index: 1 } } }]);

    expect(hub.requestTab(2, { fromWindowId: 2, tabId: transfer.tab.id, index: 0 })).toBe(false);
    expect(hub.requestTab(2, { fromWindowId: 8, tabId: transfer.tab.id, index: 0 })).toBe(false);
    expect(hub.requestTab(2, { fromWindowId: 1, tabId: "x", index: 0 })).toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("'Mover para a janela…' lista as OUTRAS janelas, na ordem em que abriram, com o número e o resumo que cada uma deu", () => {
    const { hub, fakeWindow } = setup();
    hub.add(fakeWindow(1));
    hub.add(fakeWindow(2));
    hub.add(fakeWindow(3));
    hub.describe(3, { activeTitle: "public.pedido", tabCount: 2 });
    hub.describe(2, { activeTitle: 4, tabCount: -1 });

    expect(hub.list(1)).toEqual([
      { id: 2, number: 2, activeTitle: null, tabCount: 0 },
      { id: 3, number: 3, activeTitle: "public.pedido", tabCount: 2 },
    ]);
    hub.remove(2);
    expect(hub.list(1).map((entry) => entry.number)).toEqual([3]);
  });

  it("o que uma janela conta do cofre vai a TODAS as outras, prontas ou não (a do login também entra), e o que não é um aviso não vai", () => {
    const { hub, sent, fakeWindow } = setup();
    hub.add(fakeWindow(1));
    hub.add(fakeWindow(2));
    hub.add(fakeWindow(3));
    hub.setReady(2, true);

    hub.share(1, { kind: "lock" });
    hub.share(1, { kind: "reiniciar" });
    hub.share(1, "lock");
    expect(sent).toEqual([
      { to: 2, channel: "prism:session-peer", payload: { kind: "lock" } },
      { to: 3, channel: "prism:session-peer", payload: { kind: "lock" } },
    ]);
  });

  it("a última janela (RN-ABAS-007: fechá-la fecha o app) é a única que o centro tem", () => {
    const { hub, fakeWindow } = setup();
    hub.add(fakeWindow(1));
    expect(hub.isLast(1)).toBe(true);

    hub.add(fakeWindow(2));
    expect(hub.isLast(1)).toBe(false);
    expect(hub.isLast(2)).toBe(false);

    hub.remove(1);
    expect(hub.isLast(2)).toBe(true);
    expect(hub.isLast(1)).toBe(false);
  });

  it("pronta é só o que a tela disse com um booleano", () => {
    const { hub, fakeWindow } = setup();
    hub.add(fakeWindow(1));
    hub.setReady(1, "sim");
    expect(hub.isReady(1)).toBe(false);
    hub.setReady(1, true);
    expect(hub.isReady(1)).toBe(true);
    expect(hub.isReady(5)).toBe(false);
  });
});

describe("newWindowBounds: onde a janela nova abre", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

  it("solta, a janela abre com a faixa de abas sob o ponteiro, do tamanho da janela de origem", () => {
    expect(newWindowBounds({ at: { x: 1000, y: 300 }, source: { x: 0, y: 0, width: 1200, height: 800 }, workArea })).toEqual({ x: 640, y: 220, width: 1200, height: 800 });
  });

  it("pelo menu, ela abre um pouco abaixo e à direita da de origem", () => {
    expect(newWindowBounds({ at: null, source: { x: 100, y: 50, width: 1200, height: 800 }, workArea })).toEqual({ x: 132, y: 82, width: 1200, height: 800 });
  });

  it("não sai da área útil da tela: perto da borda, ela encosta; maior que a tela, fica do tamanho dela", () => {
    expect(newWindowBounds({ at: { x: 1900, y: 1030 }, source: { x: 0, y: 0, width: 1200, height: 800 }, workArea })).toEqual({ x: 720, y: 240, width: 1200, height: 800 });
    expect(newWindowBounds({ at: { x: 10, y: 5 }, source: { x: 0, y: 0, width: 1200, height: 800 }, workArea: { x: 1920, y: 0, width: 1280, height: 700 } })).toEqual({ x: 1920, y: 0, width: 1200, height: 700 });
  });
});

describe("a vez da verificação periódica entre as janelas (RN-VERIF-002)", () => {
  const ok = { status: "ok", checkedAt: "2026-10-15T14:32:05Z", elapsedMs: 3, message: null, sqlState: null } as const;
  const claim = (intervalMs = 30_000) => ({ connectionId: "c-1", intervalMs });

  function twoWindows() {
    const run = setup();
    run.hub.add(run.fakeWindow(1));
    run.hub.add(run.fakeWindow(2));
    run.hub.add(run.fakeWindow(3));
    run.hub.setReady(1, true);
    run.hub.setReady(2, true);
    return run;
  }

  it("uma janela por vez verifica a mesma conexão: enquanto a 1 verifica, a 2 não ganha a vez; outra conexão é outra vez", () => {
    const { hub } = twoWindows();

    expect(hub.claimVerification(1, claim())).toBe(true);
    expect(hub.claimVerification(2, claim())).toBe(false);
    expect(hub.claimVerification(2, { connectionId: "c-2", intervalMs: 30_000 })).toBe(true);
  });

  it("a resposta vai às outras janelas com a área de trabalho montada (a do login não), e a vez fica livre", () => {
    const { hub, sent } = twoWindows();
    hub.claimVerification(1, claim());
    hub.finishVerification(1, { connectionId: "c-1", result: ok });

    expect(sent).toEqual([{ to: 2, channel: "prism:verification-peer", payload: { connectionId: "c-1", result: ok } }]);
  });

  it("depois da resposta de uma janela, a outra só ganha a vez quando passa o intervalo (menos a folga): o relógio dela recomeça com a resposta", () => {
    const { hub, clock } = twoWindows();
    hub.claimVerification(1, claim());
    hub.finishVerification(1, { connectionId: "c-1", result: ok });

    clock.now += 2;
    expect(hub.claimVerification(2, claim())).toBe(false);
    clock.now += 30_000 - verificationSlackMs - 2;
    expect(hub.claimVerification(2, claim())).toBe(true);
  });

  it("a janela que verificou por último pode verificar de novo: o relógio dela é que conta o intervalo", () => {
    const { hub } = twoWindows();
    hub.claimVerification(1, claim());
    hub.finishVerification(1, { connectionId: "c-1", result: ok });

    expect(hub.claimVerification(1, claim())).toBe(true);
  });

  it("o fim sem resposta (a chamada falhou, ou a conexão desconectou no meio) só solta a vez: nada vai às outras, e elas verificam na vez delas", () => {
    const { hub, sent } = twoWindows();
    hub.claimVerification(1, claim());
    hub.finishVerification(1, { connectionId: "c-1", result: null });

    expect(sent).toEqual([]);
    expect(hub.claimVerification(2, claim())).toBe(true);
  });

  it("a janela que fecha no meio da verificação solta a vez; a que travou a solta depois do prazo", () => {
    const { hub, clock } = twoWindows();
    hub.claimVerification(1, claim());
    hub.remove(1);
    expect(hub.claimVerification(2, claim())).toBe(true);

    expect(hub.claimVerification(3, { connectionId: "c-1", intervalMs: 30_000 })).toBe(false);
    clock.now += verificationClaimTtlMs;
    expect(hub.claimVerification(3, claim())).toBe(true);
  });

  it("o pedido fora do schema, o de uma janela que não existe e o fim de quem não tinha a vez não valem", () => {
    const { hub, sent } = twoWindows();

    expect(hub.claimVerification(1, { connectionId: "c-1", intervalMs: 10 })).toBe(false);
    expect(hub.claimVerification(1, { connectionId: "", intervalMs: 30_000 })).toBe(false);
    expect(hub.claimVerification(9, claim())).toBe(false);
    hub.finishVerification(1, { connectionId: "c-1", result: { ...ok, status: "talvez" } });
    expect(sent).toEqual([]);

    hub.claimVerification(1, claim());
    hub.finishVerification(2, { connectionId: "c-1", result: null });
    expect(hub.claimVerification(2, claim())).toBe(false);
  });
});
