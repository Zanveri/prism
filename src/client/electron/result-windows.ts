import {
  grantTtlMs,
  maxResultWindows,
  resultWindowFeatures,
  resultWindowNamePattern,
  resultWindowRequestSchema,
  resultWindowUrl,
  type CloseReason,
  type ResultWindowReply,
} from "./result-window-messages";
import type { Point } from "./window-hub";

/**
 * As janelas do resultado (RN-ABAS-013 e 017), sem depender do Electron: o pedido da tela e a concessão de uso único que ele guarda, a aprovação da abertura,
 * a lista das janelas abertas por quem as abriu e o motivo de cada fechamento. O `main.ts` liga isto às janelas de verdade. Nenhuma janela do resultado entra
 * na lista das janelas do app, no centro das janelas nem na gravação das abas: este é o único lugar onde elas existem.
 */

/** O que a lista usa de uma janela do resultado. */
export type ResultWindowHandle = {
  /** O número do `webContents` dela, pelo qual as permissões a reconhecem. */
  contentsId: number;
  close(): void;
  isDestroyed(): boolean;
};

/** A concessão de uso único de um pedido: daquela janela da aba e daquele nome, com o modo e o ponto, válida por 2 segundos. */
export type Grant = { openerId: number; name: string; mode: "focus" | "background"; point: Point | null; expiresAt: number };

export type ResultWindowEntry<H extends ResultWindowHandle = ResultWindowHandle> = { openerId: number; name: string; handle: H; mode: "focus" | "background"; hostClosing: boolean };

/** A abertura aprovada que não chegou a criar a janela deixa de contar depois disto (o Electron falhou no meio). */
export const creatingTtlMs = 10_000;

export type ResultWindowsDeps = {
  now(): number;
  /** A janela da aba está pronta e com o cofre aberto (`hub.isReady`)? */
  isReady(openerId: number): boolean;
  /** O ponto do pedido: o que o processo principal lê do ponteiro no arraste, ou o `at` onde ele não o lê; `null` fora do arraste. */
  pointOf(at: Point | null): Point | null;
  log(message: string): void;
};

/** O que o `setWindowOpenHandler` de uma janela do app sabe da abertura. */
export type OpenDetails = { url: string; frameName: string; features: string; disposition: string; hasPostBody: boolean };

const keyOf = (openerId: number, name: string) => `${openerId}:${name}`;

