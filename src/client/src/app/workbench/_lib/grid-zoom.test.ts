import { describe, expect, it } from "vitest";

import { gridZoomSteps } from "@/app/settings/_lib/preferences";

import { anchorOf, canZoomIn, canZoomOut, gridMetrics, scrollFor, wheelZoom, zoomIn, zoomLabel, zoomOut } from "./grid-zoom";

describe("os passos do zoom da grade (RN-GRADE-010)", () => {
  it("de 50% a 200%, nos passos pedidos, com 100% no meio", () => {
    expect([...gridZoomSteps]).toEqual([50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200]);
  });

  it("aumentar e diminuir andam um passo; nos limites, ficam", () => {
    expect(zoomIn(100)).toBe(110);
    expect(zoomIn(175)).toBe(200);
    expect(zoomIn(200)).toBe(200);
    expect(zoomOut(100)).toBe(90);
    expect(zoomOut(67)).toBe(50);
    expect(zoomOut(50)).toBe(50);
  });

  it("os botões só valem longe dos limites", () => {
    expect([canZoomIn(200), canZoomIn(175), canZoomOut(50), canZoomOut(67)]).toEqual([false, true, false, true]);
  });

  it("o valor em texto é a porcentagem", () => {
    expect(zoomLabel(100)).toBe("100%");
    expect(zoomLabel(67)).toBe("67%");
  });
});

describe("gridMetrics: o que muda junto com o zoom (texto, linha, número da linha, colunas e espaços)", () => {
  it("em 100% são exatamente as medidas de hoje: linha de 32 px, número da linha em 64 px, as colunas como estão", () => {
    const metrics = gridMetrics(100);

    expect(metrics).toMatchObject({ factor: 1, rowHeight: 32, gutterWidth: 64 });
    expect(metrics.width(173)).toBe(173);
  });

  it("nos outros, tudo na mesma proporção, a linha e as larguras em pixels inteiros (bordas nítidas)", () => {
    expect(gridMetrics(150)).toMatchObject({ factor: 1.5, rowHeight: 48, gutterWidth: 96 });
    expect(gridMetrics(150).width(173)).toBe(260);
    expect(gridMetrics(50)).toMatchObject({ factor: 0.5, rowHeight: 16, gutterWidth: 32 });
    expect(gridMetrics(67)).toMatchObject({ rowHeight: 21, gutterWidth: 43 });
  });

  it("cada passo tem uma altura de linha só dele (a lista virtual nunca confunde dois zooms)", () => {
    const heights = gridZoomSteps.map((zoom) => gridMetrics(zoom).rowHeight);
    expect(new Set(heights).size).toBe(gridZoomSteps.length);
  });
});

describe("trocar o zoom com a grade rolada mantém à vista a mesma linha do topo", () => {
  it("a posição é guardada em linhas (e, na horizontal, em pixels de 100%), e volta na escala do zoom novo", () => {
    // Em 100% a linha 120 está no topo (120 × 32 px); em 150% ela fica a 120 × 48 px.
    const anchor = anchorOf({ top: 120 * 32, left: 300 }, 100);

    expect(anchor).toEqual({ row: 120, left: 300, zoom: 100 });
    expect(scrollFor(anchor, 150)).toEqual({ top: 120 * 48, left: 450 });
    expect(scrollFor(anchor, 50)).toEqual({ top: 120 * 16, left: 150 });
  });

  it("uma linha pela metade continua pela metade, e ir e voltar devolve o mesmo lugar", () => {
    const anchor = anchorOf({ top: 1000, left: 0 }, 125);
    const back = anchorOf(scrollFor(anchor, 75), 75);

    expect(anchor.row).toBe(25);
    expect(scrollFor(back, 125)).toEqual({ top: 1000, left: 0 });
  });
});

describe("wheelZoom: Ctrl+roda do mouse sobre a grade", () => {
  it("um dente da roda (100 px) é um passo: para cima aumenta, para baixo diminui", () => {
    expect(wheelZoom(0, -100, 0)).toEqual({ rest: 0, direction: 1 });
    expect(wheelZoom(0, 100, 0)).toEqual({ rest: 0, direction: -1 });
  });

  it("o gesto de pinça do touchpad (passos miúdos) junta até um passo, em vez de disparar a cada evento", () => {
    let rest = 0;
    const directions: number[] = [];
    for (let index = 0; index < 12; index++) {
      const step = wheelZoom(rest, -10, 0);
      rest = step.rest;
      directions.push(step.direction);
    }

    expect(directions.filter((direction) => direction !== 0)).toEqual([1, 1]);
  });

  it("a roda em linhas (e não em pixels) conta como pixels", () => {
    expect(wheelZoom(0, -3, 1).direction).toBe(1);
  });

  it("trocar de sentido no meio começa a conta de novo", () => {
    expect(wheelZoom(-40, 10, 0)).toEqual({ rest: 10, direction: 0 });
  });
});
