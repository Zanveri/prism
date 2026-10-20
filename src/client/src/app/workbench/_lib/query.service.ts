import { apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import type { ParameterType } from "./variables/bind";
import { queryPageSchema, queryResultSchema, queryTotalSchema, type QueryPage, type QueryResult, type QueryTotal } from "./query.schema";

/**
 * Uma função por rota de `api/user/database-sessions/{id}/queries`. Devolvem `ApiResult`; quem
 * decide qual recusa trata no lugar e qual vai ao aviso central é o `use-query-runner.ts`.
 */

/** RN-VAR-032: um parâmetro do pedido, só com as duas chaves que a API lê (`requestParams` tira o resto). */
export type QueryParam = { type: ParameterType; value: string | null };

/**
 * Executa o comando como está (RN-SQL-003) e devolve a primeira página ou as linhas afetadas. `filter` é o texto do campo de filtro do resultado (RN-GRADE-011:
 * a condição, a ordem ou as duas), que a API junta ao comando; sem ele (ou vazio), o corpo não o leva. O filtro que a API não aceita volta 422 `FILTER_INVALID`.
 * `keep` são os resultados das abas do script que continuam na tela, e se editando, depois deste comando (RN-SQL-024); sem nenhum, o corpo não o leva, e a
 * API esquece os que guardava. `params` (RN-VAR-032) são os valores dos marcadores do `sql`, na ordem, só `{ type, value }`; sem eles, ou vazios, o corpo não os leva
 * e o comando vai como antes. A recusa de um valor volta 422 `QUERY_INVALID` no campo, e a conta errada de marcadores, `QUERY_PARAMETERS_MISMATCH`.
 */
export function executeQuery(sessionId: string, sql: string, filter?: string, keep: readonly string[] = [], params: readonly QueryParam[] = []): Promise<ApiResult<QueryResult>> {
  const body = { sql, ...(filter === undefined || filter === "" ? {} : { filter }), ...(keep.length === 0 ? {} : { keep }), ...(params.length === 0 ? {} : { params }) };
  return apiRequest(prismEndpoints.userDatabaseSessionQueries(sessionId), { method: "POST", body, schema: queryResultSchema });
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
