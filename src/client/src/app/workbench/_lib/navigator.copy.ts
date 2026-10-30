import { formatCount } from "@/lib/utils/format";

/**
 * Os textos que o navegador ganhou quando as telas de Conexões e de Drivers passaram para a área de trabalho (seção 20 da especificação,
 * RN-NAV-001 a 008). Os que ele já tinha continuam em `workbench.copy.ts`.
 */
export const navigatorCopy = {
  // RN-NAV-002: a barra de ações acima da árvore. Cada botão é só um ícone: o nome é o que o leitor de tela diz e o que a dica mostra. A barra é da árvore das
  // conexões, e o nome dela o diz: a seção Scripts tem a árvore e os menus dela (RN-SCRIPT-008 e 009).
  toolbar: {
    label: "Ações da árvore de conexões",
    newConnection: "Nova conexão",
    newConnectionIn: (folder: string) => `Nova conexão em ${folder}`,
    newFolder: "Nova pasta",
    newFolderIn: (folder: string) => `Nova pasta em ${folder}`,
    connect: "Conectar",
    connectTo: (connection: string) => `Conectar ${connection}`,
    disconnect: "Desconectar",
    disconnectFrom: (connection: string) => `Desconectar ${connection}`,
    refresh: "Atualizar",
    refreshItem: (name: string) => `Atualizar ${name}`,
    collapseAll: "Recolher tudo",
    hide: "Esconder o navegador",
  },

  // RN-NAV-008: o navegador retrátil. O botão da barra superior é de alternar: o nome é fixo, e a dica diz o que o clique faz agora.
  layout: {
    toggle: "Mostrar o navegador",
    show: "Mostrar o navegador",
    hide: "Esconder o navegador",
  },

  // RN-NAV-007: o primeiro uso, na área das abas.
  firstUse: {
    title: "Nenhuma conexão salva",
    hint: "Crie a primeira conexão para navegar pelos objetos do banco e rodar SQL. O formulário começa pela escolha do banco: PostgreSQL, Db2 ou Informix.",
    action: "Nova conexão",
  },

  // RN-NAV-007: o navegador sem conexão nenhuma; o "Nova conexão" grande fica na área das abas.
  empty: {
    hint: "Crie a primeira pelo “Nova conexão” da barra acima. Pastas organizam as conexões.",
  },

  // RN-NAV-003: a dica da linha da conexão traz o que a lista da tela de Conexões mostrava embaixo do nome.
  row: {
    connectionHint: (engine: string, host: string, port: number, database: string) => `${engine} · ${host}:${port} / ${database}`,
  },

  // RN-NAV-010: o seletor de ambiente, na linha abaixo do campo de busca, ao lado de "Só as conectadas".
  environmentFilter: {
    label: "Filtrar por ambiente",
    all: "Todos os ambientes",
    none: "Sem ambiente",
    clear: "Limpar o filtro de ambiente",
    nothingIn: (environment: string) => `Nenhuma conexão em ${environment}.`,
    nothingWithout: "Nenhuma conexão sem ambiente.",
  },

  // RN-NAV-013: "Só as conectadas", o botão de alternar na linha abaixo do campo de busca, antes do seletor de ambiente, que diz quantas conexões estão conectadas, ligado ou não. O nome
  // acessível é o rótulo com a conta ("Só as conectadas: 3 conectadas"); o estado é o `aria-pressed`, e a dica diz o que o clique faz agora.
  connectedFilter: {
    label: "Só as conectadas",
    count: (count: number) => (count === 0 ? "Nenhuma conectada" : formatCount(count, "conectada", "conectadas")),
    showOnly: "Mostrar só as conexões conectadas, com as pastas no caminho até elas",
    showAll: "Mostrar todas as conexões",
    nothing: "Nenhuma conexão conectada.",
    nothingIn: (environment: string) => `Nenhuma conexão conectada em ${environment}.`,
    nothingWithout: "Nenhuma conexão conectada sem ambiente.",
    // O que desliga o filtro na árvore vazia.
    clear: "Mostrar todas",
  },

  // RN-NAV-003: os itens do menu de contexto que vieram da tela de Conexões.
  menu: {
    label: "Ações do navegador",
    newConnection: "Nova conexão",
    newFolder: "Nova pasta",
    moveConnection: "Mover",
    deleteConnection: "Excluir",
    // RN-NAV-009 e RN-CONN-016.
    renameConnection: "Renomear",
    duplicateConnection: "Duplicar conexão",
  },

  // RN-ARVORE-009: o indicador de ir ao item pelas primeiras letras, nas duas árvores. `none` é o que o leitor de tela anuncia (`aria-live`).
  typeAhead: {
    typed: (text: string) => `Ir para: ${text}`,
    none: (text: string) => `Nenhum item começa com “${text}”`,
  },
} as const;
