import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { resultFocus, type FocusTarget } from "../_lib/result-slots";

/** O atributo da raiz da área de resultado de cada aba, com o id da aba, e o do botão "Onde mostrar o resultado" dentro dela. */
const hostAttribute = "data-result-host";
export const placeButtonAttribute = "data-result-place-button";

/** A raiz da área de resultado da aba na página desta janela, onde quer que ela esteja (o painel, a aba do resultado). */
export function resultHostOf(tabId: string, page: Document = document): HTMLElement | null {
  return page.querySelector<HTMLElement>(`[${hostAttribute}="${tabId}"]`);
}

/** A raiz tem caixa (está na página e à vista): só aí o foco e a rolagem valem. */
const hasBox = (element: HTMLElement) => element.isConnected && element.getClientRects().length > 0;

/**
 * RN-ABAS-012 e 014: o foco no resultado, dentro da raiz: a grade, quando ela está à vista e fora de uma área inerte (a recolhida), e senão o botão "Onde
 * mostrar o resultado". `placeButton` vai direto ao botão. Devolve se o foco chegou.
 */
export function focusResultIn(root: ParentNode, target: Exclude<FocusTarget, "editor"> = "result"): boolean {
  const button = root.querySelector<HTMLElement>(`[${placeButtonAttribute}]`);
  const grid = target === "result" ? root.querySelector<HTMLElement>('[role="grid"]') : null;
  const chosen = grid !== null && grid.closest("[inert]") === null ? grid : button;
  if (chosen === null) return false;
  chosen.focus({ preventScroll: true });
  return chosen.ownerDocument.activeElement === chosen;
}

/**
 * RN-ABAS-011: antes de a área sair de onde está, o campo de edição de uma célula aberto é confirmado, como quando perde o foco (RN-EDIT-001): o foco que
 * está dentro dela sai (`blur`), e o campo confirma pelo caminho de sempre. O Chromium não avisa o `blur` de um elemento que sai da página.
 */
export function releaseFocusIn(tabId: string, page: Document = document): void {
  const host = resultHostOf(tabId, page);
  const active = host?.ownerDocument.activeElement;
  if (host == null || active == null || active === host.ownerDocument.body || !host.contains(active)) return;
  (active as HTMLElement).blur();
}

type ResultHostProps = {
  tabId: string;
  /** O elemento do lugar de agora: o do painel da aba, o da aba do resultado ou o da janela do resultado. `null` enquanto ele não existe (a área espera). */
  slot: HTMLElement | null;
  children: ReactNode;
};

/**
 * A área de resultado da aba, UMA só, onde quer que ela esteja (seção 39: RN-ABAS-011 e 017). Ela é desenhada por um portal do React numa raiz própria (um
 * `div` criado uma vez por aba), e é essa raiz que muda de lugar: o painel abaixo do editor, o painel da aba do resultado, ou a janela do resultado. Mudar de
 * lugar não desmonta nada: a grade, a seleção, as larguras das colunas, o zoom da grade, a aba do script escolhida e as pendências ficam; o executor nem fica
 * sabendo. Na árvore do React, a área continua dentro da aba de consulta: as teclas dela (F5, Alt+X, Ctrl+S) e as da faixa (Ctrl+W, Ctrl+Shift+PageUp e
 * PageDown) sobem até lá como subiam.
 *
 * O que a página perde quando um elemento sai dela e volta, a raiz devolve: a rolagem de cada elemento que rolou lá dentro (guardada a cada `scroll`, porque
 * quando a raiz sai o elemento já não tem caixa para ler) volta quando ela tem caixa de novo, também se o lugar novo ainda está escondido (a aba do
 * resultado não ativa) e só aparece depois. O foco que a troca pediu (`resultFocus`) vai quando ela chega e está à vista.
 */
export function ResultHost({ tabId, slot, children }: ResultHostProps) {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.setAttribute(hostAttribute, tabId);
    element.className = "flex min-h-0 min-w-0 flex-1 flex-col";
    return element;
  });
  // A rolagem de cada elemento de dentro, e se ela ainda tem de voltar (a raiz mudou de lugar e não tinha caixa).
  const scrolls = useRef({ positions: new Map<Element, { top: number; left: number }>(), pending: false });

  /** Devolve a rolagem e leva o foco pedido, quando a raiz tem caixa. */
  const settle = useEffectEvent(() => {
    if (!hasBox(host)) return;
    const held = scrolls.current;
    if (held.pending) {
      held.pending = false;
      for (const [element, { top, left }] of held.positions) {
        if (!host.contains(element)) {
          held.positions.delete(element);
          continue;
        }
        if (element.scrollTop !== top) element.scrollTop = top;
        if (element.scrollLeft !== left) element.scrollLeft = left;
      }
    }
    const target = resultFocus.take(tabId, ["result", "placeButton"]);
    if (target === "result" || target === "placeButton") focusResultIn(host, target);
  });

  useEffect(() => {
    // O `nodeType`, e não o `instanceof Element` desta janela: a raiz pode estar no documento de outra (RN-ABAS-017).
    const remember = (event: Event) => {
      const element = event.target as Element | null;
      if (element?.nodeType === 1) scrolls.current.positions.set(element, { top: element.scrollTop, left: element.scrollLeft });
    };
    const view = host.ownerDocument.defaultView ?? window;
    const observer = new view.ResizeObserver(() => settle());
    host.addEventListener("scroll", remember, true);
    observer.observe(host);
    return () => {
      host.removeEventListener("scroll", remember, true);
      observer.disconnect();
      host.remove();
    };
  }, [host]);

  // O lugar mudou: a raiz vai para ele (o `appendChild` a tira de onde estava), e a rolagem volta assim que ela tiver caixa.
  useLayoutEffect(() => {
    if (slot === null || host.parentElement === slot) return;
    slot.appendChild(host);
    scrolls.current.pending = true;
  }, [slot, host]);

  // A cada renderização: o foco pedido e a rolagem que esperavam a raiz ficar à vista (a aba do resultado que acabou de ficar ativa).
  useLayoutEffect(() => settle());

  return createPortal(children, host);
}
