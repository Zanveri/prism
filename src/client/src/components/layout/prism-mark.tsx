import { createElement, useId, type ComponentProps, type CSSProperties, type ReactNode } from "react";

import darkSource from "@assets/prism-logo.svg?raw";
import lightSource from "@assets/prism-logo-light.svg?raw";
import { cn } from "@/lib/utils/cn";

import { parseSvg, type SvgNode } from "./svg-tree";

/**
 * As cores da marca que mudam com o tema (RN-MARCA-006), e são os pares que separam `assets/prism-logo.svg` (a escura, a cor do
 * desenho do splash, sem mudança) de `assets/prism-logo-light.svg` (a clara, para o fundo claro, em que o raio branco e o contorno
 * claro sumiriam). O teste da marca confere que toda cor que muda entre os dois arquivos é um destes pares, e todos são usados.
 * O vidro do prisma, o brilho, a luz dentro dele e o ponto da entrada ficam como estão: valem nos dois fundos.
 *
 * As faixas e os contornos dos cilindros são três tons de violeta, do mais claro (em cima) ao mais fundo (embaixo): eles não são as cores
 * de um banco, porque o Prism abre mais bancos do que três. No fundo claro vão tons mais escuros do mesmo violeta, e os cilindros ficam
 * claros, como os do painel do login.
 */
function pair(light: string, dark: string) {
  return { light, dark, css: `light-dark(${light}, ${dark})` };
}

export const markColors = {
  /** O raio que entra no prisma. */
  ray: pair("#1B2027", "#F3F5F8"),
  /** O brilho borrado do raio: no fundo claro um halo escuro pesaria, então ele vai com a metade da força. */
  rayGlow: pair("rgb(27 32 39 / 0.5)", "#F3F5F8"),
  /**
   * O contorno do prisma. No claro ele não pode ser o mesmo tom do raio: o vidro é escuro (#1A2028), e um contorno também escuro o
   * deixaria uma silhueta chapada. O #667085 é um cinza-azulado que se destaca do vidro (3,3:1) e do fundo claro (4,3:1).
   */
  rim: pair("#667085", "#E6EAF0"),
  /** As três faixas, cada uma com o seu cilindro: de cima para baixo, do violeta mais claro ao mais fundo. */
  bandTop: pair("#8B6AE0", "#DCCBFF"),
  bandMiddle: pair("#6A45C9", "#A98BF5"),
  bandBottom: pair("#46289E", "#7558D9"),
  /** O corpo e o topo de cada cilindro (um banco). */
  cylinderBody: pair("#ECEFF3", "#14181D"),
  cylinderTop: pair("#FFFFFF", "#1B2027"),
} as const;

/** Um elemento da marca já com as duas variantes juntas: o que muda de cor vai no estilo, como `light-dark(clara, escura)`. */
type MarkNode = { name: string; attributes: Record<string, string>; style: Record<string, string>; children: MarkNode[] };

/** Os atributos que pintam: os únicos em que as duas variantes podem diferir. */
const paintAttributes: Record<string, string> = { fill: "fill", stroke: "stroke", "stop-color": "stopColor" };

/**
 * Junta as duas variantes num desenho só: o que é igual fica como atributo, e a cor que difere vira `light-dark(clara, escura)` no estilo,
 * que o `color-scheme` de onde a marca está resolve (na barra, o do tema; no palco escuro do login, sempre a escura). Lança se as duas
 * diferirem em qualquer outra coisa: a variante clara tem a mesma geometria e as mesmas grossuras (RN-MARCA-007).
 */
export function mergeSchemes(light: SvgNode, dark: SvgNode, at = dark.name): MarkNode {
  const sameShape = light.name === dark.name && light.children.length === dark.children.length && Object.keys(light.attributes).join() === Object.keys(dark.attributes).join();
  if (!sameShape) throw new Error(`As variantes da marca não têm o mesmo desenho em ${at}.`);

  const attributes: Record<string, string> = {};
  const style: Record<string, string> = {};
  for (const [name, value] of Object.entries(dark.attributes)) {
    if (light.attributes[name] === value) attributes[name] = value;
    else if (paintAttributes[name] !== undefined) style[paintAttributes[name]] = `light-dark(${light.attributes[name]}, ${value})`;
    else throw new Error(`As variantes da marca diferem em ${name}, em ${at}: só a cor pode mudar.`);
  }

  return { name: dark.name, attributes, style, children: dark.children.map((child, index) => mergeSchemes(light.children[index], child, `${at}/${child.name}[${index}]`)) };
}

/** O desenho de dentro da página: sem o título e a descrição, que são do arquivo avulso (o título viraria dica sob o ponteiro). */
const withoutMetadata = (svg: SvgNode): SvgNode => ({ ...svg, children: svg.children.filter((child) => child.name !== "title" && child.name !== "desc") });

