import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { elementsOf } from "@/lib/testing/react-tree";

import { ContextMenuItems, nextItemIndex, placeMenu, type ContextMenuItem } from "./context-menu";

describe("placeMenu (o menu não sai da janela)", () => {
  const menu = { width: 220, height: 180 };

  it("cabe: abre com o canto no ponto", () => {
    expect(placeMenu({ x: 300, y: 200 }, menu, { width: 1440, height: 900 })).toEqual({ left: 300, top: 200 });
  });

  it("perto da borda direita abre para a esquerda do ponto: a borda do menu fica no ponto", () => {
    expect(placeMenu({ x: 1400, y: 200 }, menu, { width: 1440, height: 900 })).toEqual({ left: 1180, top: 200 });
  });

  it("perto da borda de baixo abre para cima do ponto", () => {
    expect(placeMenu({ x: 300, y: 850 }, menu, { width: 1440, height: 900 })).toEqual({ left: 300, top: 670 });
  });

  it("no canto de baixo e da direita, para cima e para a esquerda", () => {
    expect(placeMenu({ x: 1430, y: 895 }, menu, { width: 1440, height: 900 })).toEqual({ left: 1210, top: 715 });
  });

  it("a janela mínima do app (1024 x 700) também", () => {
    const { left, top } = placeMenu({ x: 1000, y: 690 }, menu, { width: 1024, height: 700 });

    expect(left + menu.width).toBeLessThanOrEqual(1024 - 8);
    expect(top + menu.height).toBeLessThanOrEqual(700 - 8);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top).toBeGreaterThanOrEqual(8);
  });

  it("não cabe nem de um lado nem do outro (a janela é mais baixa que o menu): encosta na margem de cima", () => {
    expect(placeMenu({ x: 300, y: 100 }, { width: 220, height: 400 }, { width: 800, height: 380 })).toEqual({ left: 300, top: 8 });
  });

  it("o ponto colado na borda esquerda ou de cima não dá posição negativa", () => {
    expect(placeMenu({ x: 0, y: 0 }, menu, { width: 1440, height: 900 })).toEqual({ left: 0, top: 0 });
    expect(placeMenu({ x: 4, y: 890 }, { width: 220, height: 900 }, { width: 1440, height: 900 })).toEqual({ left: 4, top: 8 });
  });
});

describe("nextItemIndex (setas, Home e End)", () => {
  it("seta para baixo vai ao seguinte, dá a volta no último e, sem item com foco, vai ao primeiro", () => {
    expect(nextItemIndex("ArrowDown", 0, 4)).toBe(1);
    expect(nextItemIndex("ArrowDown", 3, 4)).toBe(0);
    expect(nextItemIndex("ArrowDown", -1, 4)).toBe(0);
  });

  it("seta para cima vai ao anterior, dá a volta no primeiro e, sem item com foco, vai ao último", () => {
    expect(nextItemIndex("ArrowUp", 2, 4)).toBe(1);
    expect(nextItemIndex("ArrowUp", 0, 4)).toBe(3);
    expect(nextItemIndex("ArrowUp", -1, 4)).toBe(3);
  });

  it("Home e End vão ao primeiro e ao último", () => {
    expect(nextItemIndex("Home", 2, 4)).toBe(0);
    expect(nextItemIndex("End", 1, 4)).toBe(3);
  });

  it("outra tecla não move, e menu sem item não tem para onde ir", () => {
    expect(nextItemIndex("a", 1, 4)).toBeNull();
    expect(nextItemIndex("ArrowLeft", 1, 4)).toBeNull();
    expect(nextItemIndex("ArrowDown", -1, 0)).toBeNull();
  });
});

