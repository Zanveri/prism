import { z } from "zod";

import type { PrismBridge, PrismWorkspace } from "../../../electron/preload";
import {
  copyReplySchema,
  deliverReplySchema,
  destinationReplySchema,
  sourceReplySchema,
  sourceStatusSchema,
  type CopyReply,
  type DeliverReply,
  type DeliverRequest,
  type DestinationReply,
  type DestinationRequest,
  type SourceReply,
  type SourceStatus,
} from "../../../electron/transfer-messages";
import {
  resultWindowClosedSchema,
  resultWindowReplySchema,
  resultWindowStateSchema,
  type ResultWindowClosed,
  type ResultWindowFocus,
  type ResultWindowRequest,
  type ResultWindowState,
} from "../../../electron/result-window-messages";
import {
  peerEventSchema,
  tabDeliverySchema,
  tabGiveSchema,
  tabMoveReplySchema,
  verificationPeerSchema,
  windowCloseRequestSchema,
  windowListSchema,
  type PeerEvent,
  type TabDelivery,
  type TabGive,
  type TabMoveReply,
  type TabMoveRequest,
  type VerificationDone,
  type VerificationPeer,
  type WindowCloseRequest,
  type WindowEntry,
} from "../../../electron/window-messages";
import { createWorkspaceHub, saveWorkspaceThroughApi } from "../../../electron/workspace-hub";
import type { SavedWorkspace } from "../../../electron/workspace-messages";
import { isAppZoom, type AppZoom } from "../../../electron/zoom";

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
 * O zoom do programa inteiro (RN-ZOOM-001), que o processo principal guarda e aplica. A ponte é a fronteira de confiança: só um dos passos (`isAppZoom`) é
 * resposta. Sem zoom (`null`) quando a ponte não existe (a tela fora do Electron, onde o zoom é o do próprio navegador), não responde ou responde outra
 * coisa: a tela passa sem o controle.
 */
export async function currentAppZoom(): Promise<AppZoom | null> {
  try {
    const zoom = await getBridge().zoom.get();
    return isAppZoom(zoom) ? zoom : null;
  } catch {
    return null;
  }
}

/** Pede outro zoom; a resposta é o que ficou valendo, ou `null` se o pedido não valeu. Nunca lança. */
export async function requestAppZoom(zoom: AppZoom): Promise<AppZoom | null> {
  try {
    const applied = await getBridge().zoom.set(zoom);
    return isAppZoom(applied) ? applied : null;
  } catch {
    return null;
  }
}

