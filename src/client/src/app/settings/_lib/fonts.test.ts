import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { appFonts, appFontStacks, applyFonts, clearFonts, fontNameMaxLength, fontStack, fontVariables, isSafeFontName } from "./fonts";

const css = readFileSync(new URL("../../../styles/globals.css", import.meta.url), "utf8");

/** O `style` do <html> de mentira: só as propriedades que o código põe e tira. */
function fakeRoot(initial: Record<string, string> = {}) {
  const properties = new Map(Object.entries(initial));
  return {
    properties,
    style: {
      setProperty: (name: string, value: string) => void properties.set(name, value),
      removeProperty: (name: string) => {
        const old = properties.get(name) ?? "";
        properties.delete(name);
        return old;
      },
    },
  };
}

describe("o nome de uma fonte que pode virar CSS (RN-CONFIG-008)", () => {
  it.each(["IBM Plex Sans", "JetBrains Mono", "Noto Sans CJK JP", "Times New Roman", "MS ゴシック", "Source Han Sans 源ノ角ゴシック", "Fira Code Retina", "Segoe UI (Variable)", "Font-Name_2", "A".repeat(fontNameMaxLength)])("aceita %j", (name) => {
    expect(isSafeFontName(name)).toBe(true);
  });

  it.each([
    ["vazio", ""],
    ["só de espaços", "   "],
    ["com espaço na frente", " Arial"],
    ["com espaço atrás", "Arial "],
    ["comprido demais", "A".repeat(fontNameMaxLength + 1)],
    ["com aspas duplas, que fechariam o nome", 'Arial", sans-serif; color: red'],
    ["com aspas simples", "Arial'"],
    ["com ponto e vírgula, que terminaria a declaração", "Arial; background: url(x)"],
    ["com chave de abrir", "Arial{"],
    ["com chave de fechar, que fecharia a regra", 'Arial"} body { display: none } x {"'],
    ["com barra invertida, que escaparia a aspa do fim", "Arial\\"],
    ["com escape de CSS", "Arial\\22"],
    ["com quebra de linha, que termina a string do CSS", "Arial\nX"],
    ["com caractere nulo", "Arial\u0000"],
    ["com ESC", "Arial\u001b"],
    ["com DEL", "Arial\u007f"],
    ["com caractere de direção de texto", "‮Arial"],
    ["com caractere invisível", "Ari​al"],
  ])("recusa o nome %s", (_name, name) => {
    expect(isSafeFontName(name)).toBe(false);
  });

  it.each([null, undefined, 42, true, {}, ["Arial"]])("recusa o que não é texto: %j", (value) => {
    expect(isSafeFontName(value)).toBe(false);
  });
});

describe("a pilha de fontes", () => {
  it("a fonte do app é a pilha do app, sem nada na frente", () => {
    expect(fontStack("ui", appFonts.ui)).toBe(appFontStacks.ui);
    expect(fontStack("editor", appFonts.editor)).toBe(appFontStacks.editor);
  });

  it("a escolhida vem entre aspas, com a do app atrás: sem ela instalada, o texto cai na do app, sem erro", () => {
    expect(fontStack("ui", "Inter")).toBe('"Inter", var(--font-app-sans)');
    expect(fontStack("editor", "JetBrains Mono")).toBe('"JetBrains Mono", var(--font-mono)');
    expect(fontStack("editor", "Cascadia Mono")).toBe('"Cascadia Mono", var(--font-mono)');
  });

  it("um nome que é palavra do CSS vai entre aspas também: é o nome de uma fonte, e não a família genérica nem `inherit`", () => {
    expect(fontStack("editor", "monospace")).toBe('"monospace", var(--font-mono)');
    expect(fontStack("ui", "inherit")).toBe('"inherit", var(--font-app-sans)');
  });

  it("um nome que escaparia da `font-family` nunca chega ao CSS: vale a pilha do app", () => {
    for (const name of ['Arial", x; color: red', "Arial}", "Arial\\", "Arial;", "Arial\n"]) {
      expect(fontStack("ui", name)).toBe(appFontStacks.ui);
      expect(fontStack("editor", name)).toBe(appFontStacks.editor);
    }
  });

  it("a fonte do app é a primeira das pilhas do CSS, e a da interface tem a reserva à parte (a variável da interface é trocada, a reserva não)", () => {
    expect(css).toMatch(/--font-app-sans:\s*"IBM Plex Sans",/);
    expect(css).toMatch(/--font-sans:\s*var\(--font-app-sans\);/);
    expect(css).toMatch(/--font-mono:\s*"IBM Plex Mono",/);
    expect(css).toMatch(/--font-editor:\s*var\(--font-mono\);/);
    expect(appFonts).toEqual({ ui: "IBM Plex Sans", editor: "IBM Plex Mono" });
  });
});

describe("aplicar as fontes no <html>", () => {
  it("põe a pilha de cada escolha na variável dela: a da interface em --font-sans, a do editor em --font-editor", () => {
    const root = fakeRoot();

    applyFonts({ ui: "Inter", editor: "JetBrains Mono" }, root);

    expect(Object.fromEntries(root.properties)).toEqual({ [fontVariables.ui]: '"Inter", var(--font-app-sans)', [fontVariables.editor]: '"JetBrains Mono", var(--font-mono)' });
    expect(fontVariables).toEqual({ ui: "--font-sans", editor: "--font-editor" });
  });

  it("a fonte do app tira a variável: vale a do CSS", () => {
    const root = fakeRoot({ "--font-sans": '"Inter", var(--font-app-sans)', "--font-editor": '"Consolas", var(--font-mono)' });

    applyFonts({ ui: appFonts.ui, editor: "Consolas" }, root);

    expect(Object.fromEntries(root.properties)).toEqual({ "--font-editor": '"Consolas", var(--font-mono)' });
  });

  it("um nome que não serve tira a variável, e não escreve nada dele", () => {
    const root = fakeRoot({ "--font-sans": '"Inter", var(--font-app-sans)' });

    applyFonts({ ui: 'x"; }', editor: "Arial\\" }, root);

    expect(root.properties.size).toBe(0);
  });

  it("limpar devolve as duas à fonte do app", () => {
    const root = fakeRoot({ "--font-sans": '"Inter", var(--font-app-sans)', "--font-editor": '"Consolas", var(--font-mono)', "--outra": "1" });

    clearFonts(root);

    expect(Object.fromEntries(root.properties)).toEqual({ "--outra": "1" });
  });
});
