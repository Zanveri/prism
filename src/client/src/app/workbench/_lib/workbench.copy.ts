import { formatCount, formatElapsed } from "@/lib/utils/format";

/** A frase com a primeira letra em minúscula, para entrar no meio de outra ("Somente leitura" vira "somente leitura"). */
const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

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
    // RN-NAV-007: a dica embaixo é a do navegador (`navigatorCopy.empty`), que aponta o "Nova conexão" da barra dele: a tela de Conexões não existe mais.
    empty: { title: "Nenhuma conexão salva." },

    // As linhas que o modelo cria no lugar de um nível ainda sem filhos.
    loading: "Carregando…",
    groups: { tables: "Tabelas", views: "Visões", routines: "Rotinas", sequences: "Sequências", columns: "Colunas", indexes: "Índices", foreignKeys: "Chaves estrangeiras" },
    system: "sistema",
    nullable: "nulo",
    primaryKey: "PK",
    unique: "único",
    // RN-ARVORE-006: a marca do banco da conexão na lista dos bancos do servidor.
    defaultDatabase: "padrão",
    routineKinds: { procedure: "procedimento", function: "função" },

    // A dica da linha de uma tabela, visão, esquema ou banco (o canvas a põe na linha selecionada). Abre a ABA: com ela já aberta noutra vista, o
    // duplo clique volta a ela como está.
    openHint: {
      table: "Duplo clique abre a aba da tabela",
      view: "Duplo clique abre a aba da visão",
      schema: "Duplo clique abre a aba do esquema",
      database: "Duplo clique abre a aba do banco",
    },

    // RN-BUSCA-001: o campo de busca do navegador; o texto do campo é o do canvas.
    search: {
      label: "Filtrar objetos",
      clear: "Limpar a busca",
      nothingFound: (query: string) => `Nada encontrado para “${query}”.`,
      onlyLoaded: "A busca olha as tabelas e visões dos bancos conectados e o que já está aberto na árvore.",
      results: (count: number) => formatCount(count, "resultado", "resultados"),
      // A conta para o leitor de tela quando o corte deixa achados de fora: "1.234 resultados, 600 à vista".
      resultsShown: (found: number, shown: number) => `${formatCount(found, "resultado", "resultados")}, ${shown.toLocaleString("pt-BR")} à vista`,

      // RN-BUSCA-002: a linha de estado, logo abaixo dos filtros. O nome de um banco é "Conexão › banco".
      databaseName: (connection: string, database: string) => `${connection} › ${database}`,
      loading: (databases: number) => `Buscando nas tabelas e visões de ${formatCount(databases, "banco", "bancos")}…`,
      cut: (cap: number) => `Muitos resultados: cada banco mostra as ${cap.toLocaleString("pt-BR")} primeiras tabelas e visões. Escreva mais do nome para ver as outras.`,
      truncated: (database: string, limit: number) => `${database} tem mais de ${limit.toLocaleString("pt-BR")} tabelas e visões: a busca olhou as ${limit.toLocaleString("pt-BR")} primeiras e o que já está aberto na árvore.`,
      // A mensagem é a do banco, como veio (RN-SQL-009).
      failed: (database: string, message: string) => `Não foi possível buscar em ${database}: ${message}`,
      retry: "Tentar de novo",
      retryIn: (database: string) => `Tentar de novo: ${database}`,
      leftOut: (count: number) => (count === 1 ? "1 conexão não está conectada e ficou de fora da busca." : `${count.toLocaleString("pt-BR")} conexões não estão conectadas e ficaram de fora da busca.`),
      leftOutWithoutCredentials: (count: number) => (count === 1 ? "1 sem usuário ou senha gravada ficou de fora." : `${count.toLocaleString("pt-BR")} sem usuário ou senha gravada ficaram de fora.`),
      searchThemToo: "Buscar nelas também",
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
      openSchema: "Abrir esquema",
      openSchemaDiagram: "Ver diagrama do esquema",
      openDatabase: "Abrir banco",
      openDatabaseDiagram: "Ver diagrama do banco",
      generateSelect: "Gerar SELECT",
      copyName: "Copiar nome",
      copyQualifiedName: "Copiar nome qualificado",
      newSubfolder: "Nova subpasta",
      // RN-NAV-009: o Renomear (F2) muda só o nome; RN-PASTA-006: o Editar pasta…, sem atalho, tem o nome, a cor e o ambiente.
      renameFolder: "Renomear",
      editFolder: "Editar pasta…",
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
    // "Fechar todas", "Fechar as outras" e "Fechar as da direita" perguntam UMA vez quando alguma aba que fecha é consulta com SQL digitado: o que fecha não volta
    // na próxima entrada (RN-ABAS-006 e 007).
    confirmClose: {
      title: (total: number) => `Fechar ${formatCount(total, "aba", "abas")}?`,
      description: (withSql: number) => `Entre elas, ${formatCount(withSql, "consulta com SQL digitado", "consultas com SQL digitado")}: o que fecha não volta na próxima entrada.`,
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
    // RN-ABAS-010: o véu do arraste da aba, sobre a janela inteira menos a faixa; e o motivo de "Mover para nova janela" desabilitado com uma aba só.
    drag: {
      toNewWindow: "Solte para abrir numa janela nova",
      onlyTab: "Esta já é a única aba da janela.",
      bringHere: "Solte para trazer a aba para esta janela",
      resultToWindow: "Solte para abrir o resultado numa janela",
    },
  },

  editor: {
    label: "Editor SQL",
    toolbar: "Ações do editor",
    run: "Executar",
    runShortcut: "Ctrl+Enter",
    cancel: "Cancelar",
    cancelling: "Cancelando…",
    contextMenu: {
      label: "Ações do editor SQL",
      autocompleteJoins: "Autocompletar ligações…",
      autocompleteJoinsShortcut: "Ctrl+.",
      autocompleteJoinsShortcutMac: "⌘.",
    },
    joinModal: {
      title: "Sugestão de ligações de tabelas",
      description: "Marque as tabelas que deseja ligar a partir da cláusula FROM. Ao marcar uma tabela filha, novas ligações a partir dela são abertas abaixo.",
      loading: "Buscando as tabelas e chaves estrangeiras…",
      loadingChildren: "Buscando ligações…",
      noConnection: "Conecte esta aba a um banco para buscar as ligações das tabelas.",
      noFromTable: "Nenhuma tabela encontrada na cláusula FROM do comando atual.",
      unresolvedTables: (names: string) => `Não foi possível encontrar no banco: ${names}.`,
      noLinks: "Esta tabela não possui chaves estrangeiras cadastradas.",
      previewLabel: "Pré-visualização dos JOINs",
      cancel: "Cancelar",
      insert: (count: number) => (count <= 1 ? "Inserir ligação" : `Inserir ${count.toLocaleString("pt-BR")} ligações`),
    },
    // RN-ARVORE-007: o banco em que a aba roda, e a lista dos bancos do servidor (a mesma da árvore, RN-ARVORE-006).
    database: {
      label: "Banco",
      defaultName: (name: string) => `${name} (padrão)`,
      // Antes de a lista de conexões chegar, o banco da conexão ainda não tem nome.
      connectionDatabase: "banco da conexão",
      loading: "Carregando os bancos…",
      locked: "No Db2, a conexão usa um banco só.",
    },
    // RN-ARVORE-008: a conexão da aba, antes do banco, e a lista que a troca (o clique ou Ctrl+9, como no DBeaver).
    connection: {
      // O nome acessível começa pelo que o botão mostra (a sigla, o nome e o ambiente, na ordem da tela), e diz depois o que ele é: quem usa comando de voz
      // diz o que vê, e o leitor de tela ouve o ambiente, que é o aviso da conexão.
      // RN-PROT-002: a dica do cadeado vai no nome acessível, depois do ambiente ("Somente leitura, herdado da pasta Fábrica"). RN-VERIF-003: o indicador
      // da verificação vai depois dele, como na tela, em que o ponto fica na ponta, como na árvore ("…, respondeu na última verificação").
      label: (engine: string, name: string, environment: string | null, readOnly: string | null = null, check: string | null = null) =>
        `${engine} ${name}${environment === null ? "" : ` ${environment}`}${readOnly === null ? "" : `, ${lowerFirst(readOnly)}`}${check === null ? "" : `, ${lowerFirst(check)}`}, conexão desta aba`,
      none: "Sem conexão",
      noneLabel: "Sem conexão, escolher a conexão desta aba",
      // A lista de conexões ainda não chegou.
      loading: "…",
      loadingLabel: "Conexão desta aba, carregando",
      shortcut: "Ctrl+9",
      shortcutMac: "Cmd+9",
      // A dica do botão: o servidor e o usuário, e o atalho.
      title: (host: string, port: number, userName: string, shortcut: string) => `${host}:${port}\nUsuário: ${userName}\n${shortcut} troca a conexão desta aba`,
      noneTitle: (shortcut: string) => `${shortcut} escolhe a conexão desta aba`,
      list: "Conexões",
      search: "Buscar conexão",
      searchPlaceholder: "Nome, pasta ou servidor",
      connected: "Conectadas",
      others: "Desconectadas",
      connectedMark: "conectada",
      current: "a desta aba",
      root: "Sem pasta",
      noMatch: (query: string) => `Nenhuma conexão encontrada para “${query}”.`,
      empty: "Não há conexão cadastrada. Crie uma pelo “Nova conexão” da barra do navegador.",
      busy: "Espere o comando terminar, ou cancele-o, para trocar a conexão.",
      reveal: "Mostrar no navegador",
    },
  },

  result: {
    label: "Resultado da consulta",
    title: "Resultado",
    empty: "Nenhum comando executado nesta aba.",
    // RN-SQL-001 e 019: os dois jeitos de executar; `script` é o atalho do script na plataforma (Alt+X, ou Cmd+Option+X no macOS).
    emptyHint: (script: string) => `Ctrl+Enter executa o texto selecionado ou, sem seleção, o comando onde está o cursor. ${script} executa os comandos da seleção ou do texto inteiro, um depois do outro.`,
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
    // RN-SQL-001: uma execução leva um comando só; quem executa vários é o script (RN-SQL-019).
    tooManyStatements: (count: number, script: string) =>
      `A seleção tem ${count.toLocaleString("pt-BR")} comandos, e Executar leva um só: selecione um ou ponha o cursor nele. Para executar todos, um depois do outro, use Executar script (${script}).`,
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
    // RN-SQL-006 (issue #10): com o total contado, o mesmo botão conta outra vez; o total de antes fica à vista, marcado, até chegar o novo.
    recount: "Contar de novo",
    recounting: "contando de novo…",
    // RN-SQL-007.
    cursorClosed: "O cursor foi fechado. Execute de novo para continuar.",
    rerun: "Executar de novo",
    null: "NULL",
    // RN-GRADE-021: a dica e o nome do botão de ordenar do cabeçalho dizem o que o próximo clique faz; desabilitado, com o motivo depois.
    sortTitle: (name: string, direction: "asc" | "desc" | null) => (direction === null ? `Ordenar por ${name}, crescente` : direction === "asc" ? `Ordenar por ${name}, decrescente` : `Tirar a ordem de ${name}`),
    sortUnavailable: (title: string, reason: string) => `${title}. Indisponível: ${reason}.`,
    // RN-GRADE-021: o nome da coluna é o botão que escolhe a coluna inteira (RN-GRADE-022), fora do Tab; a dica diz o atalho do teclado.
    chooseColumn: "Escolher a coluna inteira",
    chooseColumnHint: (mac: boolean) => `Clique para escolher a coluna inteira (${mac ? "Control+Espaço" : "Ctrl+Espaço"}).`,
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
      // RN-SQL-017: o valor cortado na grade sai inteiro; este é o que a API não tinha inteiro (passou do teto, ou o resultado mudou).
      exportedCut: (count: number) => (count === 1 ? "1 valor não pôde vir inteiro e sai cortado no arquivo." : `${formatCount(count, "valor", "valores")} não puderam vir inteiros e saem cortados no arquivo.`),
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
      panMode: "Mover pelo diagrama",
      exportPng: "Exportar PNG",
      exportMermaid: "Exportar Mermaid (.md)",
      copyMermaid: "Copiar Mermaid",
      copiedMermaid: "Mermaid copiado",
      filterTablesPlaceholder: "Filtrar tabelas…",
      allColumns: "Todas as colunas",
      keysOnly: "Mostrar só chaves",
      open: (name: string) => `Abrir ${name}`,
      openHint: "Duplo clique abre a tabela",
      legend: { primaryKey: "chave primária", foreignKey: "chave estrangeira", arrow: "a seta sai da tabela com a chave estrangeira e aponta para a tabela referenciada" },
      incoming: "À esquerda ficam as tabelas que apontam para esta; à direita, as que esta tabela referencia.",
      omitted: (shown: number, total: number) => `Mostrando ${shown} de ${total} tabelas referenciadas.`,
      noForeignKeys: "Esta tabela não tem chaves estrangeiras.",
    },
  },

  // RN-ESQUEMA-001 a 003: a aba de um esquema.
  schemaTab: {
    views: { tables: "Tabelas", views: "Visões", routines: "Rotinas", diagram: "Diagrama" },
    viewsLabel: "Vistas do esquema",
    location: (connection: string, database: string) => `${connection} / ${database}`,
    refresh: "Atualizar",
    retry: "Tentar de novo",
    sessionLost: "A sessão com o banco caiu. Tentar de novo abre outra.",
    loading: "Carregando…",
    disconnected: "A conexão está desconectada.",
    disconnectedHint: "Conecte para carregar os objetos e o diagrama deste esquema.",
    connect: "Conectar",
    connecting: "Conectando…",
    filterPlaceholder: "Filtrar objetos…",
    emptyTables: "Este esquema não tem tabelas.",
    emptyViews: "Este esquema não tem visões.",
    emptyRoutines: "Este esquema não tem rotinas.",
    emptyDiagram: "Este esquema não tem tabelas para mostrar no diagrama.",
    columns: {
      name: "Nome",
      estimatedRows: "Linhas estimadas",
      description: "Descrição",
      kind: "Tipo",
    },
    openTable: "Abrir tabela",
    openView: "Abrir visão",
    openDiagram: "Ver diagrama",
    largeDiagramNotice: (count: number) => `Este esquema tem ${formatCount(count, "tabela", "tabelas")}. Recomendamos “Mostrar só chaves” para facilitar a leitura.`,
    renderAnyway: "Desenhar diagrama",
  },

  // RN-BANCO-001: a aba de um banco de dados.
  databaseTab: {
    views: { schemas: "Esquemas", diagram: "Diagrama", properties: "Propriedades" },
    viewsLabel: "Vistas do banco",
    location: (connection: string) => connection,
    refresh: "Atualizar",
    retry: "Tentar de novo",
    sessionLost: "A sessão com o banco caiu. Tentar de novo abre outra.",
    loading: "Carregando…",
    disconnected: "A conexão está desconectada.",
    disconnectedHint: "Conecte para carregar os esquemas, o diagrama e as propriedades deste banco.",
    connect: "Conectar",
    connecting: "Conectando…",
    filterPlaceholder: "Filtrar esquemas…",
    includeSystemSchemas: "Mostrar esquemas de sistema",
    emptySchemas: "Nenhum esquema encontrado neste banco.",
    emptyDiagram: "Este banco não tem tabelas nos esquemas selecionados para mostrar no diagrama.",
    openSchema: "Abrir esquema",
    openSchemaDiagram: "Ver diagrama",
    columns: {
      name: "Esquema",
      system: "Tipo",
      tableCount: "Tabelas",
      viewCount: "Visões",
    },
    userSchema: "usuário",
    systemSchema: "sistema",
    largeDiagramNotice: (count: number) => `Este banco tem ${formatCount(count, "tabela", "tabelas")} nos esquemas selecionados. Recomendamos “Mostrar só chaves” para facilitar a leitura.`,
    renderAnyway: "Desenhar diagrama",
    properties: {
      label: "Propriedades do banco",
      serverVersion: "Versão do servidor",
      characterSet: "Codificação (charset)",
      collation: "Collation",
      currentUser: "Usuário da sessão",
      notAvailable: "Não informado pelo banco",
    },
  },

  status: {
    label: "Barra de status",
    connected: "Conectado",
    disconnected: "Desconectado",
    noTab: "Nenhuma aba ativa",
    // A conexão e o banco da aba ativa (RN-ARVORE-006 e 007): o banco acompanha a troca na troca na barra do editor.
    place: (connection: string, database: string) => `${connection} / ${database}`,
    autoCommit: "Auto-commit",
    // RN-PROT-002: a conexão da aba é somente leitura (a dica diz de onde vem).
    readOnly: "Somente leitura",
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
    // RN-AVISO-003 e RN-SQL-001: a seleção tem mais de um comando, e nada foi enviado; o script executa todos (RN-SQL-019).
    tooManyStatements: (script: string) => `A seleção tem mais de um comando. Nada foi executado: para executar todos, use Executar script (${script}).`,
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
    // RN-ABAS-006: o que não voltou como estava, na entrada. O texto acima de 1 MB não é gravado, e a aba volta vazia.
    restoredEmpty: (title: string) => `O texto de ${title} passava de 1 MB e não foi guardado. A aba voltou vazia.`,
    // RN-ABAS-006: a aba de consulta cuja conexão foi excluída volta sem conexão, como um script sem conexão (RN-SCRIPT-003).
    restoredWithoutConnection: (count: number) => (count === 1 ? "Uma aba voltou sem conexão: a conexão dela não existe mais." : `${formatCount(count, "aba", "abas")} voltaram sem conexão: a conexão delas não existe mais.`),
    // RN-ABAS-006: a aba de uma tabela sempre tem a conexão dela; a da conexão excluída não volta.
    restoredTablesDropped: (count: number) => (count === 1 ? "Uma aba de tabela não voltou: a conexão dela não existe mais." : `${formatCount(count, "aba de tabela", "abas de tabela")} não voltaram: a conexão delas não existe mais.`),
  },
} as const;
