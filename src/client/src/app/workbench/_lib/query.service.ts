import { apiRequest, type ApiResult } from "@/lib/api/prism-api";
import { prismEndpoints } from "@/lib/api/prism-endpoints";

import type { ParameterType } from "./variables/bind";
import type { VariableQueryResult } from "./variables/query-value";
import { columnValuesCheckSchema, columnValuesSchema, queryPageSchema, queryResultSchema, queryTotalSchema, variableQueryResultSchema, type ColumnValues, type QueryPage, type QueryResult, type QueryTotal } from "./query.schema";

/**
 * Uma função por rota de `api/user/database-sessions/{id}/queries`. Devolvem `ApiResult`; quem
 * decide qual recusa trata no lugar e qual vai ao aviso central é o `use-query-runner.ts`.
 */

/** RN-VAR-032: um parâmetro do pedido, só com as duas chaves que a API lê (`requestParams` tira o resto). */
export type QueryParam = { type: ParameterType; value: string | null };

/** RN-AUDIT-001 e RN-HIST-002: a origem da execução no diário. */
export type QueryOrigin =
  | "editor"
  | "script"
  | "values"
  | "statement"
  | "rerun"
  | "filter"
  | "auto-refresh"
  | "other";

export type ExecuteQueryJournal = {
  origin?: QueryOrigin;
  historyText?: string;
  confirmed?: boolean;
  scriptRunID?: string;
};

/**
 * Executa o comando como está (RN-SQL-003) e devolve a primeira página ou as linhas afetadas. `filter` é o texto do campo de filtro do resultado (RN-GRADE-011:
 * a condição, a ordem ou as duas), que a API junta ao comando; sem ele (ou vazio), o corpo não o leva. O filtro que a API não aceita volta 422 `FILTER_INVALID`.
 * `keep` são os resultados das abas do script que continuam na tela, e se editando, depois deste comando (RN-SQL-024); sem nenhum, o corpo não o leva, e a
 * API esquece os que guardava. `params` (RN-VAR-032) são os valores dos marcadores do `sql`, na ordem, só `{ type, value }`; sem eles, ou vazios, o corpo não os leva
 * e o comando vai como antes. A recusa de um valor volta 422 `QUERY_INVALID` no campo, e a conta errada de marcadores, `QUERY_PARAMETERS_MISMATCH`.
 */
export function executeQuery(
  sessionId: string,
  sql: string,
  filter?: string,
  keep: readonly string[] = [],
  params: readonly QueryParam[] = [],
  journal?: ExecuteQueryJournal
): Promise<ApiResult<QueryResult>> {
  const body = {
    sql,
    ...(filter === undefined || filter === "" ? {} : { filter }),
    ...(keep.length === 0 ? {} : { keep }),
    ...(params.length === 0 ? {} : { params }),
    ...(journal?.origin === undefined ? {} : { origin: journal.origin }),
    ...(journal?.historyText === undefined || journal.historyText === "" ? {} : { historyText: journal.historyText }),
    ...(journal?.confirmed !== true ? {} : { confirmed: true }),
    ...(journal?.scriptRunID === undefined ? {} : { scriptRunID: journal.scriptRunID }),
  };
  return apiRequest(prismEndpoints.userDatabaseSessionQueries(sessionId), { method: "POST", body, schema: queryResultSchema });
}

/**
 * RN-VAR-034: a consulta de uma variável, na sessão da aba e na vez dela. Devolve as colunas e as linhas inteiras (sem o corte da grade) e não muda o resultado da
 * tela. Recusas: 422 `VARIABLE_QUERY_NOT_READ` (não é leitura), `VARIABLE_QUERY_TOO_LARGE` (com `reason`), `SQL_EXECUTION_FAILED` (o erro do banco, ou cancelada),
 * `QUERY_INVALID`, `QUERY_PARAMETERS_MISMATCH` e `MULTIPLE_STATEMENTS_NOT_SUPPORTED`.
 */
export function executeVariableQuery(sessionId: string, sql: string, params: readonly QueryParam[] = []): Promise<ApiResult<VariableQueryResult>> {
  const body = { sql, ...(params.length === 0 ? {} : { params }) };
  return apiRequest(prismEndpoints.userDatabaseSessionQueriesVariable(sessionId), { method: "POST", body, schema: variableQueryResultSchema });
}

/** O pedido dos valores de uma coluna (RN-VAR-035): `limit` de 0 a 200 (0 só com `total`), `offset` até 1.000.000, `search` até 200 caracteres. */
export type ColumnValuesRequest = { column: string; description?: string; search?: string; offset?: number; limit?: number; total?: boolean };

/**
 * RN-VAR-035: os valores diferentes e não nulos da coluna, em ordem crescente, com a descrição quando pedida. Recusas: 422 `VALUES_INVALID` (no campo), 404
 * `VALUES_TABLE_NOT_FOUND`, e as da sessão (`DATABASE_SESSION_NOT_FOUND`, `SESSION_BUSY`, `SQL_EXECUTION_FAILED`).
 */
export function getColumnValues(sessionId: string, schema: string, table: string, request: ColumnValuesRequest, signal?: AbortSignal): Promise<ApiResult<ColumnValues>> {
  return apiRequest(prismEndpoints.userDatabaseSessionColumnValues(sessionId, schema, table), { method: "POST", body: request, schema: columnValuesSchema, signal });
}

/** RN-VAR-035: quais dos valores (de 1 a 1.000, na forma dos `params`) não existem na coluna; devolve as posições deles. */
export function checkColumnValues(sessionId: string, schema: string, table: string, column: string, values: readonly QueryParam[], signal?: AbortSignal): Promise<ApiResult<{ missing: number[] }>> {
  return apiRequest(prismEndpoints.userDatabaseSessionColumnValuesCheck(sessionId, schema, table), { method: "POST", body: { column, values }, schema: columnValuesCheckSchema, signal });
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
