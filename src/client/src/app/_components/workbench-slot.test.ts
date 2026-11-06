import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pathsConfig } from "@/config/paths.config";

const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return { ...createHookRuntime(), route: { pathname: "/" } };
});
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("react-router", () => ({ useLocation: () => ({ pathname: rt.route.pathname }) }));

import { KeepAliveSlot, WorkbenchSlot } from "./workbench-slot";

afterEach(() => {
  rt.unmount();
});

/** A área de trabalho no lugar dela, vista de cada rota de dentro do cofre. */
function renderAt(path: string) {
  rt.unmount();
  rt.route.pathname = path;
  return renderToStaticMarkup(rt.render(() => WorkbenchSlot({ children: createElement("main", { id: "area" }, "a área de trabalho") })));
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

  it("com mountOnFirstVisit (RN-CONSTRUIR-001), nada é desenhado antes da primeira visita; depois de visitar, sair da rota deixa hidden e inert", () => {
    const renderBuild = (pathname: string) => {
      rt.route.pathname = pathname;
      return renderToStaticMarkup(rt.render(() => KeepAliveSlot({ path: pathsConfig.build, mountOnFirstVisit: true, children: createElement("main", { id: "build" }, "construir") })));
    };

    expect(renderBuild(pathsConfig.workbench)).toBe("");

    const active = renderBuild(pathsConfig.build);
    expect(active).toContain('<main id="build">construir</main>');
    expect(active).not.toMatch(/\bhidden\b/);
    expect(active).not.toMatch(/\binert\b/);

    const hidden = renderBuild(pathsConfig.workbench);
    expect(hidden).toContain('<main id="build">construir</main>');
    expect(hidden).toMatch(/<div[^>]*\bhidden=""/);
    expect(hidden).toMatch(/<div[^>]*\binert=""/);
  });
});
