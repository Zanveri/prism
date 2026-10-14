import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { elementsOf } from "@/lib/testing/react-tree";

import { FirstUse } from "./first-use";

const render = () => renderToStaticMarkup(createElement(FirstUse, { onNewConnection: () => {} }));

describe("o primeiro uso (RN-NAV-007): sem nenhuma conexão, a área de trabalho mostra o estado vazio com 'Nova conexão'", () => {
  it("diz que não há conexão e o que fazer", () => {
    const markup = render();

    expect(markup).toMatch(/<h2[^>]*>Nenhuma conexão salva<\/h2>/);
    expect(markup).toContain("Crie a primeira conexão");
  });

  it("'Nova conexão' é o botão principal da tela, e abre o diálogo de nova conexão (na raiz)", () => {
    const button = /<button [^>]*>[\s\S]*?<\/button>/.exec(render())?.[0] ?? "";
    expect(button).toMatch(/class="[^"]*\bbg-accent\b/);
    expect(button).toMatch(/>Nova conexão<\/button>$/);

    const onNewConnection = vi.fn();
    (elementsOf(FirstUse({ onNewConnection })).find((element) => element.type !== "div" && typeof element.props.onClick === "function")?.props.onClick as () => void)();
    expect(onNewConnection).toHaveBeenCalledOnce();
  });

  // A raiz do app não rola: numa janela baixa, o estado vazio rola por dentro, e o centro "seguro" não esconde o topo do que passou da altura.
  it("rola por dentro quando a janela é baixa, sem perder o topo", () => {
    const root = /^<div class="([^"]*)"/.exec(render())?.[1].split(" ") ?? [];

    expect(root).toEqual(expect.arrayContaining(["min-h-0", "overflow-y-auto", "justify-center-safe"]));
    expect(root).not.toContain("justify-center");
  });
});
