import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { navItem } from "@/components/ui";

import type { StructureSection } from "../../_lib/structure-sections";
import { structureSections } from "../../_lib/structure-sections";
import type { DdlState } from "../../_lib/table-ddl";
import type { LevelView } from "../../_lib/table-structure";
import { structureColumns, structureForeignKeys, structureIndexes } from "../../_lib/table-structure";
import { StructureSections } from "./structure-sections";

const noop = () => {};

const ready: LevelView = { kind: "ready" };
const loading: LevelView = { kind: "loading" };

const columns = structureColumns(
  [
    { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true, position: 1 },
    { name: "ordem_id", type: "bigint", isNullable: false, isPrimaryKey: false, position: 2 },
    { name: "observacao", type: "text", isNullable: true, isPrimaryKey: false, position: 3 },
  ],
  [{ name: "fk_apontamento_ordem", columns: ["ordem_id"], referencedSchema: "producao", referencedTable: "ordem_producao", referencedColumns: ["id"] }],
);
const foreignKeys = structureForeignKeys([{ name: "fk_apontamento_ordem", columns: ["ordem_id"], referencedSchema: "producao", referencedTable: "ordem_producao", referencedColumns: ["id"] }], "producao");
const indexes = structureIndexes([{ name: "pk_apontamento", columns: ["id"], isUnique: true }]);

const ddlText = ["-- aviso", "CREATE TABLE \"producao\".\"apontamento\" (", "  \"id\" bigint NOT NULL", ");"].join("\n");
const ready_ddl: DdlState = { kind: "ready", text: ddlText, maybeView: false };

type Levels = { section?: StructureSection; columns?: LevelView; foreignKeys?: LevelView; indexes?: LevelView; ddl?: DdlState; fetching?: boolean };

/** As propriedades da vista com as três listas prontas (3 colunas, 1 chave estrangeira, 1 índice) e a seção dada (Colunas, se não disser). */
function propsOf(levels: Levels = {}) {
  return {
    section: levels.section ?? ("columns" as StructureSection),
    onSection: noop,
    columns: { view: levels.columns ?? ready, rows: columns },
    foreignKeys: { view: levels.foreignKeys ?? ready, rows: foreignKeys },
    indexes: { view: levels.indexes ?? ready, rows: indexes },
    ddl: levels.ddl ?? ready_ddl,
    onCopyDdl: noop,
    fetching: levels.fetching ?? false,
    onRefresh: noop,
    onOpenDiagram: noop,
    onRetry: noop,
  };
}

/** O ponto de quebra depois de `_` e `.` (`<wbr>`) não é caractere: para ler o texto das células, a marcação sai sem ele. */
const withoutBreaks = (markup: string) => markup.replaceAll("<wbr/>", "");

function render(levels: Levels = {}) {
  return withoutBreaks(renderToStaticMarkup(createElement(StructureSections, propsOf(levels))));
}

/** Os atributos de uma marca de abertura, sem depender da ordem em que o React os escreve. */
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

/** As entradas da lista lateral, com o texto delas (o nome e a marca). */
const tabsOf = (markup: string) => [...markup.matchAll(/<button([^>]*role="tab"[^>]*)>([^]*?)<\/button>/g)].map((match) => ({ attrs: attributes(match[1]), text: match[2].replace(/<[^>]*>/g, ""), inner: match[2] }));

/** Só o painel da seção (do `tabpanel` em diante): a lista lateral, que vem antes dele, também rola e não conta. */
const panelOf = (markup: string) => markup.slice(markup.indexOf('role="tabpanel"'));

const sectionTitles = { columns: "Colunas", foreignKeys: "Chaves estrangeiras", indexes: "Índices", ddl: "DDL" } as const;

