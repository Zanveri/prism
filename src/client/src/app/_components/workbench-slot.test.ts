import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { pathsConfig } from "@/config/paths.config";

import { WorkbenchSlot } from "./workbench-slot";

/** A área de trabalho no lugar dela, vista de cada rota de dentro do cofre. */
function renderAt(path: string) {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [path] }, createElement(WorkbenchSlot, null, createElement("main", { id: "area" }, "a área de trabalho"))));
}

describe("a área de trabalho fica montada por baixo das outras telas do cofre (achado 4 da revisão)", () => {
  // A outra tela de dentro do cofre (o formulário de conexão é um diálogo sobre a área de trabalho, RN-NAV-004).
  const hiddenPaths = [pathsConfig.settings];

  it.each([pathsConfig.workbench, ...hiddenPaths])("em %s ela está montada: o conteúdo está no documento", (path) => {
    expect(renderAt(path)).toContain('<main id="area">a área de trabalho</main>');
  });

  it("na rota dela está visível e ativa: sem hidden e sem inert", () => {
    const markup = renderAt(pathsConfig.workbench);

    expect(markup).not.toMatch(/\bhidden\b/);
    expect(markup).not.toMatch(/\binert\b/);
  });

  it.each(hiddenPaths)("em %s ela fica escondida e inerte: some da tela, da ordem do teclado e do leitor de tela", (path) => {
    const markup = renderAt(path);

    expect(markup).toMatch(/<div[^>]*\bhidden=""/);
    expect(markup).toMatch(/<div[^>]*\binert=""/);
  });

  it("o invólucro ocupa a altura toda, para a área de trabalho continuar a ser a tela inteira", () => {
    expect(renderAt(pathsConfig.workbench)).toMatch(/<div[^>]*class="h-full"/);
  });
});
