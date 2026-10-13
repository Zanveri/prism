import { app, BrowserWindow, ipcMain, Menu, net, protocol, screen, session, shell, type IpcMainInvokeEvent, type WebContents } from "electron";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { apiExecutable } from "../scripts/api-layout.mjs";
import { apiExitMessage, closeVaultAndStop, startApi, type ApiProcess } from "./api-process";
import { versionArgument, windowArgument } from "./app-version";
import { userDataDir } from "./data-dir";
import { permissionAllowed } from "./permissions";
import { applicationMenuTemplate, windowIconFile } from "./platform";
import type { ApiConfigReply } from "./preload";
import { createSplash } from "./splash";
import { startUp } from "./startup";
import { createHttpGet } from "./update/net-transport";
import { resolveOrigin, updatesBlocked } from "./update/origin";
import { createUpdater, type Updater } from "./update/updater";
import { createWindowHub, newWindowBounds, type HubWindow, type Rect } from "./window-hub";
import { createWorkspaceHub, saveWorkspaceThroughApi } from "./workspace-hub";
import type { SavedWorkspace } from "./workspace-messages";

// A pasta de dados tem de ser fixada antes de qualquer leitura de `userData`, do `requestSingleInstanceLock` (que
// a usa) e do `whenReady`: `%APPDATA%\Zanveri\Prism` empacotado e `%APPDATA%\Zanveri\Prism-dev` em desenvolvimento (`data-dir.ts`).
app.setPath("userData", userDataDir({ isPackaged: app.isPackaged, userDataSwitch: app.commandLine.getSwitchValue("user-data-dir"), appData: app.getPath("appData") }));

/**
 * A tela tem uma origem de verdade nos dois modos (seção 3.1 da especificação): o servidor do
 * Vite em desenvolvimento e `app://prism` no app construído. É ela que vai em
 * `PRISM_ALLOWED_ORIGIN`. `file://` não serve: a origem dele é nula.
 */
const appOrigin = "app://prism";
// Só fora do pacote. No app empacotado a variável é ignorada: quem a definisse faria a janela
// carregar outra origem com o preload, e essa origem receberia o token (RN-SHELL-001).
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const rendererOrigin = devServerUrl === undefined ? appOrigin : new URL(devServerUrl).origin;

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/**
 * O ícone do aplicativo (RN-MARCA-001), o mesmo na janela principal e no splash. No Windows é o `.ico`, e não
 * o PNG: ele escolhe dele a entrada do tamanho que precisa, e até 32 px (barra de título,
 * barra de tarefas) essa é a de traço mais grosso, não a grande reduzida. No Linux é o PNG de 512 px. No macOS não há:
 * o ícone é o do pacote. Empacotado, o `electron-builder` copia o arquivo de `build/` para `resources/` (`extraResources`).
 */
const iconFile = windowIconFile(process.platform);
const iconPath = iconFile === undefined ? undefined : app.isPackaged ? join(process.resourcesPath, iconFile) : join(__dirname, "../../build", iconFile);

/**
 * As janelas do app (RN-ABAS-002 a 005), pelo número que o app dá a cada uma (o splash não é uma delas). A primeira é a da abertura; as outras nascem
 * quando uma aba sai para uma janela nova, e só aqui (`hub`). Todas falam com a mesma API, com o mesmo token, e abrem o mesmo cofre.
 */
const appWindows = new Map<number, BrowserWindow>();
let lastWindowId = 0;

/** As janelas que a pessoa fechou e cuja tela já fechou as abas (ou não tinha o que perguntar): o `close` delas passa. */
const closeApproved = new Set<number>();

/** As janelas ainda vivas, para os avisos que vão a todas (a API saiu, o estado da atualização). */
function liveWindows(): BrowserWindow[] {
  return [...appWindows.values()].filter((window) => !window.isDestroyed());
}

/** Os números das janelas vivas, em ordem de abertura: a primeira é a janela principal (RN-ABAS-006). */
function liveWindowIds(): number[] {
  return [...appWindows.entries()].filter(([, window]) => !window.isDestroyed()).map(([id]) => id).sort((a, b) => a - b);
}

/** A janela de quem fez o pedido. */
function windowIdOf(sender: WebContents): number {
  for (const [id, window] of appWindows) if (!window.isDestroyed() && window.webContents === sender) return id;
  throw new Error("Pedido de uma janela desconhecida.");
}

