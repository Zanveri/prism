import { useEffect, useId, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";

import { AlertIcon, Button, CloseIcon, controlClassName, Dialog, FieldError, UndoIcon, useHost, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { executionTabCopy } from "../_lib/execution-tab.copy";
import { getScript, saveRunValues } from "../_lib/scripts.service";
import { columnChoiceOf, missingMessage, missingValues, type Choice, type ChoiceScope } from "../_lib/value-choice";
import { answersOf, changedInput, emptyInput, expanded, fieldLabel, flatFields, inputAt, inputOf, inputOfEntry, pastedItems, rememberedOf, valueAt, valueOf, type FieldInput, type ValuesQuestion, type VariableField } from "../_lib/variable-fields";
import { variableFieldsCopy as copy } from "../_lib/variable-fields.copy";
import type { Value } from "../_lib/variables/values";
import { ValueChoice } from "./value-choice";

type ValuesDialogProps = {
  question: ValuesQuestion;
  /** O título da aba, no título do diálogo do "Executar com valores…" (RN-VAR-027). */
  title: string;
  /** RN-VAR-028: o script salvo da aba, cujos valores o diálogo lembra; nulo na aba que não é de um script salvo, que não lembra nada. */
  script: { id: string; generic: boolean } | null;
  /** A sessão da árvore da conexão e do banco da aba, para a escolha pela chave (RN-VAR-031); nula na aba sem conexão. */
  scope: ChoiceScope | null;
  onRun: (answers: ReadonlyMap<number, Value>, newTab: boolean) => void;
  onCancel: () => void;
};

/** Os campos preenchidos com valores guardados (os lembrados, ou os da aba de execução); o que não passa mais na conferência do campo fica de fora, em silêncio. */
function inputsFrom(fields: readonly VariableField[], values: Readonly<Record<string, unknown>>): (readonly [number, FieldInput])[] {
  return fields.flatMap((field) => {
    const input = Object.hasOwn(values, field.name) ? inputOfEntry(values[field.name]) : null;
    return input !== null && valueOf(field, input).ok ? [[field.index, expanded(field, input)] as const] : [];
  });
}

/**
 * RN-VAR-021: "Valores para executar", o diálogo do "Executar com valores…" (RN-VAR-027) no modo reduzido: só os campos das declarações sem valor, sem "Onde". O foco
 * começa no primeiro campo; Enter executa quando os campos estão certos; Esc cancela, e nada roda.
 */
export function ValuesDialog({ question, title, script, scope, onRun, onCancel }: ValuesDialogProps) {
  const base = useId();
  const host = useHost();
  const toast = useToast();
  const { fields } = question;
  const full = question.mode === "full";
  const connections = useQuery(connectionsQuery);
  const connectionName = connections.data?.find((connection) => connection.id === scope?.connectionId)?.name ?? null;
  // No "Executar com valores…" o campo vem com o padrão do script (o literal preenchido, a expressão vazia); na pergunta, com o valor da vez anterior nesta aba.
  // RN-VAR-029: no "Mudar os valores…" da aba de execução, os valores dela vêm no lugar dos lembrados, e vão como escritos.
  const prefill = full ? (question.prefill ?? null) : null;
  const [inputs, setInputs] = useState(() => new Map([...fields.map((field) => [field.index, expanded(field, full ? (field.fallback.kind === "literal" ? field.fallback.input : emptyInput) : inputOf(question.tab.get(field.name)?.value, field.kind))] as const), ...(prefill === null ? [] : inputsFrom(fields, prefill))]));
  const [touched, setTouched] = useState<ReadonlySet<number>>(() => new Set(prefill === null ? [] : inputsFrom(fields, prefill).map(([index]) => index)));
  // RN-VAR-028: os campos que vieram dos valores lembrados ("da última vez"), até a pessoa mexer neles ou voltar ao valor do script.
  const [remembered, setRemembered] = useState<ReadonlySet<number>>(new Set());
  const scriptId = full ? (script?.id ?? null) : null;
  const recalled = prefill === null ? scriptId : null;

  useEffect(() => {
    if (recalled === null) return;
    let live = true;
    void getScript(recalled).then((result) => {
      const values = result.ok ? result.data.runValues?.values : undefined;
      if (!live || values === undefined) return;
      // O valor lembrado que não passa mais na conferência do campo (o tipo mudou, a variável saiu do topo) é esquecido em silêncio.
      const found = inputsFrom(fields, values);
      if (found.length === 0) return;
      setInputs((current) => new Map([...current, ...found]));
      setTouched((current) => new Set([...current, ...found.map(([index]) => index)]));
      setRemembered(new Set(found.map(([index]) => index)));
    });
    return () => {
      live = false;
    };
  }, [recalled, fields]);
  // Os erros, os avisos e a escolha são de cada campo da tela, pela chave dele: o membro de um objeto tem os seus (RN-VAR-041).
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map());
  const [warnings, setWarnings] = useState<ReadonlyMap<string, string>>(new Map());
  const [choices, setChoices] = useState<ReadonlyMap<string, Choice>>(new Map());
  const [pending, setPending] = useState(false);

  // RN-VAR-030: o tipo de coluna diz a coluna, e o catálogo dela diz de onde vêm os valores.
  useEffect(() => {
    if (scope === null) return;
    let live = true;
    for (const field of flatFields(fields)) {
      const read = field.column === null ? undefined : question.reads?.get(field.column);
      if (read?.ok !== true) continue;
      const written = /^(?:"[^"]*"|[^."]+)\.(?:"[^"]*"|[^."]+)\./.test(field.column ?? "");
      void columnChoiceOf(scope, read, written).then((choice) => {
        if (live && choice !== null) setChoices((current) => new Map(current).set(field.key, choice));
      });
    }
    return () => {
      live = false;
    };
  }, [fields, question.reads, scope]);

  const idOf = (key: string) => `${base}-${key}`;
  // O membro muda dentro do campo da declaração, e a declaração inteira passa a ir (RN-VAR-027 e 041).
  const update = (field: VariableField, change: Partial<FieldInput>) => {
    setInputs((current) => new Map(current).set(field.index, changedInput(current.get(field.index) ?? emptyInput, field.path, change)));
    setTouched((current) => (current.has(field.index) ? current : new Set(current).add(field.index)));
    setRemembered((current) => (current.has(field.index) ? new Set([...current].filter((index) => index !== field.index)) : current));
    setProblems((current) => (current.has(field.key) ? new Map([...current].filter(([key]) => key !== field.key)) : current));
  };

  /** RN-VAR-031: o valor digitado que não existe na coluna é recusado no campo; na restrição pela chave primária da própria coluna, só um aviso. */
  async function checkChoices(answers: ReadonlyMap<number, Value>): Promise<{ problems: Map<string, string>; warnings: Map<string, string> }> {
    const found = { problems: new Map<string, string>(), warnings: new Map<string, string>() };
    if (scope === null) return found;
    await Promise.all(
      flatFields(fields).map(async (field) => {
        const choice = choices.get(field.key);
        const value = valueAt(answers.get(field.index), field.path);
        if (choice === undefined || value === undefined || value.kind === "null") return;
        const missing = await missingValues(scope, choice, value.kind === "list" ? value.items : [value]);
        if (missing === null || missing.length === 0) return;
        (choice.strict ? found.problems : found.warnings).set(field.key, missingMessage(choice, missing));
      }),
    );
    return found;
  }

  /** RN-VAR-028: grava o que a pessoa escreveu ou escolheu; a gravação que falha só avisa, e a execução segue. */
  function remember(answers: ReadonlyMap<number, Value>) {
    if (scriptId === null) return;
    const { values, tooLarge } = rememberedOf(fields, answers);
    if (tooLarge.length > 0) toast.warning(copy.tooLargeToRemember(tooLarge));
    const where = script?.generic === true && scope !== null ? { connectionID: scope.connectionId, database: scope.database ?? null } : { connectionID: null, database: null };
    void saveRunValues(scriptId, { values, ...where })
      .then((result) => {
        if (!result.ok) toast.warning(copy.rememberFailed(result.error.detail ?? result.error.title));
      })
      .catch(() => {});
  }

  /** "Voltar ao valor do script" (↺): o campo volta ao padrão e deixa de ir. */
  function reset(field: VariableField) {
    setInputs((current) => new Map(current).set(field.index, expanded(field, field.fallback.kind === "literal" ? field.fallback.input : emptyInput)));
    setTouched((current) => new Set([...current].filter((index) => index !== field.index)));
    setRemembered((current) => new Set([...current].filter((index) => index !== field.index)));
  }

  /** "Esquecer os valores deste script": apaga os lembrados, e os campos que vieram deles voltam ao padrão. */
  function forget() {
    if (scriptId === null) return;
    for (const field of fields) if (remembered.has(field.index)) reset(field);
    void saveRunValues(scriptId, { values: {}, connectionID: null, database: null })
      .then((result) => {
        if (!result.ok) toast.warning(copy.rememberFailed(result.error.detail ?? result.error.title));
      })
      .catch(() => {});
  }

  async function submit(newTab: boolean) {
    if (pending) return;
    const read = answersOf(fields, inputs, full ? touched : undefined);
    if (read.problems.size === 0) {
      setPending(true);
      const checked = await checkChoices(read.answers);
      setPending(false);
      setWarnings(checked.warnings);
      if (checked.problems.size === 0) {
        remember(read.answers);
        return onRun(read.answers, newTab);
      }
      read.problems = checked.problems;
    }
    setProblems(read.problems);
    const first = flatFields(fields).find((field) => read.problems.has(field.key));
    // A aba pode estar na janela do resultado (RN-ABAS-017): o campo é procurado na página do diálogo.
    if (first !== undefined) host.document?.getElementById(idOf(first.key))?.focus();
  }

  /** Um campo: o rótulo, a ajuda, o controle pelo tipo e a frase; o objeto com membros é um grupo com um campo para cada um (RN-VAR-041). */
  function renderField(field: VariableField, autoFocus: boolean): ReactNode {
    const input = inputAt(inputs.get(field.index), field.path);
    const problem = problems.get(field.key) ?? null;
    const warning = warnings.get(field.key) ?? null;
    const id = idOf(field.key);
    const helpId = `${id}-ajuda`;
    const problemId = `${id}-erro`;
    const describedBy = [field.help === null ? null : helpId, problem === null && warning === null ? null : problemId].filter((at) => at !== null).join(" ") || undefined;
    const header = (
      <div className="flex items-center justify-between gap-3">
        {field.members === null ? (
          <label htmlFor={id} className="font-mono text-sm text-ink">
            {fieldLabel(field)}
          </label>
        ) : (
          <span id={`${id}-rotulo`} className="font-mono text-sm text-ink">
            {fieldLabel(field)}
          </span>
        )}
        {field.path.length === 0 && remembered.has(field.index) ? (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted">
            {copy.lastTime}
            <button type="button" aria-label={copy.resetToScript} title={copy.resetToScript} className="text-muted hover:text-ink" onClick={() => reset(field)}>
              <UndoIcon className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        ) : null}
        {field.nullable ? (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={input.isNull} onChange={(event) => update(field, { isNull: event.target.checked })} />
            {copy.nullLabel}
          </label>
        ) : null}
      </div>
    );
    const help =
      field.help === null ? null : (
        <p id={helpId} className="text-xs text-muted">
          {field.help}
        </p>
      );
    if (field.members !== null)
      return (
        <div role="group" aria-labelledby={`${id}-rotulo`} aria-describedby={field.help === null ? undefined : helpId} className="flex flex-col gap-1.5">
          {header}
          {help}
          {field.fallback.kind === "expression" ? <p className="text-xs text-muted">{copy.computed(field.fallback.text)}</p> : null}
          <div className="flex flex-col gap-3 border-l border-border pl-3">
            {field.members.map((member, at) => (
              <div key={member.key} className="flex flex-col gap-1.5">
                {renderField(member, autoFocus && at === 0)}
              </div>
            ))}
          </div>
        </div>
      );
    return (
      <>
        {header}
        {help}
        <FieldControl
          id={id}
          field={field}
          input={input}
          choice={choices.get(field.key) ?? null}
          scope={scope}
          invalid={problem !== null}
          describedBy={describedBy}
          autoFocus={autoFocus}
          hint={field.fallback.kind === "expression" ? copy.computed(field.fallback.text) : null}
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
      </>
    );
  }

  const footer = (
    <>
      {scriptId === null ? null : (
        <Button type="button" variant="ghost" className="mr-auto" onClick={forget}>
          {copy.forget}
        </Button>
      )}
      <Button type="button" variant="secondary" onClick={onCancel}>
        {copy.cancel}
      </Button>
      {question.offerNewTab === true ? (
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void submit(true)}>
          {executionTabCopy.newTab}
        </Button>
      ) : null}
      <Button type="submit" form={`${base}-form`} disabled={pending}>
        {copy.run}
      </Button>
    </>
  );

  return (
    <Dialog open title={full ? copy.fullTitle(title) : copy.title} description={full ? undefined : copy.summary(fields.length)} size={full ? "lg" : "md"} footer={footer} pending={pending} onClose={onCancel}>
      <form id={`${base}-form`} className="flex flex-col gap-5" onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void submit(false);
        }} noValidate>
        {full ? (
          <section className="flex flex-col gap-1.5">
            <h3 className="text-sm font-semibold">{copy.where}</h3>
            <p className="text-sm text-muted">
              {copy.connection}: <span className="text-ink">{connectionName ?? "—"}</span> · {copy.database}: <span className="text-ink">{scope?.database ?? copy.defaultDatabase}</span>
            </p>
          </section>
        ) : null}
        {full && fields.length > 0 ? <h3 className="-mb-2 text-sm font-semibold">{copy.values}</h3> : null}
        {fields.map((field, position) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            {field.below && !fields[position - 1]?.below ? <h3 className="mt-2 text-sm font-semibold">{copy.below}</h3> : null}
            {renderField(field, position === 0)}
          </div>
        ))}
        {full && question.calculated.length > 0 ? (
          <p className="text-xs text-muted" title={question.calculated.join(", ")}>
            {copy.calculated(question.calculated.length)}
          </p>
        ) : null}
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
  /** A expressão do script como dica ("calculado: random.int(1, 100)"): vazio, o campo deixa a expressão valer na vez dela. */
  hint: string | null;
  onChange: (change: Partial<FieldInput>) => void;
};

