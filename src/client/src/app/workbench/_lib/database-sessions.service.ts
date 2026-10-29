import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { driverIdOf } from "@/app/drivers/_lib/drivers.model";
import { apiRequest, ApiRequestError, unwrap, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import {
  checksSchema,
  columnsSchema,
  databaseObjectsSchema,
  databasePropertiesSchema,
  databaseSchemasSchema,
  databaseSessionSchema,
  foreignKeysSchema,
  indexesSchema,
  objectNamesSchema,
  referencingForeignKeysSchema,
  schemaDiagramSchema,
  serverDatabasesSchema,
  transactionEndedSchema,
  type Column,
  type DatabaseObject,
  type DatabaseProperty,
  type DatabaseSchema,
  type DatabaseSession,
  type ForeignKey,
  type ObjectNames,
  type ReferencingForeignKey,
  type SchemaDiagram,
  type ServerDatabase,
  type TableCheck,
  type TableIndex,
  type TransactionEnded,
} from "./database-sessions.schema";
import { columnNodes, databaseNodes, foreignKeyNodes, inDatabase, indexNodes, objectNodes, schemaNodes, type DatabaseRef, type NavNode, type NavPath, type ObjectsKind } from "./navigator-model";
import type { TransactionMode } from "./transaction";

/**
 * Uma função por rota de `api/user/database-sessions`. Devolvem `ApiResult`; quem as chama numa
 * `queryFn` ou `mutationFn` passa o resultado por `unwrap` (ou por `allowRefusal`), para o erro
 * chegar ao aviso central (RN-AVISO-004).
 */

/**
 * Abre a sessão com o banco da conexão (RN-SESSAO-001) ou, com `database`, com outro banco do mesmo servidor, pelas credenciais da
 * conexão (RN-ARVORE-006). Falha: 422 `DATABASE_CONNECTION_FAILED` com a mensagem do banco.
 */
export function openDatabaseSession(connectionId: string, database?: string, transactionMode?: TransactionMode): Promise<ApiResult<DatabaseSession>> {
  return apiRequest(prismEndpoints.userDatabaseSessions, { method: "POST", body: { connectionID: connectionId, ...inDatabase(database), ...(transactionMode === undefined ? {} : { transactionMode }) }, schema: databaseSessionSchema });
}

/** RN-TX-001 e 005: o modo de transação da aba. Recusas: 409 `TRANSACTION_OPEN` (saindo do Commit manual com a transação aberta), 422 `TRANSACTIONS_NOT_AVAILABLE`. */
export function changeTransactionMode(sessionId: string, transactionMode: TransactionMode): Promise<ApiResult<DatabaseSession>> {
  return apiRequest(prismEndpoints.userDatabaseSessions, { method: "PATCH", body: { id: sessionId, transactionMode }, schema: databaseSessionSchema });
}

/** RN-TX-002: o "Commit" e o "Rollback" da barra do editor. Recusas: 409 `NO_OPEN_TRANSACTION`, `TRANSACTION_FAILED` (o Commit); 422 `SQL_EXECUTION_FAILED`, com `transactionUndone`. */
export function endTransaction(sessionId: string, commit: boolean): Promise<ApiResult<TransactionEnded>> {
  return apiRequest(commit ? prismEndpoints.userDatabaseSessionTransactionCommit(sessionId) : prismEndpoints.userDatabaseSessionTransactionRollback(sessionId), { method: "POST", schema: transactionEndedSchema });
}

/** RN-ARVORE-006: os bancos do servidor da sessão, com o dela primeiro. */
export function getDatabases(sessionId: string): Promise<ApiResult<ServerDatabase[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionDatabases(sessionId), { schema: serverDatabasesSchema });
}

export function closeDatabaseSession(sessionId: string): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userDatabaseSession(sessionId), { method: "DELETE" });
}

export function getSchemas(sessionId: string): Promise<ApiResult<DatabaseSchema[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionSchemas(sessionId), { schema: databaseSchemasSchema });
}

/** RN-BANCO-001 e RN-CAT-010: propriedades somente leitura do servidor e do banco da sessão. */
export function getDatabaseProperties(sessionId: string): Promise<ApiResult<DatabaseProperty[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionProperties(sessionId), { schema: databasePropertiesSchema });
}

