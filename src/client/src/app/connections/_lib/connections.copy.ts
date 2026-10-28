import { formatCount } from "@/lib/utils/format";

/**
 * Os textos das pastas e das conexões, num lugar só (RN-AVISO-002, RN-AVISO-003, RN-CONN-002): os diálogos de pasta, o diálogo de conexão
 * (RN-NAV-004 e 005), o de mover e o de renomear conexão e o de revelar a senha. A tela de Conexões deixou de existir (RN-NAV-001); o que o navegador diz
 * está em `workbench.copy.ts` e `navigator.copy.ts`.
 */
export const connectionsCopy = {
  folder: {
    parent: "Pasta pai",
    noParent: "Sem pasta pai",
    name: "Nome da pasta",
    cancel: "Cancelar",
    create: { title: "Nova pasta", subfolderTitle: "Nova subpasta", submit: "Criar pasta", submitting: "Criando…" },
    // RN-PASTA-006: o "Editar pasta…" tem o nome, a cor da pasta e o ambiente.
    edit: { title: "Editar pasta", submit: "Salvar", submitting: "Salvando…" },
    // RN-NAV-009: o "Renomear" (F2), só com o nome, como o da conexão.
    rename: { title: "Renomear pasta", submit: "Renomear", submitting: "Renomeando…", nameTaken: "Já existe uma pasta com este nome aqui." },
    // RN-PASTA-007: a cor do ícone da pasta, à parte do ambiente.
    color: "Cor da pasta",
    colorHint: "Pinta o ícone da pasta na árvore. Não é o ambiente: não passa às subpastas nem às conexões.",
    move: { title: "Mover pasta", description: (name: string) => `Escolha a pasta de destino de ${name}.`, submit: "Mover", submitting: "Movendo…" },
    remove: { title: "Excluir pasta", description: (name: string) => `A pasta ${name} será excluída. Só uma pasta vazia, sem subpastas e sem conexões, pode ser excluída.`, submit: "Excluir pasta", submitting: "Excluindo…" },
  },

  form: {
    newTitle: "Nova conexão",
    newSubtitle: "Informe os dados de acesso. A conexão fica salva no seu cofre.",
    // RN-NAV-005: "Nova conexão" começa pela grade de bancos; escolhido o banco, o mesmo diálogo passa às configurações.
    chooseSubtitle: "Escolha o banco de dados. Depois vêm os dados de acesso.",
    next: "Avançar",
    back: "Voltar",
    // RN-NAV-004: cancelar (e Esc) com algo digitado pergunta antes.
    discard: {
      newTitle: "Descartar a nova conexão?",
      editTitle: "Descartar as alterações?",
      description: "O que você preencheu neste formulário ainda não foi salvo e será perdido.",
      confirm: "Descartar",
      cancel: "Continuar editando",
    },
    savedSubtitle: (engine: string) => `Conexão ${engine} salva no seu cofre.`,
    engine: "Banco de dados",
    // RN-NAV-005: a grade de bancos que abre o diálogo, com o estado do driver de cada um.
    engines: {
      states: {
        bundled: "Driver embutido",
        installed: "Driver instalado",
        missing: "Driver não instalado",
        installing: "Baixando o driver…",
        installingPercent: (percent: number) => `Baixando o driver… ${percent}%`,
        failed: "O download do driver falhou",
        unavailable: "Sem driver para esta plataforma",
        comingSoon: "Em breve",
        unknown: "",
      },
      unavailableReason: "O fabricante não publica o driver deste banco para esta plataforma.",
      comingSoonReason: "O Prism ainda não conecta neste banco.",
      soonNote: "Os bancos marcados “Em breve” estão no catálogo, e o Prism ainda não conecta neles.",
    },
    // RN-NAV-005: o driver do banco escolhido, no passo das configurações.
    driver: {
      missing: (driver: string) => `O driver ${driver}, que atende este banco, não está instalado.`,
      missingHint: "Dá para salvar a conexão agora e instalar depois; testar e conectar pedem o driver.",
      installing: (driver: string) => `Baixando o driver ${driver}…`,
      failed: (driver: string) => `O download do driver ${driver} falhou.`,
      unavailable: "Esta máquina não tem driver para este banco.",
    },
    name: "Nome da conexão",
    folder: "Pasta",
    noFolder: "Sem pasta",
    host: "Host",
    port: "Porta",
    database: "Banco de dados",
    userName: "Usuário do banco",
    password: "Senha do banco",
    // Cabe no campo de meia largura; quem quer trocar a senha digita, quem quer mantê-la deixa vazio (RN-CONN-004).
    passwordKept: "Deixe vazio para manter",
    showPassword: "Mostrar senha",
    hidePassword: "Ocultar senha",
    passwordNotice: "A senha do banco fica criptografada com a sua senha do Prism. Para exibi-la, o Prism pede a sua senha de novo.",
    // RN-CONN-017: a última bolinha é "Outra cor", e a cor escolhida por ela vai no nome dela. RN-PASTA-005: a seção é a mesma na pasta.
    environment: {
      title: "Ambiente",
      name: "Nome do ambiente",
      color: "Cor do ambiente",
      otherColor: "Outra cor",
      otherColorChosen: (hex: string) => `Outra cor: ${hex}`,
      // RN-AMB-001: os ambientes que as pastas e as conexões já usam, para reaproveitar.
      saved: "Ambientes já usados",
      useSaved: (environment: string) => `Usar o ambiente ${environment}`,
      connectionHint: "O nome e a cor identificam esta conexão na árvore, nas abas e na barra de status. Em branco, ela herda o ambiente da pasta, se houver.",
      folderHint: "O nome e a cor identificam esta pasta na árvore. As conexões dela sem ambiente próprio herdam este.",
      inherits: (environment: string, folder: string) => `Herda ${environment} da pasta ${folder}.`,
      // A dica da etiqueta herdada, na árvore, na aba e na barra de status.
      inheritedFrom: (folder: string) => `Herdado da pasta ${folder}`,
    },
    save: "Salvar",
    saving: "Salvando…",
    test: "Testar conexão",
    testing: "Testando…",
    cancel: "Cancelar",
    remove: "Excluir",
    removeConfirm: {
      title: "Excluir conexão",
      // As abas de consulta da conexão fecham junto (RN-CONN-014), e o SQL que está nelas não fica em lugar nenhum.
      description: (name: string, openTabs: number) =>
        `A conexão ${name} será removida do seu cofre, junto com a senha gravada, e as sessões abertas com ela serão encerradas.` +
        (openTabs === 0 ? "" : ` ${formatCount(openTabs, "aba de consulta aberta nesta conexão será fechada", "abas de consulta abertas nesta conexão serão fechadas")}, e o SQL que está ${openTabs === 1 ? "nela" : "nelas"} será perdido.`),
      submit: "Excluir conexão",
      submitting: "Excluindo…",
    },
  },

  // Os nomes das seis cores do canvas, que também são o rótulo de acessibilidade de cada uma.
  colors: [
    { name: "Vermelho", hex: "#FF8A7A" },
    { name: "Âmbar", hex: "#F2B644" },
    { name: "Verde", hex: "#5ED3A3" },
    { name: "Azul", hex: "#7DB2FF" },
    { name: "Violeta", hex: "#B79CFF" },
    { name: "Cinza", hex: "#AEB7C4" },
  ],

  // RN-PASTA-007 e RN-SCRIPT-006: as bolinhas da cor de um ícone (a pasta, o script), com "Sem cor" na frente.
  iconColor: {
    none: "Sem cor",
    other: "Outra cor",
    otherChosen: (hex: string) => `Outra cor: ${hex}`,
  },

  // RN-NAV-003: mover uma conexão de pasta pelo menu do navegador (na tela de Conexões era trocar a pasta no formulário).
  move: {
    title: "Mover conexão",
    description: (name: string) => `Escolha a pasta de destino de ${name}.`,
    folder: "Pasta",
    noFolder: "Sem pasta",
    cancel: "Cancelar",
    submit: "Mover",
    submitting: "Movendo…",
  },

  // RN-VERIF-001: o painel "Sessão da conexão" do formulário, como no canvas, com a consulta de verificação que a pessoa pode preencher no lugar da fixa e sem
  // o "Encerrar a conexão após N minutos sem uso", que continua fora (seção 13).
  session: {
    title: "Sessão da conexão",
    verify: "Verificar a cada",
    interval: "Intervalo da verificação, em segundos",
    seconds: "segundos",
    hint: "Enquanto a conexão estiver aberta, o Prism executa a consulta abaixo nesse intervalo e atualiza o indicador ao lado do nome da conexão.",
    query: "Consulta de verificação",
    queryHint:
      "Em branco, vale a do banco, a sua forma de SELECT 1: no PostgreSQL, SELECT 1; no Db2, SELECT 1 FROM SYSIBM.SYSDUMMY1; no Informix, SELECT 1 FROM systables WHERE tabid = 1. A sua tem de ser uma leitura só e é lida até o fim a cada verificação: prefira uma que devolva uma linha. “Testar conexão” também a usa.",
  },

  // RN-PROT-001 a 004: a seção Proteções, a mesma no formulário da conexão e no diálogo da pasta (o canvas, com a escolha de três no lugar da caixa).
  protections: {
    title: "Proteções",
    confirm: {
      legend: "Confirmar antes de executar",
      choices: { none: "Não", irreversible: "Só comandos irreversíveis", all: "Todos os comandos" },
      connectionHint:
        "Antes de executar, o Prism abre um aviso com o nome e a cor do ambiente e só executa depois da sua confirmação: em “Só comandos irreversíveis”, antes de DROP, TRUNCATE, ou DELETE e UPDATE sem WHERE; em “Todos os comandos”, antes de qualquer comando.",
      folderHint: "Vale para todas as conexões da pasta e das subpastas: em “Só comandos irreversíveis”, DROP, TRUNCATE, ou DELETE e UPDATE sem WHERE só executam depois da sua confirmação; em “Todos os comandos”, qualquer comando.",
    },
    readOnly: {
      label: "Somente leitura",
      connectionHint: "Nenhum comando que altere dados ou estrutura é executado nesta conexão: INSERT, UPDATE, DELETE, CREATE, ALTER, DROP e TRUNCATE ficam bloqueados. Para marcar ou desmarcar esta opção, o Prism pede a sua senha.",
      folderHint: "Nenhum comando que altere dados ou estrutura é executado nas conexões desta pasta. Para marcar ou desmarcar esta opção, o Prism pede a sua senha.",
    },
    // RN-PROT-002: o cadeado ao lado do nome da conexão (a árvore, a lista do botão da conexão da aba, a barra de status) e a dica dele.
    readOnlyMark: (folder: string | null) => (folder === null ? "Somente leitura" : `Somente leitura, herdado da pasta ${folder}`),
    // RN-PROT-004: a proteção herdada aparece marcada e desabilitada, e a frase diz de onde vem e por que não se afrouxa aqui.
    inheritedFrom: (folder: string) => `Herdado da pasta ${folder}`,
    connectionCannotLoosen: (folder: string) => `A pasta ${folder} impõe esta proteção a tudo o que está dentro dela, e a conexão não a afrouxa: para tirá-la, mude a pasta ou mova a conexão para fora dela.`,
    folderCannotLoosen: (folder: string) => `A pasta ${folder} impõe esta proteção a tudo o que está dentro dela, e esta pasta não a afrouxa: para tirá-la, mude a pasta ${folder} ou mova esta para fora dela.`,
  },

  internalDescriptions: {
    label: "Utilizar descrições internas",
    folderHint: "Todas as conexões desta pasta e das subpastas terão esta opção marcada por padrão, mas ela pode ser desmarcada individualmente em cada conexão.",
    connectionHint: "Exibe a descrição da tabela (diaabr) e dos atributos (diadii) consultando o mesmo servidor e banco onde a tabela está sendo visualizada.",
    inheritedFrom: (folder: string) => `Marcado por padrão pela pasta ${folder} (pode ser desmarcado nesta conexão).`,
    overriddenOffFrom: (folder: string) => `Desmarcado nesta conexão (a pasta ${folder} tem esta opção marcada).`,
  },

  // RN-PROT-003: a senha do usuário que a mudança do somente leitura pede, num diálogo como o de revelar a senha.
  userPassword: {
    title: "Confirme a sua senha",
    description: "Esta mudança tira ou põe uma proteção. Para salvar, digite a sua senha do Prism.",
    markReadOnly: (name: string) => `Marcar “Somente leitura” em ${name}`,
    unmarkReadOnly: (name: string) => `Desmarcar “Somente leitura” de ${name}`,
    leaveReadOnly: (name: string) => `Tirar ${name} de uma pasta somente leitura`,
    password: "Sua senha do Prism",
    required: "Informe a sua senha do Prism.",
    invalidPassword: "Senha incorreta.",
    attempts: "Cinco senhas erradas seguidas fecham o cofre, e o Prism volta à tela de entrada.",
    cancel: "Cancelar",
    submit: "Confirmar e salvar",
    submitting: "Verificando…",
  },

  // RN-NAV-009: renomear uma conexão pelo navegador (F2 ou o menu), num diálogo só com o nome.
  rename: {
    title: "Renomear conexão",
    name: "Nome da conexão",
    nameTaken: "Já existe uma conexão com este nome nesta pasta.",
    cancel: "Cancelar",
    submit: "Renomear",
    submitting: "Renomeando…",
  },

  reveal: {
    title: "Confirme a sua senha",
    description: { before: "Para exibir a senha de ", between: " em ", after: ", digite a sua senha do Prism." },
    password: "Sua senha do Prism",
    invalidPassword: "Senha incorreta.",
    cancel: "Cancelar",
    submit: "Exibir senha",
    submitting: "Verificando…",
  },

  toasts: {
    connectionCreated: "Conexão criada.",
    connectionUpdated: "Conexão alterada.",
    connectionDeleted: "Conexão excluída.",
    connectionMoved: "Conexão movida.",
    connectionRenamed: "Conexão renomeada.",
    // RN-CONN-016: a cópia aparece escolhida no navegador.
    connectionDuplicated: "Conexão duplicada.",
    // RN-AVISO-002 e RN-AVISO-004. A falha leva a frase da tela, não o `title` da API: a mensagem do banco fica abaixo dos botões.
    connectionTested: "Conexão testada com sucesso.",
    connectionTestFailed: "Não foi possível conectar.",
    folderCreated: "Pasta criada.",
    folderUpdated: "Pasta alterada.",
    folderRenamed: "Pasta renomeada.",
    folderMoved: "Pasta movida.",
    folderDeleted: "Pasta excluída.",
    // RN-AVISO-003: o quinto erro de senha fecha o cofre e a tela volta ao login.
    vaultLockedAfterFiveAttempts: "Cofre fechado depois de cinco tentativas.",
  },
} as const;
