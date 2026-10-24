import { describe, expect, it, vi } from "vitest";

// O campo de edição com os ganchos do React simulados (`createHookRuntime`): a referência do campo é o que seleciona o texto ao abrir (RN-EDIT-001).
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { elementsOf } from "@/lib/testing/react-tree";

import type { EditorField } from "../_lib/cell-editing";
import { CellEditor } from "./cell-editor";

const noop = () => {};
const props = { label: "obs, linha 1", number: false, onDraft: noop, onCommit: noop, onCancel: noop };

/** Monta o campo e devolve a referência da área de texto, que o React chamaria com o elemento ao entrar na tela. */
function mount(draft: string, typed?: boolean) {
  rt.unmount();
  const tree = rt.render(() => CellEditor({ ...props, draft, ...(typed === undefined ? {} : { typed }) }));
  const area = elementsOf(tree).find((element) => element.type === "textarea")!;
  return { ref: area.props.ref as (element: EditorField | null) => void, rerender: (next: string) => rt.render(() => CellEditor({ ...props, draft: next, typed })) };
}

const fakeField = (value: string) => ({ value, scrollLeft: 9, scrollTop: 9, setSelectionRange: vi.fn<EditorField["setSelectionRange"]>() });

describe("o campo de edição ao abrir (RN-EDIT-001)", () => {
  it("o campo aberto por F2, duplo clique ou \"Editar célula\" seleciona o texto todo", () => {
    const view = mount("Ana Maria");
    const field = fakeField("Ana Maria");

    view.ref(field);

    expect(field.setSelectionRange).toHaveBeenCalledExactlyOnceWith(0, 9, "backward");
    expect(field.scrollLeft).toBe(0);
  });

  it("o campo aberto ao digitar deixa o cursor depois do caractere, sem selecionar nada", () => {
    const view = mount("x", true);
    const field = fakeField("x");

    view.ref(field);

    expect(field.setSelectionRange).toHaveBeenCalledExactlyOnceWith(1, 1);
  });

  it("a referência é a mesma a cada tecla: o texto digitado depois não volta a ser selecionado", () => {
    const view = mount("Ana");
    const first = view.ref;

    const next = view.rerender("Ana B");
    const again = elementsOf(next).find((element) => element.type === "textarea")!.props.ref;

    expect(again).toBe(first);
  });

  it("sem o elemento (o campo saindo da tela), a referência não faz nada", () => {
    expect(() => mount("Ana").ref(null)).not.toThrow();
  });
});
