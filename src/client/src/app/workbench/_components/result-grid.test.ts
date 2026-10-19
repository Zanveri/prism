import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { VirtualItem } from "@tanstack/react-virtual";
import { describe, expect, it } from "vitest";

import type { QueryColumn } from "../_lib/query.schema";
import { recordsCopy } from "../_lib/records.copy";
import { followsActiveRow, GridHeaderCell, GridRow, ResultGrid } from "./result-grid";

const columns: QueryColumn[] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "observacao", type: "text", kind: "text" },
];
const virtualColumns = columns.map((_, index): VirtualItem => ({ index, start: index * 100, size: 100, end: (index + 1) * 100, key: index, lane: 0 }));

const render = (row: (string | null)[], nullText?: string) => renderToStaticMarkup(createElement(GridRow, { index: 0, start: 0, row, columns, virtualColumns, truncated: undefined, nullText: nullText ?? "NULL" }));

describe("a linha da grade e o valor nulo (RN-CONFIG-005)", () => {
  it("o nulo aparece com o texto que a pessoa escolheu", () => {
    expect(render(["1", null], "∅")).toContain(">∅<");
    expect(render(["1", null], "(vazio)")).toContain(">(vazio)<");
  });

  it("sem escolha, 'NULL'; o texto do banco que for igual ao do nulo continua sendo valor, e não nulo", () => {
    expect(render(["1", null])).toContain(">NULL<");
    // O nulo tem a cor de apagado; o valor "NULL" que veio do banco como texto não.
    const nullCell = render(["1", null]).match(/<div[^>]*role="cell"[^>]*aria-colindex="3"[^>]*>/)?.[0] ?? "";
    const textCell = render(["1", "NULL"]).match(/<div[^>]*role="cell"[^>]*aria-colindex="3"[^>]*>/)?.[0] ?? "";

    expect(nullCell).toContain("text-subtle");
    expect(textCell).not.toContain("text-subtle");
  });

  it("o texto do nulo é texto: marcação nele não vira elemento (RN-SHELL-002)", () => {
    const markup = render(["1", null], "<b>x</b>");

    expect(markup).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(markup).not.toContain("<b>");
  });
});

