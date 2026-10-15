import { contextBridge, ipcRenderer } from "electron";

import { versionFromArgv, windowIdFromArgv } from "./app-version";
import type { UpdatePreferences } from "./update/preferences";
import type { CheckOutcome, UpdateNotice, UpdateProgress, UpdateState } from "./update/update-state";
import type { PeerEvent, TabMoveRequest, TabRequest, WindowSummary } from "./window-messages";
import type { WorkspaceReport } from "./workspace-messages";

/**
 * A fronteira de confiança do app (decisão 5 da seção 8 da especificação): o endereço e o token
 * da API, o aviso de que ela saiu, o pedido para reiniciá-la, a versão do app (RN-VERSAO-004) e a
 * pasta de dados em uso (só leitura). É tudo o que a tela recebe do processo principal, mais as
 * atualizações (`updates`), as janelas (`windows`), o que as outras janelas contam do cofre (`session`) e as abas que voltam na próxima entrada
 * (`workspace`).
 */
export type PrismBridge = {
  getApiConfig(): Promise<{ baseUrl: string; token: string }>;
  onApiExit(listener: () => void): () => void;
  restartApi(): Promise<void>;
  /** O `version` do `package.json`, como o processo principal a pôs na janela (`app-version.ts`). Vazia se não veio. */
  version: string;
  /**
   * A pasta de dados em uso (os cofres e o log da API), como o processo principal a diz: um caminho absoluto, só para a tela mostrar. Não há como abrir
   * nem escolher pasta por aqui. `null` onde não há processo principal (a tela aberta fora do Electron).
   */
  getDataFolder(): Promise<string | null>;
  updates: PrismUpdates;
  windows: PrismWindows;
  session: PrismSession;
  workspace: PrismWorkspace;
};

/**
 * As abas que voltam na próxima entrada (RN-ABAS-006). Cada janela conta as abas dela ao processo principal, que junta as de todas e as grava pela API, no
 * cofre do usuário; nenhuma janela fala com outra (RN-ABAS-005). O processo principal confere cada relato com o schema de `workspace-messages.ts`. Nada aqui dá
 * acesso a arquivo nem a endereço.
 */
export type PrismWorkspace = {
  /** A área de trabalho desta janela montou: ela reabre as abas gravadas? Só a janela principal, uma vez por entrada. */
  claim(): Promise<boolean>;
  /** As abas desta janela agora; `urgent`, uma aba fechou e a gravação é na hora. */
  report(report: WorkspaceReport): Promise<void>;
  /** A área de trabalho desta janela desmontou (saiu do cofre): as abas dela deixam de contar. */
  withdraw(): Promise<void>;
  /** Grava agora o que as janelas contaram, e espera: é o que vem antes de o cofre fechar. */
  flush(): Promise<void>;
};

/**
 * As janelas (RN-ABAS-002 a 005). Só o processo principal cria janela e passa aba de uma para outra; a tela pede e recebe por aqui, e nenhuma
 * janela fala com outra. O processo principal confere cada pedido com o schema de `window-messages.ts`, e o que chega à tela (as respostas e os
 * avisos, aqui sem tipo) a tela confere de novo com o mesmo schema. Nada aqui dá acesso ao Node, a arquivo ou a endereço.
 */
export type PrismWindows = {
  /** O número desta janela, posto pelo processo principal nos argumentos dela; `null` se não veio. */
  id: number | null;
  /** As outras janelas abertas (`windowListSchema`). */
  list(): Promise<unknown>;
  /** Leva uma aba desta janela para outra, ou para uma nova (`TabMoveReply`). Com `ok`, a aba sai daqui sem fechar a sessão. */
  moveTab(request: TabMoveRequest): Promise<unknown>;
  /** Uma aba de outra janela foi solta na faixa desta: o processo principal pede à de origem que a mande. */
  requestTab(request: TabRequest): Promise<unknown>;
  /** A área de trabalho desta janela montou (pronta para receber abas) ou desmontou. */
  setReady(ready: boolean): Promise<void>;
  /** O resumo desta janela, para a lista das outras. */
  describe(summary: WindowSummary): Promise<void>;
  /** As abas desta janela já fecharam (ou não havia o que perguntar): a janela fecha de verdade. */
  close(): Promise<void>;
  /** Uma aba chegou (`tabDeliverySchema`). */
  onTab(listener: (delivery: unknown) => void): () => void;
  /** O processo principal pede que esta janela mande uma aba para outra (`tabGiveSchema`): ela foi solta na faixa de lá. */
  onGiveTab(listener: (request: unknown) => void): () => void;
  /**
   * A pessoa fechou a janela: a tela fecha as abas, com as perguntas de sempre, e então chama `close`. O aviso diz se ela é a última (`windowCloseRequestSchema`):
   * fechar o app só pergunta pelo que não volta na próxima entrada (RN-ABAS-007).
   */
  onCloseRequested(listener: (request: unknown) => void): () => void;
};

/** O cofre é um só para todas as janelas (RN-ABAS-004): o que uma janela conta às outras, e o que as outras contaram (`peerEventSchema`). */
export type PrismSession = {
  share(event: PeerEvent): Promise<void>;
  onPeer(listener: (event: unknown) => void): () => void;
};

/**
 * As atualizações (seção 17 da especificação): só ações e dados. A tela nunca passa endereço, caminho nem nome de arquivo:
 * `download`, `install` e `skipVersion` levam a versão que a última consulta do processo principal achou, e ele a confere
 * (um pedido recusado rejeita a promessa). O estado (nada, há versão nova com as notas, baixando, pronta, entregue, falhou
 * com a causa) mora lá; aqui ele só chega.
 */
