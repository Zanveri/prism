import type { GridCell } from "./grid-cursor";
import type { QueryRow } from "./query.schema";
import type { ChangeOrigin, EditValue, PendingEdits } from "./record-edits";
import { recordsCopy } from "./records.copy";

const shortcutCopy = recordsCopy.edit.shortcuts;

/**
 * O que uma linha da grade mostra das pendências (RN-EDIT-004): lida do banco ou nova, marcada para exclusão (riscada), as células
 * alteradas com o valor novo (a lida mostra o valor lido riscado ao lado) e a que falhou no último Salvar (destacada).
 */
export type RowMark = { kind: "read" | "new"; deleted: boolean; pending: ReadonlyMap<number, EditValue>; failed: boolean };

/** O campo de edição aberto numa célula, com o texto que está nele. */
export type CellEditorState = GridCell & { draft: string };

/**
 * A edição que a vista Registros e a aba de consulta entregam à grade (RN-EDIT-001). A grade só desenha e avisa: quem decide o que cada célula
 * permite e o que cada ação faz é `use-record-edits.ts`, com as funções puras de `record-edits.ts`, `cell-editing.ts` e `cell-menu.ts`.
 */
export type GridEditing = {
  /** As linhas da grade: as lidas e, depois delas, as novas. */
  rows: readonly QueryRow[];
  /** As alterações não salvas: sem nenhuma, o Ctrl+S da grade segue para quem o trata (`savesEdits`). */
  pending: number;
  /** As marcas das linhas com pendência, pela posição na grade. */
  marks: ReadonlyMap<number, RowMark>;
  active: GridCell | null;
  editor: CellEditorState | null;
  /**
   * A dica do cabeçalho de cada coluna (RN-EDIT-002): o motivo de ela não se editar e, num resultado de junção, a tabela e a coluna que a
   * editável altera; nulo enquanto o catálogo não respondeu.
   */
  columnHints: readonly (string | null)[] | null;
  /** As colunas que não se editam, marcadas no cabeçalho ("somente leitura", como no canvas): só na aba de consulta, com o catálogo respondido. */
  columnReadOnly?: readonly boolean[] | null;
  onActivate: (cell: GridCell) => void;
  /** Abrir o campo na célula: duplo clique, F2, Enter, ou começar a digitar (`initial` substitui o valor). */
  onEdit: (cell: GridCell, initial?: string) => void;
  onDraft: (text: string) => void;
  /** Confirmar o campo (Enter, o botão, sair dele); com Tab e Shift+Tab, passar à próxima célula editável. */
  onCommit: (move?: 1 | -1) => void;
  onCancel: () => void;
  /** O menu da célula: o ponto do clique, ou o pé da célula quando veio do teclado. */
  onMenu: (cell: GridCell, point: { x: number; y: number }, keyboard: boolean) => void;
  /** RN-GRADE-002 e RN-SQL-017: Ctrl+C com o foco na grade copia a célula ativa, com o valor completo quando ela chegou cortada. */
  onCopy: (cell: GridCell) => void;
  /** Ctrl+S com o foco na grade. */
  onSave: () => void;
  /** Alt+Insert com o foco na grade (RN-EDIT-015). */
  onNewRow: () => void;
  /** Ctrl+Alt+Insert com o foco na grade: duplica a linha da célula ativa (RN-EDIT-015 e 016). */
  onDuplicateRow: () => void;
  /** Alt+Delete com o foco na grade: exclui a linha da célula ativa (RN-EDIT-015). */
  onDeleteRow: () => void;
  /**
   * RN-GRADE-013: F11 com o foco na grade abre o menu da célula ativa com o submenu "Filtrar" aberto (`menu`), e Ctrl+F11 abre direto o
   * "Filtrar por valor…" (`values`). Só existe na grade que tem campo de filtro.
   */
  onFilter?: (cell: GridCell, point: { x: number; y: number }, mode: "menu" | "values") => void;
};

/**
 * RN-EDIT-004: Ctrl+S (Cmd+S) com o foco na grade salva as alterações, quando há alguma. Sem nenhuma, ou com Shift, a tecla segue para quem a trata:
 * na aba de consulta, salvar o script e "Salvar como" (RN-SCRIPT-001).
 */
