import { allowRefusal, apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

/** O que a API recebe para trocar a senha: a atual e a nova. A confirmação da nova fica na tela. */
export type PasswordChange = { currentPassword: string; newPassword: string };

/**
 * Troca a senha do usuário do cofre aberto (RN-COFRE-013): 204 sem corpo. As senhas só existem aqui na chamada: o resultado nunca as leva (o erro da
 * API é o que ela diz, e ela não devolve senha), e quem chama não as guarda.
 */
export function changePassword({ currentPassword, newPassword }: PasswordChange): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userPassword, { method: "PUT", body: { currentPassword, newPassword } });
}

/**
 * `changePassword` como o formulário o usa: as recusas que ele escreve no campo de cada uma voltam como valor (a senha atual errada, `INVALID_PASSWORD`; a
 * nova inválida, `PASSWORD_INVALID`; a igual à atual, `PASSWORD_UNCHANGED`), e `VAULT_LOCKED`, o quinto erro seguido, que fecha o cofre e leva ao login
 * com um aviso próprio. Qualquer outra falha lança e vai ao aviso central (RN-AVISO-004): o disco que falhou, a API fora do ar.
 */
export async function changePasswordOrRefuse(input: PasswordChange): Promise<ApiResult<void>> {
  return allowRefusal(await changePassword(input), "INVALID_PASSWORD", "PASSWORD_INVALID", "PASSWORD_UNCHANGED", "VAULT_LOCKED");
}
