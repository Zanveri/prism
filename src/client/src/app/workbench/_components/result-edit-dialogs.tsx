import type { ReactNode } from "react";

import { ContextMenu, type ContextMenuGroup, type ContextMenuItem, type Engine } from "@/components/ui";

import type { CellMenuAction, CellMenuGroup, CellMenuItem } from "../_lib/cell-menu";
import type { CopyAs } from "../_lib/copy-as/use-copy-as";
import type { GridGenerateSql } from "../_lib/generate-sql/use-grid-generate-sql";
import { recordsCopy } from "../_lib/records.copy";
import type { RecordEdits } from "../_lib/use-record-edits";
import { ConfigureCopyAsDialog } from "./copy-as/configure-copy-as-dialog";
import { CopyAdvancedDialog } from "./copy-as/copy-advanced-dialog";
import { CustomFilterField } from "./custom-filter-field";
import { EditSqlDialog } from "./edit-sql-dialog";
import { GenerateSqlDialog } from "./generate-sql/generate-sql-dialog";
import { SqlDialogConnection } from "./generate-sql/sql-dialog-connection";
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
    ...(item.checked === undefined ? {} : { checked: item.checked }),
    ...(item.submenu === undefined ? { onSelect: () => choose(item.id) } : { submenu: { label: item.submenu.label, groups: item.submenu.groups.map((group) => menuGroupOf(group, choose)) } }),
  };
}

/** Um grupo do modelo como o `ContextMenu` o desenha; serve também ao menu da atualização automática na barra do resultado (RN-GRADE-014). */
export function menuGroupOf(group: CellMenuGroup, choose: (action: CellMenuAction) => void): ContextMenuGroup {
  return Array.isArray(group) ? group.map((item) => menuItemOf(item, choose)) : { label: group.label, items: group.items.map((item) => menuItemOf(item, choose)) };
}

/**
 * Os diálogos do submenu "Copiar avançado" e do "Gerar SQL" da grade (seção 37): o que `useCopyAs` e `useGridGenerateSql` devolvem, com o banco e a conexão
 * da aba para o cabeçalho e o realce do "Gerar SQL".
 */
export type GridActionDialogs = { copyAs: Pick<CopyAs, "advanced" | "configure">; generateSql: Pick<GridGenerateSql, "dialog">; engine: Engine | undefined; connectionId: string | null; database?: string };

/**
 * O que a edição de uma grade abre por cima da tela (seção 22), igual nos Registros e na aba de consulta: o menu da célula (com o submenu "Filtrar", que o
 * F11 abre já aberto), o "Filtrar por valor…" e o campo do "Personalizado" (RN-GRADE-013), o "Ver SQL" (RN-EDIT-008) e a pergunta antes de
 * perder as alterações não salvas (RN-EDIT-007). Quem usa entrega o que `useRecordEdits` devolve. Seção 37: com `actions`, também o "Copiar avançado…", o
 * "Configurar comandos 'Copiar como'…" (RN-GRADE-003 e 017) e o "Gerar SQL" (RN-GRADE-018).
 *
 * Uma função, e não um componente: os elementos entram direto na árvore de quem chama (sem estado próprio), e o teste da vista os encontra.
 */
export function resultEditDialogs(edits: Pick<RecordEdits, "menu" | "closeMenu" | "preview" | "closePreview" | "question" | "valueFilter" | "customFilter">, actions?: GridActionDialogs): ReactNode {
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
      {actions?.copyAs.advanced == null ? null : <CopyAdvancedDialog {...actions.copyAs.advanced} />}
      {actions?.copyAs.configure == null ? null : <ConfigureCopyAsDialog {...actions.copyAs.configure} />}
      {actions?.generateSql.dialog == null || actions.engine === undefined ? null : (
        <GenerateSqlDialog
          dialog={actions.generateSql.dialog}
          engine={actions.engine}
          connection={actions.connectionId === null ? undefined : <SqlDialogConnection connectionId={actions.connectionId} database={actions.database} />}
        />
      )}
    </>
  );
}