describe("o cabeçalho escolhe a coluna, e a ordem vai para o botão de ordenar (RN-GRADE-021)", () => {
  const item = virtualColumns[0];
  const renderHeader = (over: Partial<Parameters<typeof GridHeaderCell>[0]> = {}) => renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[0], item, ...over }));
  const sort = (direction: "asc" | "desc" | null = null, reason: string | null = null) => ({ direction, reason, onSort: () => {} });
  const sortButton = (markup: string) => markup.match(/<button[^>]*data-sort[^>]*>/)?.[0] ?? "";
  const nameButton = (markup: string) => markup.match(/<button[^>]*data-colheader[^>]*>/)?.[0] ?? "";

  it("sem a edição e sem ordem é só texto: nome e tipo, sem botão", () => {
    const markup = renderHeader();

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("aria-sort");
    expect(markup).toContain(">id<");
    expect(markup).toContain(">int4<");
  });

  it("na grade editável o nome é um botão fora do Tab que escolhe a coluna inteira, com a dica do atalho e a descrição para o leitor de tela", () => {
    const markup = renderHeader({ choosable: true });
    const name = nameButton(markup);

    expect(name).toContain('tabindex="-1"');
    expect(name).toContain('data-colheader="0"');
    expect(name).toContain('aria-label="id"');
    expect(name).toContain("Clique para escolher a coluna inteira (Ctrl+Espaço).");
    expect(markup).toContain(">Escolher a coluna inteira<");
    expect(renderHeader({ choosable: true, mac: true })).toContain("(Control+Espaço).");
    // Sem o botão de ordenar (as abas guardadas do script), o nome ocupa tudo, e não há `aria-sort`.
    expect(markup).not.toContain("data-sort");
    expect(markup).not.toContain("aria-sort");
  });

  it("o botão de ordenar fica à direita do nome, fora do Tab, e a dica e o nome dizem o que o próximo clique faz", () => {
    const none = renderHeader({ choosable: true, sort: sort() });
    const asc = renderHeader({ choosable: true, sort: sort("asc") });
    const desc = renderHeader({ choosable: true, sort: sort("desc") });

    expect(none).toContain('aria-sort="none"');
    expect(sortButton(none)).toContain('aria-label="Ordenar por id, crescente"');
    expect(sortButton(none)).toContain('tabindex="-1"');
    expect(asc).toContain('aria-sort="ascending"');
    expect(sortButton(asc)).toContain('title="Ordenar por id, decrescente"');
    expect(desc).toContain('aria-sort="descending"');
    expect(sortButton(desc)).toContain('title="Tirar a ordem de id"');
    // O botão vem depois do nome, irmão dele, e não dentro.
    expect(none).toMatch(/<\/button><span id="[^"]*" class="sr-only">Escolher a coluna inteira<\/span><span data-colheader="0"[^>]*><button[^>]*data-sort/);
  });

  it("sem ordem, o botão só aparece com o ponteiro sobre o cabeçalho, e o espaço dele fica reservado; na coluna que ordena, fica sempre à vista", () => {
    expect(sortButton(renderHeader({ choosable: true, sort: sort() }))).toMatch(/class="[^"]*invisible[^"]*group-hover\/header:visible/);
    expect(sortButton(renderHeader({ choosable: true, sort: sort("asc") }))).not.toContain("invisible");
    // O espaço do botão é do tamanho dele, sempre, e o clique nele, com o botão escondido, escolhe a coluna (`data-colheader`).
    expect(renderHeader({ choosable: true, sort: sort() })).toMatch(/<span data-colheader="0" class="[^"]*w-6[^"]*flex-none/);
  });

  it("a seta aponta o sentido: para cima na crescente, para baixo na decrescente, e as duas, apagadas, sem ordem", () => {
    expect(renderHeader({ sort: sort("asc") })).toContain('d="M8 13V3M4 7l4-4 4 4"');
    expect(renderHeader({ sort: sort("desc") })).toContain('d="M8 3v10M4 9l4 4 4-4"');
    expect(renderHeader({ sort: sort() })).toMatch(/<svg[^>]*class="[^"]*text-subtle/);
  });

  it("desabilitado, o botão continua à vista (`aria-disabled`), com o motivo na dica e no nome", () => {
    const button = sortButton(renderHeader({ choosable: true, sort: sort(null, "há um comando em andamento na aba") }));

    expect(button).toContain('aria-disabled="true"');
    expect(button).toContain('title="Ordenar por id, crescente. Indisponível: há um comando em andamento na aba."');
  });

  it("o botão termina antes da área da divisa: 4 px nas colunas do meio, 8 px na última, onde a divisa fica dentro", () => {
    expect(renderHeader({ sort: sort() })).toMatch(/<span class="[^"]*mr-\[4px\]/);
    expect(renderHeader({ sort: sort(), last: true })).toMatch(/<span class="[^"]*mr-\[8px\]/);
  });

  it("a coluna escolhida inteira diz `aria-selected` no `columnheader`, e o cabeçalho da seleção fica destacado", () => {
    const whole = renderHeader({ choosable: true, selected: true, whole: true });

    expect(whole).toMatch(/<div role="columnheader"[^>]*aria-selected="true"/);
    expect(whole).toMatch(/<div role="columnheader"[^>]*class="[^"]*bg-selected/);
    expect(renderHeader({ choosable: true, selected: true })).not.toContain("aria-selected");
  });

  // E1: a largura da coluna é calculada sem o botão de ordenar. O espaço dele é sempre reservado, e alguém tem de ceder: era o nome (o `id` encolhia a zero e
  // sobrava `integer ▲`). O vitest não tem layout: aqui se confere a REGRA de quem encolhe; a medida em pixels é da conferência na tela.
  const classesOf = (markup: string, pattern: RegExp) => (markup.match(pattern)?.[1] ?? "").split(" ");
  /** As classes da caixa do rótulo (a que tem o nome e o tipo dentro), do nome e do tipo. */
  const labelOf = (markup: string) => ({
    box: classesOf(markup, /<span class="([^"]*)"><span class="[^"]*">id<\/span>/),
    name: classesOf(markup, /<span class="([^"]*)">id<\/span>/),
    type: classesOf(markup, /<span class="([^"]*)">int4<\/span>/),
  });

  it.each([
    ["ordenado (com a seta)", () => renderHeader({ choosable: true, sort: sort("asc") })],
    ["que ordena, sem ordem", () => renderHeader({ choosable: true, sort: sort() })],
    ["que só escolhe (a aba guardada)", () => renderHeader({ choosable: true })],
    ["só de texto", () => renderHeader()],
  ])("no cabeçalho %s o nome da coluna NÃO encolhe, e o tipo absorve sozinho o que falta", (_name, render) => {
    const { box, name, type } = labelOf(render());

    // O nome não encolhe nada (`shrink-0`): com um peso de encolhimento, por maior que fosse o do tipo, ele ainda perdia centésimos de pixel, e
    // com 1/64 de pixel a menos o Chromium já desenha a reticência (`cliente_id` virava `cliente_…`). Não há razão numérica entre os dois.
    expect(name).toContain("shrink-0");
    expect(name.filter((item) => item.startsWith("shrink-["))).toEqual([]);
    // Só quando nem o nome sozinho cabe na caixa é que ele é cortado, com reticências, em vez de vazar para a coluna ao lado.
    expect(name).toEqual(expect.arrayContaining(["max-w-full", "truncate"]));

    // O tipo é o único que encolhe, até sumir.
    expect(type).toEqual(expect.arrayContaining(["min-w-0", "truncate"]));
    expect(type.filter((item) => item === "flex-none" || item === "shrink-0" || item.startsWith("shrink-["))).toEqual([]);

    // A caixa do rótulo encolhe com a célula (e corta o que sobrar): é ela que diz ao nome quanto cabe.
    expect(box).toEqual(expect.arrayContaining(["flex", "min-w-0", "overflow-hidden"]));
    expect(box.filter((item) => item === "flex-none" || item === "shrink-0" || item === "flex-1" || item === "grow")).toEqual([]);
  });

  it("o botão de ordenar nunca encolhe e fica FORA da caixa do rótulo: o que cabe ao nome já desconta o botão", () => {
    const markup = renderHeader({ choosable: true, sort: sort("desc") });

    expect(classesOf(markup, /<svg[^>]*class="([^"]*)"/)).toContain("flex-none");
    // A caixa do rótulo fecha (nome, tipo) dentro do botão do nome, antes de o espaço do botão de ordenar começar.
    expect(markup).toMatch(/>int4<\/span><\/span><\/button>/);
  });

  it("a coluna de número fica alinhada à direita também quando é botão", () => {
    expect(nameButton(renderHeader({ choosable: true, sort: sort() }))).toContain("justify-end");
    expect(nameButton(renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[1], item: virtualColumns[1], choosable: true, sort: sort() })))).not.toContain("justify-end");
  });

  it("o gesto no nome não rola a grade de volta à linha da ativa; o teclado, o clique numa célula e o campo que abre rolam", () => {
    // O clique no nome com a ativa na linha 3 (ou sem ativa, que vai para a primeira) deixa a ativa ali: a grade fica onde a pessoa lia.
    expect(followsActiveRow(3, 3, false)).toBe(false);
    expect(followsActiveRow(0, 0, false)).toBe(false);
    // A ativa que muda de linha depois ("Adicionar linha", o arraste que passou a outra) e a que nenhum gesto do cabeçalho segura rolam, como sempre.
    expect(followsActiveRow(9, 3, false)).toBe(true);
    expect(followsActiveRow(3, null, false)).toBe(true);
    // Digitar depois do clique no nome abre o campo na ativa, que vem à vista.
    expect(followsActiveRow(0, 0, true)).toBe(true);
  });
});

