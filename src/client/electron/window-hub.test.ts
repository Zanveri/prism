import { describe, expect, it } from "vitest";

import { boundsMatch, createWindowHub, dragClaimWaitMs, newWindowBounds, verificationClaimTtlMs, verificationSlackMs, type HubWindow, type Point, type Rect, type WindowHubDeps } from "./window-hub";
import type { TabTransfer } from "./window-messages";

const transfer: TabTransfer = {
  version: 1,
  tab: { id: "6f1c1f62-5d2b-4d36-9a37-2f6f0c7a1b10", title: "consulta-1.sql", connectionId: "c-1", sessionId: "s-1", sql: "select 1" },
  editor: { anchor: 8, head: 8 },
  result: null,
  memory: {},
};

type Sent = { to: number; channel: string; payload: unknown };

/**
 * Janelas de mentira: anotam o que receberam e quando foram trazidas à frente. O relógio da vez da verificação é o do teste (`clock.now`); o ponteiro
 * (`pointer.at`) e a espera pela outra janela (`waits`, que a prova solta) também.
 */
function setup(over: Partial<WindowHubDeps> = {}) {
  const clock = { now: 1_000_000 };
  const pointer: { at: Point | null } = { at: null };
  const sent: Sent[] = [];
  const focused: number[] = [];
  const created: { at: unknown; source: Rect | null }[] = [];
  const logs: string[] = [];
  const waits: { ms: number; release: () => void }[] = [];

  function fakeWindow(id: number, bounds: Rect = { x: 0, y: 0, width: 1000, height: 800 }, normal: Rect = bounds): HubWindow {
    return { id, send: (channel, payload) => void sent.push({ to: id, channel, payload }), bounds: () => bounds, normalBounds: () => normal, focus: () => void focused.push(id) };
  }

  let nextId = 10;
  const hub = createWindowHub({
    createWindow(placement) {
      created.push(placement);
      return fakeWindow(nextId++, { x: 2000, y: 0, width: 1000, height: 800 });
    },
    log: (message) => void logs.push(message),
    now: () => clock.now,
    cursorPoint: () => pointer.at,
    wait: (ms) => new Promise<void>((release) => void waits.push({ ms, release })),
    ...over,
  });

  return { hub, sent, focused, created, logs, fakeWindow, clock, pointer, waits };
}

/** Deixa a promessa andar até onde ela espera (a espera de mentira, que a prova solta). */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it("a janela nova com o ponto do fim do arraste abre ali, do tamanho da de origem SEM maximizar (RN-ABAS-010)", () => {
    const { hub, created, fakeWindow } = setup();
    hub.add(fakeWindow(1, { x: 0, y: 0, width: 1920, height: 1040 }, { x: 80, y: 60, width: 1280, height: 800 }));

    expect(hub.moveTab(1, { target: { kind: "new", at: { x: 400, y: 1200 } }, transfer })).toEqual({ ok: true });
    expect(created).toEqual([{ at: { x: 400, y: 1200 }, source: { x: 80, y: 60, width: 1280, height: 800 } }]);
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

describe("newWindowBounds: onde a janela nova abre (RN-ABAS-002 e 010)", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

  it("solta, a janela abre com o canto de cima à esquerda onde a aba foi solta, do tamanho da janela de origem", () => {
    expect(newWindowBounds({ at: { x: 300, y: 150 }, source: { x: 0, y: 0, width: 1200, height: 800 }, workArea })).toEqual({ x: 300, y: 150, width: 1200, height: 800 });
  });

  it("pelo menu, ela abre um pouco abaixo e à direita da de origem", () => {
    expect(newWindowBounds({ at: null, source: { x: 100, y: 50, width: 1200, height: 800 }, workArea })).toEqual({ x: 132, y: 82, width: 1200, height: 800 });
  });

  it("não sai da área útil do monitor do ponto (outro monitor também): perto da borda, ela encosta; maior que ela, diminui até caber", () => {
    expect(newWindowBounds({ at: { x: 1900, y: 1030 }, source: { x: 0, y: 0, width: 1200, height: 800 }, workArea })).toEqual({ x: 720, y: 240, width: 1200, height: 800 });
    expect(newWindowBounds({ at: { x: 2000, y: 5 }, source: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 1920, y: 0, width: 1280, height: 760 } })).toEqual({ x: 1920, y: 0, width: 1280, height: 760 });
    expect(newWindowBounds({ at: { x: -1500, y: -200 }, source: { x: 0, y: 0, width: 1200, height: 800 }, workArea: { x: -1920, y: -300, width: 1920, height: 1080 } })).toEqual({ x: -1500, y: -200, width: 1200, height: 800 });
  });

  it("sem passar do mínimo de 1024×700: num monitor menor, ela fica no mínimo, encostada no canto da área útil", () => {
    expect(newWindowBounds({ at: { x: 500, y: 300 }, source: { x: 0, y: 0, width: 1440, height: 900 }, workArea: { x: 0, y: 0, width: 800, height: 600 } })).toEqual({ x: 0, y: 0, width: 1024, height: 700 });
  });

  it("boundsMatch: o tamanho e o lugar que a janela pediu e os que ela tem, com um pixel de folga do arredondamento das escalas", () => {
    const asked = { x: 300, y: 150, width: 1200, height: 800 };
    expect(boundsMatch(asked, { x: 301, y: 149, width: 1201, height: 800 })).toBe(true);
    expect(boundsMatch(asked, { x: 300, y: 150, width: 1500, height: 1000 })).toBe(false);
    expect(boundsMatch(asked, { x: 600, y: 150, width: 1200, height: 800 })).toBe(false);
  });
});

