import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BrandPanel } from "@/app/sign-in/_components/brand-panel";
import { dark as darkPalette } from "@/lib/testing/theme-palettes";

import { markColors } from "./prism-mark";
import { parseSvg, type SvgNode } from "./svg-tree";

// O botão de atualizações do painel do login precisa dos avisos e da ponte; aqui só importa a ilustração.
vi.mock("@/components/update/check-updates-button", () => ({ CheckUpdatesButton: () => null }));

/** `assets/`, na raiz do repositório: a única cópia dos desenhos da marca (RN-MARCA-007). */
const assets = new URL("../../../../../assets/", import.meta.url);
const read = (path: string, base = assets) => readFileSync(new URL(path, base), "utf8");

const logo = parseSvg(read("prism-logo.svg"));
const lightLogo = parseSvg(read("prism-logo-light.svg"));

/**
 * O desenho que o splash tinha quando o logotipo foi para `assets/`: o bloco `<svg>…</svg>` de
 * `git show dda5d19:src/client/electron/splash.html`, byte a byte (o arquivo era o mesmo desde 3d9a9e8). É dado do teste, e não do app: se o
 * teste lesse o splash de hoje, que tira o desenho de `assets/`, compararia o arquivo com ele mesmo.
 */
const splashAtStart = parseSvg(read("brand-assets.reference/splash-dda5d19.svg", new URL("./", import.meta.url)));

/**
 * A ilustração da tela de login no mesmo commit: o `<svg viewBox="0 0 720 360">` que o `BrandPanel` de dda5d19 desenhava
 * (`renderToStaticMarkup`), com a régua do painel por baixo e as cores pelas fichas do tema (`text-informix`, `stroke-ink`, `fill-panel`…).
 */
const loginAtStart = parseSvg(read("brand-assets.reference/login-dda5d19.svg", new URL("./", import.meta.url)));

/** O que o arquivo avulso tem e o desenho dentro de uma página não tem: o título e a descrição. */
const drawing = (svg: SvgNode) => svg.children.filter((child) => child.name !== "title" && child.name !== "desc");

/** Os atributos que pintam: os únicos que a variante para fundo claro pode trocar (RN-MARCA-006). */
const colorAttributes = new Set(["fill", "stroke", "stop-color"]);

/** Cada atributo de cada elemento, com o caminho dele na árvore: `defs/linearGradient[1]/stop[0]`. */
function attributesOf(nodes: SvgNode[], path = ""): { at: string; name: string; attribute: string; value: string }[] {
  return nodes.flatMap((node, index) => {
    const at = `${path}${node.name}[${index}]`;
    return [...Object.entries(node.attributes).map(([attribute, value]) => ({ at, name: node.name, attribute, value })), ...attributesOf(node.children, `${at}/`)];
  });
}

/** A forma da árvore, sem os valores: o nome de cada elemento e a lista dos atributos dele, na ordem. */
function shapeOf(nodes: SvgNode[]): unknown[] {
  return nodes.map((node) => [node.name, Object.keys(node.attributes), shapeOf(node.children)]);
}