describe("o valor de uma chave estrangeira na grade é um link para a tabela referenciada (RN-TABELA-007)", () => {
  const links = new Map([[0, { table: { schema: "producao", name: "ordem_producao" }, column: "id" }]]);
  const renderLinks = (row: (string | null)[], over: Partial<Parameters<typeof GridRow>[0]> = {}) =>
    renderToStaticMarkup(createElement(GridRow, { index: 0, start: 0, row, columns, virtualColumns, truncated: undefined, nullText: "NULL", links, onFollow: () => {}, ...over }));
  const cell = (markup: string, colindex: number) => markup.match(new RegExp(String.raw`<div[^>]*role="cell"[^>]*aria-colindex="${colindex}"[^>]*>[\s\S]*?</div>`))?.[0] ?? "";

  it("o valor da coluna com chave estrangeira é um botão com o nome do destino, e as demais células seguem texto", () => {
    const markup = renderLinks(["42", "livre"]);

    expect(cell(markup, 2)).toMatch(/<button[^>]*type="button"[^>]*>42<\/button>/);
    expect(cell(markup, 2)).toContain('aria-label="Abrir ordem_producao com id igual a 42"');
    expect(cell(markup, 2)).toContain('title="Abrir ordem_producao, filtrada por id"');
    expect(cell(markup, 3)).not.toContain("<button");
  });

  it("o nulo não tem para onde ir: sem botão, com o texto do nulo", () => {
    const markup = renderLinks([null, "x"]);

    expect(cell(markup, 2)).not.toContain("<button");
    expect(cell(markup, 2)).toContain(">NULL<");
  });

  it("o valor que chegou cortado (RN-SQL-011) não é o valor do banco: sem botão", () => {
    const markup = renderLinks(["42", "x"], { truncated: new Set([0]) });

    expect(cell(markup, 2)).not.toContain("<button");
    expect(cell(markup, 2)).toContain("…");
  });

  it("o valor que não cabe no filtro de uma linha (quebra de linha) fica texto", () => {
    expect(cell(renderLinks(["a\nb", "x"]), 2)).not.toContain("<button");
  });

  it("quem passa o predicado decide o que é link: um valor que o predicado recusa (aqui, um de teste que recusa a barra invertida) fica texto", () => {
    const noBackslash = (value: string) => !value.includes("\\");

    expect(cell(renderLinks(["a\\b", "x"], { linkable: noBackslash }), 2)).not.toContain("<button");
    expect(cell(renderLinks(["ab", "x"], { linkable: noBackslash }), 2)).toContain("<button");
    // Sem o predicado, vale só o que cabe numa linha de filtro.
    expect(cell(renderLinks(["a\\b", "x"]), 2)).toContain("<button");
  });

  it("sem links (o resultado de uma consulta, ou a vista antes de as chaves chegarem), a grade é a de sempre", () => {
    expect(renderLinks(["42", "x"], { links: undefined })).not.toContain("<button");
    expect(renderLinks(["42", "x"], { onFollow: undefined })).not.toContain("<button");
  });

  it("o valor entra como texto: marcação nele não vira elemento (RN-SHELL-002)", () => {
    const markup = renderLinks(["<b>1</b>", "x"]);

    expect(markup).toContain("&lt;b&gt;1&lt;/b&gt;");
    expect(markup).not.toContain("<b>");
  });
});

