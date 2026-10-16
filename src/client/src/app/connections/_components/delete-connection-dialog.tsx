import { useMutation, useQueryClient } from "@tanstack/react-query";

import { dataExportCopy } from "@/app/workbench/_lib/data-export/data-export.copy";
import { useExportsAhead } from "@/app/workbench/_lib/data-export/data-exports";
import { ConfirmDialog, useToast } from "@/components/ui";
import { unwrap } from "@/lib/api/prism-api";

import { connectionsCopy } from "../_lib/connections.copy";
import type { Connection } from "../_lib/connections.schema";
import { deleteConnection, invalidateLists } from "../_lib/connections.service";

const copy = connectionsCopy.form.removeConfirm;

type DeleteConnectionDialogProps = {
  connection: Connection;
  /** Quantas abas desta conexão estão abertas na área de trabalho: excluir a conexão as fecha, com o SQL que têm. */
  openTabs: number;
  onClose: () => void;
  /** Excluída: quem abriu decide o que mostrar (o formulário volta à área de trabalho). */
  onDeleted: () => void;
};

/**
 * Excluir conexão (RN-CONN-014): a pergunta e a chamada. O formulário e o menu do navegador (RN-NAV-003) usam esta mesma, montada ao abrir e
 * desmontada ao fechar. A pergunta diz que as sessões abertas se encerram e quantas abas fecham, com o SQL que têm. A recusa vai ao aviso
 * central; com ou sem ela as listas se atualizam, porque o motivo pode ser a lista estar velha. A área de trabalho poda sozinha as abas e os
 * nós da conexão que some da lista (`pruneWorkbench`).
 *
 * Excluir também cancela as exportações de dados que leem dela (RN-CONN-014 e RN-EXPORT-016): quem cancela é a API, e a pergunta diz quantas, pela lista
 * da API (`connectionID`), lida ao abrir e enquanto ela está na tela.
 */
export function DeleteConnectionDialog({ connection, openTabs, onClose, onDeleted }: DeleteConnectionDialogProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const exportsAhead = useExportsAhead(true, connection.id);
  const description = copy.description(connection.name, openTabs);
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await deleteConnection(id)),
    onSuccess: async () => {
      toast.success(connectionsCopy.toasts.connectionDeleted);
      await invalidateLists(queryClient);
      onDeleted();
    },
    onError: () => {
      onClose();
      void invalidateLists(queryClient);
    },
  });

  return (
    <ConfirmDialog
      open
      tone="danger"
      title={copy.title}
      description={exportsAhead === 0 ? description : `${description} ${dataExportCopy.exits.connectionDelete(exportsAhead)}`}
      confirmLabel={copy.submit}
      pendingLabel={copy.submitting}
      pending={remove.isPending}
      onConfirm={() => remove.mutate(connection.id)}
      onCancel={onClose}
    />
  );
}
