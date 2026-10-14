import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// O seletor com os ganchos do React simulados (`createHookRuntime`): a referência ao seletor do sistema e o nome digitado são estado, e o vitest deste
// projeto não tem DOM.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { EyedropperIcon } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import type { Folder } from "../_lib/connections.schema";
import { EnvironmentPicker, type EnvironmentPickerProps } from "./environment-picker";

const copy = connectionsCopy.form.environment;
const now = "2026-10-13T12:00:00Z";
const fabrica: Folder = { id: "f1", parentID: null, name: "Fábrica", environmentName: "Produção", environmentColor: "#FF8A7A", createdAt: now, updatedAt: now };

const base: EnvironmentPickerProps = { idPrefix: "cx", defaultName: "", color: null, onColorChange: () => {}, errors: {}, hint: copy.connectionHint };

function drawn(props: Partial<EnvironmentPickerProps> = {}) {
  const all = elementsOf(rt.render(() => EnvironmentPicker({ ...base, ...props })));
  const swatches = all.filter((element) => element.type === "button");
  const picker = all.find((element) => element.type === "input" && element.props.type === "color") as Found;
  return { all, swatches, other: swatches.at(-1) as Found, picker };
}

const markupOf = (props: Partial<EnvironmentPickerProps> = {}) => {
  rt.unmount();
  return rt.render(() => renderToStaticMarkup(createElement(EnvironmentPicker, { ...base, ...props })));
};

/** O seletor de cor do sistema de mentira, no lugar do `<input type="color">` que a referência aponta. */
function fakeSystemPicker(picker: Found) {
  const system = { showPicker: vi.fn(), click: vi.fn() };
  (picker.props.ref as { current: unknown }).current = system;
  return system;
}

