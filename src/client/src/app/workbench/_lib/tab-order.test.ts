import { describe, expect, it } from "vitest";

import { dragKindOf, dragTypeOf, dropIndex, moveTab, readTabDrag, resultTabDragType, shiftTab, tabDragType, tabMoveShortcut, writeTabDrag } from "./tab-order";

const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
const ids = (list: readonly { id: string }[] | null) => list?.map((tab) => tab.id).join("") ?? null;

describe("moveTab: a aba vai para onde a marca de soltar estava (RN-ABAS-001)", () => {
  it("a posição é a da faixa ANTES de a aba sair dela: soltar antes da 'd' põe a 'a' entre a 'c' e a 'd'", () => {
    expect(ids(moveTab(tabs, "a", 3))).toBe("bcad");
    expect(ids(moveTab(tabs, "a", 4))).toBe("bcda");
    expect(ids(moveTab(tabs, "d", 0))).toBe("dabc");
    expect(ids(moveTab(tabs, "c", 1))).toBe("acbd");
  });

  it("soltar no mesmo lugar (antes ou logo depois dela) não muda nada, e devolve nulo", () => {
    expect(moveTab(tabs, "b", 1)).toBeNull();
    expect(moveTab(tabs, "b", 2)).toBeNull();
  });

  it("a aba que não está na faixa e a posição fora dela não mexem em nada", () => {
    expect(moveTab(tabs, "z", 0)).toBeNull();
    expect(ids(moveTab(tabs, "a", 99))).toBe("bcda");
    expect(ids(moveTab(tabs, "d", -5))).toBe("dabc");
  });

  it("não altera a lista recebida e guarda os mesmos objetos", () => {
    const moved = moveTab(tabs, "a", 4);
    expect(ids(tabs)).toBe("abcd");
    expect(moved?.[3]).toBe(tabs[0]);
  });
});

describe("shiftTab: Ctrl+Shift+PageUp e PageDown movem a aba uma posição", () => {
  it("move para a esquerda e para a direita", () => {
    expect(ids(shiftTab(tabs, "b", -1))).toBe("bacd");
    expect(ids(shiftTab(tabs, "b", 1))).toBe("acbd");
  });

  it("nas pontas não dá a volta: fica onde está", () => {
    expect(shiftTab(tabs, "a", -1)).toBeNull();
    expect(shiftTab(tabs, "d", 1)).toBeNull();
    expect(shiftTab(tabs, "z", 1)).toBeNull();
  });
});

describe("dropIndex: onde a aba arrastada entra, pela metade de cada aba", () => {
  const rects = [
    { left: 0, width: 100 },
    { left: 102, width: 80 },
    { left: 184, width: 120 },
  ];

  it("antes da metade da aba entra antes dela; depois da metade, depois", () => {
    expect(dropIndex(rects, 10)).toBe(0);
    expect(dropIndex(rects, 49)).toBe(0);
    expect(dropIndex(rects, 51)).toBe(1);
    expect(dropIndex(rects, 150)).toBe(2);
    expect(dropIndex(rects, 250)).toBe(3);
  });

  it("à esquerda da primeira e à direita da última, nas pontas; sem abas, na primeira posição", () => {
    expect(dropIndex(rects, -40)).toBe(0);
    expect(dropIndex(rects, 900)).toBe(3);
    expect(dropIndex([], 30)).toBe(0);
  });
});

describe("tabMoveShortcut", () => {
  const key = (key: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, ctrlKey: true, metaKey: false, shiftKey: true, altKey: false, ...extra });

  it("Ctrl+Shift+PageUp move para a esquerda e Ctrl+Shift+PageDown para a direita", () => {
    expect(tabMoveShortcut(key("PageUp"))).toBe(-1);
    expect(tabMoveShortcut(key("PageDown"))).toBe(1);
  });

  it("sem o Shift é trocar de aba (o atalho do navegador), sem o Ctrl é rolar a página, e com Alt é outro atalho", () => {
    expect(tabMoveShortcut(key("PageUp", { shiftKey: false }))).toBeNull();
    expect(tabMoveShortcut(key("PageDown", { ctrlKey: false }))).toBeNull();
    expect(tabMoveShortcut(key("PageDown", { altKey: true }))).toBeNull();
    expect(tabMoveShortcut(key("ArrowLeft"))).toBeNull();
  });
});

describe("os tipos do arraste (RN-ABAS-010)", () => {
  it("a aba de consulta e a de tabela levam um tipo, e a aba do resultado, outro; o que não é do Prism não é aba", () => {
    expect(tabDragType).toBe("application/x-prism-tab");
    expect(resultTabDragType).toBe("application/x-prism-result-tab");
    expect(dragKindOf([tabDragType, "chromium/x-drag-id"])).toBe("tab");
    expect(dragKindOf([resultTabDragType])).toBe("result");
    expect(dragKindOf(["text/plain", "Files"])).toBeNull();
    expect(dragKindOf([])).toBeNull();
    expect([dragTypeOf("tab"), dragTypeOf("result")]).toEqual([tabDragType, resultTabDragType]);
  });
});

describe("o dado da aba arrastada (RN-ABAS-003)", () => {
  const tabId = "6f1c1f62-5d2b-4d36-9a37-2f6f0c7a1b10";

  it("diz de que janela e qual aba, e volta igual", () => {
    expect(readTabDrag(writeTabDrag({ windowId: 3, tabId }))).toEqual({ windowId: 3, tabId });
    expect(readTabDrag(writeTabDrag({ windowId: null, tabId }))).toEqual({ windowId: null, tabId });
  });

  it("o que outro programa soltou, ou um dado fora do formato, não é aba", () => {
    expect(readTabDrag("select * from pedido")).toBeNull();
    expect(readTabDrag(JSON.stringify({ windowId: 0, tabId }))).toBeNull();
    expect(readTabDrag(JSON.stringify({ windowId: 2, tabId: "x" }))).toBeNull();
    expect(readTabDrag("")).toBeNull();
  });
});
