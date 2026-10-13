import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { VirtualItem } from "@tanstack/react-virtual";
import { describe, expect, it } from "vitest";

import type { QueryColumn } from "../_lib/query.schema";
import { recordsCopy } from "../_lib/records.copy";
import { GridHeaderCell, GridRow, ResultGrid } from "./result-grid";

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

describe("o cabeçalho da grade que ordena (RN-TABELA-005)", () => {
  const item = virtualColumns[0];
  const renderHeader = (over: Partial<Parameters<typeof GridHeaderCell>[0]> = {}) => renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[0], item, ...over }));

  it("no resultado de uma consulta é só texto: nome e tipo, sem botão", () => {
    const markup = renderHeader();

    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("aria-sort");
    expect(markup).toContain(">id<");
    expect(markup).toContain(">int4<");
  });

  it("na vista Registros é um botão, sem ordem ainda: 'none' e a dica diz que o clique ordena crescente", () => {
    const markup = renderHeader({ sort: null, onSort: () => {} });

    expect(markup).toContain('aria-sort="none"');
    expect(markup).toMatch(/<button[^>]*title="Ordenar por id \(crescente\)"/);
    expect(markup).not.toContain("<svg");
  });

  it("ordenada por esta coluna: 'ascending' ou 'descending', a seta aponta o sentido e a dica diz o próximo clique", () => {
    const asc = renderHeader({ sort: { column: "id", direction: "asc" }, onSort: () => {} });
    const desc = renderHeader({ sort: { column: "id", direction: "desc" }, onSort: () => {} });

    expect(asc).toContain('aria-sort="ascending"');
    expect(asc).toContain("Ordenar por id (decrescente)");
    expect(asc).toMatch(/<svg[^>]*rotate-180/);
    expect(desc).toContain('aria-sort="descending"');
    expect(desc).toContain("Tirar a ordem por id");
    expect(desc).not.toMatch(/<svg[^>]*rotate-180/);
  });

  // E1: a largura da coluna é calculada sem a seta da ordem. Quando ela aparece, alguém tem de ceder os 18 px dela: era o nome (o `id` encolhia a zero e
  // sobrava `integer ▲`). O vitest não tem layout: aqui se confere a REGRA de quem encolhe; a medida em pixels é da conferência na tela.
  const classesOf = (markup: string, pattern: RegExp) => (markup.match(pattern)?.[1] ?? "").split(" ");
  /** As classes da caixa do rótulo (a que tem o nome e o tipo dentro), do nome e do tipo. */
  const labelOf = (markup: string) => ({
    box: classesOf(markup, /<span class="([^"]*)"><span class="[^"]*">id<\/span>/),
    name: classesOf(markup, /<span class="([^"]*)">id<\/span>/),
    type: classesOf(markup, /<span class="([^"]*)">int4<\/span>/),
  });

  it.each([
    ["ordenado (com a seta)", () => renderHeader({ sort: { column: "id", direction: "asc" }, onSort: () => {} })],
    ["que ordena, sem ordem", () => renderHeader({ sort: null, onSort: () => {} })],
    ["só de texto (resultado de uma consulta)", () => renderHeader()],
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

  it("a seta da ordem nunca encolhe e fica FORA da caixa do rótulo: o que cabe ao nome já desconta a seta", () => {
    const markup = renderHeader({ sort: { column: "id", direction: "desc" }, onSort: () => {} });

    expect(classesOf(markup, /<svg[^>]*class="([^"]*)"/)).toContain("flex-none");
    // A caixa do rótulo fecha (nome, tipo) antes de a seta começar: a seta é irmã dela, e não filha.
    expect(markup).toMatch(/>int4<\/span><\/span><svg/);
  });

  it("a ordem de outra coluna não marca esta", () => {
    const markup = renderHeader({ sort: { column: "observacao", direction: "asc" }, onSort: () => {} });

    expect(markup).toContain('aria-sort="none"');
    expect(markup).not.toContain("<svg");
  });

  it("a coluna de número fica alinhada à direita também quando é botão", () => {
    expect(renderHeader({ sort: null, onSort: () => {} })).toMatch(/<button[^>]*justify-end/);
    expect(renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[1], item: virtualColumns[1], sort: null, onSort: () => {} }))).not.toMatch(/<button[^>]*justify-end/);
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

  it("o cabeçalho que ordena tem a divisa AO LADO do botão, e não dentro dele: o clique que termina um arrasto não ordena", () => {
    const markup = renderHeader({ ...resizable, sort: null, onSort: () => {} });

    expect(markup).toMatch(/<\/button><div[^>]*role="separator"/);
    expect(markup.match(/<button[\s\S]*?<\/button>/)?.[0]).not.toContain("separator");
  });

  it("o cabeçalho só de texto (o resultado de uma consulta) também tem a divisa", () => {
    expect(renderHeader(resizable)).toMatch(/<div[^>]*role="separator"[^>]*aria-orientation="vertical"/);
  });

  it("a divisa diz a largura de 100% (a guardada), e não a da tela", () => {
    expect(renderHeader({ ...resizable, width: 173 })).toContain('aria-valuenow="173"');
  });

  it("sem quem mude a largura, não há divisa", () => {
    expect(renderHeader()).not.toContain("separator");
    expect(renderHeader({ sort: null, onSort: () => {} })).not.toContain("separator");
  });

  it("o nome do cabeçalho para o leitor de tela é o da coluna e o tipo, e não o da divisa que mora dentro dele", () => {
    expect(renderHeader(resizable)).toMatch(/<div role="columnheader"[^>]*aria-label="id int4"/);
    expect(renderHeader({ ...resizable, sort: null, onSort: () => {} })).toMatch(/<div role="columnheader"[^>]*aria-label="id int4"/);
  });
});

describe("o tipo de dado no cabeçalho é uma preferência (RN-CONFIG-006)", () => {
  const item = virtualColumns[0];
  const renderHeader = (over: Partial<Parameters<typeof GridHeaderCell>[0]> = {}) => renderToStaticMarkup(createElement(GridHeaderCell, { column: columns[0], item, ...over }));

  it("ligado (o padrão), o cabeçalho mostra o nome e o tipo", () => {
    expect(renderHeader()).toContain(">int4<");
    expect(renderHeader({ showType: true, sort: null, onSort: () => {} })).toContain(">int4<");
  });

  it("desligado, só o nome, nos dois cabeçalhos; o nome para o leitor de tela é o que se vê", () => {
    for (const markup of [renderHeader({ showType: false }), renderHeader({ showType: false, sort: { column: "id", direction: "asc" }, onSort: () => {} })]) {
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
    const markup = renderEditable({ activeColumn: 1 });

    expect(markup.match(/role="gridcell"/g)).toHaveLength(2);
    expect(cell(markup, 1)).toMatch(/data-row="0"[^>]*data-col="1"[^>]*aria-selected="true"/);
    expect(cell(markup, 0)).toContain('aria-selected="false"');
    expect(cell(markup, 1)).toContain("outline-accent");
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
