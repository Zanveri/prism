import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { navigationAllowed, preferencesMatch, resultWindowOptions, resultWindowPreferences } from "./web-lockdown";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const dev = "http://localhost:5173/";

describe("a navegação que uma página pode fazer (RN-SHELL-001)", () => {
  it("a janela do app só recarrega a própria página, em desenvolvimento, com ou sem a rota em hash", () => {
    expect(navigationAllowed({ url: dev, isAppWindow: true, devServerUrl: dev })).toBe(true);
    expect(navigationAllowed({ url: `${dev}#/workbench`, isAppWindow: true, devServerUrl: dev })).toBe(true);
  });

  it("nenhuma outra, e nenhuma no app empacotado (sem endereço do Vite)", () => {
    expect(navigationAllowed({ url: "https://example.com/", isAppWindow: true, devServerUrl: dev })).toBe(false);
    expect(navigationAllowed({ url: "app://prism/index.html", isAppWindow: true, devServerUrl: undefined })).toBe(false);
    expect(navigationAllowed({ url: dev, isAppWindow: true, devServerUrl: undefined })).toBe(false);
  });

  it("a janela do resultado e qualquer página que não é do app não navegam, nem para a recarga do Vite; só a página em branco é permitida (o Chromium pode trocar o documento do começo)", () => {
    expect(navigationAllowed({ url: dev, isAppWindow: false, devServerUrl: dev })).toBe(false);
    expect(navigationAllowed({ url: "https://example.com/", isAppWindow: false, devServerUrl: dev })).toBe(false);
    expect(navigationAllowed({ url: "app://prism/index.html", isAppWindow: false, devServerUrl: undefined })).toBe(false);
    expect(navigationAllowed({ url: "about:blank#x", isAppWindow: false, devServerUrl: dev })).toBe(false);
    expect(navigationAllowed({ url: "about:blank", isAppWindow: false, devServerUrl: dev })).toBe(true);
    // Uma janela do app nunca vai à página em branco.
    expect(navigationAllowed({ url: "about:blank", isAppWindow: true, devServerUrl: dev })).toBe(false);
  });
});

describe("a janela do resultado (RN-ABAS-017): as opções são do processo principal, com todas as chaves", () => {
  const options = resultWindowOptions({ bounds: { x: 10, y: 20, width: 960, height: 600 }, icon: "/i.png", backgroundColor: "#0E1114" });

  it("nasce escondida, sem janela-mãe, com o mínimo de 480×320 e o título do app até a tela pôr o dela", () => {
    expect(options).toMatchObject({ x: 10, y: 20, width: 960, height: 600, minWidth: 480, minHeight: 320, title: "Prism", show: false, backgroundColor: "#0E1114", icon: "/i.png" });
    expect(options).not.toHaveProperty("parent");
  });

  it("as webPreferences levam todas as chaves de segurança, e nenhum preload", () => {
    expect(options.webPreferences).toEqual({ contextIsolation: true, sandbox: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, webSecurity: true });
    expect(options.webPreferences).not.toHaveProperty("preload");
    expect(Object.keys(resultWindowPreferences).sort()).toEqual(["contextIsolation", "nodeIntegration", "nodeIntegrationInSubFrames", "sandbox", "webSecurity", "webviewTag"]);
  });

  it("sem ícone (macOS), a chave não vai", () => {
    expect(resultWindowOptions({ bounds: { x: 0, y: 0, width: 960, height: 600 }, icon: undefined, backgroundColor: "#000" })).not.toHaveProperty("icon");
  });

  it("a conferência depois de criada: cada chave bate e `preload` falta; qualquer divergência, ou a falta das preferências, fecha a janela", () => {
    const actual = { ...resultWindowPreferences, zoomFactor: 1, backgroundThrottling: true };
    expect(preferencesMatch(actual)).toBe(true);
    expect(preferencesMatch({ ...actual, preload: "" })).toBe(true);

    for (const key of Object.keys(resultWindowPreferences)) {
      expect(preferencesMatch({ ...actual, [key]: !actual[key as keyof typeof actual] })).toBe(false);
      expect(preferencesMatch(Object.fromEntries(Object.entries(actual).filter(([name]) => name !== key)))).toBe(false);
    }
    expect(preferencesMatch({ ...actual, preload: "/x/preload.js" })).toBe(false);
    expect(preferencesMatch(null)).toBe(false);
    expect(preferencesMatch(undefined)).toBe(false);
  });
});

describe("o processo principal trava TODO webContents desde o nascimento (RN-SHELL-001)", () => {
  it("`web-contents-created` nega a navegação, a navegação de quadro, o redirecionamento, o webview e a abertura de janelas", () => {
    const block = /app\.on\("web-contents-created", \(_event, contents\) => \{[\s\S]*?\n\}\);/.exec(main)?.[0] ?? "";

    expect(block).not.toBe("");
    for (const event of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) expect(block).toContain(`"${event}"`);
    expect(block).toMatch(/setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
    expect(block).toContain("navigationAllowed(");
  });
});
