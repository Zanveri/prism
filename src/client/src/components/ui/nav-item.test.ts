import { describe, expect, it } from "vitest";

import { navItem } from "./nav-item";

describe("navItem: a entrada de uma lista de navegação (Configurações, seções da Estrutura)", () => {
  it("a escolhida tem o destaque da seleção: fundo `selected`, negrito e o texto forte", () => {
    const classes = navItem({ active: true }).split(" ");

    for (const token of ["bg-selected", "font-semibold", "text-ink"]) expect(classes, token).toContain(token);
    expect(classes).not.toContain("text-muted");
  });

  it("as outras ficam apagadas e acendem com o mouse, sem o negrito", () => {
    const classes = navItem({ active: false }).split(" ");

    expect(classes).toContain("text-muted");
    expect(classes).toContain("hover:bg-selected");
    expect(classes).toContain("hover:text-ink");
    expect(classes).not.toContain("bg-selected");
    expect(classes).not.toContain("font-semibold");
  });

  it("a medida é a mesma nas duas: altura de 40 px, cantos e preenchimento da lista de Configurações", () => {
    for (const active of [true, false]) {
      const classes = navItem({ active }).split(" ");

      for (const token of ["flex", "h-10", "items-center", "gap-2", "rounded-md", "px-3", "cursor-pointer"]) expect(classes, `${active}: ${token}`).toContain(token);
    }
  });

  it("sem argumento, a entrada é uma das outras", () => {
    expect(navItem()).toBe(navItem({ active: false }));
  });
});