describe("assets/prism-logo.svg é o desenho do splash e do login, sem mudar nada (RN-MARCA-007)", () => {
  it("o viewBox, o preenchimento, as pontas e as junções da raiz são os do splash", () => {
    for (const attribute of ["viewBox", "fill", "stroke-linecap", "stroke-linejoin"]) expect(logo.attributes[attribute], attribute).toBe(splashAtStart.attributes[attribute]);
  });

  it("é um SVG avulso: o xmlns, um título e uma descrição (o texto alternativo que o splash tinha), e nenhum tamanho escrito", () => {
    expect(logo.attributes).toEqual({ xmlns: "http://www.w3.org/2000/svg", viewBox: "0 34 720 281", fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" });
    expect(logo.children.slice(0, 2).map((child) => [child.name, child.text])).toEqual([
      ["title", "Prism"],
      ["desc", splashAtStart.attributes["aria-label"]],
    ]);
  });

  it("elemento por elemento, é o desenho do splash: os mesmos elementos, na mesma ordem, com os mesmos atributos e valores (d, grossuras, cores, opacidades, gradientes e filtro)", () => {
    expect(drawing(logo)).toEqual(splashAtStart.children);
    // E o desenho não está vazio dos dois lados: 24 caminhos, 3 círculos e 3 elipses (mais os 4 degradês e o filtro).
    const shapes = attributesOf(drawing(logo)).filter((entry) => entry.attribute === "d" || entry.attribute === "r" || entry.attribute === "rx").length;
    expect(shapes).toBe(30);
  });
});

describe("assets/prism-logo-light.svg, a variante para fundo claro, só difere nas cores (RN-MARCA-006 e 007)", () => {
  const dark = attributesOf(drawing(logo));
  const light = attributesOf(drawing(lightLogo));
  const changed = dark.flatMap((entry, index) => (entry.value === light[index].value ? [] : [{ ...entry, light: light[index].value }]));

  it("a raiz, o título e a descrição são os do desenho escuro", () => {
    expect(lightLogo.attributes).toEqual(logo.attributes);
    expect(lightLogo.children.slice(0, 2)).toEqual(logo.children.slice(0, 2));
  });

  it("a mesma lista de elementos, com os mesmos atributos na mesma ordem: a mesma geometria (d, centros, raios) e as mesmas grossuras", () => {
    expect(shapeOf(drawing(lightLogo))).toEqual(shapeOf(drawing(logo)));
    for (const [index, entry] of dark.entries()) if (!colorAttributes.has(entry.attribute)) expect(light[index].value, `${entry.at} ${entry.attribute}`).toBe(entry.value);
  });

  it("o que muda é só cor, e cada troca é um par de markColors: a escura é a do desenho, a clara é a da variante", () => {
    const pairs = Object.values(markColors).map((color) => `${color.light} | ${color.dark}`);

    expect(changed.length).toBeGreaterThan(0);
    for (const entry of changed) {
      expect(colorAttributes.has(entry.attribute), `${entry.at} ${entry.attribute}`).toBe(true);
      expect(pairs, `${entry.at} ${entry.attribute}`).toContain(`${entry.light} | ${entry.value}`);
    }
    // E todo par de markColors é usado: nenhuma cor da variante ficou só no código.
    for (const pair of pairs) expect(changed.map((entry) => `${entry.light} | ${entry.value}`)).toContain(pair);
  });

  it("o vidro do prisma, a luz dentro dele, o brilho e o ponto da entrada ficam como estão; mudam o raio, o contorno, as faixas e os cilindros", () => {
    // Cada elemento pelo que ele pinta (e não pelo traço: os traços só existem em `assets/`, e a varredura abaixo confere isso).
    const paintOf = (node: SvgNode) => [node.name, ...["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity"].flatMap((name) => (node.attributes[name] === undefined ? [] : [`${name}=${node.attributes[name]}`]))].join(" ");
    const changedElements = new Set(changed.map((entry) => entry.at));
    const elements = drawing(logo).flatMap((node, index) => (node.name === "defs" || node.name === "g" ? [] : [{ at: `${node.name}[${index}]`, node }]));

    expect(elements.filter(({ at }) => !changedElements.has(at)).map(({ node }) => paintOf(node))).toEqual([
      // As três faixas que saem do prisma: pintadas pelo degradê, que é o que muda de cor.
      "path fill=url(#prism-splash-ifx)",
      "path fill=url(#prism-splash-db2)",
      "path fill=url(#prism-splash-pg)",
      // O vidro: as três faces e as arestas de dentro.
      "path fill=#1A2028",
      "path fill=url(#prism-splash-face)",
      "path fill=#11151A",
      "path stroke=#46505D stroke-width=1",
      // A luz dentro dele e os três raios coloridos que o atravessam.
      "path fill=#F3F5F8 fill-opacity=0.14",
      "path stroke=#F591B6 stroke-width=1.25 stroke-opacity=0.9",
      "path stroke=#5ED3A3 stroke-width=1.25 stroke-opacity=0.9",
      "path stroke=#7DB2FF stroke-width=1.25 stroke-opacity=0.9",
      // O brilho.
      "path stroke=#FFFFFF stroke-width=1.5 stroke-opacity=0.28",
      // O ponto da entrada.
      "circle fill=#FFFFFF fill-opacity=0.12",
      "circle fill=#FFFFFF fill-opacity=0.28",
      "circle fill=#FFFFFF",
    ]);
    // O que muda: as duas paradas de cada um dos três degradês, o brilho borrado (o do raio e o das três faixas), o raio, o contorno e
    // os nove elementos dos cilindros (corpo, faixa do meio e topo de cada um).
    expect(new Set(changed.map((entry) => entry.at)).size).toBe(6 + 4 + 1 + 1 + 9);
  });
});

/** As fichas de cor que a ilustração do login usava, no palco escuro (`stage-dark`): os valores da coluna escura de `@theme`. */
const tokenClass = /^(text|fill|stroke)-(.+)$/;

/** O `light-dark(clara, escura)` de um estilo: sobre o palco escuro vale a escura. A vírgula que conta é a de fora dos parênteses. */
function darkColumn(value: string): string {
  const match = /^light-dark\((.*)\)$/.exec(value.trim());
  if (match === null) return value.trim();
  let depth = 0;
  for (const [index, char] of [...match[1]].entries()) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === "," && depth === 0) return match[1].slice(index + 1).trim();
  }
  throw new Error(`light-dark sem as duas cores: ${value}`);
}

