import { describe, expect, it } from "vitest";

import { navigatorDensities } from "@/app/settings/_lib/preferences";

import { actionsWidth, navigatorMetrics, rowIndent } from "./navigator-density";

/** Pixels de uma classe de tamanho do Tailwind: `h-[22px]` é 22, `h-7` e `size-6` são 28 e 24 (a escala é de 4 px). */
const pixelsOf = (className: string) => {
  const arbitrary = /\[(\d+)px\]$/.exec(className);
  return arbitrary !== null ? Number(arbitrary[1]) : Number(/-(\d+)$/.exec(className)?.[1]) * 4;
};

describe("as medidas de cada densidade do navegador (RN-NAV-011)", () => {
  it("a confortável é o desenho do canvas, o de antes da escolha: linha de 30 px, 10 px na raiz e 16 px por nível, botões de 24 px", () => {
    expect(navigatorMetrics.comfortable).toMatchObject({ rowHeight: 30, baseIndent: 10, levelIndent: 16 });
    expect(pixelsOf(navigatorMetrics.comfortable.actionClass)).toBe(24);
  });

  it("a compacta: linha de 22 px e 12 px por nível, na árvore das conexões e na da seção Scripts (RN-SCRIPT-008)", () => {
    expect(navigatorMetrics.compact).toMatchObject({ rowHeight: 22, levelIndent: 12 });
  });

  it("em cada uma, a classe da linha é a mesma altura que a lista virtual estima", () => {
    for (const density of navigatorDensities) expect(pixelsOf(navigatorMetrics[density].rowClass), density).toBe(navigatorMetrics[density].rowHeight);
  });

  it("o que a linha leva cabe nela, sem corte: o texto 13/20, as etiquetas de 18 px, e os botões de ação com o espaço até o vizinho", () => {
    for (const density of navigatorDensities) {
      const metrics = navigatorMetrics[density];
      const action = pixelsOf(metrics.actionClass);

      // A linha do texto 13/20 (RN-CONFIG-009) e a etiqueta do banco e a do ambiente (`h-[18px]`).
      expect(metrics.rowHeight, density).toBeGreaterThanOrEqual(Math.max(20, 18));
      expect(action, density).toBeLessThanOrEqual(metrics.rowHeight);
      expect(metrics.actionStride, density).toBe(action + 2);
    }
  });

  it("a compacta é menor que a confortável em tudo o que dá altura e recuo", () => {
    const { comfortable, compact } = navigatorMetrics;

    expect(compact.rowHeight).toBeLessThan(comfortable.rowHeight);
    expect(compact.levelIndent).toBeLessThan(comfortable.levelIndent);
    expect(compact.baseIndent).toBeLessThanOrEqual(comfortable.baseIndent);
  });
});

describe("rowIndent e actionsWidth", () => {
  it("o recuo é o da raiz mais um por nível", () => {
    expect(rowIndent(navigatorMetrics.comfortable, 0)).toBe(10);
    expect(rowIndent(navigatorMetrics.comfortable, 3)).toBe(58);
    expect(rowIndent(navigatorMetrics.compact, 0)).toBe(6);
    expect(rowIndent(navigatorMetrics.compact, 3)).toBe(42);
  });

  it("os botões de ação ocupam o passo de cada um e a folga da borda; na confortável, a conta de antes (26 por botão e 8)", () => {
    expect(actionsWidth(navigatorMetrics.comfortable, 3)).toBe(3 * 26 + 8);
    expect(actionsWidth(navigatorMetrics.compact, 3)).toBe(3 * 22 + 8);
    expect(actionsWidth(navigatorMetrics.compact, 0)).toBe(8);
  });
});
