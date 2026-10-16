import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A barra com os ganchos do React simulados (`createHookRuntime`): o vitest deste projeto não tem DOM, e a parada de tabulação da barra é estado.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { toolbarFor, type ToolbarActionId, type ToolbarButton } from "../_lib/navigator-toolbar";
import { NavigatorToolbar } from "./navigator-toolbar";

const nothing = { node: null, connection: null, folder: null };
/** Nada escolhido e nada aberto: Conectar, Desconectar, Atualizar e Recolher tudo desabilitados. */
const buttons = toolbarFor(nothing, { canCollapse: false }, "Ctrl+B");

/** A barra desenhada (os ganchos são os simulados também aqui: a marcação é a da primeira renderização). */
const markupOf = (list: ToolbarButton[]) => {
  rt.unmount();
  return rt.render(() => renderToStaticMarkup(createElement(NavigatorToolbar, { buttons: list, onAction: () => {} })));
};

/** Os botões da barra como a árvore de elementos os entrega, na ordem. */
function drawn(onAction: (id: ToolbarActionId) => void = () => {}, list = buttons) {
  const tree = rt.render(() => NavigatorToolbar({ buttons: list, onAction }));
  const [toolbar] = elementsOf(tree).filter((element) => element.props.role === "toolbar");
  return { toolbar, items: elementsOf(tree).filter((element) => element.type === "button") };
}

const labelOf = (element: Found) => element.props["aria-label"] as string;

describe("a barra de ações do navegador (RN-NAV-002)", () => {
  it("é uma barra de ferramentas com nome, e cada botão é só um ícone com nome para o leitor de tela e dica", () => {
    const markup = markupOf(buttons);
    const tags = [...markup.matchAll(/<button [^>]*>/g)].map((match) => match[0]);

    expect(markup).toMatch(/<div[^>]*role="toolbar"[^>]*aria-label="Ações da árvore de conexões"/);
    expect(tags.map((tag) => /aria-label="([^"]*)"/.exec(tag)?.[1])).toEqual(buttons.map((button) => button.label));
    expect(tags.map((tag) => /title="([^"]*)"/.exec(tag)?.[1])).toEqual(buttons.map((button) => button.title));
    // Só o desenho dentro do botão, escondido do leitor de tela: o nome é o `aria-label`.
    expect(markup.replace(/<svg[\s\S]*?<\/svg>/g, "")).not.toMatch(/<button [^>]*>[^<]+<\/button>/);
    expect(markup.match(/<svg[^>]*aria-hidden="true"/g)).toHaveLength(buttons.length);
  });

  it("a dica do botão de esconder leva o atalho", () => {
    expect(markupOf(buttons)).toContain('title="Esconder o navegador (Ctrl+B)"');
  });

  it("uma parada de tabulação só: o primeiro botão; os outros se alcançam pelas setas", () => {
    const tabIndexes = [...markupOf(buttons).matchAll(/<button [^>]*tabindex="(-?\d)"/g)].map((match) => match[1]);

    expect(tabIndexes).toEqual(["0", ...Array(buttons.length - 1).fill("-1")]);
  });

  it("o que não se aplica fica desabilitado SEM sair do teclado: `aria-disabled`, e não `disabled` (o botão que se desabilita ao ser usado não perde o foco)", () => {
    const markup = markupOf(buttons);
    const tags = [...markup.matchAll(/<button [^>]*>/g)].map((match) => match[0]);

    expect(tags.filter((tag) => tag.includes('aria-disabled="true"')).map((tag) => /aria-label="([^"]*)"/.exec(tag)?.[1])).toEqual(["Conectar", "Desconectar", "Atualizar", "Recolher tudo"]);
    expect(markup).not.toMatch(/<button [^>]*\sdisabled(=""|\s|>)/);
  });

  it("o clique chama a ação do botão; no desabilitado, nada", () => {
    rt.unmount();
    const onAction = vi.fn();
    const { items } = drawn(onAction);

    (items.find((item) => labelOf(item) === "Nova pasta")?.props.onClick as () => void)();
    expect(onAction).toHaveBeenCalledExactlyOnceWith("newFolder");

    (items.find((item) => labelOf(item) === "Conectar")?.props.onClick as () => void)();
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("as setas andam entre os botões e dão a volta, Home e End vão às pontas; os desabilitados entram no caminho", () => {
    rt.unmount();
    const { toolbar } = drawn();
    const elements = buttons.map(() => ({ focus: vi.fn() }));
    const press = (key: string, from: number) => {
      const preventDefault = vi.fn();
      (toolbar.props.onKeyDown as (event: unknown) => void)({ key, target: elements[from], currentTarget: { querySelectorAll: () => elements }, preventDefault });
      return preventDefault;
    };

    expect(press("ArrowRight", 0)).toHaveBeenCalledOnce();
    expect(elements[1].focus).toHaveBeenCalledOnce();

    press("ArrowLeft", 0);
    expect(elements[buttons.length - 1].focus).toHaveBeenCalledOnce();

    press("End", 2);
    expect(elements[buttons.length - 1].focus).toHaveBeenCalledTimes(2);

    press("Home", 4);
    expect(elements[0].focus).toHaveBeenCalledOnce();

    // O botão 2 (Conectar) está desabilitado e recebe o foco do mesmo jeito.
    press("ArrowRight", 1);
    expect(elements[2].focus).toHaveBeenCalledOnce();
  });

  it("outra tecla não é da barra: segue para quem a trata (o Ctrl+F do navegador, o Tab)", () => {
    rt.unmount();
    const { toolbar } = drawn();
    const preventDefault = vi.fn();
    const elements = buttons.map(() => ({ focus: vi.fn() }));

    for (const key of ["Tab", "f", "ArrowDown", "Enter"]) (toolbar.props.onKeyDown as (event: unknown) => void)({ key, target: elements[0], currentTarget: { querySelectorAll: () => elements }, preventDefault });

    expect(preventDefault).not.toHaveBeenCalled();
    expect(elements.some((element) => element.focus.mock.calls.length > 0)).toBe(false);
  });

  it("a parada de tabulação passa a ser o botão que recebeu o foco por último", () => {
    rt.unmount();
    const first = drawn();
    (first.items[3].props.onFocus as () => void)();

    expect(drawn().items.map((item) => item.props.tabIndex)).toEqual([-1, -1, -1, 0, -1, -1, -1]);
  });

  it("se a barra encolhe (um botão a menos), a parada de tabulação não fica num botão que não existe", () => {
    rt.unmount();
    const first = drawn();
    (first.items[6].props.onFocus as () => void)();

    expect(drawn(() => {}, buttons.slice(0, 5)).items.map((item) => item.props.tabIndex)).toEqual([-1, -1, -1, -1, 0]);
  });
});
