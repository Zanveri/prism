import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { driversQuery } from "@/app/drivers/_lib/drivers.service";
import type { Driver } from "@/app/drivers/_lib/drivers.schema";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { stripTags } from "@/lib/testing/text";

import { TopBar } from "./top-bar";

// O `ToastProvider` desenha num portal em `document.body`, que o renderizador de servidor não tem: "Verificar atualizações"
// e o diálogo de versão nova só precisam de um `useToast` que não faça nada.
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));

const ibm: Driver = {
  id: "ibm-data-server",
  name: "IBM Data Server",
  vendor: "IBM",
  engines: [2, 3],
  state: "installed",
  version: "12.1.3",
  sizeBytes: 115343360,
  license: null,
  platformNote: null,
  progress: null,
  error: null,
  restartRequired: false,
};

function render(drivers?: Driver[], leading?: ReactNode) {
  const client = new QueryClient();
  client.setQueryData(sessionQuery.queryKey, { unlocked: true, userName: "ana" });
  if (drivers !== undefined) client.setQueryData(driversQuery.queryKey, drivers);

  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(TopBar, { leading }))));
}

describe("a barra superior", () => {
  it("sem Conexões e sem Drivers (RN-NAV-001): ficam o caminho de volta à área de trabalho e as Configurações, com ícone e texto como os outros (RN-CONFIG-002)", () => {
    const markup = render();

    // O texto de cada link, sem as marcas.
    expect([...markup.matchAll(/<a [^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map((match) => [match[1], stripTags(match[2])])).toEqual([
      ["/workbench", "Área de trabalho"],
      ["/settings", "Configurações"],
    ]);
    expect(markup).not.toContain("Conexões");
    expect(markup).not.toMatch(/>Drivers</);
  });

  it("o link das Configurações tem o ícone ao lado do texto e a dica do atalho (o nome acessível é o próprio texto)", () => {
    const link = /<a [^>]*href="\/settings"[^>]*>.*?<\/a>/.exec(render())?.[0];

    expect(link).toContain('title="Configurações (Ctrl+,)"');
    expect(link).toMatch(/<svg[^>]*aria-hidden="true"[\s\S]*<\/svg><span>Configurações<\/span>/);
    expect(link).not.toContain("aria-label");
  });

  it("cabe numa linha só em 1024 px (RN-CONFIG-002): sem quebra de linha, e o nome do usuário, que é o que encolhe, tem reticências e a dica com o nome inteiro", () => {
    const markup = render();

    expect(markup).not.toMatch(/<header[^>]*\bflex-wrap\b/);
    expect(markup).toMatch(/<span title="ana" class="truncate">ana<\/span>/);
  });

  it("é a barra da janela (RN-JANELA-001): arrasta a janela e deixa à direita o lugar dos botões do sistema (`window-bar`, em globals.css)", () => {
    expect(render()).toMatch(/<header class="window-bar /);
  });

  it("o lembrete de reinício pendente (RN-DRIVER-005) mora aqui, à vista em qualquer tela, e leva a Configurações › Drivers (o endereço de Drivers)", () => {
    const markup = render([{ ...ibm, restartRequired: true }]);
    const reminder = /<a [^>]*href="\/drivers"[^>]*>.*?<\/a>/.exec(markup)?.[0] ?? "";

    expect(reminder).toContain("<span>Reinício pendente</span>");
    expect(reminder).toContain('title="Um driver espera o reinício do serviço para valer. Abre Configurações › Drivers."');
    // O ícone é desenho; o nome é o texto.
    expect(reminder).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(render([ibm])).not.toContain("Reinício pendente");
  });

  it("sem a lista no cache (ninguém abriu Configurações › Drivers nem o formulário de conexão) não há lembrete, e a barra não a pede à API", () => {
    expect(render()).not.toContain("Reinício pendente");
  });

  it("quem a monta pode pôr um controle logo depois da marca: a área de trabalho põe ali o botão de mostrar e esconder o navegador (RN-NAV-008)", () => {
    const markup = render(undefined, createElement("button", { type: "button", "data-leading": "" }, "alternar"));

    expect(markup.indexOf("data-leading")).toBeGreaterThan(markup.indexOf("Verificar atualizações"));
    expect(markup.indexOf("data-leading")).toBeLessThan(markup.indexOf("Área de trabalho"));
    expect(render()).not.toContain("data-leading");
  });

  it("a marca do Prism tem 40 px de altura, na proporção do desenho (RN-MARCA-007, Ruling 137): abaixo disso o traço fino quase some", () => {
    const brand = /<header[^>]*><div class="([^"]*)"><svg([^>]*)>/.exec(render());
    const attributes = Object.fromEntries([...(brand?.[2] ?? "").matchAll(/\s([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

    expect(attributes).toMatchObject({ height: "40", width: String((40 * 720) / 281), viewBox: "0 34 720 281" });
    // A caixa da marca cresce com ela (40 px), e a barra cresce o que precisar: ela tem altura mínima, e não altura fixa.
    expect(brand?.[1].split(" ")).toContain("h-10");
    expect(render()).toMatch(/<header class="[^"]*\bmin-h-12\b/);
    expect(render()).not.toMatch(/<header class="(?:[^"]*\s)?h-\d/);
  });

  it("os outros controles da barra não mudam de tamanho com a marca: os itens continuam com 36 px (h-9)", () => {
    const markup = render([{ ...ibm, restartRequired: true }]);
    const items = [...markup.matchAll(/<(a|button|span) [^>]*class="([^"]*\bh-(\d+)\b[^"]*)"/g)].map((match) => `${match[1]} h-${match[3]}`);

    // Área de trabalho, o lembrete, Configurações, o usuário e Sair.
    expect(items).toEqual(["a h-9", "a h-9", "a h-9", "span h-9", "button h-9"]);
  });

  describe("as atualizações (RN-ATUALIZA-002)", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("mostra a versão do app e, junto dela, 'Verificar atualizações'", () => {
      vi.stubGlobal("window", { prism: { version: "0.1.0" } });

      expect(render()).toMatch(/<span[^>]*\bdata-app-version\b[^>]*>versão 0\.1\.0<\/span><button[^>]*\bdata-check-updates\b[^>]*>Verificar atualizações<\/button>/);
    });

    it("sem a ponte, a barra só fica sem a versão: o botão continua lá", () => {
      const markup = render();

      expect(markup).not.toContain("data-app-version");
      expect(markup).toContain("Verificar atualizações");
    });
  });
});