const inheritedPaint = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin", "color"] as const;
type Paint = Record<(typeof inheritedPaint)[number], string>;

/** O que um elemento escreve de pintura: os atributos, as classes de ficha e o estilo em linha (que vence os dois), nesta ordem. */
function ownPaint(node: SvgNode): Partial<Paint> {
  const paint: Record<string, string> = {};
  for (const name of inheritedPaint) if (node.attributes[name] !== undefined) paint[name] = node.attributes[name];
  for (const name of (node.attributes.class ?? "").split(/\s+/)) {
    const match = tokenClass.exec(name);
    const color = match === null ? undefined : darkPalette[match[2]];
    if (match !== null && color !== undefined) paint[match[1] === "text" ? "color" : match[1]] = color;
  }
  for (const declaration of (node.attributes.style ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon > 0) paint[declaration.slice(0, colon).trim()] = darkColumn(declaration.slice(colon + 1));
  }
  return paint;
}

const normalColor = (value: string) => (/^#[0-9a-f]{3,8}$/i.test(value) ? value.toLowerCase() : value);

/**
 * O que se vê de um SVG, elemento por elemento, sem o jeito de escrever: cada forma desenhada com a geometria, a pintura efetiva (o que
 * herda dos grupos, `currentColor` resolvido, a cor da ficha no palco escuro, o degradê e o filtro descritos pelo que são, e não pelo id) e
 * os grupos com efeito (filtro, opacidade) em volta dela. Um `<svg>` aninhado só entra se o `viewBox` dele é a própria caixa (o desenho
 * fica no mesmo lugar): aí ele é um grupo como outro.
 */
function seen(root: SvgNode): string[] {
  const byId = new Map<string, SvgNode>();
  const index = (node: SvgNode) => {
    if (node.attributes.id !== undefined) byId.set(node.attributes.id, node);
    node.children.forEach(index);
  };
  index(root);

  const describe = (value: string, color: string): string => {
    const reference = /^url\(#(.+)\)$/.exec(value);
    if (reference === null) return normalColor(value === "currentColor" ? color : value);
    const server = byId.get(reference[1]);
    if (server === undefined) throw new Error(`referência sem alvo: ${value}`);
    const own = { ...ownPaint(server) };
    const serverColor = normalColor(own.color ?? color);
    const attributes = Object.entries(server.attributes).filter(([name]) => name !== "id" && name !== "class");
    const children = server.children.map((child) => {
      const stopColor = child.attributes["stop-color"];
      const rest = Object.entries(child.attributes).filter(([name]) => name !== "stop-color" && name !== "style");
      const styled = ownPaint(child) as Record<string, string>;
      const color = styled["stop-color"] ?? stopColor;
      return `${child.name}(${rest.map(([name, value]) => `${name}=${value}`).join(" ")}${color === undefined ? "" : ` stop-color=${normalColor(color === "currentColor" ? serverColor : color)}`})`;
    });
    return `${server.name}(${attributes.map(([name, value]) => `${name}=${value}`).join(" ")})[${children.join(" ")}]`;
  };

  const shapes: string[] = [];
  const walk = (node: SvgNode, inherited: Paint, groups: string[]) => {
    if (["defs", "title", "desc", "linearGradient", "filter"].includes(node.name)) return;
    const paint = { ...inherited, ...ownPaint(node) } as Paint;

    if (node.name === "svg" || node.name === "g") {
      const nested = node !== root && node.name === "svg";
      if (nested) expect(node.attributes.viewBox, "o <svg> de dentro fica no mesmo lugar").toBe(["x", "y", "width", "height"].map((name) => node.attributes[name] ?? "0").join(" "));
      const effect = ["filter", "opacity"].flatMap((name) => (node.attributes[name] === undefined ? [] : [`${name}=${name === "filter" ? describe(node.attributes[name], paint.color) : node.attributes[name]}`]));
      for (const child of node.children) walk(child, paint, effect.length > 0 ? [...groups, `g(${effect.join(" ")})`] : groups);
      return;
    }

    const geometry = ["d", "cx", "cy", "r", "rx", "ry"].flatMap((name) => (node.attributes[name] === undefined ? [] : [`${name}=${node.attributes[name]}`]));
    const painted = inheritedPaint.filter((name) => name !== "color").map((name) => `${name}=${name === "fill" || name === "stroke" ? describe(paint[name], paint.color) : paint[name]}`);
    shapes.push([...groups, node.name, ...geometry, ...painted].join(" "));
  };
  walk(root, { fill: "#000000", "fill-opacity": "1", stroke: "none", "stroke-width": "1", "stroke-opacity": "1", "stroke-linecap": "butt", "stroke-linejoin": "miter", color: "#000000" }, []);
  return shapes;
}

/** A régua do painel do login: é do painel, e não da marca (as duas primeiras formas da ilustração, pintadas com a ficha da borda). */
const isRuler = (shape: string) => shape.includes(`stroke=${darkPalette["border-strong"]}`);

/** O `<svg viewBox="0 0 720 360">` do painel do login, com o que estiver aninhado dentro dele. */
function loginIllustration(markup: string): SvgNode {
  const start = markup.indexOf('<svg viewBox="0 0 720 360"');
  let depth = 0;
  for (const match of markup.slice(start).matchAll(/<svg[\s>]|<\/svg>/g)) {
    depth += match[0] === "</svg>" ? -1 : 1;
    if (depth === 0) return parseSvg(markup.slice(start, start + (match.index ?? 0) + "</svg>".length));
  }
  throw new Error("a ilustração do login não está no painel");
}

describe("o login desenha a marca de assets/, e o que se vê é o que se via (RN-MARCA-007)", () => {
  const before = seen(loginAtStart);

  it("assets/prism-logo.svg é a ilustração do login de antes, sem a régua: forma por forma, com a mesma pintura", () => {
    expect(before.filter(isRuler)).toHaveLength(2);
    expect(seen(logo)).toEqual(before.filter((shape) => !isRuler(shape)));
  });

  it("o painel de hoje desenha o mesmo que o de antes, com a régua por baixo da marca", () => {
    const now = loginIllustration(renderToStaticMarkup(createElement(BrandPanel, { version: "0.1.0" })));

    expect(now.attributes["aria-label"]).toBe(loginAtStart.attributes["aria-label"]);
    expect(now.attributes.role).toBe("img");
    expect(seen(now)).toEqual(before);
  });
});

describe("um desenho só: os traços da marca só existem em assets/ (RN-MARCA-007)", () => {
  /** Cada caminho do logotipo, e o mesmo caminho sem o ponto de partida (o que pega o cilindro montado num texto com a altura dele). */
  const strokes = attributesOf(drawing(logo))
    .filter((entry) => entry.attribute === "d")
    .flatMap(({ value }) => [value, value.replace(/^M[\d.\s-]+?(?=[A-Za-z])/, "")])
    .filter((stroke, position, all) => stroke.length >= 12 && all.indexOf(stroke) === position);

  const client = fileURLToPath(new URL("../../../", import.meta.url));
  const skipped = new Set(["node_modules", "out", "release", "resources", ".api-dev", ".api-publish"]);
  const code = new Set([".ts", ".tsx", ".html", ".js", ".mjs", ".cjs", ".css"]);

  function filesUnder(folder: string): string[] {
    return readdirSync(folder).flatMap((name) => {
      const path = `${folder}${name}`;
      if (statSync(path).isDirectory()) return skipped.has(name) ? [] : filesUnder(`${path}/`);
      return code.has(extname(name)) ? [path] : [];
    });
  }

  it("a varredura procura o que deve: os caminhos do prisma, das faixas e dos cilindros", () => {
    expect(strokes.length).toBeGreaterThanOrEqual(20);
    // Os cilindros sem o ponto de partida: o corpo (que começa por `v`) e a faixa do meio (que começa por `a`).
    expect(strokes.filter((stroke) => /^[va]/.test(stroke))).toHaveLength(2);
  });

  it("nenhum arquivo de código do cliente (.ts, .tsx, .html, .js, .mjs, .css) tem um traço do logotipo", () => {
    const found = filesUnder(client).flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return strokes.filter((stroke) => text.includes(stroke)).map((stroke) => `${path.slice(client.length)}: ${stroke}`);
    });

    expect(found).toEqual([]);
  });
});

