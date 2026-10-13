import type { EditAccess } from "./cell-editing";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit.menu;

export type CellMenuAction = "copy" | "paste" | "edit" | "setNull" | "undo" | "newRow" | "deleteRow";

/** Um item do menu da célula. O modelo só descreve; quem executa é a vista Registros, que tem as pendências e a área de transferência. */
export type CellMenuItem = { id: CellMenuAction; label: string; shortcut?: string; disabled?: boolean; hint?: string; text?: string };

export type CellMenuState = {
  /** O texto da célula como a grade o mostra (a pendência, quando há), ou nulo. */
  value: string | null;
  /** Se a célula se edita (`cellAccess`), com o motivo quando não. */
  access: EditAccess;
  /** A célula tem alteração pendente (na linha nova: a coluna foi preenchida). */
  pending: boolean;
  /** A linha está marcada para exclusão: desfazer devolve a linha. */
  deletedRow: boolean;
  /** A coluna aceita NULL (o catálogo diz; sem o alvo, aceita). */
  nullable: boolean;
  newRow: EditAccess;
  deleteRow: EditAccess;
};

const hintOf = (access: EditAccess) => (access.editable ? {} : { disabled: true, hint: access.reason });

/**
 * O menu de contexto de uma célula dos Registros (pedido do dono, ao lado da RN-EDIT-001): copiar o valor, colar como alteração
 * pendente, editar, definir como NULL e desfazer a alteração; depois do separador, linha nova e excluir linha. O que não se aplica vem
 * desabilitado, sem sumir, com o motivo quando é de só leitura (o de `cellAccess`). Copiar vale sempre, também na célula só leitura; o
 * nulo copia vazio. Os atalhos são os que a grade já trata.
 */
export function cellMenu(state: CellMenuState): CellMenuItem[][] {
  const notNullable = !state.access.editable ? hintOf(state.access) : state.nullable ? {} : { disabled: true, hint: copy.notNullable };

  return [
    [
      { id: "copy", label: copy.copyValue, disabled: false, text: state.value ?? "" },
      { id: "paste", label: copy.paste, ...hintOf(state.access) },
      { id: "edit", label: copy.edit, shortcut: "F2", ...hintOf(state.access) },
      { id: "setNull", label: copy.setNull, ...notNullable },
      { id: "undo", label: copy.undo, disabled: !state.pending && !state.deletedRow },
    ],
    [
      { id: "newRow", label: copy.newRow, shortcut: "Alt+Insert", ...hintOf(state.newRow) },
      { id: "deleteRow", label: copy.deleteRow, ...hintOf(state.deleteRow) },
    ],
  ];
}
