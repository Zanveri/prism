import { describe, expect, it } from "vitest";

import { appFontFamilies, appFonts, appFontStacks, fontNameMaxLength, fontStack, resolvedFontFamily, type FontRole } from "./fonts";

// A pilha do `canvas` que mede a grade (`resolvedFontFamily`) tem de ser, em todo caso, a pilha do CSS (`fontStack`) com as variáveis trocadas pelo que elas
// valem: se uma muda sem a outra, a grade mede uma fonte e a tela desenha outra (RN-CONFIG-008, seção 42).

const roles: FontRole[] = ["ui", "editor"];

/** A pilha do CSS com as variáveis escritas por extenso, como o `canvas` as quer. */
const spelledOut = (stack: string) => stack.replace(appFontStacks.ui, appFontFamilies.ui).replace(appFontStacks.editor, appFontFamilies.editor);

const names = [
  appFonts.ui,
  appFonts.editor,
  "Inter",
  "Segoe UI",
  "JetBrains Mono",
  "Noto Sans CJK JP",
  "Font, With Comma",
  "Fonte com (parênteses) e acentuação: Ação",
  "3270",
  "monospace",
  "inherit",
  "var(--font-sans)",
  "A".repeat(fontNameMaxLength),
  // Os que não servem: viram a pilha do app nos dois lados.
  "",
  " Inter",
  "Inter ",
  'Arial", x; color: red',
  "Arial}",
  "Arial\\",
  "Zero\u200bWidth",
  "Linha\nQuebrada",
  "A".repeat(fontNameMaxLength + 1),
];

describe("a pilha do canvas é a do CSS, com as variáveis por extenso", () => {
  it.each(roles.flatMap((role) => names.map((name) => [role, name] as const)))("%s, %j", (role, name) => {
    expect(resolvedFontFamily(role, name)).toBe(spelledOut(fontStack(role, name)));
  });

  it("nenhuma pilha do canvas tem var(), qualquer que seja o nome (um nome com 'var(' é só o nome de uma fonte, entre aspas)", () => {
    for (const role of roles) {
      for (const name of names) {
        const stack = resolvedFontFamily(role, name);

        expect(stack.replaceAll(`"${name}"`, "")).not.toContain("var(");
      }
    }
  });

  it("o nome escolhido é uma família só, entre aspas, mesmo com vírgula, e a pilha do app vem depois dele sem mexer em nada", () => {
    const stack = resolvedFontFamily("ui", "Font, With Comma");

    expect(stack).toBe(`"Font, With Comma", ${appFontFamilies.ui}`);
    expect(stack.endsWith(appFontFamilies.ui)).toBe(true);
  });

  it("a fonte do app e o nome que não serve têm a mesma pilha (a do app), e a escolhida acrescenta uma família na frente, só", () => {
    for (const role of roles) {
      expect(resolvedFontFamily(role, appFonts[role])).toBe(appFontFamilies[role]);
      expect(resolvedFontFamily(role, 'Arial", x')).toBe(appFontFamilies[role]);
      expect(resolvedFontFamily(role, "Inter").split(", ").length).toBe(appFontFamilies[role].split(", ").length + 1);
    }
  });

  it("a fonte do editor do app não vale como a da interface (e a da interface não vale como a do editor): são pilhas diferentes", () => {
    expect(resolvedFontFamily("ui", appFonts.editor)).not.toBe(appFontFamilies.ui);
    expect(resolvedFontFamily("editor", appFonts.ui)).not.toBe(appFontFamilies.editor);
  });
});