describe("a divisa à direita do cabeçalho de cada coluna (RN-GRADE-009)", () => {
  const item = virtualColumns[0];
  const resizable = { width: 100, last: false, onResize: () => {}, onFit: () => {} };
  const renderHeader = (over: Partial<Parameters<typeof GridHeaderCell>[0]> = {}) => renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[0], item, ...over }));

  it("o cabeçalho com o nome e o botão de ordenar tem a divisa AO LADO deles, e não dentro: o clique que termina um arrasto não escolhe nem ordena", () => {
    const markup = renderHeader({ ...resizable, choosable: true, sort: { direction: null, reason: null, onSort: () => {} } });

    expect(markup).toMatch(/<\/button><\/span><div[^>]*role="separator"/);
    for (const button of markup.match(/<button[\s\S]*?<\/button>/g) ?? []) expect(button).not.toContain("separator");
  });

  it("o cabeçalho só de texto (o resultado de uma consulta) também tem a divisa", () => {
    expect(renderHeader(resizable)).toMatch(/<div[^>]*role="separator"[^>]*aria-orientation="vertical"/);
  });

  it("a divisa diz a largura de 100% (a guardada), e não a da tela", () => {
    expect(renderHeader({ ...resizable, width: 173 })).toContain('aria-valuenow="173"');
  });

  it("sem quem mude a largura, não há divisa", () => {
    expect(renderHeader()).not.toContain("separator");
    expect(renderHeader({ choosable: true, sort: { direction: null, reason: null, onSort: () => {} } })).not.toContain("separator");
  });

  it("o nome do cabeçalho para o leitor de tela é o da coluna e o tipo, e não o da divisa que mora dentro dele", () => {
    expect(renderHeader(resizable)).toMatch(/<div role="columnheader"[^>]*aria-label="id int4"/);
    expect(renderHeader({ ...resizable, choosable: true, sort: { direction: null, reason: null, onSort: () => {} } })).toMatch(/<div role="columnheader"[^>]*aria-label="id int4"/);
  });
});

