import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EnvironmentPill, Select, type SelectOption } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { allEnvironments, noEnvironment, type EnvironmentChoice } from "../_lib/navigator-environment";
import { navigatorCopy } from "../_lib/navigator.copy";
import { NavigatorEnvironmentFilter } from "./navigator-environment-filter";

const copy = navigatorCopy.environmentFilter;
const environments = [
  { key: "produção", name: "Produção", color: "#FF8A7A" },
  { key: "qas", name: "QAS", color: null },
];

function drawn(value: EnvironmentChoice, onChange: (choice: EnvironmentChoice) => void = () => {}) {
  const all = elementsOf(NavigatorEnvironmentFilter({ environments, value, onChange }));
  const select = all.find((element) => element.type === Select) as Found;
  const clear = all.find((element) => element.type === "button" && element.props["aria-label"] === copy.clear);
  return { select, clear, options: select.props.options as SelectOption[] };
}

describe("o seletor de ambiente do navegador (RN-NAV-010)", () => {
  it("é o Select do app, com nome: 'Todos os ambientes' (o padrão), cada ambiente do usuário e 'Sem ambiente'", () => {
    const { select, options } = drawn(allEnvironments);

    expect(select.props["aria-label"]).toBe(copy.label);
    expect(options.map((option) => option.label)).toEqual([copy.all, "Produção", "QAS", copy.none]);
    expect(select.props.value).toBe(options[0].value);
  });

  it("cada ambiente aparece como a etiqueta colorida dele, na lista e no seletor fechado", () => {
    const { options } = drawn(allEnvironments);
    const pills = options.map((option) => elementsOf(option.content).find((element) => element.type === EnvironmentPill)?.props);

    expect(pills[1]).toMatchObject({ name: "Produção", color: "#FF8A7A" });
    expect(pills[2]).toMatchObject({ name: "QAS", color: null });
    expect(pills[0]).toBeUndefined();
    expect(pills[3]).toBeUndefined();
  });

  it("escolher na lista diz qual ambiente, 'Sem ambiente' ou 'Todos'", () => {
    const onChange = vi.fn();
    const { select, options } = drawn(allEnvironments, onChange);
    const choose = select.props.onChange as (value: string) => void;

    choose(options[1].value);
    choose(options[3].value);
    choose(options[0].value);

    expect(onChange.mock.calls.map(([choice]) => choice)).toEqual([{ type: "environment", key: "produção" }, noEnvironment, allEnvironments]);
  });

  it("a escolha que vem de fora é a que o seletor mostra", () => {
    const qas = drawn({ type: "environment", key: "qas" });
    const none = drawn(noEnvironment);

    expect(qas.select.props.value).toBe(qas.options[2].value);
    expect(none.select.props.value).toBe(none.options[3].value);
  });

  it("'Limpar' só aparece com um filtro escolhido, e volta a 'Todos'", () => {
    const onChange = vi.fn();

    expect(drawn(allEnvironments).clear).toBeUndefined();
    const { clear } = drawn({ type: "environment", key: "qas" }, onChange);
    expect(clear?.props.title).toBe(copy.clear);
    (clear?.props.onClick as () => void)();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(allEnvironments);
    expect(drawn(noEnvironment).clear).toBeDefined();
  });

  it("a lista do seletor é larga (`wideList`): as opções não quebram, e a lista cresce até o maior texto (\"Todos os ambientes\")", () => {
    expect(drawn(allEnvironments).select.props.wideList).toBe(true);
  });

  it("o seletor fechado desenha a etiqueta do escolhido", () => {
    const markup = renderToStaticMarkup(createElement(NavigatorEnvironmentFilter, { environments, value: { type: "environment", key: "produção" }, onChange: () => {} }));

    expect(markup).toMatch(/role="combobox"[^>]*aria-label="Filtrar por ambiente"/);
    expect(markup).toMatch(/<span style="background-color:#FF8A7A;color:#14181D"[^>]*>Produção<\/span>/);
  });
});
