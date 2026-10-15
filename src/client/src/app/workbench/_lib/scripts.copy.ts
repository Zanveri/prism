import { maxScriptNameLength, type ScriptIcon } from "./saved-scripts";

/**
 * Os textos dos scripts salvos (seção 23 da especificação, RN-SCRIPT-001 a 004, o genérico da seção 27, RN-SCRIPT-005, e o ícone e a cor da seção 28,
 * RN-SCRIPT-006): o salvar, o editar, a aba, a pergunta de fechar e a seção "Scripts" do navegador.
 */
export const scriptsCopy = {
  // RN-SCRIPT-001: Ctrl+S e Ctrl+Shift+S.
  save: {
    title: "Salvar script",
    titleAs: "Salvar como",
    description: "O script fica no seu cofre, cifrado: só quem tem a sua senha o lê.",
    nameLabel: "Nome do script",
    // RN-SCRIPT-005: a caixa do script genérico, na primeira vez e no "Salvar como".
    generic: "Script genérico (sem conexão)",
    genericHint: "Abre na conexão que estiver conectada; com mais de uma, pergunta qual.",
    genericLocked: "Esta aba não tem conexão: o script fica genérico.",
    save: "Salvar",
    saving: "Salvando…",
    cancel: "Cancelar",
  },
  rename: {
    title: "Renomear script",
    confirm: "Renomear",
    renaming: "Renomeando…",
  },
  // RN-SCRIPT-006: o "Editar script…", com o nome, o ícone e a cor.
  edit: {
    title: "Editar script",
    description: "O ícone e a cor identificam o script na seção Scripts e na aba dele.",
    icon: "Ícone",
    color: "Cor do ícone",
    submit: "Salvar",
    submitting: "Salvando…",
  },
  // RN-SCRIPT-006: o nome de cada ícone da lista fechada (`scriptIcons`), que é o nome acessível e a dica do botão dele.
  icons: {
    document: "Documento (padrão)",
    code: "Código",
    database: "Banco de dados",
    table: "Tabela",
    chart: "Gráfico",
    clock: "Relógio",
    lightning: "Raio",
    bug: "Inseto",
    wrench: "Chave inglesa",
    star: "Estrela",
    flag: "Bandeira",
  } satisfies Record<ScriptIcon, string>,
  // RN-SCRIPT-004: as recusas do nome e do tamanho, no campo do diálogo (as da API dizem o mesmo).
  errors: {
    empty: "Dê um nome ao script.",
    tooLong: `O nome pode ter até ${maxScriptNameLength} caracteres.`,
    control: "O nome não pode ter tabulação, quebra de linha nem outro caractere de controle.",
    taken: "Já existe um script com esse nome.",
    tooLarge: "O SQL passa de 1 MB e não pode ser salvo como script.",
  },
  toasts: {
    saved: (name: string) => `Script ${name} salvo.`,
    renamed: (name: string) => `Script renomeado para ${name}.`,
    // RN-SCRIPT-006.
    edited: (name: string) => `Script ${name} alterado.`,
    deleted: (name: string) => `Script ${name} excluído.`,
    copied: "SQL copiado.",
    copyFailed: "Não foi possível copiar o SQL.",
    // RN-SCRIPT-005: o menu do script tornou-o genérico, ou o vinculou à conexão da aba aberta com ele.
    madeGeneric: (name: string) => `Script ${name} agora é genérico.`,
    bound: (name: string, connection: string) => `Script ${name} vinculado à conexão ${connection}.`,
    tooLarge: "O SQL passa de 1 MB e não pode ser salvo como script.",
    // A aba sem conexão não executa (RN-SCRIPT-003): a de um script, ou a que voltou na entrada sem a conexão dela (RN-ABAS-006).
    noConnection: "Escolha uma conexão para executar o SQL desta aba.",
    connectionMissing: (name: string) => `A conexão do script ${name} não existe mais. Escolha outra para executá-lo.`,
  },
  // A faixa de abas: o nome do script, e o ponto da mudança não salva.
  tab: {
    unsaved: "alterações não salvas",
    titleUnsaved: (title: string) => `${title} (alterações não salvas)`,
  },
  // Fechar uma aba de script com mudança não salva (RN-SCRIPT-001), e várias de uma vez (fechar todas, fechar a janela).
  unsaved: {
    titleOne: (name: string) => `Salvar as alterações do script ${name}?`,
    titleMany: (count: number) => `${count.toLocaleString("pt-BR")} scripts com alterações não salvas`,
    descriptionOne: "Sem salvar, o que mudou desde a última vez que ele foi salvo se perde.",
    descriptionMany: (names: string[]) => `${names.join(", ")}. Sem salvar, o que mudou desde a última vez que cada um foi salvo se perde.`,
    save: "Salvar",
    saveMany: "Salvar todos",
    saving: "Salvando…",
    discard: "Descartar",
    cancel: "Cancelar",
  },
  // RN-SCRIPT-003: o script cuja conexão não existe mais abre numa aba sem conexão, que pede uma.
  noConnection: {
    title: "Esta aba não tem conexão",
    description: "A conexão em que o script foi salvo não existe mais. Escolha outra para executá-lo.",
    // RN-ABAS-006: a aba de consulta que voltou na entrada sem a conexão dela, que foi excluída.
    descriptionTab: "A conexão desta aba não existe mais. Escolha outra para executar.",
    // RN-SCRIPT-005: o script genérico abriu com mais de uma conexão conectada, ou com nenhuma.
    descriptionGeneric: "Script genérico: escolha a conexão em que ele vai rodar.",
    connectedMark: "conectada",
    label: "Conexão",
    placeholder: "Escolha a conexão",
    use: "Usar esta conexão",
    none: "Não há conexão cadastrada. Crie uma pelo “Nova conexão” da barra do navegador.",
    status: "Sem conexão",
  },
  // RN-SCRIPT-003: a seção "Scripts" do navegador.
  section: {
    title: "Scripts",
    list: "Scripts salvos",
    show: "Mostrar os scripts",
    hide: "Esconder os scripts",
    empty: "Nenhum script salvo. Ctrl+S numa aba de consulta salva o SQL dela aqui.",
    loading: "Carregando…",
    failed: "Não foi possível carregar os scripts.",
    retry: "Tentar de novo",
    rowHint: (name: string) => `${name}. Duplo clique ou Enter abre o script numa aba de consulta.`,
    rowHintGeneric: (name: string) => `${name}, script genérico. Duplo clique ou Enter abre o script na conexão conectada, ou pergunta qual.`,
    // RN-SCRIPT-005: a marca discreta do script genérico na lista.
    generic: "genérico",
    menuLabel: (name: string) => `Ações do script ${name}`,
  },
  menu: {
    open: "Abrir",
    rename: "Renomear",
    // RN-SCRIPT-006.
    edit: "Editar script…",
    copySql: "Copiar SQL",
    // RN-SCRIPT-005.
    makeGeneric: "Tornar genérico",
    bind: "Vincular à conexão da aba",
    bindUnavailable: "Abra o script numa aba e escolha a conexão dela.",
    delete: "Excluir",
  },
  delete: {
    title: (name: string) => `Excluir o script ${name}?`,
    description: "O SQL dele sai do cofre e não volta. Uma aba aberta com ele continua, com o texto, como uma consulta sem script.",
    confirm: "Excluir",
  },
} as const;
