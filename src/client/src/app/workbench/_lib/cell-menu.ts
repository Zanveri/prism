import type { AutoRefreshAction } from "./auto-refresh-menu";
import type { EditAccess } from "./cell-editing";
import type { FilterAction } from "./filter-menu";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit.menu;

export type CellMenuAction = "copy" | "paste" | "edit" | "setNull" | "undo" | "newRow" | "deleteRow" | "filter" | "refresh" | FilterAction | "autoRefresh" | AutoRefreshAction;

/**
 * Um item do menu da célula. O modelo só descreve; quem executa é a vista Registros, que tem as pendências e a área de transferência. `checked`: o item é
 * uma escolha de um grupo de escolha única (o intervalo da atualização automática), marcada ou não.
 */
export type CellMenuItem = { id: CellMenuAction; label: string; shortcut?: string; disabled?: boolean; hint?: string; text?: string; checked?: boolean; submenu?: { label: string; groups: CellMenuGroup[] } };

/** Os itens entre dois separadores; com `label`, o grupo tem título (o "Valor da célula" do submenu "Filtrar"). */
export type CellMenuGroup = CellMenuItem[] | { label: string; items: CellMenuItem[] };

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
  /** O "Filtrar" (F11) com o submenu dele (`filterMenuItem`), quando a grade tem campo de filtro. */
  filter?: CellMenuItem;
  /** RN-GRADE-012: "Atualizar" (F5); desabilitado com o motivo enquanto algo roda. */
  refresh?: EditAccess;
  /** RN-GRADE-014: "Atualizar automaticamente", com o submenu dos intervalos (`autoRefreshMenuItem`), logo depois do "Atualizar". */
  autoRefresh?: CellMenuItem;
};

const hintOf = (access: EditAccess) => (access.editable ? {} : { disabled: true, hint: access.reason });

/**
 * O menu de contexto de uma célula dos Registros (pedido do dono, ao lado da RN-EDIT-001): copiar o valor, colar como alteração
 * pendente, editar, definir como NULL e desfazer a alteração; depois, o "Filtrar" (F11, com o submenu), o "Atualizar" (F5) e o "Atualizar automaticamente"
 * (com o submenu dos intervalos), quando a grade os tem;
 * depois do separador, linha nova e excluir linha. O que não se aplica vem desabilitado, sem sumir, com o motivo quando é de só leitura (o de
 * `cellAccess`). Copiar vale sempre, também na célula só leitura; o nulo copia vazio. Os atalhos são os que a grade já trata.
 */
export function cellMenu(state: CellMenuState): CellMenuItem[][] {
  const notNullable = !state.access.editable ? hintOf(state.access) : state.nullable ? {} : { disabled: true, hint: copy.notNullable };
  const view: CellMenuItem[] = [
    ...(state.filter === undefined ? [] : [state.filter]),
    ...(state.refresh === undefined ? [] : [{ id: "refresh" as const, label: copy.refresh, shortcut: "F5", disabled: false, ...hintOf(state.refresh) }]),
    ...(state.autoRefresh === undefined ? [] : [state.autoRefresh]),
  ];

  return [
    [
      { id: "copy", label: copy.copyValue, disabled: false, text: state.value ?? "" },
      { id: "paste", label: copy.paste, ...hintOf(state.access) },
      { id: "edit", label: copy.edit, shortcut: "F2", ...hintOf(state.access) },
      { id: "setNull", label: copy.setNull, ...notNullable },
      { id: "undo", label: copy.undo, disabled: !state.pending && !state.deletedRow },
    ],
    ...(view.length === 0 ? [] : [view]),
    [
      { id: "newRow", label: copy.newRow, shortcut: "Alt+Insert", ...hintOf(state.newRow) },
      { id: "deleteRow", label: copy.deleteRow, ...hintOf(state.deleteRow) },
    ],
  ];
}
