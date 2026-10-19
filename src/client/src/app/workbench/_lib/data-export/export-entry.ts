import type { QueryColumn } from "../query.schema";
import type { RowsState, RunnerState } from "../use-query-runner";
import { dataExportCopy } from "./data-export.copy";
import type { ExportOrigin, ExportSource } from "./export-source";

/**
 * As entradas do assistente "Exportar dados" (RN-EXPORT-001): o "Exportar…" dos Registros e da barra do resultado e o "Exportar dados…" do menu da grade,
 * sempre lá, também sem resultado; o que não se aplica fica desabilitado sem sair do caminho do Tab (`aria-disabled`), com o motivo na dica. A conexão
 * desconectada não desabilita nada: a exportação não usa a sessão da aba.
 */

const e = dataExportCopy.entry;

/** As linhas que a área mostra: com outro comando rodando (a execução da atualização automática), as de antes. São elas a origem da exportação. */
export const exportRows = (state: RunnerState): RowsState | null => (state.status === "rows" ? state : state.status === "running" && state.previous?.status === "rows" ? state.previous : null);

/**
 * O motivo de a entrada não valer agora, ou `null`. Na ordem: as Estatísticas do script à frente; a aba ocupada (um comando da pessoa, o "Salvar", o script
 * rodando ou parado na pergunta de erro; a execução da atualização automática não conta: ela executa o mesmo comando); sem resultado na tela (antes da
 * primeira execução, nas linhas afetadas, no erro); e o comando que não é só de leitura, também o que gravou e devolveu linhas (RN-SQL-013). Na dúvida (a
 * página não disse), não é leitura.
 */
export function exportBlocker(shown: RowsState | null, { busy, statistics = false }: { busy: boolean; statistics?: boolean }): string | null {
  if (statistics) return e.statistics;
  if (busy) return e.busy;
  if (shown === null) return e.noResult;
  if (shown.read !== true || shown.totalRows !== null) return e.notRead;
  return null;
}

/** O motivo pelo estado do executor da aba (o resultado à vista é o dele). */
export function runnerExportBlocker(state: RunnerState, options: { busy: boolean; statistics?: boolean }): string | null {
  return exportBlocker(exportRows(state), options);
}

/** As colunas como a Extração as mostra (o nome e o tipo, como o cabeçalho da grade). */
const sourceColumns = (columns: readonly QueryColumn[]) => columns.map(({ name, type }) => ({ name, type }));

/** A origem dos Registros: o comando que a grade mostra (com o filtro e a ordem aplicados) e o texto deles, a tabela e as colunas do resultado. */
export function recordsSource(rows: RowsState, place: { connectionId: string; database?: string; schema: string; name: string; filter: string; unsavedEdits: number; checkedColumns?: readonly number[] | null }): ExportSource {
  const origin: ExportOrigin = { kind: "records", schema: place.schema, name: place.name, sql: rows.target.sql, filter: place.filter };
  return { connectionId: place.connectionId, ...(place.database === undefined ? {} : { database: place.database }), origin, columns: sourceColumns(rows.columns), unsavedEdits: place.unsavedEdits, ...checkedOf(place.checkedColumns) };
}

/** RN-EXPORT-001 e 005: as colunas inteiras escolhidas na grade (RN-GRADE-022), que a Extração abre marcadas; sem elas, nada (todas marcadas). */
const checkedOf = (columns: readonly number[] | null | undefined) => (columns === null || columns === undefined || columns.length === 0 ? {} : { checkedColumns: columns });

/**
 * A origem do resultado da aba de consulta (ou de uma aba do script): o comando daquele resultado, como foi executado, com o filtro dele (RN-GRADE-011), e
 * a tabela única que o alvo da edição já conhece, quando conhece.
 */
export function resultSource(
  rows: RowsState,
  place: { connectionId: string; database?: string; tabTitle: string; scriptNumber: number | null; unsavedEdits: number; table: { schema: string; name: string } | null; checkedColumns?: readonly number[] | null },
): ExportSource {
  const origin: ExportOrigin = { kind: "result", tabTitle: place.tabTitle, scriptNumber: place.scriptNumber, sql: rows.target.sql, filter: rows.target.filter ?? null, table: place.table };
  return { connectionId: place.connectionId, ...(place.database === undefined ? {} : { database: place.database }), origin, columns: sourceColumns(rows.columns), unsavedEdits: place.unsavedEdits, ...checkedOf(place.checkedColumns) };
}
