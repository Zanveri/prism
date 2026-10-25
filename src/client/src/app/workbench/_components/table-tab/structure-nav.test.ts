import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { navItem } from "@/components/ui";
import { elementsOf } from "@/lib/testing/react-tree";
import { stripTags } from "@/lib/testing/text";

import type { StructureSection } from "../../_lib/structure-sections";
import { StructureNav, structurePanelId, structureTabId, type NavEntry } from "./structure-nav";

const base = "estrutura-1";

const entries: NavEntry[] = [
  { id: "columns", label: "Colunas", mark: { kind: "count", count: 16 } },
  { id: "foreignKeys", label: "Chaves estrangeiras", mark: { kind: "count", count: 4 } },
  { id: "indexes", label: "Índices", mark: { kind: "count", count: 7 } },
  { id: "ddl", label: "DDL", mark: { kind: "none" } },
];

function props(over: Partial<Parameters<typeof StructureNav>[0]> = {}) {
  return { idBase: base, entries, selected: "columns" as StructureSection, onSelect: () => {}, ...over };
}

const render = (over: Partial<Parameters<typeof StructureNav>[0]> = {}) => renderToStaticMarkup(createElement(StructureNav, props(over)));

/** Os atributos de uma marca de abertura, sem depender da ordem em que o React os escreve. */
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

/** Cada entrada da lista: os atributos do botão e o HTML de dentro dele. */
function tabsOf(markup: string) {
  return [...markup.matchAll(/<button([^>]*)>([^]*?)<\/button>/g)].map((match) => ({ attrs: attributes(match[1]), inner: match[2], text: stripTags(match[2]) }));
}

describe("a lista lateral de seções da Estrutura (RN-TABELA-009)", () => {
  it("é uma lista de abas VERTICAL, com nome, e uma entrada por seção na ordem dada", () => {
    const markup = render();
    const list = attributes(/<div([^>]*role="tablist"[^>]*)>/.exec(markup)?.[1] ?? "");

    expect(list["aria-orientation"]).toBe("vertical");
    expect(list["aria-label"]).toBe("Seções da estrutura");
    expect(tabsOf(markup).map((tab) => tab.attrs.role)).toEqual(["tab", "tab", "tab", "tab"]);
    expect(tabsOf(markup).map((tab) => tab.inner.match(/>([^<]+)<\/span>/)?.[1])).toEqual(["Colunas", "Chaves estrangeiras", "Índices", "DDL"]);
  });

  it.each(["columns", "foreignKeys", "indexes", "ddl"] as const)("com %s escolhida, só ela está selecionada e só ela entra no Tab (foco itinerante)", (selected) => {
    const tabs = tabsOf(render({ selected }));

    expect(tabs.filter((tab) => tab.attrs["aria-selected"] === "true")).toHaveLength(1);
    expect(tabs.map((tab) => [tab.attrs.id, tab.attrs["aria-selected"], tab.attrs.tabindex])).toEqual(entries.map((entry) => [structureTabId(base, entry.id), String(entry.id === selected), entry.id === selected ? "0" : "-1"]));
  });

  it("a orientação do ARIA é a de quem vê a lista: vertical ao lado da seção (o padrão) e horizontal na faixa de cima", () => {
    const orientationOf = (markup: string) => attributes(/<div([^>]*role="tablist"[^>]*)>/.exec(markup)?.[1] ?? "")["aria-orientation"];

    expect(orientationOf(render())).toBe("vertical");
    expect(orientationOf(render({ orientation: "vertical" }))).toBe("vertical");
    expect(orientationOf(render({ orientation: "horizontal" }))).toBe("horizontal");
  });

  it("cada entrada aponta para o painel da seção, e os ids dependem do id-base: duas listas montadas não colidem", () => {
    const tabs = tabsOf(render());

    expect(new Set(tabs.map((tab) => tab.attrs["aria-controls"]))).toEqual(new Set([structurePanelId(base)]));
    expect(structurePanelId("a")).not.toBe(structurePanelId("b"));
    expect(structureTabId("a", "columns")).not.toBe(structureTabId("b", "columns"));
    expect(structureTabId(base, "columns")).not.toBe(structureTabId(base, "indexes"));
  });

  it("a entrada escolhida é a da lista de Configurações (`navItem`), e as outras também", () => {
    const tabs = tabsOf(render({ selected: "indexes" }));

    expect(tabs.map((tab) => tab.attrs.class)).toEqual(entries.map((entry) => navItem({ active: entry.id === "indexes" })));
  });

  it("a contagem fica à direita do nome quando a lista chegou, e zero é contagem", () => {
    const markup = render({ entries: entries.map((entry) => (entry.id === "indexes" ? { ...entry, mark: { kind: "count" as const, count: 0 } } : entry)) });
    const [columns, foreignKeys, indexes] = tabsOf(markup);

    expect(columns.text).toBe("Colunas16");
    expect(foreignKeys.text).toBe("Chaves estrangeiras4");
    expect(indexes.text).toBe("Índices0");
  });

  it("a entrada sem marca (a lista carrega, ou o DDL) só tem o nome: nem número, nem zero, nem aviso", () => {
    const loading = render({ entries: entries.map((entry) => (entry.id === "columns" ? { ...entry, mark: { kind: "none" as const } } : entry)) });
    const [columns, , , ddl] = tabsOf(loading);

    expect(columns.text).toBe("Colunas");
    expect(ddl.text).toBe("DDL");
    expect(columns.text).not.toMatch(/\d/);
    expect(ddl.inner).not.toContain("Falhou");
  });

  it("a lista que falhou tem uma marca de aviso no lugar do número, com texto para o leitor de tela, e a entrada continua clicável", () => {
    const [, foreignKeys] = tabsOf(render({ entries: entries.map((entry) => (entry.id === "foreignKeys" ? { ...entry, mark: { kind: "failed" as const } } : entry)) }));

    // O texto do leitor de tela está na entrada; o glifo é só para a vista.
    expect(foreignKeys.inner).toMatch(/<span class="sr-only">Falhou ao carregar<\/span>/);
    expect(foreignKeys.inner).toMatch(/<span[^>]*aria-hidden="true"[^>]*>!<\/span>/);
    expect(foreignKeys.text).not.toMatch(/\d/);
    expect(foreignKeys.attrs).not.toHaveProperty("disabled");
    expect(foreignKeys.attrs["aria-disabled"]).toBeUndefined();
  });

  it("aceita mais entradas sem redesenho: uma sexta seção aparece na ordem em que vem", () => {
    const more: NavEntry[] = [...entries, { id: "references" as StructureSection, label: "Referenciada por", mark: { kind: "count", count: 2 } }];
    const tabs = tabsOf(render({ entries: more }));

    expect(tabs).toHaveLength(5);
    expect(tabs[4].text).toBe("Referenciada por2");
    expect(tabs.map((tab) => tab.attrs.tabindex)).toEqual(["0", "-1", "-1", "-1", "-1"]);
  });
});

