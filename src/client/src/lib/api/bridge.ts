import { z } from "zod";

import type { PrismBridge, PrismWorkspace } from "../../../electron/preload";
import { peerEventSchema, tabDeliverySchema, tabGiveSchema, tabMoveReplySchema, windowCloseRequestSchema, windowListSchema, type PeerEvent, type TabDelivery, type TabGive, type TabMoveReply, type TabMoveRequest, type WindowCloseRequest, type WindowEntry } from "../../../electron/window-messages";
import { createWorkspaceHub, saveWorkspaceThroughApi } from "../../../electron/workspace-hub";
import type { SavedWorkspace } from "../../../electron/workspace-messages";

declare global {
  interface Window {
    /** Exposto pelo preload (`electron/preload.ts`). Não existe quando a tela abre fora do Electron. */
    prism?: PrismBridge;
  }
}

const noPreferences = { checkOnStartup: true, skippedVersion: null, lastCheckedAt: null, receiveBeta: false };

/** A pasta de dados que o processo principal diz: um caminho, e portanto texto que não é vazio. Qualquer outra resposta não é uma pasta. */
const dataFolderSchema = z.string().min(1);

/**
 * A pasta de dados em uso (os cofres e o log da API), para a tela mostrar em Configurações > Sobre. Sem pasta (`null`) quando a ponte não
 * existe, não responde, recusa o pedido ou responde algo que não é um caminho: é um dado só de leitura, e a tela passa sem ele.
 */