export function getObjects(sessionId: string, schema: string, kind: ObjectsKind, signal?: AbortSignal): Promise<ApiResult<DatabaseObject[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionObjects(sessionId, schema, kind), { schema: databaseObjectsSchema, signal });
}

/** RN-ESQUEMA-003 e RN-CAT-008: todas as tabelas, colunas e chaves estrangeiras do esquema de uma vez. */
export function getSchemaDiagram(sessionId: string, schema: string, signal?: AbortSignal): Promise<ApiResult<SchemaDiagram>> {
  return apiRequest(prismEndpoints.userDatabaseSessionSchemaDiagram(sessionId, schema), { schema: schemaDiagramSchema, signal });
}

/**
 * RN-BUSCA-002: os nomes das tabelas e das visões de todos os esquemas do banco da sessão, numa consulta só ao catálogo (a rota espera a vez na sessão, RN-SESSAO-002).
 * Falhas: 404 `DATABASE_SESSION_NOT_FOUND` e 422 `SQL_EXECUTION_FAILED`, com a mensagem do banco.
 */
export function getObjectNames(sessionId: string): Promise<ApiResult<ObjectNames>> {
  return apiRequest(prismEndpoints.userDatabaseSessionObjectNames(sessionId), { schema: objectNamesSchema });
}

export function getColumns(sessionId: string, schema: string, table: string, signal?: AbortSignal): Promise<ApiResult<Column[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionColumns(sessionId, schema, table), { schema: columnsSchema, signal });
}

export function getIndexes(sessionId: string, schema: string, table: string, signal?: AbortSignal): Promise<ApiResult<TableIndex[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionIndexes(sessionId, schema, table), { schema: indexesSchema, signal });
}

export function getForeignKeys(sessionId: string, schema: string, table: string, signal?: AbortSignal): Promise<ApiResult<ForeignKey[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionForeignKeys(sessionId, schema, table), { schema: foreignKeysSchema, signal });
}

export function getTableChecks(sessionId: string, schema: string, table: string, signal?: AbortSignal): Promise<ApiResult<TableCheck[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionChecks(sessionId, schema, table), { schema: checksSchema, signal });
}

/** RN-CAT-004: as chaves estrangeiras que apontam para a tabela. */
export function getReferencedBy(sessionId: string, schema: string, table: string): Promise<ApiResult<ReferencingForeignKey[]>> {
  return apiRequest(prismEndpoints.userDatabaseSessionReferencedBy(sessionId, schema, table), { schema: referencingForeignKeysSchema });
}

/**
 * O que a árvore guarda: fica em memória até o usuário pedir "Atualizar" naquele nó (RN-ARVORE-002),
 * então nada a torna velha nem a descarta. Também não se refaz sozinha ao voltar o foco, ao
 * reconectar a rede ou ao montar de novo: uma consulta que falhou espera o "Tentar de novo".
 */
export const keepUntilRefreshed = { staleTime: Infinity, gcTime: Infinity, refetchOnWindowFocus: false, refetchOnReconnect: false, retryOnMount: false } as const;

/**
 * O outro banco do servidor numa chave de consulta (RN-ARVORE-006): um objeto, que nome de esquema (texto) nunca imita. O banco da
 * conexão não entra, e as chaves dele são as de antes da lista dos bancos.
 */
export const databaseMark = (database: string | undefined): [] | [{ database: string }] => (database === undefined ? [] : [{ database }]);

/** O outro banco de uma chave da conexão (`["tree", conexão, …]`, `["database-session", conexão, …]`), ou `undefined` no banco da conexão. */
export function databaseOfKey(queryKey: readonly unknown[]): string | undefined {
  const mark = queryKey[2];
  return typeof mark === "object" && mark !== null && "database" in mark && typeof mark.database === "string" ? mark.database : undefined;
}

/** A sessão da árvore de um banco da conexão. Todas ficam sob `["database-session", conexão]`: "Desconectar" as remove de uma vez. */
export const databaseSessionKey = (connectionId: string, database?: string) => ["database-session", connectionId, ...databaseMark(database)] as const;

