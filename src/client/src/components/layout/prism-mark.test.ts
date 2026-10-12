import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { contrast } from "@/lib/testing/contrast";

import { markColors, mergeSchemes, PrismMark, PrismMarkGroup } from "./prism-mark";
import { parseSvg, type SvgNode } from "./svg-tree";

const assets = new URL("../../../../../assets/", import.meta.url);
const asset = (file: string) => parseSvg(readFileSync(new URL(file, assets), "utf8"));
const markup = (props: Partial<Parameters<typeof PrismMark>[0]> = {}) => renderToStaticMarkup(createElement(PrismMark, { height: 40, ...props }));

/** O vidro do prisma, fixo nas duas variantes. */
const glass = "#1A2028";

/** O desenho do arquivo, sem o título e a descrição (que são do arquivo avulso). */
const drawing = (svg: SvgNode) => svg.children.filter((child) => child.name !== "title" && child.name !== "desc");

/**
 * A marca desenhada lida numa das duas colunas: cada `light-dark(clara, escura)` do estilo vira o atributo com a cor da coluna, e o
 * prefixo do `useId` sai dos ids e das referências. É o que a tela pinta num fundo claro ou num escuro.
 */
function inColumn(node: SvgNode, column: "light" | "dark", prefix: string): SvgNode {
  const attributes: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attributes)) {
    if (name === "style") continue;
    attributes[name] = value.replace(`url(#${prefix}-`, "url(#").replace(new RegExp(`^${prefix}-`), "");
  }
  for (const declaration of (node.attributes.style ?? "").split(";").filter(Boolean)) {
    const [, property, light, dark] = /^([a-z-]+):light-dark\((.+?), (.+)\)$/.exec(declaration) ?? [];
    expect(property, declaration).toBeDefined();
    attributes[property] = column === "light" ? light : dark;
  }
  return { ...node, attributes, children: node.children.map((child) => inColumn(child, column, prefix)) };
}

/** Compara sem a ordem dos atributos: o React escreve o estilo no fim, e a cor que muda com o tema sai do lugar. */
const sorted = (node: SvgNode): SvgNode => ({ ...node, attributes: Object.fromEntries(Object.entries(node.attributes).sort(([a], [b]) => a.localeCompare(b))), children: node.children.map(sorted) });

