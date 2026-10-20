import { useId, type ReactNode } from "react";

import { Button, Dialog, FieldError, FormMessage, type Engine } from "@/components/ui";
import { Field, FieldLabel, Input } from "@/components/ui/field";
import { cn } from "@/lib/utils/cn";

import { generateSqlCopy } from "../../_lib/generate-sql/generate-sql.copy";
import { targetNameProblem } from "../../_lib/generate-sql/sql-plan";
import type { GenerateSqlDialogProps } from "../../_lib/generate-sql/use-generate-sql";
import { CheckboxRow } from "../data-export/export-wizard-steps";
import { SqlViewer } from "./sql-viewer";

const copy = generateSqlCopy.dialog;

/**
 * O diálogo "Gerar SQL" (RN-GRADE-018), como o "Generated SQL" do DBeaver: o diálogo grande, com o que se gera embaixo do título e a conexão ao lado (o
 * `connection`, a linha do assistente da exportação: a etiqueta do banco, a conexão, o banco de dados, o ambiente e o cadeado do somente leitura); as
 * "Opções" que o item tem; no INSERT da tabela que o Prism não conhece, a tabela de destino; os avisos; e o SQL num editor só de leitura, ou a frase que diz o
 * que acontece no lugar dele. No rodapé, "Fechar" à esquerda, e "Abrir numa aba de consulta" e "Copiar", o principal, à direita, só com o texto pronto.
 * "Fechar", Esc e o X fecham sem perguntar.
 */
export function GenerateSqlDialog({ dialog, engine, connection }: { dialog: GenerateSqlDialogProps; engine: Engine; connection?: ReactNode }) {
  const { view, options } = dialog;
  const idPrefix = useId();
  const target = options.target ?? { schema: "", name: "" };
  const schemaProblem = view.targetFields ? targetNameProblem(target.schema, false) : null;
  const tableProblem = view.targetFields && target.name !== "" ? targetNameProblem(target.name, true) : null;
  const anyOption = view.shown.qualified || view.shown.compact || view.shown.excludeGenerated;

  const header = (
    <div className="flex flex-col gap-1.5">
      <span className="text-body">{view.subtitle}</span>
      {connection}
    </div>
  );

  const footer = (
    <>
      <Button type="button" variant="secondary" className="mr-auto" onClick={dialog.onClose}>
        {copy.close}
      </Button>
      <Button type="button" variant="secondary" disabled={!view.canOutput} onClick={dialog.onOpenInTab}>
        {copy.openInTab}
      </Button>
      <Button type="button" disabled={!view.canOutput} onClick={dialog.onCopy}>
        {copy.copy}
      </Button>
    </>
  );

  return (
    <Dialog open size="lg" title={copy.title} description={header} onClose={dialog.onClose} footer={footer}>
      <div className="flex flex-col gap-4">
        {anyOption ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink">{copy.options}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {view.shown.qualified ? <CheckboxRow label={copy.qualified} checked={options.qualified} onChange={(qualified) => dialog.onOption({ qualified })} /> : null}
              {view.shown.compact ? <CheckboxRow label={copy.compact} checked={options.compact} onChange={(compact) => dialog.onOption({ compact })} /> : null}
              {view.shown.excludeGenerated ? <CheckboxRow label={copy.excludeGenerated} checked={options.excludeGenerated} onChange={(excludeGenerated) => dialog.onOption({ excludeGenerated })} /> : null}
            </div>
          </fieldset>
        ) : null}

        {view.targetFields ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-ink">{copy.target}</legend>
            <div className="grid grid-cols-2 gap-3">
              <TargetField id={`${idPrefix}-schema`} label={copy.schema} hint={copy.schemaHint} value={target.schema} problem={schemaProblem} onChange={(schema) => dialog.onTarget({ ...target, schema })} />
              <TargetField id={`${idPrefix}-table`} label={copy.table} value={target.name} problem={tableProblem} required onChange={(name) => dialog.onTarget({ ...target, name })} />
            </div>
          </fieldset>
        ) : null}

        {view.warnings.length === 0 ? null : (
          <div className="flex flex-col gap-2">
            {view.warnings.map((warning) => (
              <FormMessage key={warning} tone="warning">
                {warning}
              </FormMessage>
            ))}
          </div>
        )}

        <SqlPlace dialog={dialog} engine={engine} />
      </div>
    </Dialog>
  );
}

/** Um campo da tabela de destino: os nomes como estão no banco (o Prism põe as aspas), com o motivo de recusa embaixo. */
function TargetField({ id, label, hint, value, problem, required = false, onChange }: { id: string; label: string; hint?: string; value: string; problem: string | null; required?: boolean; onChange: (value: string) => void }) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, problem === null ? null : errorId].filter((part) => part !== null).join(" ");
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} required={required} spellCheck={false} autoComplete="off" aria-invalid={problem !== null} aria-describedby={describedBy === "" ? undefined : describedBy} onChange={(event) => onChange(event.target.value)} />
      {hint === undefined ? null : (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      <FieldError id={errorId}>{problem}</FieldError>
    </Field>
  );
}

/** O lugar do SQL: o editor só de leitura com o texto, ou a frase que diz o que acontece, o motivo de não haver texto, ou a falha com "Tentar de novo". */
function SqlPlace({ dialog, engine }: { dialog: GenerateSqlDialogProps; engine: Engine }) {
  const { body } = dialog.view;
  const box = "flex min-h-32 flex-col items-start justify-center gap-3 rounded-md border border-border bg-background px-4 py-3 text-sm";

  switch (body.kind) {
    case "text":
      return <SqlViewer text={body.text} engine={engine} label={copy.sqlLabel} autoFocus={!dialog.view.targetFields} />;
    case "status":
      return (
        <div className={cn(box, "text-muted")} aria-busy="true">
          <p role="status">{body.text}</p>
          {body.cancel ? (
            <Button type="button" variant="secondary" size="compact" onClick={dialog.onClose}>
              {copy.cancel}
            </Button>
          ) : null}
        </div>
      );
    case "refused":
      return (
        <div className={cn(box, "text-body")}>
          <p role="status">{body.text}</p>
        </div>
      );
    case "failed":
      return (
        <div className={box}>
          <FormMessage tone="error" className="w-full">
            <p className="font-semibold">{body.title}</p>
            {body.message === null ? null : <p className="mt-1 break-words whitespace-pre-wrap">{body.message}</p>}
          </FormMessage>
          <Button type="button" variant="secondary" size="compact" onClick={dialog.onRetry}>
            {copy.retry}
          </Button>
        </div>
      );
  }
}
