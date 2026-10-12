import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button, Dialog, Field, FieldError, FieldLabel, Select, TextField, useToast } from "@/components/ui";
import { allowRefusal } from "@/lib/api/prism-api";
import { apiFieldErrors, hasUnshownFieldErrors, parseForm, type FieldErrors } from "@/lib/utils/form";

import { buildConnectionTree, folderOptions } from "../_lib/connection-tree";
import { connectionsCopy } from "../_lib/connections.copy";
import { createFolderSchema, moveFolderSchema, renameFolderSchema, type Folder, type FolderInput } from "../_lib/connections.schema";
import { createFolder, invalidateLists, updateFolder } from "../_lib/connections.service";

const copy = connectionsCopy.folder;
const toasts = connectionsCopy.toasts;
const formID = "folder-dialog-form";

/** O que o diálogo faz: criar uma pasta (ou subpasta), renomear a que existe, ou mudá-la de lugar. */
export type FolderDialogState = { mode: "create"; parentID: string | null } | { mode: "rename"; folder: Folder } | { mode: "move"; folder: Folder };

/** Os campos que cada modo mostra: um erro da API com outra chave não apareceria em lugar nenhum. */
const shownFields = { create: Object.keys(createFolderSchema.shape), rename: Object.keys(renameFolderSchema.shape), move: Object.keys(moveFolderSchema.shape) };

const successToast = { create: toasts.folderCreated, rename: toasts.folderRenamed, move: toasts.folderMoved } as const;

/**
 * Pasta: criar, criar dentro de outra, renomear e mover (RN-PASTA-001 a 003). É um diálogo só, e
 * cada modo mostra só o que pergunta: o nome, a pasta pai, ou os dois. Montado ao abrir e
 * desmontado ao fechar, o que foi digitado não sobra para a próxima vez.
 *
 * A pasta pai oferece todas as pastas, a própria e as de dentro dela inclusive: mover para dentro
 * de si mesma é recusa da API (`FOLDER_CYCLE`), que chega como aviso. Só o 422 de nome vai no campo.
 */
export function FolderDialog({ state, folders, onClose }: { state: FolderDialogState; folders: Folder[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [parentID, setParentID] = useState(state.mode === "create" ? (state.parentID ?? "") : state.mode === "move" ? (state.folder.parentID ?? "") : "");
  const [errors, setErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: async (input: FolderInput) => allowRefusal(await (state.mode === "create" ? createFolder(input) : updateFolder(state.folder.id, input)), "FOLDER_NAME_INVALID"),
    onSuccess: async (result) => {
      if (!result.ok) {
        const fields = apiFieldErrors(result.error.errors);
        setErrors(Object.keys(fields).length > 0 ? fields : { name: result.error.title });
        if (hasUnshownFieldErrors(fields, shownFields[state.mode])) toast.error(result.error.title);
        return;
      }

      toast.success(successToast[state.mode]);
      await invalidateLists(queryClient);
      onClose();
    },
    // Uma recusa (nome repetido, ciclo, pasta que sumiu) vira aviso e deixa o diálogo aberto; a lista se atualiza porque o motivo pode ser ela estar velha.
    onError: () => void invalidateLists(queryClient),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;

    const form = event.currentTarget;
    const parsed = state.mode === "create" ? parseForm(form, createFolderSchema) : state.mode === "rename" ? parseForm(form, renameFolderSchema) : parseForm(form, moveFolderSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (!parsed.ok) return;

    // O `PATCH` leva o nome e a pasta pai por inteiro: o que este modo não pergunta fica como estava.
    const unchanged = state.mode === "create" ? { name: "", parentID: null } : { name: state.folder.name, parentID: state.folder.parentID };
    mutation.mutate({ ...unchanged, ...parsed.data });
  }

  const text = state.mode === "create" ? (state.parentID === null ? copy.create : { ...copy.create, title: copy.create.subfolderTitle }) : copy[state.mode];
  const pending = mutation.isPending;

  return (
    <Dialog
      open
      size="sm"
      title={text.title}
      description={state.mode === "move" ? copy.move.description(state.folder.name) : undefined}
      pending={pending}
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {copy.cancel}
          </Button>
          <Button type="submit" form={formID} disabled={pending}>
            {pending ? text.submitting : text.submit}
          </Button>
        </>
      }
    >
      <form id={formID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        {state.mode === "move" ? null : <TextField id="folder-name" name="name" label={copy.name} defaultValue={state.mode === "rename" ? state.folder.name : ""} autoComplete="off" autoFocus error={errors.name} />}

        {state.mode === "rename" ? null : (
          <Field>
            <FieldLabel htmlFor="folder-parent">{copy.parent}</FieldLabel>
            <Select id="folder-parent" name="parentID" value={parentID} onChange={setParentID} options={folderOptions(buildConnectionTree(folders, []))} placeholder={copy.noParent} invalid={Boolean(errors.parentID)} />
            <FieldError id="folder-parent-error">{errors.parentID}</FieldError>
          </Field>
        )}
      </form>
    </Dialog>
  );
}