describe("o seletor de cor do ambiente (RN-CONN-017)", () => {
  it("é uma fileira de bolinhas, cada uma um botão: as seis do canvas e, por último, 'Outra cor', com o conta-gotas", () => {
    rt.unmount();
    const { swatches, other } = drawn();

    expect(swatches.map((swatch) => [swatch.props.type, swatch.props["aria-label"]])).toEqual([...connectionsCopy.colors.map((color) => ["button", color.name]), ["button", copy.otherColor]]);
    expect(elementsOf(other.props.children as never).some((element) => element.type === EyedropperIcon)).toBe(true);
    expect(other.props.title).toBe(copy.otherColor);
  });

  it("só a última bolinha abre o seletor do sistema: clicar em qualquer outro ponto da fileira ou da seção não abre nada", () => {
    rt.unmount();
    const { all, other, picker } = drawn();
    const system = fakeSystemPicker(picker);

    for (const element of all.filter((candidate) => candidate !== other && typeof candidate.props.onClick === "function")) (element.props.onClick as () => void)();
    expect(system.showPicker).not.toHaveBeenCalled();

    (other.props.onClick as () => void)();
    expect(system.showPicker).toHaveBeenCalledOnce();
  });

  it("nenhum rótulo leva o clique ao seletor do sistema: ele não está dentro de um <label>, nenhum aponta para ele, e ele fica fora do Tab e da leitura", () => {
    rt.unmount();
    const { all, picker } = drawn();
    const labels = all.filter((element) => element.type === "label");

    expect(labels.flatMap((label) => elementsOf(label.props.children as never))).not.toContain(picker);
    expect(labels.map((label) => label.props.htmlFor)).not.toContain(picker.props.id);
    expect(picker.props.tabIndex).toBe(-1);
    expect(picker.props["aria-hidden"]).toBe(true);
    expect(markupOf()).not.toMatch(/<label[^>]*>(?:(?!<\/label>)[\s\S])*type="color"/);
  });

  it("pelo teclado, Enter ou Espaço na última abrem o seletor: ela é um botão de verdade, e o clique do teclado é o mesmo do ponteiro", () => {
    rt.unmount();
    const { other } = drawn();

    expect(other.type).toBe("button");
    expect(other.props.onKeyDown).toBeUndefined();
  });

  it("sem o showPicker, o clique abre o seletor do sistema do jeito antigo", () => {
    rt.unmount();
    const { other, picker } = drawn();
    const system = { click: vi.fn() };
    (picker.props.ref as { current: unknown }).current = system;

    (other.props.onClick as () => void)();

    expect(system.click).toHaveBeenCalledOnce();
  });

  it("a cor que vem do seletor do sistema é a escolhida, em maiúsculas", () => {
    rt.unmount();
    const onColorChange = vi.fn();
    const { picker } = drawn({ onColorChange });

    (picker.props.onChange as (event: unknown) => void)({ target: { value: "#8a2be2" } });

    expect(onColorChange).toHaveBeenCalledExactlyOnceWith("#8A2BE2");
  });

  it("escolhida por ela, a bolinha fica com a cor, a marca de escolhida e o conta-gotas em contraste; o #RRGGBB vai na dica e no nome acessível", () => {
    rt.unmount();
    const { swatches, other, picker } = drawn({ color: "#8A2BE2" });

    expect(other.props["aria-pressed"]).toBe(true);
    expect(other.props.style).toEqual({ backgroundColor: "#8A2BE2", color: "#FFFFFF" });
    expect(other.props.className).toContain("ring-2");
    expect(other.props["aria-label"]).toBe(copy.otherColorChosen("#8A2BE2"));
    expect(other.props.title).toBe(copy.otherColorChosen("#8A2BE2"));
    expect(elementsOf(other.props.children as never).some((element) => element.type === EyedropperIcon)).toBe(true);
    expect(swatches.slice(0, -1).every((swatch) => swatch.props["aria-pressed"] === false)).toBe(true);
    expect(picker.props.value).toBe("#8a2be2");
  });

  it("uma das seis, com qualquer caixa: a bolinha dela fica marcada, e 'Outra cor' não", () => {
    rt.unmount();
    const { swatches, other } = drawn({ color: "#ff8a7a" });

    expect(swatches.filter((swatch) => swatch.props["aria-pressed"] === true).map((swatch) => swatch.props["aria-label"])).toEqual(["Vermelho"]);
    expect(other.props["aria-pressed"]).toBe(false);
    expect(other.props["aria-label"]).toBe(copy.otherColor);
  });

  it("a linha 'Outra cor #RRGGBB' de baixo saiu", () => {
    const markup = markupOf({ color: "#8A2BE2" });

    expect(markup).not.toContain("Sem cor");
    expect(markup).not.toMatch(/<span[^>]*>Outra cor<\/span>/);
    expect(markup).not.toMatch(/<span class="font-mono[^"]*">#8A2BE2<\/span>/);
  });
});

describe("o ambiente herdado no formulário da conexão (RN-PASTA-005)", () => {
  const inherited = { name: "Produção", color: "#FF8A7A", folder: fabrica };

  it("sem ambiente próprio, diz qual herda e de qual pasta", () => {
    expect(markupOf({ inherited })).toContain(copy.inherits("Produção", "Fábrica"));
  });

  it("com ambiente próprio, ou sem nada a herdar, não diz nada", () => {
    expect(markupOf({ inherited, defaultName: "QAS" })).not.toContain("Herda");
    expect(markupOf({ inherited: null })).not.toContain("Herda");
  });

  it("digitar um nome tira a frase; apagá-lo a traz de volta", () => {
    rt.unmount();
    const nameField = (props: Partial<EnvironmentPickerProps>) => drawn(props).all.find((element) => element.props.name === "environmentName") as Found;
    const said = (props: Partial<EnvironmentPickerProps>) => drawn(props).all.some((element) => element.props.children === copy.inherits("Produção", "Fábrica"));

    expect(said({ inherited })).toBe(true);
    (nameField({ inherited }).props.onChange as (event: unknown) => void)({ target: { value: "QAS" } });
    expect(said({ inherited })).toBe(false);
    (nameField({ inherited }).props.onChange as (event: unknown) => void)({ target: { value: "  " } });
    expect(said({ inherited })).toBe(true);
  });

  it("cada formulário tem os próprios ids: o da pasta não repete os da conexão", () => {
    const markup = markupOf({ idPrefix: "folder", hint: copy.folderHint });

    expect(markup).toContain('id="folder-environment-name"');
    expect(markup).toContain('id="folder-environment-title"');
    expect(markup).not.toContain('id="cx-');
    expect(markup).toContain(copy.folderHint);
  });
});

