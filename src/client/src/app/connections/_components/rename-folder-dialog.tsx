import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button, Dialog, TextField, useToast } from "@/components/ui";
import { allowRefusal } from "@/lib/api/prism-api";
import { hasUnshownFieldErrors, parseForm, type FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import { renameFolderSchema, type Folder } from "../_lib/connections.schema";
import { invalidateLists, updateFolder } from "../_lib/connections.service";
import { renamedFolderInput, renameFolderRefusalFields } from "../_lib/rename-folder";

const copy = connectionsCopy.folder;
const formID = "rename-folder-form";
const shownFields = Object.keys(renameFolderSchema.shape);

/**
 * O "Renomear" da pasta pelo navegador (RN-NAV-009: F2 na linha, ou "Renomear" no menu), num diálogo só com o nome, no molde do "Renomear conexão": o
 * diálogo inteiro, com a cor e o ambiente, é o "Editar pasta…" (RN-PASTA-006). O pedido é o mesmo `PATCH`, com a pasta como está e o nome novo
 * (`renamedFolderInput`): a cor e o ambiente ficam. O nome repetido entre as irmãs (`FOLDER_ALREADY_EXISTS`, RN-PASTA-002) e o nome inválido ficam no campo;
 * as outras recusas (a pasta que sumiu) vão ao aviso central, e o diálogo fica aberto. A lista se atualiza depois, porque o motivo pode ser ela estar velha.
 */
export function RenameFolderDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [errors, setErrors] = useState<FieldErrors>({});

  const rename = useMutation({
    mutationFn: async (name: string) => allowRefusal(await updateFolder(folder.id, renamedFolderInput(folder, name)), "FOLDER_NAME_INVALID", "FOLDER_ALREADY_EXISTS"),
    onSuccess: async (result) => {
      if (!result.ok) {
        const fields = renameFolderRefusalFields(result.error);
        setErrors(fields);
        if (hasUnshownFieldErrors(fields, shownFields)) toast.error(result.error.title);
        // O nome repetido pode vir de uma lista velha (outra janela criou a pasta): a árvore passa a mostrá-la.
        void invalidateLists(queryClient);
        return;
      }

      toast.success(connectionsCopy.toasts.folderRenamed);
      await invalidateLists(queryClient);
      onClose();
    },
    onError: () => void invalidateLists(queryClient),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rename.isPending) return;

    const parsed = parseForm(event.currentTarget, renameFolderSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (parsed.ok) rename.mutate(parsed.data.name);
  }

  const pending = rename.isPending;

  return (
    <Dialog
      open
      size="sm"
      title={copy.rename.title}
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {copy.cancel}
          </Button>
          <Button type="submit" form={formID} disabled={pending}>
            {pending ? copy.rename.submitting : copy.rename.submit}
          </Button>
        </>
      }
    >
      <form id={formID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField id="rename-folder-name" name="name" label={copy.name} defaultValue={folder.name} autoComplete="off" autoFocus error={errors.name} />
      </form>
    </Dialog>
  );
}
