import { useEffect, useId, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";

import { AlertIcon, Button, CloseIcon, controlClassName, Dialog, FieldError, useHost } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { columnChoiceOf, missingMessage, missingValues, type Choice, type ChoiceScope } from "../_lib/value-choice";
import { answersOf, emptyInput, fieldLabel, inputOf, pastedItems, type FieldInput, type ValuesQuestion, type VariableField } from "../_lib/variable-fields";
import { variableFieldsCopy as copy } from "../_lib/variable-fields.copy";
import type { Value } from "../_lib/variables/values";
import { ValueChoice } from "./value-choice";

type ValuesDialogProps = {
  question: ValuesQuestion;
  /** A sessão da árvore da conexão e do banco da aba, para a escolha pela chave (RN-VAR-031); nula na aba sem conexão. */
  scope: ChoiceScope | null;
  onRun: (answers: ReadonlyMap<number, Value>) => void;
  onCancel: () => void;
};

/**
 * RN-VAR-021: "Valores para executar", o diálogo do "Executar com valores…" (RN-VAR-027) no modo reduzido: só os campos das declarações sem valor, sem "Onde". O foco
 * começa no primeiro campo; Enter executa quando os campos estão certos; Esc cancela, e nada roda.
 */
export function ValuesDialog({ question, scope, onRun, onCancel }: ValuesDialogProps) {
  const base = useId();
  const host = useHost();
  const { fields } = question;
  const [inputs, setInputs] = useState(() => new Map(fields.map((field) => [field.index, inputOf(question.tab.get(field.name)?.value)] as const)));
  const [problems, setProblems] = useState<ReadonlyMap<number, string>>(new Map());
  const [warnings, setWarnings] = useState<ReadonlyMap<number, string>>(new Map());
  const [choices, setChoices] = useState<ReadonlyMap<number, Choice>>(new Map());
  const [pending, setPending] = useState(false);

  // RN-VAR-030: o tipo de coluna diz a coluna, e o catálogo dela diz de onde vêm os valores.
  useEffect(() => {
    if (scope === null) return;
    let live = true;
    for (const field of fields) {
      const read = field.column === null ? undefined : question.reads?.get(field.column);
      if (read?.ok !== true) continue;
      const written = /^(?:"[^"]*"|[^."]+)\.(?:"[^"]*"|[^."]+)\./.test(field.column ?? "");
      void columnChoiceOf(scope, read, written).then((choice) => {
        if (live && choice !== null) setChoices((current) => new Map(current).set(field.index, choice));
      });
    }
    return () => {
      live = false;
    };
  }, [fields, question.reads, scope]);

  const idOf = (field: VariableField) => `${base}-${field.index}`;
  const update = (field: VariableField, change: Partial<FieldInput>) => {
    setInputs((current) => new Map(current).set(field.index, { ...(current.get(field.index) ?? emptyInput), ...change }));
    setProblems((current) => (current.has(field.index) ? new Map([...current].filter(([index]) => index !== field.index)) : current));
  };

  /** RN-VAR-031: o valor digitado que não existe na coluna é recusado no campo; na restrição pela chave primária da própria coluna, só um aviso. */
  async function checkChoices(answers: ReadonlyMap<number, Value>): Promise<{ problems: Map<number, string>; warnings: Map<number, string> }> {
    const found = { problems: new Map<number, string>(), warnings: new Map<number, string>() };
    if (scope === null) return found;
    await Promise.all(
      fields.map(async (field) => {
        const choice = choices.get(field.index);
        const value = answers.get(field.index);
        if (choice === undefined || value === undefined || value.kind === "null") return;
        const missing = await missingValues(scope, choice, value.kind === "list" ? value.items : [value]);
        if (missing === null || missing.length === 0) return;
        (choice.strict ? found.problems : found.warnings).set(field.index, missingMessage(choice, missing));
      }),
    );
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const read = answersOf(fields, inputs);
    if (read.problems.size === 0) {
      setPending(true);
      const checked = await checkChoices(read.answers);
      setPending(false);
      setWarnings(checked.warnings);
      if (checked.problems.size === 0) return onRun(read.answers);
      read.problems = checked.problems;
    }
    setProblems(read.problems);
    const first = fields.find((field) => read.problems.has(field.index));
    // A aba pode estar na janela do resultado (RN-ABAS-017): o campo é procurado na página do diálogo.
    if (first !== undefined) host.document?.getElementById(idOf(first))?.focus();
  }

  const footer = (
    <>
      <Button type="button" variant="secondary" onClick={onCancel}>
        {copy.cancel}
      </Button>
      <Button type="submit" form={`${base}-form`} disabled={pending}>
        {copy.run}
      </Button>
    </>
  );

  return (
    <Dialog open title={copy.title} description={copy.summary(fields.length)} footer={footer} pending={pending} onClose={onCancel}>
      <form id={`${base}-form`} className="flex flex-col gap-5" onSubmit={(event) => void submit(event)} noValidate>
        {fields.map((field, position) => {
          const input = inputs.get(field.index) ?? emptyInput;
          const problem = problems.get(field.index) ?? null;
          const warning = warnings.get(field.index) ?? null;
          const helpId = `${idOf(field)}-ajuda`;
          const problemId = `${idOf(field)}-erro`;
          const describedBy = [field.help === null ? null : helpId, problem === null && warning === null ? null : problemId].filter((id) => id !== null).join(" ") || undefined;
          return (
            <div key={field.index} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={idOf(field)} className="font-mono text-sm text-ink">
                  {fieldLabel(field)}
                </label>
                {field.nullable ? (
                  <label className="flex items-center gap-1.5 text-xs text-muted">
                    <input type="checkbox" checked={input.isNull} onChange={(event) => update(field, { isNull: event.target.checked })} />
                    {copy.nullLabel}
                  </label>
                ) : null}
              </div>
              {field.help === null ? null : (
                <p id={helpId} className="text-xs text-muted">
                  {field.help}
                </p>
              )}
              <FieldControl
                id={idOf(field)}
                field={field}
                input={input}
                choice={choices.get(field.index) ?? null}
                scope={scope}
                invalid={problem !== null}
                describedBy={describedBy}
                autoFocus={position === 0}
                onChange={(change) => update(field, change)}
              />
              {problem !== null ? (
                <FieldError id={problemId} role="alert">
                  {problem}
                </FieldError>
              ) : warning !== null ? (
                <p id={problemId} className="text-xs text-accent" role="status">
                  {warning}
                </p>
              ) : null}
            </div>
          );
        })}
      </form>
    </Dialog>
  );
}

