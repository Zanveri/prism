/** Os textos da tela de Configurações, num lugar só (RN-CONFIG-001). Os do canvas (`Configuracoes.dc.html`) estão como ele os escreve. */
export const settingsCopy = {
  title: "Configurações",
  /** A dica do ícone da barra superior. */
  titleWithShortcut: "Configurações (Ctrl+,)",
  close: "Fechar",
  closeKey: "Esc",
  navLabel: "Seções das configurações",
  numberError: (min: number, max: number) => `Use um número inteiro de ${min} a ${max}.`,
  /** A etiqueta do cartão e a marca ao lado do nome da seção na navegação. */
  soonBadge: "Em breve",
  soonNav: "em breve",

  /** O nome de cada seção na navegação. */
  sections: {
    appearance: "Aparência",
    editor: "Editor SQL",
    updates: "Atualizações",
    drivers: "Drivers",
    about: "Sobre",
    plugins: "Plugins",
    results: "Resultados",
    account: "Conta",
    import: "Importar",
    transactions: "Transações",
    security: "Segurança",
  },

  appearance: {
    // RN-CONFIG-008: a seção do canvas era só o tema; com as fontes, o título é o da seção.
    title: "Aparência",
    themeGroup: "Tema",
    themes: {
      dark: { name: "Prism Escuro", kind: "escuro" },
      light: { name: "Prism Claro", kind: "claro" },
      monokai: { name: "Monokai", kind: "escuro" },
      dracula: { name: "Dracula", kind: "escuro" },
      nord: { name: "Nord", kind: "escuro" },
      githubLight: { name: "GitHub Claro", kind: "claro" },
      kanagawa: { name: "Kanagawa", kind: "escuro" },
    },
    preview: "Prévia",
    followSystem: "Seguir o modo claro ou escuro do sistema",
    note: "O tema vale para toda a interface: editor, grades, painéis e barras de rolagem. Seguindo o sistema, vale o Prism Escuro ou o Prism Claro.",
    // RN-CONFIG-008: a fonte do app é o padrão; as outras são as instaladas neste computador.
    fonts: {
      ui: "Fonte da interface",
      editor: "Fonte do editor SQL",
      uiHint: "Vale para todo o texto do Prism fora do código, também para o navegador e para as grades do resultado e dos Registros.",
      editorHint: "Vale para o editor SQL, o filtro dos Registros e o “Ver SQL”.",
      appFont: "do Prism",
      groups: { monospace: "Monoespaçadas", other: "Outras fontes" },
      loading: "Lendo as fontes deste computador…",
      noMatch: "Nenhuma fonte com esse nome.",
      unreadable: "Não deu para ler as fontes deste computador. Digite o nome de uma fonte instalada e tecle Enter.",
      invalidName: "Esse nome não serve. Tire as aspas, o ponto e vírgula, as chaves e a barra invertida.",
      notInstalled: "Esta fonte não está instalada neste computador. Até ela voltar, vale a do Prism.",
      editorPreview: "Prévia do editor",
    },
    // RN-ZOOM-001: o zoom do programa inteiro, que o processo principal guarda na pasta de dados (e não para o usuário do cofre). A pasta é da conta do
    // computador: no Prism instalado para todos os usuários do Windows, cada conta tem o seu zoom, e a dica não diz "todos os usuários".
    zoom: {
      label: "Zoom do programa",
      zoomOut: "Diminuir o zoom do programa",
      zoomIn: "Aumentar o zoom do programa",
      value: (zoom: number) => `${zoom}%`,
      reset: "Restaurar 100%",
      hint: (mod: string) => `${mod} + e ${mod} − mudam o zoom em qualquer tela, e ${mod} 0 volta a 100%. Vale para todas as janelas, já na abertura, e para todos que entram no Prism nesta conta do computador, não só para você.`,
    },
    // RN-NAV-011: a densidade do navegador, a da árvore e a da lista de scripts.
    density: {
      label: "Densidade do navegador",
      comfortable: "Confortável",
      compact: "Compacta",
      hint: "A compacta tem linhas mais baixas e menos recuo a cada nível: cabem mais itens na árvore e na lista de scripts.",
    },
  },

  editor: {
    title: "Editor SQL",
    fontSize: "Tamanho da fonte",
    tabSize: "Tamanho da tabulação",
    // RN-CONFIG-008: a fonte do editor foi para Aparência, ao lado da fonte da interface.
    fontNote: "A fonte do editor fica em Aparência, ao lado da fonte da interface.",
    preview: "Prévia do editor",
    formatStyle: {
      label: "Estilo de formatação SQL",
      hint: "Aplicado ao pressionar Ctrl+Shift+F no editor (no documento inteiro ou apenas no trecho selecionado). A caixa das palavras-chave segue a opção “Converter palavras-chave para maiúsculas”.",
      river: "River (rio)",
      expanded: "Expandido",
      tabular: "Alinhado à esquerda (tabular)",
      leadingComma: "Vírgula à esquerda",
      compact: "Compacto",
      modern: "Moderno (dbt / analytics)",
    },
    // RN-CONFIG-004: os dois rótulos são os do canvas; as dicas dizem o que o editor faz de fato.
    autocomplete: "Autocompletar ao digitar",
    autocompleteHint: "Sugere as palavras-chave do banco da aba e os nomes que a árvore já carregou: esquemas, tabelas, visões e colunas. Com a conexão aberta, também busca as colunas de uma tabela que você começa a escrever (tabela. ou apelido.) e as chaves estrangeiras que completam o JOIN; fora isso, não consulta o banco. As setas escolhem uma sugestão, e só então o Enter a aceita.",
    uppercaseKeywords: "Converter palavras-chave para maiúsculas",
    uppercaseKeywordsHint: "Só as palavras reservadas (SELECT, FROM, WHERE…), quando você as termina com espaço, vírgula, parêntese ou Enter. Nomes de colunas, texto entre aspas, comentários e o que você cola ficam como estão.",
    // RN-SQL-018 (issue #7): como o "Smart" do DBeaver, com o cuidado de não executar metade de um comando.
    blankLineSeparates: "A linha em branco separa os comandos",
    blankLineSeparatesHint: "Sem seleção, o Ctrl+Enter executa só o comando do cursor, até o ponto e vírgula ou até uma linha em branco, como no DBeaver. A linha em branco só separa quando a de baixo começa outro comando (SELECT, INSERT, UPDATE…) e a de cima não ficou pela metade; nunca dentro de texto, comentário ou rotina. Desligada, só o ponto e vírgula separa.",
    // RN-CONFIG-004 e RN-VAR-025 (seção 41): o valor que a declaração tem na aba, apagado, depois do texto da linha.
    showVariableValues: "Mostrar o valor das variáveis no fim da linha",
    showVariableValuesHint: "Depois que uma declaração (let ou const) é avaliada, o editor escreve o valor dela, apagado, no fim da linha. Não é texto do script: não se seleciona, não se copia e não vai para o arquivo. Some quando você muda a declaração, até a próxima avaliação.",
  },

  // RN-ATUALIZA-007: o que a ponte do processo principal guarda e a tela lê e muda.
  updates: {
    title: "Atualizações",
    checkOnStartup: "Verificar atualizações ao abrir o Prism",
    checkOnStartupHint: "A verificação ao abrir acontece no máximo uma vez a cada 24 horas. “Verificar atualizações” não tem esse limite.",
    loading: "Lendo as preferências de atualização…",
    loadFailed: "Não foi possível ler as preferências de atualização.",
    retry: "Tentar de novo",
    lastChecked: "Última verificação",
    neverChecked: "O Prism ainda não verificou.",
    skipped: "Versão pulada",
    noneSkipped: "Nenhuma.",
    // Não há como desfazer o "pular": a ponte só tem `skipVersion`. A tela mostra o que está guardado, e diz o que isso muda.
    skippedHint: "A verificação ao abrir não oferece essa versão; “Verificar atualizações” oferece sempre.",
  },

  drivers: {
    title: "Drivers",
  },

  about: {
    title: "Sobre o Prism",
    description: "Cliente de banco de dados para Informix, Db2 e PostgreSQL.",
    // A pasta de dados em uso: só para ver e copiar, a tela não a abre nem a troca.
    dataFolder: "Pasta de dados",
    dataFolderHint: "Os cofres e o registro da API ficam aqui.",
  },

  plugins: {
    title: "Plugins de terceiros",
    subtitle: "Estenda o Prism com plugins públicos ou internos via repositório Git (HTTPS ou SSH usando as credenciais da sua máquina) ou pasta local.",
    restrictedBadge: "Modo restrito ativo",
    restrictedNote: "Por segurança, plugins de terceiros estão desativados até que você aceite o termo de responsabilidade.",
    enableButton: "Ativar plugins de terceiros…",
    disableButton: "Voltar ao modo restrito",
    disclaimerTitle: "Aviso de responsabilidade sobre plugins de terceiros",
    disclaimerParagraph1: "Plugins de terceiros executam código JavaScript diretamente no Prism e podem realizar consultas nas sessões de banco de dados abertas ou acessar recursos da sua máquina.",
    disclaimerParagraph2: "O autor e os mantenedores do Prism não auditam, não garantem a segurança e não se responsabilizam por perdas de dados, falhas, vazamentos ou qualquer dano causado por plugins externos ou internos instalados por você.",
    disclaimerCheckbox: "Compreendo os riscos e assumo total responsabilidade pelo uso de plugins de terceiros.",
    disclaimerConfirm: "Ativar plugins de terceiros",
    disclaimerCancel: "Cancelar",
    installTitle: "Instalar ou vincular plugin",
    sourceKindGit: "Repositório Git (HTTPS / SSH)",
    sourceKindLocal: "Pasta local",
    gitPlaceholder: "git@gitlab.empresa.local:equipe/plugin.git ou https://...",
    localPlaceholder: "C:\\Projetos\\PrismPlugins\\SitDescriptions",
    gitHint: "Usa o Git instalado nesta máquina com as suas chaves SSH ou credenciais HTTPS.",
    localHint: "Lê o manifest.json e o main.js diretamente da pasta informada, ideal para desenvolvimento e plugins internos.",
    installButton: "Instalar plugin",
    installingButton: "Instalando…",
    installedTitle: "Plugins instalados",
    emptyList: "Nenhum plugin instalado ainda.",
    updateButton: "Atualizar",
    updatingButton: "Atualizando…",
    removeButton: "Remover",
    enabledLabel: "Ativo",
    disabledLabel: "Inativo",
  },

  // RN-CONFIG-005: o que a grade lê. "Linhas por busca" depende da API (RN-SQL-016) e fica "em breve", sem campo.
  results: {
    title: "Resultados",
    rowsPerPage: "Linhas por busca",
    rowsPerPageSoon: "A página tem 200 linhas, e o tamanho é definido pela API; escolher outro tamanho vem com ela.",
    nullText: "Mostrar valores nulos como",
    nullTextHint: "De 1 a 12 caracteres. A grade usa este texto no lugar do valor nulo; um texto vazio não vale, para o nulo não se confundir com um texto vazio.",
    nullTextError: "Use de 1 a 12 caracteres, que não sejam só espaços.",
    autoLoadMore: "Buscar mais linhas ao rolar até o fim da grade",
    autoLoadMoreHint: "A grade pede a página seguinte sozinha, uma por vez, e para se você cancelar.",
  },

  // RN-SEG-001: o bloqueio por inatividade. O texto do canvas diz também que alterar a opção "Somente leitura" pede a senha, mas essa opção
  // ainda não existe no app: a frase não diz o que o app não faz.
  security: {
    title: "Segurança",
    lockEnabled: "Bloquear o Prism após",
    minutesLabel: "Minutos sem uso até bloquear",
    minutesSuffix: "minutos sem uso",
    note: "Com o Prism bloqueado, o cofre fecha e só a sua senha o reabre. Exibir a senha de uma conexão pede a sua senha sempre.",
  },

  // RN-COFRE-013: trocar a senha do usuário do cofre aberto. Os rótulos e a frase são os do canvas; cada recusa da API aparece no campo dela.
  account: {
    title: "Conta: trocar senha",
    currentPassword: "Senha atual",
    newPassword: "Nova senha",
    newPasswordConfirmation: "Confirmar a nova senha",
    submit: "Trocar senha",
    submitting: "Trocando…",
    note: "Ao trocar, o Prism recriptografa o seu cofre de conexões com a nova senha.",
    changed: "Senha trocada.",
    changedDetail: "O cofre continua aberto, agora com a nova senha.",
    currentRequired: "Informe a senha atual.",
    invalidCurrent: "A senha atual não confere.",
    newTooShort: "A nova senha precisa ter ao menos 8 caracteres.",
    newTooLong: "A nova senha pode ter no máximo 128 caracteres.",
    newInvalid: "A nova senha precisa ter de 8 a 128 caracteres.",
    unchanged: "A nova senha precisa ser diferente da atual.",
    confirmationMismatch: "As senhas não conferem.",
    // RN-AVISO-003: o quinto erro seguido da senha atual fecha o cofre (a mesma regra da revelação de senha), e a tela volta ao login.
    vaultLockedAfterFiveAttempts: "Cofre fechado depois de cinco tentativas.",
  },

  // As seções "em breve": dizem o que virá. Nenhuma tem campo nem botão (RN-CONFIG-001): o que depende da API não finge funcionar.
  transactions: {
    title: "Transações",
    description: "Aqui você vai escolher o modo padrão das novas abas (commit manual ou auto-commit) e o nível de isolamento padrão.",
  },
} as const;
