import { contextBridge, ipcRenderer } from "electron";

import { versionFromArgv } from "./app-version";
import type { UpdatePreferences } from "./update/preferences";
import type { CheckOutcome, UpdateProgress, UpdateState } from "./update/update-state";

/**
 * A fronteira de confiança do app (decisão 5 da seção 8 da especificação): o endereço e o token
 * da API, o aviso de que ela saiu, o pedido para reiniciá-la, a versão do app (RN-VERSAO-004) e a
 * pasta de dados em uso (só leitura). É tudo o que a tela recebe do processo principal, mais as
 * atualizações (`updates`).
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
  },
};

contextBridge.exposeInMainWorld("prism", bridge);
