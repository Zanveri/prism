import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { driverIdOf } from "@/app/drivers/_lib/drivers.model";
import { apiRequest, ApiRequestError, unwrap, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import {
  columnsSchema,
  databaseObjectsSchema,
  databaseSchemasSchema,
  databaseSessionSchema,
  foreignKeysSchema,
  indexesSchema,
  type Column,
  type DatabaseObject,
  type DatabaseSchema,
  type DatabaseSession,
  type ForeignKey,
  type TableIndex,
} from "./database-sessions.schema";
import { columnNodes, foreignKeyNodes, indexNodes, objectNodes, schemaNodes, type NavNode, type NavPath, type ObjectsKind } from "./navigator-model";

/**
 * Uma função por rota de `api/user/database-sessions`. Devolvem `ApiResult`; quem as chama numa
 * `queryFn` ou `mutationFn` passa o resultado por `unwrap` (ou por `allowRefusal`), para o erro
 * chegar ao aviso central (RN-AVISO-004).
 */

/** Abre a sessão com o banco da conexão (RN-SESSAO-001). Falha: 422 `DATABASE_CONNECTION_FAILED` com a mensagem do banco. */
export function openDatabaseSession(connectionId: string): Promise<ApiResult<DatabaseSession>> {
  return apiRequest(prismEndpoints.userDatabaseSessions, { method: "POST", body: { connectionID: connectionId }, schema: databaseSessionSchema });
}

export function closeDatabaseSession(sessionId: string): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userDatabaseSession(sessionId), { method: "DELETE" });
}

export function getSchemas(sessionId: string): Promise<ApiResult<DatabaseSchema[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionSchemas(sessionId), { schema: databaseSchemasSchema });
}

export function getObjects(sessionId: string, schema: string, kind: ObjectsKind): Promise<ApiResult<DatabaseObject[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionObjects(sessionId, schema, kind), { schema: databaseObjectsSchema });
}

export function getColumns(sessionId: string, schema: string, table: string): Promise<ApiResult<Column[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionColumns(sessionId, schema, table), { schema: columnsSchema });
}

export function getIndexes(sessionId: string, schema: string, table: string): Promise<ApiResult<TableIndex[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionIndexes(sessionId, schema, table), { schema: indexesSchema });
}

export function getForeignKeys(sessionId: string, schema: string, table: string): Promise<ApiResult<ForeignKey[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionForeignKeys(sessionId, schema, table), { schema: foreignKeysSchema });
}

/**
 * O que a árvore guarda: fica em memória até o usuário pedir "Atualizar" naquele nó (RN-ARVORE-002),
 * então nada a torna velha nem a descarta. Também não se refaz sozinha ao voltar o foco, ao
 * reconectar a rede ou ao montar de novo: uma consulta que falhou espera o "Tentar de novo".
 */
export const keepUntilRefreshed = { staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false, retryOnMount: false } as const;

export const databaseSessionKey = (connectionId: string) => ["database-session", connectionId] as const;

/**
 * A sessão da árvore de uma conexão (RN-SESSAO-001): abri-la é um `POST`, então esta consulta
 * **nunca** é invalidada nem refeita enquanto tem dado. Refazer abriria uma segunda sessão e
 * deixaria a primeira órfã na API. Com `gcTime` infinito, sair da área de trabalho não a descarta;
 * só "Desconectar" a remove.
 */
export function databaseSessionQuery(connectionId: string) {
  return queryOptions({ queryKey: databaseSessionKey(connectionId), queryFn: async () => unwrap(await openDatabaseSession(connectionId)), ...keepUntilRefreshed });
}

/** O código da API numa falha de nível da árvore; `undefined` se a falha não veio da API. */
export function errorCodeOf(error: unknown): string | undefined {
  return error instanceof ApiRequestError ? error.error.code : undefined;
}

/** O `driverID` que o 422 `DRIVER_NOT_INSTALLED` traz (seção 16), numa falha de nível da árvore. */
export function errorDriverIdOf(error: unknown): string | undefined {
  return error instanceof ApiRequestError ? driverIdOf(error.error.extensions) : undefined;
}

