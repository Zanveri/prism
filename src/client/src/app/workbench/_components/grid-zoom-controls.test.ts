import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GridZoom } from "@/app/settings/_lib/preferences";
import { elementsOf } from "@/lib/testing/react-tree";

import { GridZoomControls } from "./grid-zoom-controls";

const buttonsOf = (zoom: GridZoom, onZoom = vi.fn()) => {
  const tree = GridZoomControls({ zoom, onZoom });
  return { buttons: elementsOf(tree).filter((element) => element.type === "button"), onZoom };
};

describe("os controles do zoom na barra do resultado (RN-GRADE-010)", () => {
  it("um grupo com nome, e três botões com nome para leitor de tela: diminuir, o valor (que volta a 100%) e aumentar", () => {
    const markup = renderToStaticMarkup(createElement(GridZoomControls, { zoom: 125, onZoom: () => {} }));

    expect(markup).toMatch(/^<div role="group" aria-label="Zoom da grade"/);
    expect([...markup.matchAll(/<button [^>]*aria-label="([^"]*)"/g)].map((match) => match[1])).toEqual(["Diminuir o zoom da grade", "Zoom da grade em 125%. Voltar a 100%", "Aumentar o zoom da grade"]);
    expect(markup).toMatch(/<button [^>]*>125%<\/button>/);
  });

  it("diminuir e aumentar andam um passo, e o valor volta a 100%", () => {
    const { buttons, onZoom } = buttonsOf(125);
    for (const button of buttons) (button.props.onClick as () => void)();

    expect(onZoom.mock.calls).toEqual([[110], [100], [150]]);
  });

  it("no menor, diminuir fica desabilitado; no maior, aumentar", () => {
    expect(buttonsOf(50).buttons.map((button) => button.props.disabled ?? false)).toEqual([true, false, false]);
    expect(buttonsOf(200).buttons.map((button) => button.props.disabled ?? false)).toEqual([false, false, true]);
    expect(buttonsOf(100).buttons.map((button) => button.props.disabled ?? false)).toEqual([false, false, false]);
  });
});

describe("as medidas (RN-ABAS-009)", () => {
  it("na barra da área de resultado da aba de consulta, 24 px; nos Registros (o padrão), 28 px", () => {
    const sizes = (markup: string) => [...markup.matchAll(/<button [^>]*class="([^"]*)"/g)].map((match) => match[1].split(" ").filter((token) => /^(size|h)-\d+$/.test(token)));

    expect(sizes(renderToStaticMarkup(createElement(GridZoomControls, { zoom: 100, onZoom: () => {}, size: "bar" })))).toEqual([["size-6"], ["h-6"], ["size-6"]]);
    expect(sizes(renderToStaticMarkup(createElement(GridZoomControls, { zoom: 100, onZoom: () => {} })))).toEqual([["size-7"], ["h-7"], ["size-7"]]);
  });
});
