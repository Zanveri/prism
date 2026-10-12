import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SignInPage } from "./page";

// O `ToastProvider` desenha num portal em `document.body`, que o renderizador de servidor não tem: os formulários só
// precisam de um `useToast` que não faça nada.
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));

const bridge = (version: string) => ({ getApiConfig: async () => ({ baseUrl: "", token: "" }), onApiExit: () => () => {}, restartApi: async () => {}, version });

function renderSignIn() {
  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(MemoryRouter, null, createElement(SignInPage))));
}

/** O texto do elemento que mostra a versão (`data-app-version`), ou `null` se a tela não tem esse elemento. */
function shownVersion(markup: string) {
  return /<span[^>]*\bdata-app-version\b[^>]*>([^<]*)<\/span>/.exec(markup)?.[1] ?? null;
}

describe("tela de login: a versão do app (RN-VERSAO-004)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra a versão que a ponte entrega, ao lado do nome", () => {
    vi.stubGlobal("window", { prism: bridge("0.1.0") });

    expect(shownVersion(renderSignIn())).toBe("versão 0.1.0");
  });

  it("sem versão na ponte, a tela não tem o elemento da versão", () => {
    vi.stubGlobal("window", { prism: bridge("") });

    expect(shownVersion(renderSignIn())).toBeNull();
  });
});

describe("tela de login: a marca no tema claro (RN-MARCA-006)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("o painel da ilustração fica sobre o palco escuro, nos dois temas, e o do formulário segue o tema", () => {
    vi.stubGlobal("window", { prism: bridge("0.1.0") });
    const markup = renderSignIn();

    // A marca (o título e a ilustração) está dentro do palco; o formulário, não.
    expect(markup).toMatch(/<section class="stage-dark [^"]*">.*?<h1[^>]*>.*?<\/h1>/);
    expect(markup).toMatch(/<section class="[^"]*border-l[^"]*bg-panel[^"]*">/);
    expect(markup.match(/stage-dark/g)).toHaveLength(1);
  });

  it("a ilustração continua inteira sobre o palco: o desenho de assets/, com o raio, o prisma, as três faixas e os três cilindros (RN-MARCA-007)", () => {
    vi.stubGlobal("window", { prism: bridge("0.1.0") });
    const markup = renderSignIn();
    const illustration = markup.slice(markup.indexOf('<svg viewBox="0 0 720 360"'));
    // Os traços vêm do arquivo, e não de uma cópia aqui: a marca só existe em `assets/`.
    const strokes = [...readFileSync(new URL("../../../../../assets/prism-logo.svg", import.meta.url), "utf8").matchAll(/\sd="([^"]+)"/g)].map((match) => match[1]);

    expect(strokes).toHaveLength(24);
    for (const stroke of strokes) expect(illustration).toContain(`d="${stroke}"`);
    expect(illustration.match(/<ellipse/g)).toHaveLength(3);
  });
});

describe("tela de login: as atualizações (RN-ATUALIZA-002)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("'Verificar atualizações' fica junto da versão, antes de qualquer cofre aberto", () => {
    vi.stubGlobal("window", { prism: bridge("0.1.0") });

    expect(renderSignIn()).toMatch(/<span[^>]*\bdata-app-version\b[^>]*>versão 0\.1\.0<\/span><button[^>]*\bdata-check-updates\b[^>]*>Verificar atualizações<\/button>/);
  });
});
