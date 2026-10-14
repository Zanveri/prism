import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { forgetExcept, remember } from "../../_lib/tab-memory";
import type { QueryRunner } from "../../_lib/use-query-runner";
import type { TableTab, TableView } from "../../_lib/workbench-model";
import { TableTabPanel } from "./table-tab";

const noop = () => {};

// O aviso é um portal no `document.body`, que o vitest (sem DOM) não tem: as vistas só o usam no "Atualizar".
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => ({ success: () => {}, warning: () => {}, error: () => {}, info: () => {} }) }));

function render(view: TableView, over: { disconnected: boolean; visible?: boolean }) {
  const table = { schema: "producao", name: "apontamento", view };
  const tab: TableTab = { id: "t1", title: "producao.apontamento", connectionId: "c-1", sessionId: null, sql: "", table };
  // Só as vistas Estrutura e Diagrama: os Registros leem o executor, que o React só lê no navegador.
  const runner = {} as QueryRunner;
  const panel = createElement(TableTabPanel, { tab, table, runner, connection: undefined, environment: null, visible: over.visible ?? true, disconnected: over.disconnected, onView: noop, onOpenTable: noop });

  return renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, panel));
}

// A memória das abas é de módulo: cada teste começa sem nada lembrado.
afterEach(() => forgetExcept(new Set()));

describe("a aba da tabela com a conexão desconectada pela pessoa: nada reconecta sozinho", () => {
  it.each(["structure", "diagram"] as const)("a vista %s diz que está desconectada e oferece 'Conectar', sem carregar nada", (view) => {
    const markup = render(view, { disconnected: true });

    expect(markup).toContain("A conexão está desconectada.");
    expect(markup).toContain("Conecte para carregar a estrutura e o diagrama desta tabela.");
    expect(markup).toMatch(/<button[^>]*type="button"[^>]*>Conectar<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Conectar/);
    expect(markup).not.toContain("Carregando");
    expect(markup).not.toContain("Atualizar");
  });

  it("conectada, a Estrutura abre em Colunas (carregando), com a lista das quatro seções e nenhum aviso de desconexão", () => {
    const markup = render("structure", { disconnected: false });
    const tabs = [...markup.matchAll(/<button[^>]*role="tab"[^>]*aria-selected="(true|false)"[^>]*>([^]*?)<\/button>/g)].filter((match) => !/id="table-view-/.test(match[0])).map((match) => [match[1], match[2].replace(/<[^>]*>/g, "")]);

    expect(markup).not.toContain("A conexão está desconectada.");
    expect(tabs).toEqual([
      ["true", "Colunas"],
      ["false", "Chaves estrangeiras"],
      ["false", "Índices"],
      ["false", "DDL"],
    ]);
    // Só a seção escolhida existe na página: uma área de carregando (a das colunas), e nada das outras três tabelas.
    expect(markup.match(/Carregando…/g)).toHaveLength(1);
    expect(markup).not.toContain(">Referência<");
    expect(markup).not.toContain(">Único<");
    expect(markup).not.toContain("<pre");
  });

  it("a seção que a pessoa escolheu nesta aba é a que a Estrutura abre: o painel dá à vista o id da aba, onde a escolha fica lembrada", () => {
    remember("t1", "structure", "indexes");
    remember("outra-aba", "structure", "ddl");

    const markup = render("structure", { disconnected: false });

    expect(markup).toMatch(/aria-selected="true"[^>]*>(?:<span[^>]*>Índices<\/span>)/);
    expect(markup).toMatch(/<h3[^>]*>Índices<\/h3>/);
    expect(markup).not.toMatch(/<h3[^>]*>DDL aproximado<\/h3>/);
    // A lembrada de outra aba não vale para esta.
    expect(render("structure", { disconnected: false }).match(/aria-selected="true"/g)).toHaveLength(2);
  });

  it("conectada, o Diagrama carrega o desenho, e a aba escondida também só espera: o aviso de desconexão não aparece", () => {
    for (const visible of [true, false]) {
      const markup = render("diagram", { disconnected: false, visible });

      expect(markup, `visible ${visible}`).not.toContain("A conexão está desconectada.");
      expect(markup, `visible ${visible}`).toContain("Carregando o diagrama…");
    }
  });

  it("o painel da vista é focável por programa (o foco volta a ele quando 'Conectar' tira o botão)", () => {
    expect(render("structure", { disconnected: true })).toMatch(/<div[^>]*role="tabpanel"[^>]*tabindex="-1"|<div[^>]*tabindex="-1"[^>]*role="tabpanel"/);
  });
});