describe("os ambientes do usuário na seção Ambiente (RN-AMB-001)", () => {
  const environments = [
    { key: "produção", name: "Produção", color: "#FF8A7A" },
    { key: "qas", name: "QAS", color: null },
  ];
  const nameField = (props: Partial<EnvironmentPickerProps>) => drawn(props).all.find((element) => element.props.name === "environmentName") as Found;
  const chips = (props: Partial<EnvironmentPickerProps>) => drawn(props).all.filter((element) => element.type === "button" && element.props["data-environment"] !== undefined);
  const type = (props: Partial<EnvironmentPickerProps>, value: string) => (nameField(props).props.onChange as (event: unknown) => void)({ target: { value } });

  it("acima do campo do nome, uma etiqueta colorida por ambiente, cada uma um botão num grupo com nome", () => {
    const markup = markupOf({ environments });

    expect(markup).toContain('<div role="group" aria-labelledby="cx-environment-saved"');
    expect(markup).toMatch(new RegExp(`id="cx-environment-saved"[^>]*>${copy.saved}<`));
    expect(markup.indexOf("cx-environment-saved")).toBeLessThan(markup.indexOf('id="cx-environment-name"'));
    expect(markup).toMatch(/<button type="button" data-environment="produção" aria-pressed="false" title="Usar o ambiente Produção"[^>]*><span style="background-color:#FF8A7A;color:#14181D"[^>]*>Produção<\/span><\/button>/);
  });

  it("sem ambiente nenhum ainda, a seção não mostra o grupo", () => {
    expect(markupOf({ environments: [] })).not.toContain(copy.saved);
    expect(markupOf()).not.toContain("<datalist");
  });

  it("escolher uma etiqueta preenche o nome e a cor, que continuam editáveis; a escolhida fica marcada", () => {
    rt.unmount();
    const onColorChange = vi.fn();
    const props = { environments, onColorChange, color: "#7DB2FF" };

    (chips(props)[0].props.onClick as () => void)();

    expect(nameField(props).props.value).toBe("Produção");
    expect(onColorChange).toHaveBeenLastCalledWith("#FF8A7A");
    expect(chips(props).map((chip) => chip.props["aria-pressed"])).toEqual([true, false]);

    // Sem cor no ambiente escolhido, a cor sai.
    (chips(props)[1].props.onClick as () => void)();
    expect(nameField(props).props.value).toBe("QAS");
    expect(onColorChange).toHaveBeenLastCalledWith(null);

    // O nome continua do campo: digitar outro tira a marca.
    type(props, "QAS Sul");
    expect(nameField(props).props.value).toBe("QAS Sul");
    expect(chips(props).every((chip) => chip.props["aria-pressed"] === false)).toBe(true);
  });

  it("o campo do nome completa com os ambientes ao digitar (a lista de sugestões do campo)", () => {
    rt.unmount();
    const { all } = drawn({ environments });
    const field = all.find((element) => element.props.name === "environmentName") as Found;
    const list = all.find((element) => element.type === "datalist") as Found;

    expect(field.props.list).toBe("cx-environment-options");
    expect(list.props.id).toBe("cx-environment-options");
    expect(elementsOf(list.props.children as never).map((option) => option.props.value)).toEqual(["Produção", "QAS"]);
  });

  it("o nome digitado que é o de um ambiente, com qualquer caixa, traz a cor dele uma vez; depois a cor é de quem edita", () => {
    rt.unmount();
    const onColorChange = vi.fn();
    const props = { environments, onColorChange };

    type(props, "produ");
    expect(onColorChange).not.toHaveBeenCalled();
    type(props, "produção");
    expect(onColorChange).toHaveBeenCalledExactlyOnceWith("#FF8A7A");
    type(props, "produção ");
    expect(onColorChange).toHaveBeenCalledOnce();
  });

  it("ao abrir com um ambiente, nada muda sozinho: a cor gravada fica", () => {
    rt.unmount();
    const onColorChange = vi.fn();
    drawn({ environments, onColorChange, defaultName: "Produção", color: "#7DB2FF" });

    expect(onColorChange).not.toHaveBeenCalled();
  });
});
