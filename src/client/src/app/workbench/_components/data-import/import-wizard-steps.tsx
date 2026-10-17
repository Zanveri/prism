import { memo, useId, useMemo, type ReactNode, type Ref } from "react";

import { InstallDriverLink } from "@/app/drivers/_components/install-driver-link";
import { Button, FieldError, FormMessage, Segmented, segmentedItem, Select, UploadIcon, type Engine, type SelectOption } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { formatFileSize } from "../../_lib/data-export/transfer-tracker";
import { dataImportCopy } from "../../_lib/data-import/data-import.copy";
import type { CsvChoices, DelimitedChoices, ImportChoices, XlsxChoices } from "../../_lib/data-import/import-choices";
import { copyPercent, delimiterText, detectionLine, encodingText, hiddenColumnsNote, previewText, shortRowText } from "../../_lib/data-import/import-file";
import { heldSource, type FileSource, type ReadState } from "../../_lib/data-import/import-flow";
import { informixNote, loadWarnings } from "../../_lib/data-import/import-load";
import { columnBlocker, columnMark, columnNote, markLabel, previewSummary, previewSummaryText, stayingDefaults, type Targets } from "../../_lib/data-import/import-mapping";
import { importEncodings, type ImportFormat, type ImportPreview, type ImportRead, type ImportTable, type ImportValues, type TableColumn } from "../../_lib/data-import/imports.schema";
import { CheckboxRow, ChoiceField, TextOption } from "../data-export/export-wizard-steps";

/**
 * As etapas do assistente "Importar dados" (RN-IMPORT-003 a 013), só de propriedades: quem tem o estado é o `createImportFlow` (`import-flow.ts`), que o
 * `ImportWizard` lê. A etapa Carga e o Mapeamento servem também à cópia para outro banco (RN-IMPORT-024 e 025).
 */

const f = dataImportCopy.file;
const p = dataImportCopy.preview;
const m = dataImportCopy.mapping;
const l = dataImportCopy.load;

/** O texto com um nome isolado do texto em volta (`<bdi>`): o nome do arquivo ou de uma coluna pode ter marca de direção (RN-IMPORT-003). */
export function isolated(text: string, name: string): ReactNode {
  const at = name === "" ? -1 : text.indexOf(name);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <bdi>{name}</bdi>
      {text.slice(at + name.length)}
    </>
  );
}

/** Os avisos no tom de atenção, como os da Confirmação do "Exportar dados". */
export function Warnings({ warnings }: { warnings: readonly string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {warnings.map((warning) => (
        <li key={warning} className="flex items-start gap-2 rounded-md border border-accent/50 bg-accent/10 px-3 py-2 text-sm text-ink">
          <span aria-hidden className="mt-1.5 size-2 flex-none rounded-full bg-accent" />
          {warning}
        </li>
      ))}
    </ul>
  );
}

/**
 * RN-IMPORT-003: o campo do arquivo: escolher, a cópia com a porcentagem e "Cancelar", o escolhido com o tamanho e "Trocar arquivo…", e as recusas no lugar.
 * Com o diálogo do sistema aberto, o campo continua o de antes, com o botão em `aria-disabled` (o mesmo elemento, que não perde o foco). O que segura o
 * "Avançar" aqui fica à vista, no campo (RN-IMPORT-002): "Escolha o arquivo a importar." e "Espere a cópia do arquivo terminar.". O `buttonRef` vai ao
 * botão do campo, qualquer que seja, para quem o abriu devolver o foco a ele quando o diálogo fecha.
 */
