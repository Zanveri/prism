import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";

import { applicationMenuTemplate, isWaylandSession, menuShortcutIgnored, windowIconFile } from "./platform";

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

describe("menuShortcutIgnored: F5 e Ctrl+R nunca recarregam a janela, F5 e F11 chegam à tela (RN-GRADE-012 e RN-GRADE-013) e Ctrl+W nunca a fecha (RN-ABAS-019)", () => {
  const input = (key: string, over: Partial<{ type: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({ type: "keyDown", key, control: false, meta: false, shift: false, alt: false, ...over });

  it("F5, F6 e F11, com ou sem modificador, não vão ao menu (o Recarregar e o Tela cheia do menu de desenvolvimento): a tela os recebe (o F6 alterna entre o editor e o resultado, RN-ABAS-014)", () => {
    for (const key of ["F5", "F6", "F11"]) {
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

  it("Ctrl+W e Cmd+W (com ou sem Shift) não vão ao menu: o Janela › Fechar do menu padrão de desenvolvimento fecharia a janela com um diálogo aberto ou na tela de entrada, onde a tela não trata a tecla (RN-ABAS-019)", () => {
    expect(menuShortcutIgnored(input("w", { control: true }))).toBe(true);
    expect(menuShortcutIgnored(input("W", { control: true, shift: true }))).toBe(true);
    expect(menuShortcutIgnored(input("w", { meta: true }))).toBe(true);
    expect(menuShortcutIgnored(input("W", { meta: true }))).toBe(true);
    expect(menuShortcutIgnored(input("w", { control: true, type: "keyUp" }))).toBe(true);
  });

  it("o resto segue para o menu (no macOS, Cmd+C, Cmd+V e Cmd+Q são do menu; o R e o W sem Ctrl são digitação)", () => {
    for (const [key, over] of [["c", { meta: true }], ["v", { control: true }], ["q", { meta: true }], ["r", {}], ["w", {}], ["w", { shift: true }], ["w", { alt: true }], ["F2", {}], ["Enter", { control: true }]] as const) expect(menuShortcutIgnored(input(key, over)), key).toBe(false);
  });
});

describe("isWaylandSession: o app no Wayland nativo, onde o ponteiro lido pelo processo principal não vale fora das janelas (RN-ABAS-010)", () => {
  const wayland = { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" };
  const session = (over: Partial<Parameters<typeof isWaylandSession>[0]> = {}) => isWaylandSession({ platform: "linux", ozonePlatform: "", ozoneHint: "", env: {}, ...over });

  it("no padrão (`auto`), numa sessão Wayland com o servidor dele, sim; numa sessão X11, não", () => {
    expect(session({ env: wayland })).toBe(true);
    expect(session({ env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" } })).toBe(false);
    expect(session({ env: { XDG_SESSION_TYPE: "wayland" } })).toBe(false);
  });

  it("o `--ozone-platform` vence a sessão, e a dica (`--ozone-platform-hint` ou ELECTRON_OZONE_PLATFORM_HINT) também", () => {
    expect(session({ ozonePlatform: "x11", env: wayland })).toBe(false);
    expect(session({ ozonePlatform: "wayland" })).toBe(true);
    expect(session({ ozoneHint: "x11", env: wayland })).toBe(false);
    expect(session({ env: { ...wayland, ELECTRON_OZONE_PLATFORM_HINT: "x11" } })).toBe(false);
    expect(session({ ozoneHint: "wayland", env: { WAYLAND_DISPLAY: "wayland-0" } })).toBe(true);
  });

  it("fora do Linux, nunca", () => {
    expect(session({ platform: "win32", env: wayland })).toBe(false);
    expect(session({ platform: "darwin", ozonePlatform: "wayland" })).toBe(false);
  });
});
