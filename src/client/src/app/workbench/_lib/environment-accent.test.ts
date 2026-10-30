import type { CSSProperties } from "react";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

import { connectionsCopy } from "@/app/connections/_lib/connections.copy";
import { themeModes } from "@/app/settings/_lib/preferences";
import type { ThemeId } from "@/app/settings/_lib/theme";
import { iconColorStyle } from "@/components/ui";
import { iconSurfaces } from "@/components/ui/icon-color";
import { cn } from "@/lib/utils/cn";
import { contrast } from "@/lib/testing/contrast";
import { css, paletteOf } from "@/lib/testing/theme-palettes";

import { environmentAccent, environmentColorStyle } from "./environment-accent";

// A cor do ambiente nos destaques da área de resultado (RN-AMB-002). O vitest não tem DOM: o que se prova aqui é o que a função devolve, o contraste que a cor
// tem em cada tema, a reserva de cada classe e o CSS que o Tailwind gera para ela. O valor calculado na tela se confere no app (`getComputedStyle`).

const variable = "--environment-color";
const themes = themeModes.filter((mode): mode is ThemeId => mode !== "system").map((id) => ({ id, ...paletteOf(id) }));
const surfaceTokens = ["background", "panel", "raised", "selected"] as const;
const canvas = connectionsCopy.colors.map((color) => color.hex);

/** O valor da variável de uma cor válida. */
function valueOf(color: string): string {
  const value = environmentColorStyle(color)?.[variable as keyof CSSProperties];
  if (typeof value !== "string") throw new Error(`Sem variável para ${color}.`);
  return value;
}