export function FileField({ source, onChoose, onCancelCopy, buttonRef }: { source: FileSource; onChoose: () => void; onCancelCopy: () => void; buttonRef?: Ref<HTMLButtonElement> }) {
  const problemId = useId();
  const choosing = source.status === "choosing";
  const shown = heldSource(source);
  const choose = () => {
    if (!choosing) onChoose();
  };
  switch (shown.status) {
    case "copying": {
      const percent = copyPercent(shown.copied, shown.size);
      return (
        <div className="flex flex-col items-start gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 text-ink">{isolated(f.copying(shown.fileName, percent), shown.fileName)}</span>
            <span role="progressbar" aria-label={f.copyProgressLabel(shown.fileName)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="relative h-1.5 w-32 flex-none overflow-hidden rounded-full bg-border-strong">
              <span style={{ width: `${percent}%` }} className="absolute inset-y-0 left-0 rounded-full bg-accent" />
            </span>
            <Button ref={buttonRef} type="button" variant="secondary" size="compact" onClick={onCancelCopy}>
              {f.cancelCopy}
            </Button>
          </div>
          <p className="text-sm text-muted">{f.waitCopy}</p>
        </div>
      );
    }
    case "ready":
      return (
        <div className="flex flex-wrap items-center gap-3">
          <span className="min-w-0 text-ink">{isolated(f.chosen(shown.fileName, formatFileSize(shown.size)), shown.fileName)}</span>
          <Button ref={buttonRef} type="button" variant="secondary" size="compact" onClick={choose} aria-disabled={choosing || undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            <UploadIcon />
            {f.change}
          </Button>
        </div>
      );
    case "none":
    case "failed": {
      const problem = shown.status === "none" ? shown.problem : shown.message;
      return (
        <div className="flex flex-col items-start gap-2">
          <Button ref={buttonRef} type="button" variant="secondary" size="compact" onClick={choose} aria-disabled={choosing || undefined} aria-describedby={problemId} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            <UploadIcon />
            {f.choose}
          </Button>
          {problem === null ? (
            <p id={problemId} className="text-sm text-muted">
              {f.chooseFirst}
            </p>
          ) : (
            <FieldError id={problemId}>{problem}</FieldError>
          )}
        </div>
      );
    }
  }
}

const formats: readonly ImportFormat[] = ["csv", "tsv", "json", "xlsx"];

/** As opções do CSV e do TSV (RN-IMPORT-004), com o que a leitura automática achou ao lado do campo. */
function DelimitedOptions({
  format,
  choices,
  onChange,
  detectedEncoding,
  detectedDelimiter,
  problems,
}: {
  format: "csv" | "tsv";
  choices: CsvChoices | DelimitedChoices;
  onChange: (change: Partial<CsvChoices>) => void;
  detectedEncoding: string | null;
  detectedDelimiter: string | null;
  problems: Record<string, string>;
}) {
  const csv = format === "csv" ? (choices as CsvChoices) : null;
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <ChoiceField
          label={f.encoding}
          value={choices.encoding}
          options={importEncodings.map((value) => ({ value, label: f.encodings[value] }))}
          onChange={(encoding) => onChange({ encoding })}
          hint={choices.encoding === "auto" && detectedEncoding !== null ? f.detectedEncoding(detectedEncoding) : undefined}
        />
        {csv === null ? null : (
          <ChoiceField
            label={f.delimiter}
            value={csv.delimiter}
            options={(["auto", ";", ",", "\t", "|"] as const).map((value) => ({ value, label: f.delimiters[value] }))}
            onChange={(delimiter) => onChange({ delimiter })}
            hint={csv.delimiter === "auto" && detectedDelimiter !== null ? f.detectedDelimiter(delimiterText(detectedDelimiter)) : undefined}
          />
        )}
        <ChoiceField label={f.quote} value={choices.quote} options={(["double", "none"] as const).map((value) => ({ value, label: f.quotes[value] }))} onChange={(quote) => onChange({ quote })} />
        <TextOption label={f.nullText} value={choices.nullText} onChange={(nullText) => onChange({ nullText })} error={problems["reader.nullText"]} hint={f.nullTextHint} />
      </div>
      <CheckboxRow label={f.header} checked={choices.header} onChange={(header) => onChange({ header })} />
      <CheckboxRow label={f.emptyAsNull} checked={choices.emptyAsNull} onChange={(emptyAsNull) => onChange({ emptyAsNull })} hint={f.emptyAsNullHint} />
      <CheckboxRow label={f.trim} checked={choices.trim} onChange={(trim) => onChange({ trim })} />
      <CheckboxRow label={f.skipEmptyLines} checked={choices.skipEmptyLines} onChange={(skipEmptyLines) => onChange({ skipEmptyLines })} />
      <CheckboxRow label={f.unguardFormulas} checked={choices.unguardFormulas} onChange={(unguardFormulas) => onChange({ unguardFormulas })} hint={f.unguardFormulasHint} />
    </>
  );
}

/** As opções do XLSX (RN-IMPORT-006): a planilha (as ocultas marcadas), o cabeçalho e as linhas vazias. */
function XlsxOptions({ choices, sheet, sheets, onChange, onSheet }: { choices: XlsxChoices; sheet: string | null; sheets: readonly { name: string; hidden: boolean }[]; onChange: (change: Partial<XlsxChoices>) => void; onSheet: (sheet: string) => void }) {
  const id = useId();
  const options: SelectOption[] = sheets.map((candidate) => ({ value: candidate.name, label: candidate.hidden ? f.hiddenSheet(candidate.name) : candidate.name, content: <bdi>{candidate.hidden ? f.hiddenSheet(candidate.name) : candidate.name}</bdi> }));
  return (
    <>
      {sheets.length === 0 ? null : (
        <div className="flex max-w-80 flex-col gap-1.5">
          <label htmlFor={id} className="text-sm text-muted">
            {f.sheet}
          </label>
          <Select id={id} value={sheet ?? ""} options={options} onChange={onSheet} />
        </div>
      )}
      <CheckboxRow label={f.header} checked={choices.header} onChange={(header) => onChange({ header })} />
      <CheckboxRow label={f.skipEmptyLines} checked={choices.skipEmptyLines} onChange={(skipEmptyLines) => onChange({ skipEmptyLines })} />
    </>
  );
}

/** RN-IMPORT-007: os formatos dos valores. */
function ValuesOptions({ values, onChange }: { values: ImportValues; onChange: (change: Partial<ImportValues>) => void }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-4">
        <ChoiceField label={f.decimal} value={values.decimal} options={(["point", "comma"] as const).map((value) => ({ value, label: f.decimals[value] }))} onChange={(decimal) => onChange({ decimal })} />
        <ChoiceField label={f.dates} value={values.dates} options={(["iso", "dayMonthYear"] as const).map((value) => ({ value, label: f.dateFormats[value] }))} onChange={(dates) => onChange({ dates })} />
      </div>
      {values.decimal === "comma" ? <CheckboxRow label={f.thousandsDot} checked={values.thousandsDot} onChange={(thousandsDot) => onChange({ thousandsDot })} hint={f.thousandsDotHint} /> : null}
      <p className="text-sm text-muted">{f.valuesHint}</p>
    </fieldset>
  );
}