const mark = mergeSchemes(withoutMetadata(parseSvg(lightSource)), withoutMetadata(parseSvg(darkSource)));

/** A caixa do desenho, do `viewBox` do arquivo: é dela que sai a proporção da marca. */
const logoBox = (() => {
  const [, , width, height] = (mark.attributes.viewBox ?? "").split(/\s+/).map(Number);
  return { width, height };
})();

/** `stroke-width` vira `strokeWidth` para o React; `aria-*` e `data-*` ficam como estão. */
const propName = (name: string) => (/^(aria|data)-/.test(name) ? name : name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()));

/**
 * Os ids do arquivo levam o prefixo do `useId`, e as referências a eles (`url(#…)`) também: a marca aparece mais de uma vez na mesma
 * tela (a barra e a tela de bloqueio), e um id repetido faria um desenho usar o degradê do outro.
 */
function propsOf(node: MarkNode, prefix: string): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name === "xmlns") continue;
    props[propName(name)] = name === "id" ? `${prefix}-${value}` : value.replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`);
  }
  if (Object.keys(node.style).length > 0) props.style = node.style as CSSProperties;
  return props;
}

const childrenOf = (node: MarkNode, prefix: string): ReactNode[] => node.children.map((child, index) => createElement(child.name, { key: index, ...propsOf(child, prefix) }, ...childrenOf(child, prefix)));

/** Os atributos da raiz do arquivo que valem para um grupo: o preenchimento, as pontas e as junções (o `viewBox` é só da raiz). */
const groupAttributes = Object.fromEntries(Object.entries(mark.attributes).filter(([name]) => name !== "viewBox" && name !== "xmlns"));

type PrismMarkProps = Omit<ComponentProps<"svg">, "width" | "height"> & { width?: number; height: number };

/**
 * A marca do Prism (RN-MARCA-001 e RN-MARCA-007): o feixe branco entra no prisma de vidro e sai em três faixas com brilho, cada uma
 * chegando a um banco. É o desenho de `assets/prism-logo.svg` (com as cores de `prism-logo-light.svg` no
 * fundo claro), lido do arquivo no build, e não uma cópia dos traços: em qualquer tamanho é o mesmo desenho, escalado por igual, e as
 * linhas acompanham a escala.
 *
 * O tamanho é a altura, que quem a usa dá (na barra superior, 40 px: RN-MARCA-007, Ruling 137); a largura acompanha a proporção do
 * desenho. É decoração ao lado do nome: escondida do leitor de tela, a não ser que quem a usa diga o contrário.
 */
export function PrismMark({ height, width = (height * logoBox.width) / logoBox.height, className, ...props }: PrismMarkProps) {
  const prefix = useId();

  return createElement("svg", { ...propsOf({ ...mark, children: [] }, prefix), width, height, "aria-hidden": true, className: cn("flex-none", className), ...props }, ...childrenOf(mark, prefix));
}

/**
 * A marca como grupo, para dentro de outro SVG desenhado nas coordenadas dela: a ilustração do login, um quadro de 720 × 360 do qual o
 * `viewBox` do arquivo é o recorte. Cada traço fica onde estava. Um `<svg>` aninhado no lugar do grupo desenharia o brilho de outro jeito
 * com a ilustração escalada (a 1024 px de janela, 8.277 pixels diferentes do login de antes, em até 8 de 255; com o grupo, nenhum).
 */
export function PrismMarkGroup() {
  const prefix = useId();

  return createElement("g", propsOf({ ...mark, attributes: groupAttributes, children: [] }, prefix), ...childrenOf(mark, prefix));
}

type Point = [x: number, y: number];

/** Os pontos de um caminho de retas (`M x y L x y … Z`), na ordem. */
const pointsOf = (node: MarkNode): Point[] => {
  const numbers = (node.attributes.d.match(/-?[\d.]+/g) ?? []).map(Number);
  return numbers.flatMap((value, index) => (index % 2 === 0 ? [[value, numbers[index + 1]] as Point] : []));
};

/**
 * O caminho que a luz faz em cada faixa, de cima para baixo, para a animação do login: do começo do raio até a entrada no prisma, pelo raio
 * colorido de dentro até a saída, e pelo meio da faixa até o cilindro. Sai dos pontos do próprio desenho, e não de uma cópia (RN-MARCA-007):
 * pela ordem do arquivo, que o teste da marca fixa, o raio é o 3º elemento, as três faixas vêm logo depois dele, e os três raios de dentro
 * são o 12º, o 13º e o 14º.
 */
export const lightPaths: Point[][] = (() => {
  const [start, entry] = pointsOf(mark.children[2]);
  return [0, 1, 2].map((band) => {
    const [, exit] = pointsOf(mark.children[11 + band]);
    const [, top, bottom] = pointsOf(mark.children[3 + band]);
    return [start, entry, exit, [(top[0] + bottom[0]) / 2, (top[1] + bottom[1]) / 2]];
  });
})();