describe("a marca da coluna que não se edita, na aba de consulta (RN-EDIT-002)", () => {
  const item = virtualColumns[0];
  const renderHeader = (over: Partial<Parameters<typeof GridHeaderCell>[0]> = {}) => renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[0], item, ...over }));
  const mark = recordsCopy.edit.readOnlyMark;

  it("depois do tipo, como no canvas, e no nome para o leitor de tela; a dica diz o motivo", () => {
    const markup = renderHeader({ readOnlyMark: true, hint: recordsCopy.edit.readOnly("coluna da chave numa junção") });

    expect(markup).toContain(`>int4 · ${mark}<`);
    expect(markup).toMatch(new RegExp(`aria-label="id int4, ${mark}"`));
    expect(markup).toContain("Somente leitura: coluna da chave numa junção.");
  });

  it("sem o tipo à mostra, só a marca; a coluna que se edita não tem marca", () => {
    expect(renderHeader({ readOnlyMark: true, showType: false })).toContain(`>${mark}<`);
    expect(renderHeader()).not.toContain(mark);
  });
});

describe("o tipo de dado no cabeçalho é uma preferência (RN-CONFIG-006)", () => {
  const item = virtualColumns[0];
  const renderHeader = (over: Partial<Parameters<typeof GridHeaderCell>[0]> = {}) => renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[0], item, ...over }));

  it("ligado (o padrão), o cabeçalho mostra o nome e o tipo", () => {
    expect(renderHeader()).toContain(">int4<");
    expect(renderHeader({ showType: true, choosable: true, sort: { direction: null, reason: null, onSort: () => {} } })).toContain(">int4<");
  });

  it("desligado, só o nome, nos dois cabeçalhos; o nome para o leitor de tela é o que se vê", () => {
    for (const markup of [renderHeader({ showType: false }), renderHeader({ showType: false, choosable: true, sort: { direction: "asc", reason: null, onSort: () => {} } })]) {
      expect(markup).toContain(">id<");
      expect(markup).not.toContain(">int4<");
      expect(markup).toMatch(/<div role="columnheader"[^>]*aria-label="id"/);
    }
  });

  it("desligado, a dica do cabeçalho só de texto ainda diz o tipo, para quem quiser saber", () => {
    expect(renderHeader({ showType: false })).toContain('title="id · int4"');
  });
});

