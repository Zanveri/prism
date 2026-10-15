import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button, Dialog, TextField, useToast } from "@/components/ui";
import { allowRefusal } from "@/lib/api/prism-api";
import { hasUnshownFieldErrors, parseForm, type FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import { renameConnectionSchema, type Connection } from "../_lib/connections.schema";
import { invalidateLists, updateConnection } from "../_lib/connections.service";
import { renamedConnectionInput, renameRefusalFields } from "../_lib/rename-connection";

const copy = connectionsCopy.rename;
const formID = "rename-connection-form";
const shownFields = Object.keys(renameConnectionSchema.shape);

/**
 * Renomear uma conexão pelo navegador (RN-NAV-009: F2 na linha, ou "Renomear" no menu), num diálogo só com o nome, no molde do "Renomear pasta".
 * O pedido é o mesmo `PATCH` do formulário, com a conexão como está e o nome novo (`renamedConnectionInput`): a senha nula mantém a gravada, e
 * nada mais muda. O nome repetido na pasta (`CONNECTION_ALREADY_EXISTS`, RN-CONN-011) e o nome inválido ficam no campo, no próprio diálogo; as
 * outras recusas vão ao aviso central, e o diálogo fica aberto. A lista se atualiza depois, porque o motivo pode ser ela estar velha.
 */
export function RenameConnectionDialog({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [errors, setErrors] = useState<FieldErrors>({});

  const rename = useMutation({
    mutationFn: async (name: string) => allowRefusal(await updateConnection(connection.id, renamedConnectionInput(connection, name)), "CONNECTION_INVALID", "CONNECTION_ALREADY_EXISTS"),
    onSuccess: async (result) => {
      if (!result.ok) {
        const fields = renameRefusalFields(result.error);
        setErrors(fields);
        if (hasUnshownFieldErrors(fields, shownFields)) toast.error(result.error.title);
        // O nome repetido pode vir de uma lista velha (outra janela criou a conexão): a árvore passa a mostrá-la.
        void invalidateLists(queryClient);
        return;
      }

      toast.success(connectionsCopy.toasts.connectionRenamed);
      await invalidateLists(queryClient);
      onClose();
    },
    onError: () => void invalidateLists(queryClient),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rename.isPending) return;

    const parsed = parseForm(event.currentTarget, renameConnectionSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (parsed.ok) rename.mutate(parsed.data.name);
  }

  const pending = rename.isPending;

  return (
    <Dialog
      open
      size="sm"
      title={copy.title}
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
        <TextField id="rename-connection-name" name="name" label={copy.name} defaultValue={connection.name} autoComplete="off" autoFocus error={errors.name} />
      </form>
    </Dialog>
  );
}
