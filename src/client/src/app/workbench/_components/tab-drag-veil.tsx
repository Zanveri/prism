import { useEffect, useRef, useState, type RefObject } from "react";

import { dragKindOf, readTabDrag, tabDragType } from "../_lib/tab-order";
import { veilFor, type TabDragSession, type Veil } from "../_lib/tab-drag";

/** O marcador da faixa de abas na página: o que está dentro dela é da faixa (RN-ABAS-001), e o resto é do véu. */
export const tabStripAttribute = "data-tab-strip";

/** O alvo do evento está dentro de uma faixa de abas? Pelo `nodeType`, e não pelo `instanceof` desta janela (RN-ABAS-017: o elemento pode ser de outro documento). */
export function isInTabStrip(target: EventTarget | null): boolean {
  const node = target as { nodeType?: number; closest?: (selector: string) => unknown } | null;
  return node?.nodeType === 1 && typeof node.closest === "function" && node.closest(`[${tabStripAttribute}]`) !== null;
}

/** Onde a frase do véu fica: no meio da área das abas, abaixo da faixa. */
type Box = { left: number; top: number; width: number; height: number };

type Shown = Veil & { box: Box | null };

type TabDragVeilProps = {
  /** O arraste que começou nesta janela (`createTabDragSession`): sem ele, a aba que passa é de outra janela. */
  session: TabDragSession;
  /** O número desta janela (`null` fora do Electron). */
  windowId: number | null;
  /** RN-ABAS-002: a janela tem uma aba só, e a aba dela não sai pelo véu. */
  onlyTab: boolean;
  /** RN-ABAS-003: a aba de outra janela foi solta no véu desta: ela entra no fim da faixa. */
  onReceive: (fromWindowId: number, tabId: string) => void;
  /** A área das abas (a faixa e os painéis): a frase fica no meio dela, abaixo da faixa. */
  area: RefObject<HTMLElement | null>;
};

/**
 * O véu do arraste da aba (RN-ABAS-010 e 003). Enquanto uma aba do Prism passa por esta janela, fora da faixa, a janela inteira, menos a faixa (o navegador,
 * a barra superior, a de status e a área das abas), fica coberta, com a borda tracejada no acento do tema e a frase no meio da área das abas; sobre a faixa
 * ele some, e volta o marcador do lugar. O véu é o alvo do `dragover` e do `drop` da janela inteira: a raiz da página escuta o `dragenter`, o `dragover`, o
 * `dragleave` e o `drop` dos tipos da aba na fase de captura e para a propagação antes do editor (o CodeMirror), da grade e dos campos, que nunca recebem
 * a aba (soltá-la no editor não escreve nada nele). O que é da faixa passa, e ela responde. Um contador de entradas e saídas diz quando a aba saiu da
 * janela, sem piscar ao passar de um elemento a outro; o primeiro movimento do ponteiro depois de um arraste (que não move o ponteiro enquanto dura) apaga
 * um véu que tenha ficado.
 *
 * O véu é só visual (`aria-hidden`): pelo teclado e pelo leitor de tela, o caminho é "Mover para nova janela" no menu da aba. A faixa fica por cima dele
 * (`z-50` na faixa, `z-40` aqui).
 */
