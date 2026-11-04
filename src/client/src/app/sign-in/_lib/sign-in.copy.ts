import { pickCopy, type Localized } from "@/lib/i18n";

import { signInCopyEn } from "./sign-in.copy.en";
import { signInCopyEs } from "./sign-in.copy.es";

/** Os textos da tela de entrada e de criação de usuário, num lugar só (RN-COFRE-009, RN-AVISO-002). */
const pt = {
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
  // As frases de validação (zod) da entrada e da criação do usuário (RN-COFRE-010).
  validation: {
    userNameMin: "O usuário precisa ter ao menos 3 caracteres.",
    userNameMax: "O usuário pode ter no máximo 32 caracteres.",
    userNameFormat: "Use só letras, números, ponto, hífen e sublinhado.",
    userNameRequired: "Informe o usuário.",
    passwordRequired: "Informe a senha.",
    passwordMin: "A senha precisa ter ao menos 8 caracteres.",
    passwordMax: "A senha pode ter no máximo 128 caracteres.",
    passwordMismatch: "As senhas não conferem.",
  },
} as const;

export type SignInCopy = Localized<typeof pt>;
export const signInCopy = pickCopy({ "pt-BR": pt, en: signInCopyEn, es: signInCopyEs });