describe("os PNG do logotipo, gerados dos SVG por `scripts/make-logo-pngs.mjs` (RN-MARCA-007)", () => {
  /** A largura, a altura e o tipo de cor do PNG, do cabeçalho (IHDR): 6 é RGBA, com o canal de transparência. */
  function headerOf(file: string) {
    const png = readFileSync(new URL(file, assets));
    expect(png.subarray(0, 8).toString("hex"), file).toBe("89504e470d0a1a0a");
    expect(png.toString("ascii", 12, 16), file).toBe("IHDR");
    return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), bitDepth: png[24], colorType: png[25] };
  }

  it.each(["prism-logo", "prism-logo-light"].flatMap((variant) => [720, 1440, 2880].map((width) => [variant, width] as const)))("%s-%i.png tem a largura pedida, a altura do viewBox na mesma escala e transparência", (variant, width) => {
    expect(headerOf(`${variant}-${width}.png`)).toEqual({ width, height: (width * 281) / 720, bitDepth: 8, colorType: 6 });
  });
});

describe("assets/zanveri/: os arquivos da marca da Zanveri, como a empresa os entregou (RN-MARCA-008)", () => {
  const folder = new URL("zanveri/", assets);
  const readme = read("README.md");

  it("são os quatro SVG: o monograma e o wordmark, cada um na cor escura (ink) e na clara (paper)", () => {
    expect(readdirSync(folder).sort()).toEqual(["zanveri-monogram-ink.svg", "zanveri-monogram-paper.svg", "zanveri-wordmark-ink.svg", "zanveri-wordmark-paper.svg"]);
  });

  it.each(["zanveri-monogram-ink.svg", "zanveri-monogram-paper.svg", "zanveri-wordmark-ink.svg", "zanveri-wordmark-paper.svg"])("o SHA-256 de %s é o que o README registra: o arquivo não foi redesenhado nem recolorido", (file) => {
    const hash = createHash("sha256").update(readFileSync(new URL(file, folder))).digest("hex");
    expect(readme).toMatch(new RegExp(`\`zanveri/${file}\`[^\\n]*\`${hash}\``));
  });
});
