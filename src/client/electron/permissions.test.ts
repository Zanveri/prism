import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { appPermissions, permissionAllowed, resultWindowPermissions } from "./permissions";

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

  it("a janela do resultado (RN-ABAS-017) tem só a área de transferência, qualquer que seja o endereço ou a origem que vier (about:blank, herdada ou nula)", () => {
    expect([...resultWindowPermissions].sort()).toEqual(["clipboard-read", "clipboard-sanitized-write"]);

    for (const url of ["about:blank", "app://prism/index.html", "null", "", undefined, "https://example.com/"]) {
      expect(permissionAllowed("clipboard-read", url, app, true)).toBe(true);
      expect(permissionAllowed("clipboard-sanitized-write", url, app, true)).toBe(true);
      // As fontes locais e o resto não: nem para a janela do resultado.
      for (const other of ["local-fonts", "media", "geolocation", "notifications", "window-management", "hid", "usb", "serial", "fileSystem", "openExternal", "unknown"]) {
        expect(permissionAllowed(other, url, app, true)).toBe(false);
      }
    }
  });

  it("os quatro casos: janela do app ou do resultado, com a permissão da área de transferência ou outra", () => {
    // Janela do app: a regra da origem, como sempre.
    expect(permissionAllowed("clipboard-read", "app://prism/index.html", app, false)).toBe(true);
    expect(permissionAllowed("local-fonts", "app://prism/index.html", app, false)).toBe(true);
    // Janela do resultado: o endereço dela é about:blank, e a origem do app não decide.
    expect(permissionAllowed("clipboard-read", "about:blank", app, false)).toBe(false);
    expect(permissionAllowed("clipboard-read", "about:blank", app, true)).toBe(true);
    expect(permissionAllowed("local-fonts", "app://prism/index.html", app, true)).toBe(false);
  });

  it("o processo principal decide os pedidos e as consultas pela mesma regra, na sessão das janelas", () => {
    expect(main).toMatch(/session\.defaultSession\.setPermissionRequestHandler\(/);
    expect(main).toMatch(/session\.defaultSession\.setPermissionCheckHandler\(/);
    expect(main.match(/permissionAllowed\(/g)?.length).toBe(2);
    // RN-ABAS-017: os dois tratadores olham primeiro o `webContents` (pelo `id`) na lista das janelas do resultado; consulta sem `webContents` vale a origem.
    expect(main).toMatch(/setPermissionRequestHandler\(\(contents, permission, callback, details\) => callback\(permissionAllowed\(permission, details\.requestingUrl, rendererOrigin, isResultContents\(contents\)\)\)\)/);
    expect(main).toMatch(/setPermissionCheckHandler\(\(contents, permission, requestingOrigin\) => permissionAllowed\(permission, requestingOrigin, rendererOrigin, isResultContents\(contents\)\)\)/);
  });
});
