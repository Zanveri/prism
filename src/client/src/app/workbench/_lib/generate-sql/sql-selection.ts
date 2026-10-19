import { columnEditsOf, type EditValue, type PendingEdits } from "../record-edits";
import type { RowsState } from "../use-query-runner";
import type { SqlRow } from "./generate-sql";

/**
 * As linhas do "Gerar SQL" tiradas da seleção da grade (RN-GRADE-006, seção 37), sem React: quem liga é `use-grid-generate-sql.ts`, com a foto da grade de
 * quando o item foi escolhido (`GridSelectionContext`).
 *
 * - As linhas da seleção que estão no banco viram `SqlRow`, na ordem da grade: as lidas, as marcadas para exclusão (com os valores lidos: ela está no banco
 *   até o "Salvar") e as novas já salvas na aba de consulta (RN-EDIT-009), com as células "gerado pelo banco" em `generated`.
 * - Os valores são os que a grade mostra (a pendência, quando há; numa junção, a repetida nas linhas que mostram a mesma linha da tabela), e `read` o que o
 *   banco leu, que a condição pela chave usa. A coluna inteira pendente (RN-EDIT-018) vale em cada linha lida que não está marcada para exclusão, com a
 *   pendência da célula por cima dela. `changed` diz as colunas com pendência, que já é inteira; `cut`, as lidas cortadas (RN-SQL-011) sem pendência,
 *   que a tela busca antes pela rota das células.
 * - As linhas novas ainda não salvas não estão no banco: só contam (`newRows`), para o aviso de que ficaram de fora.
 */
export function sqlSelectionOf(shown: RowsState, pending: PendingEdits, positions: readonly number[]): { rows: SqlRow[]; newRows: number } {
  const read = shown.rows.length;
  const deleted = new Set(pending.deleted);
  const changes = new Map<string, EditValue>(pending.cells.map((cell) => [`${cell.row}:${cell.column}`, cell.value]));
  const wholes = new Map<number, EditValue>(columnEditsOf(pending).map((edit) => [edit.column, edit.value]));
  const rows: SqlRow[] = [];
  let newRows = 0;

  for (const position of positions) {
    if (position >= read) {
      newRows++;
      continue;
    }
    const readValues = shown.rows[position] ?? [];
    const changed: number[] = [];
    const values = deleted.has(position)
      ? readValues
      : readValues.map((value, column) => {
          const key = `${position}:${column}`;
          if (!changes.has(key) && !wholes.has(column)) return value;
          const shownValue = changes.has(key) ? (changes.get(key) ?? null) : (wholes.get(column) ?? null);
          if (shownValue !== value) changed.push(column);
          return shownValue;
        });
    const cut = [...(shown.truncated.get(position) ?? [])].filter((column) => !changed.includes(column)).sort((a, b) => a - b);
    const generated = [...(shown.generated?.get(position) ?? [])].sort((a, b) => a - b);
    rows.push({ number: position + 1, values, read: readValues, changed, cut, generated });
  }

  return { rows, newRows };
}
