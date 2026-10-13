import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { appPermissions, permissionAllowed } from "./permissions";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("as permissões do Chromium (RN-SHELL-001 e RN-CONFIG-008)", () => {
  const app = "app://prism";

  it("são só as que a tela usa: copiar, colar e ler as fontes do sistema", () => {
    expect([...appPermissions].sort()).toEqual(["clipboard-read", "clipboard-sanitized-write", "local-fonts"]);
  });

  it.each(["app://prism", "app://prism/", "app://prism/index.html", "app://prism/index.html#/settings"])("a origem do app (%s) recebe cada uma delas", (url) => {
    for (const permission of appPermissions) expect(permissionAllowed(permission, url, app)).toBe(true);
  });

  it("em desenvolvimento a origem é a do servidor do Vite", () => {
    expect(permissionAllowed("local-fonts", "http://localhost:5173/", "http://localhost:5173")).toBe(true);
    expect(permissionAllowed("local-fonts", "http://localhost:5174/", "http://localhost:5173")).toBe(false);
  });

  it.each(["https://example.com/", "app://prism.evil/", "app://prismx/index.html", "app://evil/app://prism/", "file:///tmp/a.html", "null", "", undefined])("outra origem (%s) não recebe nenhuma", (url) => {
    for (const permission of appPermissions) expect(permissionAllowed(permission, url, app)).toBe(false);
  });

  it.each(["media", "geolocation", "notifications", "window-management", "hid", "usb", "serial", "fileSystem", "openExternal", "unknown"])("o que a tela não usa (%s) é negado, mesmo à origem do app", (permission) => {
    expect(permissionAllowed(permission, `${app}/index.html`, app)).toBe(false);
  });

  it("o processo principal decide os pedidos e as consultas pela mesma regra, na sessão das janelas", () => {
    expect(main).toMatch(/session\.defaultSession\.setPermissionRequestHandler\(/);
    expect(main).toMatch(/session\.defaultSession\.setPermissionCheckHandler\(/);
    expect(main.match(/permissionAllowed\(/g)?.length).toBe(2);
  });
});
