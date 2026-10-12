import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";

import { pollFailed, resetDriversPolling } from "../_lib/drivers.polling";
import { driversQuery } from "../_lib/drivers.service";
import type { Driver } from "../_lib/drivers.schema";
import { DriverManager } from "./driver-manager";

// O `ToastProvider` desenha num portal em `document.body`, que o renderizador de servidor não tem; e o reinício
// vem do `ApiGate` (que não está montado aqui): os dois entram como falsos.
vi.mock("@/components/ui", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui")>()), useToast: () => ({ success() {}, warning() {}, error() {} }) }));
vi.mock("@/app/_components/api-gate", () => ({ useApiRestart: () => async () => {} }));

const base = "http://127.0.0.1:51234";
const bridge = { getApiConfig: async () => ({ baseUrl: base, token: "token-de-teste" }), onApiExit: () => () => {}, restartApi: async () => {} };

function driver(id: string, overrides: Partial<Driver> = {}): Driver {
  return {
    id,
    name: `Driver ${id}`,
    vendor: "Fabricante",
    engines: [2, 3],
    state: "available",
    version: "12.1.3",
    sizeBytes: 115343360,
    license: { name: "Licença", url: "https://exemplo.local/licenca" },
    platformNote: null,
    progress: null,
    error: null,
    restartRequired: false,
    ...overrides,
  };
}

/** Uma consulta de sessão já respondida, como a que o guard deixa no cache. */
function clientWith(drivers?: Driver[]) {
  // `retryOnMount: false`: uma consulta com erro seria dada como `pending` na renderização, porque tentaria de novo ao montar.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
  client.setQueryData(sessionQuery.queryKey, { unlocked: true, userName: "ana" });
  if (drivers !== undefined) client.setQueryData(driversQuery.queryKey, drivers);
  return client;
}

const render = (client: QueryClient, highlightedId: string | null = null) => renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(MemoryRouter, null, createElement(DriverManager, { highlightedId }))));

beforeEach(() => {
  vi.stubGlobal("window", { prism: bridge });
  resetDriversPolling();
});
afterEach(() => vi.unstubAllGlobals());

describe("a lista de drivers (a de Configurações › Drivers, RN-NAV-006: era a tela de Drivers)", () => {
  it("a lista agrupada, com um título por grupo abaixo do título da seção (o título e a explicação são do cartão de Configurações)", () => {
    const markup = render(clientWith([driver("pg", { state: "bundled", engines: [1] }), driver("ibm"), driver("sqlite", { state: "comingSoon", engines: [], version: null })]));

    expect([...markup.matchAll(/<h3[^>]*>(.*?)<\/h3>/g)].map((match) => match[1])).toEqual(["Instalados e embutidos", "Disponíveis para baixar", "Em breve"]);
    expect(markup).not.toMatch(/<h[12][ >]/);
  });

  it("enquanto a lista não chegou, diz que carrega", () => {
    const markup = render(clientWith());

    expect(markup).toContain("Carregando os drivers…");
    expect(markup).not.toContain("<ul");
  });

  it("lista vazia tem estado vazio", () => {
    expect(render(clientWith([]))).toContain("Nenhum driver na lista.");
  });

  it("a lista que falhou ao carregar mostra o erro com 'Tentar de novo'", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type: "INTERNAL_SERVER_ERROR", title: "Erro", status: 500 }), { status: 500 }));
    const client = clientWith();
    await client.fetchQuery(driversQuery).catch(() => undefined);

    const markup = render(client);

    expect(markup).toContain("Não foi possível carregar os drivers.");
    expect(markup).toMatch(/<button[^>]*>Tentar de novo<\/button>/);
  });

  it("uma consulta que falha com a lista já na tela não a derruba", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type: "INTERNAL_SERVER_ERROR", title: "Erro", status: 500 }), { status: 500 }));
    const client = clientWith([driver("ibm")]);
    await client.fetchQuery({ ...driversQuery, staleTime: 0 }).catch(() => undefined);

    const markup = render(client);

    expect(markup).toContain("Driver ibm");
    expect(markup).not.toContain("Não foi possível carregar os drivers.");
  });
});

describe("a lista que parou de atualizar (item D)", () => {
  const failing = () => vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ type: "INTERNAL_SERVER_ERROR", title: "Erro", status: 500 }), { status: 500 }));

  it("depois de 3 erros seguidos a tela diz que a lista parou e oferece atualizar (a lista que já estava na tela fica)", async () => {
    failing();
    const client = clientWith([driver("ibm", { state: "installing", progress: { receivedBytes: 1, totalBytes: 2 } })]);
    await client.fetchQuery({ ...driversQuery, staleTime: 0 }).catch(() => undefined);
    pollFailed();
    pollFailed();

    const markup = render(client);

    expect(markup).toContain("A lista de drivers parou de atualizar.");
    expect(markup).toMatch(/<button[^>]*>Atualizar a lista<\/button>/);
    expect(markup).toContain("Driver ibm");
  });

  it("um erro só (a consulta periódica segue) não mostra o aviso de lista parada", async () => {
    failing();
    const client = clientWith([driver("ibm", { state: "installing", progress: { receivedBytes: 1, totalBytes: 2 } })]);
    await client.fetchQuery({ ...driversQuery, staleTime: 0 }).catch(() => undefined);

    expect(render(client)).not.toContain("parou de atualizar");
  });
});

describe("o 'Instalar driver' que aponta a linha do driver (item G)", () => {
  it("a lista abre com a linha do driver apontado destacada", () => {
    const markup = render(clientWith([driver("pg", { state: "bundled", engines: [1] }), driver("ibm")]), "ibm");

    expect(markup).toMatch(/<li[^>]*aria-current="true"[^>]*>.*Driver ibm/);
    expect(markup.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("sem driver apontado, nenhuma linha é destacada", () => {
    expect(render(clientWith([driver("ibm")]))).not.toContain('aria-current="true"');
  });
});

describe("o lembrete de reinício pendente (item E)", () => {
  it("com um driver esperando o reinício, a lista avisa e oferece 'Reiniciar agora'", () => {
    const markup = render(clientWith([driver("ibm", { state: "installed", restartRequired: true })]));

    expect(markup).toContain("O Prism precisa reiniciar o serviço");
    expect(markup).toMatch(/<button[^>]*>Reiniciar agora<\/button>/);
  });

  it("sem reinício pendente, não há aviso", () => {
    const markup = render(clientWith([driver("ibm", { state: "installed" })]));

    expect(markup).not.toContain("O Prism precisa reiniciar o serviço");
    expect(markup).not.toContain("Reiniciar agora");
  });
});
