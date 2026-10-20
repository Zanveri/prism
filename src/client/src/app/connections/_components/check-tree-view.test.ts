import { describe, expect, it, vi } from "vitest";

import { Input } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { checkTree } from "../_lib/check-tree";
import { transferCopy } from "../_lib/transfer.copy";
import { CheckRowFrame, indeterminateRef, TreeSearchBar, TriStateBox } from "./check-tree-view";

// As peças da árvore de marcar, chamadas como função (não têm estado): o vitest deste projeto não tem DOM, e o que se confere é o que cada uma monta.
const tree = checkTree([
  { key: "estoque", kind: "folder", parentKey: null, name: "Estoque", selectable: true },
  { key: "prd-nominal", kind: "connection", parentKey: "estoque", name: "NOMINAL", selectable: true },
]);
const folderNode = tree.byKey.get("estoque")!;
const connectionNode = tree.byKey.get("prd-nominal")!;
const noop = () => {};

describe("a caixa de três estados (RN-TRANSF-002)", () => {
  it("o estado misto é o `indeterminate` do próprio `<input>`, posto pela referência a cada desenho", () => {
    const element = { indeterminate: false };

    indeterminateRef("mixed")(element);
    expect(element.indeterminate).toBe(true);
    indeterminateRef("checked")(element);
    expect(element.indeterminate).toBe(false);
    expect(() => indeterminateRef("mixed")(null)).not.toThrow();
  });

  it("o nome é o do item, e a descrição vem ligada pelo `aria-describedby`", () => {
    const box = TriStateBox({ state: "checked", label: "NOMINAL", describedBy: "linha-desc", onChange: noop }) as Found;

    expect(box.props["aria-label"]).toBe("NOMINAL");
    expect(box.props["aria-describedby"]).toBe("linha-desc");
    expect(box.props.checked).toBe(true);
  });
});

describe("a linha da árvore", () => {
  it("a seta da pasta tem um nome que não muda; aberta ou fechada é o `aria-expanded`", () => {
    const arrow = (open: boolean) => elementsOf(CheckRowFrame({ node: folderNode, state: "unchecked", open, disabled: false, name: "Estoque", onToggleOpen: noop, onMark: noop, children: null })).find((element) => element.props["aria-expanded"] !== undefined) as Found;

    expect([arrow(true).props["aria-label"], arrow(true).props["aria-expanded"]]).toEqual([transferCopy.tree.contents("Estoque"), true]);
    expect([arrow(false).props["aria-label"], arrow(false).props["aria-expanded"]]).toEqual([transferCopy.tree.contents("Estoque"), false]);
  });

  it("a descrição (o caminho e o que só a dica mostra) fica num texto escondido, ligado à caixa; o motivo aparece inteiro, numa linha que quebra", () => {
    const all = elementsOf(
      CheckRowFrame({
        node: connectionNode,
        state: "unchecked",
        open: false,
        disabled: true,
        name: "NOMINAL",
        description: { id: "linha-desc", text: "Na pasta Estoque." },
        onToggleOpen: noop,
        onMark: noop,
        children: null,
        detail: "pg.exemplo.invalid:5432 / api · sem usuário e senha",
        note: "Este Prism não conhece o banco MySql.",
      }),
    );
    const box = all.find((element) => element.type === TriStateBox) as Found;
    const hiddenText = all.find((element) => element.props.id === "linha-desc") as Found;
    const note = all.find((element) => element.props.children === "Este Prism não conhece o banco MySql.") as Found;

    expect(box.props.describedBy).toBe("linha-desc");
    expect([hiddenText.props.hidden, hiddenText.props.children]).toEqual([true, "Na pasta Estoque."]);
    expect(String(note.props.className)).toContain("whitespace-normal");
    expect(String(note.props.className)).not.toContain("truncate");
  });

  it("sem descrição, a caixa não aponta para nada", () => {
    const all = elementsOf(CheckRowFrame({ node: connectionNode, state: "unchecked", open: false, disabled: false, name: "NOMINAL", onToggleOpen: noop, onMark: noop, children: null }));
    expect((all.find((element) => element.type === TriStateBox) as Found).props.describedBy).toBeUndefined();
  });
});

describe("a busca da árvore", () => {
  it("o Enter na busca não faz nada: ela filtra enquanto se digita, e o Enter enviaria o formulário do diálogo", () => {
    const search = elementsOf(TreeSearchBar({ id: "busca", query: "data fix", onQuery: noop, onMarkAll: noop, onUnmarkAll: noop })).find((element) => element.type === Input) as Found;
    const press = (key: string) => {
      const event = { key, preventDefault: vi.fn() };
      (search.props.onKeyDown as (event: unknown) => void)(event);
      return event.preventDefault;
    };

    expect(press("Enter")).toHaveBeenCalledOnce();
    expect(press("a")).not.toHaveBeenCalled();
  });
});