/**
 * Toda saída passa por `before-quit` (ver o fim do arquivo); depois da primeira tentativa, fechar uma janela não pergunta mais nada: o app
 * está saindo.
 */
let quitting: "no" | "closing" | "ready" = "no";

/** A API em uso. Trocar ou zerar esta referência antes de parar é o que distingue "parei" de "caiu". */
let api: Promise<ApiProcess> | null = null;

function launchApi() {
  const launched = startApi({
    // Empacotada, a API vai ao lado do app. Em desenvolvimento ela é compilada e iniciada pelo
    // `dotnet run`; `__dirname` é `out/main`, de onde `src/api` fica três níveis acima.
    // `--artifacts-path` leva `bin` e `obj` desta execução para `src/client/.api-dev`: sem ele a API
    // roda a partir de `src/api/**/bin` e prende os DLL, e um `dotnet build` de quem trabalha na API
    // falha (MSB3021) enquanto o app estiver aberto.
    ...(app.isPackaged
      ? { command: join(process.resourcesPath, "api", apiExecutable(process.platform)), args: [] }
      : { command: "dotnet", args: ["run", "--project", join(__dirname, "../../../api/Prism.Api"), "--no-launch-profile", "--artifacts-path", join(__dirname, "../../.api-dev")] }),
    dataDir: app.getPath("userData"),
    allowedOrigin: rendererOrigin,
  });
  api = launched;

  launched.then(
    (running) => {
      console.log(`[prism] API pronta na porta ${new URL(running.baseUrl).port}`);
      running.onExit((code, stoppedByApp) => {
        console.log(`[prism] ${apiExitMessage(code, stoppedByApp)}`);
        // Parada de propósito (reiniciar, fechar): quem parou já trocou a referência.
        if (api !== launched) return;

        // Quem perguntar depois — a tela recarregada, por exemplo — recebe o motivo, e não o
        // endereço de uma API que já não existe.
        api = Promise.reject(new Error(`O processo da API foi encerrado (código ${code}).`));
        api.catch(() => undefined);
        for (const window of liveWindows()) window.webContents.send("prism:api-exit");
      });
    },
    (error: Error) => console.log(`[prism] API não iniciou: ${error.message}`),
  );

  return launched;
}

/**
 * Para a API em uso. Se ela ainda está iniciando, espera a partida terminar (no máximo o prazo
 * dela) para ter o que parar. `stop` é o que fazer com a que está em execução: só parar, ao
 * reiniciar; fechar o cofre antes, ao sair do app.
 */
async function stopApi(stop: (running: ApiProcess) => Promise<void> = (running) => running.stop()) {
  const current = api;
  api = null;
  if (current !== null) await current.then(stop, () => undefined);
}

