import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { HostProvider } from "@/components/ui";
import { elementOfTarget, hostOfDocument } from "@/lib/host/host";

import { windowKeyAction } from "../_lib/result-place";
import { resultFocus, resultSlots, type FocusTarget } from "../_lib/result-slots";

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
  // A raiz pode estar no documento da janela do resultado (RN-ABAS-017), e não no da página pedida.
  const windowPage = resultSlots.get(tabId, "window")?.ownerDocument;
  const host = resultHostOf(tabId, page) ?? (windowPage === undefined ? null : resultHostOf(tabId, windowPage));
  if (host !== null) blurFocusedIn(host);
}

/** O foco que está dentro da raiz sai (`blur`), no documento onde a raiz está agora. */
function blurFocusedIn(host: HTMLElement): void {
  const active = host.ownerDocument.activeElement;
  if (active == null || active === host.ownerDocument.body || !host.contains(active)) return;
  (active as HTMLElement).blur();
}

type ResultHostProps = {
  tabId: string;
  /** O elemento do lugar de agora: o do painel da aba, o da aba do resultado ou o da janela do resultado. `null` enquanto ele não existe (a área espera). */
  slot: HTMLElement | null;
  /** "Voltar para o painel" (RN-ABAS-013): o Ctrl+W na janela do resultado, que a raiz trata. */
  onBack?: () => void;
  /** Um link da área de resultado (o "Instalar driver") foi usado na janela do resultado: a tela abriu na janela da aba, que vem à frente (RN-ABAS-015). */
  onLink?: () => void;
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
 *
 * RN-ABAS-017, na janela do resultado: a raiz muda de DOCUMENTO (o `appendChild` a adota no da janela), e então
 * - a página de onde ela desenha (o contexto `HostProvider`) é a de agora: os diálogos, os menus, as listas e os avisos que nascem na área abrem no `body` dela, e
 *   o que guarda a janela do documento (o `ResizeObserver` daqui, o do virtualizador da grade, o campo de filtro) é refeito nela;
 * - a raiz trata o Ctrl+W ("Voltar para o painel") e não deixa as teclas de que a janela do resultado não precisa (o Ctrl+Shift+PageUp e PageDown, o Ctrl+9, o
 *   Ctrl+B, o Ctrl+Shift+E e o Ctrl+,) subirem pela árvore do React até a aba e a faixa da janela da aba (`workbench-tabs.tsx`). Na aba do resultado elas seguem
 *   para a faixa, que as trata como a RN-ABAS-012 diz.
 */
export function ResultHost({ tabId, slot, onBack, onLink, children }: ResultHostProps) {
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.setAttribute(hostAttribute, tabId);
    element.className = "flex min-h-0 min-w-0 flex-1 flex-col";
    return element;
  });
  // O documento onde a raiz está agora: muda quando ela vai para a janela do resultado, ou volta.
  const [page, setPage] = useState<Document>(() => host.ownerDocument);
  // O lugar de agora decide o documento (a raiz ainda vai chegar a ele, no efeito abaixo); sem lugar (a janela do resultado fechou), o de antes. Ajuste durante a
  // renderização, como o React recomenda para o estado que segue uma propriedade.
  const slotPage = slot?.ownerDocument ?? page;
  if (slotPage !== page) setPage(slotPage);
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
    // O `ResizeObserver` é o da janela do documento onde a raiz está, e é refeito quando ele muda (RN-ABAS-017): o de outra janela não avisaria o tamanho.
    const view = page.defaultView ?? window;
    const observer = new view.ResizeObserver(() => settle());
    host.addEventListener("scroll", remember, true);
    observer.observe(host);
    return () => {
      host.removeEventListener("scroll", remember, true);
      observer.disconnect();
    };
  }, [host, page]);
  // Sair de verdade (a aba fechou): a raiz sai da página onde estiver.
  useEffect(() => () => host.remove(), [host]);

  // O lugar mudou: a raiz vai para ele (o `appendChild` a tira de onde estava), e a rolagem volta assim que ela tiver caixa. Antes de sair de um documento (a troca
  // de lugar, ou a janela do resultado que fechou) o campo de edição que tem o foco é confirmado (RN-ABAS-011): o Ctrl+W na janela do resultado e o fechar pelo
  // sistema não passam por um clique, e o Chromium não avisa o `blur` de um elemento que sai da página.
  useLayoutEffect(() => {
    if (slot === null) {
      blurFocusedIn(host);
      return;
    }
    if (host.parentElement === slot) return;
    blurFocusedIn(host);
    slot.appendChild(host);
    scrolls.current.pending = true;
  }, [slot, host]);

  // A cada renderização: o foco pedido e a rolagem que esperavam a raiz ficar à vista (a aba do resultado que acabou de ficar ativa).
  useLayoutEffect(() => settle());

  const hostPage = hostOfDocument(page);

  /** Na janela do resultado, o Ctrl+W volta ao painel, e as teclas que ela não tem não sobem até a janela da aba (`windowKeyAction`). */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (hostPage.resultWindow === null) return;
    const action = windowKeyAction(event);
    if (action === null) return;
    if (action === "back") {
      event.preventDefault();
      onBack?.();
    }
    event.stopPropagation();
  }

  /** Na janela do resultado, o link usado abre a tela na janela da aba (o roteador é o dela), e ela vem à frente. */
  function handleClick(event: MouseEvent<HTMLElement>) {
    if (hostPage.resultWindow !== null && elementOfTarget(event.target)?.closest("a[href]") != null) onLink?.();
  }

  // `display: contents`: o elemento só carrega a tecla e o clique; a área de dentro é filha direta da raiz, no layout.
  return createPortal(
    <HostProvider host={hostPage}>
      <div style={{ display: "contents" }} onKeyDown={handleKeyDown} onClick={handleClick}>
        {children}
      </div>
    </HostProvider>,
    host,
  );
}