export async function readDataFolder(): Promise<string | null> {
  try {
    const parsed = dataFolderSchema.safeParse(await getBridge().getDataFolder());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Fora do Electron (só em desenvolvimento) não há processo principal para juntar e gravar as abas (RN-ABAS-006): a própria tela faz o papel dele, com o
 * mesmo centro (`workspace-hub.ts`), uma janela só e a gravação direto na API. É um só por página, como o processo principal é um só para todas as janelas.
 */
let devWorkspace: PrismWorkspace | null = null;

function devWorkspaceBridge(api: { baseUrl: string; token: string }): PrismWorkspace {
  if (devWorkspace !== null) return devWorkspace;

  const hub = createWorkspaceHub({
    save: async (workspace: SavedWorkspace) => (await saveWorkspaceThroughApi(api, workspace, { fetch: (url, init) => fetch(url, init), timeoutMs: 5000 })).ok,
    schedule(run, ms) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
    liveWindows: () => [1],
    log: (message) => console.warn(`[prism] abas: ${message}`),
  });
  devWorkspace = {
    claim: async () => hub.claim(1),
    report: async (report) => hub.report(1, report),
    withdraw: async () => hub.withdraw(1),
    flush: () => hub.flush(),
  };
  return devWorkspace;
}

/**
 * A ponte com o processo principal. Só em desenvolvimento, com a tela aberta num navegador comum
 * para conferência, o endereço e o token vêm de `VITE_DEV_API_URL` e `VITE_DEV_API_TOKEN`
 * (`.env.example`). O bundle de produção não leva esse ramo: `import.meta.env.DEV` é uma
 * constante, e o que está dentro do `if` sai na construção.
 */
export function getBridge(): PrismBridge {
  if (window.prism !== undefined) return window.prism;

  if (import.meta.env.DEV) {
    const config = z.object({ VITE_DEV_API_URL: z.url(), VITE_DEV_API_TOKEN: z.string().min(1) }).safeParse(import.meta.env);
    if (!config.success) throw new Error("Fora do Electron, defina VITE_DEV_API_URL e VITE_DEV_API_TOKEN em .env.local.");

    const { VITE_DEV_API_URL: url, VITE_DEV_API_TOKEN: token } = config.data;
    return {
      getApiConfig: async () => ({ baseUrl: url.replace(/\/$/, ""), token }),
      onApiExit: () => () => {},
      restartApi: async () => {},
      version: "dev",
      getDataFolder: async () => null,
      // Fora do Electron não há processo principal: nada procura atualização, e a consulta manual diz "sem origem".
      updates: {
        getState: async () => ({ status: "none" }),
        onState: () => () => {},
        onProgress: () => () => {},
        check: async () => ({ outcome: "noSource" }),
        download: async () => ({ status: "none" }),
        cancel: async () => {},
        install: async () => ({ status: "none" }),
        getPreferences: async () => noPreferences,
        setCheckOnStartup: async () => noPreferences,
        setReceiveBeta: async () => noPreferences,
        skipVersion: async () => noPreferences,
      },
      // Fora do Electron há uma janela só, e nenhuma outra para onde levar uma aba ou a quem contar do cofre.
      windows: {
        id: null,
        list: async () => [],
        moveTab: async () => ({ ok: false, reason: "noWindow" }),
        requestTab: async () => false,
        setReady: async () => {},
        describe: async () => {},
        close: async () => {},
        onTab: () => () => {},
        onGiveTab: () => () => {},
        onCloseRequested: () => () => {},
      },
      session: { share: async () => {}, onPeer: () => () => {} },
      workspace: devWorkspaceBridge({ baseUrl: url.replace(/\/$/, ""), token }),
    };
  }

  throw new Error("A ponte com o processo principal do Prism não está disponível.");
}

/**
 * As janelas (RN-ABAS-002 a 005), do lado da tela. A ponte é a fronteira de confiança: cada resposta e cada aviso do processo principal é conferido
 * aqui, com o schema que ele também usa (`electron/window-messages.ts`), e o que não confere é ignorado (uma lista vazia, um pedido que não saiu).
 * Uma ponte sem as janelas (a tela num teste, ou uma ponte antiga) também não derruba nada.
 */

/** O número desta janela, ou `null` fora do Electron. */
export function currentWindowId(): number | null {
  try {
    return getBridge().windows.id ?? null;
  } catch {
    return null;
  }
}

/** As outras janelas abertas, para "Mover para a janela…". */
export async function listOtherWindows(): Promise<WindowEntry[]> {
  try {
    const parsed = windowListSchema.safeParse(await getBridge().windows.list());
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** Leva a aba: só com `ok` ela saiu (e a janela a tira da faixa, sem fechar a sessão). */
export async function sendTabAway(request: TabMoveRequest): Promise<TabMoveReply> {
  try {
    const parsed = tabMoveReplySchema.safeParse(await getBridge().windows.moveTab(request));
    return parsed.success ? parsed.data : { ok: false, reason: "invalid" };
  } catch {
    return { ok: false, reason: "noWindow" };
  }
}

/** Liga um ouvinte da ponte que pode não existir: sem ele, nada chega, e soltar não faz nada. */
function listen(subscribe: () => () => void): () => void {
  try {
    return subscribe();
  } catch {
    return () => {};
  }
}

/** Uma aba chegou de outra janela (o conteúdo dela ainda passa por `readTransfer`). */
export function onTabArrived(listener: (delivery: TabDelivery) => void): () => void {
  return listen(() =>
    getBridge().windows.onTab((raw) => {
      const parsed = tabDeliverySchema.safeParse(raw);
      if (parsed.success) listener(parsed.data);
    }),
  );
}

/** Outra janela recebeu, na faixa dela, uma aba desta: o processo principal pede que esta a mande. */
export function onTabWanted(listener: (give: TabGive) => void): () => void {
  return listen(() =>
    getBridge().windows.onGiveTab((raw) => {
      const parsed = tabGiveSchema.safeParse(raw);
      if (parsed.success) listener(parsed.data);
    }),
  );
}

/** A pessoa fechou a janela. O aviso que não diz direito se ela é a última vale "não é": o fechamento pergunta tudo, como antes (RN-ABAS-007). */
export function onWindowCloseRequested(listener: (request: WindowCloseRequest) => void): () => void {
  return listen(() =>
    getBridge().windows.onCloseRequested((raw) => {
      const parsed = windowCloseRequestSchema.safeParse(raw);
      listener(parsed.success ? parsed.data : { last: false });
    }),
  );
}

/** Pedidos sem resposta que a tela espere (pronta, resumo, pedir a aba, fechar): a falha só não faz nada. */
export function tellWindows(call: (windows: PrismBridge["windows"]) => Promise<unknown>): void {
  try {
    void call(getBridge().windows).catch(() => undefined);
  } catch {
    // Sem a ponte das janelas: não há a quem contar.
  }
}

/** Conta às outras janelas o que aconteceu com o cofre aqui (RN-ABAS-004). */
export function sharePeerEvent(kind: PeerEvent["kind"]): void {
  try {
    void getBridge()
      .session.share({ kind })
      .catch(() => undefined);
  } catch {
    // Sem a ponte: não há outras janelas.
  }
}

/** O que outra janela contou do cofre. */
export function onPeerEvent(listener: (kind: PeerEvent["kind"]) => void): () => void {
  return listen(() =>
    getBridge().session.onPeer((raw) => {
      const parsed = peerEventSchema.safeParse(raw);
      if (parsed.success) listener(parsed.data.kind);
    }),
  );
}

/**
 * As abas que voltam na próxima entrada (RN-ABAS-006), do lado da tela. Sem a ponte (a tela num teste, ou uma ponte antiga) nada é gravado e nada volta, e
 * nenhuma falha chega à tela: gravar com o cofre fechado, ou sem processo principal, não é erro que a pessoa precise ver.
 */

/** Esta janela reabre as abas gravadas? Só a principal, uma vez por entrada. A resposta que não é `true` é "não". */
export async function claimWorkspaceRestore(): Promise<boolean> {
  try {
    return (await getBridge().workspace.claim()) === true;
  } catch {
    return false;
  }
}

/** Conta ao processo principal as abas desta janela; `urgent`, uma aba fechou e a gravação é na hora. */
export function reportWorkspace(workspace: SavedWorkspace, urgent: boolean): void {
  try {
    void getBridge()
      .workspace.report({ workspace, urgent })
      .catch(() => undefined);
  } catch {
    // Sem a ponte: não há quem grave.
  }
}

/** A área de trabalho desta janela desmontou: as abas dela deixam de contar. */
export function withdrawWorkspace(): void {
  try {
    void getBridge()
      .workspace.withdraw()
      .catch(() => undefined);
  } catch {
    // Sem a ponte: não há quem grave.
  }
}

/** Grava agora as abas de todas as janelas, e espera. Nunca lança. */
export async function flushWorkspace(): Promise<void> {
  try {
    await getBridge().workspace.flush();
  } catch {
    // Sem a ponte, ou a gravação falhou: o processo principal já registrou, e a tela segue.
  }
}