async function describeApi(): Promise<ApiConfigReply> {
  try {
    if (api === null) throw new Error("A API do Prism não está em execução.");

    const { baseUrl, token } = await api;
    return { ok: true, baseUrl, token };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** O prazo da gravação das abas: a API local que não responde em 5 s não vai responder, e sair do app não espera mais que isso. */
const workspaceSaveTimeoutMs = 5000;

/**
 * Grava as abas de todas as janelas pela API em uso (RN-ABAS-006). Sem API, ou com o cofre fechado (401), não grava, e nada aparece na tela: o log leva o
 * status, nunca o conteúdo (o SQL das abas é dado do usuário, RN-LOG-001).
 */
async function saveWorkspace(workspace: SavedWorkspace): Promise<boolean> {
  const running = api === null ? null : await api.then((value) => value, () => null);
  if (running === null) return false;

  const { ok, outcome } = await saveWorkspaceThroughApi(running, workspace, { fetch: (url, init) => fetch(url, init), timeoutMs: workspaceSaveTimeoutMs });
  if (!ok) console.log(`[prism] abas: a gravação não valeu: ${outcome}`);
  return ok;
}

/**
 * As abas que voltam na próxima entrada (`workspace-hub.ts`): cada janela conta as dela, e este processo as junta e as grava pela API alguns segundos depois de
 * cada mudança, na hora quando uma aba ou uma janela fecha, e antes de o cofre fechar (o "Sair" e o bloqueio pedem pela ponte; ao sair do app, o
 * `before-quit`).
 */
const workspaceHub = createWorkspaceHub({
  save: saveWorkspace,
  schedule(run, ms) {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  liveWindows: liveWindowIds,
  log: (message) => console.log(`[prism] abas: ${message}`),
});

/** O token só sai para a tela do próprio app, mesmo que outro conteúdo chegue a ser carregado na janela. */
function assertFromApp(event: IpcMainInvokeEvent) {
  if (event.senderFrame?.url.startsWith(`${rendererOrigin}/`) !== true) throw new Error("Pedido de origem desconhecida.");
}

ipcMain.handle("prism:api-config", (event) => {
  assertFromApp(event);
  return describeApi();
});

ipcMain.handle("prism:api-restart", async (event) => {
  assertFromApp(event);
  await stopApi();
  launchApi();
  // A API nova tem outro token e o cofre fechado: as outras janelas, que mostram "Reiniciar" com a mesma falha, recarregam e pedem o endereço de
  // novo. Sem isso, o "Reiniciar" de cada uma derrubaria a API que a primeira acabou de subir.
  for (const window of liveWindows()) if (window.webContents !== event.sender) window.webContents.reload();
  return describeApi();
});

/**
 * A pasta de dados em uso (os cofres e o log da API), só para leitura: a tela a mostra em Configurações > Sobre. Não recebe nada da tela e não
 * abre nem troca pasta nenhuma. O caminho não é segredo: a linha "pasta de dados" do log, na abertura, já o escreve.
 */
ipcMain.handle("prism:data-folder", (event) => {
  assertFromApp(event);
  return app.getPath("userData");
});

/**
 * As atualizações (seção 17 da especificação). Quem fala com a rede, grava e executa é este processo; a tela só pede
 * "consulte", "baixe", "instale" ou "pule" a versão que a última consulta daqui achou, e recebe o estado como dado
 * (`update/updater.ts`, que confere cada argumento). Nenhum canal aceita endereço, caminho ou nome de arquivo.
 */
let updater: Updater | null = null;

function startUpdater() {
  // A origem gravada pelo `dist` está no `package.json` DENTRO do pacote (RN-ATUALIZA-001); em desenvolvimento ele não a tem.
  let metadata: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(app.getAppPath(), "package.json"), "utf8"));
    if (typeof parsed === "object" && parsed !== null) metadata = parsed as Record<string, unknown>;
  } catch {
    // Sem o arquivo, sem origem.
  }
  const { origin, problem } = resolveOrigin({ isPackaged: app.isPackaged, metadata, env: process.env });
  if (problem !== undefined) console.log(`[prism] atualização: origem ignorada: ${problem}`);
  // RN-ATUALIZA-008: aberto com um argumento que dispensa a conferência do certificado ou troca o endereço dos servidores, o
  // app empacotado fica sem atualizador nesta abertura.
  const blocked = updatesBlocked({ isPackaged: app.isPackaged, hasSwitch: (name) => app.commandLine.hasSwitch(name) });

  const linux = process.platform === "linux";
  updater = createUpdater({
    origin,
    blocked,
    currentVersion: app.getVersion(),
    // O formato da instalação em uso (RN-ATUALIZA-006): o AppImage define `APPIMAGE`; o dpkg guarda a lista de arquivos do
    // pacote `prism` (o `packageName` do `electron-builder.yml`); no Windows, o instalador deixa o desinstalador ao lado do
    // executável (`Uninstall <executável>`), e quem roda do zip portátil não o tem.
    facts: {
      platform: process.platform,
      arch: process.arch,
      appImage: linux && (process.env.APPIMAGE ?? "") !== "",
      execPath: process.execPath,
      debInstalled: linux && existsSync("/var/lib/dpkg/info/prism.list"),
      hasRpm: linux && (existsSync("/usr/bin/rpm") || existsSync("/bin/rpm")),
      nsisInstalled: process.platform === "win32" && existsSync(join(dirname(process.execPath), `Uninstall ${basename(process.execPath)}`)),
    },
    dataDir: app.getPath("userData"),
    downloadsDir: app.getPath("downloads"),
    // Uma sessão só do atualizador, em memória: sem os cookies nem o cache da janela (RN-ATUALIZA-008).
    http: createHttpGet(session.fromPartition("prism-update"), `Prism/${app.getVersion()}`),
    now: () => new Date(),
    log: (message) => console.log(`[prism] ${message}`),
    spawn: (command, args, options) => spawn(command, args, options),
    // Antes de o instalador rodar: o mesmo fechamento do `before-quit` (grava as abas, fecha o cofre e para a API), que só volta quando o
    // processo da API terminou. O instalador desinstala a versão antiga, e a API viva seguraria os arquivos dela.
    stopApi: () => workspaceHub.flush().then(() => stopApi((running) => closeVaultAndStop(running, (message) => console.log(`[prism] ${message}`)))),
    // O caminho normal de saída. No caminho de instalar a API já parou, e o `before-quit` não tem o que esperar.
    quit: () => app.quit(),
    reveal: (path) => shell.showItemInFolder(path),
    onState(state) {
      for (const window of liveWindows()) window.webContents.send("prism:update-changed", state);
    },
    // O avanço do download vai num canal só dele, com três números: o estado inteiro (com as notas) não é reenviado.
    onProgress(progress) {
      for (const window of liveWindows()) window.webContents.send("prism:update-progress", progress);
    },
  });

  // RN-ATUALIZA-002: não segura a abertura, e a falha só vai para o log. A tela pega o estado quando monta.
  updater.checkOnStartup().catch((error: unknown) => console.log(`[prism] atualização: a consulta ao abrir falhou: ${error instanceof Error ? error.message : String(error)}`));
}

