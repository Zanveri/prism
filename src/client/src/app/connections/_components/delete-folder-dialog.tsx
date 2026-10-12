import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ConfirmDialog, useToast } from "@/components/ui";
import { unwrap } from "@/lib/api/prism-api";

import { connectionsCopy } from "../_lib/connections.copy";
import type { Folder } from "../_lib/connections.schema";
import { deleteFolder, invalidateLists } from "../_lib/connections.service";

const copy = connectionsCopy.folder.remove;

/**
 * Excluir pasta (RN-PASTA-001): a pergunta e a chamada. A tela de Conexões e o menu do navegador de bancos usam esta mesma, montada ao abrir e
 * desmontada ao fechar, como o `FolderDialog`. A recusa (`FOLDER_NOT_EMPTY`) já virou o aviso central; com ou sem ela a pergunta se fecha e as
 * listas se atualizam, porque o motivo pode ser a lista estar velha.
 */
export function DeleteFolderDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await deleteFolder(id)),
    onSuccess: () => toast.success(connectionsCopy.toasts.folderDeleted),
    onSettled: async () => {
      onClose();
      await invalidateLists(queryClient);
    },
  });

  return (
    <ConfirmDialog
      open
      tone="danger"
      title={copy.title}
      description={copy.description(folder.name)}
      confirmLabel={copy.submit}
      pendingLabel={copy.submitting}
      pending={remove.isPending}
      onConfirm={() => remove.mutate(folder.id)}
      onCancel={onClose}
    />
  );
}
