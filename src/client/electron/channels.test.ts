import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");
// O centro das janelas manda os avisos dele pelas janelas que o `main.ts` lhe dá (`window.send`).
const hub = readFileSync(new URL("./window-hub.ts", import.meta.url), "utf8");

/** Os canais (`"prism:..."`) que um arquivo passa à chamada dada, como `ipcMain.handle(` ou `ipcRenderer.invoke(`, sem repetir. */
const channelsOf = (source: string, call: string) => {
  const pattern = new RegExp(`${call.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(\\s*"(prism:[a-z-]+)"`, "g");
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

    // RN-ABAS-010: o fim do arraste da aba (`prism:windows-drag-end`) é o oitavo.
    expect(windowChannels).toContain("prism:windows-drag-end");
    expect(windowChannels.length).toBe(8);
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

  it("o destino e a entrega das exportações de dados (RN-EXPORT-019 e 020): cinco pedidos, sem dígito no nome, cada um confere a origem e passa ao `transferDesk`, que confere o schema e a janela; nenhum devolve aviso à tela", () => {
    const transferChannels = channelsOf(main, "ipcMain.handle").filter((channel) => channel.startsWith("prism:transfer-") && !channel.startsWith("prism:transfer-source"));
    const handlers = [...main.matchAll(/ipcMain\.handle\("(prism:transfer-[a-z-]+)", \(event, request: unknown\) => \{\s*assertFromApp\(event\);\s*(?:return )?transferDesk\.[a-zA-Z]+\((?:windowIdOf\(event\.sender\), )?request\);\s*\}\);/g)].map((match) => match[1]);

    expect(transferChannels).toEqual(["prism:transfer-copy", "prism:transfer-deliver", "prism:transfer-destination", "prism:transfer-release", "prism:transfer-reveal"]);
    expect(handlers.sort()).toEqual(transferChannels);
    // O destino, a entrega, o "Mostrar na pasta" e o soltar são da janela que os pediu: o processo principal passa o número dela, e não o que a tela diz.
    for (const channel of ["prism:transfer-destination", "prism:transfer-deliver", "prism:transfer-reveal", "prism:transfer-release"]) {
      expect(main).toMatch(new RegExp(`ipcMain\\.handle\\("${channel}", \\(event, request: unknown\\) => \\{\\s*assertFromApp\\(event\\);\\s*(?:return )?transferDesk\\.[a-zA-Z]+\\(windowIdOf\\(event\\.sender\\), request\\);`));
    }
    // A ponte só repassa o pedido, sem caminho: cada canal leva um argumento, o objeto que o schema do processo principal confere.
    for (const channel of transferChannels) expect(preload).toMatch(new RegExp(`\\(request\\) => ipcRenderer\\.invoke\\("${channel}", request\\)`));
    expect(channelsOf(main, "webContents.send").some((channel) => channel.startsWith("prism:transfer-"))).toBe(false);
    expect(preload).not.toMatch(/require\(|process\.env|shell\.|fs\./);
  });

  it("o arquivo das importações de dados (RN-IMPORT-018): três pedidos, sem dígito no nome, cada um confere a origem e passa ao `transferSource` com o número da janela; a escolha não recebe nada da tela, e nenhum devolve aviso", () => {
    const sourceChannels = channelsOf(main, "ipcMain.handle").filter((channel) => channel.startsWith("prism:transfer-source"));

    expect(sourceChannels).toEqual(["prism:transfer-source", "prism:transfer-source-release", "prism:transfer-source-status"]);
    for (const channel of sourceChannels) expect(channel).toMatch(/^prism:[a-z-]+$/);
    // A escolha: o diálogo, o título, os filtros e a pasta são do processo principal; a tela manda no máximo o nome da janela do resultado (RN-ABAS-017), que o
    // `transferSource` confere com o schema.
    expect(main).toMatch(/ipcMain\.handle\("prism:transfer-source", \(event, request: unknown\) => \{\s*assertFromApp\(event\);\s*return transferSource\.choose\(windowIdOf\(event\.sender\), request\);\s*\}\);/);
    expect(preload).toMatch(/chooseSource: \(request\) => ipcRenderer\.invoke\("prism:transfer-source", request\)/);
    // A consulta e o soltar levam só o pedido, que o `transferSource` confere com o schema, e o número da janela que o processo principal sabe.
    for (const channel of ["prism:transfer-source-status", "prism:transfer-source-release"]) {
      expect(main).toMatch(new RegExp(`ipcMain\\.handle\\("${channel}", \\(event, request: unknown\\) => \\{\\s*assertFromApp\\(event\\);\\s*return transferSource\\.[a-zA-Z]+\\(windowIdOf\\(event\\.sender\\), request\\);`));
      expect(preload).toMatch(new RegExp(`\\(request\\) => ipcRenderer\\.invoke\\("${channel}", request\\)`));
    }
    // A janela que recarrega, cai ou fecha solta os arquivos dela, e a saída e o reinício do serviço soltam todos.
    expect(main.match(/transferSource\.releaseWindow\(id\)/g)).toHaveLength(3);
    expect(main.match(/transferSource\.releaseAll\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(preload).not.toMatch(/require\(|process\.env|shell\.|fs\./);
  });

  it("a procura e a cópia do DBeaver (RN-DBEAVER-006): dois pedidos, sem dígito no nome, cada um confere a origem e passa ao `dbeaverSource` com o número da janela; nenhum devolve aviso nem leva caminho", () => {
    const dbeaverChannels = channelsOf(main, "ipcMain.handle").filter((channel) => channel.startsWith("prism:dbeaver-"));

    expect(dbeaverChannels).toEqual(["prism:dbeaver-source", "prism:dbeaver-source-release"]);
    for (const channel of dbeaverChannels) expect(channel).toMatch(/^prism:[a-z-]+$/);
    // O pedido leva só o objeto que o schema de `dbeaver-messages.ts` confere (o modo, ou o `sourceId`), e o número da janela é o que o processo principal sabe.
    for (const channel of dbeaverChannels) {
      expect(main).toMatch(new RegExp(`ipcMain\\.handle\\("${channel}", \\(event, request: unknown\\) => \\{\\s*assertFromApp\\(event\\);\\s*return dbeaverSource\\.[a-zA-Z]+\\(windowIdOf\\(event\\.sender\\), request\\);`));
      expect(preload).toMatch(new RegExp(`\\(request\\) => ipcRenderer\\.invoke\\("${channel}", request\\)`));
    }
    expect(channelsOf(main, "webContents.send").some((channel) => channel.startsWith("prism:dbeaver-"))).toBe(false);
    // A janela que recarrega, cai ou fecha solta a cópia dela, e a saída e o reinício do serviço soltam todas.
    expect(main.match(/dbeaverSource\.releaseWindow\(id\)/g)).toHaveLength(3);
    expect(main.match(/dbeaverSource\.releaseAll\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    // A procura abre o diálogo de pasta com os ocultos à vista, e nenhum nome da ponte é de caminho.
    expect(main).toMatch(/properties: \["openDirectory", "showHiddenFiles"\]/);
    expect(preload).not.toMatch(/require\(|process\.env|shell\.|fs\./);
  });

  it("a vez da verificação periódica (RN-VERIF-002): os dois pedidos conferem a origem e passam ao centro das janelas, que os confere com o schema", () => {
    const handlers = [...main.matchAll(/ipcMain\.handle\("(prism:verification-[a-z-]+)", \(([^)]*)\) => \{\s*assertFromApp\(event\);\s*(?:return )?hub\.[a-zA-Z]+Verification\(windowIdOf\(event\.sender\), /g)].map((match) => match[1]);
    const verificationChannels = channelsOf(main, "ipcMain.handle").filter((channel) => channel.startsWith("prism:verification-"));

    expect(verificationChannels).toEqual(["prism:verification-claim", "prism:verification-finish"]);
    expect(handlers.sort()).toEqual(verificationChannels);
    expect(channelsOf(hub, "window.send")).toContain("prism:verification-peer");
  });
});