describe("ContextMenuItems (o que o menu desenha e o que um clique em cada item faz)", () => {
  const item = (id: string, label: string, extra: Partial<ContextMenuItem> = {}): ContextMenuItem => ({ id, label, onSelect: vi.fn(), ...extra });
  const buttons = (groups: ContextMenuItem[][], onChoose: (item: ContextMenuItem) => void = () => {}) => elementsOf(ContextMenuItems({ groups, onChoose })).filter((element) => element.type === "button");

  it("cada item é um menuitem, fora da ordem do Tab (as setas é que andam)", () => {
    const markup = renderToStaticMarkup(createElement(ContextMenuItems, { groups: [[item("a", "Abrir"), item("b", "Fechar")]], onChoose: () => {} }));

    expect(markup.match(/role="menuitem"/g)).toHaveLength(2);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(2);
    expect(markup).toContain("Abrir");
    expect(markup).toContain("Fechar");
  });

  it("o item desabilitado sai com aria-disabled, e só ele: continua na lista, para quem usa leitor de tela saber que existe", () => {
    const markup = renderToStaticMarkup(createElement(ContextMenuItems, { groups: [[item("a", "Atualizar", { disabled: true }), item("b", "Nova consulta"), item("c", "Copiar nome", { disabled: false })]], onChoose: () => {} }));

    expect(markup.match(/aria-disabled="true"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-disabled="true"[^>]*>(?:(?!<\/button>).)*Atualizar/s);
    expect(markup).not.toContain("disabled=\"\"");
  });

  it("clicar no item desabilitado não executa nada: o menu continua aberto", () => {
    const onChoose = vi.fn();
    const [disabled] = buttons([[item("a", "Atualizar", { disabled: true })]], onChoose);

    (disabled.props.onClick as () => void)();

    expect(onChoose).not.toHaveBeenCalled();
  });

  it("clicar no item habilitado chama onChoose com ele (e Enter e Espaço, que o botão trata como clique, também)", () => {
    const onChoose = vi.fn();
    const target = item("b", "Nova consulta");
    const found = buttons([[item("a", "Atualizar", { disabled: true }), target]], onChoose);

    (found[1].props.onClick as () => void)();

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(target);
  });

  it("entre dois grupos vai um separador; grupo vazio não deixa separador sobrando", () => {
    const separators = (groups: ContextMenuItem[][]) => renderToStaticMarkup(createElement(ContextMenuItems, { groups, onChoose: () => {} })).match(/role="separator"/g)?.length ?? 0;

    expect(separators([[item("a", "A")], [item("b", "B")], [item("c", "C")]])).toBe(2);
    expect(separators([[item("a", "A")], [], [item("c", "C")]])).toBe(1);
    expect(separators([[item("a", "A"), item("b", "B")]])).toBe(0);
  });

  it("se algum item tem ícone, os outros reservam o espaço dele e os rótulos alinham; se nenhum tem, não há coluna", () => {
    const iconColumns = (groups: ContextMenuItem[][]) => (renderToStaticMarkup(createElement(ContextMenuItems, { groups, onChoose: () => {} })).match(/size-4/g) ?? []).length;

    expect(iconColumns([[item("a", "A", { icon: createElement("svg") }), item("b", "B")]])).toBe(2);
    expect(iconColumns([[item("a", "A"), item("b", "B")]])).toBe(0);
  });

  it("o atalho aparece à direita só no item que tem um", () => {
    const markup = renderToStaticMarkup(createElement(ContextMenuItems, { groups: [[item("a", "Abrir registros", { shortcut: "Enter" }), item("b", "Copiar nome")]], onChoose: () => {} }));

    expect(markup.match(/Enter/g)).toHaveLength(1);
  });

  it("rótulo e atalho entram como texto: marcação neles não vira elemento", () => {
    const markup = renderToStaticMarkup(createElement(ContextMenuItems, { groups: [[item("a", "<img src=x onerror=alert(1)>", { shortcut: "<b>x</b>" })]], onChoose: () => {} }));

    expect(markup).not.toContain("<img");
    expect(markup).not.toContain("<b>");
    expect(markup).toContain("&lt;img");
  });
});
