import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A árvore da seção Scripts com o gancho do type-ahead de verdade e os ganchos do React simulados (`createHookRuntime`): o que se confere AQUI é o teclado de
// ir à linha pelas primeiras letras (RN-ARVORE-009) nas linhas à vista das pastas e dos scripts. As decisões (o texto, o tempo, a letra repetida, os acentos)
// são de `type-ahead.test.ts`, e o resto do teclado da árvore, de `scripts-section.test.ts`.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { elementsOf } from "@/lib/testing/react-tree";

import { buildScriptTree, folderKey, scriptTreeLabels, visibleScriptRows } from "../_lib/script-tree";
import type { ScriptFolder, ScriptSummary } from "../_lib/scripts.schema";
import { useTypeAhead } from "../_lib/use-type-ahead";
import { ScriptsTreeView } from "./scripts-section";
import { TypeAheadIndicator } from "./type-ahead-indicator";

const folder = (id: string, name: string): ScriptFolder => ({ id, parentID: null, name, createdAt: "", updatedAt: "" });
const script = (id: string, name: string, folderID: string | null = null): ScriptSummary => ({ id, name, connectionID: null, database: null, folderID, icon: null, color: null, updatedAt: "" });

// Fechamento (relatório), Rascunhos (vazia), e na raiz Abril, álamo e Zeta.
const tree = buildScriptTree([folder("f1", "Fechamento"), folder("f2", "Rascunhos")], [script("s1", "relatório", "f1"), script("s2", "Zeta"), script("s3", "álamo"), script("s4", "Abril")]);

/** As pastas abertas (RN-NAV-014): sem elas, só o primeiro nível está à vista. */
let open = new Set<string>();
let handlers = { onSelect: vi.fn(), onToggle: vi.fn(), onRequest: vi.fn(), onMenu: vi.fn() };
/** Os elementos de linha da lista falsa: o que recebeu o foco, por índice. */
let focused: number[] = [];

const rows = () => visibleScriptRows(tree, open);
const names = () => scriptTreeLabels(rows());
const at = (name: string) => names().indexOf(name);

/** A seção como o React a entrega: o gancho da seção e a árvore que o recebe. */
function screen() {
  const view = rt.render(() => ScriptsTreeView({ rows: rows(), failed: false, selectedKey: null, onRetry: () => {}, ...handlers, typeAhead: useTypeAhead() }));
  return { items: elementsOf(view).filter((element) => element.props.role === "treeitem"), indicator: elementsOf(view).find((element) => element.type === TypeAheadIndicator), view };
}

const siblings = () => ({ children: rows().map((_, index) => ({ focus: () => focused.push(index) })) });
function press(index: number, key: string, modifiers: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean } = {}) {
  const event = { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...modifiers, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), currentTarget: { parentElement: siblings(), getBoundingClientRect: () => ({ left: 4, bottom: 30 }) } };
  (screen().items[index].props.onKeyDown as (event: unknown) => void)(event);
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  open = new Set([folderKey("f1")]);
  handlers = { onSelect: vi.fn(), onToggle: vi.fn(), onRequest: vi.fn(), onMenu: vi.fn() };
  focused = [];
});

afterEach(() => {
  rt.unmount();
  vi.useRealTimers();
});

describe("a árvore da seção Scripts: ir à linha pelas primeiras letras (RN-ARVORE-009)", () => {
  it("uma letra leva a escolha e o foco à próxima linha que começa por ela, e a tecla é da árvore", () => {
    const event = press(0, "z");

    expect(handlers.onSelect).toHaveBeenCalledWith(rows()[at("Zeta")].node.key);
    expect(focused).toEqual([at("Zeta")]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("a mesma letra percorre as linhas que começam por ela, sem diferenciar maiúsculas nem acento, e volta ao começo", () => {
    press(0, "a");
    press(at("Abril"), "a");
    press(at("álamo"), "a");

    expect(focused).toEqual([at("Abril"), at("álamo"), at("Abril")]);
  });

  it("as letras seguidas formam o texto, a partir da linha atual", () => {
    press(at("Fechamento"), "á");
    expect(focused).toEqual([at("Abril")]);
    press(at("Abril"), "l");

    expect(focused.at(-1)).toBe(at("álamo"));
    expect(screen().indicator?.props.shown).toEqual({ text: "ál", found: true });
  });

  it("a pasta fechada esconde o que tem dentro: só as linhas à vista contam, e nada se abre", () => {
    press(0, "r");
    expect(focused).toEqual([at("relatório")]);

    vi.advanceTimersByTime(1100);
    open = new Set();
    press(0, "r");

    expect(focused.at(-1)).toBe(at("Rascunhos"));
    expect(handlers.onToggle).not.toHaveBeenCalled();
    expect(handlers.onRequest).not.toHaveBeenCalled();
  });

  it("sem linha que comece pelo texto, o foco e a escolha ficam onde estão, e o indicador diz que não há", () => {
    press(0, "q");

    expect(focused).toEqual([]);
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(screen().indicator?.props.shown).toEqual({ text: "q", found: false });
  });

  it("1 segundo depois, o indicador some", () => {
    press(0, "z");
    expect(screen().indicator?.props.shown).toEqual({ text: "z", found: true });

    vi.advanceTimersByTime(1000);
    expect(screen().indicator?.props.shown).toBeNull();
  });

  it("o indicador fica depois da lista, numa faixa sem altura grudada no pé de quem rola, e fora do `ul` (os filhos dele são as linhas)", () => {
    const { view, indicator } = screen();
    const tree = elementsOf(view).find((element) => element.props.role === "tree")!;

    expect(elementsOf(tree).includes(indicator!)).toBe(false);
    const strip = elementsOf(view).find((element) => String(element.props.className ?? "").includes("sticky"));
    expect(elementsOf(strip).includes(indicator!)).toBe(true);
    expect(String(strip!.props.className)).toEqual(expect.stringContaining("h-0"));
  });

  it("o Ctrl, o Alt e o Cmd com a letra não fazem nada", () => {
    for (const modifiers of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) expect(press(0, "z", modifiers).preventDefault).not.toHaveBeenCalled();

    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(focused).toEqual([]);
    expect(screen().indicator?.props.shown).toBeNull();
  });

  it("o Espaço sozinho não é tomado; no meio do texto, entra nele", () => {
    expect(press(0, " ").preventDefault).not.toHaveBeenCalled();

    press(0, "a");
    expect(press(at("Abril"), " ").preventDefault).toHaveBeenCalled();
    expect(screen().indicator?.props.shown).toEqual({ text: "a ", found: false });
  });

  it("as teclas de antes seguem: as setas, Enter, F2, Delete e a tecla de menu", () => {
    press(at("Fechamento"), "ArrowDown");
    press(at("Fechamento"), "Enter");
    press(at("Fechamento"), "F2");
    press(at("Fechamento"), "Delete");
    press(at("Fechamento"), "ContextMenu");

    expect(focused).toEqual([at("Fechamento") + 1]);
    expect(handlers.onRequest.mock.calls.map(([, request]) => request)).toEqual(["enter", "rename", "delete"]);
    expect(handlers.onMenu).toHaveBeenCalledTimes(1);
    expect(screen().indicator?.props.shown).toBeNull();
  });
});
