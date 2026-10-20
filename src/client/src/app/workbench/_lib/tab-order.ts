import { z } from "zod";

/**
 * A ordem das abas (RN-ABAS-001) e o que decide o arrasto delas, sem tocar a página: para onde a aba vai, onde a marca de soltar aparece, o
 * atalho de teclado e o que o arraste leva (RN-ABAS-010). A ordem vale enquanto a janela está aberta e volta na próxima entrada (RN-ABAS-006).
 */

/**
 * A lista com a aba no lugar novo, ou `null` quando nada muda (a aba não está na lista, ou volta ao lugar onde já estava). `insertAt` é a
 * posição na faixa ANTES de a aba sair dela, como a marca de soltar a mostra (de 0, antes da primeira, até `tabs.length`, depois da última);
 * fora disso vale a ponta mais próxima. Os objetos são os mesmos: só a ordem muda.
 */
export function moveTab<T extends { id: string }>(tabs: readonly T[], tabId: string, insertAt: number): T[] | null {
  const from = tabs.findIndex((tab) => tab.id === tabId);
  if (from < 0) return null;

  const at = Math.min(tabs.length, Math.max(0, Math.trunc(insertAt)));
  // Soltar logo antes dela, ou logo depois, é o mesmo lugar.
  if (at === from || at === from + 1) return null;

  const rest = tabs.filter((_, index) => index !== from);
  const to = at > from ? at - 1 : at;
  return [...rest.slice(0, to), tabs[from], ...rest.slice(to)];
}

/** Uma posição para a esquerda (-1) ou para a direita (1), sem dar a volta: na ponta, `null`. */
export function shiftTab<T extends { id: string }>(tabs: readonly T[], tabId: string, delta: -1 | 1): T[] | null {
  const from = tabs.findIndex((tab) => tab.id === tabId);
  if (from < 0 || from + delta < 0 || from + delta >= tabs.length) return null;

  return moveTab(tabs, tabId, delta < 0 ? from - 1 : from + 2);
}

/** Onde a aba arrastada entra na faixa: antes da primeira aba cuja metade está à direita do ponteiro (as caixas na ordem da faixa). */
export function dropIndex(rects: readonly { left: number; width: number }[], x: number): number {
  const index = rects.findIndex((rect) => x < rect.left + rect.width / 2);
  return index < 0 ? rects.length : index;
}

/** Ctrl+Shift+PageUp (-1) e Ctrl+Shift+PageDown (1) movem a aba ativa; sem o Shift é trocar de aba, e com Alt é outro atalho. */
export function tabMoveShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): -1 | 1 | null {
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return null;
  if (event.key === "PageUp") return -1;
  return event.key === "PageDown" ? 1 : null;
}

/**
 * Os tipos do dado que a aba arrastada leva (RN-ABAS-010): o tipo diz o que é, e ele se lê já no `dragenter` e no `dragover`; o conteúdo, só no `drop`,
 * porque o Chromium o esconde antes.
 * - `application/x-prism-tab`: a aba de consulta e a de tabela. A faixa e o véu de qualquer janela do Prism a aceitam (RN-ABAS-001 a 003).
 * - `application/x-prism-result-tab`: a aba do resultado (RN-ABAS-012). Só a faixa e o véu da janela de origem a aceitam; as outras janelas a reconhecem
 *   e a recusam (sem véu, com o ponteiro de proibido). Quem a arrasta escreve o mesmo dado (`writeTabDrag`, com o id da aba do resultado) e termina o
 *   arraste pelo mesmo caminho (`endTabDrag`, com `kind: "result"`), e o ponto que volta abre a janela do resultado (RN-ABAS-013).
 */
export const tabDragType = "application/x-prism-tab";
export const resultTabDragType = "application/x-prism-result-tab";

/** O que se arrasta: uma aba (`tab`) ou a aba do resultado (`result`). */
export type TabDragKind = "tab" | "result";

/** Pelos tipos do arraste (`dataTransfer.types`), o que é: uma aba do Prism, a aba do resultado, ou outra coisa (`null`: texto, um arquivo). */
export function dragKindOf(types: readonly string[]): TabDragKind | null {
  if (types.includes(tabDragType)) return "tab";
  return types.includes(resultTabDragType) ? "result" : null;
}

/** O tipo que cada coisa arrastada escreve. */
export const dragTypeOf = (kind: TabDragKind) => (kind === "tab" ? tabDragType : resultTabDragType);

/** Qual aba e de qual janela (o número dela, `null` fora do Electron). O dado vem do arrasto, que outro programa também pode soltar aqui: é conferido. */
const tabDragSchema = z.object({ windowId: z.number().int().positive().nullable(), tabId: z.uuid() });

export type TabDrag = z.infer<typeof tabDragSchema>;

export function writeTabDrag(drag: TabDrag): string {
  return JSON.stringify(drag);
}

/** O que a aba solta trouxe, ou `null` se não é uma aba do Prism. */
export function readTabDrag(raw: string): TabDrag | null {
  try {
    const parsed = tabDragSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
