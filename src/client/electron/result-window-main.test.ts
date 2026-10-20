import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const preload = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");

/** O bloco que começa em `start` e vai até a chave que fecha na mesma indentação da linha dele. */
function bodyFrom(source: string, start: string): string {
  const at = source.indexOf(start);
  expect(at).toBeGreaterThanOrEqual(0);
  const lineStart = source.lastIndexOf("\n", at) + 1;
  const indent = /^ */.exec(source.slice(lineStart))?.[0] ?? "";
  const end = source.indexOf(`\n${indent}}`, at);
  expect(end).toBeGreaterThan(at);
  return source.slice(at, end + indent.length + 2);
}

describe("os canais da janela do resultado (RN-ABAS-017): cada pedido confere a origem, o schema e a janela da aba de quem pede", () => {
  const requests = ["prism:result-window-request", "prism:result-window-ready", "prism:result-window-focus", "prism:result-window-close", "prism:result-window-title"];

  it.each(requests)("%s: sem dígito no nome, confere a origem primeiro e usa o número da janela que o processo principal sabe", (channel) => {
    expect(channel).toMatch(/^prism:[a-z-]+$/);
    const handler = bodyFrom(main, `ipcMain.handle("${channel}", (event, request: unknown) => {`);

    expect(handler).toMatch(/\{\s*assertFromApp\(event\);/);
    expect(handler).toContain("windowIdOf(event.sender)");
    // O conteúdo é conferido (o pedido, com o schema do `result-window-messages.ts`; os outros, pelo schema no tratador).
    expect(handler).toMatch(/resultWindowNamedSchema\.parse\(request\)|resultWindowFocusSchema\.parse\(request\)|resultWindowTitleSchema\.parse\(request\)|resultWindows\.request\(/);
    // O preload só repassa o pedido.
    expect(preload).toMatch(new RegExp(`\\(request\\) => ipcRenderer\\.invoke\\("${channel}", request\\)`));
  });

  it("os dois avisos que o processo principal manda são ouvidos pela ponte, e o do fechamento leva o motivo", () => {
    expect(main).toContain('send("prism:result-window-closed", closed)');
    expect(main).toContain('send("prism:result-window-state", state)');
    expect(preload).toContain('ipcRenderer.on("prism:result-window-closed"');
    expect(preload).toContain('ipcRenderer.on("prism:result-window-state"');
  });

  it("a ponte não tem como abrir janela nem acessar o Node: só estes sete canais", () => {
    const bridge = bodyFrom(preload, "  resultWindows: {");

    expect(new Set(bridge.match(/"prism:result-window-[a-z]+"/g)).size).toBe(7);
    expect(bridge).not.toMatch(/window\.open|require\(|process\.env|shell\./);
  });
});

describe("a abertura da janela do resultado: só a do pedido, com as opções do processo principal (RN-ABAS-017)", () => {
  it("cada janela do app aprova a abertura pelo `openHandlerOf` e confere a que nasceu em `did-create-window`; a negação total continua para todo `webContents` e para a janela do resultado", () => {
    const create = bodyFrom(main, "function createAppWindow(");

    expect(create).toContain("window.webContents.setWindowOpenHandler(openHandlerOf(id));");
    expect(create).toContain('window.webContents.on("did-create-window", (child, details) => adoptResultWindow(id, window, child, details));');
    expect(main.match(/setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("a aprovação passa tudo o que o Chromium disse à regra pura, e as opções são só as do processo principal (nunca o texto das opções)", () => {
    const handler = bodyFrom(main, "function openHandlerOf(");

    for (const field of ["details.url", "details.frameName", "details.features", "details.disposition", "details.postBody"]) expect(handler).toContain(field);
    expect(handler).toContain("resultWindows.approve(openerId,");
    expect(handler).toContain("resultWindowOptions({ bounds: plan.bounds,");
    expect(handler).not.toMatch(/parent:|features\.split|parseFeatures/);
  });

  it("a janela que nasceu tem as `webPreferences` conferidas (e é destruída se alguma não bate), a negação de aberturas, o zoom ali e no `dom-ready`, e os limites aplicados de novo", () => {
    const adopt = bodyFrom(main, "function adoptResultWindow(");

    expect(adopt).toContain("preferencesMatch(createdPreferences(child, details.options))");
    expect(adopt).toContain("child.destroy()");
    expect(adopt).toContain('contents.setWindowOpenHandler(() => ({ action: "deny" }))');
    expect(adopt).toContain("installShortcuts(contents)");
    expect(adopt).toContain('contents.on("dom-ready", applyZoom)');
    expect(adopt.match(/child\.setBounds\(plan\.bounds\)/g)).toHaveLength(2);
    expect(adopt).toContain("sameRect(child.getBounds(), plan.bounds)");
    // Nasce escondida, e só aparece quando a tela avisa que está pronta, ou depois de 3 segundos.
    expect(adopt).toContain("readyTimeoutMs");
    expect(adopt).toContain("setBackgroundThrottling(false)");
    expect(adopt).toContain("setBackgroundThrottling(true)");
  });

  it("o tratador de uma janela do resultado nunca passa pelas perguntas de fechar a janela, nem pelo centro das janelas nem pela gravação das abas", () => {
    const adopt = bodyFrom(main, "function adoptResultWindow(");

    for (const forbidden of ["closeApproved", "windows-close-requested", "hub.", "workspaceHub", "appWindows.set"]) expect(adopt).not.toContain(forbidden);
    expect(bodyFrom(main, "function showResultWindow(")).not.toContain("hub.");
  });
});

describe("as janelas do resultado não são janelas do app (RN-ABAS-004, 007 e 013)", () => {
  it("o app acaba quando a última janela do app fecha, e quem conta as janelas vivas é a lista `appWindows`, que não tem as do resultado", () => {
    expect(main).toMatch(/app\.on\("window-all-closed", \(\) => app\.quit\(\)\);/);
    expect(bodyFrom(main, "function liveWindowIds(")).toContain("appWindows");
    expect(bodyFrom(main, "function liveWindowIds(")).not.toContain("resultWindows");
    expect(bodyFrom(main, "function liveWindows(")).not.toContain("resultWindows");
    // Só a janela do app entra no centro das janelas (`createMainWindow`, e as que o próprio centro cria).
    expect(main.match(/hub\.add\(/g)).toHaveLength(1);
  });

  it("elas fecham, pelo Prism, quando a janela da aba fecha, recarrega, perde o processo da tela, desmonta a área de trabalho e quando o app sai", () => {
    expect(main.match(/resultWindows\.closeAllByHost\(id\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(bodyFrom(main, 'window.on("closed", () => {')).toContain("resultWindows.closeAllByHost(id)");
    expect(bodyFrom(main, 'window.webContents.on("did-start-navigation"')).toContain("resultWindows.closeAllByHost(id)");
    expect(bodyFrom(main, 'window.webContents.on("render-process-gone"')).toContain("resultWindows.closeAllByHost(id)");
    expect(bodyFrom(main, 'ipcMain.handle("prism:windows-ready"')).toMatch(/ready === false\) resultWindows\.closeAllByHost\(id\)/);
    expect(bodyFrom(main, 'app.on("before-quit"')).toContain("resultWindows.closeByHost(");
  });

  it("o fechamento é contado à janela da aba com o motivo que a lista guardou, e só depois de sair da lista", () => {
    const closed = bodyFrom(main, 'child.on("closed", () => {');

    expect(closed.indexOf("resultWindows.closed(openerId, name)")).toBeGreaterThanOrEqual(0);
    expect(closed.indexOf("resultWindows.closed(openerId, name)")).toBeLessThan(closed.indexOf("tellClosed(openerId, { name, reason })"));
  });

  it("o zoom do programa vale também nelas, e o diálogo do sistema do resultado prende a janela dele (e cai na da aba com nome desconhecido)", () => {
    expect(bodyFrom(main, "function changeZoom(")).toContain("resultWindows.all()");
    const parent = bodyFrom(main, "function dialogParent(");
    expect(parent).toContain("resultWindows.find(windowId, resultWindow)");
    expect(parent).toContain("appWindows.get(windowId)");
    expect(main).toContain("showSaveDialog(windowId, options, resultWindow)");
    expect(main).toContain("showOpenDialog(windowId, options, resultWindow)");
  });
});
