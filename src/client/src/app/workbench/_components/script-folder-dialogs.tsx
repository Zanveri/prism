import type { FormEvent } from "react";

import { Button, Dialog, Field, FieldLabel, Select, TextField, type SelectOption } from "@/components/ui";

import { maxScriptFolderNameLength } from "../_lib/script-tree";
import { scriptsCopy } from "../_lib/scripts.copy";

const copy = scriptsCopy.folders;
const nameFormID = "script-folder-name-form";
const moveFormID = "script-move-form";

type ScriptFolderNameDialogProps = {
  /** "Nova pasta", "Nova subpasta" ou "Renomear pasta". */
  title: string;
  /** Onde a pasta nova vai ficar ("Na raiz da seção Scripts." ou "Dentro de Fechamento / Mensal."); o "Renomear" não diz. */
  place?: string;
  submitLabel: string;
  pendingLabel: string;
  /** Vazio na pasta nova; o nome atual no "Renomear". */
  initialName: string;
  pending: boolean;
  /** A recusa do nome, da conferência da tela ou da API, no campo (RN-SCRIPT-009). */
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

/**
 * RN-SCRIPT-009: "Nova pasta", "Nova subpasta" e o "Renomear" (F2) de uma pasta de scripts: só o nome, e, na pasta nova, onde ela vai ficar. Só desenha: quem
 * chama confere o nome, grava e diz o erro. Montado ao abrir e desmontado ao fechar, o que foi digitado não sobra para a próxima vez; enquanto grava, nada se
 * envia de novo nem fecha.
 */
export function ScriptFolderNameDialog({ title, place, submitLabel, pendingLabel, initialName, pending, error, onSubmit, onCancel }: ScriptFolderNameDialogProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const field = event.currentTarget.elements.namedItem("name");
    onSubmit(field !== null && "value" in field ? String(field.value) : "");
  }

  return (
    <Dialog
      open
      size="sm"
      title={title}
      description={place}
      pending={pending}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            {copy.cancel}
          </Button>
          <Button type="submit" form={nameFormID} disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
        </>
      }
    >
      <form id={nameFormID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField id="script-folder-name" name="name" label={copy.name} defaultValue={initialName} maxLength={maxScriptFolderNameLength} autoComplete="off" spellCheck={false} autoFocus onFocus={(event) => event.currentTarget.select()} error={error ?? undefined} />
      </form>
    </Dialog>
  );
}

type MoveToFolderDialogProps = {
  /** "Mover pasta" ou "Mover script". */
  title: string;
  /** O nome do que vai ser movido, para a frase "Escolha a pasta de destino de <nome>.". */
  name: string;
  /** A pasta escolhida no campo; vazio é "Sem pasta", a raiz. */
  value: string;
  /** As pastas, com o caminho inteiro, na ordem da árvore (`scriptFolderOptions`); a pasta que se move não traz ela mesma nem as subpastas dela. */
  options: SelectOption[];
  pending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
};

/**
 * RN-SCRIPT-009: o "Mover para…" de uma pasta ou de um script: o campo "Pasta", com "Sem pasta" (a raiz) e as pastas de scripts, com a de agora já escolhida.
 * Só desenha: quem chama guarda a escolha, grava e trata as recusas, que vão ao aviso de erro com o diálogo aberto.
 */
export function MoveToFolderDialog({ title, name, value, options, pending, onChange, onSubmit, onCancel }: MoveToFolderDialogProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending) onSubmit();
  }

  return (
    <Dialog
      open
      size="sm"
      title={title}
      description={copy.move.description(name)}
      pending={pending}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            {copy.cancel}
          </Button>
          <Button type="submit" form={moveFormID} disabled={pending}>
            {pending ? copy.move.submitting : copy.move.submit}
          </Button>
        </>
      }
    >
      <form id={moveFormID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Field>
          <FieldLabel htmlFor="script-move-folder">{copy.move.folder}</FieldLabel>
          <Select id="script-move-folder" value={value} onChange={onChange} options={options} placeholder={copy.move.noFolder} />
        </Field>
      </form>
    </Dialog>
  );
}
