import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Dialog, Field, FieldError, FieldLabel, Select, TextField, useToast } from "@/components/ui";
import { allowRefusal, type ApiResult } from "@/lib/api/prism-api";
import { apiFieldErrors, hasUnshownFieldErrors, parseForm, type FieldErrors } from "@/lib/utils/form";

import { buildConnectionTree, folderOptions } from "../_lib/connection-tree";
import { connectionsCopy } from "../_lib/connections.copy";
import { createFolderSchema, editFolderSchema, moveFolderSchema, type Folder, type FolderInput } from "../_lib/connections.schema";
import { connectionsQuery, createFolder, invalidateLists, updateFolder } from "../_lib/connections.service";
import { folderInputOf } from "../_lib/folder-input";
import { confirmationChoiceOf, inheritedProtections, type ConfirmationChoice } from "../_lib/protections";
import { userEnvironments } from "../_lib/user-environments";
import { passwordAsked, readOnlyChange } from "../_lib/user-password";
import { ColorField } from "./color-field";
import { EnvironmentPicker } from "./environment-picker";
import { ProtectionsSection } from "./protections-section";
import { UserPasswordDialog } from "./user-password-dialog";

const copy = connectionsCopy.folder;
const toasts = connectionsCopy.toasts;
const formID = "folder-dialog-form";

/** O que o diálogo faz: criar uma pasta (ou subpasta), editar a que existe (o nome, a cor, o ambiente e as proteções, RN-PASTA-006), ou mudá-la de lugar. */
export type FolderDialogState = { mode: "create"; parentID: string | null } | { mode: "edit"; folder: Folder } | { mode: "move"; folder: Folder };

/** Os campos que cada modo mostra: um erro da API com outra chave não apareceria em lugar nenhum. */
const shownFields = { create: Object.keys(createFolderSchema.shape), edit: Object.keys(editFolderSchema.shape), move: Object.keys(moveFolderSchema.shape) };

const successToast = { create: toasts.folderCreated, edit: toasts.folderUpdated, move: toasts.folderMoved } as const;

/**
 * Pasta: criar, criar dentro de outra, editar e mover (RN-PASTA-001 a 003). É um diálogo só, e
 * cada modo mostra só o que pergunta: criar, o nome, a pasta pai, a cor da pasta (RN-PASTA-007), o
 * ambiente (RN-PASTA-005) e as proteções (RN-PROT-001 a 004); "Editar pasta…" (RN-PASTA-006, sem atalho), o nome, a cor, o ambiente e as proteções;
 * mover, a pasta pai. As proteções herdadas da pasta pai aparecem marcadas e não se afrouxam; marcar ou desmarcar "Somente leitura"
 * numa pasta que já existe pede a senha do usuário ao salvar, e mover para fora de uma pasta somente leitura também, quando a API a pede (RN-PROT-003). O "Renomear" (F2, RN-NAV-009), só com o nome, é o `RenameFolderDialog`. Montado
 * ao abrir e desmontado ao fechar, o que foi digitado não sobra para a próxima vez. A cor vem antes da
 * seção Ambiente, porque é da pasta e não passa a ninguém. A seção Ambiente mostra os ambientes do
 * usuário (RN-AMB-001), das pastas e das conexões que o cache já tem (as listas do navegador).
 *
 * A pasta pai oferece todas as pastas, a própria e as de dentro dela inclusive: mover para dentro
 * de si mesma é recusa da API (`FOLDER_CYCLE`), que chega como aviso. Só o 422 de nome vai no campo.
 *
 * Depois de mover, com as listas já lidas de novo, `onMoved` recebe a pasta como ficou: o navegador abre as pastas do destino e a deixa à vista (RN-NAV-014).
 */
