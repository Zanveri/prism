/** Uma célula da grade, pela posição da linha (as lidas, depois as novas) e da coluna. */
export type GridCell = { row: number; column: number };

/**
 * RN-EDIT-001: a célula ativa depois de uma tecla, com a grade em foco. As setas andam uma célula e param na borda; Home e End vão ao começo
 * e ao fim da linha e, com Ctrl, da grade. Sem célula ativa, a primeira tecla de movimento ativa a primeira. `null`: a tecla não move (ou a
 * grade está vazia).
 */
export function moveCell(active: GridCell | null, key: string, { rows, columns }: { rows: number; columns: number }, ctrl = false): GridCell | null {
  if (rows === 0 || columns === 0) return null;
  if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return null;
  if (active === null) return { row: 0, column: 0 };

  const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit - 1);
  switch (key) {
    case "ArrowUp":
      return { row: clamp(active.row - 1, rows), column: active.column };
    case "ArrowDown":
      return { row: clamp(active.row + 1, rows), column: active.column };
    case "ArrowLeft":
      return { row: active.row, column: clamp(active.column - 1, columns) };
    case "ArrowRight":
      return { row: active.row, column: clamp(active.column + 1, columns) };
    case "Home":
      return { row: ctrl ? 0 : active.row, column: 0 };
    default:
      return { row: ctrl ? rows - 1 : active.row, column: columns - 1 };
  }
}

/** RN-EDIT-001: Tab (`1`) e Shift+Tab (`-1`) confirmam e passam à próxima célula editável da mesma linha; `null` quando não há. */
export function nextEditable(from: GridCell, direction: 1 | -1, columns: number, editable: (row: number, column: number) => boolean): GridCell | null {
  for (let column = from.column + direction; column >= 0 && column < columns; column += direction) if (editable(from.row, column)) return { row: from.row, column };
  return null;
}