export function createResultWindows<H extends ResultWindowHandle = ResultWindowHandle>(deps: ResultWindowsDeps) {
  const grants = new Map<string, Grant>();
  const creating = new Map<string, Grant>();
  const entries = new Map<string, ResultWindowEntry<H>>();

  const validGrant = (key: string): Grant | undefined => {
    const grant = grants.get(key);
    if (grant === undefined) return undefined;
    if (grant.expiresAt <= deps.now()) {
      grants.delete(key);
      return undefined;
    }
    return grant;
  };

  const liveCreating = (key: string): Grant | undefined => {
    const grant = creating.get(key);
    if (grant === undefined) return undefined;
    if (grant.expiresAt <= deps.now()) {
      creating.delete(key);
      return undefined;
    }
    return grant;
  };

  /** As janelas do resultado desta janela da aba: as abertas, as que estão nascendo e as concessões ainda válidas. */
  function load(openerId: number): number {
    let total = 0;
    for (const entry of entries.values()) if (entry.openerId === openerId && !entry.handle.isDestroyed()) total++;
    for (const key of [...creating.keys()]) if (liveCreating(key)?.openerId === openerId) total++;
    for (const key of [...grants.keys()]) if (validGrant(key)?.openerId === openerId) total++;
    return total;
  }

  /** O Prism fecha a janela (o canal de fechar, o bloqueio, o "Sair", a janela da aba que fecha ou recarrega, o fim do app): marca antes, e o aviso diz `host`. */
  function closeByHost(openerId: number, name: string): boolean {
    const entry = entries.get(keyOf(openerId, name));
    if (entry === undefined || entry.handle.isDestroyed()) return false;

    entry.hostClosing = true;
    entry.handle.close();
    return true;
  }

  return {
    /**
     * `prism:result-window-request`: confere o pedido (o schema, a janela pronta com o cofre aberto, o limite de 32 e o nome que não está aberto) e guarda a
     * concessão. A resposta só diz se pode abrir.
     */
    request(openerId: number, raw: unknown): ResultWindowReply {
      const parsed = resultWindowRequestSchema.safeParse(raw);
      if (!parsed.success) return { ok: false };

      const { name, mode, at } = parsed.data;
      const key = keyOf(openerId, name);
      if (!deps.isReady(openerId)) return { ok: false };
      if (entries.get(key)?.handle.isDestroyed() === false || liveCreating(key) !== undefined) return { ok: false };
      // Um pedido novo do mesmo nome troca o anterior, que não conta duas vezes.
      grants.delete(key);
      if (load(openerId) >= maxResultWindows) {
        deps.log(`janela ${openerId}: o limite de ${maxResultWindows} janelas do resultado foi atingido`);
        return { ok: false };
      }

      grants.set(key, { openerId, name, mode, point: deps.pointOf(at), expiresAt: deps.now() + grantTtlMs });
      return { ok: true };
    },

    /**
     * A aprovação da abertura (RN-ABAS-017): só quando todas valem. O endereço é exatamente `about:blank`; o nome casa com o padrão; o texto das opções é
     * exatamente `popup`; a disposição é a de uma janela pedida por script (`new-window`), sem corpo de envio; a janela que pede continua pronta, com o cofre
     * aberto; e há uma concessão válida DAQUELA janela para AQUELE nome, que a aprovação consome (uma abertura por concessão). Devolve a concessão, ou `null`.
     */
    approve(openerId: number, details: OpenDetails): Grant | null {
      if (details.url !== resultWindowUrl) return null;
      if (!resultWindowNamePattern.test(details.frameName)) return null;
      if (details.features !== resultWindowFeatures) return null;
      if (details.disposition !== "new-window" || details.hasPostBody) return null;
      if (!deps.isReady(openerId)) return null;

      const key = keyOf(openerId, details.frameName);
      const grant = validGrant(key);
      if (grant === undefined || grant.openerId !== openerId) return null;
      // Já aberta: o Chromium daria a janela que existe, navegada para a página em branco, e o que ela mostra se apagaria.
      if (entries.get(key)?.handle.isDestroyed() === false) return null;

      grants.delete(key);
      creating.set(key, { ...grant, expiresAt: deps.now() + creatingTtlMs });
      return grant;
    },

    /** A janela nasceu (`did-create-window`): entra na lista, pela janela que a abriu e pelo nome. `null` se não havia uma abertura aprovada. */
    adopt(openerId: number, name: string, handle: H): ResultWindowEntry<H> | null {
      const key = keyOf(openerId, name);
      const grant = liveCreating(key);
      if (grant === undefined) return null;

      creating.delete(key);
      const entry: ResultWindowEntry<H> = { openerId, name, handle, mode: grant.mode, hostClosing: false };
      entries.set(key, entry);
      return entry;
    },

    /** A abertura aprovada que não chegou a criar a janela (a conferência das opções falhou): sai da lista dos que estão nascendo. */
    abandon(openerId: number, name: string): void {
      creating.delete(keyOf(openerId, name));
    },

    find(openerId: number, name: string): ResultWindowEntry<H> | undefined {
      return entries.get(keyOf(openerId, name));
    },

    /** O `webContents` é de uma janela do resultado? As permissões da área de transferência são só dela e da janela do app (RN-ABAS-017). */
    isResultContents(contentsId: number): boolean {
      for (const entry of entries.values()) if (entry.handle.contentsId === contentsId) return true;
      return false;
    },

    /** O ponto e o modo da concessão que criou a janela, ainda não consumida pela entrada. */
    pendingGrant(openerId: number, name: string): Grant | undefined {
      return liveCreating(keyOf(openerId, name));
    },

    openedBy(openerId: number): ResultWindowEntry<H>[] {
      return [...entries.values()].filter((entry) => entry.openerId === openerId && !entry.handle.isDestroyed());
    },

    all(): ResultWindowEntry<H>[] {
      return [...entries.values()].filter((entry) => !entry.handle.isDestroyed());
    },

    closeByHost,

    /** Fecha pelo Prism todas as janelas do resultado de uma janela da aba. */
    closeAllByHost(openerId: number): void {
      for (const entry of [...entries.values()]) if (entry.openerId === openerId) closeByHost(openerId, entry.name);
    },

    /** A janela fechou (`closed`): sai da lista, e o motivo é `host` se foi o Prism que pediu, e `user` nos outros casos (o X da barra, Alt+F4, Cmd+W). */
    closed(openerId: number, name: string): CloseReason | null {
      const key = keyOf(openerId, name);
      const entry = entries.get(key);
      if (entry === undefined) return null;

      entries.delete(key);
      grants.delete(key);
      return entry.hostClosing ? "host" : "user";
    },
  };
}

export type ResultWindows<H extends ResultWindowHandle = ResultWindowHandle> = ReturnType<typeof createResultWindows<H>>;
