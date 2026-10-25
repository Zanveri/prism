import type { ResultPlace } from "./workbench-model";

/** Os textos do lugar do resultado (seção 39: RN-ABAS-011 a 016), na ordem em que a especificação os escreve. */
export const resultPlaceCopy = {
  /** O nome de cada lugar no menu "Onde mostrar o resultado" (RN-ABAS-014) e em Configurações › Resultados (RN-CONFIG-010). */
  places: { panel: "No painel", tab: "Numa aba", window: "Numa janela" } satisfies Record<ResultPlace, string>,
  /** O lugar de agora, no fim do nome e da dica do botão: "Onde mostrar o resultado: no painel". */
  placeLower: { panel: "no painel", tab: "numa aba", window: "numa janela" } satisfies Record<ResultPlace, string>,
  button: {
    label: "Onde mostrar o resultado",
    named: (place: string) => `Onde mostrar o resultado: ${place}`,
    menuLabel: "Onde mostrar o resultado",
  },
  /** RN-ABAS-014: "Numa janela" desabilitado enquanto a aba vai para outra janela. */
  moving: "A aba está indo para outra janela.",
  /** RN-ABAS-014: o processo principal recusou a janela, ou ela não abriu; o resultado fica onde estava. */
  windowFailed: "Não foi possível abrir a janela do resultado.",
  /** RN-ABAS-014: cada troca, para o leitor de tela, numa região `role="status"`, sem toast. */
  announcement: { panel: "Resultado agora no painel.", tab: "Resultado agora numa aba.", window: "Resultado agora numa janela." } satisfies Record<ResultPlace, string>,
  /** RN-ABAS-012: a aba do resultado. */
  tab: {
    title: (title: string) => `Resultado · ${title}`,
    hint: (title: string) => `Resultado de ${title}. F6 alterna com a consulta.`,
    panelLabel: (title: string) => `Resultado de ${title}`,
    /** O ponto, no nome da aba: "Resultado · consulta-2.sql, executando". */
    running: ", executando",
    unseen: ", resultado novo",
    close: (title: string) => `Voltar o resultado de ${title} para o painel`,
    closeHint: (shortcut: string) => `Voltar para o painel (${shortcut})`,
    menuLabel: (title: string) => `Aba Resultado · ${title}`,
    goToQuery: "Ir para a consulta",
    backToPanel: "Voltar para o painel",
    f6: "F6",
  },
  /** RN-ABAS-013: a janela do resultado. */
  window: {
    /** O título da barra da janela, da barra de tarefas e do Alt+Tab. */
    title: (title: string) => `Resultado · ${title} — Prism`,
    /** O nome do ponto de referência principal (`main`) do documento dela. */
    mainLabel: (title: string) => `Resultado de ${title}`,
    back: "Voltar para o painel",
    backHint: (shortcut: string) => `Voltar para o painel (${shortcut})`,
  },
  /** RN-CONFIG-010: em Configurações › Resultados. */
  settings: {
    label: "Onde o resultado das abas novas aparece",
    hint: "Vale para as abas de consulta abertas daqui em diante. Cada aba guarda o lugar dela, que o botão 'Onde mostrar o resultado' da área de resultado troca.",
  },
} as const;
