import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EnvironmentPill, Select, type SelectOption } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { allEnvironments, noEnvironment, type EnvironmentChoice } from "../_lib/navigator-environment";
import { navigatorCopy } from "../_lib/navigator.copy";
import { NavigatorEnvironmentFilter, clearChoice } from "./navigator-environment-filter";

const copy = navigatorCopy.environmentFilter;
const environments = [
  { key: "produção", name: "Produção", color: "#FF8A7A" },
  { key: "qas", name: "QAS", color: null },
];

/** O botão do seletor de mentira: ganhar o foco é virar o elemento ativo da página, e o teste anota em que ordem as coisas aconteceram. */
function selectButton(events: string[] = []) {
  return { current: { focus: vi.fn(() => void events.push("foco")) } as unknown as HTMLButtonElement };
}

function drawn(value: EnvironmentChoice, onChange: (choice: EnvironmentChoice) => void = () => {}, selectRef = selectButton()) {
  const all = elementsOf(NavigatorEnvironmentFilter({ environments, value, onChange, selectRef }));
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

  it("o 'Limpar' leva o foco ao seletor ANTES de a escolha voltar a 'Todos' (que tira o x da tela): o foco não cai no corpo da página (o clique e o Enter no x são o mesmo clique)", () => {
    const events: string[] = [];
    const selectRef = selectButton(events);
    const onChange = vi.fn(() => void events.push("escolha"));
    const { clear } = drawn({ type: "environment", key: "qas" }, onChange, selectRef);

    (clear?.props.onClick as () => void)();

    expect(events).toEqual(["foco", "escolha"]);
    expect(selectRef.current.focus).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledExactlyOnceWith(allEnvironments);
  });

  it("clearChoice: sem o botão do seletor na tela (o `ref` ainda nulo), só limpa a escolha", () => {
    const onChange = vi.fn();

    clearChoice({ current: null }, onChange);

    expect(onChange).toHaveBeenCalledExactlyOnceWith(allEnvironments);
  });

  it("o seletor guarda o botão no `ref` de quem o pediu e abre a lista larga: as opções não quebram, e a lista cresce até o maior texto (\"Todos os ambientes\")", () => {
    const selectRef = selectButton();
    const { select } = drawn(allEnvironments, () => {}, selectRef);

    expect(select.props.triggerRef).toBe(selectRef);
    expect(select.props.wideList).toBe(true);
  });

  it("o seletor fechado desenha a etiqueta do escolhido", () => {
    const markup = renderToStaticMarkup(createElement(NavigatorEnvironmentFilter, { environments, value: { type: "environment", key: "produção" }, onChange: () => {}, selectRef: selectButton() }));

    expect(markup).toMatch(/role="combobox"[^>]*aria-label="Filtrar por ambiente"/);
    expect(markup).toMatch(/<span style="background-color:#FF8A7A;color:#14181D"[^>]*>Produção<\/span>/);
  });
});
