import { Button, LockIcon } from "@/components/ui";

import type { SaveFailure } from "../_lib/record-edits";
import { recordsCopy } from "../_lib/records.copy";

const copy = recordsCopy.edit;

type EditsBannerProps = {
  /** RN-EDIT-004: as alterações não salvas (uma por comando do Salvar). */
  pending: number;
  /** RN-EDIT-012: o banco não tem log de transação. */
  oneAtATime: boolean;
  saving: boolean;
  /** RN-EDIT-002: o motivo de só leitura, à vista, já na frase ("Somente leitura: …"). */
  readOnly: string | null;
  /** O que a última tentativa disse e não é erro: o motivo de a célula não se editar, a conferência do catálogo em andamento. */
  notice: string | null;
  /** O último Salvar recusado, com a mensagem do banco como veio. */
  failure: SaveFailure | null;
  onViewSql: () => void;
  onDiscard: () => void;
  onSave: () => void;
};

/**
 * A faixa sobre a grade dos Registros (RN-EDIT-004, 005 e 012): "N alterações não salvas" com "Ver SQL", "Descartar" e "Salvar"; no
 * banco sem log, o aviso de que cada alteração é gravada sozinha; o erro do último Salvar (a frase de cima e a mensagem do banco, como
 * veio, que fica até o próximo Salvar ou o Descartar); e o motivo de só leitura. É estado da tela, e não aviso (RN-AVISO-005). Sem
 * nada disso, não aparece.
 */
export function EditsBanner({ pending, oneAtATime, saving, readOnly, notice, failure, onViewSql, onDiscard, onSave }: EditsBannerProps) {
  if (pending === 0 && failure === null && readOnly === null && notice === null) return null;

  return (
    <div className="flex flex-none flex-col gap-1.5 border-b border-border bg-raised px-3 py-1.5 text-xs">
      {pending === 0 ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span aria-hidden className="size-2 flex-none rounded-full bg-accent" />
          <span role="status" className="font-medium text-ink">
            {copy.pending(pending)}
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onViewSql} disabled={saving}>
              {copy.viewSql}
            </Button>
            <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onDiscard} disabled={saving}>
              {copy.discard}
            </Button>
            <Button type="button" variant="primary" size="compact" className="h-7 px-2.5 text-xs" onClick={onSave} disabled={saving} title={copy.saveHint}>
              {saving ? copy.saving : copy.save}
            </Button>
          </span>
        </div>
      )}
      {pending > 0 && oneAtATime ? <p className="text-muted">{copy.oneAtATime}</p> : null}
      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="font-semibold text-danger">{failure.headline}</p>
          {failure.detail === null ? null : <pre className="font-mono break-words whitespace-pre-wrap text-ink">{failure.detail}</pre>}
        </div>
      )}
      {readOnly === null && notice === null ? null : (
        <p role="status" className="flex items-center gap-1.5 text-muted">
          <LockIcon aria-hidden className="size-3.5 flex-none" />
          <span>{notice ?? readOnly}</span>
        </p>
      )}
    </div>
  );
}
