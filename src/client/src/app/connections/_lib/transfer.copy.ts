import { formatCount } from "@/lib/utils/format";

/** "3 conexões", "1 pasta": a conta com a concordância certa. */
const connections = (count: number) => formatCount(count, "conexão", "conexões");
const folders = (count: number) => formatCount(count, "pasta", "pastas");

/**
 * Os textos de exportar e importar conexões (seção 34 da especificação, RN-TRANSF-001 a 016), num lugar só. As frases das recusas são da tela (a API manda o
 * código e, no campo, a mesma frase): "A tela mostra a frase dela, e não o detalhe da API" (RN-TRANSF-010).
 */
export const transferCopy = {
  // RN-TRANSF-002: o diálogo grande da exportação.
  export: {
    title: "Exportar conexões",
    description: "Escolha as conexões e o que vai de cada uma. O arquivo sai cifrado com uma senha de exportação, que você cria aqui.",
    tree: "Pastas e conexões do cofre",
    noUser: "sem usuário",
    user: (userName: string) => `usuário ${userName}`,
    // RN-TRANSF-003: a escolha de cada conexão e os botões que a põem em todas as marcadas.
    credentials: {
      label: (name: string) => `O que vai de ${name}`,
      none: "Sem usuário e senha",
      user: "Só o usuário",
      userAndPassword: "Usuário e senha",
      noUserHint: "A conexão não tem usuário gravado.",
      noPasswordHint: "A conexão não tem senha gravada.",
      bulk: "Para as marcadas:",
      bulkSearching: "Para as marcadas que a busca mostra:",
    },
    passwordsWarning: (count: number) =>
      `As senhas de banco de ${connections(count)} vão no arquivo. Quem tiver o arquivo e a senha de exportação entra nesses bancos com elas. Para exportá-las, o Prism pede a sua senha do Prism.`,
    // RN-TRANSF-004: a senha de exportação, os dois campos e o texto embaixo deles.
    passphrase: "Senha de exportação",
    passphraseAgain: "Repita a senha de exportação",
    showPassphrase: "Mostrar senha",
    passphraseHint: "Não é a sua senha do Prism. Quem importar o arquivo vai precisar dela: passe-a por outro caminho, e nunca na mesma mensagem do arquivo. Sem ela o arquivo não abre, e não há como recuperá-la.",
    passphraseErrors: {
      required: "Crie uma senha de exportação.",
      tooShort: "A senha de exportação precisa ter pelo menos 12 caracteres.",
      tooLong: "A senha de exportação pode ter até 128 caracteres.",
      edgeSpace: "A senha de exportação não pode começar nem terminar com espaço.",
      control: "A senha de exportação não pode ter caractere de controle.",
      mismatch: "As duas senhas não são iguais.",
      samePrismPassword: "Use uma senha de exportação diferente da sua senha do Prism.",
    },
    // RN-TRANSF-006: uma frase só para um código só.
    limits:
      "O arquivo passaria dos limites da importação: até 2.000 conexões, 2.000 pastas, 5 MiB e 32 níveis de pastas a partir da raiz. Exporte em partes; o que está a mais de 32 níveis da raiz só sai se for movido para mais perto dela.",
    // RN-TRANSF-002: a conta do rodapé, com papel de estado.
    counter: (marked: number, withPassword: number, inFile: number) => {
      if (marked === 0 && inFile === 0) return "Nada marcado";
      const connectionPart =
        marked === 0 ? "Nenhuma conexão marcada" : `${formatCount(marked, "conexão marcada", "conexões marcadas")}${withPassword === 0 ? "" : marked === 1 ? ", com a senha" : `, ${withPassword} com a senha`}`;
      return inFile === 0 ? connectionPart : `${connectionPart} · ${folders(inFile)} no arquivo`;
    },
    nothingMarked: "Marque ao menos uma conexão ou pasta.",
    cancel: "Cancelar",
    submit: "Exportar…",
    submitting: "Exportando…",
    // RN-TRANSF-005: o "Confirme a sua senha" da exportação com senhas de banco.
    userPassword: {
      description: "Para exportar as senhas de banco, digite a sua senha do Prism.",
      change: (count: number, name: string | null) => (count === 1 && name !== null ? `Exportar ${name} com a senha` : `Exportar ${connections(count)} com a senha`),
      submit: "Confirmar e exportar",
    },
    // RN-TRANSF-008: o que foi marcado e outra janela excluiu.
    gone: "Uma pasta ou conexão marcada não existe mais. A lista foi lida de novo: confira o que está marcado e exporte de novo.",
    toast: (result: { folders: number; connections: number; withPassword: number }) => {
      if (result.connections === 0) return `${formatCount(result.folders, "pasta exportada", "pastas exportadas")}, sem conexões.`;
      const exported = formatCount(result.connections, "conexão exportada", "conexões exportadas");
      if (result.withPassword === 0) return `${exported}.`;
      if (result.connections === 1) return `${exported}, com a senha.`;
      return result.withPassword === result.connections ? `${exported}, todas com a senha.` : `${exported}, ${result.withPassword} com a senha.`;
    },
  },

  // RN-TRANSF-002 e 011: a árvore de marcar, a mesma nos dois diálogos.
  tree: {
    search: "Buscar pastas e conexões",
    markAll: "Marcar todas",
    unmarkAll: "Desmarcar todas",
    // A seta da pasta tem um nome que não muda; aberta ou fechada é o `aria-expanded` dela.
    contents: (name: string) => `Conteúdo de ${name}`,
    // Para o leitor de tela, ao chegar na caixa: as "NOMINAL" e as "DATA FIX" se repetem em cada pasta de ambiente.
    inFolder: (path: string) => `Na pasta ${path}`,
    nothingFound: (query: string) => `Nada encontrado para “${query}”.`,
    noName: "(sem nome)",
  },

  // RN-TRANSF-009: o diálogo grande da importação.
  import: {
    title: "Importar conexões",
    description: "Escolha um arquivo exportado pelo Prism e digite a senha de exportação que quem o exportou passou a você.",
    file: "Arquivo",
    chooseFile: "Escolher arquivo…",
    noFile: "Nenhum arquivo escolhido",
    chosen: (name: string, size: string) => `${name}, ${size}`,
    fileRequired: "Escolha o arquivo exportado.",
    unreadable: "Não foi possível ler este arquivo.",
    passphrase: "Senha de exportação",
    showPassphrase: "Mostrar senha",
    passphraseErrors: {
      required: "Informe a senha de exportação.",
      tooLong: "A senha de exportação tem até 128 caracteres.",
      wrong: "A senha de exportação não confere, ou o arquivo foi alterado.",
    },
    destination: "Onde colocar",
    root: "Na raiz do navegador",
    destinationGone: "A pasta escolhida não existe mais. Escolha outro lugar.",
    open: "Abrir arquivo",
    opening: "Abrindo…",
    refreshing: "Atualizando a prévia…",
    placeholder: "Escolha o arquivo e digite a senha para ver o que ele traz.",
    // RN-TRANSF-010: uma frase por recusa da leitura, no campo a que se refere.
    fileErrors: {
      limits: "Este arquivo passa dos limites da importação: até 5 MiB, 2.000 conexões, 2.000 pastas e 32 níveis de pastas.",
      invalid: "Este arquivo não é uma exportação de conexões do Prism, ou está danificado.",
      newer: "Este arquivo foi exportado por uma versão mais nova do Prism. Atualize o Prism para importá-lo.",
    },
    // RN-TRANSF-011: a prévia.
    preview: {
      label: "O que o arquivo traz",
      tree: "Pastas e conexões do arquivo",
      summary: (summary: { connections: number; folders: number; withUser: number; withPassword: number }) => {
        if (summary.connections === 0 && summary.folders === 0) return "O arquivo não tem pastas nem conexões.";
        if (summary.connections === 0) return `O arquivo tem ${folders(summary.folders)}, sem conexões.`;
        const where = summary.folders === 0 ? connections(summary.connections) : `${connections(summary.connections)} em ${folders(summary.folders)}`;
        if (summary.withUser === 0 && summary.withPassword === 0) return `O arquivo tem ${where}, sem usuário nem senha.`;
        const parts = [summary.withUser === 0 ? null : `${summary.withUser} com usuário`, summary.withPassword === 0 ? null : `${summary.withPassword} com a senha`].filter((part) => part !== null);
        return `O arquivo tem ${where}: ${parts.join(", ")}.`;
      },
      servers: "Confira os servidores antes de importar. A senha que você digitar numa destas conexões vai para o servidor que o arquivo indica.",
      address: (host: string, port: string, database: string) => `${host}:${port} / ${database}`,
      user: (userName: string) => `usuário ${userName}`,
      withPassword: "com senha",
      withoutPassword: "sem senha",
      noCredentials: "sem usuário e senha",
      tags: {
        existing: "já existe",
        existingFolder: "Já existe uma pasta com este nome neste lugar: o que vem dentro entra nela, e ela fica como está, com a cor, o ambiente e as proteções dela.",
        existingConnection: "Já existe uma conexão com este nome neste lugar. A importação nunca muda nem sobrescreve uma conexão que já existe.",
        renamed: (copyName: string) => `entra como ${copyName}`,
        skipped: "não será importada",
        readOnly: "fica somente leitura",
        irreversible: "confirma os irreversíveis",
        all: "confirma todos os comandos",
        environment: (name: string) => `ambiente ${name}`,
        ownQuery: "consulta própria",
        ownQueryDropped: "consulta própria, não mantida",
        invalid: "não pode ser importada",
      },
      // A dica de cada marca do que a importação grava para a conexão (ou a pasta) não ficar mais fraca (RN-TRANSF-013).
      why: {
        by: (folder: string | null) => (folder === null ? "" : ` pela pasta ${folder}`),
        readOnly: (by: string) => `No arquivo ela era somente leitura${by}. No lugar escolhido nada a protegeria: a importação grava o somente leitura nela mesma.`,
        irreversible: (by: string) => `No arquivo ela confirmava os comandos irreversíveis${by}. No lugar escolhido a confirmação seria mais fraca: a importação grava a da origem nela mesma.`,
        all: (by: string) => `No arquivo ela confirmava todos os comandos${by}. No lugar escolhido a confirmação seria mais fraca: a importação grava a da origem nela mesma.`,
        environment: (name: string, by: string) => `No arquivo ela mostrava o ambiente ${name}${by}. No lugar escolhido ela mostraria outro, ou nenhum: a importação grava o ambiente ${name} nela mesma.`,
      },
      // RN-TRANSF-011: a dica da consulta de verificação própria, com a consulta inteira, como texto.
      query: (query: { text: string; interval: number; enabled: boolean; postgres: boolean }) => {
        const when = query.enabled
          ? `O Prism executa esta consulta sozinho, a cada ${query.interval} segundos, enquanto a conexão estiver conectada, e também no “Testar conexão”: ${query.text}.`
          : `O Prism executa esta consulta no “Testar conexão”, e sozinho, a cada ${query.interval} segundos, se a verificação for ligada: ${query.text}.`;
        return query.postgres ? `${when} Confira antes de importar.` : `${when} O Prism só confere o texto: uma função chamada dentro de um SELECT pode gravar sem que o texto mostre. Confira antes de importar.`;
      },
      invalidFolder: (name: string) => `A pasta ${name} não pode ser importada.`,
    },
    conflicts: {
      legend: "Quando já existir uma conexão com o mesmo nome no mesmo lugar:",
      rename: "Importar com outro nome",
      skip: "Não importar",
      count: (count: number) => (count === 1 ? "1 conexão já existe no lugar escolhido." : `${connections(count)} já existem no lugar escolhido.`),
    },
    queries: {
      keep: "Manter as consultas de verificação do arquivo",
      hint: (count: number) =>
        count === 1
          ? "1 conexão traz uma consulta de verificação própria, que o Prism executa sozinho. Desmarcada, ela entra com a consulta do banco."
          : `${connections(count)} trazem uma consulta de verificação própria, que o Prism executa sozinho. Desmarcada, elas entram com a consulta do banco.`,
    },
    // RN-TRANSF-011: a conta do rodapé, com as pastas que vão como caminho.
    counter: (marked: number, inFile: number) => {
      if (marked === 0 && inFile === 0) return "Nada marcado";
      if (marked === 0) return formatCount(inFile, "pasta marcada", "pastas marcadas");
      if (inFile === 0) return formatCount(marked, "conexão marcada", "conexões marcadas");
      return `${connections(marked)} e ${folders(inFile)} marcadas`;
    },
    cancel: "Cancelar",
    submit: "Importar",
    submitting: "Importando…",
    // RN-TRANSF-014: o aviso diz o que aconteceu de fato.
    toasts: {
      imported: (result: { connections: number; folders: number; renamed: number }) => {
        const parts = [result.connections === 0 ? null : connections(result.connections), result.folders === 0 ? null : folders(result.folders)].filter((part) => part !== null);
        const word = result.connections + result.folders === 1 ? "importada" : "importadas";
        return `${parts.join(" e ")} ${word}${result.renamed === 0 ? "" : `, ${result.renamed} com outro nome`}.`;
      },
      skipped: (count: number) => (count === 1 ? "1 conexão não importada: já existia no lugar escolhido." : `${connections(count)} não importadas: já existiam no lugar escolhido.`),
      nothing: "Nada foi importado: tudo o que estava marcado já existia no lugar escolhido.",
    },
  },

  // RN-TRANSF-001: as entradas do menu do navegador.
  menu: {
    exportConnection: "Exportar conexão…",
    exportConnections: "Exportar conexões…",
    importHere: "Importar conexões aqui…",
    importConnections: "Importar conexões…",
    nothingToExport: "Não há pastas nem conexões para exportar.",
  },

  // RN-TRANSF-015 e 016: a conexão que chegou sem usuário e senha.
  credentials: {
    rowNoCredentials: " · sem usuário e senha",
    rowNoPassword: " · sem senha",
    noticeNoUser: "Esta conexão chegou sem usuário e senha. Preencha para conectar.",
    noticeNoPassword: "Esta conexão chegou sem a senha. Preencha para conectar.",
  },
} as const;
