import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Folder } from "@/app/connections/_lib/connections.schema";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";

import type { QueryTab } from "../_lib/workbench-model";
import { panelElementId, tabElementId, TabStrip } from "./tab-strip";

const noop = () => {};

const query = (id: string, title: string): QueryTab => ({ id, title, connectionId: "c-1", sessionId: null, sql: "" });
const table = (id: string, schema: string, name: string): QueryTab => ({ id, title: `${schema}.${name}`, connectionId: "c-1", sessionId: null, sql: "", table: { schema, name, view: "data" } });

const render = (tabs: QueryTab[], activeTabId: string | null, environmentOf: (connectionId: string | null) => ShownEnvironment | null = () => null) =>
  renderToStaticMarkup(createElement(TabStrip, { tabs, activeTabId, connectionOf: () => undefined, environmentOf, onSelect: noop, onClose: noop, windowId: 1, onReorder: noop, onMove: noop, onReceive: noop }));

const twelve = Array.from({ length: 12 }, (_, index) => (index % 2 === 0 ? query(`q${index}`, `consulta-${index + 1}.sql`) : table(`t${index}`, "producao", `tabela_${index}`)));

describe("a faixa de abas (D2)", () => {
  it("é uma lista de abas com nome; cada aba aponta para o painel dela, e só a ativa entra na ordem do Tab", () => {
    const markup = render(twelve, "t1");
    const tabs = [...markup.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((match) => match[0]);

    expect(markup).toMatch(/role="tablist"[^>]*aria-label="Abas abertas"/);
    expect(tabs).toHaveLength(12);
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup).toMatch(new RegExp(`id="${tabElementId("t1")}"[^>]*aria-selected="true"[^>]*aria-controls="${panelElementId("t1")}"[^>]*tabindex="0"`));
    expect(tabs.filter((tab) => tab.includes('tabindex="-1"'))).toHaveLength(11);
  });

  it("cada aba se arrasta (RN-ABAS-001 a 003) e diz, na faixa, qual aba é; sem nada sendo arrastado não há marca de soltar", () => {
    const markup = render(twelve, "q0");
    const frames = [...markup.matchAll(/<div[^>]*data-tab-id="([^"]+)"[^>]*>/g)];

    expect(frames.map((match) => match[1])).toEqual(twelve.map((tab) => tab.id));
    expect(frames.every((match) => /draggable="true"/.test(match[0]))).toBe(true);
    expect(markup).not.toMatch(/data-drop=/);
  });

  it("fica numa linha só: rola na horizontal, sem quebrar, e cada aba mantém o tamanho dela", () => {
    const markup = render(twelve, "q0");

    expect(markup).toMatch(/role="tablist"[^>]*class="[^"]*\boverflow-x-auto\b/);
    expect(markup).not.toMatch(/flex-wrap/);
    // As 12 abas (a moldura de cada uma) não encolhem para caber.
    expect(markup.match(/class="flex flex-none items-center border-b-2/g)).toHaveLength(12);
  });

  it("o título comprido encurta com reticências e leva o nome inteiro na dica (sozinha, a tabela aparece sem o esquema, RN-ABAS-008)", () => {
    const long = table("t1", "producao", "apontamento_de_producao_por_turno_e_por_maquina_do_mes_corrente");
    const markup = render([long], "t1");

    expect(markup).toMatch(/<span class="[^"]*\btruncate\b[^"]*">apontamento_de_producao_por_turno_e_por_maquina_do_mes_corrente<\/span>/);
    expect(markup).toContain(`title="${long.title}"`);
  });

  it("os botões de rolar das pontas existem, nomeados, apagados até haver excedente e fora da ordem do Tab", () => {
    const markup = render(twelve, "q0");
    const left = /<button[^>]*aria-label="Rolar as abas para a esquerda"[^>]*>/.exec(markup)?.[0] ?? "";
    const right = /<button[^>]*aria-label="Rolar as abas para a direita"[^>]*>/.exec(markup)?.[0] ?? "";

    for (const button of [left, right]) {
      expect(button).toContain('tabindex="-1"');
      expect(button).toMatch(/class="[^"]*\bhidden\b/);
    }
    expect(left).toContain("group-data-[left]/strip:flex");
    expect(right).toContain("group-data-[right]/strip:flex");
  });

  it("com mais de uma aba, um botão no fim abre a lista de todas (menu, fechado)", () => {
    const markup = render(twelve, "q0");

    expect(markup).toMatch(/<button[^>]*aria-label="Todas as abas"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  });

  it("com uma aba só, a lista não tem o que listar", () => {
    const markup = render([query("q0", "consulta-1.sql")], "q0");

    expect(markup).not.toContain('aria-label="Todas as abas"');
    expect(markup.match(/role="tab"/g)).toHaveLength(1);
  });

  it("cada aba tem o botão de fechar com o nome dela, e o ícone diz se é consulta ou tabela", () => {
    const markup = render([query("q0", "consulta-1.sql"), table("t1", "producao", "apontamento")], "q0");

    expect(markup).toContain('aria-label="Fechar consulta-1.sql"');
    expect(markup).toContain('aria-label="Fechar producao.apontamento"');
  });

  it("sem aba ativa (a lista acabou de mudar), nenhuma fica selecionada e a faixa continua montada", () => {
    const markup = render(twelve.slice(0, 3), null);

    expect(markup).not.toContain('aria-selected="true"');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
  });
});

describe("a marca do estado da aba (RN-SQL-021)", () => {
  it("o que a aba diz do estado dela vem depois do nome, dentro da aba: a do script parado na pergunta de erro, só nela", () => {
    const tabs = [query("q0", "consulta-1.sql"), query("q1", "carga.sql")];
    const markup = renderToStaticMarkup(
      createElement(TabStrip, { tabs, activeTabId: "q0", connectionOf: () => undefined, environmentOf: () => null, onSelect: noop, onClose: noop, windowId: 1, onReorder: noop, onMove: noop, onReceive: noop, markOf: (tabId) => (tabId === "q1" ? createElement("span", { "data-mark": tabId }) : null) }),
    );

    expect(markup.match(/data-mark=/g)).toHaveLength(1);
    expect(markup).toMatch(new RegExp(`id="${tabElementId("q1")}"[^>]*>(?:(?!</button>).)*carga\\.sql</span><span data-mark="q1">`));
  });
});

describe("a etiqueta do ambiente na aba (RN-CONN-015 e RN-PASTA-005)", () => {
  const now = "2026-10-13T12:00:00Z";
  const producao: Folder = { id: "f1", parentID: null, name: "Produção", environmentName: "Produção", environmentColor: "#FF8A7A", color: null, createdAt: now, updatedAt: now };

  it("a aba mostra o ambiente que a conexão mostra: o herdado da pasta, com a dica de onde vem", () => {
    const markup = render([query("q1", "consulta.sql")], "q1", (connectionId) => (connectionId === "c-1" ? { name: "Produção", color: "#FF8A7A", folder: producao } : null));

    expect(markup).toMatch(/<span[^>]*style="background-color:#FF8A7A[^"]*"[^>]*title="Herdado da pasta Produção"[^>]*>Produção<\/span>|<span[^>]*title="Herdado da pasta Produção"[^>]*style="background-color:#FF8A7A[^"]*"[^>]*>Produção<\/span>/);
  });

  it("sem ambiente, nenhuma etiqueta", () => {
    expect(render([query("q1", "consulta.sql")], "q1")).not.toContain("background-color");
  });
});

describe("o ícone e a cor da aba de um script (RN-SCRIPT-006)", () => {
  const scriptTab = (id: string, scriptId: string): QueryTab => ({ ...query(id, "Fechamento"), script: { id: scriptId, name: "Fechamento", savedSql: "", dirty: false } });
  const renderWith = (tabs: QueryTab[], scriptOf: (scriptId: string) => { icon: string | null; color: string | null } | undefined) =>
    renderToStaticMarkup(createElement(TabStrip, { tabs, activeTabId: tabs[0].id, connectionOf: () => undefined, environmentOf: () => null, scriptOf, onSelect: noop, onClose: noop, windowId: 1, onReorder: noop, onMove: noop, onReceive: noop }));
  const iconOf = (markup: string, id: string) => new RegExp(`id="${tabElementId(id)}"[^>]*>\\s*<svg([^>]*)>`).exec(markup)?.[1] ?? "";

  it("a aba do script leva o ícone dele, na cor dele ajustada ao tema; a consulta sem script, o documento", () => {
    const markup = renderWith([scriptTab("a", "s1"), query("b", "consulta.sql")], (scriptId) => (scriptId === "s1" ? { icon: "chart", color: "#F2B644" } : undefined));

    expect(iconOf(markup, "a")).toContain('data-script-icon="chart"');
    expect(iconOf(markup, "a")).toMatch(/style="color:light-dark\(#[0-9A-F]{6}, #F2B644\)"/);
    expect(iconOf(markup, "b")).not.toContain("data-script-icon");
  });

  it("o script sem ícone nem cor mostra o padrão, neutro; sem a lista (ou com o script excluído), o documento de sempre", () => {
    const plain = renderWith([scriptTab("a", "s1")], () => ({ icon: null, color: null }));
    const missing = renderWith([scriptTab("a", "s1")], () => undefined);

    expect(iconOf(plain, "a")).toContain('data-script-icon="document"');
    expect(iconOf(plain, "a")).not.toContain("style=");
    expect(iconOf(missing, "a")).not.toContain("data-script-icon");
  });
});