/** O zoom mudou: por um atalho, nesta ou noutra janela, ou pelas Configurações de outra. O aviso que não é um dos passos é ignorado. */
export function onAppZoomChanged(listener: (zoom: AppZoom) => void): () => void {
  return listen(() =>
    getBridge().zoom.onChanged((raw) => {
      if (isAppZoom(raw)) listener(raw);
    }),
  );
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

const outsideElectron = "Exportar só funciona no app do Prism.";
const importOutsideElectron = "Importar só funciona no app do Prism.";

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
        takeNotice: async () => null,
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
      // Fora do Electron não há processo principal para aprovar nem acompanhar uma janela do resultado (RN-ABAS-014): "Numa janela" não aparece.
      resultWindows: {
        available: false,
        request: async () => ({ ok: false }),
        ready: async () => {},
        focus: async () => false,
        close: async () => false,
        title: async () => false,
        onClosed: () => () => {},
        onState: () => () => {},
      },
      session: { share: async () => {}, onPeer: () => () => {} },
      // Uma janela só: a vez da verificação é sempre dela (RN-VERIF-002), e não há a quem contar a resposta.
      verification: { claim: async () => true, finish: async () => {}, onPeer: () => () => {} },
      workspace: devWorkspaceBridge({ baseUrl: url.replace(/\/$/, ""), token }),
      // Fora do Electron o zoom é o do navegador: não há o do programa (RN-ZOOM-001), e a tela passa sem o controle.
      zoom: { get: async () => null, set: async () => null, onChanged: () => () => {} },
      // RN-EXPORT-019: fora do Electron não há processo principal para escolher o destino nem a área de transferência do sistema: o "Exportar" do assistente
      // diz que só funciona no app do Prism e não pede nada à API. Nenhum destes é chamado (a tela confere `available` antes); se for, recusa.
      transfers: {
        available: false,
        chooseDestination: () => Promise.reject(new Error(outsideElectron)),
        deliver: () => Promise.reject(new Error(outsideElectron)),
        copy: () => Promise.reject(new Error(outsideElectron)),
        reveal: async () => {},
        release: async () => {},
        // RN-IMPORT-001 e 018: fora do Electron não há o diálogo de abrir nem quem copie o arquivo: "Escolher arquivo…" diz que importar só funciona no app,
        // sem pedir nada. A consulta não acha arquivo nenhum, e soltar não tem o que soltar.
        chooseSource: () => Promise.reject(new Error(importOutsideElectron)),
        sourceStatus: async () => ({ status: "missing" }),
        releaseSource: async () => {},
      },
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

/**
 * A janela do resultado (RN-ABAS-013 e 017), do lado da tela. Cada resposta e cada aviso do processo principal é conferido aqui, com o schema que ele também
 * usa (`electron/result-window-messages.ts`). Sem a ponte (a tela num teste, ou uma ponte antiga) ou fora do Electron, a janela do resultado não existe, e nada
 * disto lança.
 */

/** Há como abrir a janela do resultado? Só no app: o item "Numa janela" aparece conforme isto (RN-ABAS-014 e RN-CONFIG-010). */
export function resultWindowsAvailable(): boolean {
  try {
    return getBridge().resultWindows?.available === true;
  } catch {
    return false;
  }
}

/** Pede a concessão de uso único para abrir a janela do resultado; a resposta que não é `ok: true` é "não". */
export async function requestResultWindow(request: ResultWindowRequest): Promise<boolean> {
  try {
    const parsed = resultWindowReplySchema.safeParse(await getBridge().resultWindows.request(request));
    return parsed.success && parsed.data.ok;
  } catch {
    return false;
  }
}

/** O resultado está desenhado na janela: ela pode aparecer. */
export function tellResultWindowReady(name: string): void {
  try {
    void getBridge()
      .resultWindows.ready({ name })
      .catch(() => undefined);
  } catch {
    // Sem a ponte: não há janela do resultado.
  }
}

/** Traz a janela do resultado (ou a da aba que a abriu) à frente. Responde se havia a janela. */
export async function focusResultWindow(request: ResultWindowFocus): Promise<boolean> {
  try {
    return (await getBridge().resultWindows.focus(request)) === true;
  } catch {
    return false;
  }
}

/** O Prism fecha a janela do resultado (o aviso de que fechou diz `host`). Responde se havia a janela. */
export async function closeResultWindow(name: string): Promise<boolean> {
  try {
    return (await getBridge().resultWindows.close({ name })) === true;
  } catch {
    return false;
  }
}

/** O título da janela do resultado. */
export function setResultWindowTitle(name: string, title: string): void {
  try {
    void getBridge()
      .resultWindows.title({ name, title })
      .catch(() => undefined);
  } catch {
    // Sem a ponte: não há janela do resultado.
  }
}

/** Uma janela do resultado desta tela fechou, e quem a fechou. O aviso fora do formato é ignorado. */
export function onResultWindowClosed(listener: (closed: ResultWindowClosed) => void): () => void {
  return listen(() =>
    getBridge().resultWindows.onClosed((raw) => {
      const parsed = resultWindowClosedSchema.safeParse(raw);
      if (parsed.success) listener(parsed.data);
    }),
  );
}

/** Uma janela do resultado desta tela minimizou ou voltou. */
export function onResultWindowState(listener: (state: ResultWindowState) => void): () => void {
  return listen(() =>
    getBridge().resultWindows.onState((raw) => {
      const parsed = resultWindowStateSchema.safeParse(raw);
      if (parsed.success) listener(parsed.data);
    }),
  );
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
 * RN-VERIF-002: a vez da verificação de uma conexão, do lado da tela. O processo principal a dá a uma janela por vez, e não de novo antes do intervalo
 * (`window-hub.ts`). Sem a ponte das janelas (fora do Electron, ou uma ponte antiga) há uma janela só, e a vez é dela; a resposta que não é `true` é "não".
 */
export async function claimVerification(connectionId: string, intervalMs: number): Promise<boolean> {
  let verification: PrismBridge["verification"] | undefined;
  try {
    verification = getBridge().verification;
  } catch {
    return true;
  }
  if (verification === undefined) return true;

  try {
    return (await verification.claim({ connectionId, intervalMs })) === true;
  } catch {
    return false;
  }
}

/** A verificação que esta janela fez terminou: a resposta vai às outras janelas (ou, nula, só a vez fica livre). Nunca lança. */
export function finishVerification(done: VerificationDone): void {
  try {
    void getBridge()
      .verification.finish(done)
      .catch(() => undefined);
  } catch {
    // Sem a ponte: não há outras janelas.
  }
}

/** A resposta da verificação que outra janela fez (conferida com o schema): o que não confere é ignorado. */
export function onVerificationPeer(listener: (peer: VerificationPeer) => void): () => void {
  return listen(() =>
    getBridge().verification.onPeer((raw) => {
      const parsed = verificationPeerSchema.safeParse(raw);
      if (parsed.success) listener(parsed.data);
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

/**
 * O destino e a entrega das exportações de dados (RN-EXPORT-019 e 020), do lado da tela. A ponte é a fronteira de confiança: cada resposta do processo
 * principal é conferida com o schema que ele também usa (`electron/transfer-messages.ts`). Nada aqui lança: a ponte que falta, o pedido recusado e a resposta
 * fora do formato voltam como valor, e quem chama decide o que dizer.
 */

/** Há processo principal para o destino e a entrega? Fora do Electron (ou com uma ponte sem `transfers`), não: o "Exportar" diz que só funciona no app. */
export function transfersAvailable(): boolean {
  try {
    return getBridge().transfers?.available === true;
  } catch {
    return false;
  }
}

/** O diálogo de salvar do sistema, aberto pelo processo principal. `error`: a ponte recusou o pedido ou respondeu fora do formato. */
export async function chooseExportDestination(request: DestinationRequest): Promise<DestinationReply | { status: "error" }> {
  try {
    const parsed = destinationReplySchema.safeParse(await getBridge().transfers.chooseDestination(request));
    return parsed.success ? parsed.data : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** A entrega do arquivo pronto ao destino. A falha da ponte vira a entrega que falhou, sem motivo conhecido (`other`). */
export async function deliverExport(request: DeliverRequest, fallback: string): Promise<DeliverReply> {
  try {
    const parsed = deliverReplySchema.safeParse(await getBridge().transfers.deliver(request));
    return parsed.success ? parsed.data : { status: "failed", reason: "other", message: fallback };
  } catch {
    return { status: "failed", reason: "other", message: fallback };
  }
}

/** O texto pronto para a área de transferência. A falha da ponte vira `failed`, com a frase dada. */
export async function copyExport(transferId: string, fallback: string): Promise<CopyReply> {
  try {
    const parsed = copyReplySchema.safeParse(await getBridge().transfers.copy({ transferId }));
    return parsed.success ? parsed.data : { status: "failed", message: fallback };
  } catch {
    return { status: "failed", message: fallback };
  }
}

/** "Mostrar na pasta" do aviso de sucesso. Nunca lança: se não deu, nada acontece (o arquivo está onde a pessoa o pôs). */
export function revealExport(deliveryId: string): void {
  try {
    void getBridge()
      .transfers.reveal({ deliveryId })
      .catch(() => undefined);
  } catch {
    // Sem a ponte: não há o que mostrar.
  }
}

/** Solta o destino (a entrega em andamento para). Espera a resposta, para um "Salvar como…" poder escolher o mesmo arquivo logo depois. Nunca lança. */
export async function releaseExportDestination(destinationId: string): Promise<void> {
  try {
    await getBridge().transfers.release({ destinationId });
  } catch {
    // Sem a ponte, ou o destino já não existe: não há o que soltar.
  }
}

/**
 * O arquivo de uma importação de dados (RN-IMPORT-018), do lado da tela. Cada resposta do processo principal é conferida com o schema que ele também usa;
 * nada aqui lança, e nenhum caminho chega à tela: só o identificador da cópia, o nome do arquivo sem a pasta e o tamanho.
 */

/** O diálogo de abrir do sistema e a cópia que começa. `error`: a ponte recusou o pedido ou respondeu fora do formato. */
export async function chooseImportSource(): Promise<SourceReply | { status: "error" }> {
  try {
    const parsed = sourceReplySchema.safeParse(await getBridge().transfers.chooseSource());
    return parsed.success ? parsed.data : { status: "error" };
  } catch {
    return { status: "error" };
  }
}

/** Como está a cópia. A ponte que falha, ou a resposta fora do formato, vale `missing`: a tela pede o arquivo de novo. */
export async function importSourceStatus(fileId: string): Promise<SourceStatus> {
  try {
    const parsed = sourceStatusSchema.safeParse(await getBridge().transfers.sourceStatus({ fileId }));
    return parsed.success ? parsed.data : { status: "missing" };
  } catch {
    return { status: "missing" };
  }
}

/** Solta o arquivo (a cópia em andamento para, e a cópia que a API não tomou é apagada). Espera a resposta. Nunca lança. */
export async function releaseImportSource(fileId: string): Promise<void> {
  try {
    await getBridge().transfers.releaseSource({ fileId });
  } catch {
    // Sem a ponte, ou o arquivo já foi solto: não há o que soltar.
  }
}
