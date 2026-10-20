import type { InstallFormat } from "../../../electron/update/packages";

/** Os textos das atualizações, num lugar só (seção 17 da especificação: RN-ATUALIZA-002, 003, 006 e 009). */
export const updateCopy = {
  check: "Verificar atualizações",
  checking: "Verificando…",
  version: (version: string) => `versão ${version}`,

  // A consulta manual sempre mostra o resultado (RN-ATUALIZA-002). A versão nova abre o diálogo; o resto é aviso.
  toasts: {
    upToDate: "O Prism está atualizado.",
    upToDateDetail: (version: string) => `A versão instalada, ${version}, é a mais recente.`,
    // Há uma versão mais nova, mas ela saiu sem o pacote deste sistema (a falha de um pacote não segura as outras plataformas).
    upToDateWithoutPackage: (version: string, newer: string) => `A versão instalada, ${version}, é a mais recente que tem pacote para este sistema. A versão ${newer} saiu sem ele; o Prism oferece a próxima que tiver.`,
    noSource: "Este Prism não procura atualizações.",
    noSourceDetail: "Ele foi gerado sem a origem das atualizações (pacote de desenvolvimento ou gerado à mão).",
    checkFailed: "Não foi possível verificar as atualizações.",
    busy: "Há uma atualização em andamento.",
    // RN-ATUALIZA-008: o app foi aberto com um argumento que tira a garantia do HTTPS.
    blocked: "As atualizações estão desligadas nesta abertura.",
    blockedDetail: "O Prism foi aberto com um argumento de linha de comando que dispensa a conferência do certificado ou troca o endereço dos servidores. Abra o Prism sem esse argumento para atualizar.",
    requestFailed: "A atualização não pôde continuar.",
  },

  dialog: {
    title: "Nova versão do Prism",
    installed: "Versão instalada",
    latest: "Nova versão",
    releasedOn: (date: string) => `de ${date}`,
    notesOf: (version: string) => `Versão ${version}`,
    noNotes: "Esta versão não traz notas.",
    omitted: (count: number) => (count === 1 ? "Mais 1 versão anterior não aparece nesta lista." : `Mais ${count} versões anteriores não aparecem nesta lista.`),
    sums: "Somas de verificação",
    noSums: "As notas desta versão não trazem somas SHA-256: o Prism não instala uma atualização sem elas.",
    // RN-ATUALIZA-009: o que a tela diz sobre a confiança.
    trust: "A atualização é baixada das releases do projeto no GitHub e conferida por duas somas SHA-256, e uma release publicada não pode ser trocada. Os pacotes ainda não são assinados.",
    noStartupCheck: "Não verificar ao abrir",

    update: "Atualizar agora",
    later: "Depois",
    skip: "Pular esta versão",
    cancel: "Cancelar",
    retry: "Tentar de novo",
    close: "Fechar",
    install: "Instalar agora",
    reveal: "Mostrar na pasta de downloads",

    // O que "Atualizar agora" faz, dito antes de baixar (RN-ATUALIZA-006).
    next: {
      nsis: "Depois de baixar e conferir, o Prism fecha, instala a versão nova e abre de novo. O texto das abas de SQL abertas não é salvo.",
      // RN-INSTALA-003: a instalação para todos os usuários pede a permissão de administrador a cada atualização.
      nsisForAll: "O Prism está instalado para todos os usuários: depois de baixar e conferir, ele fecha e o Windows pede a permissão de administrador. Com ela, a versão nova é instalada e o Prism abre de novo. Sem ela, nada muda, e ele abre na versão de agora. O texto das abas de SQL abertas não é salvo.",
      manual: "O Prism baixa e confere o pacote e, quando você mandar, deixa-o na sua pasta de downloads e a mostra. A instalação é feita por você.",
      unavailable: "Não há pacote desta versão para o sistema e a arquitetura deste computador.",
    },

    downloading: "Baixando a atualização…",
    downloadProgress: "Progresso do download da atualização",
    received: (received: string) => `${received} recebidos`,
    receivedOf: (received: string, total: string) => `${received} de ${total}`,

    ready: "Atualização baixada e conferida.",
    readyNsis: "O Prism vai fechar para instalar a versão nova e abrir de novo.",
    readyManual: "Falta deixar o pacote na sua pasta de downloads: é o botão abaixo.",

    installing: "Instalando a versão nova.",
    installingDetail: "O Prism vai fechar e abrir de novo sozinho. Não é preciso fazer nada.",
    installingDetailForAll: "O Prism vai fechar, e o Windows pede a permissão de administrador. Com ela, a versão nova é instalada e o Prism abre de novo.",

    failed: "A atualização não foi concluída.",

    delivered: (fileName: string) => `O pacote conferido está na sua pasta de downloads: ${fileName}`,
  },

  // A atualização do Windows que não foi instalada (RN-INSTALA-003): o aviso ao abrir de novo na versão de antes.
  notice: {
    title: (version: string) => `A versão ${version} não foi instalada.`,
    forAll: (current: string) => `O Prism continua na versão ${current}. Ele está instalado para todos os usuários, e a atualização pede a permissão de administrador do Windows. Para tentar de novo, use “Verificar atualizações”.`,
    forMe: (current: string) => `O Prism continua na versão ${current}. O instalador terminou sem atualizá-lo. Para tentar de novo, use “Verificar atualizações”.`,
  },

  // O canal beta (RN-ATUALIZA-010): a opção em Configurações › Atualizações e o que o diálogo diz de uma versão beta.
  beta: {
    label: "Receber versões beta",
    hint: "Uma versão beta sai a cada mudança aceita no projeto, antes da estável, e pode ter defeitos. Desligado, o Prism oferece só as versões estáveis. Ligar ou desligar vale a partir da próxima verificação e não instala nada.",
    badge: "beta",
    offered: "(beta)",
    warning: "Versão beta: chega antes da estável e pode ter defeitos.",
    warningDetail: "Para receber só as versões estáveis, desligue “Receber versões beta” em Configurações › Atualizações.",
    // Os betas só saem para Windows e Linux (o macOS só é empacotado nas estáveis): no macOS a opção não muda o que é oferecido.
    macHint: "No macOS os betas não têm pacote: as atualizações chegam pelas versões estáveis, e ligar esta opção não muda o que o Prism oferece aqui.",
  },

  // Linux e macOS: o que fazer com o pacote que ficou na pasta de downloads (RN-ATUALIZA-006).
  instructions: {
    AppImage: "Feche o Prism, dê permissão de execução ao arquivo e abra-o no lugar do AppImage antigo.",
    deb: "Feche o Prism e instale o pacote com o gerenciador do sistema (por exemplo, sudo apt install ./ seguido do nome do arquivo).",
    rpm: "Feche o Prism e instale o pacote com o gerenciador do sistema (por exemplo, sudo dnf install ./ seguido do nome do arquivo).",
    "tar.gz": "Feche o Prism e extraia o arquivo por cima da pasta onde o Prism está.",
    dmg: "Feche o Prism, abra o arquivo e arraste o Prism para a pasta Aplicativos, substituindo o atual.",
    zip: "Feche o Prism e extraia o arquivo por cima da pasta onde o Prism está.",
    nsis: "Feche o Prism e abra o instalador.",
  } satisfies Record<InstallFormat, string>,
} as const;