describe("o zoom da grade (RN-GRADE-010)", () => {
  /** A grade inteira, sem DOM: a lista virtual não desenha linha nenhuma, mas a caixa que rola e o cabeçalho saem. */
  const grid = (zoom?: 50 | 100 | 150) => renderToStaticMarkup(createElement(ResultGrid, { columns, rows: [["1", "a"]], truncated: new Map(), zoom }));
  const styleOf = (markup: string) => /<div[^>]*role="table"[^>]*style="([^"]*)"/.exec(markup)?.[1] ?? "";

  it("em 100% as medidas são as de antes, número por número: linha de 32 px, número da linha em 64 px, texto e espaços sem escala", () => {
    const style = styleOf(grid(100));

    expect(style).toContain("--grid-row:32px");
    expect(style).toContain("--grid-gutter:64px");
    expect(style).toContain("--grid-zoom:1");
    expect(style).toContain("--spacing:calc(0.25rem * 1)");
    expect(style).toContain("font-size:calc(var(--text-sm) * 1)");
    // Sem zoom dado, é 100%.
    expect(styleOf(grid())).toBe(style);
  });

  it("noutro zoom, o texto, a linha, o número da linha e os espaços da grade mudam juntos", () => {
    const style = styleOf(grid(150));

    expect(style).toContain("--grid-row:48px");
    expect(style).toContain("--grid-gutter:96px");
    expect(style).toContain("--spacing:calc(0.25rem * 1.5)");
    expect(style).toContain("font-size:calc(var(--text-sm) * 1.5)");
  });

  it("a linha, o cabeçalho e o número da linha tomam a altura e a largura do zoom (as variáveis da caixa), e não medidas fixas", () => {
    const row = renderToStaticMarkup(createElement(GridRow, { index: 0, start: 0, row: ["1", "a"], columns, virtualColumns, truncated: undefined, nullText: "NULL" }));
    const head = grid(100);

    for (const markup of [row, head]) {
      expect(markup).toMatch(/role="row"[^>]*class="[^"]*h-\(--grid-row\)[^"]*leading-\(--grid-row\)/);
      expect(markup).not.toMatch(/role="row"[^>]*class="[^"]*\bh-8\b/);
    }
    expect(row).toMatch(/role="rowheader"[^>]*class="[^"]*w-\(--grid-gutter\)/);
    expect(head).toMatch(/role="columnheader" class="[^"]*w-\(--grid-gutter\)/);
  });

  it("o tipo, no cabeçalho, acompanha o zoom (11 px em 100%)", () => {
    expect(renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[0], item: virtualColumns[0] }))).toContain("text-[length:calc(11px*var(--grid-zoom))]");
  });

  it("a dica do valor que não cabe conta a largura do zoom: em 50% a coluna estreita ainda cabe o valor, e não ganha dica", () => {
    const narrow = [{ ...virtualColumns[1], size: 55 }];
    const at = (scale: number) => renderToStaticMarkup(createElement(GridRow, { index: 0, start: 0, row: ["1", "0123456789"], columns, virtualColumns: narrow, truncated: undefined, nullText: "NULL", scale }));

    expect(at(0.5)).not.toContain('title="0123456789"');
    expect(at(1)).toContain('title="0123456789"');
  });
});