describe("a marca é o desenho de assets/, escalado por igual (RN-MARCA-007)", () => {
  const rendered = parseSvg(markup());
  const prefix = /id="([^"]+)-prism-splash-glow"/.exec(markup())?.[1] ?? "";

  it("no fundo escuro é assets/prism-logo.svg, elemento por elemento", () => {
    expect(drawing(inColumn(rendered, "dark", prefix)).map(sorted)).toEqual(drawing(asset("prism-logo.svg")).map(sorted));
  });

  it("no fundo claro é assets/prism-logo-light.svg, elemento por elemento", () => {
    expect(drawing(inColumn(rendered, "light", prefix)).map(sorted)).toEqual(drawing(asset("prism-logo-light.svg")).map(sorted));
  });

  it("a raiz tem o viewBox, o preenchimento, as pontas e as junções do arquivo, e nada que mude a grossura com o tamanho", () => {
    expect(rendered.attributes).toMatchObject({ viewBox: "0 34 720 281", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
    expect(markup()).not.toMatch(/vector-effect|non-scaling/);
  });

  it("o tamanho é a altura que quem a usa dá (a barra, 40 px; a abertura e o login, 28; o bloqueio, 56), e a largura acompanha a proporção do desenho", () => {
    expect(rendered.attributes).toMatchObject({ height: "40", width: String((40 * 720) / 281) });
    expect(parseSvg(markup({ height: 28 })).attributes).toMatchObject({ height: "28", width: String((28 * 720) / 281) });
    expect(parseSvg(markup({ height: 56 })).attributes).toMatchObject({ height: "56", width: String((56 * 720) / 281) });
    expect(parseSvg(markup({ width: 100, height: 28 })).attributes).toMatchObject({ width: "100", height: "28" });
  });

  it("é decoração ao lado do nome: escondida do leitor de tela, e sem o título do arquivo (que viraria dica sob o ponteiro)", () => {
    expect(rendered.attributes["aria-hidden"]).toBe("true");
    expect(markup()).not.toMatch(/<title|<desc/);
  });

  it("cada marca na tela tem os próprios ids, e cada referência aponta para um id dela mesma", () => {
    const twice = renderToStaticMarkup(createElement("div", null, createElement(PrismMark, { height: 40 }), createElement(PrismMark, { height: 56 })));
    const ids = [...twice.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);

    expect(new Set(ids).size).toBe(ids.length);
    for (const one of [markup(), markup({ height: 56 })]) {
      const own = new Set([...one.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
      for (const [, id] of one.matchAll(/url\(#([^)]+)\)/g)) expect(own.has(id), id).toBe(true);
    }
  });
});

describe("mergeSchemes: as duas variantes viram um desenho só, e só a cor pode diferir", () => {
  const svg = (inner: string) => parseSvg(`<svg viewBox="0 0 10 10">${inner}</svg>`);

  it("o que é igual fica como atributo; a cor que difere vai no estilo, como light-dark(clara, escura)", () => {
    const merged = mergeSchemes(svg('<path d="M0 0 L1 1" stroke="#111111" stroke-width="2"/>'), svg('<path d="M0 0 L1 1" stroke="#EEEEEE" stroke-width="2"/>'));

    expect(merged.children[0]).toEqual({ name: "path", attributes: { d: "M0 0 L1 1", "stroke-width": "2" }, style: { stroke: "light-dark(#111111, #EEEEEE)" }, children: [] });
  });

  it.each([
    ["uma grossura", '<path d="M0 0" stroke-width="1.75"/>', '<path d="M0 0" stroke-width="13"/>'],
    ["um traço", '<path d="M0 0 L1 1"/>', '<path d="M0 0 L2 2"/>'],
    ["um elemento a menos", "<path/><circle/>", "<path/>"],
    ["outro elemento", "<circle/>", "<ellipse/>"],
    ["um atributo a mais", '<path d="M0 0"/>', '<path d="M0 0" vector-effect="non-scaling-stroke"/>'],
  ])("recusa a variante que difere em %s", (_case, light, dark) => {
    expect(() => mergeSchemes(svg(light), svg(dark))).toThrow(/variantes da marca/);
  });
});

describe("a marca como grupo, dentro da ilustração do login", () => {
  it("é o mesmo desenho da marca, com o preenchimento, as pontas e as junções da raiz do arquivo, sem viewBox e sem tamanho", () => {
    const group = renderToStaticMarkup(createElement("svg", null, createElement(PrismMarkGroup)));
    const tree = parseSvg(group).children[0];
    const groupPrefix = /id="([^"]+)-prism-splash-glow"/.exec(group)?.[1] ?? "";
    const markPrefix = /id="([^"]+)-prism-splash-glow"/.exec(markup())?.[1] ?? "";

    expect(tree.name).toBe("g");
    expect(tree.attributes).toEqual({ fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
    expect(tree.children.map((child) => inColumn(child, "dark", groupPrefix))).toEqual(parseSvg(markup()).children.map((child) => inColumn(child, "dark", markPrefix)));
  });
});

describe("as cores que mudam com o tema (RN-MARCA-006)", () => {
  it("no tema escuro nada mudou: a coluna escura de cada cor que muda com o tema é a do desenho do splash", () => {
    expect(Object.fromEntries(Object.entries(markColors).map(([name, color]) => [name, color.dark]))).toEqual({
      ray: "#F3F5F8",
      rayGlow: "#F3F5F8",
      rim: "#E6EAF0",
      informix: "#F591B6",
      db2: "#5ED3A3",
      postgres: "#7DB2FF",
      cylinderBody: "#14181D",
      cylinderTop: "#1B2027",
    });
  });

  it("cada cor que muda com o tema é escrita como light-dark(clara, escura): quem decide é o esquema de cor de onde a marca está", () => {
    const written = [...markup().matchAll(/light-dark\(([^)]+?\)?), ([^)]+)\)/g)].map((match) => `${match[1]} | ${match[2]}`);
    const pairs = Object.values(markColors).map((color) => `${color.light} | ${color.dark}`);

    expect(written.length).toBeGreaterThan(0);
    for (const pair of written) expect(pairs).toContain(pair);
    for (const pair of pairs) expect(written).toContain(pair);
  });

  describe("a variante clara tem contraste de gráfico (3:1) sobre a barra e sobre a tela", () => {
    const surfaces = [
      ["a barra superior (panel)", "#ECEFF3"],
      ["a tela (background)", "#F7F8FA"],
    ] as const;

    it.each(surfaces.flatMap(([surface, hex]) => (["ray", "rim", "informix", "db2", "postgres"] as const).map((name) => [name, surface, hex] as const)))("%s sobre %s", (name, _surface, hex) => {
      expect(contrast(markColors[name].light, hex)).toBeGreaterThanOrEqual(3);
    });

    it("o raio é escuro (o raio branco sumiria) e o contorno, também de tom escuro, se destaca do vidro (senão o prisma vira silhueta chapada)", () => {
      expect(contrast(markColors.ray.light, "#FFFFFF")).toBeGreaterThan(10);
      expect(contrast(markColors.ray.dark, "#F7F8FA")).toBeLessThan(1.2);
      expect(contrast(markColors.rim.light, glass)).toBeGreaterThanOrEqual(3);
      expect(contrast(markColors.rim.dark, glass)).toBeGreaterThanOrEqual(3);
    });
  });
});
