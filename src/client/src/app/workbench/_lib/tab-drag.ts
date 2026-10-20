import type { TabDragEnd } from "../../../../electron/window-messages";

import type { TabDragKind } from "./tab-order";
import { workbenchCopy } from "./workbench.copy";

const copy = workbenchCopy.tabs;

/**
 * O arraste de uma aba (RN-ABAS-010), sem tocar a página: o que a janela de origem sabe do arraste dela, o que o véu mostra em cada janela e o que o fim
 * do arraste pede ao processo principal. Quem decide o fim é quem recebeu a soltura, e não o `dropEffect` do `dragend`: a faixa e o véu desta janela marcam
 * a soltura que receberam (`mark`), e o `dragend`, que vem depois, lê a marca (`finish`).
 */

/** Quem recebeu a soltura nesta janela: a faixa (a aba mudou de lugar, RN-ABAS-001) ou o véu (longe da faixa: a janela nova). */
export type DragDrop = "strip" | "veil";

/** O arraste em andamento nesta janela, como o véu e a faixa o veem. */
export type DragInFlight = { tabId: string; kind: TabDragKind };

/** O que o `dragend` sabe do arraste que terminou. */
export type EndedDrag = DragInFlight & { dropped: DragDrop | null };

/**
 * O arraste que começou nesta janela. `begin` guarda o arraste na hora, sem avisar ninguém: nada muda na página dentro do `dragstart`, porque o Chromium
 * cancela o arraste cujo elemento muda no próprio `dragstart`; quem desenha (as marcas) é avisado depois (`schedule`, um `setTimeout` de 0). `whenIdle`
 * adia o que tiraria da página o elemento da aba arrastada (a aba que outra janela recebeu e que sai daqui) até o fim do arraste: o Chromium não avisa o fim
 * do arraste de um elemento que saiu dela.
 */
export function createTabDragSession(schedule: (run: () => void) => void = (run) => void setTimeout(run, 0)) {
  let current: (DragInFlight & { dropped: DragDrop | null }) | null = null;
  let shown: DragInFlight | null = null;
  const listeners = new Set<() => void>();
  const waiting = new Map<string, (() => void)[]>();

  function publish(next: DragInFlight | null) {
    if (shown?.tabId === next?.tabId && shown?.kind === next?.kind) return;
    shown = next;
    for (const listener of listeners) listener();
  }

  return {
    begin(tabId: string, kind: TabDragKind): void {
      current = { tabId, kind, dropped: null };
      schedule(() => {
        if (current?.tabId === tabId) publish({ tabId, kind });
      });
    },
    /** O arraste desta janela, na hora (o véu decide por ele no `dragenter`, antes de qualquer aviso). */
    dragging: (): DragInFlight | null => (current === null ? null : { tabId: current.tabId, kind: current.kind }),
    /** A faixa ou o véu desta janela recebeu a soltura. */
    mark(dropped: DragDrop): void {
      if (current !== null) current.dropped = dropped;
    },
    /** O `dragend`: o arraste acabou. Devolve o que se sabe dele (ou `null`, sem arraste) e solta o que esperava o fim. */
    finish(): EndedDrag | null {
      const ended = current;
      current = null;
      publish(null);
      if (ended === null) return null;
      const pending = waiting.get(ended.tabId) ?? [];
      waiting.delete(ended.tabId);
      for (const run of pending) run();
      return ended;
    },
    /** Roda agora, ou, com a aba sendo arrastada, no fim do arraste. */
    whenIdle(tabId: string, run: () => void): void {
      if (current?.tabId !== tabId) return run();
      waiting.set(tabId, [...(waiting.get(tabId) ?? []), run]);
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: (): DragInFlight | null => shown,
  };
}

export type TabDragSession = ReturnType<typeof createTabDragSession>;

/**
 * Uma aba só na janela (RN-ABAS-002 e 010): a janela já é aquela aba, e arrastá-la para fora não faz nada; "Mover para nova janela" fica desabilitado. A aba
 * do resultado e a aba dela contam como uma (RN-ABAS-012).
 */
export function isOnlyTab(tabs: readonly unknown[]): boolean {
  return tabs.length <= 1;
}

/** O que o véu mostra: a frase, e se a soltura vale ali (`accepts`: o ponteiro de mover; senão, o de proibido e nada acontece). */
export type Veil = { text: string; accepts: boolean };

/**
 * O véu de uma janela enquanto uma aba do Prism passa por ela, fora da faixa (RN-ABAS-010 e 003). `fromHere`: o arraste começou nesta janela.
 * - a aba desta janela: "Solte para abrir numa janela nova"; com uma aba só, "Esta já é a única aba da janela.", sem aceitar;
 * - a aba do resultado desta janela: "Solte para abrir o resultado numa janela", também com uma aba só;
 * - a aba de outra janela: "Solte para trazer a aba para esta janela" (ela entra no fim da faixa), também na janela sem abas;
 * - a aba do resultado de outra janela: nenhum véu, e a soltura não vale.
 * Fora do app (no navegador do desenvolvimento, `available` falso) não há janela nova nem outra janela: nenhum véu.
 */
export function veilFor({ kind, fromHere, onlyTab, available = true }: { kind: TabDragKind; fromHere: boolean; onlyTab: boolean; available?: boolean }): Veil | null {
  if (!available) return null;
  if (kind === "result") return fromHere ? { text: copy.drag.resultToWindow, accepts: true } : null;
  if (!fromHere) return { text: copy.drag.bringHere, accepts: true };
  return onlyTab ? { text: copy.drag.onlyTab, accepts: false } : { text: copy.drag.toNewWindow, accepts: true };
}

/** O que o `dragend` leu do evento: o `dropEffect`, o ponto na tela e se ele caiu dentro da página desta janela. */
export type DragEndEvent = { effect: string; screen: { x: number; y: number }; client: { x: number; y: number }; viewport: { width: number; height: number } };

/**
 * RN-ABAS-010: o que o fim do arraste de uma aba desta janela pede ao processo principal, ou `null` quando não há o que pedir: a soltura na própria faixa
 * (a aba já mudou de lugar), fora do Electron (não há janela nova) e a aba que é a única da janela (só a aba de consulta ou de tabela; a do resultado vai
 * para a janela dela também assim). O ponto do `dragend` vai junto, mas só vale onde o processo principal não lê o ponteiro (o Wayland).
 */
export function dragEndRequest(ended: EndedDrag | null, event: DragEndEvent, { windowId, onlyTab }: { windowId: number | null; onlyTab: boolean }): TabDragEnd | null {
  if (ended === null || ended.dropped === "strip" || windowId === null) return null;
  if (ended.kind === "tab" && onlyTab) return null;

  const at = Number.isFinite(event.screen.x) && Number.isFinite(event.screen.y) ? { x: clampCoordinate(event.screen.x), y: clampCoordinate(event.screen.y) } : null;
  const inPage = event.client.x >= 0 && event.client.y >= 0 && event.client.x < event.viewport.width && event.client.y < event.viewport.height;
  const effect = event.effect === "copy" || event.effect === "link" || event.effect === "move" ? event.effect : "none";
  return { tabId: ended.tabId, kind: ended.kind, dropped: ended.dropped === "veil" ? "veil" : "none", effect, at, inPage };
}

/** O ponto que o schema aceita: inteiro, dentro de ±100.000 px. */
const clampCoordinate = (value: number) => Math.max(-100_000, Math.min(100_000, Math.round(value)));
