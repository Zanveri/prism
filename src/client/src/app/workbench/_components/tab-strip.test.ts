import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { QueryTab } from "../_lib/workbench-model";
import { panelElementId, tabElementId, TabStrip } from "./tab-strip";

const noop = () => {};

const query = (id: string, title: string): QueryTab => ({ id, title, connectionId: "c-1", sessionId: null, sql: "" });
const table = (id: string, schema: string, name: string): QueryTab => ({ id, title: `${schema}.${name}`, connectionId: "c-1", sessionId: null, sql: "", table: { schema, name, view: "data" } });

const render = (tabs: QueryTab[], activeTabId: string | null) => renderToStaticMarkup(createElement(TabStrip, { tabs, activeTabId, connectionOf: () => undefined, onSelect: noop, onClose: noop }));

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

  it("fica numa linha só: rola na horizontal, sem quebrar, e cada aba mantém o tamanho dela", () => {
    const markup = render(twelve, "q0");

    expect(markup).toMatch(/role="tablist"[^>]*class="[^"]*\boverflow-x-auto\b/);
    expect(markup).not.toMatch(/flex-wrap/);
    // As 12 abas (a moldura de cada uma) não encolhem para caber.
    expect(markup.match(/class="flex flex-none items-center border-b-2/g)).toHaveLength(12);
  });

  it("o título comprido encurta com reticências e leva o nome inteiro na dica", () => {
    const long = table("t1", "producao", "apontamento_de_producao_por_turno_e_por_maquina_do_mes_corrente");
    const markup = render([long], "t1");

    expect(markup).toMatch(/<span class="[^"]*\btruncate\b[^"]*">producao\.apontamento_de_producao_por_turno_e_por_maquina_do_mes_corrente<\/span>/);
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
