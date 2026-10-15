import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A fileira com os ganchos do React simulados (`createHookRuntime`): a referência ao seletor do sistema é estado, e o vitest deste projeto não tem DOM.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { EyedropperIcon, NoColorIcon } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import { ColorField, type ColorFieldProps } from "./color-field";

const copy = connectionsCopy.iconColor;
const base: ColorFieldProps = { idPrefix: "folder", legend: connectionsCopy.folder.color, name: "color", color: null, onChange: () => {} };

function drawn(props: Partial<ColorFieldProps> = {}) {
  rt.unmount();
  const all = elementsOf(rt.render(() => ColorField({ ...base, ...props })));
  const swatches = all.filter((element) => element.type === "button");
  const picker = all.find((element) => element.type === "input" && element.props.type === "color") as Found;
  const hidden = all.find((element) => element.type === "input" && element.props.type === "hidden");
  return { all, swatches, none: swatches[0], other: swatches.at(-1) as Found, picker, hidden };
}

const markupOf = (props: Partial<ColorFieldProps> = {}) => {
  rt.unmount();
  return rt.render(() => renderToStaticMarkup(createElement(ColorField, { ...base, ...props })));
};

describe("a cor de um ícone (RN-PASTA-007 e RN-SCRIPT-006)", () => {
  it("é a fileira de bolinhas do ambiente com 'Sem cor' na frente: Sem cor, as seis do canvas e 'Outra cor', com o conta-gotas", () => {
    const { swatches, none, other } = drawn();

    expect(swatches.map((swatch) => swatch.props["aria-label"])).toEqual([copy.none, ...connectionsCopy.colors.map((color) => color.name), copy.other]);
    expect(elementsOf(none.props.children as never).some((element) => element.type === NoColorIcon)).toBe(true);
    expect(elementsOf(other.props.children as never).some((element) => element.type === EyedropperIcon)).toBe(true);
    expect(markupOf()).toContain(`<legend class="mb-2 p-0 text-sm text-muted">${connectionsCopy.folder.color}</legend>`);
  });

  it("sem cor, 'Sem cor' é a escolhida; com uma cor, ela é que fica marcada", () => {
    const empty = drawn();
    expect(empty.swatches.filter((swatch) => swatch.props["aria-pressed"] === true).map((swatch) => swatch.props["aria-label"])).toEqual([copy.none]);
    expect(empty.none.props.className).toContain("ring-2");

    const blue = drawn({ color: "#7db2ff" });
    expect(blue.swatches.filter((swatch) => swatch.props["aria-pressed"] === true).map((swatch) => swatch.props["aria-label"])).toEqual(["Azul"]);
    expect(blue.none.props.className).not.toContain("ring-2");
  });

  it("'Sem cor' tira a cor, uma bolinha a escolhe, e clicar na escolhida também a tira", () => {
    const onChange = vi.fn();
    const { swatches, none } = drawn({ color: "#F2B644", onChange });

    (none.props.onClick as () => void)();
    (swatches[1].props.onClick as () => void)();
    (swatches[2].props.onClick as () => void)();

    expect(onChange.mock.calls).toEqual([[null], ["#FF8A7A"], [null]]);
  });

  it("só 'Outra cor' abre o seletor do sistema, e a cor que vem dele é a escolhida, em maiúsculas", () => {
    const onChange = vi.fn();
    const { all, other, picker } = drawn({ onChange });
    const system = { showPicker: vi.fn(), click: vi.fn() };
    (picker.props.ref as { current: unknown }).current = system;

    for (const element of all.filter((candidate) => candidate !== other && typeof candidate.props.onClick === "function")) (element.props.onClick as () => void)();
    expect(system.showPicker).not.toHaveBeenCalled();
    (other.props.onClick as () => void)();
    expect(system.showPicker).toHaveBeenCalledOnce();

    (picker.props.onChange as (event: unknown) => void)({ target: { value: "#8a2be2" } });
    expect(onChange).toHaveBeenLastCalledWith("#8A2BE2");
    expect(picker.props.tabIndex).toBe(-1);
    expect(picker.props["aria-hidden"]).toBe(true);
  });

  it("escolhida por 'Outra cor', a bolinha fica com a cor e o #RRGGBB vai no nome acessível", () => {
    const { other, none } = drawn({ color: "#8A2BE2" });

    expect(other.props["aria-pressed"]).toBe(true);
    expect(other.props["aria-label"]).toBe(copy.otherChosen("#8A2BE2"));
    expect(other.props.style).toEqual({ backgroundColor: "#8A2BE2", color: "#FFFFFF" });
    expect(none.props["aria-pressed"]).toBe(false);
  });

  it("a cor vai ao FormData pelo campo escondido (vazio é sem cor); sem nome, o campo não existe", () => {
    expect(drawn({ color: "#7DB2FF" }).hidden?.props).toMatchObject({ name: "color", value: "#7DB2FF" });
    expect(drawn().hidden?.props).toMatchObject({ name: "color", value: "" });
    expect(drawn({ name: undefined }).hidden).toBeUndefined();
  });

  it("o erro e a explicação vão embaixo", () => {
    const markup = markupOf({ error: "Use uma cor no formato #RRGGBB.", hint: connectionsCopy.folder.colorHint });

    expect(markup).toContain('id="folder-color-error"');
    expect(markup).toContain("Use uma cor no formato #RRGGBB.");
    expect(markup).toContain(connectionsCopy.folder.colorHint);
  });
});