type FieldControlProps = {
  id: string;
  field: VariableField;
  input: FieldInput;
  choice: Choice | null;
  scope: ChoiceScope | null;
  invalid: boolean;
  describedBy: string | undefined;
  autoFocus: boolean;
  onChange: (change: Partial<FieldInput>) => void;
};

/** O campo pelo tipo (RN-VAR-027). */
function FieldControl({ id, field, input, choice, scope, invalid, describedBy, autoFocus, onChange }: FieldControlProps) {
  const disabled = field.nullable && input.isNull;
  const common = { id, disabled, autoFocus, "aria-invalid": invalid || undefined, "aria-describedby": describedBy };

  if (choice !== null && scope !== null)
    return (
      <>
        <ValueChoice
          id={id}
          disabled={disabled}
          autoFocus={autoFocus}
          describedBy={describedBy}
          invalid={invalid}
          choice={choice}
          scope={scope}
          list={field.list}
          text={input.text}
          items={input.items}
          onText={(text) => onChange({ text })}
          onToggle={(value) => onChange({ items: input.items.includes(value) ? input.items.filter((item) => item !== value) : [...input.items, value] })}
          onBlur={() => {}}
        />
        {field.list ? <Chips field={field} items={input.items} onChange={onChange} /> : null}
      </>
    );
  if (field.list) return <ItemsField {...common} field={field} input={input} onChange={onChange} />;

  switch (field.kind) {
    case "boolean":
      return (
        <button type="button" role="switch" aria-checked={input.checked} {...common} onClick={() => onChange({ checked: !input.checked })} className={cn(controlClassName, "w-auto self-start text-left")}>
          {input.checked ? copy.yes : copy.no}
        </button>
      );
    case "day":
    case "instant":
    case "date":
      // ponytail: o campo de data nativo, que vai do ano 1 ao 9999 como a linguagem (RN-VAR-007); o `DatePicker` da casa começa em 1900.
      return (
        <div className="flex gap-2">
          <input type="date" min="0001-01-01" max="9999-12-31" {...common} value={input.text} onChange={(event) => onChange({ text: event.target.value })} className={controlClassName} />
          {field.kind === "day" ? null : (
            <input
              type="time"
              step="1"
              aria-label={field.kind === "instant" ? copy.time : copy.timeOptional}
              disabled={disabled}
              value={input.time}
              onChange={(event) => onChange({ time: event.target.value })}
              className={cn(controlClassName, "w-40")}
            />
          )}
        </div>
      );
    case "sql":
      return (
        <>
          <input {...common} value={input.text} onChange={(event) => onChange({ text: event.target.value })} className={cn(controlClassName, "font-editor")} spellCheck={false} />
          <p className="flex items-center gap-1.5 text-xs text-accent">
            <AlertIcon className="size-3.5 flex-none" aria-hidden="true" />
            {copy.sqlWarning}
          </p>
        </>
      );
    case "number":
      return <input {...common} inputMode="decimal" placeholder={copy.decimalHint} value={input.text} onChange={(event) => onChange({ text: event.target.value })} className={controlClassName} />;
    default:
      // O texto de uma linha cresce para várias quando tem quebra de linha (RN-VAR-027).
      return input.text.includes("\n") ? (
        <textarea {...common} rows={Math.min(8, input.text.split("\n").length)} value={input.text} onChange={(event) => onChange({ text: event.target.value })} className={cn(controlClassName, "h-auto py-2")} />
      ) : (
        <input
          {...common}
          value={input.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
            const pasted = event.clipboardData.getData("text");
            if (!pasted.includes("\n")) return;
            event.preventDefault();
            const target = event.currentTarget;
            onChange({ text: `${input.text.slice(0, target.selectionStart ?? input.text.length)}${pasted}${input.text.slice(target.selectionEnd ?? input.text.length)}` });
          }}
          className={controlClassName}
        />
      );
  }
}

