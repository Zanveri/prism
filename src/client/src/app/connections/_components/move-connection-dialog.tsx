import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button, Dialog, Field, FieldError, FieldLabel, Select, useToast } from "@/components/ui";
import { allowRefusal } from "@/lib/api/prism-api";
import { apiFieldErrors, hasUnshownFieldErrors, type FieldErrors } from "@/lib/utils/form";

import { buildConnectionTree, folderOptions } from "../_lib/connection-tree";
import { connectionsCopy } from "../_lib/connections.copy";
import type { Connection, Folder } from "../_lib/connections.schema";
import { invalidateLists, updateConnection } from "../_lib/connections.service";
import { movedConnectionInput } from "../_lib/move-connection";

const copy = connectionsCopy.move;
const formID = "move-connection-form";

/**
 * Mover uma conexão para outra pasta, pelo menu do navegador (RN-NAV-003). Na tela de Conexões isso era trocar a pasta no formulário; aqui é
 * um diálogo só com a pasta, no molde do "Mover pasta". O pedido é o mesmo `PATCH` do formulário, com a conexão como está e a pasta nova
 * (`movedConnectionInput`). Só o 422 da pasta vai ao campo; o nome repetido na pasta de destino (`CONNECTION_ALREADY_EXISTS`, RN-CONN-011) e as
 * outras recusas vão ao aviso central, e o diálogo fica aberto. A lista se atualiza depois, porque o motivo pode ser ela estar velha.
 */
export function MoveConnectionDialog({ connection, folders, onClose }: { connection: Connection; folders: Folder[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [folderID, setFolderID] = useState(connection.folderID ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});

  const move = useMutation({
    mutationFn: async (target: string | null) => allowRefusal(await updateConnection(connection.id, movedConnectionInput(connection, target)), "CONNECTION_INVALID"),
    onSuccess: async (result) => {
      if (!result.ok) {
        const fields = apiFieldErrors(result.error.errors);
        setErrors(fields);
        if (Object.keys(fields).length === 0 || hasUnshownFieldErrors(fields, ["folderID"])) toast.error(result.error.title);
        return;
      }

      toast.success(connectionsCopy.toasts.connectionMoved);
      await invalidateLists(queryClient);
      onClose();
    },
    onError: () => void invalidateLists(queryClient),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!move.isPending) move.mutate(folderID === "" ? null : folderID);
  }

  const pending = move.isPending;

  return (
    <Dialog
      open
      size="sm"
      title={copy.title}
      description={copy.description(connection.name)}
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {copy.cancel}
          </Button>
          <Button type="submit" form={formID} disabled={pending}>
            {pending ? copy.submitting : copy.submit}
          </Button>
        </>
      }
    >
      <form id={formID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="move-connection-folder">{copy.folder}</FieldLabel>
          <Select id="move-connection-folder" name="folderID" value={folderID} onChange={setFolderID} options={folderOptions(buildConnectionTree(folders, []))} placeholder={copy.noFolder} invalid={Boolean(errors.folderID)} />
          <FieldError id="move-connection-folder-error">{errors.folderID}</FieldError>
        </Field>
      </form>
    </Dialog>
  );
}