describe("a lista lateral da Estrutura (RN-TABELA-009)", () => {
  it("tem as quatro seções nesta ordem: Colunas, Chaves estrangeiras, Índices e DDL", () => {
    const tabs = tabsOf(render());

    expect(tabs.map((tab) => tab.attrs.role)).toEqual(["tab", "tab", "tab", "tab"]);
    expect(tabs.map((tab) => tab.inner.match(/>([^<]+)<\/span>/)?.[1])).toEqual(structureSections.map((section) => sectionTitles[section]));
    expect(render()).toMatch(/<div[^>]*role="tablist"[^>]*aria-orientation="vertical"|<div[^>]*aria-orientation="vertical"[^>]*role="tablist"/);
  });

  it.each(structureSections)("com %s escolhida só ela está selecionada", (section) => {
    const tabs = tabsOf(render({ section }));

    expect(tabs.map((tab) => tab.attrs["aria-selected"])).toEqual(structureSections.map((candidate) => String(candidate === section)));
    expect(tabs.map((tab) => tab.attrs.tabindex)).toEqual(structureSections.map((candidate) => (candidate === section ? "0" : "-1")));
    expect(tabs.map((tab) => tab.attrs.class)).toEqual(structureSections.map((candidate) => navItem({ active: candidate === section })));
  });

  it("cada entrada diz quantos itens a seção tem: a contagem que era do título do cartão", () => {
    const [columnsTab, foreignKeysTab, indexesTab, ddlTab] = tabsOf(render());

    expect(columnsTab.text).toBe("Colunas3");
    expect(foreignKeysTab.text).toBe("Chaves estrangeiras1");
    expect(indexesTab.text).toBe("Índices1");
    // O DDL não tem contagem.
    expect(ddlTab.text).toBe("DDL");
  });

  it("enquanto uma lista carrega, a entrada dela não mostra número (nem zero); as outras mostram o que têm", () => {
    const [columnsTab, foreignKeysTab, indexesTab] = tabsOf(render({ columns: loading, indexes: loading }));

    expect(columnsTab.text).toBe("Colunas");
    expect(indexesTab.text).toBe("Índices");
    expect(foreignKeysTab.text).toBe("Chaves estrangeiras1");
    expect(columnsTab.text).not.toMatch(/\d/);
  });

  it("a lista que chegou vazia mostra zero", () => {
    const tabs = tabsOf(render({ foreignKeys: { kind: "empty" }, indexes: { kind: "empty" } }));

    expect(tabs.map((tab) => tab.text)).toEqual(["Colunas3", "Chaves estrangeiras0", "Índices0", "DDL"]);
  });

  it("a seção que falhou mostra a marca de aviso no lugar do número, com texto para o leitor de tela, e a entrada continua clicável; as outras seguem com a contagem", () => {
    const tabs = tabsOf(render({ foreignKeys: { kind: "error", message: "permission denied", sessionLost: false } }));

    expect(tabs[1].inner).toContain("Falhou ao carregar");
    expect(tabs[1].inner).toMatch(/aria-hidden="true"[^>]*>!</);
    expect(tabs[1].text).not.toMatch(/\d/);
    expect(tabs[1].attrs).not.toHaveProperty("disabled");
    expect(tabs.map((tab) => tab.text)).toEqual(["Colunas3", "Chaves estrangeiras!Falhou ao carregar", "Índices1", "DDL"]);
  });

  it("o painel é o `tabpanel` rotulado pela entrada da seção escolhida, e todas as entradas apontam para ele", () => {
    for (const section of structureSections) {
      const markup = render({ section });
      const panels = [...markup.matchAll(/<div([^>]*role="tabpanel"[^>]*)>/g)].map((match) => attributes(match[1]));
      const tabs = tabsOf(markup);

      expect(panels, section).toHaveLength(1);
      expect(panels[0]["aria-labelledby"], section).toBe(tabs[structureSections.indexOf(section)].attrs.id);
      expect(new Set(tabs.map((tab) => tab.attrs["aria-controls"])), section).toEqual(new Set([panels[0].id]));
    }
  });
});

describe("a seção escolhida ocupa o painel sozinha: as outras não são desenhadas", () => {
  /** O que cada seção desenha que só ela desenha (o cabeçalho de uma coluna da tabela dela, ou o bloco do DDL). */
  const signature = { columns: ">Aceita nulo<", foreignKeys: ">Referência<", indexes: ">Único<", ddl: "<pre" } as const;

  it.each(structureSections)("%s: só o que é dela está na marcação", (section) => {
    const markup = render({ section });

    for (const other of structureSections) {
      if (other === section) expect(markup, `${section} tem o dela`).toContain(signature[other]);
      else expect(markup, `${section} não tem o de ${other}`).not.toContain(signature[other]);
    }
    expect(markup.match(/<table/g)?.length ?? 0).toBe(section === "ddl" ? 0 : 1);
    expect(markup.match(/<h3/g)).toHaveLength(1);
  });

  it("os dados das outras seções também ficam de fora, não só os cabeçalhos", () => {
    const columnsOnly = render({ section: "columns" });

    expect(columnsOnly).toContain(">ordem_id<");
    expect(columnsOnly).not.toContain("ordem_producao");
    expect(columnsOnly).not.toContain("pk_apontamento");
    expect(columnsOnly).not.toContain("CREATE TABLE");
    expect(render({ section: "indexes" })).not.toContain(">ordem_id<");
  });
});

