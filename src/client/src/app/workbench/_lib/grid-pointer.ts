/**
 * O arraste na grade (RN-GRADE-001), sem DOM: que célula está sob o ponteiro, também fora da caixa da grade (o arraste continua com o botão preso), e quanto
 * rolar quando o ponteiro passa da borda. Quem lê o evento e a caixa é `result-grid.tsx`.
 */

/** A caixa que rola: onde ela está na janela, quanto rolou, e as medidas da grade no zoom (a linha, o cabeçalho preso no topo e o número da linha à esquerda). */
export type GridBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  scrollLeft: number;
  scrollTop: number;
  rowHeight: number;
  gutterWidth: number;
};

/** Onde começa cada coluna, sem o número da linha, e a largura de todas: a soma das larguras desenhadas. */
export function columnStarts(widths: readonly number[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const width of widths) {
    starts.push(at);
    at += width;
  }
  return starts;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * A célula sob o ponteiro. Fora da caixa, a da borda mais perto: arrastar para baixo da grade escolhe até a última linha à vista, e a rolagem sozinha
 * (`edgeScroll`) traz as seguintes. O cabeçalho e o número da linha, presos, cobrem o que rola por baixo deles: ali vale a primeira linha e a primeira coluna à
 * vista. Nula na grade sem linhas ou sem colunas.
 */
export function cellAtPoint(point: { x: number; y: number }, box: GridBox, starts: readonly number[], widths: readonly number[], rows: number): { row: number; column: number } | null {
  if (rows === 0 || widths.length === 0) return null;
  const y = clamp(point.y, box.top + box.rowHeight, box.top + box.height - 1) - box.top + box.scrollTop - box.rowHeight;
  const x = clamp(point.x, box.left + box.gutterWidth, box.left + box.width - 1) - box.left + box.scrollLeft - box.gutterWidth;
  const row = clamp(Math.floor(y / box.rowHeight), 0, rows - 1);

  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle] <= x) low = middle;
    else high = middle - 1;
  }
  return { row, column: clamp(low, 0, widths.length - 1) };
}

/** O passo da rolagem sozinha, por tique: mais rápido quanto mais longe da borda, até um teto. */
const maxStep = 40;

/**
 * Quanto a grade rola sozinha, a cada tique do arraste, com o ponteiro passado da borda (RN-GRADE-001): para cima com ele acima da área das linhas (o
 * cabeçalho também é borda), para baixo com ele abaixo, e o mesmo na horizontal (o número da linha é a borda da esquerda). Dentro, nada.
 */
export function edgeScroll(point: { x: number; y: number }, box: GridBox, vertical = true, horizontal = true): { dx: number; dy: number } {
  const step = (distance: number) => Math.sign(distance) * Math.min(Math.ceil(Math.abs(distance) / 2), maxStep);
  const top = box.top + box.rowHeight;
  const bottom = box.top + box.height;
  const left = box.left + box.gutterWidth;
  const right = box.left + box.width;
  const dy = !vertical ? 0 : point.y < top ? step(point.y - top) : point.y > bottom ? step(point.y - bottom) : 0;
  const dx = !horizontal ? 0 : point.x < left ? step(point.x - left) : point.x > right ? step(point.x - right) : 0;
  return { dx, dy };
}

/** PageUp e PageDown andam uma altura da área à vista (RN-GRADE-001): as linhas que cabem abaixo do cabeçalho, ao menos uma. */
export function pageRows(box: Pick<GridBox, "height" | "rowHeight">): number {
  return Math.max(Math.floor((box.height - box.rowHeight) / box.rowHeight), 1);
}
