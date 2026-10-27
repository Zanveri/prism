/**
 * A cor que a pessoa escolheu para um ícone (a da pasta, RN-PASTA-007, e a do script, RN-SCRIPT-006) e a que a tela pinta. Ícone tem de passar em 3:1
 * sobre as superfícies de todos os temas (RN-CONFIG-003), e as seis cores do canvas são claras, feitas para os temas escuros: o Âmbar sobre o fundo do
 * Prism Claro dá 1,7:1. Quando a escolhida não chega, o ícone leva a variante mais próxima dela que chega: escurecida (misturada ao preto) nos temas
 * claros, clareada (misturada ao branco) nos escuros. A gravada continua a escolhida, e as bolinhas do seletor a mostram como é.
 *
 * A mesma conta pinta também os destaques da área de resultado com a cor do ambiente da aba (RN-AMB-002: sublinhados, contorno da célula ativa, foco e rolagem
 * da grade): contorno é elemento gráfico, com o mesmo 3:1 do ícone (`workbench/_lib/environment-accent.ts`). A etiqueta do ambiente, essa, leva a cor
 * escolhida, como as bolinhas.
 *
 * As duas variantes vão juntas, como `light-dark(clara, escura)` (o mesmo jeito da marca, `prism-mark.tsx`): quem escolhe é o `color-scheme` do tema, o
 * mesmo que escolhe a coluna das fichas de cor no `globals.css`, então trocar de tema (ou o sistema trocar, no "seguir o sistema") não pede JavaScript.
 */

/**
 * As superfícies sobre as quais um ícone aparece (o fundo, o painel, a elevada e a linha selecionada) de todos os temas, separadas pelo esquema de cor:
 * os valores do `globals.css`, e o `icon-color.test.ts` confere que são os mesmos dos tokens. O que passa por cima dessas superfícies com transparência (o
 * `hover:bg-selected/60`) fica entre duas delas, e a cor que passa nas duas passa no meio.
 */
export const iconSurfaces = {
  light: ["#f7f8fa", "#eceff3", "#ffffff", "#e3e8ee", "#f6f8fa", "#ececed"],
  dark: ["#0e1114", "#14181d", "#1b2027", "#232a33", "#272822", "#1e1f1c", "#30312b", "#373832", "#282a36", "#21222c", "#32343f", "#393a45", "#2e3440", "#272c36", "#373d49", "#3d434f", "#1f1f28", "#1a1a22", "#2a2a35", "#2a2a38"],
} as const;

/** RN-CONFIG-003: ícone e texto grande. */
export const iconContrast = 3;

/** Os canais de `#rrggbb`, de 0 a 255. */
const channels = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

/** WCAG 2.x: a luminância relativa, de 0 (preto) a 1 (branco). */
function luminance(rgb: readonly number[]): number {
  const [red, green, blue] = rgb.map((value) => {
    const unit = value / 255;
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const hexOf = (rgb: readonly number[]) => `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * A cor do ícone sobre as superfícies de um esquema: a própria, em maiúsculas, se ela passa em `iconContrast` sobre todas; senão a mistura com o preto
 * (claro) ou com o branco (escuro) com a menor parte que passa, de 1 em 1%. Pura: a mesma cor dá a mesma resposta, e a cor escolhida não muda.
 */
export function readableIconColor(color: string, scheme: keyof typeof iconSurfaces): string {
  const surfaces = iconSurfaces[scheme].map((surface) => luminance(channels(surface)));
  const chosen = channels(color);
  const target = scheme === "light" ? 0 : 255;

  for (let step = 0; step <= 100; step++) {
    const mixed = chosen.map((value) => value + ((target - value) * step) / 100);
    const rounded = mixed.map(Math.round);
    const own = luminance(rounded);
    if (surfaces.every((surface) => ratio(own, surface) >= iconContrast)) return hexOf(rounded);
  }

  return hexOf([target, target, target]);
}

const cache = new Map<string, string>();

/**
 * O valor de `color` do ícone pintado com a cor escolhida (`#RRGGBB`): `light-dark(<variante dos temas claros>, <variante dos escuros>)`. Guardado por
 * cor, porque a mesma cor se repete em cada linha da árvore e a cada desenho. É também o valor da variável `--environment-color` da área de resultado
 * (RN-AMB-002), que um destaque lê com `border-color` ou `outline-color`: o `light-dark()` resolve pelo `color-scheme` do elemento que o usa.
 */
export function iconColorStyle(color: string): string {
  const key = color.toUpperCase();
  let style = cache.get(key);
  if (style === undefined) {
    style = `light-dark(${readableIconColor(key, "light")}, ${readableIconColor(key, "dark")})`;
    cache.set(key, style);
  }
  return style;
}