/** O `light-dark(clara, escura)` do valor da variável, separado. */
function variants(value: string): { light: string; dark: string } {
  const match = /^light-dark\((#[0-9A-F]{6}), (#[0-9A-F]{6})\)$/.exec(value);
  if (match === null) throw new Error(`Valor inesperado: ${value}`);
  return { light: match[1], dark: match[2] };
}

describe("environmentColorStyle: só uma cor #RRGGBB vira a variável (RN-AMB-002)", () => {
  it.each([
    ["nula", null],
    ["ausente", undefined],
    ["vazia", ""],
    ["só espaços", "   "],
    ["com cinco dígitos", "#12345"],
    ["com sete dígitos", "#1234567"],
    ["com oito dígitos (alfa)", "#FF8A7AFF"],
    ["no formato curto de três dígitos", "#F8A"],
    ["sem o jogo da velha", "FF8A7A"],
    ["um nome de cor", "red"],
    ["com dígito fora do hexadecimal", "#GGGGGG"],
    ["com espaço antes", " #FF8A7A"],
    ["com espaço depois", "#FF8A7A "],
    ["com quebra de linha no fim", "#FF8A7A\n"],
    ["com mais CSS atrás", "#FF8A7A;background:red"],
    ["função de cor", "rgb(255, 138, 122)"],
    ["referência a outra variável", "var(--color-danger)"],
    ["endereço", "url(https://exemplo.test/a.png)"],
    ["a própria função light-dark", "light-dark(#FF8A7A, #FF8A7A)"],
  ] as const)("%s não vira variável nenhuma: tudo fica como no tema", (_name, color) => {
    expect(environmentColorStyle(color)).toBeUndefined();
  });

  it("uma cor válida vira a variável de estilo, com as duas variantes do ícone colorido (RN-PASTA-007), e nada mais", () => {
    const style = environmentColorStyle("#FF8A7A");

    expect(style).toEqual({ [variable]: "light-dark(#C46A5E, #FF8A7A)" });
    expect(Object.keys(style ?? {})).toEqual([variable]);
  });

  it("é o mesmo ajuste do ícone, para a mesma cor: a pasta e o script são pintados pela mesma conta", () => {
    for (const color of [...canvas, "#1B2A80", "#000000", "#FFFFFF"]) expect(environmentColorStyle(color)).toEqual({ [variable]: iconColorStyle(color) });
  });

  it("a caixa das letras não muda a cor: minúsculas e maiúsculas dão o mesmo valor", () => {
    expect(environmentColorStyle("#ff8a7a")).toEqual(environmentColorStyle("#FF8A7A"));
    expect(environmentColorStyle("#Ff8A7a")).toEqual(environmentColorStyle("#FF8A7A"));
    expect(environmentColorStyle("#f2b644")).toEqual({ [variable]: "light-dark(#A77E2F, #F2B644)" });
  });

  it("devolve um objeto novo a cada chamada, que a área pode juntar ao `style` de quem a chama sem mexer no de ninguém", () => {
    const first = environmentColorStyle("#FF8A7A");
    const second = environmentColorStyle("#FF8A7A");

    expect(first).not.toBe(second);
    (first as Record<string, string>)[variable] = "outra";
    expect(environmentColorStyle("#FF8A7A")).toEqual({ [variable]: "light-dark(#C46A5E, #FF8A7A)" });
  });
});

describe("a cor do ambiente passa em 3:1 sobre as superfícies de todos os temas (RN-CONFIG-003)", () => {
  // As seis do canvas (claras, feitas para os temas escuros), o azul-marinho (que some num tema escuro), o preto e o branco: os extremos.
  const colors = [...canvas, "#1B2A80", "#000000", "#FFFFFF", "#808080", "#222222", "#FFFF00"];

  it.each(themes.map((theme) => [theme.id, theme] as const))("no tema %s: a variante do esquema dele, sobre o fundo, o painel, a elevada e a selecionada", (_id, theme) => {
    for (const color of colors) {
      const shown = variants(valueOf(color))[theme.kind].toLowerCase();

      for (const token of surfaceTokens) expect(contrast(shown, theme.palette[token]), `${color} sobre ${token}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("e sobre cada superfície que o ícone conhece (`iconSurfaces`), nas duas variantes", () => {
    for (const color of colors) {
      const value = valueOf(color);

      for (const scheme of ["light", "dark"] as const) {
        for (const surface of iconSurfaces[scheme]) expect(contrast(variants(value)[scheme].toLowerCase(), surface), `${color}, ${scheme}, ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("a cor que já passa fica como a pessoa a escolheu: as seis do canvas, no tema escuro; as demais mudam só o que falta", () => {
    for (const color of canvas) expect(variants(valueOf(color)).dark).toBe(color);
    expect(variants(iconColorStyle("#1B2A80")).light).toBe("#1B2A80");
    expect(variants(iconColorStyle("#1B2A80")).dark).not.toBe("#1B2A80");
  });
});

describe("environmentAccent: cada classe lê a variável com o tema como reserva (RN-AMB-002)", () => {
  const classes = Object.entries(environmentAccent);

  it("é uma classe só em cada uma (sem espaço), e nenhuma traz cor fixa", () => {
    for (const [name, value] of classes) {
      expect(value, name).not.toMatch(/\s/);
      expect(value, name).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(value, name).not.toMatch(/rgb|hsl|oklch/i);
    }
  });

  it("lê a variável que `environmentColorStyle` põe, com a vírgula da reserva logo atrás do nome", () => {
    const [name] = Object.keys(environmentColorStyle("#FF8A7A") ?? {});

    expect(name).toBe(variable);
    for (const [key, value] of classes) expect(value, key).toContain(`var(${name},var(--color-`);
  });

  it("os sublinhados, o contorno da célula e o anel do foco caem no acento do tema, que é o que eram", () => {
    expect(environmentAccent.border).toBe("border-[color:var(--environment-color,var(--color-accent))]");
    expect(environmentAccent.outline).toBe("outline-[color:var(--environment-color,var(--color-accent))]");
    expect(environmentAccent.focusOutline).toBe("focus-visible:outline-[color:var(--environment-color,var(--color-accent))]");
  });

  it("a barra de rolagem cai na cor de rolagem do tema sobre o painel, e NÃO no acento: sem ambiente ela não ganha cor nenhuma", () => {
    expect(environmentAccent.scrollbar).toBe("[scrollbar-color:var(--environment-color,var(--color-border-strong))_var(--color-panel)]");
    expect(environmentAccent.scrollbar).not.toContain("--color-accent");
  });

  it("a reserva da barra é, letra por letra, o `scrollbar-color` que o `:root` do globals.css dá a toda a página", () => {
    const root = /:root\s*\{[^}]*?scrollbar-color:\s*([^;]+);/.exec(css)?.[1];
    const reserve = /^\[scrollbar-color:var\(--environment-color,(var\([^)]+\))\)_(var\([^)]+\))\]$/.exec(environmentAccent.scrollbar);

    expect(root).toBeDefined();
    expect(reserve).not.toBeNull();
    expect(`${reserve?.[1]} ${reserve?.[2]}`).toBe(root);
  });

  it("as fichas da reserva existem no globals.css, e a variável do ambiente NÃO é uma ficha dele (não é token, não tem as duas colunas)", () => {
    for (const token of ["accent", "border-strong", "panel"]) expect(css).toMatch(new RegExp(`--color-${token}:\\s*light-dark\\(`));
    expect(css).not.toContain(variable);
  });

  it("o tailwind-merge do `cn` não derruba uma pela outra: a largura e a cor da borda, o contorno e o recuo, e o que cada lugar já tinha", () => {
    const merged = cn("flex h-7 border-b-2 px-2", environmentAccent.border, "font-semibold text-ink");
    expect(merged.split(" ")).toEqual(expect.arrayContaining(["border-b-2", environmentAccent.border]));

    const rightAligned = "text-right";
    const field = cn("h-6 rounded-sm border bg-background text-ink outline-none", environmentAccent.border, rightAligned);
    expect(field.split(" ")).toEqual(expect.arrayContaining(["border", environmentAccent.border, "outline-none"]));

    const cell = cn("bg-selected", `outline-2 -outline-offset-2 ${environmentAccent.outline}`, "text-danger line-through");
    expect(cell.split(" ")).toEqual(expect.arrayContaining(["outline-2", "-outline-offset-2", environmentAccent.outline, "text-danger"]));

    // E as classes de outro destaque na mesma lista não se confundem com as dele.
    const mixed = cn(environmentAccent.border, "border-transparent");
    expect(mixed).toBe("border-transparent");
  });
});

describe("environmentAccent: o CSS que o Tailwind gera para cada classe", () => {
  /** O CSS dos candidatos, sem folha nenhuma: só as utilidades. */
  async function generated(...candidates: string[]): Promise<string> {
    const compiler = await compile("@tailwind utilities;", {
      base: "/",
      loadStylesheet: () => {
        throw new Error("Sem folha de estilo nestes testes.");
      },
    });
    return compiler.build(candidates);
  }

  /** As regras do CSS gerado, sem o comentário da licença: o seletor e o corpo de cada uma, com os espaços colapsados. */
  const rulesOf = (sheet: string) => [...sheet.replace(/\/\*[^]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((rule) => ({ selector: rule[1].trim(), body: rule[2].replace(/\s+/g, " ").trim() }));

  it("a borda é UMA regra de `border-color`: só a cor, na variável com o acento como reserva", async () => {
    const rules = rulesOf(await generated(environmentAccent.border));

    expect(rules.map((rule) => rule.body)).toEqual(["border-color: var(--environment-color,var(--color-accent));"]);
    expect(rules[0].selector.endsWith("]")).toBe(true);
  });

  it("o contorno é UMA regra de `outline-color`: só a cor (a espessura é de `outline-2`, e o recuo, de `-outline-offset-2`)", async () => {
    const rules = rulesOf(await generated(environmentAccent.outline));

    expect(rules.map((rule) => rule.body)).toEqual(["outline-color: var(--environment-color,var(--color-accent));"]);
    expect(rules[0].selector.endsWith(":focus-visible")).toBe(false);
  });

  it("o anel do foco é UMA regra de `outline-color`, só em `:focus-visible`: a espessura e o recuo são os do globals.css e da caixa", async () => {
    const rules = rulesOf(await generated(environmentAccent.focusOutline));

    expect(rules.map((rule) => rule.body)).toEqual(["outline-color: var(--environment-color,var(--color-accent));"]);
    expect(rules[0].selector.endsWith(":focus-visible")).toBe(true);
  });

  it("a barra de rolagem é UMA regra de `scrollbar-color` de duas cores: a da variável (ou a do tema) e a do painel", async () => {
    expect(rulesOf(await generated(environmentAccent.scrollbar)).map((rule) => rule.body)).toEqual(["scrollbar-color: var(--environment-color,var(--color-border-strong)) var(--color-panel);"]);
  });

  it("as classes que os lugares já usam continuam gerando o que geravam (a espessura, o recuo negativo)", async () => {
    const sheet = await generated("border-b-2", "outline-2", "-outline-offset-2");

    expect(sheet).toContain("border-bottom-width: 2px;");
    expect(sheet).toContain("outline-width: 2px;");
    expect(sheet).toContain("outline-offset: calc(2px * -1);");
  });
});
