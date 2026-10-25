import type { QueryColumn } from "./query.schema";
import type { RunTarget } from "./use-query-runner";

/**
 * RN-GRADE-020 e RN-TABELA-007: a identidade de um resultado para o alvo do `edit-target` com `purpose: "sql"`. O alvo diz de onde vem cada coluna do resultado,
 * e isso só muda se o comando, a conexão, o banco ou as colunas (o nome e o tipo, na ordem) mudarem: a atualização automática, o F5 e o "Carregar mais" trazem
 * outro resultado da API com o mesmo comando e as mesmas colunas, e o alvo de antes continua valendo, sem perguntar de novo ao catálogo. O comando é o executado,
 * com o filtro do resultado (RN-GRADE-011), que viaja à parte do texto.
 */
export function sqlTargetKey(connectionId: string | null, database: string | undefined, target: Pick<RunTarget, "sql" | "filter">, columns: readonly Pick<QueryColumn, "name" | "type">[]): string {
  return JSON.stringify([connectionId, database ?? null, target.sql, target.filter ?? null, columns.map((column) => [column.name, column.type])]);
}
