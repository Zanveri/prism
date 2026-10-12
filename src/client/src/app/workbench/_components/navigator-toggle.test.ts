import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { elementsOf } from "@/lib/testing/react-tree";

import { NavigatorToggle } from "./navigator-toggle";

const render = (hidden: boolean) => renderToStaticMarkup(createElement(NavigatorToggle, { hidden, controls: "nav-1", shortcut: "Ctrl+B", onToggle: () => {} }));
const tag = (markup: string) => /<button [^>]*>/.exec(markup)?.[0] ?? "";

describe("o botão do navegador na barra superior (RN-NAV-008): sempre à vista, inclusive com ele escondido", () => {
  it("é um botão de alternar com nome fixo: pressionado com o navegador à mostra, solto com ele escondido", () => {
    expect(tag(render(false))).toContain('aria-pressed="true"');
    expect(tag(render(true))).toContain('aria-pressed="false"');
    for (const hidden of [true, false]) expect(tag(render(hidden))).toContain('aria-label="Mostrar o navegador"');
  });

  it("diz o que controla, e a dica diz o que o clique faz agora, com o atalho", () => {
    expect(tag(render(false))).toContain('aria-controls="nav-1"');
    expect(tag(render(false))).toContain('title="Esconder o navegador (Ctrl+B)"');
    expect(tag(render(true))).toContain('title="Mostrar o navegador (Ctrl+B)"');
  });

  it("só o desenho dentro, escondido do leitor de tela", () => {
    expect(render(false)).toMatch(/<button [^>]*><svg[^>]*aria-hidden="true"[\s\S]*<\/svg><\/button>/);
  });

  it("o clique alterna", () => {
    const onToggle = vi.fn();
    (elementsOf(NavigatorToggle({ hidden: false, controls: "nav-1", shortcut: "Ctrl+B", onToggle })).find((element) => element.type === "button")?.props.onClick as () => void)();
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
