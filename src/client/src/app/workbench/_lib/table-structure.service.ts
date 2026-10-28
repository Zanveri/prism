import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { unwrap, type ApiResult } from "@/lib/api/prism-api";

import { forgetFailedLists } from "./catalog-fetch-failures";
import { databaseMark, databaseOfKey, databaseSessionKey, databaseSessionQuery, getColumns, getForeignKeys, getIndexes, getReferencedBy, isSessionLost, keepUntilRefreshed, reopenDatabaseSession } from "./database-sessions.service";
import type { NavPath } from "./navigator-model";

/**
 * As colunas, as chaves estrangeiras e os índices de uma tabela, como a Estrutura e o Diagrama os
 * pedem (RN-TABELA-003 e 004): as mesmas três rotas e os mesmos esquemas que a árvore usa
 * (`getColumns`, `getIndexes`, `getForeignKeys`), pela sessão da árvore da conexão (RN-SESSAO-001).
 *
 * A árvore guarda as linhas já prontas para desenhar (`NavNode`), então o dado cru tem consulta
 * própria. A chave **não** é da família `["tree", …]`: "Desconectar" remove essas consultas, e uma
 * vista aberta as refaria na hora, abrindo outra sessão e desfazendo a desconexão. Estas ficam até
 * o "Atualizar" da vista (como a árvore, RN-ARVORE-002) e uma desconexão não as apaga.
 *
 * A tabela de outro banco do servidor (RN-ARVORE-006) vem pela sessão da árvore daquele banco, e a chave leva a marca dele
 * (`databaseMark`) logo depois da conexão; as do banco da conexão são as de sempre.
 */
export type StructureLevel = "columns" | "indexes" | "foreignKeys" | "referencedBy";

export const structureKey = (connectionId: string, schema: string, table: string, level: StructureLevel, database?: string) => ["table-structure", connectionId, ...databaseMark(database), schema, table, level] as const;

/** Tudo o que uma tabela guarda (as listas), para "Atualizar". */
export const structurePrefix = (connectionId: string, schema: string, table: string, database?: string) => ["table-structure", connectionId, ...databaseMark(database), schema, table] as const;

/** O que "Atualizar" invalida em um prefixo: o prefixo e, quando o prefixo sozinho pega mais do que o nó, o que filtra. */
export type StructureScope = { queryKey: readonly unknown[]; predicate?: (query: { queryKey: readonly unknown[] }) => boolean };

/**
 * O que o "Atualizar" de um nó do navegador invalida da família da Estrutura (RN-CONFIG-004): as colunas e as chaves que o autocompletar busca sozinho não têm
 * quem as mostre, e o `invalidateQueries` da árvore (`treePrefixes`) não chega a elas. A conexão, o banco, o esquema e a tabela pegam as listas de tudo o que está
 * abaixo; o grupo de colunas e o de chaves estrangeiras (e as que apontam para a tabela), a lista delas. O banco da conexão não tem um começo de chave só seu, como
 * em `treePrefixes`.
 */
export function structureScopes(path: NavPath): readonly StructureScope[] {
  switch (path.type) {
    case "folder":
    case "objects":
      return [];
    case "connection":
      return [{ queryKey: ["table-structure", path.connectionId] }];
    case "database":
      return [path.database === undefined ? { queryKey: ["table-structure", path.connectionId], predicate: (query) => databaseOfKey(query.queryKey) === undefined } : { queryKey: ["table-structure", path.connectionId, ...databaseMark(path.database)] }];
    case "schema":
      return [{ queryKey: ["table-structure", path.connectionId, ...databaseMark(path.database), path.schema] }];
    case "table":
      return [{ queryKey: structurePrefix(path.connectionId, path.schema, path.table, path.database) }];
    case "tableLevel": {
      const levels: StructureLevel[] = path.level === "foreignKeys" ? ["foreignKeys", "referencedBy"] : [path.level];
      return levels.map((level) => ({ queryKey: structureKey(path.connectionId, path.schema, path.table, level, path.database) }));
    }
  }
}

/**
 * "Atualizar" no navegador: invalida as listas da Estrutura sob o nó (`structureScopes`), menos as dos bancos de `skipped` (as sessões que caíram, que o navegador
 * reabre), e esquece as listas que o autocompletar não conseguiu buscar, para a próxima tentar de novo.
 */
export function invalidateStructure(queryClient: QueryClient, path: NavPath, skipped: ReadonlySet<string | undefined>): void {
  if (path.type === "folder") return;

  forgetFailedLists(queryClient, path.connectionId);
  for (const scope of structureScopes(path)) void queryClient.invalidateQueries({ queryKey: scope.queryKey, predicate: (query) => !skipped.has(databaseOfKey(query.queryKey)) && (scope.predicate?.(query) ?? true) });
}

/**
 * `enabled` é o sinal de que a vista pode falar com o banco: a aba está à vista e a pessoa não desconectou a conexão. Desligada, a
 * consulta não sai (nem a que abriria a sessão da árvore); o dado que já está em cache continua à mão.
 */