export function FolderDialog({ state, folders, onClose, onMoved }: { state: FolderDialogState; folders: Folder[]; onClose: () => void; onMoved?: (folder: Folder) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [parentID, setParentID] = useState(state.mode === "create" ? (state.parentID ?? "") : state.mode === "move" ? (state.folder.parentID ?? "") : "");
  const [folderColor, setFolderColor] = useState<string | null>(state.mode === "create" ? null : state.folder.color);
  const [color, setColor] = useState<string | null>(state.mode === "create" ? null : state.folder.environmentColor);
  const [errors, setErrors] = useState<FieldErrors>({});
  // RN-PROT-001 e 002: as proteções PRÓPRIAS da pasta; as da pasta pai aparecem na seção, e não são gravadas aqui.
  const [confirm, setConfirm] = useState<ConfirmationChoice>(confirmationChoiceOf(state.mode === "create" ? null : state.folder.confirmCommands));
  const [readOnly, setReadOnly] = useState(state.mode === "create" ? false : state.folder.readOnly);
  // RN-PROT-003: a gravação que espera a senha do usuário, com a frase do que muda.
  const [asking, setAsking] = useState<{ input: FolderInput; change: string } | null>(null);
  const connections = useQuery(connectionsQuery);

  /** O fim de uma gravação, com ou sem a senha do usuário: gravou, ou o 422 do campo vai a ele. */
  async function settled(result: ApiResult<Folder>) {
    if (!result.ok) {
      const fields = apiFieldErrors(result.error.errors);
      setErrors(Object.keys(fields).length > 0 ? fields : { name: result.error.title });
      if (hasUnshownFieldErrors(fields, shownFields[state.mode])) toast.error(result.error.title);
      return;
    }

    toast.success(successToast[state.mode]);
    await invalidateLists(queryClient);
    if (state.mode === "move") onMoved?.(result.data);
    onClose();
  }

  const mutation = useMutation({
    mutationFn: async (input: FolderInput) => allowRefusal(await (state.mode === "create" ? createFolder(input) : updateFolder(state.folder.id, input)), "FOLDER_NAME_INVALID", "USER_PASSWORD_REQUIRED"),
    onSuccess: async (result, input) => {
      // RN-PROT-003: a API pediu a senha que a tela não previu (mover para fora de uma pasta somente leitura): grava de novo com ela.
      const change = state.mode === "create" ? null : passwordAsked(result, state.folder.name);
      if (change !== null) {
        setAsking({ input, change });
        return;
      }
      await settled(result);
    },
    // Uma recusa (nome repetido, ciclo, pasta que sumiu) vira aviso e deixa o diálogo aberto; a lista se atualiza porque o motivo pode ser ela estar velha.
    onError: () => void invalidateLists(queryClient),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending || asking !== null) return;

    const form = event.currentTarget;
    const parsed = state.mode === "create" ? parseForm(form, createFolderSchema) : state.mode === "edit" ? parseForm(form, editFolderSchema) : parseForm(form, moveFolderSchema);
    setErrors(parsed.ok ? {} : parsed.errors);
    if (!parsed.ok) return;

    // O `PATCH` grava a pasta por inteiro: o que este modo não pergunta fica como estava (mover não tira o ambiente nem as proteções).
    const input = folderInputOf(state.mode === "create" ? null : state.folder, parsed.data);
    // RN-PROT-003: marcar ou desmarcar "Somente leitura" numa pasta que já existe pede a senha do usuário antes de gravar.
    const change = state.mode === "create" ? null : readOnlyChange(state.folder.name, state.folder.readOnly, input.readOnly);
    if (change !== null) setAsking({ input, change });
    else mutation.mutate(input);
  }

  const text = state.mode === "create" ? (state.parentID === null ? copy.create : { ...copy.create, title: copy.create.subfolderTitle }) : copy[state.mode];
  const pending = mutation.isPending;

  return (
    <>
      <Dialog
        open
        size={state.mode === "move" ? "sm" : "md"}
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
          {state.mode === "move" ? null : <TextField id="folder-name" name="name" label={copy.name} defaultValue={state.mode === "edit" ? state.folder.name : ""} autoComplete="off" autoFocus error={errors.name} />}

          {state.mode === "edit" ? null : (
            <Field>
              <FieldLabel htmlFor="folder-parent">{copy.parent}</FieldLabel>
              <Select id="folder-parent" name="parentID" value={parentID} onChange={setParentID} options={folderOptions(buildConnectionTree(folders, []))} placeholder={copy.noParent} invalid={Boolean(errors.parentID)} />
              <FieldError id="folder-parent-error">{errors.parentID}</FieldError>
            </Field>
          )}

          {state.mode === "move" ? null : <ColorField idPrefix="folder" legend={copy.color} name="color" color={folderColor} onChange={setFolderColor} error={errors.color} hint={copy.colorHint} />}

          {state.mode === "move" ? null : (
            <EnvironmentPicker
              idPrefix="folder"
              defaultName={state.mode === "edit" ? (state.folder.environmentName ?? "") : ""}
              color={color}
              onColorChange={setColor}
              errors={errors}
              hint={connectionsCopy.form.environment.folderHint}
              environments={userEnvironments(folders, connections.data ?? [])}
            />
          )}

          {/* RN-PROT-004: o que a pasta pai impõe (na nova, a escolhida no campo), marcado e desabilitado. */}
          {state.mode === "move" ? null : (
            <ProtectionsSection
              idPrefix="folder"
              subject="folder"
              confirm={confirm}
              onConfirmChange={setConfirm}
              readOnly={readOnly}
              onReadOnlyChange={setReadOnly}
              inherited={inheritedProtections(folders, state.mode === "create" ? (parentID === "" ? null : parentID) : state.folder.parentID)}
              errors={errors}
            />
          )}
        </form>
      </Dialog>

      {/* Fora do `<form>` e do diálogo: o `submit` do diálogo da senha não pode chegar ao formulário de baixo. */}
      {asking !== null && state.mode !== "create" ? (
        <UserPasswordDialog
          change={asking.change}
          send={(userPassword) => updateFolder(state.folder.id, asking.input, userPassword)}
          refusals={["FOLDER_NAME_INVALID"]}
          onDone={(result) => {
            setAsking(null);
            if (result === null) void invalidateLists(queryClient);
            else void settled(result);
          }}
          onClose={() => setAsking(null)}
        />
      ) : null}
    </>
  );
}
