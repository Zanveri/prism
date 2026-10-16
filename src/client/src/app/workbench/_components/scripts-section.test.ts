import { describe, expect, it, vi } from "vitest";

import { FolderIcon } from "@/components/ui";
import { elementsOf } from "@/lib/testing/react-tree";

import { buildScriptTree, folderKey, scriptKey, visibleScriptRows } from "../_lib/script-tree";
import { scriptsCopy as copy } from "../_lib/scripts.copy";
import type { ScriptFolder, ScriptSummary } from "../_lib/scripts.schema";
import { ScriptIconView } from "./script-icon";
import { ScriptsTreeView } from "./scripts-section";

const folders: ScriptFolder[] = [
  { id: "f1", parentID: null, name: "Fechamento", createdAt: "", updatedAt: "" },
  { id: "f2", parentID: null, name: "Vazia", createdAt: "", updatedAt: "" },
];
const scripts: ScriptSummary[] = [
  { id: "s1", name: "Mensal", connectionID: null, database: null, folderID: "f1", icon: null, color: null, updatedAt: "" },
  { id: "s2", name: "Pedidos", connectionID: "c1", database: "vendas", folderID: null, icon: "chart", color: "#F2B644", updatedAt: "" },
];
const tree = buildScriptTree(folders, scripts);
const allOpen = visibleScriptRows(tree, new Set());
const noop = () => {};
const view = (over: Partial<Parameters<typeof ScriptsTreeView>[0]> = {}) => ScriptsTreeView({ rows: allOpen, failed: false, selectedKey: null, onSelect: noop, onToggle: noop, onRequest: noop, onMenu: noop, onRetry: noop, ...over });
const items = (tree: ReturnType<typeof view>) => elementsOf(tree).filter((element) => element.props.role === "treeitem");
const key = (name: string, shiftKey = false) => ({ key: name, shiftKey, preventDefault: vi.fn(), currentTarget: { parentElement: { children: [] }, getBoundingClientRect: () => ({ left: 10, bottom: 40 }) } });
const press = (row: ReturnType<typeof items>[number], name: string, shiftKey = false) => (row.props.onKeyDown as (event: unknown) => void)(key(name, shiftKey));

