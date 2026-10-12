/**
 * WCAG 2.x: a luminância relativa de uma cor `#rrggbb` e a razão de contraste entre duas. Só para testes (o contraste das cores
 * do tema, da marca): 4,5:1 vale para texto e 3:1 para texto grande, ícone e gráfico.
 */
function channel(hex: string, at: number) {
  const value = parseInt(hex.slice(at, at + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

/**
 * A cor de cima, com a opacidade dada (de 0 a 1), sobre a de baixo: o que o navegador pinta com `bg-<tom>/10` sobre uma superfície
 * (a mistura é feita nos canais sRGB, como a composição de transparência). É o fundo real do `FormMessage`.
 */
export function over(top: string, bottom: string, alpha: number): string {
  const mixed = [1, 3, 5].map((at) => Math.round(parseInt(top.slice(at, at + 2), 16) * alpha + parseInt(bottom.slice(at, at + 2), 16) * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}