export function savesEdits(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, pending: number): boolean {
  return pending > 0 && (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "s";
}

/**
 * RN-GRADE-002: Ctrl+C (Cmd+C) com o foco na grade copia a célula ativa, como o valor puro. Com Shift é o copiar avançado (RN-GRADE-003), e com Alt
 * não é cópia: a tecla segue.
 */
export function copiesCell(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "c";
}

/**
 * RN-GRADE-013: F11 abre o submenu "Filtrar" na célula ativa, e Ctrl+F11 (Cmd+F11) abre o "Filtrar por valor…". Com Shift ou Alt não é o
 * filtro: a tecla segue.
 */
export function filterKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): "menu" | "values" | null {
  if (event.key !== "F11" || event.shiftKey || event.altKey) return null;
  return event.ctrlKey || event.metaKey ? "values" : "menu";
}

/**
 * RN-GRADE-012: F5 atualiza (os Registros lidos de novo, o resultado executado de novo, a Estrutura e o Diagrama recarregados, o nó do navegador), como
 * no DBeaver. Só a tecla sozinha: Ctrl+F5 e Shift+F5 também não recarregam a janela (o processo principal as segura), mas não atualizam nada.
 */
export function refreshKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return event.key === "F5" && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

const isMacPlatform = (platform: string) => /mac|iphone|ipad/i.test(platform);

/** As ações da linha que têm atalho com o foco na grade (RN-EDIT-015): adicionar, duplicar e excluir. */
export type RowShortcut = "newRow" | "duplicateRow" | "deleteRow";

/**
 * RN-EDIT-015: os atalhos da linha com o foco na grade, como no DBeaver, com os modificadores exatos. Alt+Insert adiciona (sem Ctrl, Shift nem Cmd);
 * Ctrl+Alt+Insert duplica a linha da célula ativa (sem Shift), conferido antes do Alt+Insert, que está dentro dele; Alt+Delete exclui a linha da célula
 * ativa (sem Ctrl, Shift nem Cmd). No Windows o AltGr chega como Ctrl+Alt: com ele o Insert duplica, e o Delete não faz nada. No macOS o Option faz o
 * papel do Alt e o Cmd o do Ctrl: Option+Insert, Cmd+Option+Insert (e o Control+Option+Insert do DBeaver, sem Cmd) e Option+Delete, que é também a
 * tecla "delete" do Mac (a de apagar para trás, `Backspace`) e o fn+delete. Com Shift nada acontece: o Shift+Alt+Insert e o Ctrl+Shift+Alt+Insert do
 * DBeaver 26.1 ficam para depois. O Delete sozinho não exclui: espera a seleção de linhas (RN-GRADE-001).
 */
export function rowShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }, platform: string): RowShortcut | null {
  if (!event.altKey || event.shiftKey) return null;
  const mac = isMacPlatform(platform);

  if (event.key === "Insert") {
    if (!event.ctrlKey && !event.metaKey) return "newRow";
    return (mac ? event.ctrlKey !== event.metaKey : event.ctrlKey && !event.metaKey) ? "duplicateRow" : null;
  }
  const deletes = event.key === "Delete" || (mac && event.key === "Backspace");
  return deletes && !event.ctrlKey && !event.metaKey ? "deleteRow" : null;
}

/** Um atalho como a tela o escreve (`label`, no menu e na dica) e como o leitor de tela o recebe (`aria`, o `aria-keyshortcuts`, nos nomes das teclas da web). */
export type EditShortcut = { label: string; aria: string };

/** RN-EDIT-013 e 015: os atalhos da edição como a plataforma os escreve: os mesmos no menu da célula e nas dicas da barra de edição (`navigator.platform`). */
export function editShortcuts(platform: string): Record<"edit" | RowShortcut, EditShortcut> {
  const mac = isMacPlatform(platform);
  return {
    edit: { label: shortcutCopy.edit, aria: "F2" },
    newRow: { label: mac ? shortcutCopy.newRowMac : shortcutCopy.newRow, aria: "Alt+Insert" },
    duplicateRow: mac ? { label: shortcutCopy.duplicateRowMac, aria: "Meta+Alt+Insert Control+Alt+Insert" } : { label: shortcutCopy.duplicateRow, aria: "Control+Alt+Insert" },
    deleteRow: mac ? { label: shortcutCopy.deleteRowMac, aria: "Alt+Backspace Alt+Delete" } : { label: shortcutCopy.deleteRow, aria: "Alt+Delete" },
  };
}

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
