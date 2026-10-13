import { maxScriptNameLength } from "./saved-scripts";

/** Os textos dos scripts salvos (seção 23 da especificação, RN-SCRIPT-001 a 004): o salvar, a aba, a pergunta de fechar e a seção "Scripts" do navegador. */
export const scriptsCopy = {
  // RN-SCRIPT-001: Ctrl+S e Ctrl+Shift+S.
  save: {
    title: "Salvar script",
    titleAs: "Salvar como",
    description: "O script fica no seu cofre, cifrado: só quem tem a sua senha o lê.",
    nameLabel: "Nome do script",
    save: "Salvar",
    saving: "Salvando…",
    cancel: "Cancelar",
  },
  rename: {
    title: "Renomear script",
    confirm: "Renomear",
    renaming: "Renomeando…",
  },
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
    deleted: (name: string) => `Script ${name} excluído.`,
    copied: "SQL copiado.",
    copyFailed: "Não foi possível copiar o SQL.",
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
    label: "Conexão",
    placeholder: "Escolha a conexão",
    use: "Usar esta conexão",
    none: "Não há conexão cadastrada. Crie uma em Conexões.",
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
    menuLabel: (name: string) => `Ações do script ${name}`,
  },
  menu: {
    open: "Abrir",
    rename: "Renomear",
    copySql: "Copiar SQL",
    delete: "Excluir",
  },
  delete: {
    title: (name: string) => `Excluir o script ${name}?`,
    description: "O SQL dele sai do cofre e não volta. Uma aba aberta com ele continua, com o texto, como uma consulta sem script.",
    confirm: "Excluir",
  },
} as const;
