import { FieldError, LockIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import { confirmationChoices, confirmationRank, type ConfirmationChoice, type InheritedProtections } from "../_lib/protections";

const copy = connectionsCopy.protections;

export type ProtectionsSectionProps = {
  /** O começo dos ids ("cx" na conexão, "folder" na pasta), como na seção Ambiente. */
  idPrefix: string;
  /** De quem são as proteções: as frases de ajuda e a de por que a herdada não se afrouxa mudam. */
  subject: "connection" | "folder";
  /** A confirmação PRÓPRIA (RN-PROT-001), a que vai gravada; a que aparece escolhida é a mais forte entre ela e a herdada. */
  confirm: ConfirmationChoice;
  onConfirmChange: (confirm: ConfirmationChoice) => void;
  /** O somente leitura PRÓPRIO (RN-PROT-002); o herdado aparece marcado e desabilitado, e não é gravado aqui. */
  readOnly: boolean;
  onReadOnlyChange: (readOnly: boolean) => void;
  /** O que a pasta de cima impõe (RN-PROT-004): na conexão, a pasta escolhida no campo; na pasta, a pasta pai. */
  inherited: InheritedProtections;
  errors: FieldErrors;
};

/**
 * A seção "Proteções" (RN-PROT-001 a 004), a mesma no formulário da conexão e nos diálogos de nova pasta e de "Editar pasta…", depois da seção Ambiente,
 * como no canvas: "Confirmar antes de executar", com as três escolhas no lugar da caixa do canvas (seção 9), e "Somente leitura", com o cadeado.
 *
 * As escolhas próprias são estado de quem abre a seção e vão ao `FormData` por dois campos escondidos (`confirmCommands` e `readOnly`); os controles
 * mostram o que VALE. A proteção que a pasta de cima impõe não se afrouxa aqui (RN-PROT-004): o somente leitura herdado aparece marcado e desabilitado, e
 * as escolhas da confirmação abaixo da herdada ficam desabilitadas, as duas com "Herdado da pasta X" e a frase que diz por quê. A herdada não é gravada como
 * própria: tirar a conexão (ou a pasta) dali tira a proteção junto, e o que ela tinha de próprio continua.
 */
export function ProtectionsSection({ idPrefix, subject, confirm, onConfirmChange, readOnly, onReadOnlyChange, inherited, errors }: ProtectionsSectionProps) {
  const inheritedConfirm = inherited.confirm;
  const shownConfirm = inheritedConfirm !== null && confirmationRank(inheritedConfirm.level) > confirmationRank(confirm) ? inheritedConfirm.level : confirm;
  const readOnlyFolder = inherited.readOnly;
  const cannotLoosen = subject === "connection" ? copy.connectionCannotLoosen : copy.folderCannotLoosen;
  const confirmHintId = `${idPrefix}-confirm-commands-hint`;
  const confirmInheritedId = `${idPrefix}-confirm-commands-inherited`;
  const readOnlyHintId = `${idPrefix}-read-only-hint`;
  const readOnlyInheritedId = `${idPrefix}-read-only-inherited`;

  return (
    <section aria-labelledby={`${idPrefix}-protections-title`} className="flex flex-col gap-3.5 rounded-lg border border-border bg-panel p-4">
      {/* h3: o título do diálogo é o h2 (RN-NAV-004), como na seção Ambiente. */}
      <h3 id={`${idPrefix}-protections-title`} className="text-base leading-5 font-semibold">
        {copy.title}
      </h3>
      <input type="hidden" name="confirmCommands" value={confirm} />
      <input type="hidden" name="readOnly" value={String(readOnly)} />

      <fieldset aria-describedby={inheritedConfirm === null ? confirmHintId : `${confirmInheritedId} ${confirmHintId}`} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <legend className="mb-2 p-0 font-medium text-ink">{copy.confirm.legend}</legend>
        {confirmationChoices.map((choice) => {
          const below = inheritedConfirm !== null && confirmationRank(choice) < confirmationRank(inheritedConfirm.level);

          return (
            <label key={choice} className={cn("flex w-fit items-center gap-2.5", below ? "cursor-not-allowed text-subtle" : "cursor-pointer text-ink")}>
              <input
                type="radio"
                name={`${idPrefix}-confirm-commands-choice`}
                value={choice}
                checked={shownConfirm === choice}
                disabled={below}
                onChange={() => onConfirmChange(choice)}
                className="m-0 size-4 flex-none cursor-pointer accent-accent disabled:cursor-not-allowed"
              />
              <span>{copy.confirm.choices[choice]}</span>
              {inheritedConfirm !== null && choice === inheritedConfirm.level ? <span className="text-xs text-muted">{copy.inheritedFrom(inheritedConfirm.folder.name)}</span> : null}
            </label>
          );
        })}
        {inheritedConfirm === null ? null : (
          <p id={confirmInheritedId} className="text-xs text-body">
            {cannotLoosen(inheritedConfirm.folder.name)}
          </p>
        )}
        <p id={confirmHintId} className="text-xs text-muted">
          {subject === "connection" ? copy.confirm.connectionHint : copy.confirm.folderHint}
        </p>
        <FieldError id={`${idPrefix}-confirm-commands-error`}>{errors.confirmCommands}</FieldError>
      </fieldset>

      <div className="flex items-start gap-2.5 border-t border-border pt-3.5">
        <input
          id={`${idPrefix}-read-only`}
          type="checkbox"
          checked={readOnly || readOnlyFolder !== null}
          disabled={readOnlyFolder !== null}
          onChange={(event) => onReadOnlyChange(event.target.checked)}
          aria-describedby={readOnlyFolder === null ? readOnlyHintId : `${readOnlyInheritedId} ${readOnlyHintId}`}
          className="m-0 mt-[2px] size-[18px] flex-none cursor-pointer accent-accent disabled:cursor-not-allowed"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${idPrefix}-read-only`} className={cn("flex w-fit items-center gap-1.5 font-medium", readOnlyFolder === null ? "cursor-pointer text-ink" : "cursor-not-allowed text-subtle")}>
            <span>{copy.readOnly.label}</span>
            <LockIcon className="flex-none text-muted" />
          </label>
          {readOnlyFolder === null ? null : (
            <span id={readOnlyInheritedId} className="text-xs text-body">
              {`${copy.inheritedFrom(readOnlyFolder.name)}. ${cannotLoosen(readOnlyFolder.name)}`}
            </span>
          )}
          <span id={readOnlyHintId} className="text-xs text-muted">
            {subject === "connection" ? copy.readOnly.connectionHint : copy.readOnly.folderHint}
          </span>
          <FieldError id={`${idPrefix}-read-only-error`}>{errors.readOnly}</FieldError>
        </div>
      </div>
    </section>
  );
}
