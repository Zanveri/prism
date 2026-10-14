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
    rename: { title: "Renomear pasta", submit: "Renomear", submitting: "Renomeando…" },
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
    folderRenamed: "Pasta renomeada.",
    folderMoved: "Pasta movida.",
    folderDeleted: "Pasta excluída.",
    // RN-AVISO-003: o quinto erro de senha fecha o cofre e a tela volta ao login.
    vaultLockedAfterFiveAttempts: "Cofre fechado depois de cinco tentativas.",
  },
} as const;
