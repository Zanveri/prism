import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";

import { applicationMenuTemplate, menuShortcutIgnored, windowIconFile } from "./platform";

describe("windowIconFile (RN-MARCA-001)", () => {
  it(".ico no Windows, PNG no Linux e nenhum no macOS, onde o ícone é o do pacote", () => {
    expect(windowIconFile("win32")).toBe("icon.ico");
    expect(windowIconFile("linux")).toBe("icon.png");
    expect(windowIconFile("darwin")).toBeUndefined();
  });
});

/** Todos os `role` do menu, de qualquer profundidade. */
function rolesOf(items: MenuItemConstructorOptions[]): string[] {
  return items.flatMap((item) => [...(item.role === undefined ? [] : [item.role]), ...rolesOf(Array.isArray(item.submenu) ? item.submenu : [])]);
}

describe("applicationMenuTemplate", () => {
  it("no Windows e no Linux o app empacotado não tem menu", () => {
    expect(applicationMenuTemplate("win32")).toBeNull();
    expect(applicationMenuTemplate("linux")).toBeNull();
  });

  it("no macOS tem o menu do app (sair) e Editar (copiar e colar nos campos), e nada mais", () => {
    const template = applicationMenuTemplate("darwin");

    expect(template).not.toBeNull();
    const roles = rolesOf(template ?? []);
    expect(roles).toEqual(expect.arrayContaining(["appMenu", "undo", "redo", "cut", "copy", "paste", "selectAll"]));
    expect(template).toHaveLength(2);
  });

  it("no macOS não recarrega a janela nem abre as ferramentas de desenvolvedor", () => {
    const roles = rolesOf(applicationMenuTemplate("darwin") ?? []);

    for (const forbidden of ["reload", "forceReload", "toggleDevTools", "viewMenu"]) expect(roles).not.toContain(forbidden);
  });
});

describe("menuShortcutIgnored: F5 e Ctrl+R nunca recarregam a janela, e F5 e F11 chegam à tela (RN-GRADE-012 e RN-GRADE-013)", () => {
  const input = (key: string, over: Partial<{ type: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({ type: "keyDown", key, control: false, meta: false, shift: false, alt: false, ...over });

  it("F5 e F11, com ou sem modificador, não vão ao menu (o Recarregar e o Tela cheia do menu de desenvolvimento): a tela os recebe", () => {
    for (const key of ["F5", "F11"]) {
      expect(menuShortcutIgnored(input(key)), key).toBe(true);
      expect(menuShortcutIgnored(input(key, { control: true })), key).toBe(true);
      expect(menuShortcutIgnored(input(key, { shift: true })), key).toBe(true);
      expect(menuShortcutIgnored(input(key, { type: "keyUp" })), key).toBe(true);
    }
  });

  it("Ctrl+R e Cmd+R (e com Shift, o Forçar recarga) não vão ao menu", () => {
    expect(menuShortcutIgnored(input("r", { control: true }))).toBe(true);
    expect(menuShortcutIgnored(input("R", { control: true, shift: true }))).toBe(true);
    expect(menuShortcutIgnored(input("r", { meta: true }))).toBe(true);
  });

  it("o resto segue para o menu (no macOS, Cmd+C, Cmd+V e Cmd+Q são do menu; o R sem Ctrl é digitação)", () => {
    for (const [key, over] of [["c", { meta: true }], ["v", { control: true }], ["q", { meta: true }], ["r", {}], ["F2", {}], ["Enter", { control: true }]] as const) expect(menuShortcutIgnored(input(key, over)), key).toBe(false);
  });
});