describe("a seção Colunas (RN-TABELA-003)", () => {
  it("nome, tipo, se aceita nulo, e as marcas PK e FK; a API não devolve o padrão, e a tela não finge a coluna", () => {
    const markup = render();

    expect(markup).toMatch(/<h3[^>]*>Colunas<\/h3>/);
    expect(markup).toContain(">Aceita nulo<");
    expect(markup).toContain(">Chave<");
    expect(markup).not.toContain("Padrão");
    expect(markup).toMatch(/<td[^>]*>id<\/td><td[^>]*>bigint<\/td><td[^>]*>não<\/td><td[^>]*><span[^>]*><span[^>]*>PK<\/span><\/span><\/td>/);
    expect(markup).toMatch(/<td[^>]*>ordem_id<\/td>[^]*?<span[^>]*>FK<\/span>/);
    expect(markup).toMatch(/<td[^>]*>observacao<\/td><td[^>]*>text<\/td><td[^>]*>sim<\/td>/);
  });
});

describe("as seções Chaves estrangeiras e Índices (RN-TABELA-003)", () => {
  it("chaves estrangeiras: nome, colunas e a tabela referenciada com as colunas", () => {
    const markup = render({ section: "foreignKeys" });

    expect(markup).toMatch(/<h3[^>]*>Chaves estrangeiras<\/h3>/);
    expect(markup).toMatch(/<td[^>]*>fk_apontamento_ordem<\/td><td[^>]*>ordem_id<\/td><td[^>]*>ordem_producao \(id\)<\/td>/);
    expect(markup).not.toContain("Ao excluir");
  });

  it("índices: nome, colunas e se é único", () => {
    const markup = render({ section: "indexes" });

    expect(markup).toMatch(/<h3[^>]*>Índices<\/h3>/);
    expect(markup).toMatch(/<td[^>]*>pk_apontamento<\/td><td[^>]*>id<\/td><td[^>]*>sim<\/td>/);
    expect(markup).not.toContain("Método");
  });
});

describe.each([
  ["columns", "A API não achou colunas para esta tabela."],
  ["foreignKeys", "Esta tabela não tem chaves estrangeiras."],
  ["indexes", "Esta tabela não tem índices."],
] as const)("os estados da seção %s", (section, emptyText) => {
  const only = (view: LevelView) => ({ section, [section]: view }) as Levels;

  it("carregando: diz que carrega, sem tabela", () => {
    const markup = render(only(loading));

    expect(markup.match(/Carregando…/g)).toHaveLength(1);
    expect(markup).toMatch(/<p[^>]*role="status"[^>]*>Carregando…<\/p>/);
    expect(markup).not.toContain("<table");
  });

  it("falhou: a mensagem do banco, como veio, e 'Tentar de novo' uma vez só", () => {
    const markup = render(only({ kind: "error", message: 'permission denied for table "x"\nHINT: peça acesso', sessionLost: false }));

    expect(markup).toContain('permission denied for table &quot;x&quot;\nHINT: peça acesso');
    expect(markup.match(/Tentar de novo/g)).toHaveLength(1);
    expect(markup).not.toContain("<table");
    expect(markup).not.toContain("A sessão com o banco caiu");
  });

  it("a sessão que caiu diz isso e oferece 'Tentar de novo', que abre outra", () => {
    const markup = render(only({ kind: "error", message: "Sessão não encontrada.", sessionLost: true }));

    expect(markup).toContain("Sessão não encontrada.");
    expect(markup).toContain("A sessão com o banco caiu. Tentar de novo abre outra.");
    expect(markup).toContain("Tentar de novo");
  });

  it("a mensagem do banco é texto: marcação dentro dela não vira elemento (RN-SHELL-002)", () => {
    const markup = render(only({ kind: "error", message: "<img src=x onerror=alert(1)>", sessionLost: false }));

    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).not.toContain("<img");
  });

  it("vazio: a seção diz o que não tem", () => {
    const markup = render(only({ kind: "empty" }));

    expect(markup).toContain(emptyText);
    expect(markup).not.toContain("<table");
  });
});

