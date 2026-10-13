import { queryOptions, type QueryClient } from "@tanstack/react-query";

import { unwrap, type ApiResult } from "@/lib/api/prism-api";

import { databaseMark, databaseSessionKey, databaseSessionQuery, getColumns, getForeignKeys, getIndexes, isSessionLost, keepUntilRefreshed, reopenDatabaseSession } from "./database-sessions.service";

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
export type StructureLevel = "columns" | "indexes" | "foreignKeys";

export const structureKey = (connectionId: string, schema: string, table: string, level: StructureLevel, database?: string) => ["table-structure", connectionId, ...databaseMark(database), schema, table, level] as const;

/** Tudo o que uma tabela guarda (as três listas), para "Atualizar". */
export const structurePrefix = (connectionId: string, schema: string, table: string, database?: string) => ["table-structure", connectionId, ...databaseMark(database), schema, table] as const;

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
  const keys = tables.map((table) => structurePrefix(connectionId, table.schema, table.name, database));
  const sessionId = () => queryClient.getQueryData<{ id: string }>(databaseSessionKey(connectionId, database))?.id;
  const lost = () => keys.some((queryKey) => queryClient.getQueryCache().findAll({ queryKey }).some((query) => isSessionLost(query.state.error)));
  const refetch = () => Promise.all(keys.map((queryKey) => queryClient.refetchQueries({ queryKey })));

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