/**
 * A sessão da árvore de uma conexão (RN-SESSAO-001), ou de outro banco do servidor dela (RN-ARVORE-006): abri-la é um `POST`, então
 * esta consulta **nunca** é invalidada nem refeita enquanto tem dado. Refazer abriria uma segunda sessão e deixaria a primeira órfã
 * na API. Com `gcTime` infinito, sair da área de trabalho não a descarta; só "Desconectar" a remove.
 */
export function databaseSessionQuery(connectionId: string, database?: string) {
  return queryOptions({ queryKey: databaseSessionKey(connectionId, database), queryFn: async () => unwrap(await openDatabaseSession(connectionId, database)), ...keepUntilRefreshed });
}

/**
 * A sessão da árvore aberta PELA BUSCA (RN-BUSCA-002): a conexão que só uma aba conectou, ou a que "Buscar nelas também" conecta, sem abrir o nó. É a mesma consulta da
 * sessão (a mesma chave e o mesmo cache), calada: a falha de abrir aparece na linha de estado da busca (`openSessionForSearch` tem a ressalva do aviso central).
 */
export const searchSessionQuery = (connectionId: string, database?: string) => ({ ...databaseSessionQuery(connectionId, database), meta: { silent: true } });

/**
 * "Buscar nelas também" (RN-BUSCA-002): abre a sessão da árvore da conexão de fora, sem abrir o nó (é conectar, a pedido). Devolve se abriu; a falha NÃO é lançada: ela
 * fica na consulta da sessão, e é dali que a linha de estado da busca a lê (`sessions` do navegador), com o "Tentar de novo". A conexão de fora que ainda tem a sessão
 * em cache é a que a verificação achou sem sessão na API (RN-VERIF-003, `connectedConnectionIds`): ela morreu, a consulta nunca fica velha sozinha (`keepUntilRefreshed`),
 * e só uma abertura forçada a troca por uma sessão nova.
 *
 * O `meta` calado de `searchSessionQuery` só vale enquanto ninguém mais observa a consulta: o navegador observa a de cada conexão (o ponto de estado), e a observação
 * troca o `meta` a cada render, então a falha de abrir pode também chegar ao aviso central, como a de abrir o nó.
 */
export async function openSessionForSearch(queryClient: QueryClient, connectionId: string): Promise<boolean> {
  const dead = queryClient.getQueryData(databaseSessionKey(connectionId)) !== undefined;

  try {
    await queryClient.fetchQuery({ ...searchSessionQuery(connectionId), ...(dead ? { staleTime: 0 } : {}) });
    return true;
  } catch {
    return false;
  }
}

