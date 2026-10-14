import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { elementsOf } from "@/lib/testing/react-tree";

import { ContextMenuItems, groupItems, placeSubmenu, type ContextMenuGroup, type ContextMenuItem } from "./context-menu";

// O submenu e os grupos com título do menu de contexto: o "Filtrar" da grade (F11), com "Valor da célula" e "Personalizado" (RN-GRADE-010 do Filtrar,
// nas regras do RN-MENU-001).
const item = (id: string, label: string, extra: Partial<ContextMenuItem> = {}): ContextMenuItem => ({ id, label, onSelect: vi.fn(), ...extra });
const markupOf = (groups: ContextMenuGroup[], expanded: string | null = null) => renderToStaticMarkup(createElement(ContextMenuItems, { groups, onChoose: () => {}, expanded }));

describe("placeSubmenu (o submenu ao lado do item, sem sair da janela)", () => {
  const size = { width: 260, height: 300 };
  const viewport = { width: 1440, height: 900 };

  it("cabe: à direita do item, com o primeiro item na altura dele", () => {
    expect(placeSubmenu({ left: 100, right: 320, top: 200 }, size, viewport)).toEqual({ left: 318, top: 196 });
  });

  it("sem lugar à direita: à esquerda do menu", () => {
    expect(placeSubmenu({ left: 1100, right: 1320, top: 200 }, size, viewport)).toEqual({ left: 842, top: 196 });
  });

  it("perto do pé da janela: sobe até caber; mais alto que a janela, encosta na margem de cima", () => {
    expect(placeSubmenu({ left: 100, right: 320, top: 800 }, size, viewport)).toEqual({ left: 318, top: 592 });
    expect(placeSubmenu({ left: 100, right: 320, top: 100 }, { width: 260, height: 1000 }, viewport).top).toBe(8);
  });

  it("na janela mínima do app (1024 x 700), nunca fora dela", () => {
    for (const anchor of [{ left: 0, right: 220, top: 0 }, { left: 800, right: 1020, top: 690 }, { left: 400, right: 620, top: 350 }]) {
      const { left, top } = placeSubmenu(anchor, size, { width: 1024, height: 700 });
      expect(left).toBeGreaterThanOrEqual(8);
      expect(left + size.width).toBeLessThanOrEqual(1024 - 8 + 2);
      expect(top).toBeGreaterThanOrEqual(8);
      expect(top + size.height).toBeLessThanOrEqual(700 - 8);
    }
  });
});

describe("ContextMenuItems: o item de submenu", () => {
  const filter = item("filter", "Filtrar", { shortcut: "F11", submenu: { label: "Filtrar", groups: [[item("byValue", "Filtrar por valor…")]] } });

  it("diz que abre um menu e se está aberto, e tem a seta à direita", () => {
    expect(markupOf([[filter]])).toMatch(/aria-haspopup="menu"[^>]*aria-expanded="false"/);
    expect(markupOf([[filter]], "filter")).toMatch(/aria-expanded="true"/);
    expect(markupOf([[filter]])).toContain('d="M6 4l4 4-4 4"');
    // O item comum não tem nada disso.
    expect(markupOf([[item("a", "Copiar valor")]])).not.toContain("aria-haspopup");
  });

  it("o atalho dele (F11) aparece como o dos outros", () => {
    expect(markupOf([[filter]])).toContain(">F11<");
  });

  it("o clique chama onChoose com ele (é o menu que abre o submenu, e não a ação)", () => {
    const onChoose = vi.fn();
    const [button] = elementsOf(ContextMenuItems({ groups: [[filter]], onChoose })).filter((element) => element.type === "button");

    (button.props.onClick as () => void)();

    expect(onChoose).toHaveBeenCalledExactlyOnceWith(filter);
  });

  it("o mouse em cima avisa quem abre o submenu, com o elemento (a posição sai dele)", () => {
    const onHover = vi.fn();
    const [button] = elementsOf(ContextMenuItems({ groups: [[filter]], onChoose: () => {}, onHover })).filter((element) => element.type === "button");
    const element = { focus: vi.fn() };

    (button.props.onPointerMove as (event: unknown) => void)({ currentTarget: element });

    expect(element.focus).toHaveBeenCalled();
    expect(onHover).toHaveBeenCalledExactlyOnceWith(filter, element);
  });
});

describe("ContextMenuItems: o grupo com título", () => {
  const groups: ContextMenuGroup[] = [[item("byValue", "Filtrar por valor…")], { label: "Valor da célula", items: [item("eq", `"code" = '11.901'`), item("ne", `"code" <> '11.901'`)] }, { label: "Personalizado", items: [item("custom", `"code" = …`)] }];

  it("é um group com o nome do título, e o título não é item (não entra nas setas nem no leitor como item)", () => {
    const markup = markupOf(groups);

    expect(markup).toContain('role="group" aria-label="Valor da célula"');
    expect(markup).toContain('role="group" aria-label="Personalizado"');
    expect(markup).toMatch(/<div aria-hidden="true"[^>]*>Valor da célula<\/div>/);
    expect(markup.match(/role="menuitem"/g)).toHaveLength(4);
  });

  it("entre os grupos vão os separadores, com título ou sem; o grupo vazio não deixa separador", () => {
    expect(markupOf(groups).match(/role="separator"/g)).toHaveLength(2);
    expect(markupOf([...groups, { label: "Vazio", items: [] }]).match(/role="separator"/g)).toHaveLength(2);
  });

  it("os rótulos com a condição entram como texto", () => {
    expect(markupOf(groups)).toContain("&quot;code&quot; = &#x27;11.901&#x27;");
  });

  it("groupItems lê os dois jeitos de grupo", () => {
    expect(groupItems(groups[0]).map((entry) => entry.id)).toEqual(["byValue"]);
    expect(groupItems(groups[1]).map((entry) => entry.id)).toEqual(["eq", "ne"]);
  });
});
