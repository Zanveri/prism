import type { ReactNode } from "react";

import { ContextMenu } from "@/components/ui";

import { recordsCopy } from "../_lib/records.copy";
import type { RecordEdits } from "../_lib/use-record-edits";
import { EditSqlDialog } from "./edit-sql-dialog";
import { UnsavedEditsDialog } from "./unsaved-edits-dialog";

/**
 * O que a edição de uma grade abre por cima da tela (seção 22), igual nos Registros e na aba de consulta: o menu da célula, o "Ver SQL"
 * (RN-EDIT-008) e a pergunta antes de perder as alterações não salvas (RN-EDIT-007). Quem usa entrega o que `useRecordEdits` devolve.
 *
 * Uma função, e não um componente: os elementos entram direto na árvore de quem chama (sem estado próprio), e o teste da vista os encontra.
 */
export function resultEditDialogs(edits: Pick<RecordEdits, "menu" | "closeMenu" | "preview" | "closePreview" | "question">): ReactNode {
  return (
    <>
      {edits.menu === null ? null : (
        <ContextMenu
          label={recordsCopy.edit.menu.label}
          point={edits.menu.point}
          initialFocus={edits.menu.keyboard ? "first" : "menu"}
          groups={edits.menu.groups.map((group) => group.map((item) => ({ id: item.id, label: item.label, shortcut: item.shortcut, disabled: item.disabled, hint: item.hint, onSelect: () => edits.menu?.onChoose(item.id) })))}
          onClose={edits.closeMenu}
        />
      )}
      {edits.preview === null ? null : <EditSqlDialog preview={edits.preview} onClose={edits.closePreview} />}
      {edits.question === null ? null : <UnsavedEditsDialog canSave {...edits.question} />}
    </>
  );
}