describe("a linha da grade editável (seção 22, RN-EDIT-001 e 004)", () => {
  const cellIdOf = (row: number, column: number) => `g-${row}-${column}`;
  const renderEditable = (extra: Partial<Parameters<typeof GridRow>[0]>, row: (string | null)[] = ["1", "aberta"]) =>
    renderToStaticMarkup(createElement(GridRow, { index: 0, start: 0, row, columns, virtualColumns, truncated: undefined, nullText: "NULL", cellIdOf, ...extra }));
  const cell = (markup: string, column: number) => markup.match(new RegExp(`<div[^>]*id="g-0-${column}"[^>]*>.*?</div>`, "s"))?.[0] ?? "";

  it("com a edição, as células são `gridcell`, com o id e a posição que o clique e o teclado leem, e a ativa é marcada", () => {
    const markup = renderEditable({ activeColumn: 1, selectedFrom: 1, selectedTo: 1 });

    expect(markup.match(/role="gridcell"/g)).toHaveLength(2);
    expect(cell(markup, 1)).toMatch(/data-row="0"[^>]*data-col="1"[^>]*aria-selected="true"/);
    expect(cell(markup, 0)).toContain('aria-selected="false"');
    expect(cell(markup, 1)).toContain("outline-accent");
  });

  it("RN-GRADE-001: as células escolhidas dizem que estão (`aria-selected`) e têm o fundo de escolha; o número da linha escolhida fica destacado", () => {
    const markup = renderEditable({ activeColumn: 0, selectedFrom: 0, selectedTo: 1 });

    expect(cell(markup, 0)).toContain('aria-selected="true"');
    expect(cell(markup, 1)).toContain('aria-selected="true"');
    expect(cell(markup, 1)).toContain("bg-selected");
    expect(markup).toMatch(/role="rowheader" data-rowheader="0"[^>]*class="[^"]*bg-selected/);
    // A linha sem célula escolhida não tem nada disso.
    const plain = renderEditable({});
    expect(cell(plain, 0)).toContain('aria-selected="false"');
    expect(plain).not.toContain("bg-selected");
  });

  it("RN-GRADE-022: com colunas inteiras, as células delas ficam escolhidas em toda linha desenhada, e o número da linha não fica destacado", () => {
    const markup = renderEditable({ wholeColumns: new Set([1]) });

    expect(cell(markup, 1)).toContain('aria-selected="true"');
    expect(cell(markup, 1)).toContain("bg-selected");
    expect(cell(markup, 0)).toContain('aria-selected="false"');
    expect(markup).not.toMatch(/role="rowheader"[^>]*class="[^"]*bg-selected/);
  });

  it("RN-GRADE-001: a célula com alteração pendente escolhida continua marcada como pendente, num tom mais forte", () => {
    const pending = cell(renderEditable({ selectedFrom: 1, selectedTo: 1, mark: { kind: "read", deleted: false, pending: new Map([[1, "paga"]]), failed: false } }), 1);

    expect(pending).toContain("bg-accent/35");
    expect(pending).toContain('aria-selected="true"');
  });

  it("a célula alterada mostra o valor lido riscado ao lado do novo, como no canvas; o NULL novo tem a cor do nulo", () => {
    const changed = cell(renderEditable({ mark: { kind: "read", deleted: false, pending: new Map([[1, "paga"]]), failed: false } }), 1);
    const toNull = cell(renderEditable({ mark: { kind: "read", deleted: false, pending: new Map([[1, null]]), failed: false } }), 1);

    expect(changed).toMatch(/line-through">aberta<\/span>paga/);
    expect(changed).toContain("bg-accent/20");
    expect(toNull).toMatch(/line-through">aberta<\/span><span class="text-subtle">NULL<\/span>/);
  });

  it("a linha nova é marcada no número da linha, e a coluna que ninguém preencheu fica vazia, para o padrão da tabela", () => {
    const markup = renderEditable({ mark: { kind: "new", deleted: false, pending: new Map([[1, "nova"]]), failed: false } }, [null, "nova"]);

    expect(markup).toMatch(/role="rowheader"[^>]*title="Linha nova"/);
    expect(cell(markup, 0)).not.toContain("NULL");
    expect(cell(markup, 1)).toContain(">nova<");
    expect(cell(markup, 1)).not.toContain("line-through");
  });

  it("a linha marcada para exclusão fica riscada, e a que falhou no Salvar, destacada", () => {
    const deleted = renderEditable({ mark: { kind: "read", deleted: true, pending: new Map(), failed: false } });
    const failed = renderEditable({ mark: { kind: "read", deleted: false, pending: new Map(), failed: true } });

    expect(cell(deleted, 1)).toContain("line-through");
    expect(failed).toMatch(/role="row"[^>]*bg-danger\/15/);
  });

  it("sem a edição, a linha continua só leitura: `cell`, sem id nem posição", () => {
    const markup = render(["1", "aberta"]);

    expect(markup).not.toContain("gridcell");
    expect(markup).not.toContain("data-col");
  });
});

