import { describe, expect, it } from "vitest";

import { placeTip, tipParts } from "./tooltip";

const view = { width: 1000, height: 800 };
const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe("onde a dica fica", () => {
  it("embaixo do elemento, centrada no botão de ícone", () => {
    expect(placeTip(box(100, 100, 24, 24), { width: 80, height: 26 }, view, 105)).toEqual({ left: 72, top: 130, side: "bottom" });
  });

  it("no elemento largo segue o mouse, e pelo teclado começa com ele", () => {
    const row = box(20, 200, 300, 24);
    expect(placeTip(row, { width: 120, height: 40 }, view, 250).left).toBe(190);
    expect(placeTip(row, { width: 120, height: 40 }, view, null).left).toBe(20);
  });

  it("em cima quando embaixo não cabe, e nunca além da margem da janela", () => {
    expect(placeTip(box(960, 760, 30, 24), { width: 200, height: 60 }, view, 970)).toEqual({ left: 792, top: 694, side: "top" });
    expect(placeTip(box(0, 300, 24, 24), { width: 200, height: 26 }, view, 5).left).toBe(8);
  });

  it("a dica mais alta que os dois lados fica do lado que tem mais lugar, presa na janela", () => {
    expect(placeTip(box(100, 500, 300, 24), { width: 300, height: 700 }, view, 200)).toEqual({ left: 50, top: 8, side: "top" });
  });
});

describe("o texto da dica", () => {
  it("a de várias linhas tem a primeira como título", () => {
    expect(tipParts("MIGRATION USER\nInformix · central:55081\nRespondeu às 12:26:48", false)).toEqual({ head: "MIGRATION USER", body: "Informix · central:55081\nRespondeu às 12:26:48" });
  });

  it("a de uma linha, e o valor da célula, vão inteiros", () => {
    expect(tipParts("Fechar (Ctrl+W)", false)).toEqual({ head: null, body: "Fechar (Ctrl+W)" });
    expect(tipParts("CURRENTLY DEFINED\n----", true)).toEqual({ head: null, body: "CURRENTLY DEFINED\n----" });
  });
});
