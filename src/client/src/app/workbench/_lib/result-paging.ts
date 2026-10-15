import type { RunnerState } from "./use-query-runner";

/** Duas linhas da grade (32 px cada): a distância do fim a partir da qual ela já pede a página seguinte. */
export const loadMoreMargin = 64;

/**
 * A grade está no fim, ou perto dele (RN-CONFIG-005). Um conteúdo menor que a janela já está no fim: não há o que
 * rolar. Uma grade sem altura (a aba escondida, a área recolhida) nunca está: ela não busca por trás de ninguém.
 */
export function nearEnd(view: { scrollTop: number; clientHeight: number; scrollHeight: number }): boolean {
  return view.clientHeight > 0 && view.scrollHeight - view.scrollTop - view.clientHeight <= loadMoreMargin;
}

/**
 * Quando a grade pode pedir a página seguinte sozinha (RN-CONFIG-005): a preferência ligada, linhas na tela, mais
 * a ler e nada em andamento. Uma por vez (página, contagem e comando seguram a próxima), nunca durante um
 * cancelamento, e o cursor que fechou (inclusive por um cancelamento) é o fim: de ali em diante só o botão. Sem
 * sessão, a página seguinte só diria que o cursor fechou.
 */
export function autoLoadArmed(state: RunnerState, { enabled, connected }: { enabled: boolean; connected: boolean }): boolean {
  if (!enabled || !connected || state.status !== "rows") return false;
  return state.hasMore && !state.cursorClosed && !state.loadingMore && !state.counting && !state.cancelling;
}
