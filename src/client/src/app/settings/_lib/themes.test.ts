import { describe, expect, it } from "vitest";

import { paletteOf } from "@/lib/testing/theme-palettes";

import { themeModes } from "./preferences";
import { findThemeOption, themeOptions, themePreviews } from "./themes";

const allConcreteThemes = themeModes.filter((mode) => mode !== "system");

describe("os cartões dos temas (Configuracoes.dc.html)", () => {
  it("incluem os temas do canvas, Kanagawa e os dez temas com variantes inspirados no Obsidian", () => {
    expect(themeOptions.map((option) => [option.mode, option.name, option.kind])).toEqual([
      ["dark", "Prism Escuro", "escuro"],
      ["light", "Prism Claro", "claro"],
      ["monokai", "Monokai", "escuro"],
      ["dracula", "Dracula", "escuro"],
      ["nord", "Nord", "escuro"],
      ["github-light", "GitHub Claro", "claro"],
      ["kanagawa", "Kanagawa", "escuro"],
      ["anuppuccin", "AnuPpuccin", "escuro"],
      ["blue-topaz", "Blue Topaz", "escuro"],
      ["obsidianite", "Obsidianite", "escuro"],
      ["atom", "Atom", "escuro"],
      ["typewriter", "Typewriter", "escuro"],
      ["willemstad", "Willemstad", "escuro"],
      ["obsidian-gruvbox", "Obsidian gruvbox", "escuro"],
      ["primary", "Primary", "escuro"],
      ["catppuccin", "Catppuccin", "escuro"],
      ["prism", "Prism", "escuro"],
    ]);
  });

  it("cada modo de tema (menos o do sistema, que não é um tema) está em um cartão ou variante e tem uma prévia, e nada mais", () => {
    const themes = [...allConcreteThemes].sort();
    const coveredByOptions = themeOptions.flatMap((option) => (option.variants ? option.variants.map((variant) => variant.mode) : [option.mode])).sort();

    expect(coveredByOptions).toEqual(themes);
    expect(Object.keys(themePreviews).sort()).toEqual(themes);
  });

  it("findThemeOption acha a família e a variante ativa de qualquer tema ou variante", () => {
    expect(findThemeOption("dark")).toEqual({
      option: expect.objectContaining({ mode: "dark", name: "Prism Escuro" }),
      variant: undefined,
    });
    expect(findThemeOption("anuppuccin-latte")).toEqual({
      option: expect.objectContaining({ mode: "anuppuccin", name: "AnuPpuccin" }),
      variant: { mode: "anuppuccin-latte", label: "Latte", kind: "claro" },
    });
    expect(findThemeOption("prism-cherry")).toEqual({
      option: expect.objectContaining({ mode: "prism", name: "Prism" }),
      variant: { mode: "prism-cherry", label: "Cherry", kind: "escuro" },
    });
  });

  it("o tipo no cartão e em cada variante (escuro ou claro) é o esquema de cor do tema no CSS", () => {
    for (const option of themeOptions) {
      expect(option.kind, option.name).toBe(paletteOf(option.mode).kind === "light" ? "claro" : "escuro");
      for (const variant of option.variants ?? []) {
        expect(variant.kind, `${option.name} · ${variant.label}`).toBe(paletteOf(variant.mode).kind === "light" ? "claro" : "escuro");
      }
    }
  });

  // A prévia desenha as cores do tema com valores próprios (ela mostra um tema que NÃO está aplicado), e por isso eles têm
  // de ser os mesmos dos tokens: uma prévia que mente sobre o tema é pior que nenhuma.
  it.each(allConcreteThemes)("as cores da prévia do tema %s são as dos tokens do CSS", (mode) => {
    const { palette } = paletteOf(mode);
    const preview = themePreviews[mode];

    expect({
      bg: preview.bg.toLowerCase(),
      painel: preview.painel.toLowerCase(),
      linha: preview.linha.toLowerCase(),
      fg: preview.fg.toLowerCase(),
      kw: preview.kw.toLowerCase(),
      str: preview.str.toLowerCase(),
      num: preview.num.toLowerCase(),
      com: preview.com.toLowerCase(),
      rolagem: preview.rolagem.toLowerCase(),
    }).toEqual({
      bg: palette.background,
      painel: palette.panel,
      linha: palette.border,
      fg: palette.ink,
      kw: palette["syntax-keyword"],
      str: palette["syntax-string"],
      num: palette["syntax-number"],
      com: palette["syntax-comment"],
      rolagem: palette["border-strong"],
    });
  });
});
