/**
 * As medidas dos controles da área de resultado (RN-ABAS-009, seção 39). Na barra da área de resultado da aba de consulta, onde quer que ela esteja (no
 * painel, na aba do resultado, na janela do resultado), os botões têm 24 px de altura (`bar`): a atualização automática, o zoom da grade, "Exportar…",
 * "Contar total", "Onde mostrar o resultado", recolher e maximizar e "Voltar para o painel". Os mesmos controles no rodapé dos Registros, a barra dos
 * Registros e a barra de edição da grade (RN-EDIT-013) ficam com 28 px (`regular`), a medida do canvas. A barra em si tem 28 px no mínimo, e quebra em
 * mais linhas quando não cabe.
 */
export type ControlSize = "bar" | "regular";

/** A altura do botão com texto (ou com texto e ícone). */
export const controlHeight: Record<ControlSize, string> = { bar: "h-6", regular: "h-7" };

/** O botão quadrado só de ícone. */
export const iconControlSize: Record<ControlSize, string> = { bar: "size-6", regular: "size-7" };