/** O nulo como a grade o mostra, nas prévias. */
function NullCell({ text }: { text: string }) {
  return <span className="text-subtle italic">{text}</span>;
}

/** RN-IMPORT-007: a prévia do arquivo, as primeiras 20 linhas como foram lidas, com a linha do arquivo à esquerda e a linha completada com nulo marcada. */
export function FilePreview({ format, read, header, nullText }: { format: ImportFormat; read: ImportRead; header: boolean; nullText: string }) {
  const shown = read.columns.slice(0, read.shownColumns);
  const hidden = hiddenColumnsNote(read.columns.length, read.shownColumns);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-body">{detectionLine(format, read)}</p>
      {read.rows.length === 0 ? (
        <FormMessage tone="warning">{p.noRows}</FormMessage>
      ) : (
        <div className="max-h-64 overflow-auto rounded-md border border-border-strong">
          <table className="border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr>
                <th scope="col" className="border-b border-border px-2 py-1 text-left text-xs font-medium text-muted">
                  {format === "json" ? p.item : p.line}
                </th>
                {shown.map((name, index) => (
                  <th key={index} scope="col" className="border-b border-border px-2 py-1 text-left font-mono text-xs font-medium whitespace-nowrap text-ink">
                    <bdi>{name}</bdi>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {read.rows.map((row) => {
                const note = row.short ? shortRowText(row, read.columns.length, header) : null;
                return (
                  <tr key={row.line} title={note ?? undefined} className={cn(row.short && "bg-accent/10")}>
                    <th scope="row" className="border-b border-border px-2 py-1 text-left font-mono text-xs font-normal text-muted">
                      {row.line}
                      {note === null ? null : <span className="sr-only">{note}</span>}
                    </th>
                    {shown.map((_name, index) => {
                      const value = row.values[index] ?? null;
                      return (
                        <td key={index} className="max-w-60 truncate border-b border-border px-2 py-1 font-mono text-xs text-ink">
                          {value === null ? <NullCell text={nullText} /> : previewText(value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {read.rows.some((row) => row.short) ? (
        <ul className="flex flex-col gap-1">
          {read.rows
            .filter((row) => row.short)
            .map((row) => (
              <li key={row.line} className="text-sm text-accent">
                {shortRowText(row, read.columns.length, header)}
              </li>
            ))}
        </ul>
      ) : null}
      {hidden === null ? null : <p className="text-sm text-muted">{hidden}</p>}
    </div>
  );
}

export type FileStepProps = {
  source: FileSource;
  format: ImportFormat;
  choices: ImportChoices;
  sheet: string | null;
  read: ReadState;
  shown: ImportRead | null;
  problems: Record<string, string>;
  nullText: string;
  onChoose: () => void;
  onCancelCopy: () => void;
  onFormat: (format: ImportFormat) => void;
  onCsv: (change: Partial<CsvChoices>) => void;
  onTsv: (change: Partial<DelimitedChoices>) => void;
  onXlsx: (change: Partial<XlsxChoices>) => void;
  onSheet: (sheet: string) => void;
  onValues: (change: Partial<ImportValues>) => void;
  onRetryRead: () => void;
  /** O botão do campo do arquivo, para o foco voltar a ele quando o diálogo do sistema fecha. */
  fileButtonRef?: Ref<HTMLButtonElement>;
};

/** RN-IMPORT-003 a 007: o arquivo, o formato, as opções do leitor, os formatos dos valores e a prévia do arquivo. */
export function FileStep(props: FileStepProps) {
  const { source, format, choices, read, shown } = props;
  const titleId = useId();
  // Com o diálogo do sistema aberto sobre o arquivo pronto, a prévia dele continua na etapa.
  const readable = heldSource(source).status === "ready";
  const header = format === "csv" ? choices.csv.header : format === "tsv" ? choices.tsv.header : format === "xlsx" ? choices.xlsx.header : true;
  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2" aria-labelledby={`${titleId}-file`}>
        <h3 id={`${titleId}-file`} className="font-medium">
          {f.label}
        </h3>
        <FileField source={source} onChoose={props.onChoose} onCancelCopy={props.onCancelCopy} {...(props.fileButtonRef === undefined ? {} : { buttonRef: props.fileButtonRef })} />
      </section>

      <section className="flex flex-col gap-2" aria-labelledby={`${titleId}-format`}>
        <h3 id={`${titleId}-format`} className="font-medium">
          {f.format}
        </h3>
        <Segmented aria-labelledby={`${titleId}-format`}>
          {formats.map((candidate) => (
            <button key={candidate} type="button" aria-pressed={candidate === format} onClick={() => props.onFormat(candidate)} className={cn(segmentedItem({ active: candidate === format }), "h-8")}>
              {f.formats[candidate]}
            </button>
          ))}
        </Segmented>
      </section>

      <section className="flex flex-col gap-3">
        {format === "csv" || format === "tsv" ? (
          <DelimitedOptions
            format={format}
            choices={format === "csv" ? choices.csv : choices.tsv}
            onChange={(change) => (format === "csv" ? props.onCsv(change) : props.onTsv(change))}
            detectedEncoding={shown?.encoding === null || shown?.encoding === undefined ? null : encodingText(shown.encoding.name, shown.encoding.bom)}
            detectedDelimiter={shown?.delimiter ?? null}
            problems={props.problems}
          />
        ) : format === "xlsx" ? (
          <XlsxOptions choices={choices.xlsx} sheet={props.sheet} sheets={shown?.sheets ?? []} onChange={props.onXlsx} onSheet={props.onSheet} />
        ) : (
          <p className="text-sm text-muted">{f.jsonNone}</p>
        )}
      </section>

      <ValuesOptions values={choices.values} onChange={props.onValues} />

      {readable ? (
        <section className="flex flex-col gap-2" aria-labelledby={`${titleId}-preview`} aria-busy={read.status === "reading"}>
          <h3 id={`${titleId}-preview`} className="font-medium">
            {p.title}
          </h3>
          {read.status === "refused" ? (
            <FormMessage tone="error">{read.message}</FormMessage>
          ) : read.status === "failed" ? (
            <div className="flex flex-col items-start gap-2">
              <Button type="button" variant="secondary" size="compact" onClick={props.onRetryRead}>
                {m.retry}
              </Button>
            </div>
          ) : (
            <>
              {read.status === "reading" || read.status === "idle" ? (
                <p role="status" className="text-sm text-muted">
                  {p.reading}
                </p>
              ) : null}
              {shown === null ? null : (
                <div className={cn(read.status === "reading" && "opacity-60")}>
                  <FilePreview format={format} read={shown} header={header} nullText={props.nullText} />
                </div>
              )}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** As opções da escolha de uma coluna do arquivo: "Não importar" e as colunas da tabela, na ordem do catálogo, com o tipo, a marca e o motivo de não valer. */
export function targetOptions(table: Pick<ImportTable, "columns">, engine: Engine | undefined, pairBlocker: (column: TableColumn) => string | null = () => null): SelectOption[] {
  return [
    { value: "", label: m.skip },
    ...table.columns.map((column): SelectOption => {
      const blocker = columnBlocker(column, pairBlocker(column));
      const mark = columnMark(column);
      const details = [column.type, mark === null ? null : markLabel[mark]].filter((part) => part !== null).join(" · ");
      const note = columnNote(column, engine);
      return { value: column.name, label: column.name, disabled: blocker !== null, hint: [details, blocker ?? note].filter((part) => part !== null && part !== "").join(" — ") };
    }),
  ];
}

export type MappingSource = { name: string; first?: string | null; detail?: string };

export type MappingStepProps = {
  copy: boolean;
  place: { schema: string; table: string };
  engine: Engine | undefined;
  table: ImportTable | null;
  sources: readonly MappingSource[];
  targets: Targets | null;
  /** As colunas do arquivo que o automático deixou sem, porque duas da tabela casam (a dica). */
  ambiguous: ReadonlySet<number>;
  /** Na cópia: o par que não vale (o binário de um lado só) e a nota da conversão, por coluna da origem e coluna da tabela. */
  pairBlocker?: (source: number, column: TableColumn) => string | null;
  pairNote?: (source: number, column: TableColumn) => string | null;
  /** O que a etapa espera ("Lendo as colunas de …", "Atualizando a prévia…"), na linha de estado, e não no tom de erro; nulo quando não espera nada. */
  loading: string | null;
  refusal: { message: string; retry: boolean; driverID?: string } | null;
  moved: string | null;
  busy: boolean;
  warnings: readonly string[];
  /** A recusa do mapeamento que segura o "Avançar" ("Escolha ao menos uma coluna…"), embaixo da lista; a da tabela vem em `refusal`. */
  problem: string | null;
  onTarget: (source: number, target: string | null) => void;
  onByName: () => void;
  onNone: () => void;
  onRetry: () => void;
  /** A prévia convertida, só na importação. */
  preview?: ReactNode;
};

type MappingRowProps = {
  index: number;
  name: string;
  first: string | null | undefined;
  detail: string | undefined;
  target: string | null;
  type: string | undefined;
  options: SelectOption[];
  hint: string | null;
  hintId: string;
  busy: boolean;
  onTarget: (source: number, target: string | null) => void;
};

/**
 * Uma linha do mapeamento: a coluna do arquivo (ou da origem), a escolha da coluna da tabela e o tipo dela. Só com propriedades simples, para a escolha numa
 * linha não redesenhar as outras: com milhares de colunas, a lista rola sem travar (RN-IMPORT-009). Ocupada (o automático a caminho), a escolha fica em
 * `aria-disabled`, sem perder o foco.
 */
const MappingRow = memo(function MappingRow({ index, name, first, detail, target, type, options, hint, hintId, busy, onTarget }: MappingRowProps) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,8rem)] items-start gap-3 rounded px-2 py-1.5 [contain-intrinsic-size:auto_3rem] [content-visibility:auto] hover:bg-selected">
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-ink" title={name}>
          <bdi>{name}</bdi>
        </span>
        {first === undefined ? null : <span className="truncate font-mono text-xs text-subtle">{first === null ? "NULL" : <bdi>{previewText(first)}</bdi>}</span>}
        {detail === undefined ? null : <span className="truncate font-mono text-xs text-subtle">{detail}</span>}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <Select
          value={target ?? ""}
          options={options}
          onChange={(value) => onTarget(index, value === "" ? null : value)}
          aria-disabled={busy}
          aria-label={m.choiceLabel(name)}
          aria-describedby={hint === null ? undefined : hintId}
          className="min-h-8 py-1 text-sm"
        />
        {hint === null ? null : (
          <span id={hintId} className="text-xs text-accent">
            {hint}
          </span>
        )}
      </span>
      <span className="truncate pt-1.5 font-mono text-xs text-muted" title={type}>
        {type ?? ""}
      </span>
    </li>
  );
});

/** RN-IMPORT-009 e 024: a lista do mapeamento, o que fica com o padrão, os avisos e, na importação, a prévia convertida. */
export function MappingStep(props: MappingStepProps) {
  const { table, targets, sources, engine, pairBlocker } = props;
  const titleId = useId();
  const problemId = useId();
  // As opções da escolha, montadas uma vez por tabela: na importação, as mesmas em todas as linhas; na cópia, uma lista por coluna da origem (o par que
  // não vale muda com ela).
  const shared = useMemo(() => (table === null || pairBlocker !== undefined ? null : targetOptions(table, engine)), [table, engine, pairBlocker]);
  const perSource = useMemo(
    () => (table === null || pairBlocker === undefined ? null : sources.map((_source, index) => targetOptions(table, engine, (column) => pairBlocker(index, column)))),
    [table, engine, pairBlocker, sources],
  );
  if (props.refusal !== null && table === null) {
    return (
      <div className="flex flex-col items-start gap-2">
        <FormMessage tone="error">{props.refusal.message}</FormMessage>
        {props.refusal.driverID === undefined ? null : <InstallDriverLink driverID={props.refusal.driverID} />}
        {props.refusal.retry ? (
          <Button type="button" variant="secondary" size="compact" onClick={props.onRetry}>
            {m.retry}
          </Button>
        ) : null}
      </div>
    );
  }
  if (table === null || targets === null) {
    return (
      <p role="status" className="text-muted">
        {props.loading ?? m.loading(props.place.schema, props.place.table)}
      </p>
    );
  }
  const byName = new Map(table.columns.map((column) => [column.name, column]));
  const staying = stayingDefaults(table, targets);
  const busyClick = (action: () => void) => () => {
    if (!props.busy) action();
  };
  return (
    <div className="flex flex-col gap-5">
      {props.refusal === null ? null : (
        <div className="flex flex-col items-start gap-2">
          <FormMessage tone="error">{props.refusal.message}</FormMessage>
          {props.refusal.retry ? (
            <Button type="button" variant="secondary" size="compact" onClick={props.onRetry}>
              {m.retry}
            </Button>
          ) : null}
        </div>
      )}
      <section className="flex flex-col gap-2" aria-labelledby={`${titleId}-title`} aria-busy={props.busy}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${titleId}-title`} className="mr-auto font-medium">
            {m.title}
          </h3>
          <Button type="button" variant="secondary" size="compact" onClick={busyClick(props.onByName)} aria-disabled={props.busy || undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            {m.byName}
          </Button>
          <Button type="button" variant="secondary" size="compact" onClick={busyClick(props.onNone)} aria-disabled={props.busy || undefined} className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
            {m.none}
          </Button>
        </div>
        <p role="status" aria-live="polite" className="min-h-5 text-sm text-body">
          {props.moved ?? props.loading ?? ""}
        </p>
        {/* Os títulos das colunas da lista; cada escolha já tem o nome acessível dela ("Coluna da tabela para …"). */}
        <div aria-hidden className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,8rem)] gap-3 px-3 text-xs text-muted">
          <span>{props.copy ? m.sourceColumn : m.fileColumn}</span>
          <span>{m.tableColumn}</span>
          <span>{m.type}</span>
        </div>
        {/* A lista rola, e o Tab anda pelas escolhas; com milhares de colunas, cada linha fora da vista não é desenhada (`content-visibility`). */}
        <ul aria-describedby={props.problem === null ? undefined : problemId} className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border border-border-strong p-1">
          {sources.map((source, index) => {
            const target = targets[index] ?? null;
            const chosen = target === null ? undefined : byName.get(target);
            const note = chosen === undefined ? null : (props.pairNote?.(index, chosen) ?? columnNote(chosen, engine));
            const hints = [props.ambiguous.has(index) && target === null ? m.ambiguous : null, note].filter((hint): hint is string => hint !== null);
            return (
              <MappingRow
                key={index}
                index={index}
                name={source.name}
                first={source.first}
                detail={source.detail}
                target={target}
                type={chosen?.type}
                options={shared ?? perSource?.[index] ?? []}
                hint={hints.length === 0 ? null : hints.join(" ")}
                hintId={`${titleId}-hint-${index}`}
                busy={props.busy}
                onTarget={props.onTarget}
              />
            );
          })}
        </ul>
        <FieldError id={problemId}>{props.problem ?? undefined}</FieldError>
      </section>

      {staying.length === 0 ? null : (
        <section className="flex flex-col gap-1">
          <h3 className="text-sm text-muted">{m.defaults}</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {staying.map((column) => (
              <li key={column.name} className="font-mono text-ink">
                {column.name} <span className="text-muted">· {column.value}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Warnings warnings={props.warnings} />
      {props.preview ?? null}
    </div>
  );
}

/** RN-IMPORT-011: a prévia convertida, com o resumo em cima, o que a prévia confere e as células e linhas que não convertem marcadas, com o motivo. */
export function ConvertedPreview({ preview, engine, nullText, loading }: { preview: ImportPreview; engine: Engine | undefined; nullText: string; loading: boolean }) {
  const shown = preview.mapping.slice(0, preview.shownColumns);
  const summary = previewSummary(preview.rows);
  const hidden = hiddenColumnsNote(preview.mapping.length, preview.shownColumns);
  return (
    <section className={cn("flex flex-col gap-2", loading && "opacity-60")} aria-busy={loading}>
      <h3 className="font-medium">{m.previewTitle}</h3>
      <p role="status" className={cn("text-sm", summary.stopLine === null ? "text-body" : "text-danger")}>
        {previewSummaryText(summary)}
      </p>
      <p className="text-sm text-muted">{engine === 1 || engine === undefined ? m.checksPostgres : m.checksIbm}</p>
      <div className="max-h-64 overflow-auto rounded-md border border-border-strong">
        <table className="border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 bg-panel">
            <tr>
              <th scope="col" className="border-b border-border px-2 py-1 text-left text-xs font-medium text-muted">
                {p.line}
              </th>
              {shown.map((entry) => (
                <th key={entry.target} scope="col" className="border-b border-border px-2 py-1 text-left font-mono text-xs font-medium whitespace-nowrap text-ink">
                  <bdi>{entry.target}</bdi>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const rowProblem = row.problem ?? null;
              return (
                <tr key={row.line} title={rowProblem ?? undefined} className={cn(rowProblem !== null ? "bg-danger/15" : row.short && "bg-accent/10")}>
                  <th scope="row" className="border-b border-border px-2 py-1 text-left font-mono text-xs font-normal text-muted">
                    {row.line}
                    {rowProblem === null ? null : <span className="sr-only">{`${m.rowProblem}: ${rowProblem}`}</span>}
                  </th>
                  {shown.map((entry, index) => {
                    const cell = row.cells[index];
                    const problem = cell?.problem ?? null;
                    return (
                      <td key={entry.target} title={problem ?? undefined} className={cn("max-w-60 truncate border-b border-border px-2 py-1 font-mono text-xs", problem === null ? "text-ink" : "bg-danger/15 text-danger")}>
                        {cell === undefined || cell.value === null ? <NullCell text={nullText} /> : previewText(cell.value)}
                        {problem === null ? null : <span className="sr-only">{` ${problem}`}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hidden === null ? null : <p className="text-sm text-muted">{hidden}</p>}
    </section>
  );
}

export type LoadStepProps = {
  copy: boolean;
  table: Pick<ImportTable, "schema" | "name" | "referencedBy" | "oneAtATime">;
  engine: Engine | undefined;
  empty: boolean;
  commit: { commit: "every" | "single"; commitEvery: string };
  /** "Conferir o arquivo inteiro antes de gravar": só na importação (nulo na cópia). */
  check: boolean | null;
  problem: string | null;
  onEmpty: (empty: boolean) => void;
  onCommit: (change: Partial<{ commit: "every" | "single"; commitEvery: string }>) => void;
  onCheck: (check: boolean) => void;
};

/** RN-IMPORT-012 e 025: "Esvaziar a tabela antes", o "Commit", a conferência do arquivo (só na importação) e o que acontece quando uma linha falha. */
export function LoadStep(props: LoadStepProps) {
  const { table, copy, commit } = props;
  const id = useId();
  const oneAtATime = table.oneAtATime;
  const warnings = loadWarnings(table, { empty: props.empty, commit }, copy);
  const informix = informixNote(props.engine);
  return (
    <div className="flex flex-col gap-5">
      <CheckboxRow label={copy ? l.emptyCopy : l.empty} checked={props.empty} onChange={props.onEmpty} hint={l.emptyHint(table.schema, table.name, copy)} />

      <fieldset className="flex flex-col gap-2" disabled={oneAtATime} aria-describedby={props.problem === null ? undefined : `${id}-error`}>
        <legend className="mb-1 text-sm text-muted">{l.commit}</legend>
        <label className={cn("flex items-start gap-2.5 text-ink", oneAtATime ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
          <input type="radio" name={`${id}-commit`} checked={commit.commit === "every"} onChange={() => props.onCommit({ commit: "every" })} aria-describedby={`${id}-every`} className="mt-[3px] size-4 flex-none accent-accent" />
          <span className="flex flex-wrap items-center gap-2">
            {l.every}
            <input
              type="text"
              inputMode="numeric"
              aria-label={l.everyLabel}
              aria-invalid={props.problem === null ? undefined : true}
              aria-describedby={props.problem === null ? undefined : `${id}-error`}
              value={commit.commitEvery}
              onChange={(event) => props.onCommit({ commit: "every", commitEvery: event.target.value })}
              className="h-7 w-28 rounded-md border border-border-strong bg-background px-2 text-sm text-ink aria-invalid:border-danger"
            />
            {l.everyRows}
          </span>
        </label>
        <p id={`${id}-every`} className="pl-6.5 text-sm text-muted">
          {l.everyHint(copy)}
        </p>
        <FieldError id={`${id}-error`} className="pl-6.5">
          {props.problem ?? undefined}
        </FieldError>
        <label className={cn("flex items-start gap-2.5 text-ink", oneAtATime ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
          <input type="radio" name={`${id}-commit`} checked={commit.commit === "single"} onChange={() => props.onCommit({ commit: "single" })} aria-describedby={`${id}-single`} className="mt-[3px] size-4 flex-none accent-accent" />
          <span>{l.single}</span>
        </label>
        <p id={`${id}-single`} className="pl-6.5 text-sm text-muted">
          {l.singleHint(copy)}
        </p>
      </fieldset>

      {props.check === null ? null : <CheckboxRow label={l.check} checked={props.check} onChange={props.onCheck} hint={l.checkHint} />}

      <section className="flex flex-col gap-1">
        <h3 className="text-sm text-muted">{l.onFailure}</h3>
        <p className="text-sm text-ink">{l.onFailureText(copy)}</p>
      </section>

      <Warnings warnings={warnings} />
      {informix === null ? null : <p className="text-sm text-muted">{informix}</p>}
    </div>
  );
}
