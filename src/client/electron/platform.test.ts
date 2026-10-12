import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";

import { applicationMenuTemplate, windowIconFile } from "./platform";

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