/** As fichas dos itens, com o X; o espaço no começo ou no fim do texto é marcado com um ponto discreto (RN-VAR-027). */
function Chips({ field, items, onChange }: { field: VariableField; items: readonly string[]; onChange: (change: Partial<FieldInput>) => void }) {
  if (items.length === 0) return <p className="text-xs text-muted">{copy.items(0)}</p>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {items.map((item, index) => {
        const start = field.kind === "string" && /^\s/.test(item);
        const end = field.kind === "string" && /\s$/.test(item);
        return (
          <span key={`${item}-${index}`} className="inline-flex items-center gap-1 rounded-md border border-border-strong px-2 py-0.5 font-mono text-xs" title={start || end ? copy.edgeSpace(start, end) : undefined}>
            {start ? <span aria-hidden="true">·</span> : null}
            {item === "" ? "''" : item}
            {end ? <span aria-hidden="true">·</span> : null}
            <button type="button" aria-label={copy.removeItem(item)} className="text-muted hover:text-ink" onClick={() => onChange({ items: items.filter((_, at) => at !== index) })}>
              <CloseIcon className="size-3" aria-hidden="true" />
            </button>
          </span>
        );
      })}
      <span className="text-xs text-muted">{copy.items(items.length)}</span>
    </div>
  );
}

/** O campo de itens: Enter ou a vírgula fecham o item, cada item vira uma ficha, e colar várias linhas cria um item por linha (RN-VAR-027). */
function ItemsField({ field, input, onChange, ...common }: { id: string; disabled: boolean; autoFocus: boolean; "aria-invalid": true | undefined; "aria-describedby": string | undefined; field: VariableField; input: FieldInput; onChange: (change: Partial<FieldInput>) => void }) {
  const [draft, setDraft] = useState("");
  const close = () => {
    if (draft === "" || (field.kind !== "string" && draft.trim() === "")) return;
    onChange({ items: [...input.items, field.kind === "string" || field.kind === "sql" ? draft : draft.trim()] });
    setDraft("");
  };
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || (event.key === "," && field.kind !== "string")) {
      event.preventDefault();
      close();
    } else if (event.key === "Backspace" && draft === "" && input.items.length > 0) onChange({ items: input.items.slice(0, -1) });
  }
  return (
    <>
      <input
        {...common}
        value={draft}
        placeholder={copy.itemsHint}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={close}
        onPaste={(event) => {
          const pasted = event.clipboardData.getData("text");
          if (!/[\r\n]/.test(pasted)) return;
          event.preventDefault();
          onChange({ items: [...input.items, ...pastedItems(field, pasted)] });
        }}
        className={controlClassName}
      />
      <Chips field={field} items={input.items} onChange={onChange} />
    </>
  );
}