describe("o fim do arraste da aba (RN-ABAS-010)", () => {
  const tabId = transfer.tab.id;
  const end = (over: Record<string, unknown> = {}) => ({ tabId, kind: "tab", dropped: "none", effect: "move", at: { x: 5, y: 5 }, inPage: false, ...over });

  function twoWindows(over: Partial<WindowHubDeps> = {}) {
    const harness = setup(over);
    harness.hub.add(harness.fakeWindow(1, { x: 0, y: 0, width: 1000, height: 800 }));
    harness.hub.add(harness.fakeWindow(2, { x: 1200, y: 0, width: 600, height: 600 }));
    return harness;
  }

  it("o véu desta janela recebeu a soltura (dentro dela, longe da faixa): a janela nova, no ponteiro que o processo principal lê, sem esperar ninguém", async () => {
    const { hub, pointer, waits } = twoWindows();
    pointer.at = { x: 420, y: 330 };

    await expect(hub.endDrag(1, end({ dropped: "veil", at: { x: 1, y: 1 } }))).resolves.toEqual({ action: "newWindow", at: { x: 420, y: 330 } });
    expect(waits).toEqual([]);
  });

  it("ninguém aqui recebeu, e o ponteiro está dentro desta janela (o Esc, a barra de título) ou sobre outra janela do Prism (ela decide): nada", async () => {
    const { hub, pointer } = twoWindows();
    pointer.at = { x: 500, y: 10 };
    await expect(hub.endDrag(1, end())).resolves.toEqual({ action: "none" });
    pointer.at = { x: 1500, y: 300 };
    await expect(hub.endDrag(1, end())).resolves.toEqual({ action: "none" });
  });

  it("fora das janelas do Prism: espera a outra janela dizer que recebeu a aba; sem isso, a janela nova no ponteiro", async () => {
    const { hub, pointer, waits } = twoWindows();
    pointer.at = { x: 1300, y: 900 };

    const ending = hub.endDrag(1, end());
    await settle();
    expect(waits.map((entry) => entry.ms)).toEqual([dragClaimWaitMs]);
    waits[0].release();
    await expect(ending).resolves.toEqual({ action: "newWindow", at: { x: 1300, y: 900 } });
  });

  it("a outra janela pediu a aba pela soltura (RN-ABAS-003), antes ou durante a espera: a janela nova não abre", async () => {
    const { hub, pointer, waits } = twoWindows();
    pointer.at = { x: 1300, y: 900 };

    // O pedido que chegou antes do fim do arraste (a soltura vem antes do `dragend`): nem espera.
    hub.requestTab(2, { fromWindowId: 1, tabId, index: 0 });
    await expect(hub.endDrag(1, end())).resolves.toEqual({ action: "none" });
    expect(waits).toEqual([]);

    // O que chegou durante a espera.
    const ending = hub.endDrag(1, end());
    await settle();
    hub.requestTab(2, { fromWindowId: 1, tabId, index: 3 });
    waits[0].release();
    await expect(ending).resolves.toEqual({ action: "none" });
  });

  it("o pedido de outro arraste, há mais de 2 s, não conta; o de outra aba também não", async () => {
    const { hub, pointer, waits, clock } = twoWindows();
    pointer.at = { x: 1300, y: 900 };
    hub.requestTab(2, { fromWindowId: 1, tabId, index: 0 });
    clock.now += 2_001;

    const ending = hub.endDrag(1, end());
    await settle();
    hub.requestTab(2, { fromWindowId: 1, tabId: "11111111-1111-4111-8111-111111111111", index: 0 });
    waits[0].release();
    await expect(ending).resolves.toEqual({ action: "newWindow", at: { x: 1300, y: 900 } });
  });

  it("onde o Esc termina sem efeito (o X11, `escapeEndsWithoutEffect`), o `dropEffect` `none` fora das janelas é o Esc: nada; nas outras plataformas, vale como a soltura", async () => {
    const x11 = twoWindows({ escapeEndsWithoutEffect: true });
    x11.pointer.at = { x: 1300, y: 900 };
    await expect(x11.hub.endDrag(1, end({ effect: "none" }))).resolves.toEqual({ action: "none" });

    const other = twoWindows();
    other.pointer.at = { x: 1300, y: 900 };
    const ending = other.hub.endDrag(1, end({ effect: "none" }));
    await settle();
    other.waits[0].release();
    await expect(ending).resolves.toEqual({ action: "newWindow", at: { x: 1300, y: 900 } });
  });

  it("a aba do resultado nenhuma outra janela recebe: fora das janelas do Prism, a janela dela na hora; sobre outra janela do Prism, nada", async () => {
    const { hub, pointer, waits } = twoWindows();
    pointer.at = { x: 1300, y: 900 };
    await expect(hub.endDrag(1, end({ kind: "result" }))).resolves.toEqual({ action: "newWindow", at: { x: 1300, y: 900 } });
    pointer.at = { x: 1500, y: 300 };
    await expect(hub.endDrag(1, end({ kind: "result" }))).resolves.toEqual({ action: "none" });
    expect(waits).toEqual([]);
  });

  it("sem o ponteiro (o Wayland): vale o ponto do `dragend`, sem ponto a janela abre ao lado da de origem, e o `dragend` dentro da página não abre nada", async () => {
    const { hub, waits } = twoWindows({ cursorPoint: () => null });

    await expect(hub.endDrag(1, end({ dropped: "veil", at: { x: 40, y: 60 } }))).resolves.toEqual({ action: "newWindow", at: { x: 40, y: 60 } });
    await expect(hub.endDrag(1, end({ dropped: "veil", at: null }))).resolves.toEqual({ action: "newWindow", at: null });
    await expect(hub.endDrag(1, end({ inPage: true }))).resolves.toEqual({ action: "none" });

    const ending = hub.endDrag(1, end({ at: { x: 3000, y: 50 } }));
    await settle();
    waits[0].release();
    await expect(ending).resolves.toEqual({ action: "newWindow", at: { x: 3000, y: 50 } });
  });

  it("o pedido fora do schema, ou de uma janela que o centro não conhece, não abre nada", async () => {
    const { hub, pointer } = twoWindows();
    pointer.at = { x: 1300, y: 900 };
    await expect(hub.endDrag(1, end({ tabId: "x" }))).resolves.toEqual({ action: "none" });
    await expect(hub.endDrag(1, end({ dropped: "strip" }))).resolves.toEqual({ action: "none" });
    await expect(hub.endDrag(1, "fim")).resolves.toEqual({ action: "none" });
    await expect(hub.endDrag(9, end({ dropped: "veil" }))).resolves.toEqual({ action: "none" });
  });

  it("a janela de origem que fecha durante a espera não abre a janela nova", async () => {
    const { hub, pointer, waits } = twoWindows();
    pointer.at = { x: 1300, y: 900 };
    const ending = hub.endDrag(1, end());
    await settle();
    hub.remove(1);
    waits[0].release();
    await expect(ending).resolves.toEqual({ action: "none" });
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
