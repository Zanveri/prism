import { describe, expect, it, vi } from "vitest";

import { createTabDragSession, dragEndRequest, isOnlyTab, veilFor, type DragEndEvent } from "./tab-drag";

const tabId = "6f1c1f62-5d2b-4d36-9a37-2f6f0c7a1b10";
const outside: DragEndEvent = { effect: "none", screen: { x: 1700.4, y: 820.6 }, client: { x: 1500, y: 790 }, viewport: { width: 1200, height: 800 } };
const inside: DragEndEvent = { effect: "move", screen: { x: 400, y: 300 }, client: { x: 300, y: 260 }, viewport: { width: 1200, height: 800 } };

describe("o arraste que começou nesta janela (RN-ABAS-010)", () => {
  it("nada muda na página no dragstart: a sessão guarda o arraste na hora e só avisa depois", () => {
    const later: (() => void)[] = [];
    const session = createTabDragSession((run) => later.push(run));
    const listener = vi.fn();
    session.subscribe(listener);

    session.begin(tabId, "tab");
    expect(session.dragging()).toEqual({ tabId, kind: "tab" });
    expect(session.getSnapshot()).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    later.forEach((run) => run());
    expect(session.getSnapshot()).toEqual({ tabId, kind: "tab" });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("quem recebeu a soltura (a faixa ou o véu) marca, e o fim do arraste lê a marca e esquece o arraste", () => {
    const session = createTabDragSession(() => {});
    session.begin(tabId, "tab");
    session.mark("veil");

    expect(session.finish()).toEqual({ tabId, kind: "tab", dropped: "veil" });
    expect(session.dragging()).toBeNull();
    expect(session.finish()).toBeNull();

    session.begin(tabId, "result");
    expect(session.finish()).toEqual({ tabId, kind: "result", dropped: null });
  });

  it("o que tiraria a aba arrastada da página espera o fim do arraste; sem arraste dela, roda na hora", () => {
    const session = createTabDragSession(() => {});
    const detach = vi.fn();
    const other = vi.fn();

    session.begin(tabId, "tab");
    session.whenIdle(tabId, detach);
    session.whenIdle("outra", other);
    expect(detach).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledOnce();

    session.finish();
    expect(detach).toHaveBeenCalledOnce();
    session.whenIdle(tabId, detach);
    expect(detach).toHaveBeenCalledTimes(2);
  });
});

describe("o véu (RN-ABAS-010 e 003)", () => {
  it("a aba desta janela abre numa janela nova; com uma aba só, a janela já é ela, e a soltura não vale", () => {
    expect(veilFor({ kind: "tab", fromHere: true, onlyTab: false })).toEqual({ text: "Solte para abrir numa janela nova", accepts: true });
    expect(veilFor({ kind: "tab", fromHere: true, onlyTab: true })).toEqual({ text: "Esta já é a única aba da janela.", accepts: false });
  });

  it("a aba de outra janela vem para esta (também na janela sem abas); a aba do resultado só vai para a janela dela", () => {
    expect(veilFor({ kind: "tab", fromHere: false, onlyTab: true })).toEqual({ text: "Solte para trazer a aba para esta janela", accepts: true });
    expect(veilFor({ kind: "result", fromHere: true, onlyTab: true })).toEqual({ text: "Solte para abrir o resultado numa janela", accepts: true });
    expect(veilFor({ kind: "result", fromHere: false, onlyTab: false })).toBeNull();
  });

  it("fora do app (no navegador do desenvolvimento) não há véu", () => {
    expect(veilFor({ kind: "tab", fromHere: true, onlyTab: false, available: false })).toBeNull();
  });

  it("uma aba só: a aba e a do resultado dela contam como uma", () => {
    expect(isOnlyTab([])).toBe(true);
    expect(isOnlyTab([{}])).toBe(true);
    expect(isOnlyTab([{}, {}])).toBe(false);
  });
});

describe("o fim do arraste: o que se pede ao processo principal (RN-ABAS-010)", () => {
  const ended = (dropped: "strip" | "veil" | null, kind: "tab" | "result" = "tab") => ({ tabId, kind, dropped });

  it("a soltura no véu desta janela pede a janela nova; a de ninguém daqui, a decisão pelo ponteiro", () => {
    expect(dragEndRequest(ended("veil"), inside, { windowId: 1, onlyTab: false })).toEqual({ tabId, kind: "tab", dropped: "veil", effect: "move", at: { x: 400, y: 300 }, inPage: true });
    expect(dragEndRequest(ended(null), outside, { windowId: 1, onlyTab: false })).toEqual({ tabId, kind: "tab", dropped: "none", effect: "none", at: { x: 1700, y: 821 }, inPage: false });
  });

  it("a soltura na própria faixa, fora do Electron, sem arraste e com uma aba só (a de consulta), nada se pede", () => {
    expect(dragEndRequest(ended("strip"), inside, { windowId: 1, onlyTab: false })).toBeNull();
    expect(dragEndRequest(ended("veil"), inside, { windowId: null, onlyTab: false })).toBeNull();
    expect(dragEndRequest(null, inside, { windowId: 1, onlyTab: false })).toBeNull();
    expect(dragEndRequest(ended(null), outside, { windowId: 1, onlyTab: true })).toBeNull();
  });

  it("a aba do resultado vai para a janela dela também com uma aba só na janela", () => {
    expect(dragEndRequest(ended(null, "result"), outside, { windowId: 1, onlyTab: true })).toMatchObject({ kind: "result", dropped: "none" });
  });

  it("o ponto que não é número não vai; o que passa do limite é trazido para dentro; o efeito desconhecido é `none`", () => {
    const weird: DragEndEvent = { effect: "uninitialized", screen: { x: Number.NaN, y: 3 }, client: { x: -1, y: 10 }, viewport: { width: 100, height: 100 } };
    expect(dragEndRequest(ended(null), weird, { windowId: 1, onlyTab: false })).toMatchObject({ effect: "none", at: null, inPage: false });
    expect(dragEndRequest(ended(null), { ...inside, screen: { x: 500_000, y: -500_000 } }, { windowId: 1, onlyTab: false })?.at).toEqual({ x: 100_000, y: -100_000 });
  });
});
