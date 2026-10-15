import { useState, type FormEvent } from "react";

import { ColorField } from "@/app/connections/_components/color-field";
import { Button, Dialog, FieldError, Select, TextField, type SelectOption } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { EditScriptErrors } from "../_lib/edit-script-errors";
import { maxScriptNameLength, scriptIconOf, scriptIcons, type ScriptAppearance, type ScriptIcon } from "../_lib/saved-scripts";
import { scriptsCopy } from "../_lib/scripts.copy";
import { ScriptIconView } from "./script-icon";

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
  /**
   * RN-SCRIPT-005: a caixa "Script genérico (sem conexão)", na primeira vez e no "Salvar como" (renomear não a tem). `initial` é como ela nasce; `locked`, a
   * aba sem conexão, em que ela vem marcada e não se desmarca.
   */
  generic?: { initial: boolean; locked: boolean };
  /** O nome digitado e, com a caixa, se ela está marcada. */
  onSubmit: (name: string, generic: boolean) => void;
  onCancel: () => void;
};

/**
 * O nome de um script: salvar a primeira vez, "Salvar como" e renomear (RN-SCRIPT-001, 003 e 004), e, ao salvar, a caixa do script genérico (RN-SCRIPT-005).
 * Só desenha: quem chama confere o nome, grava e diz o erro. Montado ao abrir e desmontado ao fechar, o que foi digitado não sobra para a próxima vez. Enquanto
 * grava, nada se envia de novo nem fecha.
 */
export function ScriptNameDialog({ title, description = copy.save.description, submitLabel, pendingLabel, initialName, pending, error, generic, onSubmit, onCancel }: ScriptNameDialogProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const field = event.currentTarget.elements.namedItem("name");
    const box = event.currentTarget.elements.namedItem("generic");
    // A caixa presa (a aba sem conexão) vale marcada, como ela aparece.
    const isGeneric = generic !== undefined && (generic.locked || (box !== null && "checked" in box && box.checked === true));
    onSubmit(field !== null && "value" in field ? String(field.value) : "", isGeneric);
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
        {generic === undefined ? null : (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2.5 text-sm">
              <input type="checkbox" name="generic" defaultChecked={generic.initial || generic.locked} disabled={generic.locked} aria-describedby="script-generic-hint" className="m-0 size-[18px] flex-none cursor-pointer accent-accent disabled:cursor-not-allowed" />
              <span>{copy.save.generic}</span>
            </label>
            <p id="script-generic-hint" className="text-xs text-muted">
              {generic.locked ? copy.save.genericLocked : copy.save.genericHint}
            </p>
          </div>
        )}
      </form>
    </Dialog>
  );
}

const editFormID = "script-edit-form";
const iconErrorID = "script-icon-error";

type EditScriptDialogProps = {
  /** O script como a lista o tem: o nome, o ícone (nulo é o padrão) e a cor. */
  script: { name: string; icon: string | null; color: string | null };
  pending: boolean;
  /** As recusas no lugar: a do nome (da conferência da tela ou da API), a do ícone e a da cor (`SCRIPT_ICON_INVALID`, cada uma no campo dela). */
  errors: EditScriptErrors;
  onSubmit: (edited: ScriptAppearance) => void;
  onCancel: () => void;
};

/**
 * RN-SCRIPT-006: o "Editar script…" da seção "Scripts", com o nome, o ícone e a cor. O ícone sai da lista fechada (`scriptIcons`), cada um um botão com
 * `aria-pressed` e o nome dele na dica e no nome acessível, desenhado já com a cor escolhida, para a pessoa ver como fica; a cor é a fileira de bolinhas da
 * cor da pasta (`ColorField`: "Sem cor", as seis do canvas e "Outra cor"). Só desenha e guarda o que se escolheu: quem chama confere o nome, grava e diz o
 * erro. Montado ao abrir e desmontado ao fechar, nada sobra para a próxima vez; enquanto grava, nada se envia de novo nem fecha.
 */
