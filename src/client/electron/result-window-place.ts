import type { Point, Rect } from "./window-hub";
import { resultWindowFirst, resultWindowMinimum, type SavedResultWindow } from "./result-window-file";

/** O deslocamento da cascata: a janela do resultado que abriria em cima de outra abre tanto abaixo e à direita (RN-ABAS-013). */
export const cascadeStep = 32;

const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));

/** O retângulo trazido para dentro da área útil: encolhe se for maior (sem passar do mínimo, quando a área comporta) e entra pelas bordas. */
export function fitInto(rect: Rect, workArea: Rect): Rect {
  const width = Math.min(rect.width, Math.max(workArea.width, 1));
  const height = Math.min(rect.height, Math.max(workArea.height, 1));
  return { x: clamp(rect.x, workArea.x, workArea.x + workArea.width - width), y: clamp(rect.y, workArea.y, workArea.y + workArea.height - height), width, height };
}

const contains = (rect: Rect, point: Point) => point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;

const centered = (size: { width: number; height: number }, workArea: Rect): Rect =>
  fitInto({ x: workArea.x + Math.round((workArea.width - size.width) / 2), y: workArea.y + Math.round((workArea.height - size.height) / 2), ...size }, workArea);

export type PlaceInput = {
  /** O lugar lembrado (`result-window.json`), se há. */
  remembered: SavedResultWindow | null;
  /** O ponto onde a aba do resultado foi solta (o arraste), com a área útil do monitor dele. Nulo nos outros casos. */
  drop: { at: Point; workArea: Rect } | null;
  /** A área útil do monitor da janela da aba que pede. */
  openerWorkArea: Rect;
  /** As áreas úteis de todos os monitores. */
  workAreas: readonly Rect[];
  /** Onde estão as outras janelas do resultado abertas (as cascatas partem delas). */
  others: readonly Rect[];
};

/**
 * RN-ABAS-013: onde a janela do resultado nasce.
 * - Levada pelo arraste: o tamanho lembrado, com o canto de cima à esquerda onde a aba foi solta, trazida para dentro da área útil daquele monitor.
 * - A primeira: 960×600, no centro do monitor da janela da aba.
 * - Depois: o tamanho e o lugar lembrados. Se o lugar não fica mais em nenhum monitor (o monitor saiu), o tamanho lembrado, trazido para caber, no centro do
 *   monitor da janela da aba.
 * - Com outra janela do resultado aberta no mesmo lugar, 32 px abaixo e à direita dela; a cascata volta ao primeiro lugar quando o deslocamento sairia da
 *   área útil do monitor.
 */
export function placeResultWindow({ remembered, drop, openerWorkArea, workAreas, others }: PlaceInput): Rect {
  const size = remembered === null ? resultWindowFirst : { width: Math.max(remembered.width, resultWindowMinimum.width), height: Math.max(remembered.height, resultWindowMinimum.height) };
  if (drop !== null) return fitInto({ x: drop.at.x, y: drop.at.y, ...size }, drop.workArea);

  // O lugar lembrado vale se a barra de título dele (o canto de cima, um pouco para dentro) ainda está em algum monitor.
  const where = remembered === null ? undefined : workAreas.find((area) => contains(area, { x: remembered.x + 40, y: remembered.y + 20 }));
  const [first, area] = remembered !== null && where !== undefined ? [fitInto({ x: remembered.x, y: remembered.y, ...size }, where), where] : [centered(size, openerWorkArea), openerWorkArea];

  let rect = first;
  while (others.some((other) => other.x === rect.x && other.y === rect.y)) {
    const next = { ...rect, x: rect.x + cascadeStep, y: rect.y + cascadeStep };
    // O deslocamento que sairia da área útil volta ao primeiro lugar.
    if (next.x + next.width > area.x + area.width || next.y + next.height > area.y + area.height) return first;
    rect = next;
  }
  return rect;
}

/** O lugar a gravar: o tamanho de uma janela sem maximizar (`getNormalBounds()`), arredondado, e se estava maximizada. */
export function savedPlace(normal: Rect, maximized: boolean): SavedResultWindow {
  return { x: Math.round(normal.x), y: Math.round(normal.y), width: Math.max(Math.round(normal.width), resultWindowMinimum.width), height: Math.max(Math.round(normal.height), resultWindowMinimum.height), maximized };
}

/** Dois retângulos iguais (a conferência dos limites depois de criada a janela, RN-ABAS-010). */
export const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
