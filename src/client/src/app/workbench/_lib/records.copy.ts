/**
 * Os textos novos da vista Registros e da grade do resultado (seção 20 da especificação). Os de antes seguem em `workbench.copy.ts`; os que estes
 * trocam (`tableTab.records.filterLabel`, `where`, `placeholder` e `severalStatements`) ficaram lá, sem uso, até o fechamento da leva.
 */
export const recordsCopy = {
  // RN-TABELA-010: o campo recebe o que vem depois do nome da tabela (a condição, a ordem ou as duas), e não só a condição.
  filter: {
    label: "Filtro e ordem dos registros",
    hint: "O que vem depois do nome da tabela: uma condição, uma ordem (ORDER BY) ou as duas.",
    placeholder: "status = 'aberta' ORDER BY quantidade DESC",
    severalStatements: "O filtro tem mais de um comando. Escreva só a condição e a ordem, sem ponto e vírgula entre comandos.",
  },

  // As grades do resultado (a da aba de consulta e a dos Registros).
  grid: {
    // RN-GRADE-009: a divisa à direita do cabeçalho de cada coluna.
    resizeColumn: (name: string) => `Largura da coluna ${name}`,
    columnWidth: (pixels: number) => `${pixels.toLocaleString("pt-BR")} px`,
    resizeHint: "Arraste para mudar a largura. Duplo clique ajusta ao conteúdo.",
    // RN-GRADE-010: o zoom da grade, na barra do resultado.
    zoom: "Zoom da grade",
    zoomOut: "Diminuir o zoom da grade",
    zoomIn: "Aumentar o zoom da grade",
    zoomReset: (label: string) => `Zoom da grade em ${label}. Voltar a 100%`,
    zoomResetHint: "Voltar a 100%. Ctrl+roda do mouse sobre a grade também muda o zoom.",
  },

  // Configurações › Resultados: o que vale para as grades. Aqui, e não em `settings.copy.ts`, porque esta leva é dividida por arquivo.
  settings: {
    // RN-CONFIG-006.
    showColumnTypes: "Mostrar o tipo de dado no cabeçalho das colunas",
    showColumnTypesHint: "Desligado, o cabeçalho mostra só o nome da coluna, na grade da consulta e na dos registros.",
  },
} as const;
