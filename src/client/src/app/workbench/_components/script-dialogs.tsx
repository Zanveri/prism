import { type FormEvent } from "react";

import { Button, Dialog, Select, TextField, type SelectOption } from "@/components/ui";

import { maxScriptNameLength } from "../_lib/saved-scripts";
import { scriptsCopy } from "../_lib/scripts.copy";

const copy = scriptsCopy;
const formID = "script-name-form";

type ScriptNameDialogProps = {
  title: string;
  description?: string;
  submitLabel: string;
  pendingLabel: string;
  /** A sugestão (RN-SCRIPT-001: "Script 1", "Script 2"…), ou o nome atual ao renomear. */
  initialName: string;
  pending: boolean;
  /** A recusa do nome ou do tamanho, da conferência da tela ou da API, no campo. */
  error: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
};

/**
 * O nome de um script: salvar a primeira vez, "Salvar como" e renomear (RN-SCRIPT-001, 003 e 004). Só desenha: quem chama confere o nome, grava e diz o erro.
 * Montado ao abrir e desmontado ao fechar, o que foi digitado não sobra para a próxima vez. Enquanto grava, nada se envia de novo nem fecha.
 */
export function ScriptNameDialog({ title, description = copy.save.description, submitLabel, pendingLabel, initialName, pending, error, onSubmit, onCancel }: ScriptNameDialogProps) {
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
      description={description}
      pending={pending}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            {copy.save.cancel}
          </Button>
          <Button type="submit" form={formID} disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
        </>
      }
    >
      <form id={formID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField id="script-name" name="name" label={copy.save.nameLabel} defaultValue={initialName} maxLength={maxScriptNameLength} autoComplete="off" spellCheck={false} autoFocus onFocus={(event) => event.currentTarget.select()} error={error ?? undefined} />
      </form>
    </Dialog>
  );
}

type UnsavedScriptsDialogProps = {
  /** Os nomes dos scripts com mudança não salva entre as abas que vão fechar, na ordem da faixa. */
  names: string[];
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
};

/**
 * RN-SCRIPT-001: fechar a aba de um script com mudança não salva pergunta se salva. Um script: Salvar, Descartar e Cancelar; vários (fechar todas, fechar a
 * janela): Salvar todos, Descartar e Cancelar. O foco nasce em "Cancelar", como no `ConfirmDialog`: um Enter solto não joga fora o trabalho de ninguém.
 */
export function UnsavedScriptsDialog({ names, saving, onSave, onDiscard, onCancel }: UnsavedScriptsDialogProps) {
  const one = names.length === 1;

  return (
    <Dialog
      open
      role="alertdialog"
      title={one ? copy.unsaved.titleOne(names[0]) : copy.unsaved.titleMany(names.length)}
      description={one ? copy.unsaved.descriptionOne : copy.unsaved.descriptionMany(names)}
      pending={saving}
      onClose={onCancel}
      footer={
        <>
          <Button autoFocus type="button" variant="secondary" onClick={onCancel} disabled={saving}>
            {copy.unsaved.cancel}
          </Button>
          <Button type="button" variant="danger" onClick={onDiscard} disabled={saving}>
            {copy.unsaved.discard}
          </Button>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving ? copy.unsaved.saving : one ? copy.unsaved.save : copy.unsaved.saveMany}
          </Button>
        </>
      }
    />
  );
}

type NoConnectionBarViewProps = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  onAssign: (connectionId: string) => void;
};

/**
 * RN-SCRIPT-003: a aba de um script cuja conexão não existe mais abre sem conexão, e esta faixa, acima do editor, pede uma. O texto já está no editor; nada
 * executa até a escolha, que dá à aba a sessão da conexão escolhida, no banco dela.
 */
export function NoConnectionBarView({ options, value, onChange, onAssign }: NoConnectionBarViewProps) {
  return (
    <div role="region" aria-label={copy.noConnection.title} className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-raised px-3 py-2 text-sm">
      <p className="min-w-0 flex-1 text-body">{copy.noConnection.description}</p>
      {options.length === 0 ? (
        <p className="text-muted">{copy.noConnection.none}</p>
      ) : (
        <div className="flex items-center gap-2">
          <Select value={value} onChange={onChange} options={options} placeholder={copy.noConnection.placeholder} aria-label={copy.noConnection.label} className="w-56" />
          <Button type="button" size="compact" onClick={() => onAssign(value)} disabled={value === ""} className="px-3">
            {copy.noConnection.use}
          </Button>
        </div>
      )}
    </div>
  );
}
