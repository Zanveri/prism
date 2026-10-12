import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RecordsFilter } from "./records-filter";

const noop = () => {};

type Props = Partial<Parameters<typeof RecordsFilter>[0]>;
const render = (props: Props = {}) => renderToStaticMarkup(createElement(RecordsFilter, { draft: "", onDraft: noop, applied: "", problem: null, busy: false, command: null, onApply: noop, onClear: noop, ...props }));

describe("o filtro dos registros (RN-TABELA-005 e 010)", () => {
  it("o campo recebe o que vem depois do nome da tabela, tem nome acessível e não corrige o que a pessoa escreve", () => {
    const markup = render({ draft: "refugo > 0" });

    expect(markup).toMatch(/<input[^>]*aria-label="Filtro e ordem dos registros"/);
    expect(markup).toMatch(/<input[^>]*value="refugo &gt; 0"/);
    expect(markup).toMatch(/<input[^>]*spellCheck="false"/);
  });

  it("não há um rótulo WHERE fixo, que seria falso com só a ordem no campo; o exemplo do campo vazio e a dica dizem que a ordem cabe ali", () => {
    for (const draft of ["", "refugo > 0", 'ORDER BY "id" ASC']) expect(render({ draft }), draft).not.toContain(">WHERE<");

    const markup = render();
    expect(/<input[^>]*placeholder="([^"]*)"/.exec(markup)?.[1]).toContain("ORDER BY");
    // A dica: para quem vê, no `title` do campo; para leitor de tela, na descrição dele.
    const hint = "O que vem depois do nome da tabela: uma condição, uma ordem (ORDER BY) ou as duas.";
    const describedBy = /<input[^>]*aria-describedby="([^"]+)"/.exec(markup)?.[1] ?? "";
    expect(markup).toContain(`<label title="${hint}"`);
    expect(markup).toContain(`<span id="${describedBy}" class="sr-only">${hint}</span>`);
  });

  it("'Aplicar filtro' envia o formulário (Enter no campo faz o mesmo) e espera enquanto algo roda", () => {
    expect(render()).toMatch(/<button[^>]*type="submit"[^>]*>Aplicar filtro<\/button>/);
    expect(render()).not.toMatch(/<button[^>]*disabled=""[^>]*>Aplicar filtro/);
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled=""[^>]*>Aplicar filtro/);
  });

  it("'Limpar' vale com texto no campo ou com filtro ou ORDEM em vigor, e só sem nada disso fica apagado", () => {
    const disabled = /<button[^>]*disabled=""[^>]*>Limpar/;

    expect(render()).toMatch(disabled);
    expect(render({ draft: "a = 1" })).not.toMatch(disabled);
    expect(render({ applied: "a = 1" })).not.toMatch(disabled);
    // O defeito: a ordem do cabeçalho em vigor, o campo vazio de condição, e o botão apagado.
    expect(render({ draft: 'ORDER BY "is_active" ASC', applied: 'ORDER BY "is_active" ASC' })).not.toMatch(disabled);
    expect(render({ applied: 'ORDER BY "is_active" ASC' })).not.toMatch(disabled);
    expect(render({ draft: 'ORDER BY "is_active" ASC' })).not.toMatch(disabled);
  });

  it("a recusa de mais de um comando aparece no campo, e o campo a aponta (aria-invalid e aria-describedby, junto da dica)", () => {
    const markup = render({ draft: "a = 1; drop table x", problem: "severalStatements" });

    expect(markup).toContain("O filtro tem mais de um comando. Escreva só a condição e a ordem");
    expect(markup).toMatch(/<input[^>]*aria-invalid="true"/);
    const [hintId, problemId] = (/aria-describedby="([^"]+)"/.exec(markup)?.[1] ?? "").split(" ");
    expect(markup).toContain(`<span id="${hintId}"`);
    expect(markup).toContain(`<p id="${problemId}"`);
    // Sem recusa, o campo só aponta a dica.
    expect(/aria-describedby="([^"]+)"/.exec(render())?.[1]).not.toContain(" ");
    expect(render()).not.toContain("<p id=");
    expect(render()).toMatch(/aria-invalid="false"/);
  });

  it("mostra o comando que foi executado COMO ele é enviado: a tabela numa linha e o texto do filtro na outra, e ele inteiro na dica", () => {
    const command = 'SELECT * FROM "mes"."apontamento"\nWHERE refugo > 0 ORDER BY "id" ASC';
    const markup = render({ command });
    const shown = /<code[^>]*>([^]*?)<\/code>/.exec(markup)?.[1] ?? "";

    expect(markup).toContain(">Comando<");
    expect(shown.split("\n")).toEqual(["SELECT * FROM &quot;mes&quot;.&quot;apontamento&quot;", "WHERE refugo &gt; 0 ORDER BY &quot;id&quot; ASC"]);
    expect(markup).toContain("title=\"SELECT * FROM &quot;mes&quot;.&quot;apontamento&quot;\nWHERE refugo &gt; 0 ORDER BY &quot;id&quot; ASC\"");
    expect(render({ command: null })).not.toContain(">Comando<");
  });

  it("o comando não é juntado numa linha só: as quebras de linha dele ficam (um comentário `--` numa linha não faz a seguinte parecer comentada)", () => {
    const command = 'SELECT * FROM "mes"."apontamento" -- a tabela\nWHERE refugo > 0';
    const markup = render({ command });
    const tag = /<code[^>]*>/.exec(markup)?.[0] ?? "";

    expect(markup).not.toContain("a tabela WHERE");
    expect(tag).toMatch(/whitespace-pre-wrap/);
    expect(tag).not.toMatch(/\btruncate\b/);
    // Uma condição muito comprida não come a área de baixo: o bloco rola.
    expect(tag).toMatch(/\bmax-h-\S+/);
    expect(tag).toMatch(/\boverflow-auto\b/);
  });

  it("o comando é texto: marcação nele não vira elemento (RN-SHELL-002)", () => {
    const markup = render({ command: "SELECT '<img src=x onerror=alert(1)>'" });

    expect(markup).not.toContain("<img");
    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });
});
