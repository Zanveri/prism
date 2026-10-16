import { describe, expect, it, vi } from "vitest";

import { Select } from "@/components/ui";
import { buttonLabeled, elementsOf } from "@/lib/testing/react-tree";

import { scriptsCopy } from "../_lib/scripts.copy";
import { MoveToFolderDialog, ScriptFolderNameDialog } from "./script-folder-dialogs";

const copy = scriptsCopy.folders;
const noop = () => {};
/** O botão de enviar não tem `onClick` (envia o formulário): acha-se pelo texto. */
const submitButton = (tree: Parameters<typeof elementsOf>[0], label: string) => elementsOf(tree).find((element) => element.props.type === "submit" && element.props.children === label);

describe("o diálogo do nome da pasta de scripts (RN-SCRIPT-009)", () => {
  const dialog = (over: Partial<Parameters<typeof ScriptFolderNameDialog>[0]> = {}) =>
    ScriptFolderNameDialog({ title: copy.create.title, place: copy.create.atRoot, submitLabel: copy.create.submit, pendingLabel: copy.create.submitting, initialName: "", pending: false, error: null, onSubmit: noop, onCancel: noop, ...over });

  it("\"Nova pasta\" diz onde ela vai ficar, tem o campo \"Nome da pasta\" (até 60 caracteres) e \"Criar pasta\"; a recusa fica no campo", () => {
    const tree = dialog({ error: copy.errors.taken });
    const field = elementsOf(tree).find((element) => element.props.name === "name");

    expect(tree.props).toMatchObject({ title: copy.create.title, description: copy.create.atRoot });
    expect(field?.props).toMatchObject({ label: copy.name, maxLength: 60, defaultValue: "", error: copy.errors.taken, autoFocus: true });
    expect(submitButton(tree, copy.create.submit)).toBeDefined();
    expect(buttonLabeled(tree, copy.cancel)).toBeDefined();
  });

  it("enquanto grava, o botão diz \"Criando…\" e nada se envia de novo", () => {
    const onSubmit = vi.fn();
    const tree = dialog({ pending: true, onSubmit });
    const form = elementsOf(tree).find((element) => element.type === "form");

    (form?.props.onSubmit as (event: unknown) => void)({ preventDefault: noop, currentTarget: { elements: { namedItem: () => ({ value: "Fechamento" }) } } });

    expect(submitButton(tree, copy.create.submitting)?.props.disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("o \"Renomear\" nasce com o nome, não diz lugar, e enviar entrega o nome digitado", () => {
    const onSubmit = vi.fn();
    const tree = dialog({ title: copy.rename.title, place: undefined, submitLabel: copy.rename.submit, pendingLabel: copy.rename.submitting, initialName: "Mensal", onSubmit });
    const form = elementsOf(tree).find((element) => element.type === "form");

    (form?.props.onSubmit as (event: unknown) => void)({ preventDefault: noop, currentTarget: { elements: { namedItem: () => ({ value: "Mensal 2026" }) } } });

    expect(tree.props).toMatchObject({ title: copy.rename.title, description: undefined });
    expect(elementsOf(tree).find((element) => element.props.name === "name")?.props.defaultValue).toBe("Mensal");
    expect(onSubmit).toHaveBeenCalledWith("Mensal 2026");
  });
});

describe("o diálogo \"Mover para…\" (RN-SCRIPT-009)", () => {
  const options = [
    { value: "f1", label: "Fechamento" },
    { value: "f2", label: "Fechamento / Mensal" },
  ];
  const dialog = (over: Partial<Parameters<typeof MoveToFolderDialog>[0]> = {}) => MoveToFolderDialog({ title: copy.move.titleScript, name: "Abril", value: "f2", options, pending: false, onChange: noop, onSubmit: noop, onCancel: noop, ...over });

  it("diz o que vai ser movido, e o campo \"Pasta\" tem \"Sem pasta\" e as pastas com o caminho, com a de agora escolhida", () => {
    const tree = dialog();
    const select = elementsOf(tree).find((element) => element.type === Select);

    expect(tree.props).toMatchObject({ title: copy.move.titleScript, description: copy.move.description("Abril") });
    expect(select?.props).toMatchObject({ value: "f2", options, placeholder: copy.move.noFolder });
    expect(elementsOf(tree).find((element) => element.props.htmlFor === select?.props.id)?.props.children).toBe(copy.move.folder);
  });

  it("escolher passa a pasta a quem chama; \"Mover\" envia, e enquanto move diz \"Movendo…\" e não envia de novo", () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    const tree = dialog({ onChange, onSubmit });

    (elementsOf(tree).find((element) => element.type === Select)?.props.onChange as (value: string) => void)("");
    (elementsOf(tree).find((element) => element.type === "form")?.props.onSubmit as (event: unknown) => void)({ preventDefault: noop });
    const pending = dialog({ pending: true, onSubmit });
    (elementsOf(pending).find((element) => element.type === "form")?.props.onSubmit as (event: unknown) => void)({ preventDefault: noop });

    expect(onChange).toHaveBeenCalledWith("");
    expect(onSubmit).toHaveBeenCalledOnce();
    expect(submitButton(pending, copy.move.submitting)?.props.disabled).toBe(true);
  });
});
