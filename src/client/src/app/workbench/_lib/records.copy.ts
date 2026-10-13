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

  // Seção 22 (RN-EDIT-001 a 012): a edição de células nos Registros de uma tabela e no resultado da aba de consulta.
  edit: {
    pending: (count: number) => (count === 1 ? "1 alteração não salva" : `${count.toLocaleString("pt-BR")} alterações não salvas`),
    viewSql: "Ver SQL",
    discard: "Descartar",
    save: "Salvar",
    saving: "Salvando…",
    saveHint: "Grava as alterações no banco, numa transação só (Ctrl+S com o foco na grade).",
    oneAtATime: "Este banco não tem log de transação: cada alteração é gravada sozinha, na hora. Se uma falhar, as anteriores já estão gravadas.",
    saved: (count: number) => (count === 1 ? "1 alteração salva." : `${count.toLocaleString("pt-BR")} alterações salvas.`),
    partlySaved: (applied: number, row: string, left: number) => `${applied === 1 ? "1 alteração gravada" : `${applied.toLocaleString("pt-BR")} alterações gravadas`}; a ${row} falhou; ${left === 1 ? "1 continua pendente" : `${left.toLocaleString("pt-BR")} continuam pendentes`}.`,
    failedAt: (row: string) => `O Salvar falhou na ${row}, e nada foi gravado.`,
    rowLabel: (row: number) => `linha ${row.toLocaleString("pt-BR")}`,
    newRowLabel: (position: number) => `linha nova ${position.toLocaleString("pt-BR")}`,
    noRow: "A linha não existe mais, ou a chave dela mudou: o comando não alterou nenhuma linha.",
    manyRows: (count: number) => `O comando alteraria ${count.toLocaleString("pt-BR")} linhas, e não uma só.`,
    manyRowsWritten: (count: number) => `O comando alterou ${count.toLocaleString("pt-BR")} linhas, e já está gravado: não há como desfazê-lo.`,
    readOnly: (reason: string) => `Somente leitura: ${reason}.`,
    loadingTarget: "Conferindo o que se edita nesta tabela…",
    checkFailed: "Não foi possível saber o que se edita nesta tabela.",
    // A mesma conferência, no resultado de um comando da aba de consulta.
    loadingResultTarget: "Conferindo o que se edita neste resultado…",
    checkResultFailed: "Não foi possível saber o que se edita neste resultado.",
    // O campo de edição dentro da célula, como no canvas.
    editorLabel: (column: string, row: string) => `${column}, ${row}`,
    confirmEdit: "Confirmar edição (Enter)",
    cancelEdit: "Cancelar edição (Esc)",
    newRowMark: "Linha nova",
    deletedMark: "Marcada para exclusão",
    pendingTitle: (original: string) => `Valor lido: ${original}`,
    // "Ver SQL" (RN-EDIT-008).
    sqlTitle: "SQL das alterações",
    sqlDescription: "Os comandos que o Salvar vai executar, na ordem. Na execução os valores vão como parâmetros, e não dentro do texto.",
    sqlOneAtATime: "Neste banco cada comando é gravado sozinho, quando termina.",
    sqlUnwritten: "Os valores marcados com ? não têm literal (têm caractere de controle); eles vão nesta ordem:",
    copySql: "Copiar",
    copied: "SQL copiado.",
    notCopied: "Não foi possível copiar.",
    close: "Fechar",
    // A pergunta antes de perder as pendências (RN-EDIT-007).
    unsavedTitle: (count: number) => (count === 1 ? "Há 1 alteração não salva" : `Há ${count.toLocaleString("pt-BR")} alterações não salvas`),
    unsavedDescription: "Salve antes, ou descarte o que não foi salvo. Cancelar volta sem mudar nada.",
    unsavedSeveral: "As alterações não salvas das abas que fecham serão descartadas.",
    cancel: "Cancelar",
    // O menu de contexto da célula.
    menu: {
      label: "Ações da célula",
      copyValue: "Copiar valor",
      paste: "Colar",
      // Os rótulos da RN-EDIT-001.
      edit: "Editar célula",
      setNull: "Definir como nulo",
      undo: "Desfazer alteração",
      newRow: "Linha nova",
      deleteRow: "Excluir linha",
      notNullable: "a coluna não aceita NULL",
      pasteFailed: "Não foi possível ler a área de transferência.",
      copied: "Copiado.",
      notCopied: "Não foi possível copiar.",
    },
    // Por que uma célula ou uma linha não se edita (além dos motivos que a API manda).
    reasons: {
      truncated: "o valor chegou cortado",
      keyTruncated: "a chave desta linha chegou cortada",
      deleted: "a linha está marcada para exclusão",
      noRowOperations: "este resultado não aceita linha nova nem exclusão",
      busy: "há um comando em andamento na aba",
      // RN-EDIT-009: a linha nova salva na aba de consulta, que não executa de novo.
      generated: "o valor foi gerado pelo banco; execute de novo para vê-lo",
      keyGenerated: "a chave desta linha foi gerada pelo banco; execute de novo para editá-la",
    },
    // RN-EDIT-009: a coluna da linha nova salva que a pessoa não preencheu, na aba de consulta.
    generated: "gerado pelo banco — execute de novo para ver",
  },

  // Configurações › Resultados: o que vale para as grades. Aqui, e não em `settings.copy.ts`, porque esta leva é dividida por arquivo.
  settings: {
    // RN-CONFIG-006.
    showColumnTypes: "Mostrar o tipo de dado no cabeçalho das colunas",
    showColumnTypesHint: "Desligado, o cabeçalho mostra só o nome da coluna, na grade da consulta e na dos registros.",
  },
} as const;