describe("a árvore da seção Scripts (RN-SCRIPT-008)", () => {
  it("é uma árvore chamada \"Scripts salvos\", com uma linha por pasta e por script, cada uma com o nível dela", () => {
    const tree = elementsOf(view()).find((element) => element.props.role === "tree");

    expect(tree?.props["aria-label"]).toBe(copy.section.list);
    expect(items(view()).map((row) => [row.props.title, row.props["aria-level"]])).toEqual([
      [copy.section.folderHint("Fechamento"), 1],
      [copy.section.rowHintGeneric("Mensal"), 2],
      [copy.section.folderHint("Vazia"), 1],
      [copy.section.rowHint("Pedidos"), 1],
    ]);
  });

  it("a pasta com alguma coisa dentro diz se está aberta e tem a seta; a vazia e o script, não", () => {
    const rows = items(view());
    const chevrons = (row: (typeof rows)[number]) => elementsOf(row).filter((element) => element.props["data-chevron"] === true);

    expect(rows.map((row) => row.props["aria-expanded"])).toEqual([true, undefined, undefined, undefined]);
    expect(rows.map((row) => chevrons(row).length)).toEqual([1, 0, 0, 0]);
    expect(items(view({ rows: visibleScriptRows(tree, new Set([folderKey("f1")])) }))[0].props["aria-expanded"]).toBe(false);
  });

  it("só uma linha entra no Tab: a escolhida, ou a primeira", () => {
    expect(items(view()).map((row) => row.props.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(items(view({ selectedKey: scriptKey("s2") })).map((row) => [row.props.tabIndex, row.props["aria-selected"]])).toEqual([
      [-1, false],
      [-1, false],
      [-1, false],
      [0, true],
    ]);
  });

  it("a pasta tem o ícone de pasta, neutro; o script, o ícone e a cor dele, e o genérico, a marca discreta (RN-SCRIPT-005 e 006)", () => {
    const rows = items(view());
    const marks = (row: (typeof rows)[number]) => elementsOf(row).filter((element) => element.props.children === copy.section.generic).length;

    expect(rows.map((row) => elementsOf(row).filter((element) => element.type === FolderIcon).length)).toEqual([1, 0, 1, 0]);
    expect(elementsOf(view()).filter((element) => element.type === ScriptIconView).map((icon) => [icon.props.icon, icon.props.color])).toEqual([
      ["document", null],
      ["chart", "#F2B644"],
    ]);
    expect(rows.map(marks)).toEqual([0, 1, 0, 0]);
  });

  it("as setas andam e abrem e fecham; Enter e o duplo clique pedem a linha; F2 renomeia; Delete exclui; Shift+F10 abre o menu no pé da linha", () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const onRequest = vi.fn();
    const onMenu = vi.fn();
    const [fechamento, mensal] = items(view({ onSelect, onToggle, onRequest, onMenu }));

    press(fechamento, "ArrowDown");
    press(fechamento, "ArrowLeft");
    press(mensal, "ArrowLeft");
    press(mensal, "Enter");
    (fechamento.props.onDoubleClick as () => void)();
    press(mensal, "F2");
    press(fechamento, "Delete");
    press(fechamento, "F10", true);

    expect(onSelect.mock.calls).toEqual([[scriptKey("s1")], [folderKey("f1")]]);
    expect(onToggle.mock.calls).toEqual([[folderKey("f1")]]);
    expect(onRequest.mock.calls.map(([row, request]) => [row.node.key, request])).toEqual([
      [scriptKey("s1"), "enter"],
      [folderKey("f1"), "enter"],
      [scriptKey("s1"), "rename"],
      [folderKey("f1"), "delete"],
    ]);
    expect(onMenu).toHaveBeenCalledWith(allOpen[0], { x: 38, y: 40 }, "first");
  });

  it("o clique na seta abre e fecha a pasta, e escolhe a linha", () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    const chevron = elementsOf(items(view({ onSelect, onToggle }))[0]).find((element) => element.props["data-chevron"] === true)!;

    (chevron.props.onClick as (event: unknown) => void)({ stopPropagation: vi.fn() });

    expect(onSelect).toHaveBeenCalledWith(folderKey("f1"));
    expect(onToggle).toHaveBeenCalledWith(folderKey("f1"));
  });

  it("carregando, vazia (sem pasta e sem script) e com falha (com \"Tentar de novo\") dizem o que está acontecendo; só com pastas, mostra as pastas", () => {
    const text = (tree: ReturnType<typeof view>) => elementsOf(tree).map((element) => element.props.children);
    const onRetry = vi.fn();

    expect(text(view({ rows: undefined }))).toContain(copy.section.loading);
    expect(text(view({ rows: [] }))).toContain(copy.section.empty);
    expect(items(view({ rows: visibleScriptRows(buildScriptTree(folders, []), new Set()) }))).toHaveLength(2);
    const failed = view({ rows: undefined, failed: true, onRetry });
    expect(text(failed)).toContain(copy.section.failed);
    (elementsOf(failed).find((element) => element.props.children === copy.section.retry)?.props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("a densidade do navegador na árvore da seção Scripts (RN-NAV-011)", () => {
  const measures = (tree: ReturnType<typeof view>) => items(tree).map((row) => [String(row.props.className).split(" ").find((name) => name.startsWith("h-")), (row.props.style as { paddingLeft: number }).paddingLeft]);

  it("sem a escolha, a confortável: linhas de 30 px e 16 px de recuo a cada nível", () => {
    expect(measures(view())).toEqual([
      ["h-[30px]", 10],
      ["h-[30px]", 26],
      ["h-[30px]", 10],
      ["h-[30px]", 10],
    ]);
  });

  it("a compacta: linhas de 22 px e 12 px de recuo a cada nível, como as da árvore das conexões", () => {
    expect(measures(view({ density: "compact" }))).toEqual([
      ["h-[22px]", 6],
      ["h-[22px]", 18],
      ["h-[22px]", 6],
      ["h-[22px]", 6],
    ]);
  });
});