/** A sessão com o banco caiu (a API já não a conhece): repetir o pedido com o mesmo id dá o mesmo 404. */
export function isSessionLost(error: unknown): boolean {
  return error instanceof ApiRequestError && error.error.code === "DATABASE_SESSION_NOT_FOUND";
}

/**
 * Abre uma sessão nova para a conexão no lugar da que caiu: a consulta da sessão e as dos níveis
 * dela voltam ao início e as abertas buscam de novo (a dos níveis espera pela sessão nova, que a
 * `queryFn` pede à consulta dela). Quem chama avisa o usuário (RN-AVISO-003). Devolve se a
 * sessão nova abriu; se não, o aviso de erro é o central.
 */
export async function reopenDatabaseSession(queryClient: QueryClient, connectionId: string): Promise<boolean> {
  // As duas de uma vez, sem esperar a primeira: os níveis entram na mesma abertura da sessão, em vez de começar com o id morto.
  const session = queryClient.resetQueries({ queryKey: databaseSessionKey(connectionId), exact: true });
  const levels = queryClient.resetQueries({ queryKey: ["tree", connectionId] });
  await Promise.all([session, levels]);
  return queryClient.getQueryState(databaseSessionKey(connectionId))?.status === "success";
}

/** O que a árvore busca ao abrir um nó: os esquemas do banco, os objetos de um grupo ou uma lista de uma tabela. */
export type FetchedPath = Extract<NavPath, { type: "database" | "objects" | "tableLevel" }>;

/** A chave da consulta de um nível. Em array, para "Atualizar" invalidar por prefixo (`treePrefix`). */
export function treeKey(path: FetchedPath): readonly unknown[] {
  switch (path.type) {
    case "database":
      return ["tree", path.connectionId, "schemas"];
    case "objects":
      return ["tree", path.connectionId, "schema", path.schema, "objects", path.objects];
    case "tableLevel":
      return ["tree", path.connectionId, "schema", path.schema, "table", path.table, path.level];
  }
}

/**
 * Tudo o que "Atualizar" naquele nó invalida: a conexão e o banco, a árvore inteira; o esquema, o
 * que está dentro dele; a tabela, as três listas dela. As consultas abertas buscam de novo; as
 * demais ficam velhas e buscam quando o nó abrir. Nunca inclui a sessão (`databaseSessionKey`).
 */
export function treePrefix(path: NavPath): readonly unknown[] | null {
  switch (path.type) {
    case "folder":
      return null;
    case "connection":
    case "database":
      return ["tree", path.connectionId];
    case "schema":
      return ["tree", path.connectionId, "schema", path.schema];
    case "table":
      return ["tree", path.connectionId, "schema", path.schema, "table", path.table];
    case "objects":
    case "tableLevel":
      return treeKey(path);
  }
}

/**
 * Os filhos de um nó que abre, já como linhas da árvore. A sessão vem da consulta dela: a primeira
 * `queryFn` a precisar a abre, as outras esperam a mesma resposta.
 */
export function treeQuery(path: FetchedPath, queryClient: QueryClient, enabled: boolean) {
  return queryOptions({
    queryKey: treeKey(path),
    queryFn: async (): Promise<NavNode[]> => {
      const { id } = await queryClient.ensureQueryData(databaseSessionQuery(path.connectionId));

      switch (path.type) {
        case "database":
          return schemaNodes(path.connectionId, unwrap(await getSchemas(id)));
        case "objects":
          return objectNodes(path.connectionId, path.schema, path.objects, unwrap(await getObjects(id, path.schema, path.objects)));
        case "tableLevel":
          switch (path.level) {
            case "columns":
              return columnNodes(path, unwrap(await getColumns(id, path.schema, path.table)));
            case "indexes":
              return indexNodes(path, unwrap(await getIndexes(id, path.schema, path.table)));
            case "foreignKeys":
              return foreignKeyNodes(path, unwrap(await getForeignKeys(id, path.schema, path.table)));
          }
      }
    },
    enabled,
    ...keepUntilRefreshed,
  });
}
