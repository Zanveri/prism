import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** Estado que precisa ser lido antes de decidir — o comando que vai ser executado, por exemplo. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pendingLabel?: string;
  /** `danger` para o que apaga ou não tem volta. */
  tone?: "primary" | "danger";
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * A pergunta antes de uma ação que a pessoa não quer disparar por engano. É um `Dialog` com as
 * duas respostas no rodapé: o foco preso, o Esc, o clique fora e o portal são os dele, e fechar
 * por qualquer um desses caminhos é cancelar. Enquanto a ação roda, nada fecha a pergunta.
 *
 * O foco nasce em "cancelar", não em "confirmar": um Enter solto, ou um clique que caiu no botão
 * errado, precisa de uma segunda decisão para seguir.
 *
 * Pergunta não é feedback — fica até ser respondida; o resultado da ação, esse sim, é aviso
 * (`useToast`).
 */
export function ConfirmDialog({ open, title, description, children, confirmLabel, cancelLabel = "Cancelar", pendingLabel, tone = "primary", pending = false, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      role="alertdialog"
      title={title}
      description={description}
      pending={pending}
      onClose={onCancel}
      footer={
        <>
          <Button autoFocus type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} disabled={pending}>
            {pending ? pendingLabel ?? confirmLabel : confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
