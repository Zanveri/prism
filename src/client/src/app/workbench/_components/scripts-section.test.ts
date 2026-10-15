import { describe, expect, it, vi } from "vitest";

import { elementsOf } from "@/lib/testing/react-tree";

import { scriptsCopy as copy } from "../_lib/scripts.copy";
import { ScriptIconView } from "./script-icon";
import { ScriptsListView } from "./scripts-section";

const scripts = [
  { id: "s1", name: "Fechamento", connectionID: null, database: null, icon: null, color: null, updatedAt: "" },
  { id: "s2", name: "Pedidos", connectionID: "c1", database: "vendas", icon: "chart", color: "#F2B644", updatedAt: "" },
];
const noop = () => {};
const view = (over: Partial<Parameters<typeof ScriptsListView>[0]> = {}) => ScriptsListView({ scripts, failed: false, selectedId: null, onSelect: noop, onAction: noop, onMenu: noop, onRetry: noop, ...over });
const rows = (tree: ReturnType<typeof view>) => elementsOf(tree).filter((element) => element.props.role === "option");
const key = (name: string, shiftKey = false) => ({ key: name, shiftKey, preventDefault: vi.fn(), currentTarget: { parentElement: { children: [] }, getBoundingClientRect: () => ({ left: 10, bottom: 40 }) } });

describe("a lista da seção Scripts (RN-SCRIPT-003)", () => {
  it("uma linha por script, na ordem que veio (a de nome), e só uma entra no Tab: a escolhida, ou a primeira", () => {
    expect(rows(view()).map((row) => [row.props["aria-selected"], row.props.tabIndex])).toEqual([
      [false, 0],
      [false, -1],
    ]);
    expect(rows(view({ selectedId: "s2" })).map((row) => row.props.tabIndex)).toEqual([-1, 0]);
    expect(elementsOf(view()).find((element) => element.props.role === "listbox")?.props["aria-label"]).toBe(copy.section.list);
  });

  it("o duplo clique e o Enter abrem; F2 renomeia; Delete exclui; Shift+F10 abre o menu no pé da linha, com o foco no primeiro item", () => {
    const onAction = vi.fn();
    const onMenu = vi.fn();
    const [first] = rows(view({ onAction, onMenu }));
    const press = (name: string, shiftKey = false) => (first.props.onKeyDown as (event: unknown) => void)(key(name, shiftKey));

    (first.props.onDoubleClick as () => void)();
    press("Enter");
    press("F2");
    press("Delete");
    press("F10", true);

    expect(onAction.mock.calls.map(([script, action]) => [script.id, action])).toEqual([
      ["s1", "open"],
      ["s1", "open"],
      ["s1", "rename"],
      ["s1", "delete"],
    ]);
    expect(onMenu).toHaveBeenCalledWith(scripts[0], { x: 38, y: 40 }, "first");
  });

  it("o script genérico leva a marca discreta ao lado do nome, e a dica diz o que é; o com conexão, não (RN-SCRIPT-005)", () => {
    const [generic, bound] = rows(view());
    const marks = (row: ReturnType<typeof rows>[number]) => elementsOf(row).filter((element) => element.props.children === copy.section.generic);

    expect(marks(generic)).toHaveLength(1);
    expect(generic.props.title).toBe(copy.section.rowHintGeneric("Fechamento"));
    expect(marks(bound)).toHaveLength(0);
    expect(bound.props.title).toBe(copy.section.rowHint("Pedidos"));
  });

  it("as setas escolhem a linha vizinha", () => {
    const onSelect = vi.fn();
    const [first] = rows(view({ onSelect }));

    (first.props.onKeyDown as (event: unknown) => void)(key("ArrowDown"));

    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("carregando, vazia e com falha (com \"Tentar de novo\") dizem o que está acontecendo", () => {
    const text = (tree: ReturnType<typeof view>) => elementsOf(tree).map((element) => element.props.children);
    const onRetry = vi.fn();

    expect(text(view({ scripts: undefined }))).toContain(copy.section.loading);
    expect(text(view({ scripts: [] }))).toContain(copy.section.empty);
    const failed = view({ scripts: undefined, failed: true, onRetry });
    expect(text(failed)).toContain(copy.section.failed);
    (elementsOf(failed).find((element) => element.props.children === copy.section.retry)?.props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("o ícone de cada script na lista (RN-SCRIPT-006)", () => {
  it("cada linha leva o ícone do script, na cor dele; o script sem ícone nem cor, o documento neutro", () => {
    const icons = elementsOf(view()).filter((element) => element.type === ScriptIconView);

    expect(icons.map((icon) => [icon.props.icon, icon.props.color])).toEqual([
      ["document", null],
      ["chart", "#F2B644"],
    ]);
  });
});

describe("a densidade do navegador na lista de scripts (RN-NAV-011)", () => {
  const heights = (tree: ReturnType<typeof view>) => rows(tree).map((row) => String(row.props.className).split(" ").filter((name) => name.startsWith("h-")));

  it("sem a escolha, a confortável: linhas de 28 px, como antes", () => {
    expect(heights(view())).toEqual([["h-7"], ["h-7"]]);
  });

  it("a compacta: linhas de 22 px, como as da árvore", () => {
    expect(heights(view({ density: "compact" }))).toEqual([["h-[22px]"], ["h-[22px]"]]);
  });
});
