import { z } from "zod";

import {
  peerEventSchema,
  tabDragEndSchema,
  tabMoveRequestSchema,
  tabRequestSchema,
  verificationClaimSchema,
  verificationDoneSchema,
  windowSummarySchema,
  type TabDelivery,
  type TabDragEndReply,
  type TabMoveReply,
  type VerificationPeer,
  type WindowEntry,
  type WindowSummary,
} from "./window-messages";

/**
 * As janelas do app (RN-ABAS-002 a 005), sem depender do Electron: quem são, qual está pronta para receber uma aba, a aba que espera a janela
 * ficar pronta, o que uma janela conta às outras sobre o cofre e quem verifica cada conexão (RN-VERIF-002). Só daqui sai uma janela nova (RN-ABAS-005), e
 * nenhuma janela fala com outra: tudo passa por aqui, conferido pelo schema de `window-messages.ts`. O `main.ts` liga isto às janelas de verdade.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** Os avisos que saem daqui para uma janela. */
export type HubChannel = "prism:windows-tab" | "prism:windows-give-tab" | "prism:session-peer" | "prism:verification-peer";

/** O que o centro usa de uma janela. */
export type HubWindow = {
  id: number;
  send(channel: HubChannel, payload: unknown): void;
  /** Onde a janela está na tela agora (maximizada, a tela inteira): é por aqui que se sabe sobre qual janela o ponteiro está. */
  bounds(): Rect;
  /** O tamanho e o lugar dela sem maximizar (`getNormalBounds()`): é o tamanho que a janela nova copia (RN-ABAS-010). */
  normalBounds(): Rect;
  focus(): void;
};

export type WindowHubDeps = {
  /**
   * Cria a janela nova (a área de trabalho inteira): com o canto de cima à esquerda onde a aba foi solta, ou, sem ponto, ao lado da de origem. `source` é
   * o tamanho da de origem sem maximizar. `null` se não deu.
   */
  createWindow(placement: { at: Point | null; source: Rect | null }): HubWindow | null;
  log(message: string): void;
  /** O relógio, em milissegundos, para a vez da verificação (RN-VERIF-002) e para a soltura que outra janela recebeu (RN-ABAS-010); sem ele, o do sistema. */
  now?: () => number;
  /**
   * RN-ABAS-010: o ponteiro na tela agora (`screen.getCursorScreenPoint()`, em pixels independentes da densidade), ou `null` onde ele não vale (o Wayland,
   * em que fora das janelas do app ele vem parado ou em (0, 0)). Sem a dependência, `null`.
   */
  cursorPoint?: () => Point | null;
  /**
   * RN-ABAS-010: o `dropEffect` `none` do fim do arraste é o Esc, e não uma soltura fora das janelas do Prism. Só onde a sonda S-ABAS-1 provou isso (o
   * Linux com o X11, onde a soltura fora vem com `move`); nas outras, o Esc fora das janelas vale como a soltura.
   */
  escapeEndsWithoutEffect?: boolean;
  /** A espera pela outra janela que recebeu a soltura (RN-ABAS-010); sem ela, um temporizador de verdade. */
  wait?: (ms: number) => Promise<void>;
};

type Pending = { delivery: TabDelivery; sourceId: number };
type Entry = { window: HubWindow; number: number; ready: boolean; summary: WindowSummary; queue: Pending[] };

/**
 * RN-VERIF-002: a verificação de uma conexão. `holder` é a janela que está verificando agora (desde `claimedAt`); `doneAt` e `doneBy`, quando e por qual
 * janela a última terminou com resposta.
 */
type Check = { holder: number | null; claimedAt: number; doneAt: number | null; doneBy: number | null };

/** A verificação que nunca terminou (a janela travou no meio) não segura a conexão para sempre: depois disto, outra janela pode verificar. */
export const verificationClaimTtlMs = 120_000;

/**
 * A folga do intervalo: a janela cujo relógio dispara logo depois de outra terminar (com o aviso da resposta ainda a caminho) não verifica de novo. O relógio
 * de cada janela recomeça com a resposta que chega, então a janela que verificou por último é a que verifica de novo.
 */
export const verificationSlackMs = 1_000;

/**
 * RN-ABAS-010: quanto o fim do arraste espera que outra janela do Prism diga que recebeu a aba (a soltura na faixa ou no véu dela, `requestTab`) antes de
 * abrir a janela nova. O pedido dela pode chegar antes do fim do arraste (a soltura vem antes do `dragend`) ou logo depois; o que chegou há mais do que
 * `claimMemoryMs` é de outro arraste.
 */
