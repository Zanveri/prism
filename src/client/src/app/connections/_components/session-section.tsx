import type { ReactNode } from "react";

import { FieldError, type Engine } from "@/components/ui";
import { controlClassName } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";
import { fieldAria, type FieldErrors } from "@/lib/utils/form";

import { connectionsCopy } from "../_lib/connections.copy";
import { engineOption, type ConnectionVerification } from "../_lib/connections.schema";

const copy = connectionsCopy.session;

export type SessionSectionProps = {
  /** O começo dos ids ("cx" no formulário da conexão), como nas seções Ambiente e Proteções. */
  idPrefix: string;
  /** O banco escolhido no formulário: a consulta dele é a dica do campo (RN-CONN-013); sem banco ainda, nenhuma. */
  engine: Engine | null;
  /** A verificação gravada (na conexão nova, a padrão): os campos nascem com ela. */
  saved: ConnectionVerification;
  /** "Verificar a cada" ligada: estado de quem abre a seção, que vai ao `FormData` pelo campo escondido `verificationEnabled`. */
  verifying: boolean;
  onVerifyingChange: (verifying: boolean) => void;
  /** O indicador da última verificação da conexão aberta, à direita da linha, como no canvas; sem ele, nada. */
  indicator?: ReactNode;
  errors: FieldErrors;
};

/**
 * O painel "Sessão da conexão" (RN-VERIF-001), no formulário da conexão, como no canvas (`Conexoes.dc.html`): "Verificar a cada [N] segundos", ligada por
 * padrão, e a "Consulta de verificação", que no canvas é fixa e aqui é um campo opcional, com a consulta do banco escolhido como dica (seção 9). O
 * "Encerrar a conexão após N minutos sem uso" do canvas não aparece: o encerramento por ociosidade continua fora (seção 13).
 *
 * O intervalo e a consulta são campos não controlados, lidos pelo `FormData` (`verificationInterval` e `verificationQuery`); a caixa é do diálogo, e vai pelo
 * campo escondido, como o somente leitura. As recusas da API (o intervalo fora da faixa, a consulta que não é uma leitura só, com o motivo) aparecem embaixo
 * de cada campo.
 */
export function SessionSection({ idPrefix, engine, saved, verifying, onVerifyingChange, indicator, errors }: SessionSectionProps) {
  const intervalId = `${idPrefix}-verification-interval`;
  const queryId = `${idPrefix}-verification-query`;
  const queryHintId = `${queryId}-hint`;
  const queryAria = fieldAria(queryId, errors.verificationQuery);

  return (
    <section aria-labelledby={`${idPrefix}-session-title`} className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4">
      {/* h3: o título do diálogo é o h2 (RN-NAV-004), como nas seções Ambiente e Proteções. */}
      <h3 id={`${idPrefix}-session-title`} className="text-base leading-5 font-semibold">
        {copy.title}
      </h3>
      <input type="hidden" name="verificationEnabled" value={String(verifying)} />

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <input
          id={`${idPrefix}-verify`}
          type="checkbox"
          checked={verifying}
          onChange={(event) => onVerifyingChange(event.target.checked)}
          className="m-0 size-[18px] flex-none cursor-pointer accent-accent"
        />
        <label htmlFor={`${idPrefix}-verify`} className="cursor-pointer text-ink">
          {copy.verify}
        </label>
        <input
          id={intervalId}
          name="verificationInterval"
          type="text"
          inputMode="numeric"
          defaultValue={String(saved.verificationInterval)}
          autoComplete="off"
          aria-label={copy.interval}
          {...fieldAria(intervalId, errors.verificationInterval)}
          className={cn(controlClassName, "h-9 w-[88px] px-2.5 font-mono text-sm")}
        />
        <span>{copy.seconds}</span>
        {indicator === undefined ? null : <span className="ml-auto flex items-center gap-1.5 text-xs text-muted">{indicator}</span>}
      </div>
      <FieldError id={`${intervalId}-error`}>{errors.verificationInterval}</FieldError>
      <p className="text-xs leading-[18px] text-muted">{copy.hint}</p>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={queryId} className="text-sm text-muted">
          {copy.query}
        </label>
        <textarea
          id={queryId}
          name="verificationQuery"
          rows={2}
          defaultValue={saved.verificationQuery ?? ""}
          placeholder={engine === null ? undefined : engineOption(engine).verificationQuery}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          {...queryAria}
          aria-describedby={queryAria["aria-describedby"] === undefined ? queryHintId : `${queryAria["aria-describedby"]} ${queryHintId}`}
          className={cn(controlClassName, "h-auto min-h-16 resize-y py-2 font-mono text-sm")}
        />
        <FieldError id={`${queryId}-error`}>{errors.verificationQuery}</FieldError>
        <p id={queryHintId} className="text-xs leading-[18px] text-muted">
          {copy.queryHint}
        </p>
      </div>
    </section>
  );
}
