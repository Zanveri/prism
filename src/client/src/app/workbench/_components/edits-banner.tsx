import { useEffect, useState } from "react";

import { AlertIcon, Button, LockIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { dataImportCopy } from "../_lib/data-import/data-import.copy";
import type { SaveFailure } from "../_lib/record-edits";
import { gridSelectionCopy } from "../_lib/grid-selection.copy";
import { multiEditCopy } from "../_lib/multi-edit.copy";
import { recordsCopy } from "../_lib/records.copy";

const copy = recordsCopy.edit;

/** RN-EDIT-021: depois de quanto tempo o "Salvando…" passa a dizer quanto já levou ("Salvando… 12 s"). */
export const savingClockAfterMs = 2_000;

/** O texto do "Salvando…": passados 2 segundos, com o tempo, em segundos inteiros. */
export function savingLabel(since: number | null, now: number): string {
  if (since === null || now - since < savingClockAfterMs) return copy.saving;
  return multiEditCopy.savingFor(Math.floor((now - since) / 1000));
}

/** O "Salvando…" com o relógio, que se redesenha a cada segundo enquanto o "Salvar" roda. */
function SavingText({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return <>{savingLabel(since, now)}</>;
}

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
  /**
   * `warning`: o recado não é um motivo de só leitura, e vem com o triângulo de atenção no lugar do cadeado: o que "Duplicar linha" avisa (a chave
   * copiada, as colunas que ficaram de fora) e por que ele não duplicou (RN-EDIT-016).
   */
  noticeTone?: "lock" | "warning";
  /** O último Salvar recusado, com a mensagem do banco como veio. */
  failure: SaveFailure | null;
  /** RN-SQL-017: copiar ou exportar está buscando na API o valor completo das células cortadas; "Cancelar" desiste, e a grade segue livre. */
  fetching: boolean;
  /** RN-GRADE-002: a cópia de uma seleção grande ainda monta o texto, passado meio segundo: "Copiando…", com o mesmo "Cancelar", que desiste dela. */
  copying?: boolean;
  /**
   * RN-GRADE-023: o copiar ou o "Copiar número de linha(s)" das colunas inteiras carregando as linhas que faltam ("Carregando as linhas que faltam… 1.400
   * linhas"), com o mesmo "Cancelar", que para de carregar sem copiar nada; nulo sem isso.
   */
  loading?: string | null;
  onCancelFetch: () => void;
  /** RN-EDIT-018: a linha das colunas inteiras, embaixo da contagem ("Em todas as linhas do resultado: preco = 10.00."); nula sem elas. */
  wholeLine?: string | null;
  /**
   * RN-EDIT-017: o grupo de células grande que está sendo montado ("Aplicando o valor a 100.000 células…"), com o "Cancelar", que não deixa nenhuma célula
   * alterada (`onCancelBuild`); enquanto isso, "Ver SQL", "Descartar" e "Salvar" esperam (desabilitados, com o motivo). Nulo sem montagem.
   */
  building?: string | null;
  onCancelBuild?: () => void;
  /**
   * RN-EDIT-019 e 021: o "Salvar" com a coluna inteira contando as linhas ("Contando as linhas do resultado…"), e qualquer "Salvar" em andamento
   * (`savingSince`, para o relógio); o "Cancelar" dos dois pede ao banco o cancelamento do comando (`onCancelSave`). `asking`: a pergunta está aberta, e os
   * botões esperam a resposta.
   */
  counting?: boolean;
  asking?: boolean;
  savingSince?: number | null;
  onCancelSave?: () => void;
  /**
   * RN-IMPORT-020: a tabela recebeu linhas de uma importação depois da leitura que está na tela; a faixa diz isso, com "Atualizar" (o da aba, que pergunta
   * pelas alterações não salvas, RN-EDIT-007). Nulo (ou ausente) sem a nota.
   */
  onImportedRefresh?: (() => void) | null;
  onViewSql: () => void;
  onDiscard: () => void;
  onSave: () => void;
};

/**
 * A faixa sobre a grade dos Registros (RN-EDIT-004, 005 e 012): "N alterações não salvas" com "Ver SQL", "Descartar" e "Salvar"; no
 * banco sem log, o aviso de que cada alteração é gravada sozinha; o erro do último Salvar (a frase de cima e a mensagem do banco, como
 * veio, que fica até o próximo Salvar ou o Descartar); o motivo de só leitura; e a nota das linhas importadas depois da leitura (RN-IMPORT-020). É estado
 * da tela, e não aviso (RN-AVISO-005). Sem nada disso, não aparece.
 */
export function EditsBanner({
  pending,
  oneAtATime,
  saving,
  readOnly,
  notice,
  noticeTone = "lock",
  failure,
  fetching,
  copying = false,
  loading = null,
  onCancelFetch,
  wholeLine = null,
  building = null,
  onCancelBuild,
  counting = false,
  asking = false,
  savingSince = null,
  onCancelSave,
  onImportedRefresh = null,
  onViewSql,
  onDiscard,
  onSave,
}: EditsBannerProps) {
  if (pending === 0 && failure === null && readOnly === null && notice === null && !fetching && !copying && loading === null && onImportedRefresh === null && building === null && !counting) return null;
  // Os botões das pendências esperam: o "Salvar" (da contagem à resposta) e a montagem de um grupo de células.
  const waiting = saving || counting || asking || building !== null;
  const waitingTitle = building !== null ? multiEditCopy.applyingBusy : undefined;

  return (
    <div className="flex flex-none flex-col gap-1.5 border-b border-border bg-raised px-3 py-1.5 text-xs">
      {loading !== null || fetching || copying ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span aria-hidden className="size-2 flex-none animate-pulse rounded-full bg-accent" />
          <span role="status" className="text-ink">
            {loading ?? (fetching ? copy.fullValues.fetching : gridSelectionCopy.copy.copying)}
          </span>
          <Button type="button" variant="secondary" size="compact" className="ml-auto h-7 px-2.5 text-xs" onClick={onCancelFetch}>
            {copy.fullValues.cancel}
          </Button>
        </div>
      ) : null}
      {building === null ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span aria-hidden className="size-2 flex-none animate-pulse rounded-full bg-accent" />
          <span role="status" className="text-ink">
            {building}
          </span>
          <Button type="button" variant="secondary" size="compact" className="ml-auto h-7 px-2.5 text-xs" onClick={onCancelBuild}>
            {multiEditCopy.cancel}
          </Button>
        </div>
      )}
      {counting || (saving && onCancelSave !== undefined) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span aria-hidden className="size-2 flex-none animate-pulse rounded-full bg-accent" />
          <span role="status" className="text-ink">
            {counting ? multiEditCopy.counting : <SavingText since={savingSince} />}
          </span>
          <Button type="button" variant="secondary" size="compact" className="ml-auto h-7 px-2.5 text-xs" onClick={onCancelSave}>
            {multiEditCopy.cancel}
          </Button>
        </div>
      ) : null}
      {onImportedRefresh === null ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span aria-hidden className="size-2 flex-none rounded-full bg-accent" />
          <span role="status" className="text-ink">
            {dataImportCopy.records.imported}
          </span>
          <Button type="button" variant="secondary" size="compact" className="ml-auto h-7 px-2.5 text-xs" onClick={onImportedRefresh} disabled={saving}>
            {dataImportCopy.records.refresh}
          </Button>
        </div>
      )}
      {pending === 0 ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span aria-hidden className="size-2 flex-none rounded-full bg-accent" />
          <span role="status" className="font-medium text-ink">
            {copy.pending(pending)}
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onViewSql} disabled={waiting} title={waitingTitle}>
              {copy.viewSql}
            </Button>
            <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onDiscard} disabled={waiting} title={waitingTitle}>
              {copy.discard}
            </Button>
            <Button type="button" variant="primary" size="compact" className="h-7 px-2.5 text-xs" onClick={onSave} disabled={waiting} title={waitingTitle ?? copy.saveHint}>
              {saving ? <SavingText since={savingSince} /> : copy.save}
            </Button>
          </span>
        </div>
      )}
      {pending === 0 || wholeLine === null ? null : <p className="text-ink">{wholeLine}</p>}
      {pending > 0 && oneAtATime ? <p className="text-muted">{wholeLine === null ? copy.oneAtATime : `${copy.oneAtATime} ${multiEditCopy.oneAtATime}`}</p> : null}
      {failure === null ? null : (
        <div role="alert" className="flex flex-col gap-1">
          <p className="font-semibold text-danger">{failure.headline}</p>
          {failure.detail === null ? null : <pre className="font-mono break-words whitespace-pre-wrap text-ink">{failure.detail}</pre>}
        </div>
      )}
      {readOnly === null && notice === null ? null : (
        <p role="status" className={cn("flex items-center gap-1.5", notice !== null && noticeTone === "warning" ? "text-ink" : "text-muted")}>
          {notice !== null && noticeTone === "warning" ? <AlertIcon aria-hidden className="size-3.5 flex-none text-accent" /> : <LockIcon aria-hidden className="size-3.5 flex-none" />}
          <span>{notice ?? readOnly}</span>
        </p>
      )}
    </div>
  );
}