describe("o teclado da lista de seções", () => {
  const focused: string[] = [];

  afterEach(() => {
    focused.length = 0;
    vi.unstubAllGlobals();
  });

  /** A entrada com o foco aperta `key`: devolve o que a lista fez (a seção pedida, se o `preventDefault` foi chamado e onde o foco foi parar). */
  function press(key: string, selected: StructureSection, list: NavEntry[] = entries, orientation?: "horizontal" | "vertical") {
    focused.length = 0;
    vi.stubGlobal("document", { getElementById: (id: string) => ({ focus: () => focused.push(id) }) });
    const onSelect = vi.fn();
    const preventDefault = vi.fn();
    const tab = elementsOf(StructureNav(props({ selected, onSelect, entries: list, orientation }))).find((element) => element.props.role === "tab" && element.props.id === structureTabId(base, selected));

    (tab!.props.onKeyDown as (event: unknown) => void)({ key, preventDefault });
    return { selected: onSelect.mock.calls.map(([section]) => section), prevented: preventDefault.mock.calls.length > 0, focused: [...focused] };
  }

  it("seta para baixo e seta para cima trocam a seção e levam o foco à entrada nova, com a volta nas pontas", () => {
    expect(press("ArrowDown", "columns")).toEqual({ selected: ["foreignKeys"], prevented: true, focused: [structureTabId(base, "foreignKeys")] });
    expect(press("ArrowDown", "ddl")).toMatchObject({ selected: ["columns"] });
    expect(press("ArrowUp", "indexes")).toMatchObject({ selected: ["foreignKeys"] });
    expect(press("ArrowUp", "columns")).toMatchObject({ selected: ["ddl"], focused: [structureTabId(base, "ddl")] });
  });

  it("Home e End vão à primeira e à última", () => {
    expect(press("Home", "indexes")).toMatchObject({ selected: ["columns"], prevented: true, focused: [structureTabId(base, "columns")] });
    expect(press("End", "indexes")).toMatchObject({ selected: ["ddl"], prevented: true, focused: [structureTabId(base, "ddl")] });
  });

  it("esquerda e direita não fazem nada (a lista é vertical), e Tab, Enter e as letras seguem o caminho deles", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Tab", "Enter", " ", "a"]) expect(press(key, "indexes"), key).toEqual({ selected: [], prevented: false, focused: [] });
  });

  it("na faixa de cima (a lista como fileira, com o painel estreito) valem esquerda e direita, e cima e baixo deixam de valer", () => {
    expect(press("ArrowRight", "columns", entries, "horizontal")).toEqual({ selected: ["foreignKeys"], prevented: true, focused: [structureTabId(base, "foreignKeys")] });
    expect(press("ArrowRight", "ddl", entries, "horizontal")).toMatchObject({ selected: ["columns"] });
    expect(press("ArrowLeft", "columns", entries, "horizontal")).toMatchObject({ selected: ["ddl"] });
    expect(press("Home", "indexes", entries, "horizontal")).toMatchObject({ selected: ["columns"] });
    expect(press("End", "indexes", entries, "horizontal")).toMatchObject({ selected: ["ddl"] });
    for (const key of ["ArrowUp", "ArrowDown", "Tab", "Enter"]) expect(press(key, "indexes", entries, "horizontal"), key).toEqual({ selected: [], prevented: false, focused: [] });
  });

  it("anda pela lista que recebeu: com uma entrada a mais, ela entra na volta", () => {
    const more: NavEntry[] = [...entries, { id: "references" as StructureSection, label: "Referenciada por", mark: { kind: "none" } }];

    expect(press("ArrowDown", "ddl", more)).toMatchObject({ selected: ["references"] });
    expect(press("ArrowDown", "references" as StructureSection, more)).toMatchObject({ selected: ["columns"] });
    expect(press("End", "columns", more)).toMatchObject({ selected: ["references"] });
  });

  it("o clique escolhe a seção da entrada", () => {
    const onSelect = vi.fn();
    const tabs = elementsOf(StructureNav(props({ onSelect }))).filter((element) => element.props.role === "tab");

    (tabs[2].props.onClick as () => void)();
    (tabs[3].props.onClick as () => void)();
    expect(onSelect.mock.calls).toEqual([["indexes"], ["ddl"]]);
  });
});
