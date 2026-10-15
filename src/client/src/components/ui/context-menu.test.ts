import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { elementsOf } from "@/lib/testing/react-tree";

import { ContextMenuItems, firstItemOf, moveFocus, nextItemIndex, placeMenu, type ContextMenuItem } from "./context-menu";

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

  it("o motivo do item desabilitado fica à vista, embaixo do rótulo, e entra no nome que o leitor de tela ouve", () => {
    const markup = renderToStaticMarkup(createElement(ContextMenuItems, { groups: [[item("a", "Editar", { disabled: true, hint: "Somente leitura: o valor chegou cortado." }), item("b", "Copiar valor")]], onChoose: () => {} }));

    expect(markup).toMatch(/aria-disabled="true"[^>]*>(?:(?!<\/button>).)*Editar(?:(?!<\/button>).)*Somente leitura: o valor chegou cortado\./s);
    expect(markup.match(/Somente leitura/g)).toHaveLength(1);
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

  it("o item de escolha única é um menuitemradio com aria-checked, e só o escolhido leva a marca; o comum continua menuitem", () => {
    const markup = renderToStaticMarkup(createElement(ContextMenuItems, { groups: [[item("a", "A cada 5 s", { checked: false }), item("b", "A cada 10 s", { checked: true })], [item("c", "Desligar")]], onChoose: () => {} }));

    expect(markup.match(/role="menuitemradio"/g)).toHaveLength(2);
    expect(markup).toMatch(/role="menuitemradio"[^>]*aria-checked="false"[^>]*>(?:(?!<\/button>).)*A cada 5 s/s);
    expect(markup).toMatch(/role="menuitemradio"[^>]*aria-checked="true"[^>]*>(?:(?!<\/button>).)*A cada 10 s/s);
    expect(markup.match(/role="menuitem"/g)).toHaveLength(1);
    // A marca de escolhido é o desenho do `CheckIcon`, uma vez só; os três reservam a coluna dela.
    expect(markup.match(/M3\.5 8\.5l3 3 6-7/g)).toHaveLength(1);
    expect(markup.match(/size-4/g)).toHaveLength(3);
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

describe("o foco do teclado nos itens de escolha única (RN-GRADE-014: os intervalos da atualização automática)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * O menu desenhado por `ContextMenuItems`, sem DOM: os elementos são os papéis dos itens na ordem da marcação, e a busca do menu acha o elemento cujo
   * papel o seletor pede (`[role="…"]`, separados por vírgula), como `querySelectorAll` acharia. O foco é o `activeElement` da página de mentira.
   */
  function menuOf(groups: ContextMenuItem[][]) {
    const markup = renderToStaticMarkup(createElement(ContextMenuItems, { groups, onChoose: () => {} }));
    const page = { activeElement: null as unknown };
    vi.stubGlobal("document", page);
    const elements = [...markup.matchAll(/<button[^>]*role="([^"]+)"[^>]*data-item="([^"]+)"/g)].map(([, role, id]) => {
      const element = { role, id, focus: vi.fn(() => (page.activeElement = element)) };
      return element;
    });
    const matching = (selector: string) => {
      const roles = [...selector.matchAll(/\[role="([^"]+)"\]/g)].map(([, role]) => role);
      return elements.filter((element) => roles.includes(element.role));
    };
    const menu = { querySelectorAll: matching, querySelector: (selector: string) => matching(selector)[0] ?? null } as unknown as ParentNode;
    const press = (key: string) => moveFocus({ key, preventDefault: () => {} }, menu);
    const focused = () => (page.activeElement as { id: string } | null)?.id ?? null;
    return { menu, elements, press, focused };
  }

  const item = (id: string, label: string, extra: Partial<ContextMenuItem> = {}): ContextMenuItem => ({ id, label, onSelect: vi.fn(), ...extra });
  const intervals = [[item("a", "A cada 5 s", { checked: false }), item("b", "A cada 10 s", { checked: true }), item("c", "Personalizado…", { checked: false })], [item("off", "Desligar")]];

  it("o menu do teclado começa no primeiro item, mesmo quando ele é de escolha única", () => {
    const { menu, elements } = menuOf(intervals);

    expect(elements.map((element) => element.role)).toEqual(["menuitemradio", "menuitemradio", "menuitemradio", "menuitem"]);
    expect((firstItemOf(menu) as unknown as { id: string }).id).toBe("a");
  });

  it("as setas andam pelos itens de escolha única e pelos comuns, na ordem, e dão a volta; Home e End também os acham", () => {
    const { elements, press, focused } = menuOf(intervals);

    elements[0].focus();
    const visited = ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown"].map((key) => (press(key), focused()));
    expect(visited).toEqual(["b", "c", "off", "a"]);

    press("ArrowUp");
    expect(focused()).toBe("off");
    press("Home");
    expect(focused()).toBe("a");
    press("End");
    expect(focused()).toBe("off");
  });
});