/** Como os demais canais, só para a tela do próprio app. O atualizador nasce antes da janela. */
function updates(event: IpcMainInvokeEvent) {
  assertFromApp(event);
  if (updater === null) throw new Error("O atualizador ainda não está pronto.");

  return updater;
}

ipcMain.handle("prism:update-state", (event) => updates(event).state());
ipcMain.handle("prism:update-check", (event) => updates(event).check());
ipcMain.handle("prism:update-download", (event, version: unknown) => updates(event).download(version));
ipcMain.handle("prism:update-cancel", (event) => updates(event).cancel());
ipcMain.handle("prism:update-install", async (event, version: unknown) => {
  const result = await updates(event).install(version);
  // A instalação para a API antes de rodar o instalador. Se ela não foi adiante (o instalador não iniciou), o app continua
  // aberto sem API: a tela é avisada, mostra o erro com "Reiniciar", e o diálogo da atualização diz o que falhou.
  if (result.status === "failed" && api === null) for (const window of liveWindows()) window.webContents.send("prism:api-exit");
  return result;
});
ipcMain.handle("prism:update-preferences", (event) => updates(event).preferences());
ipcMain.handle("prism:update-check-on-startup", (event, value: unknown) => updates(event).setCheckOnStartup(value));
ipcMain.handle("prism:update-receive-beta", (event, value: unknown) => updates(event).setReceiveBeta(value));
ipcMain.handle("prism:update-skip", (event, version: unknown) => updates(event).skipVersion(version));

/** Entrega os arquivos de `out/renderer` em `app://prism/`, e nada de fora dessa pasta. */
function serveRenderer() {
  const root = join(__dirname, "../renderer");

  protocol.handle("app", (request) => {
    const { host, pathname } = new URL(request.url);
    const file = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (host !== "prism" || !file.startsWith(root + sep)) return new Response(null, { status: 404 });

    return net.fetch(pathToFileURL(file).toString());
  });
}

/**
 * O centro das janelas (`window-hub.ts`): leva as abas de uma janela para outra e repassa o que uma conta às outras sobre o cofre. A janela nova
 * (a área de trabalho inteira, RN-ABAS-002) nasce aqui, onde a aba foi solta, e aparece quando a tela dela está pronta.
 */
const hub = createWindowHub({
  createWindow({ at, source }) {
    const display = at !== null ? screen.getDisplayNearestPoint(at) : source !== null ? screen.getDisplayMatching(source) : screen.getPrimaryDisplay();
    const created = createAppWindow(newWindowBounds({ at, source, workArea: display.workArea }));
    void created.whenReadyToShow().then(() => created.show());
    return created.hubWindow;
  },
  log: (message) => console.log(`[prism] janelas: ${message}`),
});

/**
 * Cria uma janela do app escondida: quem decide quando ela aparece é quem a pediu (a primeira, `startUp`, depois de a tela estar pronta para ser
 * vista, RN-MARCA-003; as outras, assim que estão prontas). Sem `bounds`, o tamanho de sempre, no centro da tela.
 */
