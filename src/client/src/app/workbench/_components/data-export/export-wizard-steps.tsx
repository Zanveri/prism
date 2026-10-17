import { useId, type KeyboardEvent, type ReactNode } from "react";

import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";
import { InstallDriverLink } from "@/app/drivers/_components/install-driver-link";
import { Button, EngineTag, FieldError, FormMessage, Input, LockIcon, Select, type Engine, type SelectOption } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { fieldAria } from "@/lib/utils/form";

import { dataExportCopy } from "../../_lib/data-export/data-export.copy";
import { dataFormats, isTextFormat, type Binary, type DataFormat, type FieldProblems, type FormatOptions } from "../../_lib/data-export/export-options";
import type { ExportOrigin, SourceColumn } from "../../_lib/data-export/export-source";
import type { WizardRefusal } from "../../_lib/data-export/export-wizard";
import { DatabaseTargetIcon, DataFormatIcon } from "./format-icons";

/**
 * As etapas do assistente "Exportar dados" (RN-EXPORT-004 a 015), só de propriedades: quem tem o estado é o `ExportWizard`. Cada campo mostra a recusa
 * dele, no lugar (o `aria-invalid` e o `aria-describedby` do `fieldAria`).
 */

const f = dataExportCopy.formatting;

/** O id da opção de um formato na lista, para o foco andar com as setas. */
export const formatOptionId = (prefix: string, format: DataFormat) => `${prefix}-${format}`;