export const dragClaimWaitMs = 200;
const claimMemoryMs = 2_000;

const readyFlag = z.boolean();

function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

export function createWindowHub(deps: WindowHubDeps) {
  const entries = new Map<number, Entry>();
  const checks = new Map<string, Check>();
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastNumber = 0;
  /** RN-ABAS-010: a aba que outra janela pediu pela soltura (a janela de origem e a aba), e quando; o fim do arraste delas a lê. */
  const claims = new Map<string, number>();
  const claimKey = (fromId: number, tabId: string) => `${fromId}:${tabId}`;
  const claimed = (key: string) => {
    const at = claims.get(key);
    claims.delete(key);
    return at !== undefined && now() - at <= claimMemoryMs;
  };

  function add(window: HubWindow): void {
    entries.set(window.id, { window, number: ++lastNumber, ready: false, summary: { activeTitle: null, tabCount: 0 }, queue: [] });
  }

  /** Manda o que espera, se a área de trabalho da janela está montada (o cofre aberto, `setReady`). Antes disso a aba fica aqui. */
  function flush(entry: Entry): void {
    if (!entry.ready || entry.queue.length === 0) return;

    const pending = entry.queue;
    entry.queue = [];
    for (const { delivery } of pending) entry.window.send("prism:windows-tab", delivery);
  }

  function deliver(targetId: number, delivery: TabDelivery, sourceId: number): void {
    const entry = entries.get(targetId);
    if (entry === undefined) return;

    entry.queue.push({ delivery, sourceId });
    flush(entry);
    entry.window.focus();
  }

  /** A outra janela do Prism debaixo do ponto, se há. */
  function windowAt(point: Point, exceptId: number): number | null {
    for (const [id, entry] of entries) if (id !== exceptId && contains(entry.window.bounds(), point)) return id;
    return null;
  }

  return {
    add,

    /** A janela fechou. A aba que ela ainda não tinha recebido volta para a janela de onde veio, se ela continua aberta. */
    remove(id: number): void {
      const entry = entries.get(id);
      entries.delete(id);
      // A verificação que a janela fazia não chega ao fim: outra janela pode verificar a conexão na vez dela.
      for (const check of checks.values()) if (check.holder === id) check.holder = null;
      for (const { delivery, sourceId } of entry?.queue ?? []) {
        if (entries.has(sourceId)) deliver(sourceId, { transfer: delivery.transfer }, sourceId);
        else deps.log("uma aba a caminho de uma janela que fechou não tinha para onde voltar");
      }
    },

    /** A área de trabalho da janela montou (`true`) ou desmontou (`false`, saiu do cofre). Pronta, recebe o que esperava. */
    setReady(id: number, raw: unknown): void {
      const entry = entries.get(id);
      const parsed = readyFlag.safeParse(raw);
      if (entry === undefined || !parsed.success) return;

      entry.ready = parsed.data;
      flush(entry);
    },

    /** RN-ABAS-007: a janela é a única aberta? Fechá-la fecha o app, e as abas dela voltam na próxima entrada. */
    isLast: (id: number): boolean => entries.size === 1 && entries.has(id),

    /** A janela tem a área de trabalho montada? Só ela tem abas a perguntar antes de fechar. */
    isReady: (id: number): boolean => entries.get(id)?.ready === true,

    describe(id: number, raw: unknown): void {
      const entry = entries.get(id);
      const parsed = windowSummarySchema.safeParse(raw);
      if (entry !== undefined && parsed.success) entry.summary = parsed.data;
    },

    /** As outras janelas, para "Mover para a janela…" (RN-ABAS-003). */
    list(id: number): WindowEntry[] {
      return [...entries.entries()].filter(([other]) => other !== id).map(([other, entry]) => ({ id: other, number: entry.number, ...entry.summary }));
    },

    /**
     * Leva a aba que a janela `fromId` mandou. Para outra janela: se ela existe e não é a mesma. Para uma janela nova: abre com o canto de cima à esquerda
     * no ponto dado (o que o fim do arraste leu, `endDrag`), ou, sem ele, um pouco abaixo e à direita da de origem. Se a aba caiu sobre outra janela do
     * Prism, o fim do arraste já respondeu que não há o que fazer, e quem a leva é o pedido daquela janela (`requestTab`). A janela de origem só tira a aba
     * da faixa quando a resposta é `ok`.
     */
    moveTab(fromId: number, raw: unknown): TabMoveReply {
      const source = entries.get(fromId);
      const parsed = tabMoveRequestSchema.safeParse(raw);
      if (source === undefined || !parsed.success) return { ok: false, reason: "invalid" };

      const { target, transfer } = parsed.data;
      if (target.kind === "window") {
        if (target.windowId === fromId || !entries.has(target.windowId)) return { ok: false, reason: "noWindow" };

        deliver(target.windowId, target.index === undefined ? { transfer } : { transfer, index: target.index }, fromId);
        return { ok: true };
      }

      const created = deps.createWindow({ at: target.at ?? null, source: source.window.normalBounds() });
      if (created === null) return { ok: false, reason: "noWindow" };

      add(created);
      deliver(created.id, { transfer }, fromId);
      return { ok: true };
    },

    /**
     * A aba de outra janela foi solta na faixa de `toId` (ou no véu dela, RN-ABAS-003): pede à janela de origem que a mande para lá, pelo caminho de sempre
     * dela. O pedido também diz ao fim do arraste da janela de origem que a aba já tem destino, e que a janela nova não abre (RN-ABAS-010).
     */
    requestTab(toId: number, raw: unknown): boolean {
      const parsed = tabRequestSchema.safeParse(raw);
      if (!parsed.success || !entries.has(toId) || parsed.data.fromWindowId === toId) return false;

      const source = entries.get(parsed.data.fromWindowId);
      if (source === undefined) return false;

      claims.set(claimKey(parsed.data.fromWindowId, parsed.data.tabId), now());
      source.window.send("prism:windows-give-tab", { tabId: parsed.data.tabId, target: { kind: "window", windowId: toId, index: parsed.data.index } });
      return true;
    },

    /**
     * RN-ABAS-010: o arraste de uma aba da janela `fromId` terminou. Quem decide é quem recebeu a soltura, e o ponto é o do ponteiro, que o processo
     * principal lê agora (`cursorPoint`), e não o do `dragend`:
     * - o véu desta janela a recebeu (longe da faixa, dentro dela): a janela nova, no ponteiro;
     * - ninguém aqui a recebeu, e o ponteiro está dentro desta janela (o Esc, a barra de título, as bordas) ou sobre outra janela do Prism (quem decide é
     *   ela): nada;
     * - ninguém aqui a recebeu, e o ponteiro está fora das janelas do Prism: a janela nova, no ponteiro, se nenhuma outra janela pediu a aba pela soltura
     *   (`requestTab`) até `dragClaimWaitMs` depois; onde a sonda provou que o `dropEffect` `none` é o Esc (`escapeEndsWithoutEffect`), nada.
     * Sem o ponteiro (o Wayland) vale o ponto do `dragend`, e sem ponto nenhum, `null` (a janela nova abre ao lado da de origem); "dentro desta janela" é o
     * `dragend` dentro da página dela (`inPage`), e a outra janela do Prism só se sabe pelo pedido dela. A aba do resultado nenhuma outra janela recebe: não
     * há espera.
     */
    async endDrag(fromId: number, raw: unknown): Promise<TabDragEndReply> {
      const source = entries.get(fromId);
      const parsed = tabDragEndSchema.safeParse(raw);
      if (source === undefined || !parsed.success) return { action: "none" };

      const { tabId, kind, dropped, effect, at, inPage } = parsed.data;
      const cursor = deps.cursorPoint?.() ?? null;
      const point = cursor ?? at;
      const key = claimKey(fromId, tabId);
      if (dropped === "veil") {
        claims.delete(key);
        return { action: "newWindow", at: point };
      }

      // Sem o ponteiro, o que se sabe é se o `dragend` caiu dentro da página desta janela.
      const overPrism = cursor === null ? inPage : contains(source.window.bounds(), cursor) || windowAt(cursor, fromId) !== null;
      if (overPrism) {
        claims.delete(key);
        return { action: "none" };
      }
      if (deps.escapeEndsWithoutEffect === true && effect === "none") {
        claims.delete(key);
        return { action: "none" };
      }
      if (kind === "tab" && !claimed(key)) {
        await wait(dragClaimWaitMs);
        if (claimed(key)) return { action: "none" };
      } else if (kind === "tab") return { action: "none" };

      return entries.has(fromId) ? { action: "newWindow", at: point } : { action: "none" };
    },

    /**
     * RN-VERIF-002: a janela `fromId` pede a vez de verificar uma conexão. Ganha se nenhuma outra está verificando a mesma conexão (há menos que
     * `verificationClaimTtlMs`) e se a última verificação dela, feita por outra janela, acabou há o intervalo (menos a folga) ou mais. Quem ganha a vez
     * a devolve com `finishVerification`. A janela que não existe, ou o pedido fora do schema, não ganha.
     */
    claimVerification(fromId: number, raw: unknown): boolean {
      const parsed = verificationClaimSchema.safeParse(raw);
      if (!parsed.success || !entries.has(fromId)) return false;

      const { connectionId, intervalMs } = parsed.data;
      const at = now();
      const check = checks.get(connectionId) ?? { holder: null, claimedAt: 0, doneAt: null, doneBy: null };
      if (check.holder !== null && check.holder !== fromId && entries.has(check.holder) && at - check.claimedAt < verificationClaimTtlMs) return false;
      if (check.doneAt !== null && check.doneBy !== fromId && at - check.doneAt < intervalMs - verificationSlackMs) return false;

      checks.set(connectionId, { ...check, holder: fromId, claimedAt: at });
      return true;
    },

    /**
     * RN-VERIF-002: a janela `fromId` terminou a verificação que pediu. Com a resposta, ela vai às outras janelas com a área de trabalho montada, que a
     * mostram no indicador e recomeçam o relógio delas; sem ela (a chamada falhou, ou a conexão desconectou no meio), a vez só fica livre.
     */
    finishVerification(fromId: number, raw: unknown): void {
      const parsed = verificationDoneSchema.safeParse(raw);
      if (!parsed.success || !entries.has(fromId)) return;

      const { connectionId, result } = parsed.data;
      const check = checks.get(connectionId);
      if (check?.holder === fromId) checks.set(connectionId, { ...check, holder: null });
      if (result === null) return;

      checks.set(connectionId, { ...(checks.get(connectionId) ?? { holder: null, claimedAt: 0 }), doneAt: now(), doneBy: fromId });
      const peer: VerificationPeer = { connectionId, result };
      for (const [id, entry] of entries) if (id !== fromId && entry.ready) entry.window.send("prism:verification-peer", peer);
    },

    /** O que uma janela conta do cofre vai a todas as outras, também às que estão no login (o login libera todas). */
    share(fromId: number, raw: unknown): void {
      const parsed = peerEventSchema.safeParse(raw);
      if (!parsed.success || !entries.has(fromId)) return;

      for (const [id, entry] of entries) if (id !== fromId) entry.window.send("prism:session-peer", parsed.data);
    },
  };
}