function createAppWindow(bounds?: Rect) {
  const id = ++lastWindowId;
  const window = new BrowserWindow({
    ...(bounds ?? { width: 1440, height: 900 }),
    minWidth: 1024,
    minHeight: 700,
    title: "Prism",
    icon: iconPath,
    show: false,
    backgroundColor: "#0E1114",
    // RN-SHELL-001.
    // A versão (RN-VERSAO-004) e o número da janela (RN-ABAS-003) vão como argumentos: o preload os lê em `process.argv` (`app-version.ts`).
    webPreferences: { preload: join(__dirname, "../preload/preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, additionalArguments: [versionArgument(app.getVersion()), windowArgument(id)] },
  });
  appWindows.set(id, window);

  // RN-SHELL-001: a janela não sai do app nem abre outra. As rotas são em hash, que não navega.
  // Em desenvolvimento passa uma única navegação, a recarga da própria página: é como o Vite
  // mostra uma mudança no código, e cancelada ela deixaria a tela parada na versão anterior.
  window.webContents.on("will-navigate", (event, url) => {
    if (devServerUrl === undefined || url.split("#")[0] !== new URL(devServerUrl).href) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // A página que recarrega (ou cujo processo caiu) desmonta a área de trabalho sem avisar: ela deixa de estar pronta para receber abas, e fechar a
  // janela deixa de perguntar até ela montar de novo.
  window.webContents.on("did-start-navigation", (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    hub.setReady(id, false);
    workspaceHub.withdraw(id);
  });
  window.webContents.on("render-process-gone", () => {
    hub.setReady(id, false);
    workspaceHub.withdraw(id);
  });

  // RN-ABAS-004: fechar a janela fecha as abas dela, com as perguntas de fechar cada uma. Quem pergunta é a tela; quando as abas fecharam, ela pede
  // `prism:windows-close` e o fechamento passa. Sem área de trabalho montada (o login, a tela recarregando) e com o app saindo, fecha direto.
  window.on("close", (event) => {
    if (quitting !== "no" || closeApproved.has(id) || !hub.isReady(id)) return;

    event.preventDefault();
    window.webContents.send("prism:windows-close-requested");
  });

  window.on("closed", () => {
    appWindows.delete(id);
    closeApproved.delete(id);
    hub.remove(id);
    // RN-ABAS-006: a última janela (ou qualquer uma, com o app saindo) leva as abas para a gravação de antes de sair; as outras as tiram do que volta.
    workspaceHub.windowClosed(id, { last: quitting !== "no" || liveWindowIds().length === 0 });
  });

  // Mostrar a janela quando a página falha ao carregar também: com ela escondida, o app ficaria
  // aberto sem nada na tela, e o splash, que só fecha depois, não sairia.
  const ready = new Promise<void>((resolve) => {
    window.once("ready-to-show", resolve);
    window.webContents.once("did-fail-load", () => resolve());
    window.once("closed", resolve);
  });

  void window.loadURL(devServerUrl ?? `${appOrigin}/index.html`);
  console.log(`[prism] janela ${id} criada`);

  const hubWindow: HubWindow = {
    id,
    send(channel, payload) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload);
    },
    bounds: () => window.getBounds(),
    focus() {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.focus();
    },
  };

  return {
    hubWindow,
    whenReadyToShow: () => ready,
    show() {
      if (!window.isDestroyed()) window.show();
    },
  };
}

/** A janela da abertura: a primeira do centro das janelas. */
function createMainWindow() {
  const created = createAppWindow();
  hub.add(created.hubWindow);
  return created;
}

/** O que a tela pede sobre as janelas (RN-ABAS-002 a 005): cada pedido confere a origem, e o centro confere o conteúdo com o schema. */
ipcMain.handle("prism:windows-list", (event) => {
  assertFromApp(event);
  return hub.list(windowIdOf(event.sender));
});
ipcMain.handle("prism:windows-move-tab", (event, request: unknown) => {
  assertFromApp(event);
  return hub.moveTab(windowIdOf(event.sender), request);
});
ipcMain.handle("prism:windows-request-tab", (event, request: unknown) => {
  assertFromApp(event);
  return hub.requestTab(windowIdOf(event.sender), request);
});
ipcMain.handle("prism:windows-ready", (event, ready: unknown) => {
  assertFromApp(event);
  hub.setReady(windowIdOf(event.sender), ready);
});
ipcMain.handle("prism:windows-describe", (event, summary: unknown) => {
  assertFromApp(event);
  hub.describe(windowIdOf(event.sender), summary);
});
ipcMain.handle("prism:windows-close", (event) => {
  assertFromApp(event);
  const id = windowIdOf(event.sender);
  closeApproved.add(id);
  appWindows.get(id)?.close();
});
// RN-ABAS-006: as abas de cada janela, que este processo junta e grava pela API. Cada pedido confere a origem, e o centro confere o conteúdo com o schema.
ipcMain.handle("prism:workspace-claim", (event) => {
  assertFromApp(event);
  return workspaceHub.claim(windowIdOf(event.sender));
});
ipcMain.handle("prism:workspace-report", (event, report: unknown) => {
  assertFromApp(event);
  workspaceHub.report(windowIdOf(event.sender), report);
});
ipcMain.handle("prism:workspace-withdraw", (event) => {
  assertFromApp(event);
  workspaceHub.withdraw(windowIdOf(event.sender));
});
ipcMain.handle("prism:workspace-flush", (event) => {
  assertFromApp(event);
  return workspaceHub.flush();
});
// RN-ABAS-004: o bloqueio, o desbloqueio, o "Sair", o login e a atividade de uma janela valem para as outras. Aqui só se repassa.
ipcMain.handle("prism:session-share", (event, peerEvent: unknown) => {
  assertFromApp(event);
  hub.share(windowIdOf(event.sender), peerEvent);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = liveWindows();
    if (window === undefined) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  // Sem o menu padrão do Electron no app empacotado: o Ctrl+R dele recarrega a janela, e o texto
  // das abas de SQL, que nesta fatia não é salvo, se perderia. No macOS fica só o mínimo do sistema
  // (`platform.ts`). Em desenvolvimento o menu padrão fica.
  if (app.isPackaged) {
    const template = applicationMenuTemplate(process.platform);
    Menu.setApplicationMenu(template === null ? null : Menu.buildFromTemplate(template));
  }

  // Fechou a última janela, o app acaba.
  app.on("window-all-closed", () => app.quit());

  // Toda saída passa por aqui, a da última janela fechada e a do menu: a primeira tentativa é
  // segurada até o cofre fechar e a API parar (RN-COFRE-008), e a segunda sai de verdade. Se o
  // Electron morrer sem passar por aqui, a API encerra sozinha por `PRISM_PARENT_PID` (RN-API-004).
  app.on("before-quit", (event) => {
    if (quitting === "ready") return;

    event.preventDefault();
    if (quitting === "closing") return;

    quitting = "closing";
    // RN-ABAS-006: as abas de todas as janelas são gravadas antes de o cofre fechar.
    void workspaceHub
      .flush()
      .then(() => stopApi((running) => closeVaultAndStop(running, (message) => console.log(`[prism] ${message}`))))
      .finally(() => {
        quitting = "ready";
        app.quit();
      });
  });

  void app.whenReady().then(() => {
    // O Windows agrupa a barra de tarefas e guarda o ícone fixado por este identificador.
    app.setAppUserModelId("com.zanveri.prism");
    // O caminho não é segredo; quem confere onde o app guarda os cofres lê esta linha.
    console.log(`[prism] pasta de dados: ${app.getPath("userData")}`);
    if (devServerUrl === undefined) serveRenderer();
    // RN-SHELL-001 e RN-CONFIG-008: a tela só tem as permissões que usa (copiar, colar, ler as fontes do sistema), e só na origem dela.
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => callback(permissionAllowed(permission, details.requestingUrl, rendererOrigin)));
    session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) => permissionAllowed(permission, requestingOrigin, rendererOrigin));
    // O atualizador nunca impede o app de abrir: se ele não nascer, só não há atualização nesta abertura.
    try {
      startUpdater();
    } catch (error) {
      console.log(`[prism] atualização: o atualizador não iniciou: ${error instanceof Error ? error.message : String(error)}`);
    }

    // RN-MARCA-002 a 004. A falha da API já foi para o log em `launchApi`, e a janela principal
    // mostra o motivo com "Reiniciar"; um erro de outra parte da abertura vai para o log também.
    return startUp({
      showSplash: () => createSplash({ iconPath, version: app.getVersion() }),
      startApi: launchApi,
      createMainWindow,
    });
  }).catch((error: unknown) => console.log(`[prism] abertura falhou: ${error instanceof Error ? error.message : String(error)}`));
}