/** RN-EXPORT-004: a lista de escolha única dos formatos. As setas, Home e End andam e escolhem; Enter e o duplo clique escolhem e avançam. */
export function FormatStep({ format, idPrefix, onChoose, onAdvance }: { format: DataFormat; idPrefix: string; onChoose: (format: DataFormat) => void; onAdvance: () => void }) {
  const copy = dataExportCopy.formats;

  function move(event: KeyboardEvent<HTMLElement>) {
    const index = dataFormats.indexOf(format);
    const target = event.key === "ArrowDown" ? Math.min(index + 1, dataFormats.length - 1) : event.key === "ArrowUp" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? dataFormats.length - 1 : null;
    if (event.key === "Enter") {
      event.preventDefault();
      onAdvance();
      return;
    }
    if (target === null) return;
    event.preventDefault();
    const next = dataFormats[target];
    onChoose(next);
    document.getElementById(formatOptionId(idPrefix, next))?.focus();
  }

  return (
    <div role="listbox" aria-label={copy.label} className="flex flex-col gap-1">
      {dataFormats.map((candidate) => {
        const selected = candidate === format;
        return (
          <div
            key={candidate}
            id={formatOptionId(idPrefix, candidate)}
            role="option"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(candidate)}
            onDoubleClick={() => {
              onChoose(candidate);
              onAdvance();
            }}
            onKeyDown={move}
            className={cn("flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 outline-none focus-visible:ring-1 focus-visible:ring-accent", selected ? "border-accent bg-selected" : "border-transparent hover:bg-selected")}
          >
            <DataFormatIcon format={candidate} className="mt-0.5" />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium text-ink">{copy.names[candidate]}</span>
              <span className="text-sm text-muted">{copy.descriptions[candidate]}</span>
            </span>
          </div>
        );
      })}
      {/* Separado dos outros por uma linha: o destino "Banco de dados" é da seção 36, e aqui aparece em breve. */}
      <div role="separator" className="my-1 border-t border-border" />
      <div role="option" aria-selected={false} aria-disabled="true" className="flex cursor-not-allowed items-start gap-3 rounded-md px-3 py-2 opacity-60">
        <DatabaseTargetIcon className="mt-0.5" />
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-ink">
            {copy.database} <span className="ml-1 rounded border border-border-strong px-1 text-xs text-muted">{copy.soon}</span>
          </span>
          <span className="text-sm text-muted">{copy.databaseDescription}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * Uma caixa de marcar com o rótulo e, embaixo, a dica (ou o motivo de estar desabilitada) e o motivo que segura a etapa (`error`, com "Tentar de novo" quando
 * há `onRetry`), os dois ligados à caixa pelo `aria-describedby`.
 */
export function CheckboxRow({
  label,
  checked,
  onChange,
  disabled = false,
  hint,
  error,
  onRetry = null,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hint?: string;
  error?: string;
  onRetry?: (() => void) | null;
}) {
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId].filter((id) => id !== null).join(" ");
  return (
    <div className="flex flex-col gap-0.5">
      <label className={cn("flex items-start gap-2.5 text-ink", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} aria-describedby={describedBy === "" ? undefined : describedBy} className="mt-[3px] size-4 flex-none cursor-pointer accent-accent disabled:cursor-not-allowed" />
        <span>{label}</span>
      </label>
      {hint === undefined ? null : (
        <p id={hintId} className="pl-6.5 text-sm text-muted">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <div className="flex flex-col items-start gap-2 pl-6.5">
          <FieldError id={errorId}>{error}</FieldError>
          {onRetry === null ? null : (
            <Button type="button" variant="secondary" size="compact" onClick={onRetry}>
              {dataExportCopy.extraction.retry}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** RN-EXPORT-005: as colunas da origem, "Contar as linhas antes" e a origem, só para ver. */
export function ExtractionStep({
  origin,
  columns,
  loadError,
  onRetry,
  checked,
  onToggle,
  onAll,
  count,
  onCount,
  problem,
}: {
  origin: ExportOrigin;
  columns: readonly SourceColumn[] | null;
  loadError: string | null;
  onRetry: () => void;
  checked: readonly boolean[] | null;
  onToggle: (index: number, checked: boolean) => void;
  onAll: (checked: boolean) => void;
  count: boolean;
  onCount: (count: boolean) => void;
  problem: string | null;
}) {
  const e = dataExportCopy.extraction;
  const problemId = useId();
  const total = columns?.length ?? 0;
  const marked = checked?.filter(Boolean).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-labelledby={`${problemId}-title`}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${problemId}-title`} className="mr-auto font-medium">
            {e.columns}
          </h3>
          {columns === null ? null : (
            <>
              <span className="text-sm text-muted">{e.checked(marked, total)}</span>
              <Button type="button" variant="secondary" size="compact" onClick={() => onAll(true)}>
                {e.checkAll}
              </Button>
              <Button type="button" variant="secondary" size="compact" onClick={() => onAll(false)}>
                {e.uncheckAll}
              </Button>
            </>
          )}
        </div>
        {loadError !== null ? (
          <div className="flex flex-col items-start gap-2">
            <FormMessage tone="error">{loadError}</FormMessage>
            <Button type="button" variant="secondary" size="compact" onClick={onRetry}>
              {e.retry}
            </Button>
          </div>
        ) : columns === null || checked === null ? (
          <p role="status" className="text-muted">
            {e.loading}
          </p>
        ) : (
          // A lista rola, e o Tab anda pelas caixas. O nome repetido aparece repetido, cada um com a sua caixa.
          // O motivo (nenhuma marcada, a recusa da API) descreve cada caixa: é nelas que o foco anda, e o "Avançar" desabilitado não o recebe.
          <ul aria-describedby={problem === null ? undefined : problemId} className="max-h-60 overflow-y-auto rounded-md border border-border-strong p-1 [content-visibility:auto]">
            {columns.map((column, index) => (
              <li key={index}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1 hover:bg-selected">
                  <input type="checkbox" checked={checked[index] === true} onChange={(event) => onToggle(index, event.target.checked)} aria-describedby={problem === null ? undefined : problemId} className="size-4 flex-none cursor-pointer accent-accent" />
                  <span className="min-w-0 truncate font-mono text-ink">{column.name}</span>
                  <span className="ml-auto flex-none font-mono text-xs text-muted">{column.type}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <FieldError id={problemId}>{problem ?? undefined}</FieldError>
      </section>

      <CheckboxRow label={e.count} checked={count} onChange={onCount} hint={e.countHint} />

      <section className="flex flex-col gap-1.5">
        <h3 className="font-medium">{e.origin}</h3>
        <OriginText origin={origin} />
        <p className="text-sm text-subtle">{e.noEdit}</p>
      </section>
    </div>
  );
}

/** A origem, só para ver: as linhas da tabela, o filtro e a ordem dos Registros, ou o comando do resultado (com o filtro dele). */
function OriginText({ origin }: { origin: ExportOrigin }) {
  const e = dataExportCopy.extraction;
  const code = (text: string) => <pre className="max-h-32 overflow-auto rounded-md border border-border bg-panel p-2 font-editor text-sm break-words whitespace-pre-wrap text-ink">{text}</pre>;
  switch (origin.kind) {
    case "table":
      return <p className="text-body">{e.allRowsOf(origin.schema, origin.name)}</p>;
    case "records":
      return origin.filter === "" ? (
        <p className="text-body">{e.recordsNoFilter}</p>
      ) : (
        <>
          <p className="text-body">{e.recordsFilter}</p>
          {code(origin.filter)}
        </>
      );
    case "result":
      return (
        <>
          <p className="text-body">{e.command}</p>
          {code(origin.sql)}
          {origin.filter === null || origin.filter === "" ? null : (
            <>
              <p className="text-body">{e.resultFilter}</p>
              {code(origin.filter)}
            </>
          )}
        </>
      );
  }
}

/** Um campo de escolha com rótulo visível (o `Select` do app). */
export function ChoiceField<T extends string>({ label, value, options, onChange, disabled = false, hint }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean; hint?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <Select id={id} value={value} options={options.map((option): SelectOption => ({ value: option.value, label: option.label }))} onChange={(next) => onChange(next as T)} disabled={disabled} aria-describedby={hint === undefined ? undefined : hintId} />
      {hint === undefined ? null : (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

/** Um campo de texto (ou de número escrito) com a recusa no lugar. */
export function TextOption({ label, value, onChange, error, hint, disabled = false, inputMode, className }: { label: string; value: string; onChange: (value: string) => void; error?: string; hint?: string; disabled?: boolean; inputMode?: "numeric"; className?: string }) {
  const id = useId();
  const aria = fieldAria(id, error);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm text-muted">
        {label}
      </label>
      <Input id={id} value={value} disabled={disabled} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} {...aria} aria-describedby={[aria["aria-describedby"], hint === undefined ? undefined : `${id}-hint`].filter(Boolean).join(" ") || undefined} />
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  );
}

const binaryChoices: { value: Binary; label: string }[] = [
  { value: "hex", label: f.binaryHex },
  { value: "null", label: f.binaryEmpty },
];
const lineBreakChoices = [
  { value: "crlf" as const, label: f.crlf },
  { value: "lf" as const, label: f.lf },
];

/**
 * RN-EXPORT-006 a 013: as opções do formato escolhido, cada uma com o padrão, e "Voltar aos padrões" no fim. As recusas ficam no campo; as que não são de um
 * campo (as colunas repetidas do SQL, as colunas demais do XLSX) ficam no alto da etapa.
 */
export function FormattingStep({
  format,
  options,
  onChange,
  problems,
  informix,
  showGenerated,
  onRetryGenerated = null,
  onReset,
}: {
  format: DataFormat;
  options: FormatOptions;
  onChange: (options: FormatOptions) => void;
  problems: FieldProblems;
  informix: boolean;
  showGenerated: boolean;
  /** Nos Registros, quando a leitura de quais colunas o banco calcula falhou: "Tentar de novo", embaixo do motivo. */
  onRetryGenerated?: (() => void) | null;
  onReset: () => void;
}) {
  const set = <K extends DataFormat>(key: K, change: Partial<FormatOptions[K]>) => onChange({ ...options, [key]: { ...options[key], ...change } });
  const columnsProblem = problems.columns;
  const binary = format === "sql" ? null : <ChoiceField label={f.binary} value={options[format].binary as Binary} options={binaryChoices} onChange={(value) => set(format, { binary: value } as never)} hint={options[format].binary === "null" ? f.binaryEmptyHint : undefined} />;

  let body: ReactNode;
  switch (format) {
    case "csv": {
      const o = options.csv;
      body = (
        <>
          <ChoiceField label={f.csv.delimiter} value={o.delimiter} options={(Object.keys(f.csv.delimiters) as (keyof typeof f.csv.delimiters)[]).map((value) => ({ value, label: f.csv.delimiters[value] }))} onChange={(delimiter) => set("csv", { delimiter })} />
          <ChoiceField label={f.csv.header} value={o.header ? "first" : "none"} options={[{ value: "first", label: f.csv.headerFirst }, { value: "none", label: f.csv.headerNone }]} onChange={(value) => set("csv", { header: value === "first" })} />
          <ChoiceField label={f.csv.quoting} value={o.quoting} options={(["auto", "text", "all"] as const).map((value) => ({ value, label: f.csv.quotings[value] }))} onChange={(quoting) => set("csv", { quoting })} />
          <CheckboxRow label={f.csv.formulaGuard} checked={o.formulaGuard} onChange={(formulaGuard) => set("csv", { formulaGuard })} hint={o.formulaGuard ? undefined : f.csv.formulaGuardOff} />
          <ChoiceField label={f.lineBreak} value={o.lineBreak} options={lineBreakChoices} onChange={(lineBreak) => set("csv", { lineBreak })} />
          <TextOption label={f.nullText} value={o.nullText} onChange={(nullText) => set("csv", { nullText })} error={problems["options.nullText"]} hint={f.nullTextHint} />
        </>
      );
      break;
    }
    case "txt": {
      const o = options.txt;
      body = (
        <>
          <CheckboxRow label={f.txt.header} checked={o.header} onChange={(header) => set("txt", { header })} />
          <CheckboxRow label={f.txt.headerLine} checked={o.headerLine} onChange={(headerLine) => set("txt", { headerLine })} />
          <CheckboxRow label={f.txt.edgeDelimiters} checked={o.edgeDelimiters} onChange={(edgeDelimiters) => set("txt", { edgeDelimiters })} />
          <div className="grid grid-cols-2 gap-4">
            <TextOption label={f.txt.minWidth} value={o.minWidth} inputMode="numeric" onChange={(minWidth) => set("txt", { minWidth })} error={problems["options.minWidth"]} />
            <TextOption label={f.txt.maxWidth} value={o.maxWidth} inputMode="numeric" onChange={(maxWidth) => set("txt", { maxWidth })} error={problems["options.maxWidth"]} hint={f.txt.maxWidthHint} />
          </div>
          <CheckboxRow label={f.txt.showNull} checked={o.showNull} onChange={(showNull) => set("txt", { showNull })} />
          <ChoiceField label={f.lineBreak} value={o.lineBreak} options={lineBreakChoices} onChange={(lineBreak) => set("txt", { lineBreak })} />
        </>
      );
      break;
    }
    case "html":
      body = (
        <>
          <CheckboxRow label={f.html.title} checked={options.html.title} onChange={(title) => set("html", { title })} />
          <CheckboxRow label={f.html.columnNames} checked={options.html.columnNames} onChange={(columnNames) => set("html", { columnNames })} />
        </>
      );
      break;
    case "markdown":
      body = (
        <>
          <CheckboxRow label={f.markdown.alignmentLine} checked={options.markdown.alignmentLine} onChange={(alignmentLine) => set("markdown", { alignmentLine })} />
          <TextOption label={f.nullText} value={options.markdown.nullText} onChange={(nullText) => set("markdown", { nullText })} error={problems["options.nullText"]} hint={f.nullTextHint} />
        </>
      );
      break;
    case "json":
      body = (
        <>
          <CheckboxRow label={f.json.wrap} checked={options.json.wrap} onChange={(wrap) => set("json", { wrap })} />
          <CheckboxRow label={f.json.isoDates} checked={options.json.isoDates} onChange={(isoDates) => set("json", { isoDates })} />
        </>
      );
      break;
    case "sourceCode": {
      const o = options.sourceCode;
      body = (
        <>
          <ChoiceField label={f.sourceCode.php} value={o.php} options={[{ value: "legacy" as const, label: f.sourceCode.legacy }, { value: "short" as const, label: f.sourceCode.short }]} onChange={(php) => set("sourceCode", { php })} />
          <ChoiceField label={f.sourceCode.quote} value={o.quote} options={[{ value: "double" as const, label: f.sourceCode.double }, { value: "single" as const, label: f.sourceCode.single }]} onChange={(quote) => set("sourceCode", { quote })} />
          <CheckboxRow label={f.json.isoDates} checked={o.isoDates} onChange={(isoDates) => set("sourceCode", { isoDates })} />
        </>
      );
      break;
    }
    case "sql": {
      const o = options.sql;
      body = (
        <>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm text-muted">{f.sql.target}</legend>
            <div className="grid grid-cols-2 gap-4">
              <TextOption label={f.sql.schema} value={o.schema} onChange={(schema) => set("sql", { schema })} error={problems["options.schema"]} disabled={o.omitSchema} />
              <TextOption label={f.sql.table} value={o.table} onChange={(table) => set("sql", { table })} error={problems["options.table"]} />
            </div>
            <p className="text-sm text-muted">{f.sql.namesHint}</p>
          </fieldset>
          <CheckboxRow label={f.sql.omitSchema} checked={o.omitSchema} onChange={(omitSchema) => set("sql", { omitSchema })} />
          <TextOption
            className="max-w-60"
            label={f.sql.rowsPerStatement}
            value={informix ? "1" : o.rowsPerStatement}
            inputMode="numeric"
            disabled={informix}
            onChange={(rowsPerStatement) => set("sql", { rowsPerStatement })}
            error={informix ? undefined : problems["options.rowsPerStatement"]}
            hint={informix ? f.sql.informixRows : f.sql.rowsPerStatementHint}
          />
          {showGenerated ? (
            <CheckboxRow label={f.sql.includeGenerated} checked={o.includeGenerated} onChange={(includeGenerated) => set("sql", { includeGenerated })} error={problems["options.includeGenerated"]} onRetry={onRetryGenerated} />
          ) : null}
          <ChoiceField label={f.sql.binary} value={o.binary} options={[{ value: "literal" as const, label: f.sql.binaryLiteral }, { value: "null" as const, label: f.sql.binaryNull }]} onChange={(value) => set("sql", { binary: value })} />
        </>
      );
      break;
    }
    case "xml":
      body = <CheckboxRow label={f.xml.doctype} checked={options.xml.doctype} onChange={(doctype) => set("xml", { doctype })} />;
      break;
    case "dbUnit": {
      const o = options.dbUnit;
      body = (
        <>
          <TextOption label={f.dbUnit.table} value={o.table} onChange={(table) => set("dbUnit", { table })} error={problems["options.table"]} />
          <CheckboxRow label={f.dbUnit.upperCase} checked={o.upperCase} onChange={(upperCase) => set("dbUnit", { upperCase })} />
          <ChoiceField label={f.dbUnit.nulls} value={o.nulls} options={[{ value: "omit" as const, label: f.dbUnit.omit }, { value: "mark" as const, label: f.dbUnit.mark }]} onChange={(nulls) => set("dbUnit", { nulls })} hint={f.dbUnit.nullsHint} />
        </>
      );
      break;
    }
    case "xlsx":
      body = <p className="text-muted">{f.xlsx.none}</p>;
      break;
  }

  return (
    <div className="flex flex-col gap-4">
      {columnsProblem === undefined ? null : <FormMessage tone="error">{columnsProblem}</FormMessage>}
      {body}
      {binary}
      <div>
        <Button type="button" variant="secondary" size="compact" onClick={onReset}>
          {f.reset}
        </Button>
      </div>
    </div>
  );
}

export type OutputChoices = { pattern: string; bom: boolean; zip: boolean; reveal: boolean; clipboard: boolean };

/** RN-EXPORT-014: o nome do arquivo com o que sairia agora, a codificação, o BOM, o .zip, o "Mostrar na pasta" e a área de transferência. */
export function OutputStep({ format, choices, onChange, preview, problem }: { format: DataFormat; choices: OutputChoices; onChange: (change: Partial<OutputChoices>) => void; preview: string; problem: string | null }) {
  const o = dataExportCopy.output;
  const text = isTextFormat(format);
  const clipboard = text && choices.clipboard;
  return (
    <div className="flex flex-col gap-4">
      <TextOption label={o.fileName} value={choices.pattern} onChange={(pattern) => onChange({ pattern })} error={clipboard ? undefined : (problem ?? undefined)} hint={o.fileNameHint} disabled={clipboard} />
      {clipboard || problem !== null ? null : (
        <p aria-live="polite" className="-mt-2 font-mono text-sm break-all text-body">
          {o.preview(preview)}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-sm text-muted">{o.encoding}</span>
        <span className="text-ink">{o.utf8}</span>
      </div>
      <CheckboxRow label={o.bom} checked={text && !clipboard && choices.bom} disabled={!text || clipboard} onChange={(bom) => onChange({ bom })} hint={o.bomHint} />
      <CheckboxRow label={o.zip} checked={text && !clipboard && choices.zip} disabled={!text || clipboard} onChange={(zip) => onChange({ zip })} hint={text ? undefined : o.zipXlsx} />
      <CheckboxRow label={o.reveal} checked={!clipboard && choices.reveal} disabled={clipboard} onChange={(reveal) => onChange({ reveal })} />
      <CheckboxRow label={o.clipboard} checked={clipboard} disabled={!text} onChange={(value) => onChange({ clipboard: value })} hint={text ? o.clipboardHint : o.clipboardXlsx} />
    </div>
  );
}

/**
 * RN-EXPORT-003 e 015: a conexão da origem, como o cabeçalho do assistente e a linha "Conexão" da Confirmação a mostram: a etiqueta do banco, o nome e o
 * banco de dados, com o ambiente e o cadeado do somente leitura (com o motivo na dica).
 */
export function ExportConnection({ engine, name, database, environment, readOnlyHint }: { engine: Engine; name: string; database: string; environment: ShownEnvironment | null; readOnlyHint: string | null }) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <EngineTag engine={engine} />
      <span className="text-ink">{name}</span>
      <span className="text-muted">· {database}</span>
      <ShownEnvironmentPill environment={environment} />
      {readOnlyHint === null ? null : (
        <span title={readOnlyHint} className="flex items-center gap-1 text-muted">
          <LockIcon className="size-3.5" />
          <span>{dataExportCopy.wizard.readOnly}</span>
        </span>
      )}
    </span>
  );
}

export type SummaryLine = { label: string; value: ReactNode; hint?: string };

/**
 * RN-EXPORT-015: as recusas no alto, o resumo em linhas de rótulo e valor, e os avisos no tom de atenção. `after` vem embaixo dos avisos: a caixa "Entendo que
 * as linhas atuais … serão apagadas." da importação e da cópia (RN-IMPORT-013 e 025).
 */
export function ConfirmationStep({ refusals, lines, warnings, after }: { refusals: readonly WizardRefusal[]; lines: readonly SummaryLine[]; warnings: readonly string[]; after?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      {refusals.length === 0 ? null : (
        <div role="alert" className="flex flex-col gap-2">
          {refusals.map((refusal, index) => (
            <div key={index} className="flex flex-col items-start gap-1.5">
              <FormMessage tone="error">{refusal.message}</FormMessage>
              {refusal.driverID === undefined ? null : <InstallDriverLink driverID={refusal.driverID} />}
            </div>
          ))}
        </div>
      )}
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
        {lines.map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-sm text-muted">{line.label}</dt>
            <dd title={line.hint} className="min-w-0 break-words text-ink">
              {line.value}
            </dd>
          </div>
        ))}
      </dl>
      {warnings.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-sm text-ink">
              <span aria-hidden className="mt-1.5 size-2 flex-none rounded-full bg-accent" />
              {warning}
            </li>
          ))}
        </ul>
      )}
      {after ?? null}
    </div>
  );
}