export type WindowHub = ReturnType<typeof createWindowHub>;

/** Pelo menu (e sem ponto que sirva, no Wayland), a janela nova abre este tanto abaixo e à direita da de origem. */
const cascade = 32;
/** O mínimo de uma janela do app (`createAppWindow`): a janela nova encolhe para caber na área útil, mas não abaixo disto. */
export const appWindowMinimum = { width: 1024, height: 700 } as const;

/**
 * O lugar da janela nova (RN-ABAS-002 e 010): do tamanho da janela de origem sem maximizar, com o canto de cima à esquerda onde a aba foi solta ou, pelo
 * menu, um pouco abaixo e à direita da de origem; e sempre dentro da área útil do monitor daquele ponto (sem a barra de tarefas), encolhida se ela for menor,
 * até o mínimo de 1024×700.
 */
export function newWindowBounds({ at, source, workArea }: { at: Point | null; source: Rect | null; workArea: Rect }): Rect {
  const width = Math.max(appWindowMinimum.width, Math.min(source?.width ?? 1440, workArea.width));
  const height = Math.max(appWindowMinimum.height, Math.min(source?.height ?? 900, workArea.height));
  const clamp = (value: number, min: number, max: number) => Math.round(Math.max(Math.min(value, max), min));

  const x = at === null ? (source?.x ?? workArea.x) + cascade : at.x;
  const y = at === null ? (source?.y ?? workArea.y) + cascade : at.y;
  return { x: clamp(x, workArea.x, workArea.x + workArea.width - width), y: clamp(y, workArea.y, workArea.y + workArea.height - height), width, height };
}

/**
 * RN-ABAS-010: a janela nasceu onde e do tamanho pedidos? No Windows, a janela criada num monitor de escala diferente da do principal pode nascer no tamanho
 * errado, e o processo principal aplica os limites de novo (`setBounds`) e os confere com isto. Um pixel de folga, do arredondamento das escalas.
 */
export function boundsMatch(asked: Rect, got: Rect): boolean {
  return Math.abs(asked.x - got.x) <= 1 && Math.abs(asked.y - got.y) <= 1 && Math.abs(asked.width - got.width) <= 1 && Math.abs(asked.height - got.height) <= 1;
}
