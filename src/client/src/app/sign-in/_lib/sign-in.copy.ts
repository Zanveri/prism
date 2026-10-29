/** Os textos da tela de entrada e de criação de usuário, num lugar só (RN-COFRE-009, RN-AVISO-002). */
export const signInCopy = {
  brand: {
    title: "Abra, conecte, consulte.",
    illustration: "Um feixe de luz entra no prisma e sai em três faixas de cor, cada uma chegando a um banco de dados",
  },
  subtitle: "Cada usuário tem o seu próprio cofre de conexões.",
  signIn: {
    title: "Entrar",
    userName: "Usuário",
    password: "Senha",
    submit: "Entrar",
    submitting: "Entrando…",
    // A mesma frase para usuário inexistente e senha errada (RN-COFRE-006): a tela não diz qual dos dois.
    invalidCredentials: "Usuário ou senha inválidos.",
    // RN-VERSAO-005: o cofre é de um formato que este Prism não conhece. Não é erro de senha, e a frase não finge que é.
    vaultFormatUnsupported: "Este cofre foi criado por uma versão mais nova do Prism. Atualize o Prism para abri-lo.",
    toCreate: { question: "Primeiro acesso?", action: "Criar usuário" },
  },
  createUser: {
    title: "Criar usuário",
    userName: "Usuário",
    password: "Senha",
    passwordConfirmation: "Confirmar senha",
    submit: "Criar usuário",
    submitting: "Criando…",
    created: "Usuário criado.",
    userAlreadyExists: "Já existe um usuário com esse nome.",
    toSignIn: { question: "Já tem usuário?", action: "Entrar" },
  },
  vaultNotice: "A sua senha não é armazenada. Ela gera a chave que abre o seu cofre: se você a esquecer, as conexões salvas não podem ser recuperadas.",
} as const;
