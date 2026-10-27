import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { elementsOf } from "@/lib/testing/react-tree";

import { allEnvironments, type EnvironmentChoice } from "../_lib/navigator-environment";
import { navigatorCopy } from "../_lib/navigator.copy";
import { workbenchCopy } from "../_lib/workbench.copy";
import { NavigatorConnectedFilter } from "./navigator-connected-filter";
import { NavigatorEnvironmentFilter } from "./navigator-environment-filter";
import { NavigatorFilters } from "./navigator-filters";
import { NavigatorSearchField } from "./navigator-search-field";

const environments = [{ key: "produção", name: "Produção", color: "#FF8A7A" }];
const inputRef = { current: null };
const environmentRef = { current: null };
const production: EnvironmentChoice = { type: "environment", key: "produção" };

function propsOf(over: Partial<ComponentProps<typeof NavigatorFilters>> = {}): ComponentProps<typeof NavigatorFilters> {
  return {
    query: "",
    onQueryChange: vi.fn(),
    onFocusList: vi.fn(),
    inputRef,
    environments,
    environmentChoice: allEnvironments,
    onEnvironmentChange: vi.fn(),
    environmentRef,
    connectedCount: 3,
    onlyConnected: false,
    onToggleConnected: vi.fn(),
    ...over,
  };
}

/** A raiz da barra como o React a entrega: as duas linhas e os três controles, ainda sem desenhar cada um. */
const rootOf = (over: Partial<ComponentProps<typeof NavigatorFilters>> = {}) => elementsOf(NavigatorFilters(propsOf(over)))[0];
const classesOf = (element: { props: { className?: unknown } }) => String(element.props.className).split(" ");
const children = (element: { props: { children?: unknown } }) => (Array.isArray(element.props.children) ? element.props.children : [element.props.children]);

describe("a barra de filtros do navegador: a disposição (RN-NAV-010, RN-NAV-013 e RN-BUSCA-001)", () => {
  it("o campo de busca fica sozinho na primeira linha, na largura toda: a barra é uma coluna, e o campo é o primeiro filho", () => {
    const root = rootOf();

    expect(classesOf(root)).toEqual(expect.arrayContaining(["flex", "flex-col", "flex-none"]));
    expect(children(root)).toHaveLength(2);
    expect(children(root)[0].type).toBe(NavigatorSearchField);
  });

  it("na segunda linha estão \"Só as conectadas\" e o seletor de ambiente, nessa ordem, e a linha quebra: no navegador estreito o seletor desce", () => {
    const row = children(rootOf())[1];

    expect(row.type).toBe("div");
    expect(classesOf(row)).toEqual(expect.arrayContaining(["flex", "flex-wrap"]));
    expect(children(row).map((element: { type: unknown }) => element.type)).toEqual([NavigatorConnectedFilter, NavigatorEnvironmentFilter]);
  });

  it("os 6 px entre as linhas e entre os controles deixam o anel de foco inteiro, e os 8 px até a árvore são os do canvas", () => {
    const root = rootOf();

    expect(classesOf(root)).toEqual(expect.arrayContaining(["gap-1.5", "mx-2", "mb-2"]));
    expect(classesOf(children(root)[1])).toContain("gap-1.5");
  });

  it("a conta nunca é cortada: o botão tem a largura do texto e não quebra; o seletor tem o resto da linha, com a base de 8 rem e o mínimo de 112 px", () => {
    const button = elementsOf(NavigatorConnectedFilter({ count: 12, on: false, onToggle: () => {} })).find((element) => element.type === "button")!;
    const selector = elementsOf(NavigatorEnvironmentFilter({ environments, value: allEnvironments, onChange: () => {}, selectRef: environmentRef }))[0];

    expect(classesOf(button)).toEqual(expect.arrayContaining(["flex-none", "whitespace-nowrap", "h-8"]));
    expect(classesOf(selector)).toEqual(expect.arrayContaining(["flex-[1_1_8rem]", "min-w-28"]));
    expect(classesOf(selector)).not.toContain("flex-[1_1_9rem]");
  });

  it("o \"Limpar o filtro de ambiente\" fica dentro do lugar do seletor: escolher ou limpar o ambiente não muda a largura de nada", () => {
    const drawnSelector = (value: EnvironmentChoice) => {
      const all = elementsOf(NavigatorEnvironmentFilter({ environments, value, onChange: () => {}, selectRef: environmentRef }));
      return { root: all[0], clear: all.find((element) => element.type === "button") };
    };
    const [all, chosen] = [drawnSelector(allEnvironments), drawnSelector(production)];

    expect(classesOf(all.root)).toEqual(classesOf(chosen.root));
    expect(all.clear).toBeUndefined();
    expect(chosen.clear?.props["aria-label"]).toBe(navigatorCopy.environmentFilter.clear);
    expect(elementsOf(chosen.root).includes(chosen.clear!)).toBe(true);
  });
});