export function EditScriptDialog({ script, pending, errors, onSubmit, onCancel }: EditScriptDialogProps) {
  const [icon, setIcon] = useState<ScriptIcon>(() => scriptIconOf(script));
  const [color, setColor] = useState<string | null>(script.color);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const field = event.currentTarget.elements.namedItem("name");
    onSubmit({ name: field !== null && "value" in field ? String(field.value) : "", icon, color });
  }

  return (
    <Dialog
      open
      size="sm"
      title={copy.edit.title}
      description={copy.edit.description}
      pending={pending}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            {copy.save.cancel}
          </Button>
          <Button type="submit" form={editFormID} disabled={pending}>
            {pending ? copy.edit.submitting : copy.edit.submit}
          </Button>
        </>
      }
    >
      <form id={editFormID} onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <TextField id="script-edit-name" name="name" label={copy.save.nameLabel} defaultValue={script.name} maxLength={maxScriptNameLength} autoComplete="off" spellCheck={false} autoFocus error={errors.name} />

        <fieldset className="m-0 min-w-0 border-0 p-0" aria-describedby={errors.icon === undefined ? undefined : iconErrorID}>
          <legend className="mb-2 p-0 text-sm text-muted">{copy.edit.icon}</legend>
          <div className="flex flex-wrap gap-2">
            {scriptIcons.map((option) => {
              const selected = option === icon;

              return (
                <button
                  key={option}
                  type="button"
                  aria-label={copy.icons[option]}
                  aria-pressed={selected}
                  title={copy.icons[option]}
                  onClick={() => setIcon(option)}
                  className={cn(
                    "inline-flex size-8 cursor-pointer items-center justify-center rounded-md border transition-colors",
                    selected ? "border-transparent bg-selected text-ink ring-2 ring-ink ring-offset-2 ring-offset-panel" : "border-border-strong bg-raised text-muted hover:text-ink",
                  )}
                >
                  <ScriptIconView icon={option} color={color} />
                </button>
              );
            })}
          </div>
          <FieldError id={iconErrorID}>{errors.icon}</FieldError>
        </fieldset>

        <ColorField idPrefix="script" legend={copy.edit.color} color={color} onChange={setColor} error={errors.color} />
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

/**
 * Por que a aba está sem conexão: o script cuja conexão não existe mais (RN-SCRIPT-003), o script genérico que abriu com mais de uma conexão conectada ou com
 * nenhuma (RN-SCRIPT-005), ou a aba que voltou na entrada sem a conexão dela (RN-ABAS-006). Cada um tem a frase dele.
 */
export type NoConnectionReason = "scriptMissing" | "generic" | "restored";

const reasonText: Record<NoConnectionReason, string> = { scriptMissing: copy.noConnection.description, generic: copy.noConnection.descriptionGeneric, restored: copy.noConnection.descriptionTab };

type NoConnectionBarViewProps = {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  onAssign: (connectionId: string) => void;
  reason: NoConnectionReason;
};

/**
 * RN-SCRIPT-003: a aba de um script cuja conexão não existe mais abre sem conexão, e esta faixa, acima do editor, pede uma. O texto já está no editor; nada
 * executa até a escolha, que dá à aba a sessão da conexão escolhida, no banco dela. O script genérico sem uma só conexão conectada (RN-SCRIPT-005) e a aba de
 * consulta que voltou na entrada sem a conexão dela (RN-ABAS-006) usam a mesma faixa. As opções vêm com as conectadas primeiro (quem as ordena é quem chama).
 */
export function NoConnectionBarView({ options, value, onChange, onAssign, reason }: NoConnectionBarViewProps) {
  return (
    <div role="region" aria-label={copy.noConnection.title} className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-raised px-3 py-2 text-sm">
      <p className="min-w-0 flex-1 text-body">{reasonText[reason]}</p>
      {options.length === 0 ? (
        <p className="text-muted">{copy.noConnection.none}</p>
      ) : (
        <div className="flex items-center gap-2">
          <Select value={value} onChange={onChange} options={options} placeholder={copy.noConnection.placeholder} aria-label={copy.noConnection.label} className="w-72" />
          <Button type="button" size="compact" onClick={() => onAssign(value)} disabled={value === ""} className="px-3">
            {copy.noConnection.use}
          </Button>
        </div>
      )}
    </div>
  );
}