describe("uma lista que falha não esconde as outras", () => {
  const failed: LevelView = { kind: "error", message: "permission denied", sessionLost: false };

  it("as chaves estrangeiras falharam: as colunas e os índices abrem normalmente, e a entrada das chaves avisa", () => {
    expect(render({ section: "columns", foreignKeys: failed })).toContain(">ordem_id<");
    expect(render({ section: "indexes", foreignKeys: failed })).toContain(">pk_apontamento<");
    expect(tabsOf(render({ section: "columns", foreignKeys: failed }))[1].inner).toContain("Falhou ao carregar");
  });

  it("escolher a seção que falhou mostra o erro dela, e não o das outras", () => {
    const markup = render({ section: "foreignKeys", foreignKeys: failed });

    expect(markup).toContain("permission denied");
    expect(markup.match(/Tentar de novo/g)).toHaveLength(1);
  });
});

describe("os botões 'Ver no diagrama' e 'Atualizar' ficam à vista em qualquer seção", () => {
  it.each(structureSections)("%s", (section) => {
    const panel = panelOf(render({ section }));

    expect(panel).toMatch(/<button[^>]*>Ver no diagrama<\/button>/);
    expect(panel).toMatch(/<button[^>]*>(?:<svg[^]*?<\/svg>)?Atualizar<\/button>/);
    // Estão no cabeçalho da seção, fora da área que rola: no painel, a ordem na marcação é cabeçalho, depois a rolagem.
    expect(panel.indexOf("overflow-y-auto")).toBeGreaterThan(0);
    expect(panel.indexOf("Atualizar")).toBeLessThan(panel.indexOf("overflow-y-auto"));
    expect(panel.indexOf("Ver no diagrama")).toBeLessThan(panel.indexOf("overflow-y-auto"));
  });

  it("'Atualizar' fica desabilitado enquanto busca, e a região diz que está ocupada", () => {
    const busy = render({ columns: loading, foreignKeys: loading, indexes: loading, ddl: { kind: "loading" }, fetching: true });

    expect(busy).toContain('aria-busy="true"');
    expect(busy).toMatch(/<button[^>]*disabled=""[^>]*>[^]*Atualizar/);
    expect(render()).toContain('aria-busy="false"');
  });
});

describe("a tabela da seção usa a largura toda: nada de barra horizontal, e o texto que não cabe quebra", () => {
  const owner = {
    name: "fk_users_institution_campuses_institution_id_campus_id",
    columns: "institution_id, campus_id",
    references: "catalogo.institution_campuses (institution_id, campus_id)",
  };
  const longForeignKeys = [{ ...owner }];
  const longIndexes = [{ name: "ix_users_academic_period_system_id_status_last_login_at", columns: "academic_period_system_id, status, last_login_at", unique: false }];

  const renderLongRaw = (section: StructureSection) => renderToStaticMarkup(createElement(StructureSections, { ...propsOf({ section }), foreignKeys: { view: ready, rows: longForeignKeys }, indexes: { view: ready, rows: longIndexes } }));
  const renderLong = (section: StructureSection) => withoutBreaks(renderLongRaw(section));

  it.each(structureSections)("%s: nenhum trecho da Estrutura rola na horizontal", (section) => {
    expect(renderLong(section)).not.toMatch(/overflow-x-(auto|scroll)/);
  });

  it("as células de texto (nome, tipo, colunas e referência) quebram em qualquer ponto em vez de empurrar a tabela, e nenhuma força uma linha só", () => {
    const cellOf = (markup: string, text: string) => new RegExp(`<td([^>]*)>${text.replace(/[()]/g, "\\$&")}</td>`).exec(markup)?.[1] ?? "";

    for (const [section, texts] of [
      ["columns", ["ordem_id", "bigint"]],
      ["foreignKeys", [owner.name, owner.columns, owner.references]],
      ["indexes", [longIndexes[0].name, longIndexes[0].columns]],
    ] as const) {
      const markup = renderLong(section);

      for (const text of texts) {
        const attrs = cellOf(markup, text);
        expect(attrs, `${section}: ${text}`).toContain("wrap-anywhere");
        expect(attrs, `${section}: ${text}`).not.toContain("whitespace-nowrap");
      }
    }
  });

  it("os nomes ganham um ponto de quebra depois de cada `_` e de cada `.`: a linha cai entre as palavras do nome, e o texto é o mesmo", () => {
    const foreignKeysMarkup = renderLongRaw("foreignKeys");

    expect(foreignKeysMarkup).toContain("fk_<wbr/>users_<wbr/>institution_<wbr/>campuses_<wbr/>institution_<wbr/>id_<wbr/>campus_<wbr/>id");
    expect(foreignKeysMarkup).toContain("institution_<wbr/>id, campus_<wbr/>id");
    expect(foreignKeysMarkup).toContain("catalogo.<wbr/>institution_<wbr/>campuses (institution_<wbr/>id, campus_<wbr/>id)");
    expect(renderLongRaw("indexes")).toContain("ix_<wbr/>users_<wbr/>academic_<wbr/>period_<wbr/>system_<wbr/>id_<wbr/>status_<wbr/>last_<wbr/>login_<wbr/>at");
    expect(renderLongRaw("columns")).toContain("ordem_<wbr/>id");
    // Só quebra: o texto que a pessoa seleciona e copia, e o que o leitor de tela lê, é o nome inteiro.
    expect(withoutBreaks(foreignKeysMarkup)).toContain(`>${owner.name}<`);
    // Um nome sem `_` nem `.` não ganha ponto de quebra nenhum.
    expect(renderLongRaw("columns")).toContain(">observacao<");
  });

  it("o cabeçalho da tabela fica fixo no topo da rolagem da seção, em células de fundo cheio", () => {
    for (const section of ["columns", "foreignKeys", "indexes"] as const) {
      const headers = [...render({ section }).matchAll(/<th(\s[^>]*)>/g)].map((match) => match[1]);

      expect(headers.length, section).toBeGreaterThan(0);
      for (const header of headers) {
        expect(header, section).toContain("sticky");
        expect(header, section).toContain("top-0");
        expect(header, section).toContain("bg-raised");
      }
    }
  });
});

