import type { QueryClient } from "@tanstack/react-query";

import { transferCopy } from "@/app/connections/_lib/transfer.copy";
import { ApiRequestError, type ApiError } from "@/lib/api/prism-api";

/**
 * A conexão sem usuário e senha (RN-TRANSF-015 e 016). Conectar e testar uma conexão que a importação trouxe sem eles é recusado pela API antes do driver,
 * com 422 `CONNECTION_CREDENTIALS_MISSING` no campo que falta (`userName` sem usuário, `password` com o usuário e sem a senha). A tela não mostra o erro no
 * nó nem na aba, nem faz aviso de erro (o erro de campo já não vira aviso central): abre o "Editar conexão" dela, com a frase e o foco no campo que falta, e
 * o lugar de onde a pessoa pediu fica como estava. Nada conecta sozinho depois de salvar.
 */
export const credentialsMissingCode = "CONNECTION_CREDENTIALS_MISSING";

/**
 * O campo que falta (RN-TRANSF-016, RN-REDE-003 e 006): o usuário ou a senha do banco, ou o segredo do túnel SSH (`sshSecret`, a senha ou a frase secreta da chave) ou
 * do proxy (`proxyPassword`) que a conexão gravada sem "Salvar credenciais" não guarda e que ninguém digitou desde que ela foi conectada (a API o guarda só na
 * memória, até a conexão ser desconectada ou o cofre fechar). O do banco abre o "Editar conexão"; o do túnel e o do proxy, o pedido do segredo (`NetworkSecretDialog`).
 */
export type CredentialsField = DatabaseCredentialsField | NetworkSecretField;

/** O usuário e a senha do banco, que se informam no "Editar conexão" (RN-TRANSF-016). */
export type DatabaseCredentialsField = "userName" | "password";

/** O segredo do túnel SSH ou do proxy, que se pede ao conectar (RN-REDE-006). */
export type NetworkSecretField = "sshSecret" | "proxyPassword";

export const isNetworkSecretField = (field: CredentialsField): field is NetworkSecretField => field === "sshSecret" || field === "proxyPassword";

/** O campo que falta, numa recusa (ou num erro lançado) de abrir a sessão ou de testar; `null` quando não é esta recusa. */
export function credentialsMissingField(error: ApiError | unknown): CredentialsField | null {
  const apiError = error instanceof ApiRequestError ? error.error : isApiError(error) ? error : null;
  if (apiError === null || apiError.code !== credentialsMissingCode) return null;
  const errors = apiError.errors ?? {};
  return "userName" in errors ? "userName" : "sshSecret" in errors ? "sshSecret" : "proxyPassword" in errors ? "proxyPassword" : "password";
}

function isApiError(value: unknown): value is ApiError {
  return typeof value === "object" && value !== null && "code" in value && "errors" in value && typeof (value as { code: unknown }).code === "string";
}

/** O que falta na conexão gravada (RN-TRANSF-016), pelo que a lista diz dela: o usuário (e a senha junto), só a senha, ou nada. */
export function missingCredentials(connection: { userName: string; hasPassword: boolean }): "userName" | "password" | null {
  if (connection.userName === "") return "userName";
  return connection.hasPassword ? null : "password";
}

/**
 * O fim da dica da linha da conexão na árvore (RN-TRANSF-015): " · sem usuário e senha" ou " · sem senha" ("Informix · informix-prd.exemplo.invalid:9089 /
 * estoque · sem usuário e senha"). A linha não ganha marca: uma a mais em cada conexão que veio sem credenciais poluiria a árvore de quem importou dezenas
 * delas, e o aviso de verdade vem ao conectar.
 */
export function credentialsHint(connection: { userName: string; hasPassword: boolean }): string {
  const missing = missingCredentials(connection);
  return missing === "userName" ? transferCopy.credentials.rowNoCredentials : missing === "password" ? transferCopy.credentials.rowNoPassword : "";
}

/** Um pedido de abrir o "Editar conexão" da conexão sem credenciais, com o campo que falta; o número diz se é o mesmo pedido ou um novo. */
export type CredentialsRequest = { readonly connectionId: string; readonly field: CredentialsField; readonly seq: number };

/**
 * O pedido viaja daqui até quem abre o diálogo (a página da área de trabalho): a árvore, as vistas de uma tabela, a barra do editor e o executor de cada aba
 * abrem sessões por caminhos diferentes, e nenhum deles tem o diálogo. Um pedido só, o último.
 */
export type CredentialsRequests = {
  request: (connectionId: string, field: CredentialsField) => void;
  /** O pedido à espera, se há: o MESMO objeto enquanto nada muda (é o que o React compara). */
  pending: () => CredentialsRequest | null;
  /** O pedido foi atendido: sai, se ainda é o mesmo. */
  take: (seq: number) => void;
  /** Esquece o pedido (a área de trabalho desmonta: o cofre fechou, e nada passa ao usuário seguinte). */
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
};

export function createCredentialsRequests(): CredentialsRequests {
  let pending: CredentialsRequest | null = null;
  let seq = 0;
  const listeners = new Set<() => void>();

  function set(next: CredentialsRequest | null) {
    if (next === pending) return;
    pending = next;
    for (const listener of listeners) listener();
  }

  return {
    request: (connectionId, field) => set({ connectionId, field, seq: ++seq }),
    pending: () => pending,
    take: (taken) => {
      if (pending?.seq === taken) set(null);
    },
    clear: () => set(null),
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/** O pedido da tela: quem abre uma sessão pede, a página da área de trabalho atende. */
export const credentialsRequests = createCredentialsRequests();

/**
 * RN-REDE-006: a recusa de um assistente de dados (a prévia e o começo da importação, da cópia e da exportação) por faltar o segredo do túnel ou do proxy, com a
 * conexão em `connectionID` (a cópia tem duas), pede o segredo daquela conexão. O assistente mostra a recusa; conectado o diálogo, a pessoa tenta de novo.
 */
export function askNetworkSecretFor(error: ApiError, requests: CredentialsRequests = credentialsRequests): void {
  const field = credentialsMissingField(error);
  const connectionId = error.extensions["connectionID"];
  if (field !== null && isNetworkSecretField(field) && typeof connectionId === "string") requests.request(connectionId, field);
}

/**
 * Observa as sessões da árvore no cache (`["database-session", conexão, …]`: o nó da conexão, a Estrutura e o Diagrama, a lista dos bancos da barra do
 * editor) e pede o "Editar conexão" quando uma delas é recusada por faltar o usuário ou a senha. Devolve a função que para de observar.
 */
export function watchCredentialsMissing(queryClient: QueryClient, requests: CredentialsRequests = credentialsRequests): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "error") return;
    const [family, connectionId] = event.query.queryKey;
    if (family !== "database-session" || typeof connectionId !== "string") return;
    const field = credentialsMissingField(event.action.error);
    if (field !== null) requests.request(connectionId, field);
  });
}
