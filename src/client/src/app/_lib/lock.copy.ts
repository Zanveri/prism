/** Os textos do bloqueio por inatividade, num lugar só: o aviso de 60 segundos antes e a tela de bloqueio (RN-SEG-001). */
export const lockCopy = {
  warning: {
    title: "O Prism vai bloquear por falta de uso.",
    // Quanto falta, em segundos; o que a pessoa faz para cancelar é mexer.
    countdown: (seconds: number) => `Faltam ${seconds.toLocaleString("pt-BR")} s. Mexa o mouse ou digite para continuar.`,
    // O leitor de tela lê isto uma vez, quando o aviso aparece; a contagem que muda a cada segundo não é lida.
    announcement: "O Prism vai bloquear por falta de uso em menos de um minuto. Mexa o mouse ou digite para continuar.",
  },
  screen: {
    title: "Prism bloqueado",
    // A frase que explica o bloqueio é a do estado do fechamento do cofre (`CloseState`): não pode afirmar que o Prism fechou o cofre enquanto a própria tela
    // diz que ainda tenta, nem depois de ele desistir. Só "closed" diz que fechou.
    description: {
      closing: "Por falta de uso, o Prism bloqueou esta janela e está fechando o cofre. Quando terminar, digite a sua senha para abri-lo de novo.",
      retrying: "Por falta de uso, o Prism bloqueou esta janela, mas ainda não conseguiu fechar o cofre. Quando conseguir, digite a sua senha para abri-lo de novo.",
      closed: "Por falta de uso, o Prism fechou o cofre. Digite a sua senha para abri-lo de novo.",
      gaveUp: "Por falta de uso, o Prism bloqueou esta janela, mas não conseguiu fechar o cofre. Digite a sua senha para continuar, ou saia.",
    },
    userLabel: "Usuário do cofre",
    // O que a pessoa precisa saber para não ter medo de desbloquear (ou de esperar): nada que ela abriu se perdeu, menos os resultados.
    kept: "As suas abas e o texto de SQL continuam como estavam. Os resultados foram descartados.",
    password: "Senha",
    unlock: "Desbloquear",
    unlocking: "Desbloqueando…",
    signOut: "Sair",
    signingOut: "Saindo…",
    // Erros da própria tela de bloqueio: o aviso central ficaria por baixo dela.
    unlockFailed: "Não foi possível desbloquear. Tente de novo.",
    signOutFailed: "Não foi possível sair. Tente de novo.",
    // A API não respondeu (o prazo da chamada acabou, ou ela está fora do ar): a tela diz o que houve, e a ação volta a ser aceita.
    unlockNoResponse: "O serviço não respondeu, e não foi possível desbloquear. Tente de novo.",
    signOutNoResponse: "O serviço não respondeu, e não foi possível sair. Tente de novo.",
    // O fechamento do cofre na API: a tela diz onde ele está, com franqueza (RN-SEG-001).
    closing: "Fechando o cofre…",
    closeRetrying: "Não foi possível fechar o cofre no serviço; tentando de novo.",
    // As tentativas acabaram: a janela está bloqueada, mas o cofre pode continuar aberto no serviço.
    closeFailed: "Não foi possível fechar o cofre no serviço. O Prism continua bloqueado nesta janela, mas o cofre pode continuar aberto lá: desbloqueie ou saia.",
  },
} as const;
