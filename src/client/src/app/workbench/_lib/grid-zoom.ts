import { gridZoomSteps, type GridZoom } from "@/app/settings/_lib/preferences";

/*
 * O zoom da grade do resultado (RN-GRADE-010), em funções puras: os passos, as medidas de cada zoom, a posição que o zoom preserva e a roda do mouse. O zoom
 * é uma preferência do usuário (`results.gridZoom`), a mesma para as duas grades; 100% é exatamente o desenho de antes dele.
 */

/** As medidas do canvas a 100%: a linha (e o cabeçalho) de 32 px e o número da linha em 64 px. */
const baseRowHeight = 32;
const baseGutterWidth = 64;

const smallest = gridZoomSteps[0];
const largest = gridZoomSteps[gridZoomSteps.length - 1];

/** O passo seguinte; no maior, fica. */
export function zoomIn(zoom: GridZoom): GridZoom {
  return gridZoomSteps.find((step) => step > zoom) ?? largest;
}

/** O passo anterior; no menor, fica. */
export function zoomOut(zoom: GridZoom): GridZoom {
  return gridZoomSteps.findLast((step) => step < zoom) ?? smallest;
}

export const canZoomIn = (zoom: GridZoom) => zoom < largest;
export const canZoomOut = (zoom: GridZoom) => zoom > smallest;

export const zoomLabel = (zoom: GridZoom) => `${zoom}%`;

export type GridMetrics = {
  /** O zoom como fator (1,5 para 150%): é o que multiplica o texto e os espaços da grade (`--spacing`). */
  factor: number;
  /** A altura da linha e do cabeçalho, em pixels inteiros: a lista virtual e o CSS usam o mesmo número, e a borda de cada linha cai num pixel. */
  rowHeight: number;
  /** A largura do número da linha. */
  gutterWidth: number;
  /** A largura de uma coluna (a de 100%, contada ou escolhida) neste zoom, em pixels inteiros. */
  width: (base: number) => number;
};

/** As medidas da grade neste zoom. Em 100% são as de antes do zoom existir, número por número. */
export function gridMetrics(zoom: GridZoom): GridMetrics {
  const factor = zoom / 100;
  return { factor, rowHeight: Math.round(baseRowHeight * factor), gutterWidth: Math.round(baseGutterWidth * factor), width: (base) => Math.round(base * factor) };
}

/**
 * O que o zoom preserva da rolagem: a linha que está no topo (em linhas, com a fração da que aparece pela metade) e, na horizontal, a posição em pixels de
 * 100%; com o zoom em que foi lida.
 */
export type ScrollAnchor = { row: number; left: number; zoom: GridZoom };

/** A âncora da rolagem que se lê agora, neste zoom. */
export function anchorOf(scroll: { top: number; left: number }, zoom: GridZoom): ScrollAnchor {
  const metrics = gridMetrics(zoom);
  return { row: scroll.top / metrics.rowHeight, left: scroll.left / metrics.factor, zoom };
}

/** A rolagem que põe a âncora no mesmo lugar, no zoom dado: a mesma linha no topo. */
export function scrollFor(anchor: ScrollAnchor, zoom: GridZoom): { top: number; left: number } {
  const metrics = gridMetrics(zoom);
  return { top: anchor.row * metrics.rowHeight, left: anchor.left * metrics.factor };
}

/** Quanto a roda precisa andar para um passo de zoom: um dente de mouse comum (100 px) é um passo; o touchpad, que manda passos miúdos, junta até lá. */
const wheelThreshold = 50;
/** A roda que conta em linhas ou em páginas (`deltaMode` 1 e 2), em pixels. */
const lineHeight = 40;
const pageHeight = 800;

/**
 * Ctrl+roda do mouse sobre a grade: `rest` é o que sobrou dos eventos anteriores (que ainda não deram um passo), e a resposta diz o que sobra agora e o passo,
 * se houve (1 aumenta: a roda para cima, como no navegador; -1 diminui; 0 nada). Trocar de sentido no meio começa a conta de novo.
 */
export function wheelZoom(rest: number, deltaY: number, deltaMode: number): { rest: number; direction: 1 | -1 | 0 } {
  const pixels = deltaMode === 1 ? deltaY * lineHeight : deltaMode === 2 ? deltaY * pageHeight : deltaY;
  const total = (Math.sign(rest) === Math.sign(pixels) ? rest : 0) + pixels;
  if (Math.abs(total) < wheelThreshold) return { rest: total, direction: 0 };
  return { rest: 0, direction: total < 0 ? 1 : -1 };
}
