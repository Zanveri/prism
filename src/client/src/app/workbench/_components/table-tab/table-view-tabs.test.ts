import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { tableViews } from "../../_lib/table-view";
import { TableViewTabs } from "./table-view-tabs";

const render = (view: "data" | "structure" | "diagram") => renderToStaticMarkup(createElement(TableViewTabs, { tabId: "t1", view, onChange: () => {} }));

describe("o seletor de vistas da aba de uma tabela (RN-TABELA-001)", () => {
  it("é uma lista de abas com as vistas na ordem, e só a ativa está selecionada e entra no Tab", () => {
    const markup = render("structure");
    const tabs = [...markup.matchAll(/<button[^>]*role="tab"[^>]*>([^<]+)<\/button>/g)];

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Vistas da tabela"');
    expect(tabs.map((tab) => tab[1])).toEqual(tableViews.map((view) => ({ data: "Registros", structure: "Estrutura", diagram: "Diagrama" })[view]));
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-selected="true"[^>]*tabindex="0"[^>]*>Estrutura</);
    expect(markup).toMatch(/aria-selected="false"[^>]*tabindex="-1"[^>]*>Registros</);
  });

  it("cada vista aponta para o painel da aba, com ids que não colidem entre abas", () => {
    expect(render("data")).toContain('id="table-view-t1-data"');
    expect(render("data")).toContain('aria-controls="table-view-panel-t1"');
    expect(renderToStaticMarkup(createElement(TableViewTabs, { tabId: "t2", view: "data", onChange: () => {} }))).toContain('id="table-view-t2-data"');
  });
});
