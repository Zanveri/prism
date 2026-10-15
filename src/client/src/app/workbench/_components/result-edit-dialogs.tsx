import type { ReactNode } from "react";

import { ContextMenu, type ContextMenuGroup, type ContextMenuItem } from "@/components/ui";

import type { CellMenuAction, CellMenuGroup, CellMenuItem } from "../_lib/cell-menu";
import { recordsCopy } from "../_lib/records.copy";
import type { RecordEdits } from "../_lib/use-record-edits";
import { CustomFilterField } from "./custom-filter-field";
import { EditSqlDialog } from "./edit-sql-dialog";
import { UnsavedEditsDialog } from "./unsaved-edits-dialog";
import { ValueFilterDialog } from "./value-filter-dialog";

/** Os itens do modelo do menu da célula como o `ContextMenu` os desenha; o item de submenu (o "Filtrar") leva os grupos dele, com os títulos. */
function menuItemOf(item: CellMenuItem, choose: (action: CellMenuAction) => void): ContextMenuItem {
  return {
    id: item.id,
    label: item.label,
    shortcut: item.shortcut,
    disabled: item.disabled,
    hint: item.hint,
    ...(item.submenu === undefined ? { onSelect: () => choose(item.id) } : { submenu: { label: item.submenu.label, groups: item.submenu.groups.map((group) => menuGroupOf(group, choose)) } }),
  };
}

function menuGroupOf(group: CellMenuGroup, choose: (action: CellMenuAction) => void): ContextMenuGroup {
  return Array.isArray(group) ? group.map((item) => menuItemOf(item, choose)) : { label: group.label, items: group.items.map((item) => menuItemOf(item, choose)) };
}

/**
 * O que a edição de uma grade abre por cima da tela (seção 22), igual nos Registros e na aba de consulta: o menu da célula (com o submenu "Filtrar", que o
 * F11 abre já aberto), o "Filtrar por valor…" e o campo do "Personalizado" (RN-GRADE-013), o "Ver SQL" (RN-EDIT-008) e a pergunta antes de
 * perder as alterações não salvas (RN-EDIT-007). Quem usa entrega o que `useRecordEdits` devolve.
 *
 * Uma função, e não um componente: os elementos entram direto na árvore de quem chama (sem estado próprio), e o teste da vista os encontra.
 */
export function resultEditDialogs(edits: Pick<RecordEdits, "menu" | "closeMenu" | "preview" | "closePreview" | "question" | "valueFilter" | "customFilter">): ReactNode {
  const choose = (action: CellMenuAction) => edits.menu?.onChoose(action);

  return (
    <>
      {edits.menu === null ? null : (
        <ContextMenu
          label={recordsCopy.edit.menu.label}
          point={edits.menu.point}
          initialFocus={edits.menu.keyboard ? "first" : "menu"}
          openSubmenu={edits.menu.submenu}
          groups={edits.menu.groups.map((group) => group.map((item) => menuItemOf(item, choose)))}
          onClose={edits.closeMenu}
        />
      )}
      {edits.valueFilter === null ? null : <ValueFilterDialog {...edits.valueFilter} />}
      {edits.customFilter === null ? null : <CustomFilterField {...edits.customFilter} />}
      {edits.preview === null ? null : <EditSqlDialog preview={edits.preview} onClose={edits.closePreview} />}
      {edits.question === null ? null : <UnsavedEditsDialog canSave {...edits.question} />}
    </>
  );
}
