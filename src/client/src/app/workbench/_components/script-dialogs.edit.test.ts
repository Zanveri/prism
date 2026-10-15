import { describe, expect, it, vi } from "vitest";

// O diálogo com os ganchos do React simulados (`createHookRuntime`): o ícone e a cor escolhidos são estado, e o vitest deste projeto não tem DOM.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { ColorField } from "@/app/connections/_components/color-field";
import { FieldError } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { scriptIcons } from "../_lib/saved-scripts";
import { scriptsCopy as copy } from "../_lib/scripts.copy";
import { EditScriptDialog } from "./script-dialogs";
import { ScriptIconView } from "./script-icon";

type Props = Parameters<typeof EditScriptDialog>[0];

const base: Props = { script: { name: "Fechamento", icon: null, color: null }, pending: false, errors: {}, onSubmit: () => {}, onCancel: () => {} };

/** Desenha o diálogo com o estado que ele já tem (a mesma runtime), e acha as peças dele. */
function drawn(props: Partial<Props> = {}) {
  const all = elementsOf(rt.render(() => EditScriptDialog({ ...base, ...props })));
  const iconButtons = all.filter((element) => element.type === "button" && scriptIcons.some((icon) => element.props["aria-label"] === copy.icons[icon]));
  const color = all.find((element) => element.type === ColorField) as Found;
  const name = all.find((element) => element.props.name === "name") as Found;
  const form = all.find((element) => element.type === "form") as Found;
  return { all, iconButtons, color, name, form };
}

const pressed = (buttons: Found[]) => buttons.filter((button) => button.props["aria-pressed"] === true).map((button) => button.props["aria-label"]);
const submit = (form: Found, name: string) => (form.props.onSubmit as (event: unknown) => void)({ preventDefault: () => {}, currentTarget: { elements: { namedItem: () => ({ value: name }) } } });

describe("o Editar script… (RN-SCRIPT-006)", () => {
  it("tem o nome, os ícones da lista fechada, na ordem dela, e a cor do ícone; o script sem ícone vem com o padrão escolhido", () => {
    rt.unmount();
    const { iconButtons, color, name } = drawn();

    expect(name.props).toMatchObject({ defaultValue: "Fechamento", label: copy.save.nameLabel, maxLength: 200 });
    expect(iconButtons.map((button) => button.props["aria-label"])).toEqual(scriptIcons.map((icon) => copy.icons[icon]));
    expect(iconButtons.map((button) => button.props.title)).toEqual(scriptIcons.map((icon) => copy.icons[icon]));
    expect(pressed(iconButtons)).toEqual([copy.icons.document]);
    expect(color.props).toMatchObject({ legend: copy.edit.color, color: null });
  });

  it("nasce com o ícone e a cor que o script tem, e um ícone que esta versão não conhece vira o padrão", () => {
    rt.unmount();
    expect(pressed(drawn({ script: { name: "a", icon: "bug", color: "#FF8A7A" } }).iconButtons)).toEqual([copy.icons.bug]);
    rt.unmount();
    expect(pressed(drawn({ script: { name: "a", icon: "foguete", color: null } }).iconButtons)).toEqual([copy.icons.document]);
  });

  it("escolher um ícone e uma cor os marca, desenha os ícones já na cor escolhida, e enviar entrega o nome, o ícone e a cor", () => {
    rt.unmount();
    const onSubmit = vi.fn();
    const first = drawn({ onSubmit });

    (first.iconButtons[4].props.onClick as () => void)();
    (first.color.props.onChange as (color: string | null) => void)("#F2B644");
    const after = drawn({ onSubmit });

    expect(pressed(after.iconButtons)).toEqual([copy.icons.chart]);
    expect(after.color.props.color).toBe("#F2B644");
    expect(after.all.filter((element) => element.type === ScriptIconView).every((element) => element.props.color === "#F2B644")).toBe(true);

    submit(after.form, "Fechamento mensal");
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "Fechamento mensal", icon: "chart", color: "#F2B644" });
  });

  it("'Sem cor' volta o ícone ao neutro, e a cor vai nula", () => {
    rt.unmount();
    const onSubmit = vi.fn();
    const first = drawn({ script: { name: "a", icon: "star", color: "#7DB2FF" }, onSubmit });

    (first.color.props.onChange as (color: string | null) => void)(null);
    const after = drawn({ script: { name: "a", icon: "star", color: "#7DB2FF" }, onSubmit });
    submit(after.form, "a");

    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "a", icon: "star", color: null });
  });

  it("as recusas ficam no lugar: a do nome no campo, a do ícone abaixo dos ícones (ligada ao grupo), a da cor na cor; enquanto grava, nada se envia de novo", () => {
    rt.unmount();
    const onSubmit = vi.fn();
    const { all, name, color, form } = drawn({ errors: { name: copy.errors.taken, icon: "Escolha um dos ícones da lista.", color: "Use uma cor no formato #RRGGBB." }, pending: true, onSubmit });

    expect(name.props.error).toBe(copy.errors.taken);
    expect(color.props.error).toBe("Use uma cor no formato #RRGGBB.");
    const iconError = all.find((element) => element.type === FieldError) as Found;
    expect(iconError.props.children).toBe("Escolha um dos ícones da lista.");
    const icons = all.find((element) => element.type === "fieldset") as Found;
    expect(icons.props["aria-describedby"]).toBe(iconError.props.id);
    submit(form, "Outro");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sem recusa do ícone, a lista dos ícones não aponta para erro nenhum", () => {
    rt.unmount();
    const { all } = drawn();

    expect((all.find((element) => element.type === "fieldset") as Found).props["aria-describedby"]).toBeUndefined();
    expect(all.find((element) => element.type === FieldError)?.props.children).toBeUndefined();
  });
});
