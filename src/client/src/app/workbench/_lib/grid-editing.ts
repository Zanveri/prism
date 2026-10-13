import type { GridCell } from "./grid-cursor";
import type { QueryRow } from "./query.schema";
import type { ChangeOrigin, EditValue, PendingEdits } from "./record-edits";

/**
 * O que uma linha da grade mostra das pendências (RN-EDIT-004): lida do banco ou nova, marcada para exclusão (riscada), as células
 * alteradas com o valor novo (a lida mostra o valor lido riscado ao lado) e a que falhou no último Salvar (destacada).
 */
export type RowMark = { kind: "read" | "new"; deleted: boolean; pending: ReadonlyMap<number, EditValue>; failed: boolean };

/** O campo de edição aberto numa célula, com o texto que está nele. */
export type CellEditorState = GridCell & { draft: string };

/**
 * A edição que a vista Registros entrega à grade (RN-EDIT-001). A grade só desenha e avisa: quem decide o que cada célula permite e o
 * que cada ação faz é a vista (`use-record-edits.ts`), com as funções puras de `record-edits.ts`, `cell-editing.ts` e `cell-menu.ts`.
 */
export type GridEditing = {
  /** As linhas da grade: as lidas e, depois delas, as novas. */
  rows: readonly QueryRow[];
  /** As marcas das linhas com pendência, pela posição na grade. */
  marks: ReadonlyMap<number, RowMark>;
  active: GridCell | null;
  editor: CellEditorState | null;
  /** O motivo de cada coluna não se editar, para a dica do cabeçalho; nulo enquanto o catálogo não respondeu. */
  columnHints: readonly (string | null)[] | null;
  onActivate: (cell: GridCell) => void;
  /** Abrir o campo na célula: duplo clique, F2, Enter, ou começar a digitar (`initial` substitui o valor). */
  onEdit: (cell: GridCell, initial?: string) => void;
  onDraft: (text: string) => void;
  /** Confirmar o campo (Enter, o botão, sair dele); com Tab e Shift+Tab, passar à próxima célula editável. */
  onCommit: (move?: 1 | -1) => void;
  onCancel: () => void;
  /** O menu da célula: o ponto do clique, ou o pé da célula quando veio do teclado. */
  onMenu: (cell: GridCell, point: { x: number; y: number }, keyboard: boolean) => void;
  /** Ctrl+S com o foco na grade. */
  onSave: () => void;
  /** Alt+Insert com o foco na grade. */
  onNewRow: () => void;
};

/** As linhas que a grade desenha: as lidas e, depois, as novas, com o que foi preenchido (o resto vazio, para o padrão da tabela). */
export function gridRowsOf(rows: readonly QueryRow[], edits: PendingEdits, columns: number): QueryRow[] {
  if (edits.added.length === 0) return rows as QueryRow[];
  return [...rows, ...edits.added.map((row) => Array.from({ length: columns }, (_, column) => row.values[column] ?? null))];
}

/** As marcas das linhas com pendência, pela posição na grade; `failedRow` é a da alteração que falhou no último Salvar. */
export function rowMarksOf(edits: PendingEdits, rowCount: number, failedRow: number | null): ReadonlyMap<number, RowMark> {
  const marks = new Map<number, RowMark>();
  const mark = (row: number, kind: RowMark["kind"]) => {
    const found = marks.get(row) ?? { kind, deleted: false, pending: new Map<number, EditValue>(), failed: false };
    marks.set(row, found);
    return found as { kind: RowMark["kind"]; deleted: boolean; pending: Map<number, EditValue>; failed: boolean };
  };

  for (const cell of edits.cells) mark(cell.row, "read").pending.set(cell.column, cell.value);
  for (const row of edits.deleted) mark(row, "read").deleted = true;
  edits.added.forEach((row, position) => {
    const found = mark(rowCount + position, "new");
    for (const [column, value] of Object.entries(row.values)) found.pending.set(Number(column), value ?? null);
  });
  if (failedRow !== null) mark(failedRow, failedRow >= rowCount ? "new" : "read").failed = true;

  return marks;
}

/** A linha da grade de uma alteração do pedido (a que falhou, para destacá-la), ou nula se ela não está mais lá. */
export function gridRowOf(origin: ChangeOrigin, edits: PendingEdits, rowCount: number): number | null {
  if (origin.kind === "row") return origin.row;
  const position = edits.added.findIndex((row) => row.id === origin.id);
  return position < 0 ? null : rowCount + position;
}
