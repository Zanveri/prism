import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// A barra com os ganchos do React simulados (`createHookRuntime`): o vitest deste projeto não tem DOM, e a parada de tabulação da barra é estado.
const rt = await vi.hoisted(async () => (await import("@/lib/testing/react-hooks")).createHookRuntime());
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

import { Button } from "@/components/ui";
import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { editBar, type EditBarAction, type EditBarButton } from "../_lib/edit-bar";
import type { EditTarget } from "../_lib/record-edits.schema";
import { EditBar } from "./edit-bar";

/** Um resultado de junção com a célula ativa numa coluna que se edita: "Editar célula" vale, e os três de linha não (RN-EDIT-014). */
const join: EditTarget = {
  tables: [
    { schema: "loja", name: "pedido", key: [0], editable: true, reason: null },
    { schema: "loja", name: "cliente", key: [2], editable: true, reason: null },
  ],
  columns: [
    { table: 0, baseColumn: "id", editable: false, reason: "coluna da chave numa junção", nullable: false, generated: null },
    { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
    { table: 1, baseColumn: "id", editable: false, reason: "coluna da chave numa junção", nullable: false, generated: null },
  ],
  rowOperations: false,
  oneAtATime: false,
};
const buttons = editBar({ readOnly: null, target: join, busy: false, active: { cell: { row: 0, column: 1 }, row: { kind: "read", truncated: undefined, deleted: false } }, rows: 1, platform: "Win32" });
const enabled = editBar({ readOnly: null, target: null, busy: false, active: { cell: { row: 0, column: 1 }, row: { kind: "read", truncated: undefined, deleted: false } }, rows: 1, platform: "Win32" });

const markupOf = (list: readonly EditBarButton[]) => {
  rt.unmount();
  return rt.render(() => renderToStaticMarkup(createElement(EditBar, { buttons: list, onAction: () => {} })));
};

/** Os botões da barra como a árvore de elementos os entrega, na ordem, e a barra. */
function drawn(onAction: (id: EditBarAction) => void = () => {}, list = buttons, onDone?: () => void) {
  const tree = rt.render(() => EditBar({ buttons: list, onAction, onDone }));
  const [toolbar] = elementsOf(tree).filter((element) => element.props.role === "toolbar");
  return { toolbar, items: elementsOf(tree).filter((element) => element.type === Button) };
}

const tagsOf = (markup: string) => [...markup.matchAll(/<button [^>]*>/g)].map((match) => match[0]);
const click = (item: Found) => (item.props.onClick as () => void)();

describe("a barra de edição da grade (RN-EDIT-013)", () => {
  it("é uma barra de ferramentas chamada \"Edição da grade\", com os quatro botões na ordem, cada um com ícone e texto", () => {
    const markup = markupOf(enabled);

    expect(markup).toMatch(/<div[^>]*role="toolbar"[^>]*aria-label="Edição da grade"/);
    expect([...markup.matchAll(/<button [^>]*>([\s\S]*?)<\/button>/g)].map((match) => match[1].replace(/<svg[\s\S]*?<\/svg>/, ""))).toEqual(["Editar célula", "Adicionar linha", "Duplicar linha", "Excluir linha"]);
    expect(markup.match(/<button [^>]*><svg[^>]*aria-hidden="true"/g)).toHaveLength(4);
  });

  it("no desenho dos botões da área de resultado (28 px de altura e texto de 12 px), com o X de \"Excluir linha\" no tom de erro do tema", () => {
    const markup = markupOf(enabled);

    expect(tagsOf(markup).every((tag) => /class="[^"]*\bh-7\b[^"]*\btext-xs\b/.test(tag))).toBe(true);
    expect(markup).toMatch(/Duplicar linha<\/button><button [^>]*><svg[^>]*class="[^"]*text-danger/);
    expect(markup.match(/text-danger/g)).toHaveLength(1);
  });

  it("a dica escreve o atalho, e cada botão o declara para o leitor de tela (RN-EDIT-015)", () => {
    const tags = tagsOf(markupOf(enabled));

    expect(tags.map((tag) => /title="([^"]*)"/.exec(tag)?.[1])).toEqual(["Editar célula (F2)", "Adicionar linha (Alt+Insert)", "Duplicar linha (Ctrl+Alt+Insert)", "Excluir linha (Alt+Delete)"]);
    expect(tags.map((tag) => /aria-keyshortcuts="([^"]*)"/.exec(tag)?.[1])).toEqual(["F2", "Alt+Insert", "Control+Alt+Insert", "Alt+Delete"]);
  });

  it("o que não se aplica fica desabilitado sem sair das setas (`aria-disabled`, e não `disabled`), e diz por quê na dica e num texto só para o leitor de tela", () => {
    const markup = markupOf(buttons);
    const tags = tagsOf(markup);
    const reason = "Somente leitura: num resultado de junção só se alteram células.";

    expect(tags.map((tag) => tag.includes('aria-disabled="true"'))).toEqual([false, true, true, true]);
    expect(markup).not.toMatch(/<button [^>]*\sdisabled(=""|\s|>)/);
    expect(tags[1]).toContain(`title="Adicionar linha (Alt+Insert). ${reason}"`);
    const described = /aria-describedby="([^"]*)"/.exec(tags[1])?.[1];
    expect(markup).toContain(`<span id="${described}" class="sr-only">${reason}</span>`);
    expect(tags[0]).not.toContain("aria-describedby");
  });

  it("uma parada de tabulação só: de começo \"Editar célula\"; depois, o botão que teve o foco por último", () => {
    expect(tagsOf(markupOf(enabled)).map((tag) => /tabindex="(-?\d)"/.exec(tag)?.[1])).toEqual(["0", "-1", "-1", "-1"]);

    rt.unmount();
    (drawn().items[2].props.onFocus as () => void)();
    expect(drawn().items.map((item) => item.props.tabIndex)).toEqual([-1, -1, 0, -1]);
  });

  it("as setas andam entre os quatro e dão a volta, Home e End vão às pontas; os desabilitados entram no caminho", () => {
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
    expect(elements[3].focus).toHaveBeenCalledOnce();
    press("Home", 3);
    expect(elements[0].focus).toHaveBeenCalledOnce();
    press("End", 0);
    expect(elements[3].focus).toHaveBeenCalledTimes(2);
    expect(press("Tab", 0)).not.toHaveBeenCalled();
  });

  it("o clique faz a ação do botão e, depois, devolve o foco a quem desenha a barra (a grade); no desabilitado, nada", () => {
    rt.unmount();
    const onAction = vi.fn();
    const onDone = vi.fn();
    const { items } = drawn(onAction, buttons, onDone);

    click(items[0]);
    expect(onAction).toHaveBeenCalledExactlyOnceWith("edit");
    expect(onDone).toHaveBeenCalledOnce();

    click(items[1]);
    click(items[3]);
    expect(onAction).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
