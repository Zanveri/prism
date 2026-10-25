import { formatCount } from "@/lib/utils/format";

/** "3 conexões", "1 pasta": a conta com a concordância certa. */
const connections = (count: number) => formatCount(count, "conexão", "conexões");
const folders = (count: number) => formatCount(count, "pasta", "pastas");

/**
 * Os textos de importar do DBeaver (seção 40 da especificação, RN-DBEAVER-001 a 018 e RN-CONFIG-011), num lugar só. As frases das recusas do processo
 * principal (`tooLarge`, `notWritable`, `noSpace`) são da tela; a do `unreadable` vem inteira dele, sem caminho (RN-DBEAVER-006).
 */
export const dbeaverCopy = {
  /** Fora do Electron (o navegador do desenvolvimento) as entradas ficam desabilitadas, com esta dica (RN-DBEAVER-003). */
  outside: "Importar do DBeaver só funciona no app do Prism.",

  // RN-DBEAVER-003: as entradas do menu do navegador.
  menu: {
    importDbeaver: "Importar do DBeaver…",
    importDbeaverHere: "Importar do DBeaver aqui…",
  },

  // RN-DBEAVER-006 e 014: as frases das recusas do processo principal, no cartão do "Comece por aqui" e no campo "Origem".
  source: {
    searching: "Procurando o DBeaver neste computador…",
    notFound: "Não encontramos o DBeaver nos lugares de sempre.",
    notDbeaver: "Esta pasta não tem conexões do DBeaver. Escolha a pasta DBeaverData, o workspace ou um projeto.",
    tooLarge:
      "O DBeaver tem mais do que o Prism importa de uma vez: até 50 projetos, 5 MB por arquivo e 32 MB de configuração. Com muitos projetos, use “Escolher a pasta do DBeaver…” e escolha a pasta de um projeto.",
    notWritable: "Não foi possível gravar na pasta de dados do Prism para ler o DBeaver.",
    noSpace: "Não há espaço na pasta de dados do Prism para copiar as conexões do DBeaver.",
    /** A ponte recusou o pedido ou respondeu fora do formato. */
    bridge: "Não foi possível procurar o DBeaver.",
    /** A API não leu a cópia (`DBEAVER_SOURCE_INVALID`, `DBEAVER_SOURCE_MISSING`, ou o que não se esperava). */
    invalid: "O Prism não conseguiu ler as conexões deste DBeaver.",
    missing: "A cópia do DBeaver não existe mais. Procure o DBeaver de novo.",
    unknown: "Não foi possível ler as conexões do DBeaver.",
    /** RN-DBEAVER-007: os limites da prévia e da importação, com "Escolha um projeto só." quando há mais de um projeto. */
    limits: (several: boolean) => `O DBeaver tem mais do que o Prism importa de uma vez: até 2.000 conexões, 2.000 pastas e 32 níveis de pastas.${several ? " Escolha um projeto só." : ""}`,
    projectGone: "O projeto escolhido não existe mais no DBeaver, ou está protegido por senha de projeto. Escolha outro.",
    none: "Nenhuma pasta escolhida.",
    chooseFolder: "Escolher a pasta do DBeaver…",
    retry: "Tentar de novo",
    /** O campo "Origem" (RN-DBEAVER-014). */
    where: {
      standard: "DBeaver neste computador",
      flatpak: "DBeaver (Flatpak) neste computador",
      snap: "DBeaver (Snap) neste computador",
      env: "DBeaver da pasta de DBEAVER_DATA",
      chosen: "Pasta escolhida",
    },
  },

  // RN-DBEAVER-001: o "Comece por aqui".
  startHere: {
    title: "Comece por aqui",
    hint: "Traga as conexões que você já tem, ou crie a primeira.",
    dbeaver: {
      title: "Importar do DBeaver",
      action: "Importar do DBeaver…",
      found: (count: number, where: "standard" | "flatpak" | "snap" | "env" | "chosen") => {
        const place = where === "flatpak" ? " (Flatpak)" : where === "snap" ? " (Snap)" : "";
        return `Encontramos o DBeaver${place} neste computador: ${connections(count)}.`;
      },
      noneImportable: "Encontramos o DBeaver neste computador, mas sem conexões de PostgreSQL, Db2 ou Informix.",
      notFound: "Não encontramos o DBeaver nos lugares de sempre. Se ele guarda o workspace noutro lugar, escolha a pasta.",
    },
    prism: { title: "Importar conexões do Prism", hint: "Um arquivo .prismconexoes que alguém exportou do Prism.", action: "Importar conexões…" },
    create: { title: "Nova conexão", hint: "Informe o servidor, a porta e o usuário de um banco.", action: "Nova conexão" },
    later: "Agora não",
  },

  // RN-NAV-007 e RN-DBEAVER-003: os atalhos do estado vazio.
  empty: { importPrism: "Importar conexões…", importDbeaver: "Importar do DBeaver…" },

  // RN-DBEAVER-014: o diálogo.
  dialog: {
    title: "Importar do DBeaver",
    description: "O Prism lê as conexões, as pastas e os tipos de conexão do DBeaver. Nada é mudado no DBeaver.",
    origin: "Origem",
    project: "Projeto",
    allProjects: "Todos os projetos",
    projectLabel: (name: string, importable: number) => `${name}, ${importable === 0 ? "nenhuma conexão que o Prism importe" : connections(importable)}`,
    projectProtected: "protegido por senha de projeto",
    projectNameInvalid: "O nome deste projeto no DBeaver tem um caractere que o Prism não aceita.",
    projectPosition: (position: number) => `Projeto ${position}`,
    withPasswords: "Levar as senhas",
    withPasswordsHelp: "Desligada, as conexões vêm só com o usuário, e o Prism pede a senha na primeira vez que você conectar.",
    cancel: "Cancelar",
    later: "Agora não",
    submit: "Importar",
    submitting: "Importando…",
    refreshing: "Atualizando a prévia…",
    placeholder: "Procurando o que o DBeaver tem…",
    previewLabel: "O que o DBeaver traz",
    tree: "Pastas e conexões do DBeaver",
    /** A conta do rodapé (RN-DBEAVER-015): a da seção 34, com ", 3 já existem no Prism" no fim quando há. */
    existingInCounter: (count: number) => `, ${count} ${count === 1 ? "já existe" : "já existem"} no Prism`,
  },

  // RN-DBEAVER-015: a prévia.
  preview: {
    summary: (summary: { scope: string | null; connections: number; folders: number; importable: number; withUser: number; withPassword: number; withPasswords: boolean }) => {
      const subject = summary.scope === null ? "O DBeaver tem" : `O projeto ${summary.scope} tem`;
      const where = summary.folders === 0 ? connections(summary.connections) : `${connections(summary.connections)} em ${folders(summary.folders)}`;
      const parts = [summary.withUser === 0 ? null : `${summary.withUser} com usuário`, summary.withPasswords && summary.withPassword > 0 ? `${summary.withPassword} com a senha` : null].filter(
        (part) => part !== null,
      );
      return `${subject} ${where}; o Prism importa ${summary.importable}${parts.length === 0 ? ", sem usuário nem senha" : `: ${parts.join(", ")}`}.`;
    },
    nothingImportable: "O DBeaver não tem conexões que o Prism importe (PostgreSQL, Db2 ou Informix).",
    empty: "O DBeaver não tem pastas nem conexões.",
    servers: "Confira os servidores antes de importar. A senha que você digitar numa destas conexões vai para o servidor que a pasta indica.",
    // O endereço, com o servidor do Informix na segunda linha (RN-DBEAVER-015).
    server: (server: string) => `servidor ${server}`,
    // Os avisos acima da árvore (RN-DBEAVER-015).
    notes: {
      protectedProject: (name: string) => `O projeto ${name} está protegido por senha de projeto e não foi lido.`,
      unreadableFiles: (name: string) => `Um arquivo de conexões do projeto ${name} não pôde ser lido.`,
      unreadableProject: (name: string) => `Os arquivos de conexões do projeto ${name} não puderam ser lidos.`,
      credentialsUnreadable: (project: string | null) =>
        `${project === null ? "As senhas do DBeaver não puderam ser lidas" : `No projeto ${project}, as senhas não puderam ser lidas`}: o arquivo não está no formato que o Prism conhece (o DBeaver pode estar guardando as senhas no armazenamento seguro do sistema). As conexões vêm só com o usuário.`,
      credentialsProtected: (project: string) => `As senhas do projeto ${project} estão protegidas por senha de projeto e não foram lidas. As conexões vêm sem senha.`,
      savedPasswordMissing: (count: number) =>
        `${count} ${count === 1 ? "conexão tem" : "conexões têm"} “Salvar senha” no DBeaver, mas o arquivo não traz a senha (o DBeaver pode estar guardando as senhas no armazenamento seguro do sistema). ${count === 1 ? "Ela vem" : "Elas vêm"} só com o usuário.`,
      withoutSavedPassword: (count: number) => `${count} ${count === 1 ? "conexão está" : "conexões estão"} sem “Salvar senha” no DBeaver e ${count === 1 ? "vem" : "vêm"} só com o usuário.`,
    },
    tags: {
      existsInPrism: "já existe no Prism",
      dbeaverPort: "porta do DBeaver",
      leftOut: "ficou de fora",
      folderCut: "nome cortado",
      environmentCut: "nome do tipo cortado",
      noEnvironment: "sem ambiente",
    },
    hints: {
      existsInPrism: (path: string | null, name: string) =>
        `Esta conexão já foi importada do DBeaver: ela está em ${path === null || path === "" ? "(a raiz)" : path}, com o nome ${name}. Se ficar marcada, você escolhe ao importar se ela é sobrescrita.`,
      dbeaverPort: (port: number | null) =>
        `O DBeaver fala com o Informix pelo protocolo SQLI, e o Prism, pela porta DRDA, que costuma ser outra (a sugerida é 9089). Se conectar falhar, troque a porta em Editar conexão: a do DBeaver era ${port ?? "a que está na linha"}.`,
      confirmAll: (type: string | null) =>
        `No DBeaver, ${type === null ? "o tipo desta conexão" : `o tipo ${type}`} pergunta antes de todo comando que não é SELECT. O Prism não tem essa escolha: “Só comandos irreversíveis” deixaria passar o INSERT e o UPDATE com WHERE, então a conexão vem com “Todos os comandos”, que pergunta também antes do SELECT. Mude em Editar conexão se achar demais.`,
      folderCut: "O nome da pasta foi cortado em 60 caracteres.",
      environmentCut: "O nome do tipo de conexão foi cortado em 30 caracteres.",
      noEnvironment: "O tipo de conexão tem um caractere que o Prism não aceita: a conexão vem sem ambiente.",
      leftOut: (items: string[], tunnel: boolean) => `Ficou de fora: ${items.join("; ")}.${tunnel ? " Sem o túnel ou o proxy, a conexão pode não alcançar o servidor." : ""}`,
    },
    leftOut: {
      informixServer: (server: string | null) => (server === null ? "o servidor Informix" : `o servidor Informix (${server})`),
      sshTunnel: "o túnel SSH",
      proxy: "o proxy",
      driverProperties: "as propriedades do driver",
      bootstrap: "os comandos de inicialização, o banco e o esquema padrão",
      autocommitOff: "o auto-commit desligado (as abas novas seguem Configurações › Transações)",
      events: "os comandos antes e depois de conectar",
      authModel: (model: string | null) => (model === null ? "o login do DBeaver" : `o login do DBeaver (${model})`),
      confirmDataChange: "a confirmação antes de salvar as edições",
      permissions: "as restrições de permissão (viraram somente leitura)",
      navigatorFilters: "os filtros do navegador",
    },
  },

  // RN-DBEAVER-015 e as portas DRDA do Informix (RN-DBEAVER-010).
  drda: {
    title: "Porta DRDA do Informix",
    help: "O Prism conecta ao Informix pela porta DRDA, e o DBeaver guarda a SQLI. Se você sabe a DRDA do servidor, digite: ela vale para as conexões dele que entram agora. Vazio, a porta é a do DBeaver.",
    table: "Porta DRDA de cada servidor do Informix",
    server: "Servidor do DBeaver",
    field: (host: string) => `Porta DRDA de ${host}`,
    placeholder: "opcional",
    invalid: "Digite uma porta de 1 a 65535.",
    sqli: (port: number) => `SQLI ${port}`,
  },

  // RN-DBEAVER-017: a pergunta de sobrescrever.
  overwrite: {
    title: "Sobrescrever?",
    question: (count: number) => (count === 1 ? "1 conexão do DBeaver já existe no Prism. Sobrescrever?" : `${count} conexões do DBeaver já existem no Prism. Sobrescrever?`),
    what: "Sobrescrever troca o nome, o servidor (host e porta), o banco de dados, o usuário, a senha e o ambiente delas pelo que está no DBeaver; no Informix, a porta fica a do Prism. A pasta, a verificação e as proteções que você ligou no Prism continuam.",
    whatDrda: " No Informix, a porta DRDA que você digitou vale também para as que já existem.",
    connected: (count: number) =>
      count === 1
        ? "Uma delas está conectada: o servidor, o usuário e a senha novos valem na próxima conexão; a proteção e o ambiente valem já, no próximo comando."
        : `${count} delas estão conectadas: o servidor, o usuário e a senha novos valem na próxima conexão; a proteção e o ambiente valem já, no próximo comando.`,
    all: "Sobrescrever todas",
    choose: "Escolher quais…",
    none: "Não sobrescrever nenhuma",
    cancel: "Cancelar",
    submitChosen: "Importar e sobrescrever as marcadas",
    list: "Conexões que já existem",
    rowConnected: "Esta conexão está conectada: o servidor, o usuário e a senha novos valem na próxima conexão.",
    nothingChanges: "nada muda",
    /** O que muda em cada campo; `from` e `to` quando a prévia traz o valor de antes. */
    change: {
      name: "nome",
      engine: "banco",
      host: (from: string | null, to: string | null) => (from !== null && to !== null ? `host ${from} → ${to}` : "host"),
      port: (from: number | null, to: number | null) => (from !== null && to !== null ? `porta ${from} → ${to}` : "porta"),
      database: (from: string | null, to: string | null) => (from !== null && to !== null ? `banco de dados ${from} → ${to}` : "banco de dados"),
      userName: (from: string | null, to: string | null) => (from !== null && to !== null && to !== "" ? `usuário ${from === "" ? "(nenhum)" : from} → ${to}` : "usuário"),
      password: "senha",
      environment: (from: string | null, to: string | null) => (from !== null && to !== null ? `ambiente ${from} → ${to}` : "ambiente"),
    },
    keepsName: (name: string) => `o nome fica: já há uma ${name} nesta pasta`,
    dropsPassword: { host: "o host muda e a senha não vem: ela fica sem senha", port: "a porta muda e a senha não vem: ela fica sem senha", userName: "o usuário muda e a senha não vem: ela fica sem senha" },
  },

  // RN-DBEAVER-016: o aviso diz o que aconteceu de fato.
  toasts: {
    imported: (result: { connections: number; folders: number; renamed: number; updated: number }) => {
      const parts = [result.connections === 0 ? null : connections(result.connections), result.folders === 0 ? null : folders(result.folders)].filter((part) => part !== null);
      const word = result.connections + result.folders === 1 ? "importada" : "importadas";
      const extras = [result.renamed === 0 ? null : `${result.renamed} com outro nome`, result.updated === 0 ? null : `${result.updated} ${result.updated === 1 ? "atualizada" : "atualizadas"}`].filter((part) => part !== null);
      return `${parts.join(" e ")} ${word} do DBeaver${extras.length === 0 ? "" : `, ${extras.join(", ")}`}.`;
    },
    updated: (count: number) => `${connections(count)} ${count === 1 ? "atualizada" : "atualizadas"} do DBeaver.`,
    nothing: "Nada foi importado do DBeaver: tudo o que estava marcado já existia.",
  },

  // RN-CONFIG-011: Configurações › Importar.
  settings: {
    title: "Importar",
    description: "Traga as conexões de outro programa.",
    dbeaver: "Importar do DBeaver…",
    prism: "Importar conexões do Prism…",
    last: (when: string) => `Última importação do DBeaver: ${when}.`,
    never: "Você ainda não importou do DBeaver.",
  },
} as const;
