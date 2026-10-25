import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { elementsOf } from "@/lib/testing/react-tree";

import { FirstUse } from "./first-use";

const noop = () => {};
const render = () => renderToStaticMarkup(createElement(FirstUse, { onNewConnection: noop, onImportPrism: noop, onImportDbeaver: noop }));

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
    (elementsOf(FirstUse({ onNewConnection, onImportPrism: noop, onImportDbeaver: noop })).find((element) => element.type !== "div" && typeof element.props.onClick === "function")?.props.onClick as () => void)();
    expect(onNewConnection).toHaveBeenCalledOnce();
  });

  // A raiz do app não rola: numa janela baixa, o estado vazio rola por dentro, e o centro "seguro" não esconde o topo do que passou da altura.
  it("rola por dentro quando a janela é baixa, sem perder o topo", () => {
    const root = /^<div class="([^"]*)"/.exec(render())?.[1].split(" ") ?? [];

    expect(root).toEqual(expect.arrayContaining(["min-h-0", "overflow-y-auto", "justify-center-safe"]));
    expect(root).not.toContain("justify-center");
  });

  // RN-NAV-007 e RN-DBEAVER-003: os atalhos para trazer as conexões de outro lugar. Fora do app (aqui não há ponte), o do DBeaver fica desabilitado, com o motivo.
  it("tem 'Importar conexões…' e 'Importar do DBeaver…', cada um com a sua ação; o do DBeaver, desabilitado fora do app, com a dica", () => {
    const onImportPrism = vi.fn();
    const onImportDbeaver = vi.fn();
    const buttons = elementsOf(FirstUse({ onNewConnection: noop, onImportPrism, onImportDbeaver })).filter((element) => typeof element.props.onClick === "function");

    expect(buttons.map((button) => button.props.children).flat().filter((child) => typeof child === "string")).toEqual(["Nova conexão", "Importar conexões…", "Importar do DBeaver…"]);
    (buttons[1].props.onClick as () => void)();
    (buttons[2].props.onClick as () => void)();
    expect([onImportPrism.mock.calls.length, onImportDbeaver.mock.calls.length]).toEqual([1, 1]);
    expect(buttons[2].props.disabled).toBe(true);
    expect(buttons[2].props.title).toBe("Importar do DBeaver só funciona no app do Prism.");
    expect(buttons[1].props.disabled).toBeUndefined();
  });
});
