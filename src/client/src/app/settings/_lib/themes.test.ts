import { describe, expect, it } from "vitest";

import { paletteOf } from "@/lib/testing/theme-palettes";

import { themeModes } from "./preferences";
import { themePreviews, themeOptions } from "./themes";

describe("os cartões dos temas (Configuracoes.dc.html)", () => {
  it("incluem os seis temas do canvas e Kanagawa", () => {
    expect(themeOptions.map((option) => [option.mode, option.name, option.kind])).toEqual([
      ["dark", "Prism Escuro", "escuro"],
      ["light", "Prism Claro", "claro"],
      ["monokai", "Monokai", "escuro"],
      ["dracula", "Dracula", "escuro"],
      ["nord", "Nord", "escuro"],
      ["github-light", "GitHub Claro", "claro"],
      ["kanagawa", "Kanagawa", "escuro"],
    ]);
  });

  it("cada modo de tema (menos o do sistema, que não é um tema) tem um cartão e uma prévia, e nada mais", () => {
    const themes = themeModes.filter((mode) => mode !== "system").sort();

    expect(themeOptions.map((option) => option.mode).sort()).toEqual(themes);
    expect(Object.keys(themePreviews).sort()).toEqual(themes);
  });

  it("o tipo no cartão (escuro ou claro) é o esquema de cor do tema no CSS", () => {
    for (const option of themeOptions) expect(option.kind, option.name).toBe(paletteOf(option.mode).kind === "light" ? "claro" : "escuro");
  });

  // A prévia desenha as cores do tema com valores próprios (ela mostra um tema que NÃO está aplicado), e por isso eles têm
  // de ser os mesmos dos tokens: uma prévia que mente sobre o tema é pior que nenhuma.
  it.each(themeOptions.map((option) => option.mode))("as cores da prévia do tema %s são as dos tokens do CSS", (mode) => {
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