function structureQuery<T>(level: StructureLevel, connectionId: string, schema: string, table: string, queryClient: QueryClient, enabled: boolean, fetchLevel: (sessionId: string, schema: string, table: string) => Promise<ApiResult<T>>, database?: string) {
  return queryOptions({
    queryKey: structureKey(connectionId, schema, table, level, database),
    queryFn: async (): Promise<T> => {
      // A primeira consulta a precisar abre a sessão da árvore; as outras esperam a mesma resposta.
      const { id } = await queryClient.ensureQueryData(databaseSessionQuery(connectionId, database));
      return unwrap(await fetchLevel(id, schema, table));
    },
    enabled,
    ...keepUntilRefreshed,
  });
}

export const columnsQuery = (connectionId: string, schema: string, table: string, queryClient: QueryClient, enabled = true, database?: string) => structureQuery("columns", connectionId, schema, table, queryClient, enabled, getColumns, database);

export const indexesQuery = (connectionId: string, schema: string, table: string, queryClient: QueryClient, enabled = true, database?: string) => structureQuery("indexes", connectionId, schema, table, queryClient, enabled, getIndexes, database);

export const foreignKeysQuery = (connectionId: string, schema: string, table: string, queryClient: QueryClient, enabled = true, database?: string) => structureQuery("foreignKeys", connectionId, schema, table, queryClient, enabled, getForeignKeys, database);

/**
 * RN-CAT-004 e RN-SQL-025: as chaves estrangeiras de outras tabelas que apontam para esta. Mesma família de chaves da Estrutura (`structureKey`, nível
 * `referencedBy`): o "Atualizar" da vista, que refaz o prefixo da tabela, a refaz também.
 */
export const referencedByQuery = (connectionId: string, schema: string, table: string, queryClient: QueryClient, enabled = true, database?: string) => structureQuery("referencedBy", connectionId, schema, table, queryClient, enabled, getReferencedBy, database);

/**
 * "Conectar", das vistas Estrutura e Diagrama de uma conexão que a pessoa desconectou: abre a sessão da árvore, como abrir o nó da
 * conexão no navegador. É o clique que reconecta (nada reconecta sozinho): as consultas de catálogo, liberadas em seguida, usam a
 * sessão que ficou. Devolve se a sessão abriu; se não, o aviso central já disse por quê (RN-AVISO-004).
 */
export async function connectTree(queryClient: QueryClient, connectionId: string, database?: string): Promise<boolean> {
  try {
    await queryClient.ensureQueryData(databaseSessionQuery(connectionId, database));
    return true;
  } catch {
    return false;
  }
}

/** Uma tabela, como as consultas a guardam. */
type TableName = { schema: string; name: string };

/**
 * "Atualizar" e "Tentar de novo" da Estrutura e do Diagrama: refaz as listas das tabelas dadas, e é por esta
 * ação da pessoa que uma sessão da árvore caída se recupera (como no navegador: nada reabre sozinho, para
 * "Desconectar" valer). Se alguma lista guarda o erro de sessão perdida (uma busca anterior o descobriu), a sessão
 * é reaberta antes de refazer; se é esta busca que o descobre (o dado velho estava em cache, e a API já não
 * conhecia a sessão), reabre e refaz uma vez mais. A segunda falha fica no cache para a tela mostrar: sem laço.
 * Devolve se uma sessão nova foi aberta (a tela avisa, RN-AVISO-003).
 */
export async function refreshStructure(queryClient: QueryClient, connectionId: string, tables: readonly TableName[], database?: string): Promise<{ sessionReopened: boolean }> {
  // A pessoa mandou refazer: as listas que o autocompletar não conseguiu buscar voltam a ser tentadas.
  forgetFailedLists(queryClient, connectionId);
  const keys = tables.map((table) => structurePrefix(connectionId, table.schema, table.name, database));
  const sessionId = () => queryClient.getQueryData<{ id: string }>(databaseSessionKey(connectionId, database))?.id;
  const lost = () => keys.some((queryKey) => queryClient.getQueryCache().findAll({ queryKey }).some((query) => isSessionLost(query.state.error)));
  const refetch = () =>
    Promise.all([
      ...keys.map((queryKey) => queryClient.refetchQueries({ queryKey })),
      ...tables.map((table) => queryClient.refetchQueries({ queryKey: ["plugin-table-enrichment", connectionId, ...databaseMark(database), table.schema, table.name] })),
      ...tables.map((table) => queryClient.refetchQueries({ queryKey: ["internal-table-description", connectionId, ...databaseMark(database), table.name.trim().toLowerCase()] })),
    ]);

  const before = sessionId();
  let reopened = lost();
  if (reopened) await reopenDatabaseSession(queryClient, connectionId, database);
  await refetch();

  if (!reopened && lost()) {
    reopened = true;
    await reopenDatabaseSession(queryClient, connectionId, database);
    await refetch();
  }

  // Só conta se há uma sessão nova de verdade: quem a abre pode ser esta busca, que pede à consulta da sessão.
  const after = sessionId();
  return { sessionReopened: reopened && after !== undefined && after !== before };
}
