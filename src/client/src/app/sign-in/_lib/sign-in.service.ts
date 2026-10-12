import { queryOptions } from "@tanstack/react-query";

import { allowRefusal, apiRequest, unwrap, userActionDeadlineMs, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { sessionSchema, type Credentials, type Session } from "./sign-in.schema";

/**
 * Uma função por rota de `api/public`. Devolvem `ApiResult`; quem as chama numa `queryFn` ou
 * `mutationFn` passa o resultado por `unwrap` (ou por `allowRefusal`, quando o formulário mostra
 * certas recusas no lugar), para o erro chegar ao aviso central (RN-AVISO-004).
 */

/** Quem está com o cofre aberto, se alguém está. */
export function getSession(signal?: AbortSignal): Promise<ApiResult<Session>> {
  return apiRequest(prismEndpoints.publicSessions, { schema: sessionSchema, signal });
}

/**
 * A consulta de sessão do `VaultGuard` e da barra superior: a mesma chave, o mesmo cache. A resposta
 * não é guardada depois que a tela sai: ao voltar, pergunta-se de novo. Quem avisa que o cofre
 * fechou no meio do uso é o 401 da própria chamada (`onVaultLocked`), então não é preciso perguntar
 * de novo a cada vez que a janela volta a ter foco. A falha da primeira consulta aparece no lugar
 * da tela, no guard; aviso junto seria repetir.
 */
export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async ({ signal }) => unwrap(await getSession(signal)),
  gcTime: 0,
  refetchOnWindowFocus: false,
  meta: { silent: true },
});

/**
 * Abre o cofre do usuário; a API fecha o que estiver aberto (RN-COFRE-007). É também o "Desbloquear" da tela de bloqueio
 * (RN-SEG-001), por isso passa por cima da espera do bloqueio (`whileLocked`). Nenhuma espera é para sempre: quem não passa `signal` (o formulário de
 * entrada) tem o prazo das chamadas que a pessoa espera (`userActionDeadlineMs`), e a tela de bloqueio passa o dela. Estourado o prazo, o pedido volta
 * como `NETWORK_ERROR`: o "Entrando…" acaba, e o aviso central diz que a API não respondeu.
 */
export function signIn({ userName, password }: Credentials, signal: AbortSignal = AbortSignal.timeout(userActionDeadlineMs)): Promise<ApiResult<Session>> {
  return apiRequest(prismEndpoints.publicSessions, { method: "POST", body: { userName, password }, schema: sessionSchema, whileLocked: true, signal });
}

/**
 * `signIn` como o formulário de entrada o usa: as recusas que ele escreve no próprio lugar voltam como
 * valor, e qualquer outra lança e vai ao aviso central (RN-AVISO-004). `INVALID_CREDENTIALS` é usuário
 * ou senha errados (RN-COFRE-006); `VAULT_FORMAT_UNSUPPORTED` é o cofre de um Prism mais novo, a única
 * entrada que diz mais do que "credencial inválida" (RN-VERSAO-005).
 */
export async function signInOrRefuse(credentials: Credentials, signal?: AbortSignal): Promise<ApiResult<Session>> {
  return allowRefusal(await signIn(credentials, signal), "INVALID_CREDENTIALS", "VAULT_FORMAT_UNSUPPORTED");
}

/**
 * Cria o usuário e já abre o cofre dele. Com o mesmo prazo de `signIn`: a API que não responde não deixa o formulário em "Criando…" para sempre. O pedido
 * cancelado pelo prazo pode ter chegado à API: se o usuário foi criado, a tentativa seguinte recebe `USER_ALREADY_EXISTS`, e o caminho é "Entrar".
 */
export function createUser({ userName, password }: Credentials, signal: AbortSignal = AbortSignal.timeout(userActionDeadlineMs)): Promise<ApiResult<Session>> {
  return apiRequest(prismEndpoints.publicUsers, { method: "POST", body: { userName, password }, schema: sessionSchema, signal });
}

/**
 * Fecha o cofre e encerra as sessões com os bancos (RN-COFRE-008). É a chamada do "Sair" e também a que o bloqueio por
 * inatividade faz (RN-SEG-001), já com o Prism bloqueado: por isso passa por cima da espera (`whileLocked`). Nenhuma espera é para sempre: o bloqueio
 * lhe dá o prazo dele (`signal`, que repete), e quem não passa nenhum (o "Sair" da barra superior, o da tela de bloqueio) tem o das chamadas que a
 * pessoa espera (`userActionDeadlineMs`): a API que não responde devolve a tela, com a falha dita, em vez de deixá-la em "Saindo…" para sempre.
 */
export function signOut(signal: AbortSignal = AbortSignal.timeout(userActionDeadlineMs)): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.publicSessions, { method: "DELETE", whileLocked: true, signal });
}
