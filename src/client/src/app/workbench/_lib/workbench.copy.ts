import { formatCount, formatElapsed } from "@/lib/utils/format";

/** Os textos da área de trabalho, num lugar só (RN-AVISO-002 a 005, RN-SESSAO-005, RN-ARVORE-003, RN-SQL-004 a 009). */
export const workbenchCopy = {
  navigator: {
    label: "Navegador de bancos",
    title: "Navegador",
    tree: "Objetos dos bancos",
    resize: "Ajustar a largura do navegador",
    loadingList: "Carregando as conexões…",
    loadFailed: "Não foi possível carregar as conexões.",
    retry: "Tentar de novo",
    empty: { title: "Nenhuma conexão salva.", hint: "Salve a primeira em Conexões para ver os objetos do banco aqui." },
    emptyAction: "Ir para Conexões",

    // As linhas que o modelo cria no lugar de um nível ainda sem filhos.
    loading: "Carregando…",
    groups: { tables: "Tabelas", views: "Visões", routines: "Rotinas", columns: "Colunas", indexes: "Índices", foreignKeys: "Chaves estrangeiras" },
    system: "sistema",
    nullable: "nulo",
    primaryKey: "PK",
    unique: "único",
    // RN-ARVORE-006: a marca do banco da conexão na lista dos bancos do servidor.
    defaultDatabase: "padrão",
    routineKinds: { procedure: "procedimento", function: "função" },

    // A dica da linha de uma tabela ou visão (o canvas a põe na tabela selecionada). Abre a ABA: com ela já aberta noutra vista (a Estrutura, por exemplo), o
    // duplo clique volta a ela como está, e não aos registros.
    openHint: { table: "Duplo clique abre a aba da tabela", view: "Duplo clique abre a aba da visão" },

    // RN-BUSCA-001: o campo de busca do navegador; o texto do campo é o do canvas.
    search: {
      label: "Filtrar objetos",
      clear: "Limpar a busca",
      nothingFound: (query: string) => `Nada encontrado para “${query}”.`,
      onlyLoaded: "A busca olha só o que já está carregado na árvore. Abra uma conexão ou um esquema para buscar dentro dele.",
      results: (count: number) => formatCount(count, "resultado", "resultados"),
    },

    // RN-MENU-001: o menu de contexto de cada linha.
    menu: {
      label: (name: string) => `Ações de ${name}`,
      connect: "Conectar",
      disconnect: "Desconectar",
      newQuery: "Nova consulta",
      refresh: "Atualizar",
      editConnection: "Editar conexão",
      openRecords: "Abrir registros",
      openStructure: "Ver estrutura",
      openDiagram: "Ver diagrama",
      generateSelect: "Gerar SELECT",
      copyName: "Copiar nome",
      copyQualifiedName: "Copiar nome qualificado",
      newSubfolder: "Nova subpasta",
      renameFolder: "Renomear",
      moveFolder: "Mover",
      deleteFolder: "Excluir",
      // RN-AVISO-002 e 003: o resultado de copiar. Quando a área de transferência recusa, o texto continua na tela para a pessoa copiar.
      copied: "Copiado.",
      notCopied: "Não foi possível copiar.",
    },

    expand: (name: string) => `Expandir ${name}`,
    collapse: (name: string) => `Recolher ${name}`,
    newQuery: (name: string) => `Nova consulta em ${name}`,
    refresh: (name: string) => `Atualizar ${name}`,
    disconnect: (name: string) => `Desconectar ${name}`,
    status: { connected: "Conectada", connecting: "Conectando…", disconnected: "Desconectada", failed: "Falha ao conectar" },
  },

  tabs: {
    label: "Abas abertas",
    close: (title: string) => `Fechar ${title}`,
    emptyTitle: "Nenhuma aba aberta",
    emptyHint: "Passe o mouse sobre uma conexão no navegador e escolha “Nova consulta”.",
    // A faixa rola numa linha só, e tem a lista de todas as abas e, em cada aba, um menu de botão direito.
    scrollLeft: "Rolar as abas para a esquerda",
    scrollRight: "Rolar as abas para a direita",
    list: "Todas as abas",
    listLabel: "Todas as abas abertas",
    menuLabel: (title: string) => `Aba ${title}`,
    closeOne: "Fechar",
    closeOthers: "Fechar as outras",
    closeRight: "Fechar as da direita",
    closeAll: "Fechar todas",
    closeShortcut: "Ctrl+W",
    closeShortcutMac: "Cmd+W",
    // "Fechar todas", "Fechar as outras" e "Fechar as da direita" perguntam UMA vez quando alguma aba que fecha é consulta com SQL digitado (o texto não é guardado).
    confirmClose: {
      title: (total: number) => `Fechar ${formatCount(total, "aba", "abas")}?`,
      description: (withSql: number) => `Entre elas, ${formatCount(withSql, "consulta com SQL digitado", "consultas com SQL digitado")}: o texto não é guardado em lugar nenhum.`,
      confirm: "Fechar",
    },
    // RN-ABAS-001 a 003: a aba muda de lugar arrastando ou pelo teclado, e passa para outra janela pelo menu ou arrastando.
    moveToNewWindow: "Mover para nova janela",
    moveToWindow: "Mover para a janela…",
    windowsLabel: "Mover para a janela",
    windowName: (number: number, activeTitle: string | null, tabCount: number) =>
      activeTitle === null ? `Janela ${number} — sem abas` : tabCount > 1 ? `Janela ${number} — ${activeTitle} e mais ${formatCount(tabCount - 1, "aba", "abas")}` : `Janela ${number} — ${activeTitle}`,
    moveBusy: "Espere o comando terminar, ou cancele-o, antes de levar a aba para outra janela.",
    moveFailed: "Não foi possível levar a aba para outra janela.",
  },

  editor: {
    label: "Editor SQL",
    toolbar: "Ações do editor",
    run: "Executar",
    runShortcut: "Ctrl+Enter",
    cancel: "Cancelar",
    cancelling: "Cancelando…",
    // RN-ARVORE-007: o banco em que a aba roda, e a lista dos bancos do servidor (a mesma da árvore, RN-ARVORE-006).
    database: {
      label: "Banco",
      defaultName: (name: string) => `${name} (padrão)`,
      // Antes de a lista de conexões chegar, o banco da conexão ainda não tem nome.
      connectionDatabase: "banco da conexão",
      loading: "Carregando os bancos…",
      locked: "No Db2, a conexão usa um banco só.",
    },
  },

  result: {
    label: "Resultado da consulta",
    title: "Resultado",
    empty: "Nenhum comando executado nesta aba.",
    emptyHint: "Ctrl+Enter executa o texto selecionado ou, sem seleção, o comando onde está o cursor.",
    running: "Executando…",
    grid: "Linhas do resultado",
    rowNumber: "#",
    // RN-SQL-004: o que está na tela e o tempo do comando. O total só aparece quando a pessoa pede (RN-SQL-006).
    firstRows: (count: number, elapsedMs: number) => `Primeiras ${formatCount(count, "linha", "linhas")} · ${formatElapsed(elapsedMs)}`,
    loadedRows: (count: number, elapsedMs: number) => `${formatCount(count, "linha carregada", "linhas carregadas")} · ${formatElapsed(elapsedMs)}`,
    allRows: (count: number, elapsedMs: number) => `${formatCount(count, "linha", "linhas")} · ${formatElapsed(elapsedMs)}`,
    // RN-SQL-013: o comando gravou, foi até o fim e devolveu `total` linhas; a tela recebeu as primeiras.
    returnedRows: (received: number, total: number, elapsedMs: number) =>
      `${received < total ? `${received.toLocaleString("pt-BR")} de ` : ""}${formatCount(total, "linha devolvida", "linhas devolvidas")} · comando concluído · ${formatElapsed(elapsedMs)}`,
    // RN-SQL-001: uma execução leva um comando só.
    tooManyStatements: (count: number) => `A seleção tem ${count.toLocaleString("pt-BR")} comandos. Nesta versão o Prism executa um por vez: selecione um só ou ponha o cursor nele.`,
    // RN-SQL-008. Há comando (DDL) para o qual o banco não conta linhas, e o driver responde um número negativo.
    affected: (count: number, elapsedMs: number) => `${count < 0 ? "Comando executado" : formatCount(count, "linha afetada", "linhas afetadas")} · ${formatElapsed(elapsedMs)}`,
    loadedHint: (count: number) => `Linhas 1 a ${count.toLocaleString("pt-BR")} carregadas. As próximas linhas e o total só são buscados quando você pedir.`,
    // RN-CONFIG-005: com "buscar mais linhas ao rolar" ligado, a próxima página vem sozinha; o total segue só quando a pessoa pede.
    loadedHintAuto: (count: number) => `Linhas 1 a ${count.toLocaleString("pt-BR")} carregadas. As próximas vêm ao rolar até o fim da grade; o total só quando você pedir.`,
    loadMore: "Carregar mais 200",
    loadingMore: "Carregando…",
    count: "Contar total",
    counting: "Contando…",
    total: (total: number) => `Total: ${formatCount(total, "linha", "linhas")}`,
    // RN-SQL-007.
    cursorClosed: "O cursor foi fechado. Execute de novo para continuar.",
    rerun: "Executar de novo",
    null: "NULL",
    // RN-TABELA-005: a dica do cabeçalho que ordena diz o que o próximo clique faz.
    sortTitle: (name: string, direction: "asc" | "desc" | null) => (direction === null ? `Ordenar por ${name} (crescente)` : direction === "asc" ? `Ordenar por ${name} (decrescente)` : `Tirar a ordem por ${name}`),
    // RN-SQL-011: a dica da célula que chegou cortada.
    truncated: "Valor cortado",
    // RN-SQL-010: o comando que o usuário cancelou. Não é erro do banco.
    cancelled: "Comando cancelado.",
    errorTitle: "Erro do banco",
    // RN-DRIVER-006: o driver do banco da conexão não está instalado; a frase é da API, e a área de resultado oferece "Instalar driver".
    driverMissingTitle: "Driver não instalado",
    sqlState: "SQLSTATE",
    // RN-PAINEL-001: recolher, restaurar e maximizar a área; a divisória entre o editor e ela.
    collapse: "Recolher a área de resultado",
    restore: "Restaurar a área de resultado",
    maximize: "Maximizar a área de resultado",
    resize: "Ajustar a altura da área de resultado",
    resizeValue: (percent: number) => `Resultado com ${percent}% da altura`,
    // RN-TABELA-002: a vista Registros de uma tabela usa a mesma área; mudam o título, o rodapé e a frase de antes do primeiro resultado.
    recordsTitle: "Registros",
    recordsLabel: (name: string) => `Registros de ${name}`,
    recordsLoading: "Carregando os registros…",
    // RN-TABELA-006: "Exportar CSV" grava as linhas carregadas; a dica diz quantas são e que as outras não entram.
    exportCsv: "Exportar CSV",
    exportHint: (count: number, hasMore: boolean) => (hasMore ? `Exporta as ${count.toLocaleString("pt-BR")} linhas carregadas. As que ainda não foram carregadas não entram no arquivo.` : `Exporta as ${count.toLocaleString("pt-BR")} linhas.`),
    recordsEmpty: "Nenhum registro carregado.",
    recordsEmptyHint: "Use Atualizar para carregar os registros.",
    recordsCursorClosed: "O cursor foi fechado. Atualize para continuar.",
    // A pessoa desconectou a conexão: nada reconecta sozinho, e "Atualizar" é o clique que conecta e carrega.
    // RN-TABELA-007: o valor de uma chave estrangeira leva à tabela referenciada, já filtrada por ele.
    followTitle: (table: string, column: string) => `Abrir ${table}, filtrada por ${column}`,
    followLabel: (table: string, column: string, value: string) => `Abrir ${table} com ${column} igual a ${value}`,
    recordsDisconnected: "A conexão está desconectada.",
    recordsDisconnectedHint: "Use Atualizar para conectar e carregar os registros.",
    refresh: "Atualizar",
  },

  // RN-TABELA-001 a 004: a aba de uma tabela.
  tableTab: {
    views: { data: "Registros", structure: "Estrutura", diagram: "Diagrama" },
    viewsLabel: "Vistas da tabela",
    // A conexão, o banco e o esquema, como o canvas os escreve ao lado do nome da tabela.
    location: (connection: string, database: string, schema: string) => `${connection} / ${database} / ${schema}`,
    refresh: "Atualizar",
    retry: "Tentar de novo",
    // A API já não conhece a sessão que a árvore abriu (ela caiu): "Tentar de novo" abre outra.
    sessionLost: "A sessão com o banco caiu. Tentar de novo abre outra.",
    loading: "Carregando…",
    // A estrutura e o diagrama de uma conexão que a pessoa desconectou: nada reconecta sozinho, o botão conecta e carrega.
    disconnected: "A conexão está desconectada.",
    disconnectedHint: "Conecte para carregar a estrutura e o diagrama desta tabela.",
    connect: "Conectar",
    connecting: "Conectando…",
    // RN-TABELA-005: o filtro dos registros, com o comando que foi executado à vista.
    records: {
      filterLabel: "Filtro dos registros (condição WHERE)",
      where: "WHERE",
      placeholder: "quantidade > 100 AND status = 'aberta'",
      apply: "Aplicar filtro",
      clear: "Limpar",
      command: "Comando",
      severalStatements: "O filtro tem mais de um comando. Escreva só a condição, sem ponto e vírgula entre comandos.",
      // RN-TABELA-006: o aviso de quando a exportação começa. Diz o que se sabe (quantas linhas vão para o arquivo): quem grava é o diálogo de salvar do
      // sistema, que a pessoa ainda vai confirmar (ou cancelar), então nada aqui afirma que o arquivo foi gravado.
      exported: (count: number) => `Exportando ${formatCount(count, "linha", "linhas")}…`,
      exportedPartial: (count: number) => `Exportando ${formatCount(count, "linha", "linhas")}… As linhas que ainda não foram carregadas não entram no arquivo.`,
      exportedTruncated: "Valores que chegaram cortados saem cortados no arquivo.",
    },
    // RN-TABELA-003: as três seções da Estrutura. O canvas também mostra "Padrão", "Ao excluir" e "Método", que a API não devolve.
    structure: {
      label: "Estrutura da tabela",
      // RN-TABELA-009: a lista lateral. Cada entrada diz quantos itens a seção tem; a seção cuja lista falhou leva uma marca de aviso, com este texto para o leitor de tela.
      sections: { label: "Seções da estrutura", failed: "Falhou ao carregar" },
      columns: { title: "Colunas", empty: "A API não achou colunas para esta tabela.", number: "#", name: "Nome", type: "Tipo", nullable: "Aceita nulo", key: "Chave", yes: "sim", no: "não" },
      foreignKeys: { title: "Chaves estrangeiras", empty: "Esta tabela não tem chaves estrangeiras.", name: "Nome", columns: "Colunas", references: "Referência" },
      indexes: { title: "Índices", empty: "Esta tabela não tem índices.", name: "Nome", columns: "Colunas", unique: "Único" },
      keys: { PK: "Chave primária", FK: "Chave estrangeira" },
      openDiagram: "Ver no diagrama",
      // RN-TABELA-008: o DDL que o Prism monta do catálogo. A primeira linha do texto copiado repete o aviso.
      ddl: {
        // O nome da entrada na lista lateral; o título da seção, abaixo, diz que o texto é aproximado.
        entry: "DDL",
        title: "DDL aproximado",
        warning: "Montado pelo Prism a partir do catálogo, e não é o DDL do banco: padrões, restrições de conferência e opções de armazenamento não aparecem.",
        label: "DDL aproximado da tabela",
        copy: "Copiar",
        copyLabel: "Copiar o DDL aproximado",
        copied: "DDL copiado.",
        notCopied: "Não foi possível copiar. Selecione o texto e copie com Ctrl+C.",
        unavailable: "O DDL aparece quando as colunas, as chaves estrangeiras e os índices chegarem.",
        empty: "A API não achou colunas para esta tabela: não há o que montar.",
        // Uma visão não tem CREATE TABLE: o catálogo que o Prism lê não traz a consulta que a define.
        view: "O Prism não monta o DDL de visões: o catálogo que ele lê não traz a consulta que define a visão, e um CREATE TABLE seria errado.",
        // A aba não carrega o tipo do objeto: quando a árvore da conexão ainda não o mostrou, o texto diz que pode ser uma visão.
        maybeView: "O Prism não sabe se este objeto é uma tabela ou uma visão (a árvore desta conexão ainda não mostrou o grupo dele). Se for uma visão, este CREATE TABLE não vale.",
        unknownLine: "O Prism não sabe se este objeto é tabela ou visão: se for uma visão, este CREATE TABLE não vale.",
      },
    },
    // RN-TABELA-004: o diagrama da tabela e das que ela referencia.
    diagram: {
      label: "Diagrama da tabela",
      // O canvas escreve "producao · 6 tabelas, 6 chaves estrangeiras": o esquema vem antes, em outra fonte.
      counts: (tables: number, foreignKeys: number) => `${formatCount(tables, "tabela", "tabelas")}, ${formatCount(foreignKeys, "chave estrangeira", "chaves estrangeiras")}`,
      loading: "Carregando o diagrama…",
      zoom: "Zoom",
      zoomIn: "Ampliar",
      zoomOut: "Reduzir",
      fit: "Ajustar à tela",
      open: (name: string) => `Abrir ${name}`,
      openHint: "Duplo clique abre a tabela",
      legend: { primaryKey: "chave primária", foreignKey: "chave estrangeira", arrow: "a seta sai da tabela com a chave estrangeira e aponta para a tabela referenciada" },
      incoming: "Só aparecem as tabelas que esta tabela referencia: a API ainda não informa as que apontam para ela.",
      omitted: (shown: number, total: number) => `Mostrando ${shown} de ${total} tabelas referenciadas.`,
      noForeignKeys: "Esta tabela não tem chaves estrangeiras.",
    },
  },

  status: {
    label: "Barra de status",
    connected: "Conectado",
    disconnected: "Desconectado",
    noTab: "Nenhuma aba ativa",
    // A conexão e o banco da aba ativa (RN-ARVORE-006 e 007): o banco acompanha a troca na barra do editor.
    place: (connection: string, database: string) => `${connection} / ${database}`,
    autoCommit: "Auto-commit",
    vaultOpen: (userName: string) => `Cofre de ${userName} aberto`,
  },

  toasts: {
    // RN-AVISO-002: conexão desconectada.
    disconnected: "Conexão desconectada.",
    // RN-AVISO-003: a sessão com o banco caiu e foi reaberta.
    sessionReopened: "A sessão com o banco caiu e foi reaberta.",
    // RN-AVISO-002: comando que não devolve linhas executado.
    commandExecuted: (rowsAffected: number) => (rowsAffected < 0 ? "Comando executado." : `Comando executado. ${formatCount(rowsAffected, "linha afetada", "linhas afetadas")}.`),
    // RN-AVISO-002 e RN-SQL-013: comando que grava e devolve linhas, já confirmado no banco.
    commandCompleted: (totalRows: number) => `Comando executado. ${formatCount(totalRows, "linha devolvida", "linhas devolvidas")}.`,
    // RN-AVISO-003 e RN-SQL-001: a seleção tem mais de um comando, e nada foi enviado.
    tooManyStatements: "A seleção tem mais de um comando. Nada foi executado.",
    // Ctrl+Enter sem comando no cursor nem na seleção (só espaços, `;` e comentários).
    nothingToSend: "Não há comando para executar.",
    // O mesmo texto do aviso central para o que não é recusa da API: o que a rede de segurança da aba pegou.
    unexpectedError: "Erro inesperado.",
    // RN-AVISO-004 e 005: o aviso é curto; a mensagem do banco e o SQLSTATE ficam na área de resultado.
    commandFailed: "O comando falhou. Veja o erro no resultado.",
    // RN-AVISO-003 e RN-SQL-010: o usuário cancelou e o comando terminou por causa disso.
    commandCancelled: "Comando cancelado.",
    // RN-AVISO-003: o cursor fechou (5 minutos sem leitura, RN-SQL-007) e os valores cortados (RN-SQL-011).
    // O aviso é o mesmo na aba de consulta ("Executar de novo") e na de tabela ("Atualizar"): o executor não sabe de qual das duas veio.
    cursorClosed: "O cursor foi fechado. Use Executar de novo (na consulta) ou Atualizar (na tabela) para carregar mais linhas.",
    valuesTruncated: "Alguns valores do resultado foram cortados.",
    // RN-AVISO-003 e RN-TABELA-007: o filtro que o clique numa chave estrangeira pediu e que a aba da tabela não chegou a enviar (estava ocupada com outro
    // comando, ou a conexão foi desconectada) até o prazo do pedido acabar. Nada foi aplicado; o caminho é clicar de novo.
    filterNotApplied: (table: string) => `O filtro pedido para ${table} não foi aplicado: a aba dela estava ocupada ou desconectada. Clique no valor de novo.`,
  },
} as const;
