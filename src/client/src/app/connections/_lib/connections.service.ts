import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { driverNotInstalledCode } from "@/app/drivers/_lib/drivers.model";
import { allowRefusal, apiRequest, unwrap, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { connectionSchema, connectionsSchema, foldersSchema, folderSchema, revealedPasswordSchema, type Connection, type ConnectionInput, type Folder, type FolderInput } from "./connections.schema";

/**
 * Uma função por rota de `api/user`. Devolvem `ApiResult`; quem as chama numa `queryFn` ou
 * `mutationFn` passa o resultado por `unwrap` (ou por `allowRefusal`, quando a tela mostra certas
 * recusas no lugar), para o erro chegar ao aviso central (RN-AVISO-004).
 */

export function listFolders(signal?: AbortSignal): Promise<ApiResult<Folder[]>> {
  return apiRequest(prismEndpoints.userFolders, { schema: foldersSchema, signal });
}

export function createFolder(input: FolderInput): Promise<ApiResult<Folder>> {
  return apiRequest(prismEndpoints.userFolders, { method: "POST", body: input, schema: folderSchema });
}

/** Renomear e mover são o mesmo `PATCH`: o corpo leva o nome e a pasta pai por inteiro. */
export function updateFolder(id: string, input: FolderInput): Promise<ApiResult<Folder>> {
  return apiRequest(prismEndpoints.userFolders, { method: "PATCH", body: { id, ...input }, schema: folderSchema });
}

export function deleteFolder(id: string): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userFolder(id), { method: "DELETE" });
}

export function listConnections(signal?: AbortSignal): Promise<ApiResult<Connection[]>> {
  return apiRequest(prismEndpoints.userConnections, { schema: connectionsSchema, signal });
}

/** A senha do corpo é a do banco: ela sai da tela só aqui e nunca volta (RN-CONN-001). */
export function createConnection(input: ConnectionInput): Promise<ApiResult<Connection>> {
  return apiRequest(prismEndpoints.userConnections, { method: "POST", body: input, schema: connectionSchema });
}

/** `password` nulo mantém a senha gravada (RN-CONN-004). */
export function updateConnection(id: string, input: ConnectionInput): Promise<ApiResult<Connection>> {
  return apiRequest(prismEndpoints.userConnections, { method: "PATCH", body: { id, ...input }, schema: connectionSchema });
}

/**
 * "Testar conexão" (RN-CONN-013): abre, consulta e fecha, sem gravar nada. Numa conexão já gravada
 * o pedido leva o `id`, e sem `password` a API usa a senha do cofre: com a senha vazia a chave
 * `password` nem vai (um `null` explícito seria uma senha vazia, não "mantenha").
 */
export function testConnection(input: ConnectionInput, id?: string): Promise<ApiResult<void>> {
  const { password, ...fields } = input;
  return apiRequest(prismEndpoints.userConnectionsTest, { method: "POST", body: { ...(id === undefined ? {} : { id }), ...fields, ...(password === null ? {} : { password }) } });
}

/**
 * "Testar conexão" como o formulário a usa: as recusas que ele mostra no lugar voltam como valor — o 422 de campos, a
 * falha do banco (que leva a mensagem dele) e o driver não instalado (RN-DRIVER-006, com "Instalar driver") — e as demais
 * lançam, para o aviso central.
 */
export async function runConnectionTest(input: ConnectionInput, id?: string): Promise<ApiResult<void>> {
  return allowRefusal(await testConnection(input, id), "CONNECTION_INVALID", "DATABASE_CONNECTION_FAILED", driverNotInstalledCode);
}

export function deleteConnection(id: string): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userConnection(id), { method: "DELETE" });
}

/**
 * A senha da conexão, em troca da senha do usuário (RN-CONN-002). O quinto erro seguido fecha o
 * cofre e responde 401 `VAULT_LOCKED` (RN-CONN-003).
 */
export function revealConnectionPassword(id: string, userPassword: string): Promise<ApiResult<{ password: string }>> {
  return apiRequest(prismEndpoints.userConnectionPasswordReveal(id), { method: "POST", body: { password: userPassword }, schema: revealedPasswordSchema });
}

/** As duas listas da tela; a área de trabalho usa as mesmas, com a mesma chave. */
export const foldersQuery = queryOptions({ queryKey: ["folders"], queryFn: async ({ signal }) => unwrap(await listFolders(signal)) });

export const connectionsQuery = queryOptions({ queryKey: ["connections"], queryFn: async ({ signal }) => unwrap(await listConnections(signal)) });

/** Depois de cada mutação as duas listas são buscadas de novo: criar uma conexão muda a pasta, mover uma pasta muda a árvore. */
export function invalidateLists(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([queryClient.invalidateQueries({ queryKey: foldersQuery.queryKey }), queryClient.invalidateQueries({ queryKey: connectionsQuery.queryKey })]);
}