describe("a lista vira uma faixa no topo quando o painel é estreito: consulta de contêiner, não de janela", () => {
  const classesOf = (markup: string, pattern: RegExp) => (pattern.exec(markup)?.[1] ?? "").split(" ").filter(Boolean);

  it("a Estrutura é o contêiner da consulta; a lista é uma fileira por padrão e uma coluna de 200 px ao lado da seção a partir de `@4xl`", () => {
    const markup = render();
    const root = classesOf(markup, /<div aria-busy="[^"]*" class="([^"]*)"/);
    const sides = classesOf(markup, /<div class="([^"]*@4xl:flex-row[^"]*)"/);
    const list = classesOf(markup, /<div role="tablist" aria-orientation="[^"]*" aria-label="[^"]*" class="([^"]*)"/);

    expect(root).toContain("@container");
    expect(sides).toEqual(expect.arrayContaining(["flex-col", "@4xl:flex-row"]));
    expect(list).toEqual(expect.arrayContaining(["flex-row", "flex-wrap", "border-b", "@4xl:w-[200px]", "@4xl:flex-col", "@4xl:flex-nowrap", "@4xl:border-r", "@4xl:border-b-0"]));
  });

  it("nenhuma variante de janela (`sm:`, `md:`, `lg:`, `xl:`, `2xl:`) decide o desenho: a largura que conta é a do contêiner", () => {
    for (const section of structureSections) expect(render({ section }), section).not.toMatch(/class="[^"]*(?:^|\s)(?:sm|md|lg|xl|2xl):/);
  });
});

describe("com duas abas de tabela montadas, nenhum id se repete e cada referência acha o seu alvo", () => {
  it("as duas Estruturas na mesma página", () => {
    const markup = renderToStaticMarkup(createElement(Fragment, null, createElement(StructureSections, propsOf({ section: "ddl" })), createElement(StructureSections, propsOf({ section: "indexes" }))));
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    const references = [...markup.matchAll(/aria-(?:labelledby|controls|describedby)="([^"]+)"/g)].map((match) => match[1]);

    expect(ids.length).toBeGreaterThan(8);
    expect(new Set(ids).size).toBe(ids.length);
    expect(references.length).toBeGreaterThan(8);
    for (const reference of references) expect(ids, reference).toContain(reference);
  });
});

