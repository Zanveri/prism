import { formatCount } from "@/lib/utils/format";

/**
 * Os textos novos da vista Registros e da grade do resultado (seção 20 da especificação). Os de antes seguem em `workbench.copy.ts`; os que estes
 * trocam (`tableTab.records.filterLabel`, `where`, `placeholder` e `severalStatements`) ficaram lá, sem uso, até o fechamento da leva.
 */
export const recordsCopy = {
  // RN-TABELA-010: o campo recebe o que vem depois do nome da tabela (a condição, a ordem ou as duas), e não só a condição.
  filter: {
    label: "Filtro e ordem dos registros",
    hint: "O que vem depois do nome da tabela: uma condição, uma ordem (ORDER BY) ou as duas.",
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
    // RN-EDIT-002, na aba de consulta: a dica do cabeçalho da coluna que se edita num resultado de junção, e a marca da que não se edita (como no canvas).
    editsColumn: (table: string, column: string) => `Altera ${column} de ${table}.`,
    readOnlyMark: "somente leitura",
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
      paste: "Colar",
      // Os rótulos da RN-EDIT-001 (seção 33: "Linha nova" passou a se chamar "Adicionar linha"; as marcas da linha nova na grade continuam).
      edit: "Editar célula",
      viewValue: "Visualizar valor",
      setNull: "Definir como nulo",
      undo: "Desfazer alteração",
      newRow: "Adicionar linha",
      // RN-EDIT-016.
      duplicateRow: "Duplicar linha",
      deleteRow: "Excluir linha",
      // RN-GRADE-012: o "Atualizar" da grade (F5), que lê de novo os Registros ou executa de novo o comando do resultado, com o filtro.
      refresh: "Atualizar",
      notNullable: "a coluna não aceita NULL",
      pasteFailed: "Não foi possível ler a área de transferência.",
      copied: "Copiado.",
      notCopied: "Não foi possível copiar.",
      // RN-SQL-017: a célula cortada é copiada inteira; esta é a que a API não tinha inteira (passou do teto, ou o resultado mudou).
      copiedCut: (count: number) => (count === 1 ? "Copiado, mas 1 valor não pôde vir inteiro e foi cortado." : `Copiado, mas ${formatCount(count, "valor", "valores")} não puderam vir inteiros e foram cortados.`),
    },
    // RN-EDIT-015: os atalhos da edição como o menu da célula (e a barra de edição) os escrevem. No macOS o Option faz o papel do Alt e o Cmd o do Ctrl.
    shortcuts: {
      edit: "F2",
      viewValue: "F7",
      newRow: "Alt+Insert",
      newRowMac: "Option+Insert",
      duplicateRow: "Ctrl+Alt+Insert",
      duplicateRowMac: "Cmd+Option+Insert",
      deleteRow: "Alt+Delete",
      deleteRowMac: "Option+Delete",
    },
    // RN-EDIT-013 e 014: a barra de edição, como a de baixo do resultado do DBeaver. A dica é a do botão com o atalho e, desabilitado, o motivo; os três
    // da falta de célula ou de linha não são de só leitura e vêm sozinhos.
    bar: {
      label: "Edição da grade",
      title: (label: string, shortcut: string) => `${label} (${shortcut})`,
      disabledTitle: (title: string, reason: string) => `${title}. ${reason}`,
      chooseCell: "Escolha uma célula na grade.",
      chooseRow: "Escolha uma linha na grade.",
      noRows: "O resultado não tem linhas.",
    },
    // RN-EDIT-016: o que a faixa diz depois de "Duplicar linha", e por que a linha não foi duplicada.
    duplicate: {
      keyCopied: (table: string, columns: readonly string[]) => `A linha duplicada copiou a chave de ${table} (${columns.join(", ")}): troque-a antes de salvar, ou o banco vai recusar a linha repetida.`,
      notCopied: (columns: readonly string[]) => (columns.length === 1 ? `Não copiada (fica com o padrão da tabela): ${columns[0]}.` : `Não copiadas (ficam com o padrão da tabela): ${columns.join(", ")}.`),
      // Nos Registros não há comando a executar de novo: quem lê de novo é "Atualizar".
      fullValueMissing: (column: string, subject: "table" | "result") => `A linha não foi duplicada: o valor completo de ${column} não pôde vir. ${subject === "table" ? "Atualize os registros para duplicá-la." : "Execute o comando de novo para duplicá-la."}`,
      fetchCancelled: "A linha não foi duplicada: a busca dos valores completos foi cancelada.",
    },
    // RN-SQL-017: enquanto copiar ou exportar busca na API o valor completo das células cortadas.
    fullValues: { fetching: "Buscando os valores completos…", cancel: "Cancelar" },
    // Por que uma célula ou uma linha não se edita (além dos motivos que a API manda).
    reasons: {
      truncated: "o valor chegou cortado",
      keyTruncated: "a chave desta linha chegou cortada",
      deleted: "a linha está marcada para exclusão",
      // RN-EDIT-014: "Excluir linha" na linha que já está riscada.
      alreadyDeleted: "a linha já está marcada para exclusão; Desfazer alteração a devolve",
      noRowOperations: "este resultado não aceita linha nova nem exclusão",
      // RN-EDIT-002: num resultado de junção só se alteram células, e a tabela que não tem linha ali (junção externa) não se edita.
      joinRowOperations: "num resultado de junção só se alteram células",
      noRowHere: (table: string) => `${table} não tem linha aqui (junção externa)`,
      busy: "há um comando em andamento na aba",
      // RN-GRADE-014: a atualização automática está trazendo as linhas de novo; a edição começaria sobre linhas que vão sair da tela.
      refreshing: "a atualização automática está lendo as linhas de novo; tente outra vez em um instante",
      // RN-EDIT-009: a linha nova salva na aba de consulta, que não executa de novo.
      generated: "o valor foi gerado pelo banco; execute de novo para vê-lo",
      keyGenerated: "a chave desta linha foi gerada pelo banco; execute de novo para editá-la",
      // RN-PROT-002: o mesmo motivo que a página do resultado traz numa conexão somente leitura (`editable.reason`).
      connectionReadOnly: "a conexão é somente leitura",
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
  valueViewer: {
    title: "Valor",
    formatLabel: "Formato de exibição",
    formatted: "Formatado",
    raw: "Cru",
    wordWrap: "Quebrar linhas",
    copy: "Copiar valor",
    saveFile: "Salvar em arquivo…",
    openExternal: "Abrir no editor externo",
    editValue: "Editar valor",
    loadFile: "Carregar de arquivo…",
    setNull: "Definir NULL",
    apply: "Aplicar",
    revert: "Reverter",
    close: "Fechar painel Valor (F7)",
    resize: "Ajustar a largura do painel Valor",
    noCellSelected: "Selecione uma célula na grade para visualizar o valor.",
    invalidJson: "O conteúdo não é um JSON válido; exibindo na forma crua.",
    bytesCount: (bytes: number) => `${bytes.toLocaleString("pt-BR")} ${bytes === 1 ? "byte" : "bytes"}`,
    charsCount: (chars: number) => `${chars.toLocaleString("pt-BR")} ${chars === 1 ? "caractere" : "caracteres"}`,
    savedFile: (filename: string) => `Arquivo ${filename} salvo.`,
    openedExternal: "Aberto no editor externo.",
    openExternalFailed: "Não foi possível abrir o editor externo.",
    appliedEdit: "Valor aplicado na célula.",
    readOnlyHint: "Somente leitura",
  },
} as const;
