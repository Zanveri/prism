import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseSvg, type SvgNode } from "../src/components/layout/svg-tree";
import { splashCss, splashGeometry, splashPage, splashSteps } from "./splash";

const assets = new URL("../../../assets/", import.meta.url);

/** O primeiro `<svg>…</svg>` de um texto: no splash, o logotipo (o selo da Zanveri é uma imagem, e não um SVG em linha). */
function firstSvg(html: string): string {
  const start = html.indexOf("<svg");
  return html.slice(start, html.indexOf("</svg>", start) + "</svg>".length);
}

const drawing = (svg: SvgNode) => svg.children.filter((child) => child.name !== "title" && child.name !== "desc");

describe("splashCss", () => {
  it('splashCss("api") traz o texto "Iniciando o serviço local…", "1 de 2" e largura 45%', () => {
    const css = splashCss("api");

    expect(css).toContain('"Iniciando o serviço local…"');
    expect(css).toContain('"1 de 2"');
    expect(css).toContain("width: 45%");
  });

  it('splashCss("ui") traz "Carregando a interface…", "2 de 2" e largura 85%', () => {
    const css = splashCss("ui");

    expect(css).toContain('"Carregando a interface…"');
    expect(css).toContain('"2 de 2"');
    expect(css).toContain("width: 85%");
  });

  it("splashCss escapa aspas e barra invertida no texto", () => {
    const css = splashCss("api", { ...splashSteps, api: { label: 'diz "oi" \\ e\nfim', position: "1 de 2", progress: 45 } });

    expect(css).toContain('"diz \\"oi\\" \\\\ e\\a fim"');
  });
});

describe("splash.html (RN-MARCA-005)", () => {
  const html = readFileSync(new URL("./splash.html", import.meta.url), "utf8");

  it("não executa script e a política de conteúdo não deixa carregar nada de fora", () => {
    expect(html).not.toMatch(/<script|\son[a-z]+\s*=|javascript:/i);
    expect(html).toContain("default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:");
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["'](?:https?:|\/\/)/i);
  });

  it("não traz texto de passo: quem o escreve é o CSS do passo", () => {
    expect(html).not.toContain("Iniciando o serviço local");
    expect(html).not.toContain("Carregando a interface");
  });
});

describe("splashPage (RN-VERSAO-004)", () => {
  it("escreve a versão do app na página estática, sem acrescentar script", () => {
    const page = splashPage("0.1.0");

    expect(page).toContain("versão 0.1.0");
    expect(page).not.toContain("{{version}}");
    expect(page).not.toMatch(/<script/i);
  });

  it("a versão entra como texto: marcação e o padrão $& do replace não valem", () => {
    const page = splashPage('1.0.0-<b>$&"');

    expect(page).toContain("versão 1.0.0-&lt;b&gt;$&amp;&quot;");
    expect(page).not.toContain("<b>");
  });
});

describe("o logotipo do splash é o de assets/ (RN-MARCA-007)", () => {
  const page = splashPage("0.1.0");
  const logo = parseSvg(readFileSync(new URL("prism-logo.svg", assets), "utf8"));
  const inPage = parseSvg(firstSvg(page));

  it("splash.html não tem desenho: a página recebe o de assets/ ao ser montada", () => {
    const html = readFileSync(new URL("./splash.html", import.meta.url), "utf8");

    expect(html).not.toContain("<svg");
    expect(html).toContain("{{prism-logo}}");
    expect(page).not.toContain("{{prism-logo}}");
  });

  it("é o desenho do arquivo, elemento por elemento, com o mesmo viewBox", () => {
    expect(drawing(inPage)).toEqual(drawing(logo));
    for (const attribute of ["viewBox", "fill", "stroke-linecap", "stroke-linejoin"]) expect(inPage.attributes[attribute], attribute).toBe(logo.attributes[attribute]);
  });

  it("com o texto alternativo de antes (a descrição do arquivo), e sem o título e a descrição do arquivo avulso dentro da página", () => {
    const description = logo.children.find((child) => child.name === "desc")?.text;

    expect(inPage.attributes).toMatchObject({ role: "img", "aria-label": description });
    expect(description).toBe("Um feixe de luz entra no prisma e sai em três faixas de cor, cada uma chegando a um banco de dados");
    expect(inPage.children.map((child) => child.name)).not.toContain("title");
    expect(inPage.children.map((child) => child.name)).not.toContain("desc");
  });

  it("o tamanho é do CSS da página, e não do desenho: o arquivo não escreve tamanho", () => {
    expect(inPage.attributes.style).toBeUndefined();
    expect(page).toMatch(/\.splash > svg \{ flex: none; display: block; width: 638px; height: 249px; \}/);
  });
});

describe("o selo powered by Zanveri no splash (RN-MARCA-008)", () => {
  const page = splashPage("0.1.0");
  const wordmark = readFileSync(new URL("zanveri/zanveri-wordmark-paper.svg", assets));

  it('diz "powered by" e mostra o wordmark claro da Zanveri, embutido na página, byte a byte como a empresa o entregou', () => {
    const image = /<img class="seal-wordmark" src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)" alt="Zanveri">/.exec(page);

    expect(page).toMatch(/<div class="seal">\s*<span>powered by<\/span>\s*<img class="seal-wordmark"/);
    expect(image).not.toBeNull();
    expect(Buffer.from(image?.[1] ?? "", "base64").equals(wordmark)).toBe(true);
  });

  it("continua sem script e sem nada de fora: o selo é uma imagem data:, que a política já permite", () => {
    expect(page).not.toMatch(/<script|\son[a-z]+\s*=|javascript:/i);
    expect(page).not.toMatch(/(?:src|href)\s*=\s*["'](?:https?:|\/\/)/i);
    expect(page).toContain("img-src 'self' data:");
  });
});

describe("splashGeometry: o splash no zoom do programa (RN-ZOOM-001)", () => {
  const fullHd = { width: 1920, height: 1040 };

  it("em 100% é a janela de sempre, 640×400", () => {
    expect(splashGeometry(1, fullHd)).toEqual({ width: 640, height: 400, zoomFactor: 1 });
  });

  it("a janela cresce e encolhe junto com o desenho, no fator do zoom", () => {
    expect(splashGeometry(1.25, fullHd)).toEqual({ width: 800, height: 500, zoomFactor: 1.25 });
    expect(splashGeometry(0.67, fullHd)).toEqual({ width: 429, height: 268, zoomFactor: 0.67 });
    expect(splashGeometry(2, fullHd)).toEqual({ width: 1280, height: 800, zoomFactor: 2 });
  });

  it("até caber na área útil da tela: a 200%, num monitor de 1366×768, o fator para onde a altura cabe", () => {
    const geometry = splashGeometry(2, { width: 1366, height: 728 });

    expect(geometry.zoomFactor).toBeCloseTo(1.82);
    expect(geometry.height).toBe(728);
    expect(geometry.width).toBeLessThanOrEqual(1366);
  });

  it("uma área útil que não é medida (zero) não some com o splash: fica em 100%", () => {
    expect(splashGeometry(1.5, { width: 0, height: 0 })).toEqual({ width: 640, height: 400, zoomFactor: 1 });
  });
});