/** O campo pelo tipo (RN-VAR-027). */
function FieldControl({ hint, ...props }: FieldControlProps) {
  const control = <TypedControl {...props} hint={hint} />;
  const textual = props.choice === null && !props.field.list && (props.field.kind === "number" || props.field.kind === "string" || props.field.kind === "sql" || props.field.kind === "object");
  return hint === null || textual ? control : (
    <>
      {control}
      <p className="text-xs text-muted">{hint}</p>
    </>
  );
}

function TypedControl({ id, field, input, choice, scope, invalid, describedBy, autoFocus, hint, onChange }: FieldControlProps) {
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
          <input {...common} placeholder={hint ?? undefined} value={input.text} onChange={(event) => onChange({ text: event.target.value })} className={cn(controlClassName, "font-editor")} spellCheck={false} />
          <p className="flex items-center gap-1.5 text-xs text-accent">
            <AlertIcon className="size-3.5 flex-none" aria-hidden="true" />
            {copy.sqlWarning}
          </p>
        </>
      );
    case "object":
      // RN-VAR-004 e 027: a interface e o type de objeto se escrevem como no script, `{ id: 7, nome: 'Ana' }`, numa caixa que cresce com as linhas.
      return (
        <textarea
          {...common}
          rows={Math.min(8, Math.max(2, input.text.split("\n").length))}
          placeholder={hint ?? copy.objectHint(field.typeText)}
          value={input.text}
          onChange={(event) => onChange({ text: event.target.value })}
          className={cn(controlClassName, "h-auto py-2 font-editor")}
          spellCheck={false}
        />
      );
    case "number":
      return <input {...common} inputMode="decimal" placeholder={hint ?? copy.decimalHint} value={input.text} onChange={(event) => onChange({ text: event.target.value })} className={controlClassName} />;
    default:
      // O texto de uma linha cresce para várias quando tem quebra de linha (RN-VAR-027).
      return input.text.includes("\n") ? (
        <textarea {...common} rows={Math.min(8, input.text.split("\n").length)} value={input.text} onChange={(event) => onChange({ text: event.target.value })} className={cn(controlClassName, "h-auto py-2")} />
      ) : (
        <input
          {...common}
          placeholder={hint ?? undefined}
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
