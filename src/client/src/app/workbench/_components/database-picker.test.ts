import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { Select } from "@/components/ui";
import { elementsOf } from "@/lib/testing/react-tree";

import { databaseValue, type DatabaseChoices } from "../_lib/tab-database";
import { workbenchCopy } from "../_lib/workbench.copy";
import { DatabasePickerView } from "./database-picker";

const copy = workbenchCopy.editor.database;

const choices: DatabaseChoices = {
  options: [
    { value: databaseValue(undefined), label: copy.defaultName("mes") },
    { value: databaseValue("vendas"), label: "vendas" },
  ],
  value: databaseValue(undefined),
  locked: false,
};

function view(over: Partial<ComponentProps<typeof DatabasePickerView>> = {}) {
  const props = { id: "banco", choices, loading: false, busy: false, onOpen: vi.fn(), onChange: vi.fn(), ...over };
  const found = elementsOf(DatabasePickerView(props));
  const select = found.find((element) => element.type === Select)!.props as unknown as ComponentProps<typeof Select>;
  const texts = found.flatMap((element) => (typeof element.props.children === "string" ? [element.props.children] : []));
  return { props, found, select, texts };
}

describe("DatabasePickerView: o banco da aba de consulta na barra do editor (RN-ARVORE-007)", () => {
  it("mostra o banco em que a aba roda, com rótulo visível ligado ao controle, e entrega a escolha", () => {
    const { select, found, props } = view();
    const label = found.find((element) => element.type === "label");

    expect(select).toMatchObject({ id: "banco", value: databaseValue(undefined), options: choices.options, disabled: false });
    expect(label?.props).toMatchObject({ htmlFor: "banco", children: copy.label });

    select.onChange(databaseValue("vendas"));
    expect(props.onChange).toHaveBeenCalledWith(databaseValue("vendas"));
  });

  it("abrir a lista pede os bancos do servidor, e enquanto vêm a barra diz que está carregando", () => {
    const { select, props } = view();
    select.onOpen?.();
    expect(props.onOpen).toHaveBeenCalledOnce();

    expect(view({ loading: true }).texts).toContain(copy.loading);
    expect(view().texts).not.toContain(copy.loading);
  });

  it("no Db2 a lista fica desabilitada, com o motivo à vista e ligado ao controle", () => {
    const { select, found, texts } = view({ choices: { ...choices, options: choices.options.slice(0, 1), locked: true } });
    const reason = found.find((element) => element.props.children === copy.locked);

    expect(select.disabled).toBe(true);
    expect(texts).toContain(copy.locked);
    expect(select["aria-describedby"]).toBe(reason?.props.id);
  });

  it("com comando em andamento a lista espera: a resposta dele é do banco de agora", () => {
    expect(view({ busy: true }).select.disabled).toBe(true);
  });
});
