import { describe, expect, it } from "vitest";

import { cascadeStep, fitInto, placeResultWindow, sameRect, savedPlace } from "./result-window-place";

const screen1 = { x: 0, y: 0, width: 1920, height: 1040 };
const screen2 = { x: 1920, y: 0, width: 1280, height: 984 };
const base = { remembered: null, drop: null, openerWorkArea: screen1, workAreas: [screen1, screen2], others: [] };

describe("onde a janela do resultado nasce (RN-ABAS-013)", () => {
  it("a primeira abre com 960×600, no centro do monitor da janela da aba", () => {
    expect(placeResultWindow(base)).toEqual({ x: 480, y: 220, width: 960, height: 600 });
    expect(placeResultWindow({ ...base, openerWorkArea: screen2 })).toEqual({ x: 1920 + 160, y: 192, width: 960, height: 600 });
  });

  it("depois abre no tamanho e no lugar lembrados", () => {
    const remembered = { x: 2000, y: 100, width: 700, height: 500, maximized: false };

    expect(placeResultWindow({ ...base, remembered })).toEqual({ x: 2000, y: 100, width: 700, height: 500 });
  });

  it("o lugar lembrado que não fica mais em nenhum monitor vira o tamanho lembrado no centro do monitor da janela da aba", () => {
    const remembered = { x: 5000, y: 3000, width: 700, height: 500, maximized: false };

    expect(placeResultWindow({ ...base, remembered })).toEqual({ x: 610, y: 270, width: 700, height: 500 });
  });

  it("o lugar lembrado que passa da borda do monitor entra pelas bordas, e o maior que o monitor encolhe", () => {
    expect(placeResultWindow({ ...base, remembered: { x: 1700, y: 900, width: 700, height: 500, maximized: false }, workAreas: [screen1] })).toEqual({ x: 1220, y: 540, width: 700, height: 500 });
    expect(placeResultWindow({ ...base, remembered: { x: 0, y: 0, width: 4000, height: 3000, maximized: false } })).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });

  it("levada pelo arraste: o tamanho lembrado, com o canto de cima à esquerda onde a aba foi solta, dentro da área útil daquele monitor", () => {
    const remembered = { x: 10, y: 10, width: 700, height: 500, maximized: false };

    expect(placeResultWindow({ ...base, remembered, drop: { at: { x: 2100, y: 300 }, workArea: screen2 } })).toEqual({ x: 2100, y: 300, width: 700, height: 500 });
    // Solta perto da borda de baixo: a janela entra pela borda.
    expect(placeResultWindow({ ...base, drop: { at: { x: 1000, y: 1000 }, workArea: screen1 } })).toEqual({ x: 960, y: 440, width: 960, height: 600 });
  });

  it("com outra janela do resultado no mesmo lugar, abre 32 px abaixo e à direita dela; em cascata, uma por vez", () => {
    const first = placeResultWindow(base);
    const second = placeResultWindow({ ...base, others: [first] });
    const third = placeResultWindow({ ...base, others: [first, second] });

    expect(second).toEqual({ ...first, x: first.x + cascadeStep, y: first.y + cascadeStep });
    expect(third).toEqual({ ...first, x: first.x + 2 * cascadeStep, y: first.y + 2 * cascadeStep });
  });

  it("a cascata volta ao primeiro lugar quando o deslocamento sairia da área útil", () => {
    const first = { x: 960, y: 440, width: 960, height: 600 };
    const area = { x: 0, y: 0, width: 1920, height: 1040 };

    expect(placeResultWindow({ ...base, openerWorkArea: area, remembered: { ...first, maximized: false }, others: [first] })).toEqual(first);
  });
});

describe("os retângulos", () => {
  it("`fitInto` traz para dentro da área útil, sem sair pelas bordas", () => {
    expect(fitInto({ x: -50, y: -50, width: 100, height: 100 }, screen1)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(fitInto({ x: 1900, y: 1000, width: 100, height: 100 }, screen1)).toEqual({ x: 1820, y: 940, width: 100, height: 100 });
  });

  it("o lugar a gravar é o tamanho sem maximizar, arredondado e nunca abaixo do mínimo", () => {
    expect(savedPlace({ x: 10.4, y: 20.6, width: 700.2, height: 500.7 }, true)).toEqual({ x: 10, y: 21, width: 700, height: 501, maximized: true });
    expect(savedPlace({ x: 0, y: 0, width: 100, height: 100 }, false)).toEqual({ x: 0, y: 0, width: 480, height: 320, maximized: false });
  });

  it("`sameRect` compara os quatro números", () => {
    expect(sameRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 })).toBe(true);
    expect(sameRect({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 })).toBe(false);
  });
});
