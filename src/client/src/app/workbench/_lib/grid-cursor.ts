/** Uma célula da grade, pela posição da linha (as lidas, depois as novas) e da coluna. */
export type GridCell = { row: number; column: number };

/**
 * RN-EDIT-001 e RN-GRADE-001: a célula ativa depois de uma tecla, com a grade em foco. As setas andam uma célula e param na borda; Home e End vão ao começo
 * e ao fim da linha e, com Ctrl, da grade; PageUp e PageDown andam `page` linhas (uma altura da área à vista). Sem célula ativa, a primeira tecla de
 * movimento ativa a primeira. `null`: a tecla não move (ou a grade está vazia).
 */
export function moveCell(active: GridCell | null, key: string, { rows, columns, page = 1 }: { rows: number; columns: number; page?: number }, ctrl = false): GridCell | null {
  if (rows === 0 || columns === 0) return null;
  if (!movementKeys.includes(key)) return null;
  if (active === null) return { row: 0, column: 0 };

  const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit - 1);
  const step = Math.max(Math.floor(page), 1);
  switch (key) {
    case "ArrowUp":
      return { row: clamp(active.row - 1, rows), column: active.column };
    case "ArrowDown":
      return { row: clamp(active.row + 1, rows), column: active.column };
    case "ArrowLeft":
      return { row: active.row, column: clamp(active.column - 1, columns) };
    case "ArrowRight":
      return { row: active.row, column: clamp(active.column + 1, columns) };
    case "PageUp":
      return { row: clamp(active.row - step, rows), column: active.column };
    case "PageDown":
      return { row: clamp(active.row + step, rows), column: active.column };
    case "Home":
      return { row: ctrl ? 0 : active.row, column: 0 };
    default:
      return { row: ctrl ? rows - 1 : active.row, column: columns - 1 };
  }
}

const movementKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"];

/**
 * RN-GRADE-001: a tecla de movimento que a grade trata, e como: `extend` com Shift (o retângulo, ou as linhas inteiras na vertical), `vertical` quando ela
 * muda de linha (as setas para cima e para baixo, PageUp, PageDown, e Home e End com Ctrl), e `ctrl` para Home e End. A grade só trata o PageUp e o PageDown
 * sem Ctrl, Alt nem Cmd: com um deles a tecla segue adiante, e assim o Ctrl+Shift+PageUp e o Ctrl+Shift+PageDown, que movem a aba ativa (RN-ABAS-001),
 * chegam à barra de abas também com o foco na grade. Nula: a tecla não é de movimento da grade.
 */
export function movementOf(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): { key: string; extend: boolean; vertical: boolean; ctrl: boolean } | null {
  if (!movementKeys.includes(event.key)) return null;
  const ctrl = event.ctrlKey || event.metaKey;
  if ((event.key === "PageUp" || event.key === "PageDown") && (ctrl || event.altKey)) return null;
  const vertical = event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "PageUp" || event.key === "PageDown" || ((event.key === "Home" || event.key === "End") && ctrl);
  return { key: event.key, extend: event.shiftKey, vertical, ctrl };
}

/** RN-EDIT-001: Tab (`1`) e Shift+Tab (`-1`) confirmam e passam à próxima célula editável da mesma linha; `null` quando não há. */
export function nextEditable(from: GridCell, direction: 1 | -1, columns: number, editable: (row: number, column: number) => boolean): GridCell | null {
  for (let column = from.column + direction; column >= 0 && column < columns; column += direction) if (editable(from.row, column)) return { row: from.row, column };
  return null;
}
