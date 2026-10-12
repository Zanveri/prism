import { apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import { queryPageSchema, queryResultSchema, queryTotalSchema, type QueryPage, type QueryResult, type QueryTotal } from "./query.schema";

/**
 * Uma função por rota de `api/user/database-sessions/{id}/queries`. Devolvem `ApiResult`; quem
 * decide qual recusa trata no lugar e qual vai ao aviso central é o `use-query-runner.ts`.
 */

/** Executa o comando como está (RN-SQL-003) e devolve a primeira página ou as linhas afetadas. */
export function executeQuery(sessionId: string, sql: string): Promise<ApiResult<QueryResult>> {
  return apiRequest(prismEndpoints.userDatabaseSessionQueries(sessionId), { method: "POST", body: { sql }, schema: queryResultSchema });
}

/** As próximas linhas do mesmo cursor, sem executar de novo (RN-SQL-005). Cursor fechado: 409 `NO_OPEN_CURSOR`. */
export function fetchNextPage(sessionId: string): Promise<ApiResult<QueryPage>> {
  return apiRequest(prismEndpoints.userDatabaseSessionQueriesNext(sessionId), { method: "POST", schema: queryPageSchema });
}

/** Conta as linhas do último comando da sessão que devolveu linhas (RN-SQL-006). */
export function countQueryTotal(sessionId: string): Promise<ApiResult<QueryTotal>> {
  return apiRequest(prismEndpoints.userDatabaseSessionQueriesCount(sessionId), { method: "POST", schema: queryTotalSchema });
}

/** Interrompe o comando em execução na sessão (RN-SQL-010). */
export function cancelQuery(sessionId: string): Promise<ApiResult<void>> {
  return apiRequest(prismEndpoints.userDatabaseSessionQueriesCancel(sessionId), { method: "POST" });
}
