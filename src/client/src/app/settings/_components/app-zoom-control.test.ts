import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui";
import { elementsOf } from "@/lib/testing/react-tree";

import type { AppZoom } from "../../../../electron/zoom";
import { AppZoomView } from "./app-zoom-control";

const controlsOf = (zoom: AppZoom, onStep = vi.fn()) => {
  const found = elementsOf(AppZoomView({ zoom, modifier: "Ctrl", onStep }));
  const buttons = found.filter((element) => element.type === "button" || element.type === Button);
  return { buttons, onStep, output: found.find((element) => element.type === "output") };
};

describe("o zoom do programa em Configurações › Aparência (RN-ZOOM-001)", () => {
  it("um grupo com o rótulo e a dica, diminuir e aumentar com nome para leitor de tela, o valor de agora (lido quando muda) e \"Restaurar 100%\"", () => {
    const markup = renderToStaticMarkup(createElement(AppZoomView, { zoom: 125, modifier: "Ctrl", onStep: () => {} }));

    expect(markup).toContain('<span id="cfg-zoom-rotulo" class="text-sm text-muted">Zoom do programa</span>');
    expect(markup).toMatch(/<div role="group" aria-labelledby="cfg-zoom-rotulo" aria-describedby="cfg-zoom-dica"/);
    expect([...markup.matchAll(/<button [^>]*aria-label="([^"]*)"/g)].map((match) => match[1])).toEqual(["Diminuir o zoom do programa", "Aumentar o zoom do programa"]);
    expect(markup).toMatch(/<output aria-live="polite"[^>]*>125%<\/output>/);
    expect(markup).toMatch(/<button [^>]*>Restaurar 100%<\/button>/);
  });

  it("a dica diz os atalhos com a tecla da plataforma, e que o zoom vale para todas as janelas e para quem entra nesta conta do computador (a pasta de dados é da conta, e não da máquina)", () => {
    expect(renderToStaticMarkup(createElement(AppZoomView, { zoom: 100, modifier: "Cmd", onStep: () => {} }))).toContain(
      "Cmd + e Cmd − mudam o zoom em qualquer tela, e Cmd 0 volta a 100%. Vale para todas as janelas, já na abertura, e para todos que entram no Prism nesta conta do computador, não só para você.",
    );
  });

  it("diminuir, aumentar e restaurar pedem o passo; quem calcula o valor e o aplica é quem recebe", () => {
    const { buttons, onStep, output } = controlsOf(110);
    for (const button of buttons) (button.props.onClick as () => void)();

    expect(onStep.mock.calls).toEqual([["out"], ["in"], ["reset"]]);
    expect(output?.props.children).toBe("110%");
  });

  it("no menor, diminuir fica desabilitado; no maior, aumentar; em 100%, o \"Restaurar\"", () => {
    const disabled = (zoom: AppZoom) => controlsOf(zoom).buttons.map((button) => button.props["aria-disabled"] === true);

    expect(disabled(50)).toEqual([true, false, false]);
    expect(disabled(200)).toEqual([false, true, false]);
    expect(disabled(100)).toEqual([false, false, true]);
    expect(disabled(67)).toEqual([false, false, false]);
  });

  it("desabilitado SEM sair do teclado: `aria-disabled`, e não `disabled` (o \"Restaurar\" que se desabilita ao ser usado, e o − e o + ao chegar ao limite, não perdem o foco), e o clique nele não pede nada", () => {
    for (const zoom of [50, 100, 200] as const) {
      const { buttons, onStep } = controlsOf(zoom);
      for (const button of buttons) {
        expect(button.props.disabled).toBeUndefined();
        if (button.props["aria-disabled"] === true) (button.props.onClick as () => void)();
      }
      expect(onStep, String(zoom)).not.toHaveBeenCalled();
    }

    const markup = renderToStaticMarkup(createElement(AppZoomView, { zoom: 100, modifier: "Ctrl", onStep: () => {} }));
    expect(markup).not.toMatch(/<button [^>]*disabled=""/);
    expect(markup).toMatch(/<button [^>]*aria-disabled="true"[^>]*>Restaurar 100%<\/button>/);
  });
});