describe("a linha nova salva na aba de consulta, com o que o banco preencheu (RN-EDIT-009)", () => {
  it("a coluna que o banco preencheu diz 'gerado pelo banco — execute de novo para ver', com a cor do nulo, e não 'NULL'", () => {
    const markup = renderToStaticMarkup(createElement(GridRow, { index: 0, start: 0, row: [null, "nova"], columns, virtualColumns, truncated: undefined, generated: new Set([0]), nullText: "NULL" }));
    const generated = markup.match(/<div[^>]*aria-colindex="2"[^>]*>.*?<\/div>/s)?.[0] ?? "";

    expect(generated).toContain(recordsCopy.edit.generated);
    expect(generated).toContain("text-subtle");
    expect(generated).not.toContain(">NULL<");
    expect(markup).toContain(">nova<");
  });
});

describe("a coluna inteira pendente na grade (RN-EDIT-018)", () => {
  const cellIdOf = (row: number, column: number) => `g-${row}-${column}`;
  const pending = new Map([[1, { value: "fechada", hint: "Alteração pendente em todas as linhas: observacao = 'fechada'", uncertain: false }]]);
  const render = (extra: Partial<Parameters<typeof GridRow>[0]> = {}, row: (string | null)[] = ["1", "aberta"]) =>
    renderToStaticMarkup(createElement(GridRow, { index: 0, start: 0, row, columns, virtualColumns, truncated: undefined, nullText: "NULL", cellIdOf, columnPending: pending, ...extra }));
  const cell = (markup: string, column: number) => markup.match(new RegExp(`<div[^>]*id="g-0-${column}"[^>]*>.*?</div>`, "s"))?.[0] ?? "";

  it("a célula daquela coluna na linha lida mostra o valor novo, com o lido riscado ao lado, como uma pendência", () => {
    const markup = cell(render(), 1);
    expect(markup).toContain("bg-accent/20");
    expect(markup).toMatch(/line-through">aberta<\/span>fechada/);
    expect(markup).toContain('title="Valor lido: aberta"');
    // A outra coluna não muda.
    expect(cell(render(), 0)).not.toContain("line-through");
  });

  it("a célula com pendência própria mostra o valor dela, com o da coluna inteira riscado; a linha nova e a excluída não recebem a coluna inteira", () => {
    const own = cell(render({ mark: { kind: "read", deleted: false, pending: new Map([[1, "paga"]]), failed: false } }), 1);
    expect(own).toMatch(/line-through">fechada<\/span>paga/);
    expect(own).toContain('title="Valor da coluna inteira: fechada"');

    expect(cell(render({ mark: { kind: "new", deleted: false, pending: new Map(), failed: false } }, [null, null]), 1)).not.toContain("fechada");
    expect(cell(render({ mark: { kind: "read", deleted: true, pending: new Map(), failed: false } }), 1)).not.toContain("fechada");
  });

  it("a nota da coluna que pode estar gravada em parte das linhas vai na dica da célula", () => {
    const uncertain = new Map([[1, { value: "x", hint: "h", uncertain: true }]]);
    expect(cell(render({ columnPending: uncertain }), 1)).toContain("o valor desta coluna pode estar gravado em parte das linhas");
  });

  it("o cabeçalho ganha o ponto no tom de atenção, a dica e o nome para o leitor de tela", () => {
    const header = renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[1], item: virtualColumns[1], choosable: true, pendingHint: "Alteração pendente em todas as linhas: observacao = 'fechada'" }));
    expect(header).toContain("data-column-pending");
    expect(header).toContain("bg-accent");
    expect(header).toContain("observacao · text\nAlteração pendente em todas as linhas: observacao = &#x27;fechada&#x27;");
    expect(header).toContain('aria-label="observacao text, alteração pendente em todas as linhas"');
    expect(renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[1], item: virtualColumns[1], choosable: true }))).not.toContain("data-column-pending");
  });
});
