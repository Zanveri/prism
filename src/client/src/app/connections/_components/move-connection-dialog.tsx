import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button, Dialog, Field, FieldError, FieldLabel, Select, useToast } from "@/components/ui";
import { allowRefusal, type ApiResult } from "@/lib/api/prism-api";
import { apiFieldErrors, hasUnshownFieldErrors, type FieldErrors } from "@/lib/utils/form";

import { buildConnectionTree, folderOptions } from "../_lib/connection-tree";
import { connectionsCopy } from "../_lib/connections.copy";
import type { Connection, ConnectionInput, Folder } from "../_lib/connections.schema";
import { invalidateLists, updateConnection } from "../_lib/connections.service";
import { movedConnectionInput } from "../_lib/move-connection";
import { passwordAsked } from "../_lib/user-password";
import { UserPasswordDialog } from "./user-password-dialog";

const copy = connectionsCopy.move;
const formID = "move-connection-form";

/**
 * Mover uma conexão para outra pasta, pelo menu do navegador (RN-NAV-003). Na tela de Conexões isso era trocar a pasta no formulário; aqui é
 * um diálogo só com a pasta, no molde do "Mover pasta". O pedido é o mesmo `PATCH` do formulário, com a conexão como está e a pasta nova
 * (`movedConnectionInput`). Só o 422 da pasta vai ao campo; o nome repetido na pasta de destino (`CONNECTION_ALREADY_EXISTS`, RN-CONN-011) e as
 * outras recusas vão ao aviso central, e o diálogo fica aberto. A lista se atualiza depois, porque o motivo pode ser ela estar velha.
 *
 * Mover para fora de uma pasta somente leitura tira o somente leitura herdado, e a API pede a senha do usuário (422 `USER_PASSWORD_REQUIRED`, RN-PROT-003):
 * o diálogo da senha abre, e o mesmo pedido vai de novo com ela. As proteções próprias da conexão vão como estão (`movedConnectionInput`).
 *
 * Depois de mover, com as listas já lidas de novo, `onMoved` recebe a conexão como ficou: o navegador a revela, como o salvar, com as pastas do destino abertas
 * (RN-NAV-014).
 */
export function MoveConnectionDialog({ connection, folders, onClose, onMoved }: { connection: Connection; folders: Folder[]; onClose: () => void; onMoved?: (connection: Connection) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [folderID, setFolderID] = useState(connection.folderID ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [asking, setAsking] = useState<{ input: ConnectionInput; change: string } | null>(null);

  async function settled(result: ApiResult<Connection>) {
    if (!result.ok) {
      const fields = apiFieldErrors(result.error.errors);
      setErrors(fields);
      if (Object.keys(fields).length === 0 || hasUnshownFieldErrors(fields, ["folderID"])) toast.error(result.error.title);
      return;
    }

    toast.success(connectionsCopy.toasts.connectionMoved);
    await invalidateLists(queryClient);
    onMoved?.(result.data);
    onClose();
  }

  const move = useMutation({
    mutationFn: async (input: ConnectionInput) => allowRefusal(await updateConnection(connection.id, input), "CONNECTION_INVALID", "USER_PASSWORD_REQUIRED"),
    onSuccess: async (result, input) => {
      const change = passwordAsked(result, connection.name);
      if (change !== null) {
        setAsking({ input, change });
        return;
      }
      await settled(result);
    },
    onError: () => void invalidateLists(queryClient),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!move.isPending && asking === null) move.mutate(movedConnectionInput(connection, folderID === "" ? null : folderID));
  }

  const pending = move.isPending;

  return (
    <>
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

      {asking === null ? null : (
        <UserPasswordDialog
          change={asking.change}
          send={(userPassword) => updateConnection(connection.id, asking.input, userPassword)}
          refusals={["CONNECTION_INVALID"]}
          onDone={(result) => {
            setAsking(null);
            if (result === null) void invalidateLists(queryClient);
            else void settled(result);
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </>
  );
}
