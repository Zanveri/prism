import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
// O centro das janelas manda os avisos dele pelas janelas que o `main.ts` lhe dá (`window.send`).
const hub = readFileSync(new URL("./window-hub.ts", import.meta.url), "utf8");

/** Os canais (`"prism:..."`) que um arquivo passa à chamada dada, como `ipcMain.handle(` ou `ipcRenderer.invoke(`, sem repetir. */
const channelsOf = (source: string, call: string) => {
  const pattern = new RegExp(`${call.replace(/[.()]/g, "\\$&")}\\(\\s*"(prism:[a-z-]+)"`, "g");
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
};

describe("os canais entre a tela e o processo principal", () => {
  it("todo pedido da ponte tem um tratador no processo principal (`ipcMain.handle`), e todo tratador é pedido por ela", () => {
    // `askForApi` repassa o canal a `ipcRenderer.invoke(channel)`: os dois do endereço da API passam por ele.
    const requested = [...new Set([...channelsOf(preload, "ipcRenderer.invoke"), ...channelsOf(preload, "askForApi")])].sort();
    const handled = channelsOf(main, "ipcMain.handle");

    expect(requested.length).toBeGreaterThan(8);
    expect(requested).toEqual(handled);
  });

  it("todo aviso que o processo principal manda (`webContents.send`) é ouvido pela ponte (`ipcRenderer.on`), e vice-versa", () => {
    const sent = [...new Set([...channelsOf(main, "webContents.send"), ...channelsOf(hub, "window.send")])].sort();
    const heard = channelsOf(preload, "ipcRenderer.on");

    expect(sent.length).toBeGreaterThan(2);
    expect(sent).toEqual(heard);
  });

  it("a pasta de dados (RN-CONFIG-001) é um pedido só de leitura: o canal existe nos dois lados, e o processo principal confere a origem antes de responder", () => {
    expect(channelsOf(preload, "ipcRenderer.invoke")).toContain("prism:data-folder");
    expect(main).toMatch(/ipcMain\.handle\("prism:data-folder", \(event\) => \{\s*assertFromApp\(event\);\s*return app\.getPath\("userData"\);\s*\}\);/);
  });

  it("a ponte não oferece como abrir nem escolher pasta: o canal da pasta não recebe argumento da tela", () => {
    expect(preload).toMatch(/getDataFolder: \(\) => ipcRenderer\.invoke\("prism:data-folder"\)/);
    expect(preload).not.toMatch(/openDataFolder|chooseDataFolder|selectFolder|showItemInFolder/);
  });

  it("as janelas (RN-ABAS-005): cada pedido confere a origem e passa o que a tela mandou ao centro, que o confere com o schema; nenhum canal abre arquivo ou endereço", () => {
    const handlers = [...main.matchAll(/ipcMain\.handle\("(prism:(?:windows|session)-[a-z-]+)", \(([^)]*)\) => \{\s*assertFromApp\(event\);/g)].map((match) => match[1]);
    const windowChannels = channelsOf(main, "ipcMain.handle").filter((channel) => /^prism:(windows|session)-/.test(channel));

    expect(windowChannels.length).toBe(7);
    expect(handlers.sort()).toEqual(windowChannels);
    expect(preload).not.toMatch(/require\(|process\.env|shell\.|fs\./);
  });

  it("o zoom do programa (RN-ZOOM-001): os dois pedidos conferem a origem, o pedido de outro zoom só vale com um dos passos, e o aviso vai a todas as janelas", () => {
    expect(channelsOf(main, "ipcMain.handle").filter((channel) => channel.startsWith("prism:zoom-"))).toEqual(["prism:zoom-get", "prism:zoom-set"]);
    expect(main).toMatch(/ipcMain\.handle\("prism:zoom-get", \(event\) => \{\s*assertFromApp\(event\);\s*return appZoom;\s*\}\);/);
    expect(main).toMatch(/ipcMain\.handle\("prism:zoom-set", \(event, zoom: unknown\) => \{\s*assertFromApp\(event\);\s*if \(!isAppZoom\(zoom\)\) throw new Error\([^)]*\);\s*return changeZoom\(zoom\);\s*\}\);/);
    expect(main).toMatch(/for \(const window of liveWindows\(\)\) \{\s*window\.webContents\.setZoomFactor\(zoomFactor\(next\)\);\s*window\.webContents\.send\("prism:zoom-changed", next\);/);
  });

  it("as abas que voltam (RN-ABAS-006): cada pedido confere a origem e passa ao centro da área de trabalho, que confere o relato com o schema", () => {
    const handlers = [...main.matchAll(/ipcMain\.handle\("(prism:workspace-[a-z-]+)", \(([^)]*)\) => \{\s*assertFromApp\(event\);\s*(?:return )?workspaceHub\.[a-zA-Z]+\(/g)].map((match) => match[1]);
    const workspaceChannels = channelsOf(main, "ipcMain.handle").filter((channel) => channel.startsWith("prism:workspace-"));

    expect(workspaceChannels).toEqual(["prism:workspace-claim", "prism:workspace-flush", "prism:workspace-report", "prism:workspace-withdraw"]);
    expect(handlers.sort()).toEqual(workspaceChannels);
  });

  it("a vez da verificação periódica (RN-VERIF-002): os dois pedidos conferem a origem e passam ao centro das janelas, que os confere com o schema", () => {
    const handlers = [...main.matchAll(/ipcMain\.handle\("(prism:verification-[a-z-]+)", \(([^)]*)\) => \{\s*assertFromApp\(event\);\s*(?:return )?hub\.[a-zA-Z]+Verification\(windowIdOf\(event\.sender\), /g)].map((match) => match[1]);
    const verificationChannels = channelsOf(main, "ipcMain.handle").filter((channel) => channel.startsWith("prism:verification-"));

    expect(verificationChannels).toEqual(["prism:verification-claim", "prism:verification-finish"]);
    expect(handlers.sort()).toEqual(verificationChannels);
    expect(channelsOf(hub, "window.send")).toContain("prism:verification-peer");
  });
});
