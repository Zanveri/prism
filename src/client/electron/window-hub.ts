import { z } from "zod";

import { peerEventSchema, tabMoveRequestSchema, tabRequestSchema, windowSummarySchema, type TabDelivery, type TabMoveReply, type WindowEntry, type WindowSummary } from "./window-messages";

/**
 * As janelas do app (RN-ABAS-002 a 005), sem depender do Electron: quem são, qual está pronta para receber uma aba, a aba que espera a janela
 * ficar pronta e o que uma janela conta às outras sobre o cofre. Só daqui sai uma janela nova (RN-ABAS-005), e nenhuma janela fala com outra:
 * tudo passa por aqui, conferido pelo schema de `window-messages.ts`. O `main.ts` liga isto às janelas de verdade.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };

/** Os avisos que saem daqui para uma janela. */
export type HubChannel = "prism:windows-tab" | "prism:windows-give-tab" | "prism:session-peer";

/** O que o centro usa de uma janela. */
export type HubWindow = {
  id: number;
  send(channel: HubChannel, payload: unknown): void;
  bounds(): Rect;
  focus(): void;
};

export type WindowHubDeps = {
  /** Cria a janela nova (a área de trabalho inteira): onde a aba foi solta, ou, sem ponto, ao lado da de origem. `null` se não deu. */
  createWindow(placement: { at: Point | null; source: Rect | null }): HubWindow | null;
  log(message: string): void;
};

type Pending = { delivery: TabDelivery; sourceId: number };
type Entry = { window: HubWindow; number: number; ready: boolean; summary: WindowSummary; queue: Pending[] };

const readyFlag = z.boolean();

function contains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

export function createWindowHub(deps: WindowHubDeps) {
  const entries = new Map<number, Entry>();
  let lastNumber = 0;

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
     * Leva a aba que a janela `fromId` mandou. Para outra janela: se ela existe e não é a mesma. Para uma janela nova: abre onde a aba foi solta, se
     * o ponto não está em cima de outra janela do Prism. Se está, a aba não sai por aqui: o fim do arrasto, na janela de origem, nem sempre sabe
     * que a outra janela a aceitou (entre janelas, o Chromium às vezes diz que ninguém aceitou), e quem a leva, na posição em que foi solta, é o
     * pedido da janela que a recebeu na faixa (`requestTab`). A janela de origem só tira a aba da faixa quando a resposta é `ok`.
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

      const at = target.at ?? null;
      if (at !== null && windowAt(at, fromId) !== null) return { ok: false, reason: "overWindow" };

      const created = deps.createWindow({ at, source: source.window.bounds() });
      if (created === null) return { ok: false, reason: "noWindow" };

      add(created);
      deliver(created.id, { transfer }, fromId);
      return { ok: true };
    },

    /** A aba de outra janela foi solta na faixa de `toId`: pede à janela de origem que a mande para lá, pelo caminho de sempre dela. */
    requestTab(toId: number, raw: unknown): boolean {
      const parsed = tabRequestSchema.safeParse(raw);
      if (!parsed.success || !entries.has(toId) || parsed.data.fromWindowId === toId) return false;

      const source = entries.get(parsed.data.fromWindowId);
      if (source === undefined) return false;

      source.window.send("prism:windows-give-tab", { tabId: parsed.data.tabId, target: { kind: "window", windowId: toId, index: parsed.data.index } });
      return true;
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

/** Onde, na janela nova, fica o ponto em que a aba foi solta: perto da primeira aba da faixa (depois do navegador e da barra superior). */
const grab = { x: 360, y: 80 };
/** Pelo menu, a janela nova abre este tanto abaixo e à direita da de origem. */
const cascade = 32;

/**
 * O lugar da janela nova: do tamanho da janela de origem (RN-ABAS-002), com a faixa de abas onde a aba foi solta ou, pelo menu, um pouco abaixo e à
 * direita da de origem; e sempre dentro da área útil da tela daquele ponto (sem a barra de tarefas), encolhida se a tela for menor.
 */
export function newWindowBounds({ at, source, workArea }: { at: Point | null; source: Rect | null; workArea: Rect }): Rect {
  const width = Math.min(source?.width ?? 1440, workArea.width);
  const height = Math.min(source?.height ?? 900, workArea.height);
  const clamp = (value: number, min: number, max: number) => Math.round(Math.min(Math.max(value, min), max));

  const x = at === null ? (source?.x ?? workArea.x) + cascade : at.x - grab.x;
  const y = at === null ? (source?.y ?? workArea.y) + cascade : at.y - grab.y;
  return { x: clamp(x, workArea.x, workArea.x + workArea.width - width), y: clamp(y, workArea.y, workArea.y + workArea.height - height), width, height };
}
