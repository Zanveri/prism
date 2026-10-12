import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");

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
    const sent = channelsOf(main, "webContents.send");
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
});
