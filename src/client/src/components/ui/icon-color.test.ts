import { describe, expect, it } from "vitest";

import { connectionsCopy } from "@/app/connections/_lib/connections.copy";
import { themeModes } from "@/app/settings/_lib/preferences";
import type { ThemeId } from "@/app/settings/_lib/theme";
import { contrast } from "@/lib/testing/contrast";
import { paletteOf } from "@/lib/testing/theme-palettes";

import { iconColorStyle, iconContrast, iconSurfaces, readableIconColor } from "./icon-color";

const themes = themeModes.filter((mode): mode is ThemeId => mode !== "system").map((id) => ({ id, ...paletteOf(id) }));
const surfaceTokens = ["background", "panel", "raised", "selected"] as const;
const palette = connectionsCopy.colors.map((color) => color.hex);

/** O `light-dark(clara, escura)` do estilo, separado. */
function variants(style: string): { light: string; dark: string } {
  const match = /^light-dark\((#[0-9A-F]{6}), (#[0-9A-F]{6})\)$/.exec(style);
  if (match === null) throw new Error(`Estilo inesperado: ${style}`);
  return { light: match[1], dark: match[2] };
}

describe("as superfícies de cada esquema (RN-CONFIG-003)", () => {
  it("são as fichas do globals.css: o fundo, o painel, a elevada e a linha selecionada de cada tema, separadas pelo esquema dele", () => {
    for (const kind of ["light", "dark"] as const) {
      const fromCss = new Set(themes.filter((theme) => theme.kind === kind).flatMap((theme) => surfaceTokens.map((token) => theme.palette[token])));

      expect(new Set(iconSurfaces[kind]), kind).toEqual(fromCss);
    }
  });
});

describe("readableIconColor e iconColorStyle (RN-PASTA-007 e RN-SCRIPT-006)", () => {
  it.each(themes.map((theme) => [theme.id, theme] as const))("as seis cores do canvas, e outras escolhidas, passam em 3:1 sobre as superfícies do tema %s", (_id, theme) => {
    for (const color of [...palette, "#000000", "#FFFFFF", "#222222", "#E6E6E6", "#808080", "#1D5FD1", "#FFFF00", "#8A2BE2"]) {
      const shown = variants(iconColorStyle(color))[theme.kind];

      for (const token of surfaceTokens) expect(contrast(shown.toLowerCase(), theme.palette[token]), `${color} sobre ${token}`).toBeGreaterThanOrEqual(iconContrast);
    }
  });

  it("a cor que já passa fica como é: as seis do canvas nos temas escuros, para que foram feitas", () => {
    for (const color of palette) expect(readableIconColor(color, "dark")).toBe(color);
  });

  it("nos temas claros a cor do canvas que não chega a 3:1 é escurecida o mínimo, no mesmo tom", () => {
    const amber = readableIconColor("#F2B644", "light");
    const [red, green, blue] = [1, 3, 5].map((at) => parseInt(amber.slice(at, at + 2), 16));

    // Escurecer é misturar com o preto: os canais encolhem na mesma proporção, e o âmbar continua âmbar (o vermelho na frente, o azul atrás).
    expect(red).toBeLessThan(0xf2);
    expect(red).toBeGreaterThan(green);
    expect(green).toBeGreaterThan(blue);
    expect(red / 0xf2).toBeCloseTo(green / 0xb6, 1);
    // O mínimo: sobre a superfície clara mais difícil ele fica logo acima de 3:1, e não num tom muito mais escuro que o preciso.
    const hardest = Math.min(...iconSurfaces.light.map((surface) => contrast(amber.toLowerCase(), surface)));
    expect(hardest).toBeGreaterThanOrEqual(iconContrast);
    expect(hardest).toBeLessThan(3.15);
  });

  it("antes da variante, o Âmbar do canvas não chega a 3:1 no Prism Claro: é por isso que ela existe", () => {
    expect(contrast("#f2b644", paletteOf("light").palette.background)).toBeLessThan(2);
  });

  it("nos temas escuros a cor escura que não chega a 3:1 é clareada", () => {
    const shown = readableIconColor("#222222", "dark");

    expect(shown).not.toBe("#222222");
    expect(parseInt(shown.slice(1, 3), 16)).toBeGreaterThan(0x22);
  });

  it("não depende da caixa da cor, e a resposta é a mesma a cada vez", () => {
    expect(iconColorStyle("#f2b644")).toBe(iconColorStyle("#F2B644"));
    expect(readableIconColor("#7db2ff", "light")).toBe(readableIconColor("#7DB2FF", "light"));
  });
});