describe("a ordem do Tab segue a da tela (RN-NAV-010)", () => {
  const markup = (over: Partial<ComponentProps<typeof NavigatorFilters>> = {}) => renderToStaticMarkup(createElement(NavigatorFilters, propsOf(over)));
  const at = (html: string, needle: RegExp | string) => (typeof needle === "string" ? html.indexOf(needle) : html.search(needle));

  it("o campo, \"Só as conectadas\" e o seletor, nessa ordem de página", () => {
    const html = markup();

    expect(at(html, 'type="search"')).toBeGreaterThan(-1);
    expect(at(html, 'type="search"')).toBeLessThan(at(html, "aria-pressed"));
    expect(at(html, "aria-pressed")).toBeLessThan(at(html, 'role="combobox"'));
  });

  it("com texto na busca e um ambiente escolhido: o \"Limpar a busca\" vem depois do campo e antes de \"Só as conectadas\", e o \"Limpar o filtro de ambiente\" depois do seletor", () => {
    const html = markup({ query: "cli", environmentChoice: production });
    const clearSearch = at(html, `aria-label="${workbenchCopy.navigator.search.clear}"`);
    const clearEnvironment = at(html, `aria-label="${navigatorCopy.environmentFilter.clear}"`);

    expect(at(html, 'type="search"')).toBeLessThan(clearSearch);
    expect(clearSearch).toBeLessThan(at(html, "aria-pressed"));
    expect(at(html, "aria-pressed")).toBeLessThan(at(html, 'role="combobox"'));
    expect(at(html, 'role="combobox"')).toBeLessThan(clearEnvironment);
  });

  it("nada na barra tem `tabindex` positivo: a ordem do Tab é a do documento", () => {
    expect(markup({ query: "cli", environmentChoice: production })).not.toMatch(/tabindex="[1-9]/i);
  });
});

describe("a barra só distribui: cada controle recebe o estado e a ação que são do navegador", () => {
  it("o campo recebe o texto, a mudança, a ida à lista e a referência do `input` (o Ctrl+F e o Ctrl+Shift+E dependem dela)", () => {
    const props = propsOf({ query: "pedido" });
    const field = children(elementsOf(NavigatorFilters(props))[0])[0].props;

    expect(field).toMatchObject({ value: "pedido", onChange: props.onQueryChange, onFocusList: props.onFocusList, inputRef });
  });

  it("\"Só as conectadas\" recebe a conta, se está ligado e o clique que o alterna", () => {
    const props = propsOf({ connectedCount: 7, onlyConnected: true });
    const button = children(children(elementsOf(NavigatorFilters(props))[0])[1])[0].props;

    expect(button).toMatchObject({ count: 7, on: true, onToggle: props.onToggleConnected });
  });

  it("o seletor recebe os ambientes, a escolha e a mudança; escolher chama a ação do navegador", () => {
    const props = propsOf({ environmentChoice: production });
    const selector = children(children(elementsOf(NavigatorFilters(props))[0])[1])[1].props;

    expect(selector).toMatchObject({ environments, value: production, onChange: props.onEnvironmentChange, selectRef: environmentRef });
    (selector.onChange as (choice: EnvironmentChoice) => void)(allEnvironments);
    expect(props.onEnvironmentChange).toHaveBeenCalledExactlyOnceWith(allEnvironments);
  });

  it("o botão alterna ao clique", () => {
    const props = propsOf();
    const button = elementsOf(NavigatorConnectedFilter({ count: 3, on: false, onToggle: props.onToggleConnected })).find((element) => element.type === "button")!;
    (button.props.onClick as () => void)();

    expect(props.onToggleConnected).toHaveBeenCalledOnce();
  });
});
