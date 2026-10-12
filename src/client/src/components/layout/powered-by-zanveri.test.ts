import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import inkMonogram from "@assets/zanveri/zanveri-monogram-ink.svg";
import paperMonogram from "@assets/zanveri/zanveri-monogram-paper.svg";
import { themeSchemes, type ThemeId } from "@/app/settings/_lib/theme";
import { contrast } from "@/lib/testing/contrast";
import { paletteOf } from "@/lib/testing/theme-palettes";

import { monogramOf, PoweredByZanveriView, subscribeRootScheme } from "./powered-by-zanveri";

const view = (scheme: "dark" | "light") => renderToStaticMarkup(createElement(PoweredByZanveriView, { scheme }));
const visibleText = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe('o selo "powered by Zanveri" na barra superior (RN-MARCA-008)', () => {
  it('diz "powered by", mostra o monograma e escreve o nome como texto, na tipografia do app', () => {
    expect(visibleText(view("dark"))).toBe("powered by Zanveri");
    expect(view("dark")).toMatch(/powered by<\/span><img[^>]*><span[^>]*>Zanveri<\/span>/);
  });

  it("o monograma claro (paper) nos temas escuros e o escuro (ink) nos claros: os arquivos de assets/zanveri/, como a empresa os entregou", () => {
    expect(monogramOf).toEqual({ dark: paperMonogram, light: inkMonogram });
    expect(view("dark")).toContain(`src="${paperMonogram}"`);
    expect(view("light")).toContain(`src="${inkMonogram}"`);
  });

  it('é lido "powered by Zanveri" uma vez: o monograma não repete o nome no texto alternativo', () => {
    expect(view("dark")).toMatch(/<img[^>]*\salt=""/);
    expect(view("dark")).not.toMatch(/aria-label/);
  });

  it("é discreto e some antes de apertar o resto quando a janela é estreita", () => {
    const root = /<span class="([^"]+)"/.exec(view("dark"))?.[1].split(" ") ?? [];

    expect(root).toContain("hidden");
    expect(root.some((name) => /^min-\[\d+px\]:flex$/.test(name))).toBe(true);
    expect(root).toContain("text-subtle");
  });

  describe("o monograma se vê sobre a barra de cada um dos seis temas (3:1, o mínimo de um gráfico)", () => {
    /** A cor do monograma (a classe `.s0` do arquivo), sem tirar do arquivo o que ele diz. */
    const fillOf = (file: string) => /\.s0\s*\{\s*fill:\s*(#[0-9a-f]{6})/i.exec(readFileSync(new URL(`../../../../../assets/zanveri/${file}`, import.meta.url), "utf8"))?.[1] ?? "";

    it.each(Object.keys(themeSchemes) as ThemeId[])("%s", (theme) => {
      const { kind, palette } = paletteOf(theme);
      const monogram = kind === "light" ? fillOf("zanveri-monogram-ink.svg") : fillOf("zanveri-monogram-paper.svg");

      expect(monogram).toMatch(/^#[0-9a-f]{6}$/i);
      expect(contrast(monogram, palette.panel)).toBeGreaterThanOrEqual(3);
    });
  });
});

describe("subscribeRootScheme: quem desenha o selo fica sabendo quando o esquema de cor muda", () => {
  it("ouve o atributo do tema no <html> e o claro e escuro do sistema, e para de ouvir os dois", () => {
    const observed: { target: unknown; options: unknown }[] = [];
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(readonly callback: () => void) {}
      observe(target: unknown, options: unknown) {
        observed.push({ target, options });
      }
      disconnect = disconnect;
    }
    const stopSystem = vi.fn();
    const root = {} as Node;
    const listener = vi.fn();

    const stop = subscribeRootScheme(listener, { root, Observer: FakeObserver, onSystemScheme: () => stopSystem });

    expect(observed).toEqual([{ target: root, options: { attributes: true, attributeFilter: ["data-theme"] } }]);
    stop();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(stopSystem).toHaveBeenCalledOnce();
  });

  it("fora do navegador (sem MutationObserver) não ouve nada e não lança", () => {
    expect(() => subscribeRootScheme(() => {}, { root: null, Observer: undefined, onSystemScheme: () => () => {} })()).not.toThrow();
  });
});

describe("a barra superior tem o selo", () => {
  it("top-bar.tsx põe <PoweredByZanveri /> na barra", () => {
    const topBar = readFileSync(new URL("./top-bar.tsx", import.meta.url), "utf8");

    expect(topBar).toMatch(/import \{ PoweredByZanveri \} from "\.\/powered-by-zanveri";/);
    expect(topBar.match(/<PoweredByZanveri \/>/g)).toHaveLength(1);
  });
});
