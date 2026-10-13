import { describe, expect, it, vi } from "vitest";

import { buttonLabeled, elementsOf } from "@/lib/testing/react-tree";

import { scriptsCopy as copy } from "../_lib/scripts.copy";
import { NoConnectionBarView, ScriptNameDialog, UnsavedScriptsDialog } from "./script-dialogs";

const noop = () => {};

describe("o diálogo do nome do script (RN-SCRIPT-001 e 004)", () => {
  const dialog = (over: Partial<Parameters<typeof ScriptNameDialog>[0]> = {}) =>
    ScriptNameDialog({ title: copy.save.title, submitLabel: copy.save.save, pendingLabel: copy.save.saving, initialName: "Script 3", pending: false, error: null, onSubmit: noop, onCancel: noop, ...over });

  it("nasce com a sugestão no campo, que aceita até 200 caracteres, e mostra o erro no campo", () => {
    const tree = elementsOf(dialog({ error: copy.errors.taken }));
    const field = tree.find((element) => element.props.name === "name");

    expect(field?.props).toMatchObject({ defaultValue: "Script 3", label: copy.save.nameLabel, maxLength: 200, error: copy.errors.taken, autoFocus: true });
  });

  it("enviar entrega o nome digitado; cancelar fecha", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const tree = dialog({ onSubmit, onCancel });
    const form = elementsOf(tree).find((element) => element.type === "form");
    const preventDefault = vi.fn();

    (form?.props.onSubmit as (event: unknown) => void)({ preventDefault, currentTarget: { elements: { namedItem: () => ({ value: "Fechamento" }) } } });
    (buttonLabeled(tree, copy.save.cancel)?.props.onClick as () => void)();

    expect(preventDefault).toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalledWith("Fechamento");
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("enquanto grava, o botão diz \"Salvando…\", nada se envia de novo e nada fecha", () => {
    const onSubmit = vi.fn();
    const tree = dialog({ pending: true, onSubmit });
    const submit = elementsOf(tree).find((element) => element.props.type === "submit");
    const form = elementsOf(tree).find((element) => element.type === "form");

    (form?.props.onSubmit as (event: unknown) => void)({ preventDefault: noop, currentTarget: { elements: { namedItem: () => ({ value: "x" }) } } });

    expect(submit?.props).toMatchObject({ disabled: true, children: copy.save.saving });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(tree.props).toMatchObject({ pending: true });
  });
});

describe("a pergunta antes de fechar um script com mudança não salva (RN-SCRIPT-001)", () => {
  const ask = (names: string[], saving = false, handlers: Partial<{ onSave: () => void; onDiscard: () => void; onCancel: () => void }> = {}) =>
    UnsavedScriptsDialog({ names, saving, onSave: noop, onDiscard: noop, onCancel: noop, ...handlers });

  it("um script: pergunta pelo nome dele, com Salvar, Descartar e Cancelar, e o foco nasce em Cancelar", () => {
    const tree = ask(["Fechamento"]);

    expect(tree.props).toMatchObject({ title: copy.unsaved.titleOne("Fechamento"), description: copy.unsaved.descriptionOne, role: "alertdialog" });
    expect(buttonLabeled(tree, copy.unsaved.cancel)?.props.autoFocus).toBe(true);
    expect(buttonLabeled(tree, copy.unsaved.discard)).toBeDefined();
    expect(buttonLabeled(tree, copy.unsaved.save)).toBeDefined();
  });

  it("vários: diz quantos e quais, e oferece salvar todos", () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const tree = ask(["a", "b"], false, { onSave, onDiscard });

    expect(tree.props).toMatchObject({ title: copy.unsaved.titleMany(2), description: copy.unsaved.descriptionMany(["a", "b"]) });
    (buttonLabeled(tree, copy.unsaved.saveMany)?.props.onClick as () => void)();
    (buttonLabeled(tree, copy.unsaved.discard)?.props.onClick as () => void)();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("enquanto salva, os botões ficam apagados", () => {
    const buttons = elementsOf(ask(["a"], true)).filter((element) => typeof element.props.onClick === "function" && "disabled" in element.props);

    expect(buttons.length).toBe(3);
    expect(buttons.every((button) => button.props.disabled === true)).toBe(true);
    expect(buttons.some((button) => button.props.children === copy.unsaved.saving)).toBe(true);
  });
});

describe("a aba sem conexão (RN-SCRIPT-003)", () => {
  const options = [
    { value: "c1", label: "ERP" },
    { value: "c2", label: "MES" },
  ];

  it("diz por quê, oferece as conexões e só usa a escolhida", () => {
    const onAssign = vi.fn();
    const tree = NoConnectionBarView({ options, value: "c2", onChange: noop, onAssign });
    const select = elementsOf(tree).find((element) => element.props.options === options);

    expect(elementsOf(tree).some((element) => element.props.children === copy.noConnection.description)).toBe(true);
    expect(select?.props).toMatchObject({ value: "c2", placeholder: copy.noConnection.placeholder, "aria-label": copy.noConnection.label });
    (buttonLabeled(tree, copy.noConnection.use)?.props.onClick as () => void)();
    expect(onAssign).toHaveBeenCalledWith("c2");
  });

  it("a aba que voltou na entrada sem a conexão dela, e não é de um script, diz que a conexão da aba não existe mais (RN-ABAS-006)", () => {
    const tree = NoConnectionBarView({ options, value: "", onChange: noop, onAssign: noop, forScript: false });

    expect(elementsOf(tree).some((element) => element.props.children === copy.noConnection.descriptionTab)).toBe(true);
    expect(elementsOf(tree).some((element) => element.props.children === copy.noConnection.description)).toBe(false);
  });

  it("sem escolha, o botão fica apagado; sem conexão cadastrada, diz que é preciso criar uma", () => {
    expect(buttonLabeled(NoConnectionBarView({ options, value: "", onChange: noop, onAssign: noop }), copy.noConnection.use)?.props.disabled).toBe(true);
    expect(elementsOf(NoConnectionBarView({ options: [], value: "", onChange: noop, onAssign: noop })).some((element) => element.props.children === copy.noConnection.none)).toBe(true);
  });
});