/** As sessões da árvore abertas de todos os bancos da conexão (RN-ARVORE-006): é o que "Desconectar" fecha, além das abas. */
export function treeSessionIds(queryClient: QueryClient, connectionId: string): string[] {
  return queryClient.getQueriesData<DatabaseSession>({ queryKey: ["database-session", connectionId] }).flatMap(([, session]) => (session === undefined ? [] : [session.id]));
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

/** O banco cujas sessão e árvore uma consulta da árvore usa: a lista dos bancos (`["tree", conexão, "databases"]`) é da sessão da conexão. */
const ofDatabase = (connectionId: string, database: string | undefined) => ({ queryKey: ["tree", connectionId], predicate: (query: { queryKey: readonly unknown[] }) => databaseOfKey(query.queryKey) === database });

/**
 * Abre uma sessão nova para o banco no lugar da que caiu: a consulta da sessão e as dos níveis
 * dela (e o índice de nomes da busca, RN-BUSCA-002) voltam ao início e as abertas buscam de novo (a dos
 * níveis espera pela sessão nova, que a `queryFn` pede à consulta dela). Os outros bancos da conexão
 * ficam como estão (RN-ARVORE-006).
 * Quem chama avisa o usuário (RN-AVISO-003). Devolve se a sessão nova abriu; se não, o aviso de
 * erro é o central.
 */
export async function reopenDatabaseSession(queryClient: QueryClient, connectionId: string, database?: string): Promise<boolean> {
  // As duas de uma vez, sem esperar a primeira: os níveis entram na mesma abertura da sessão, em vez de começar com o id morto.
  const session = queryClient.resetQueries({ queryKey: databaseSessionKey(connectionId, database), exact: true });
  const levels = queryClient.resetQueries(ofDatabase(connectionId, database));
  await Promise.all([session, levels]);
  return queryClient.getQueryState(databaseSessionKey(connectionId, database))?.status === "success";
}

/**
 * RN-ARVORE-007: a lista dos bancos do servidor para a barra do editor, pedida quando a pessoa abre a lista. É a da árvore (RN-ARVORE-006), na mesma
 * consulta e no mesmo cache (`["tree", conexão, "databases"]`): a sessão da árvore da conexão abre se ainda não estava, como ao expandir a conexão, e a lista
 * que a árvore já trouxe não é pedida de novo (fica até o "Atualizar" da conexão, RN-ARVORE-002). As falhas vão ao aviso central, pelas consultas; a
 * conexão que não abre para ali, sem pedir a lista. A sessão da árvore que caiu abre outra no lugar dela e a lista vem de novo, como no "Tentar de novo" da
 * árvore (`reopened`: quem chama avisa, RN-AVISO-003).
 */
export async function loadServerDatabases(queryClient: QueryClient, connectionId: string): Promise<"loaded" | "reopened" | "failed"> {
  const list = () => queryClient.fetchQuery(treeQuery({ type: "connection", connectionId }, queryClient, true));

  try {
    await queryClient.fetchQuery(databaseSessionQuery(connectionId));
    await list();
    return "loaded";
  } catch (error) {
    if (!isSessionLost(error)) return "failed";
  }

  try {
    await reopenDatabaseSession(queryClient, connectionId);
    await queryClient.fetchQuery(databaseSessionQuery(connectionId));
    await list();
    return "reopened";
  } catch {
    return "failed";
  }
}

/** O que a árvore busca ao abrir um nó: os bancos do servidor da conexão, os esquemas de um banco, os objetos de um grupo ou uma lista de uma tabela. */
export type FetchedPath = Extract<NavPath, { type: "connection" | "database" | "objects" | "tableLevel" }>;

/** O começo das chaves de um banco: as do banco da conexão são as de sempre; as de outro levam a marca dele. */
const treeBase = (connectionId: string, database: string | undefined) => ["tree", connectionId, ...databaseMark(database)];

/** O limite de nomes que a API devolve por banco (RN-BUSCA-002): o índice que traz `truncated` olhou só os primeiros. É o `ObjectNamesLimit` do serviço de sessões. */
export const objectNamesLimit = 50_000;

/**
 * A chave do índice de nomes de um banco (RN-BUSCA-002). Fica na família da árvore DE PROPÓSITO: o "Desconectar" (`removeQueries(["tree", conexão])`), a conexão que some,
 * o bloqueio, a sessão reaberta (`ofDatabase`) e o "Atualizar" (`treePrefixes`) já cuidam dele, e esquecer um deles deixaria o índice de uma sessão morta. Mas **não é um
 * nível**: o dado não é `NavNode[]`, e `levelPathOf` devolve `null` para a chave. Quem lê a família e supõe `NavNode[]` (`cachedTree`, `cachedLevels`) pula o que não é nível.
 */
export const objectNamesKey = (connectionId: string, database?: string) => ["tree", connectionId, ...databaseMark(database), "names"] as const;

/** O inverso de `objectNamesKey`: de que conexão e de que banco é o índice (`database` ausente: o banco da conexão). Chave de outra coisa, inclusive de nível da árvore: `null`. */
export function objectNamesOf(queryKey: readonly unknown[]): DatabaseRef | null {
  const [root, connectionId] = queryKey;
  if (root !== "tree" || typeof connectionId !== "string" || queryKey.at(-1) !== "names") return null;

  const database = databaseOfKey(queryKey);
  return queryKey.length === (database === undefined ? 3 : 4) ? { connectionId, ...inDatabase(database) } : null;
}

/** A chave da consulta de um nível. Em array, para "Atualizar" invalidar por prefixo (`treePrefixes`). */
export function treeKey(path: FetchedPath): readonly unknown[] {
  switch (path.type) {
    case "connection":
      return ["tree", path.connectionId, "databases"];
    case "database":
      return [...treeBase(path.connectionId, path.database), "schemas"];
    case "objects":
      return [...treeBase(path.connectionId, path.database), "schema", path.schema, "objects", path.objects];
    case "tableLevel":
      return [...treeBase(path.connectionId, path.database), "schema", path.schema, "table", path.table, path.level];
  }
}

/**
 * Tudo o que "Atualizar" naquele nó invalida: a conexão, a árvore inteira dela, com a lista dos
 * bancos; um banco, o que é dele (o da conexão não tem um começo de chave só seu, e são dois); o
 * esquema, o que está dentro dele; a tabela, as três listas dela. As consultas abertas buscam de
 * novo; as demais ficam velhas e buscam quando o nó abrir. Nunca inclui a sessão (`databaseSessionKey`).
 *
 * O índice de nomes do banco (`objectNamesKey`, RN-BUSCA-002) vai junto em todo nó de um banco, e não só no banco: a tabela criada depois da primeira busca só aparece
 * depois do "Atualizar" (RN-ARVORE-002), e o nó que a pessoa atualiza para vê-la pode ser o esquema ou o grupo. Na conexão e no outro banco os prefixos de cima já o cobrem.
 */
export function treePrefixes(path: NavPath): readonly (readonly unknown[])[] {
  switch (path.type) {
    case "folder":
      return [];
    case "connection":
      return [["tree", path.connectionId]];
    case "database":
      return path.database === undefined ? [treeKey(path), ["tree", path.connectionId, "schema"], objectNamesKey(path.connectionId)] : [treeBase(path.connectionId, path.database)];
    case "schema":
      return [[...treeBase(path.connectionId, path.database), "schema", path.schema], objectNamesKey(path.connectionId, path.database)];
    case "table":
      return [[...treeBase(path.connectionId, path.database), "schema", path.schema, "table", path.table], objectNamesKey(path.connectionId, path.database)];
    case "objects":
    case "tableLevel":
      return [treeKey(path), objectNamesKey(path.connectionId, path.database)];
  }
}

/**
 * Os filhos de um nó que abre, já como linhas da árvore. A sessão vem da consulta dela: a primeira
 * `queryFn` a precisar a abre, as outras esperam a mesma resposta. A lista dos bancos vem pela
 * sessão da conexão; o que está abaixo de outro banco, pela sessão dele (RN-ARVORE-006).
 */
export function treeQuery(path: FetchedPath, queryClient: QueryClient, enabled: boolean) {
  return queryOptions({
    queryKey: treeKey(path),
    queryFn: async (): Promise<NavNode[]> => {
      const database = path.type === "connection" ? undefined : path.database;
      const { id } = await queryClient.ensureQueryData(databaseSessionQuery(path.connectionId, database));

      switch (path.type) {
        case "connection":
          return databaseNodes(path.connectionId, unwrap(await getDatabases(id)));
        case "database":
          return schemaNodes(path.connectionId, unwrap(await getSchemas(id)), database);
        case "objects":
          return objectNodes(path.connectionId, path.schema, path.objects, unwrap(await getObjects(id, path.schema, path.objects)), database);
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

/**
 * O índice de nomes de um banco (RN-BUSCA-002): as tabelas e as visões de todos os esquemas, numa consulta só ao catálogo. A sessão vem da consulta dela, como no nível da
 * árvore (`treeQuery`): quem ainda não a tem a abre aqui, sem abrir o nó (a conexão que só uma aba conectou já está conectada, e isso não é conectar). Fica em memória até o
 * "Atualizar", como a árvore (`keepUntilRefreshed`), e a busca não volta à API enquanto ele está lá. **Calada** (`meta: { silent: true }`, a sessão também): a falha, e a
 * de abrir a sessão, aparecem na linha de estado da busca, e não no aviso central a cada tecla. `enabled` é só enquanto há texto na busca.
 */
export function objectNamesQuery(connectionId: string, database: string | undefined, queryClient: QueryClient, enabled: boolean) {
  return queryOptions({
    queryKey: objectNamesKey(connectionId, database),
    queryFn: async (): Promise<ObjectNames> => {
      const { id } = await queryClient.ensureQueryData(searchSessionQuery(connectionId, database));
      return unwrap(await getObjectNames(id));
    },
    enabled,
    meta: { silent: true },
    ...keepUntilRefreshed,
  });
}
