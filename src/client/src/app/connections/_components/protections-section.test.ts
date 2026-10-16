import { describe, expect, it, vi } from "vitest";

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { connectionsCopy } from "../_lib/connections.copy";
import { unprotected, type Folder } from "../_lib/connections.schema";
import type { InheritedProtections } from "../_lib/protections";
import { ProtectionsSection, type ProtectionsSectionProps } from "./protections-section";

const copy = connectionsCopy.protections;
const now = "2026-10-15T12:00:00Z";
const fabrica: Folder = { id: "f1", parentID: null, name: "Fábrica", environmentName: null, environmentColor: null, color: null, confirmCommands: "irreversible", readOnly: true, protections: { readOnly: true, readOnlyFolderID: null, confirmCommands: "irreversible", confirmCommandsFolderID: null }, createdAt: now, updatedAt: now };
const nothing: InheritedProtections = { readOnly: null, confirm: null };
const fromFabrica: InheritedProtections = { readOnly: fabrica, confirm: { level: "irreversible", folder: fabrica } };

const base: ProtectionsSectionProps = { idPrefix: "cx", subject: "connection", confirm: "none", onConfirmChange: () => {}, readOnly: false, onReadOnlyChange: () => {}, inherited: nothing, errors: {} };

/** O que a seção monta: os campos escondidos, as três escolhas da confirmação, a caixa do somente leitura e os textos. */
function drawn(props: Partial<ProtectionsSectionProps> = {}) {
  const all = elementsOf(ProtectionsSection({ ...base, ...props }));
  const hidden = (name: string) => all.find((element) => element.type === "input" && element.props.type === "hidden" && element.props.name === name)?.props.value;
  const radios = all.filter((element) => element.type === "input" && element.props.type === "radio");
  const checkbox = all.find((element) => element.type === "input" && element.props.type === "checkbox") as Found;
  const texts = all.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : []));
  return { all, hidden, radios, checkbox, texts };
}

const checkedChoice = (radios: Found[]) => radios.filter((radio) => radio.props.checked === true).map((radio) => radio.props.value);
const disabledChoices = (radios: Found[]) => radios.filter((radio) => radio.props.disabled === true).map((radio) => radio.props.value);

describe("a seção Proteções (RN-PROT-001 a 004)", () => {
  it("tem “Confirmar antes de executar” com as três escolhas, na ordem, e “Somente leitura”; as escolhas próprias vão nos campos escondidos", () => {
    const { hidden, radios, checkbox, texts } = drawn({ confirm: "irreversible", readOnly: true });

    expect(texts).toEqual(expect.arrayContaining([copy.title, copy.confirm.legend, copy.confirm.choices.none, copy.confirm.choices.irreversible, copy.confirm.choices.all, copy.readOnly.label]));
    expect(radios.map((radio) => radio.props.value)).toEqual(["none", "irreversible", "all"]);
    expect(checkedChoice(radios)).toEqual(["irreversible"]);
    expect(checkbox.props).toMatchObject({ checked: true, disabled: false });
    expect([hidden("confirmCommands"), hidden("readOnly")]).toEqual(["irreversible", "true"]);
  });

  it("escolher e marcar avisam quem abriu a seção, que guarda as escolhas próprias", () => {
    const onConfirmChange = vi.fn();
    const onReadOnlyChange = vi.fn();
    const { radios, checkbox } = drawn({ onConfirmChange, onReadOnlyChange });

    (radios[2].props.onChange as () => void)();
    (checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });

    expect(onConfirmChange).toHaveBeenCalledExactlyOnceWith("all");
    expect(onReadOnlyChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("a proteção herdada aparece marcada e desabilitada, com “Herdado da pasta Fábrica” e por que não se afrouxa; a própria continua nos campos escondidos", () => {
    const { hidden, radios, checkbox, texts } = drawn({ inherited: fromFabrica });

    expect(checkbox.props).toMatchObject({ checked: true, disabled: true });
    expect(checkedChoice(radios)).toEqual(["irreversible"]);
    expect(disabledChoices(radios)).toEqual(["none"]);
    expect(texts).toEqual(expect.arrayContaining([copy.inheritedFrom("Fábrica"), copy.connectionCannotLoosen("Fábrica"), `${copy.inheritedFrom("Fábrica")}. ${copy.connectionCannotLoosen("Fábrica")}`]));
    // A herdada não vira própria: sair da pasta tira a proteção junto.
    expect([hidden("confirmCommands"), hidden("readOnly")]).toEqual(["none", "false"]);
  });

  it("a própria mais forte que a herdada é a que aparece; as escolhas acima da herdada continuam livres", () => {
    const { radios } = drawn({ confirm: "all", inherited: fromFabrica });

    expect(checkedChoice(radios)).toEqual(["all"]);
    expect(disabledChoices(radios)).toEqual(["none"]);
  });

  it("“Todos os comandos” herdado deixa só ele, e a frase da pasta diz por que", () => {
    const linha: Folder = { ...fabrica, id: "f2", name: "Linha 1", protections: unprotected };
    const { radios, texts } = drawn({ subject: "folder", idPrefix: "folder", inherited: { readOnly: null, confirm: { level: "all", folder: linha } } });

    expect(disabledChoices(radios)).toEqual(["none", "irreversible"]);
    expect(checkedChoice(radios)).toEqual(["all"]);
    expect(texts).toEqual(expect.arrayContaining([copy.folderCannotLoosen("Linha 1"), copy.confirm.folderHint, copy.readOnly.folderHint]));
  });

  it("a recusa da API de cada campo aparece embaixo dele", () => {
    const { all } = drawn({ errors: { confirmCommands: "Escolha não confirmar, só os comandos irreversíveis ou todos os comandos.", readOnly: "Recusado." } });
    const errorOf = (id: string) => all.find((element) => element.props.id === id)?.props.children;

    expect(errorOf("cx-confirm-commands-error")).toBe("Escolha não confirmar, só os comandos irreversíveis ou todos os comandos.");
    expect(errorOf("cx-read-only-error")).toBe("Recusado.");
  });
});
