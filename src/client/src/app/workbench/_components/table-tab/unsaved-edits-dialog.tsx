import { Button, Dialog } from "@/components/ui";

import { recordsCopy } from "../../_lib/records.copy";

const copy = recordsCopy.edit;

type UnsavedEditsDialogProps = {
  count: number;
  /** Fechar uma aba, filtrar, atualizar: "Salvar" também. Saídas que atingem várias abas: só "Descartar" e "Cancelar". */
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

/**
 * A pergunta da RN-EDIT-007: "Há N alterações não salvas", com "Salvar", "Descartar" e "Cancelar". O foco nasce em "Cancelar", como no
 * `ConfirmDialog`: um Enter solto não joga fora o trabalho de ninguém. Enquanto salva, nada fecha a pergunta.
 */
export function UnsavedEditsDialog({ count, canSave, saving, onSave, onDiscard, onCancel }: UnsavedEditsDialogProps) {
  return (
    <Dialog
      open
      role="alertdialog"
      title={copy.unsavedTitle(count)}
      description={canSave ? copy.unsavedDescription : copy.unsavedSeveral}
      pending={saving}
      onClose={onCancel}
      footer={
        <>
          <Button autoFocus type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            {copy.cancel}
          </Button>
          <Button type="button" variant="danger" onClick={onDiscard} disabled={saving}>
            {copy.discard}
          </Button>
          {canSave ? (
            <Button type="button" onClick={onSave} disabled={saving}>
              {saving ? copy.saving : copy.save}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