describe("a seção DDL aproximado (RN-TABELA-008)", () => {
  const ddlSection = (ddl: DdlState) => render({ section: "ddl", ddl });

  it("o título, o aviso de que não é o DDL do banco (sempre à vista) e o texto, num bloco que o teclado alcança", () => {
    const markup = ddlSection(ready_ddl);

    expect(markup).toMatch(/<h3[^>]*>DDL aproximado<\/h3>/);
    expect(markup).toContain("e não é o DDL do banco: padrões, restrições de conferência e opções de armazenamento não aparecem.");
    expect(markup).toMatch(/<pre[^>]*tabindex="0"[^>]*aria-label="DDL aproximado da tabela"[^>]*aria-describedby="[^"]+"/);
    expect(markup).toContain("CREATE TABLE");
    // O aviso é o que descreve o bloco.
    const describedBy = /aria-describedby="([^"]+)"/.exec(markup)?.[1];
    expect(markup).toContain(`<p id="${describedBy}"`);
  });

  it("as linhas compridas do texto quebram em vez de rolar na horizontal; o que se copia é o texto, não a quebra", () => {
    const markup = ddlSection(ready_ddl);
    const pre = /<pre([^>]*)>/.exec(markup)?.[1] ?? "";

    expect(pre).toContain("whitespace-pre-wrap");
    expect(pre).toContain("wrap-anywhere");
    expect(pre).not.toContain("whitespace-pre ");
    expect(pre).not.toContain("overflow-x-auto");
  });

  it("o texto é SQL: usa a fonte do editor SQL (RN-CONFIG-008), e não a mono da grade", () => {
    const pre = /<pre([^>]*)>/.exec(ddlSection(ready_ddl))?.[1] ?? "";

    expect(pre).toMatch(/\bfont-editor\b/);
    expect(pre).not.toContain("font-mono");
  });

  it("o botão de copiar tem nome que diz o que copia, está habilitado com o DDL na mão e fica no cabeçalho da seção", () => {
    const markup = ddlSection(ready_ddl);

    expect(markup).toMatch(/<button[^>]*aria-label="Copiar o DDL aproximado"[^>]*>Copiar<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>Copiar/);
    expect(panelOf(markup).indexOf("Copiar o DDL aproximado")).toBeLessThan(panelOf(markup).indexOf("overflow-y-auto"));
  });

  it("só a seção DDL tem o botão de copiar", () => {
    for (const section of ["columns", "foreignKeys", "indexes"] as const) expect(render({ section })).not.toContain("Copiar o DDL aproximado");
  });

  it("enquanto as listas não chegaram (ou uma falhou) não há texto: o botão fica apagado e a seção diz quando o DDL aparece", () => {
    const markup = ddlSection({ kind: "loading" });

    expect(markup).not.toContain("<pre");
    expect(markup).toContain("O DDL aparece quando as colunas, as chaves estrangeiras e os índices chegarem.");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Copiar o DDL aproximado"|<button[^>]*aria-label="Copiar o DDL aproximado"[^>]*disabled=""/);
  });

  it("uma visão: o aviso de que o Prism não monta o DDL de visões no lugar do CREATE TABLE errado, e o botão apagado", () => {
    const markup = ddlSection({ kind: "view" });

    expect(markup).not.toContain("<pre");
    expect(markup).not.toContain("&quot;producao&quot;.&quot;apontamento&quot;");
    expect(markup).toContain("O Prism não monta o DDL de visões");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Copiar o DDL aproximado"|<button[^>]*aria-label="Copiar o DDL aproximado"[^>]*disabled=""/);
  });

  it("sem saber se é tabela ou visão: o texto sai, e a seção diz que pode ser uma visão (o aviso fica fora do texto copiado, que leva a dele)", () => {
    const markup = ddlSection({ kind: "ready", text: ddlText, maybeView: true });

    expect(markup).toContain("<pre");
    expect(markup).toContain("O Prism não sabe se este objeto é uma tabela ou uma visão");
    expect(markup).toContain("Se for uma visão, este CREATE TABLE não vale.");
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Copiar o DDL aproximado"/);
  });

  it("sabendo que é tabela, a seção não fala em visão", () => {
    expect(ddlSection(ready_ddl)).not.toContain("visão");
  });

  it("uma tabela sem colunas: diz que não há o que montar", () => {
    const markup = ddlSection({ kind: "empty" });

    expect(markup).not.toContain("<pre");
    expect(markup).toContain("A API não achou colunas para esta tabela: não há o que montar.");
  });

  it("o texto do DDL é texto: marcação nele não vira elemento (RN-SHELL-002)", () => {
    const markup = ddlSection({ kind: "ready", text: "-- <b>x</b>\nCREATE TABLE t ();", maybeView: false });

    expect(markup).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(markup).not.toContain("<b>x</b>");
  });
});
