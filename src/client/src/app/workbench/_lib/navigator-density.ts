import type { NavigatorDensity } from "@/app/settings/_lib/preferences";

/**
 * As medidas de cada densidade do navegador (RN-NAV-011), a da árvore das conexões e a da árvore da seção Scripts, que usa as mesmas linhas e o mesmo recuo
 * por nível (RN-SCRIPT-008). "Confortável" é o desenho do canvas: linha de 30 px, 10 px de recuo na raiz e 16 px a mais por nível. "Compacta" põe mais itens na mesma altura, como o DBeaver: linha de 22 px e 12 px por nível. Nas duas o texto
 * é o 13/20 da área de trabalho (RN-CONFIG-009), e o que a linha leva cabe sem corte: as etiquetas do banco e do ambiente têm 18 px, o ponto de estado 8
 * px, e os botões de ação passam de 24 px a 20 px na compacta. As classes estão escritas por inteiro, para o Tailwind as achar.
 */
export type NavigatorMetrics = {
  /** A altura da linha da árvore, em pixels: a lista virtual estima cada linha com ela. */
  rowHeight: number;
  /** A classe da mesma altura, na linha e na linha de "carregando". */
  rowClass: string;
  /** O recuo da raiz e o de cada nível a mais. */
  baseIndent: number;
  levelIndent: number;
  /** Os botões de ação da linha (nova consulta, atualizar, desconectar): a classe do tamanho, e quanto cada um ocupa com o espaço até o vizinho. */
  actionClass: string;
  actionStride: number;
};

export const navigatorMetrics: Readonly<Record<NavigatorDensity, NavigatorMetrics>> = {
  comfortable: { rowHeight: 30, rowClass: "h-[30px]", baseIndent: 10, levelIndent: 16, actionClass: "size-6", actionStride: 26 },
  compact: { rowHeight: 22, rowClass: "h-[22px]", baseIndent: 6, levelIndent: 12, actionClass: "size-5", actionStride: 22 },
};

/** O recuo de uma linha da árvore, pela profundidade do nó. */
export function rowIndent(metrics: NavigatorMetrics, depth: number): number {
  return metrics.baseIndent + depth * metrics.levelIndent;
}

/** Quanto do fim da linha os botões de ação ocupam (com a folga da borda), para o conteúdo se afastar deles em vez de ficar escondido. */
export function actionsWidth(metrics: NavigatorMetrics, buttons: number): number {
  return buttons * metrics.actionStride + 8;
}
