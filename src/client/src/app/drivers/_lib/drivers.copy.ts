/** Os textos da tela de drivers, num lugar só (RN-DRIVER-001 a 009, RN-AVISO-002 a 004). */
export const driversCopy = {
  title: "Drivers",
  subtitle: "O Prism leva só o driver do PostgreSQL. Os dos outros bancos você baixa quando precisar, aceitando a licença do fabricante.",
  loading: "Carregando os drivers…",
  loadFailed: "Não foi possível carregar os drivers.",
  retry: "Tentar de novo",
  // A consulta periódica parou depois de erros seguidos da API (item D); a lista que já estava na tela fica.
  stalled: { message: "A lista de drivers parou de atualizar.", action: "Atualizar a lista" },
  empty: { title: "Nenhum driver na lista.", hint: "Feche e abra o Prism de novo. Se continuar assim, a API não trouxe o catálogo de drivers." },

  groups: {
    installed: "Instalados e embutidos",
    available: "Disponíveis para baixar",
    unavailable: "Sem driver para esta plataforma",
    comingSoon: "Em breve",
  },

  // O estado em palavras (item B). `Baixando…` ganha a porcentagem quando a API manda o total.
  states: {
    bundled: "Embutido",
    installed: "Instalado",
    available: "Disponível",
    installing: "Baixando…",
    installingPercent: (percent: number) => `Baixando… ${percent}%`,
    failed: "Falhou",
    unavailable: "Sem driver para esta plataforma",
    comingSoon: "Em breve",
  },

  row: {
    version: (version: string) => `Versão ${version}`,
    restartPending: "Reinício pendente",
    progress: (name: string) => `Progresso do download do driver ${name}`,
    progressOf: (received: string, total: string) => `${received} de ${total}`,
    failedBecause: "Causa:",
    failedWithoutDetail: "A API não disse a causa.",
    install: "Baixar",
    retry: "Tentar de novo",
    cancel: "Cancelar",
    cancelling: "Cancelando…",
    remove: "Remover",
    installLabel: (name: string) => `Baixar o driver ${name}`,
    retryLabel: (name: string) => `Tentar de novo o download do driver ${name}`,
    cancelLabel: (name: string) => `Cancelar o download do driver ${name}`,
    removeLabel: (name: string) => `Remover o driver ${name}`,
  },

  // Item C: o diálogo de instalação.
  install: {
    title: (name: string) => `Baixar o driver ${name}`,
    description: "O Prism baixa o driver do nuget.org, confere o hash dele e o grava na sua máquina. Leia a licença do fabricante antes de aceitar.",
    vendor: "Fabricante",
    license: "Licença",
    licenseUrl: "Texto oficial da licença",
    licenseUrlHint: "O Prism não abre links. Copie o endereço e leia o texto no seu navegador.",
    noLicense: "O catálogo não trouxe um texto de licença que o Prism possa mostrar (o endereço dela tem de começar por https://), por isso este driver não pode ser instalado.",
    copyLink: "Copiar link",
    size: "Tamanho do download",
    // RN-DRIVER-005: o reinício fecha o cofre, e as abas de SQL abertas se perdem junto.
    restartNotice: "Depois de instalar, o Prism reinicia o serviço e pede a sua senha de novo. As abas de SQL abertas serão fechadas.",
    accept: "Li e aceito a licença do fabricante",
    cancel: "Cancelar",
    submit: "Baixar e instalar",
    submitting: "Iniciando…",
  },

  restart: {
    title: "Reinício necessário",
    description: "Driver instalado. O Prism vai reiniciar o serviço e pedir a sua senha de novo. As abas de SQL abertas serão fechadas.",
    removedDescription: "Driver removido. O Prism vai reiniciar o serviço e pedir a sua senha de novo. As abas de SQL abertas serão fechadas.",
    submit: "Reiniciar agora",
    later: "Depois",
    banner: "O Prism precisa reiniciar o serviço para aplicar a mudança nos drivers. Ele pede a sua senha de novo, e as abas de SQL abertas serão fechadas.",
    bannerAction: "Reiniciar agora",
    topBarBadge: "Reinício pendente",
    // RN-NAV-006: o lembrete da barra superior leva a Configurações › Drivers.
    topBarHint: "Um driver espera o reinício do serviço para valer. Abre Configurações › Drivers.",
  },

  // Item F.
  removeConfirm: {
    title: "Remover driver",
    description: (name: string) =>
      `O driver ${name} será removido da sua máquina. A remoção vale quando o Prism reiniciar o serviço (ele pede a sua senha de novo, e as abas de SQL abertas serão fechadas), e as conexões que dependem dele deixam de abrir.`,
    submit: "Remover driver",
    submitting: "Removendo…",
  },

  toasts: {
    installStarted: (name: string) => `Download do driver ${name} iniciado.`,
    installFailed: (name: string) => `O download do driver ${name} falhou.`,
    cancelled: (name: string) => `Download do driver ${name} cancelado.`,
    removed: (name: string) => `Driver ${name} removido.`,
    // RN-DRIVER-007: a frase é da tela; a regra é da API (409 `DRIVER_IN_USE`).
    inUse: "Feche as conexões desse banco antes de remover o driver.",
    linkCopied: "Link copiado.",
    linkNotCopied: "Não foi possível copiar. Selecione o endereço e copie com Ctrl+C.",
  },

  // Item G: o caminho a partir de uma conexão sem driver.
  installDriver: "Instalar driver",
} as const;