export function TabDragVeil({ session, windowId, onlyTab, onReceive, area }: TabDragVeilProps) {
  const [shown, setShown] = useState<Shown | null>(null);
  const latest = useRef({ windowId, onlyTab, onReceive });
  useEffect(() => {
    latest.current = { windowId, onlyTab, onReceive };
  });

  useEffect(() => {
    const page = area.current?.ownerDocument;
    if (page === undefined) return;
    let depth = 0;
    let visible: Shown | null = null;

    const show = (next: Shown | null) => {
      if (visible === next || (visible !== null && next !== null && visible.text === next.text && visible.accepts === next.accepts)) return;
      visible = next;
      setShown(next);
    };
    const boxOf = (): Box | null => {
      const element = area.current;
      if (element === null) return null;
      const box = element.getBoundingClientRect();
      const strip = element.querySelector(`[${tabStripAttribute}]`)?.getBoundingClientRect();
      const top = strip === undefined ? box.top : strip.bottom;
      return { left: box.left, top, width: box.width, height: Math.max(0, box.bottom - top) };
    };
    const veilNow = (kind: NonNullable<ReturnType<typeof dragKindOf>>) => veilFor({ kind, fromHere: session.dragging() !== null, onlyTab: latest.current.onlyTab, available: latest.current.windowId !== null });

    /** O `dragenter` e o `dragover` fora da faixa: o véu responde, e ninguém mais vê o evento. */
    function answer(event: DragEvent) {
      const kind = dragKindOf([...(event.dataTransfer?.types ?? [])]);
      if (kind === null) return;
      if (isInTabStrip(event.target)) return show(null);

      event.stopPropagation();
      const veil = veilNow(kind);
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = veil?.accepts === true ? "move" : "none";
      if (veil?.accepts === true) event.preventDefault();
      show(veil === null ? null : { ...veil, box: visible?.box ?? boxOf() });
    }

    function onEnter(event: DragEvent) {
      if (dragKindOf([...(event.dataTransfer?.types ?? [])]) === null) return;
      depth += 1;
      answer(event);
    }

    function onLeave(event: DragEvent) {
      if (dragKindOf([...(event.dataTransfer?.types ?? [])]) === null) return;
      depth = Math.max(0, depth - 1);
      if (!isInTabStrip(event.target)) event.stopPropagation();
      if (depth === 0) show(null);
    }

    function onDrop(event: DragEvent) {
      const kind = dragKindOf([...(event.dataTransfer?.types ?? [])]);
      if (kind === null) return;
      depth = 0;
      show(null);
      if (isInTabStrip(event.target)) return;

      event.stopPropagation();
      event.preventDefault();
      if (veilNow(kind)?.accepts !== true) return;
      // A aba desta janela: o véu marca a soltura, e o pedido da janela nova sai no `dragend`, que vem depois (RN-ABAS-010).
      if (session.dragging() !== null) return session.mark("veil");
      // A aba de outra janela: ela vem para o fim da faixa desta (RN-ABAS-003). O conteúdo do arraste só se lê aqui, no `drop`.
      const drag = kind === "tab" ? readTabDrag(event.dataTransfer?.getData(tabDragType) ?? "") : null;
      if (drag !== null && drag.windowId !== null && drag.windowId !== latest.current.windowId) latest.current.onReceive(drag.windowId, drag.tabId);
    }

    function reset() {
      depth = 0;
      show(null);
    }

    page.addEventListener("dragenter", onEnter, true);
    page.addEventListener("dragover", answer, true);
    page.addEventListener("dragleave", onLeave, true);
    page.addEventListener("drop", onDrop, true);
    page.addEventListener("dragend", reset, true);
    page.addEventListener("pointermove", reset, true);
    return () => {
      page.removeEventListener("dragenter", onEnter, true);
      page.removeEventListener("dragover", answer, true);
      page.removeEventListener("dragleave", onLeave, true);
      page.removeEventListener("drop", onDrop, true);
      page.removeEventListener("dragend", reset, true);
      page.removeEventListener("pointermove", reset, true);
    };
  }, [area, session]);

  if (shown === null) return null;

  return (
    <div aria-hidden data-tab-drag-veil={shown.accepts ? "accepts" : "refuses"} className="fixed inset-0 z-40 border-2 border-dashed border-accent bg-panel/85">
      <p
        style={shown.box === null ? undefined : { left: shown.box.left, top: shown.box.top, width: shown.box.width, height: shown.box.height }}
        className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-ink"
      >
        {shown.text}
      </p>
    </div>
  );
}