export type PrismUpdates = {
  getState(): Promise<UpdateState>;
  onState(listener: (state: UpdateState) => void): () => void;
  /** O avanço do download, só com os números: o estado `downloading` inteiro chega uma vez, por `onState`. */
  onProgress(listener: (progress: UpdateProgress) => void): () => void;
  /** "Verificar atualizações": o resultado sempre volta, inclusive "atualizado", "sem origem" e a falha. */
  check(): Promise<CheckOutcome>;
  download(version: string): Promise<UpdateState>;
  cancel(): Promise<void>;
  install(version: string): Promise<UpdateState>;
  getPreferences(): Promise<UpdatePreferences>;
  setCheckOnStartup(value: boolean): Promise<UpdatePreferences>;
  /** "Receber versões beta" (RN-ATUALIZA-010): só grava; vale a partir da próxima consulta. */
  setReceiveBeta(value: boolean): Promise<UpdatePreferences>;
  skipVersion(version: string): Promise<UpdatePreferences>;
  /** A atualização do Windows que não foi instalada (RN-INSTALA-003), uma vez por abertura: a primeira janela que pede a leva. */
  takeNotice(): Promise<UpdateNotice | null>;
};

/** O que o processo principal responde aos dois pedidos. Falha vem como dado, não como exceção. */
export type ApiConfigReply = { ok: true; baseUrl: string; token: string } | { ok: false; message: string };

/**
 * Uma exceção lançada dentro de `ipcMain.handle` chega aqui com o prefixo "Error invoking remote
 * method…". A resposta em dado deixa a tela mostrar só o motivo.
 */
async function askForApi(channel: "prism:api-config" | "prism:api-restart") {
  const reply = (await ipcRenderer.invoke(channel)) as ApiConfigReply;
  if (!reply.ok) throw new Error(reply.message);

  return { baseUrl: reply.baseUrl, token: reply.token };
}

const bridge: PrismBridge = {
  getApiConfig: () => askForApi("prism:api-config"),
  onApiExit(listener) {
    const handler = () => listener();
    ipcRenderer.on("prism:api-exit", handler);
    return () => ipcRenderer.removeListener("prism:api-exit", handler);
  },
  async restartApi() {
    await askForApi("prism:api-restart");
  },
  version: versionFromArgv(process.argv),
  getDataFolder: () => ipcRenderer.invoke("prism:data-folder"),
  updates: {
    getState: () => ipcRenderer.invoke("prism:update-state"),
    onState(listener) {
      const handler = (_event: unknown, state: UpdateState) => listener(state);
      ipcRenderer.on("prism:update-changed", handler);
      return () => ipcRenderer.removeListener("prism:update-changed", handler);
    },
    onProgress(listener) {
      const handler = (_event: unknown, progress: UpdateProgress) => listener(progress);
      ipcRenderer.on("prism:update-progress", handler);
      return () => ipcRenderer.removeListener("prism:update-progress", handler);
    },
    check: () => ipcRenderer.invoke("prism:update-check"),
    download: (version) => ipcRenderer.invoke("prism:update-download", version),
    cancel: () => ipcRenderer.invoke("prism:update-cancel"),
    install: (version) => ipcRenderer.invoke("prism:update-install", version),
    getPreferences: () => ipcRenderer.invoke("prism:update-preferences"),
    setCheckOnStartup: (value) => ipcRenderer.invoke("prism:update-check-on-startup", value),
    setReceiveBeta: (value) => ipcRenderer.invoke("prism:update-receive-beta", value),
    skipVersion: (version) => ipcRenderer.invoke("prism:update-skip", version),
    takeNotice: () => ipcRenderer.invoke("prism:update-notice"),
  },
  windows: {
    id: windowIdFromArgv(process.argv),
    list: () => ipcRenderer.invoke("prism:windows-list"),
    moveTab: (request) => ipcRenderer.invoke("prism:windows-move-tab", request),
    requestTab: (request) => ipcRenderer.invoke("prism:windows-request-tab", request),
    setReady: (ready) => ipcRenderer.invoke("prism:windows-ready", ready),
    describe: (summary) => ipcRenderer.invoke("prism:windows-describe", summary),
    close: () => ipcRenderer.invoke("prism:windows-close"),
    onTab(listener) {
      const handler = (_event: unknown, delivery: unknown) => listener(delivery);
      ipcRenderer.on("prism:windows-tab", handler);
      return () => ipcRenderer.removeListener("prism:windows-tab", handler);
    },
    onGiveTab(listener) {
      const handler = (_event: unknown, request: unknown) => listener(request);
      ipcRenderer.on("prism:windows-give-tab", handler);
      return () => ipcRenderer.removeListener("prism:windows-give-tab", handler);
    },
    onCloseRequested(listener) {
      const handler = (_event: unknown, request: unknown) => listener(request);
      ipcRenderer.on("prism:windows-close-requested", handler);
      return () => ipcRenderer.removeListener("prism:windows-close-requested", handler);
    },
  },
  workspace: {
    claim: () => ipcRenderer.invoke("prism:workspace-claim"),
    report: (report) => ipcRenderer.invoke("prism:workspace-report", report),
    withdraw: () => ipcRenderer.invoke("prism:workspace-withdraw"),
    flush: () => ipcRenderer.invoke("prism:workspace-flush"),
  },
  session: {
    share: (event) => ipcRenderer.invoke("prism:session-share", event),
    onPeer(listener) {
      const handler = (_event: unknown, event: unknown) => listener(event);
      ipcRenderer.on("prism:session-peer", handler);
      return () => ipcRenderer.removeListener("prism:session-peer", handler);
    },
  },
};

contextBridge.exposeInMainWorld("prism", bridge);
