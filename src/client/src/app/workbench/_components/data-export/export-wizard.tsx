import { useId, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup } from "@/app/connections/_lib/environment";
import { readOnlyHintOf } from "@/app/connections/_lib/protections";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { Button, Dialog, DownloadIcon } from "@/components/ui";
import { chooseExportDestination, currentWindowId, releaseExportDestination, transfersAvailable } from "@/lib/api/bridge";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { allowRefusal, ApiRequestError } from "@/lib/api/prism-api";
import { cn } from "@/lib/utils/cn";

import { dataExportCopy } from "../../_lib/data-export/data-export.copy";
import { readExportChoices, writeExportChoices } from "../../_lib/data-export/export-choices";
import { closeExportWizard, exportTracker, type ExportWizardRequest } from "../../_lib/data-export/data-exports";
import { defaultOptions, formatSentence, isTextFormat, type FormatOptions } from "../../_lib/data-export/export-options";
import { exportRequest, maxRequestBytes, requestBytes } from "../../_lib/data-export/export-request";
import { knowsGenerated, originName, originSchema, progressName, sourceTitle, targetDefaults, toastSubject, type SourceColumn } from "../../_lib/data-export/export-source";
import {
  canVisit,
  choicesToRemember,
  chosenColumns,
  draftOf,
  droppedGenerated,
  extractionProblem,
  fileNamesOf,
  formattingProblemsOf,
  nextStep,
  placeRefusals,
  previousStep,
  refusalsOf,
  resetFormat,
  stepOfField,
  stepProblem,
  usesClipboard,
  wizardSteps,
  type WizardChoices,
  type WizardContext,
  type WizardRefusal,
  type WizardStep,
} from "../../_lib/data-export/export-wizard";
import { startExport, startRefusals } from "../../_lib/data-export/transfers.service";
import { columnsQuery } from "../../_lib/table-structure.service";
import { ConfirmationStep, ExportConnection, ExtractionStep, FormatStep, FormattingStep, OutputStep, type SummaryLine } from "./export-wizard-steps";

const w = dataExportCopy.wizard;
const c = dataExportCopy.confirmation;

/** As colunas do catálogo na ordem dele (a posição), como a exportação as numera na tabela pelo navegador (RN-EXPORT-002). */
const byPosition = (columns: readonly { name: string; type: string; position: number; generated?: "always" | "byDefault" | null }[]): SourceColumn[] =>
  [...columns].sort((a, b) => a.position - b.position).map(({ name, type, generated }) => ({ name, type, generated: generated ?? null }));

/**
 * O assistente "Exportar dados" (RN-EXPORT-003 a 015): o diálogo grande, com as cinco etapas à esquerda e a etapa à direita. Um por janela
 * (`openExportWizard`), aberto com a origem já escolhida. Cancelar, Esc e o X fecham sem perguntar; de "Exportar" até a resposta da API (o diálogo de
 * salvar do sistema e o pedido) ele não fecha. Aceito o pedido (202), fecha, e a exportação aparece na barra de status.
 */
export function ExportWizard({ request }: { request: ExportWizardRequest }) {
  const { source } = request;
  const { origin } = source;
  const queryClient = useQueryClient();
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  const session = useQuery({ ...sessionQuery, staleTime: Infinity });
  const userName = session.data?.userName ?? null;
  const connection = connections.data?.find((candidate) => candidate.id === source.connectionId);
  const engine = connection?.engine;
  const idPrefix = useId();

  // As colunas da tabela pelo navegador vêm do catálogo, pela sessão da árvore, lidas ao abrir (RN-EXPORT-005); nos Registros o catálogo só diz quais o banco
  // calcula (o SQL as deixa de fora, RN-EXPORT-011), e as colunas são as do resultado na tela.
  const catalog = useQuery(columnsQuery(source.connectionId, origin.kind === "result" ? "" : origin.schema, origin.kind === "result" ? "" : origin.name, queryClient, origin.kind !== "result", source.database));
  const columns = useMemo<readonly SourceColumn[] | null>(() => {
    if (origin.kind === "table") return catalog.data === undefined ? null : byPosition(catalog.data);
    if (source.columns === null) return null;
    if (origin.kind === "records" && catalog.data !== undefined) {
      const generated = new Map(catalog.data.map((column) => [column.name, column.generated ?? null]));
      return source.columns.map((column) => ({ ...column, generated: generated.get(column.name) ?? null }));
    }
    return source.columns;
  }, [origin.kind, catalog.data, source.columns]);
  const loadError = origin.kind === "table" && catalog.isError && !catalog.isFetching ? catalogMessage(catalog.error) : null;
  // Nos Registros, quais colunas o banco calcula vem do catálogo; sem a resposta dele, o SQL sem "Incluir as colunas que o banco calcula" espera (RN-EXPORT-011).
  const generatedFailed = origin.kind === "records" && catalog.data === undefined && catalog.isError && !catalog.isFetching;
  const generatedUnknown = origin.kind !== "records" || catalog.data !== undefined ? null : generatedFailed ? catalogMessage(catalog.error) : dataExportCopy.extraction.loading;

  const [choices, setChoices] = useState<WizardChoices>(() => ({ ...readExportChoices(userName, targetDefaults(origin)), checked: null }));
  // As colunas chegam (ou já estavam): todas marcadas ao abrir. Ajuste durante a renderização: a etapa nunca mostra a lista sem as caixas.
  if (columns !== null && (choices.checked === null || choices.checked.length !== columns.length)) setChoices({ ...choices, checked: columns.map(() => true) });

  const [step, setStep] = useState<WizardStep>("format");
  const [exporting, setExporting] = useState(false);
  const [refusals, setRefusals] = useState<readonly WizardRefusal[]>([]);
  const context: WizardContext = { origin, engine, columns, generatedUnknown };
  const clipboard = usesClipboard(choices);

  /** Toda mudança nas escolhas tira as recusas que vieram da API: elas eram do pedido de antes. */
  const change = (next: Partial<WizardChoices>) => {
    setChoices((current) => ({ ...current, ...next }));
    setRefusals([]);
  };

  // As recusas de campo da API, cada uma no campo dela (RN-EXPORT-015); as outras, no alto da Confirmação.
  const apiProblems = Object.fromEntries(refusals.filter((refusal) => refusal.field !== null).map((refusal) => [refusal.field as string, refusal.message]));
  const topRefusals = refusals.filter((refusal) => refusal.field === null);
  const problem = stepProblem(step, choices, context);
  const values = { tabela: originName(origin), esquema: originSchema(origin), conexao: connection?.name ?? "" };
  const names = fileNamesOf(choices, values, new Date());

  function goTo(target: WizardStep) {
    setStep(target);
  }

  function advance() {
    if (stepProblem(step, choices, context) !== null) return;
    const next = nextStep(step);
    if (next !== null) setStep(next);
  }

  async function submit() {
    setRefusals([]);
    const windowId = currentWindowId();
    // RN-EXPORT-019: fora do Electron não há destino nem área de transferência, e nada é pedido à API.
    if (!transfersAvailable() || windowId === null) {
      setRefusals([{ field: null, message: c.outsideElectron }]);
      return;
    }

    setExporting(true);
    let destination: { destinationId: string; fileName: string } | null = null;
    const release = () => (destination === null ? Promise.resolve() : releaseExportDestination(destination.destinationId));
    try {
      const fileNames = fileNamesOf(choices, values, new Date());
      if (!clipboard) {
        const reply = await chooseExportDestination({ suggestedName: fileNames.suggestedName, extension: fileNames.zip ? "zip" : fileNames.extension });
        // Desistir do diálogo de salvar deixa o assistente como estava.
        if (reply.status === "canceled") return;
        if (reply.status !== "chosen") {
          setRefusals([{ field: null, message: reply.status === "notWritable" ? c.notWritable : reply.status === "inUse" ? c.inUse : c.destinationFailed }]);
          return;
        }
        destination = { destinationId: reply.destinationId, fileName: reply.fileName };
      }

      const body = exportRequest(draftOf(choices, { ...context, connectionId: source.connectionId, ...(source.database === undefined ? {} : { database: source.database }), windowId, entryName: fileNames.entryName }));
      if (requestBytes(body) > maxRequestBytes) {
        await release();
        setRefusals([{ field: null, message: c.tooLarge }]);
        return;
      }

      // As recusas que o assistente mostra voltam como valor; o resto (a API fora do ar, o cofre indisponível) vai ao aviso central pelo cache de mutações.
      const result = await throughMutationCache(queryClient, async () => allowRefusal(await startExport(body), ...startRefusals));
      if (!result.ok) {
        await release();
        const shown = placeRefusals(refusalsOf(result.error), choices.format, engine);
        setRefusals(shown);
        setStep(stepOfField(shown[0]?.field ?? null));
        return;
      }

      writeExportChoices(userName, choicesToRemember(choices));
      exportTracker.start({
        id: result.data.id,
        name: progressName(origin),
        subject: toastSubject(origin),
        connectionId: source.connectionId,
        format: choices.format,
        clipboard,
        reveal: !clipboard && choices.reveal,
        destinationId: destination?.destinationId ?? null,
        fileName: destination?.fileName ?? null,
        suggested: clipboard ? null : { suggestedName: fileNames.suggestedName, extension: fileNames.zip ? "zip" : fileNames.extension },
      });
      closeExportWizard();
    } catch (error) {
      // A falha que não é recusa já foi ao aviso central (pelo cache de mutações); o destino escolhido não fica preso.
      await release();
      if (!(error instanceof ApiRequestError)) console.error("[prism] exportar dados:", error);
    } finally {
      setExporting(false);
    }
  }

  const connectionLine =
    connection === undefined ? null : (
      <ExportConnection
        engine={connection.engine}
        name={connection.name}
        database={source.database ?? connection.database}
        environment={environmentLookup(folders.data ?? []).connection(connection)}
        readOnlyHint={readOnlyHintOf(connection.protections, folders.data ?? [])}
      />
    );
  const header = (
    <div className="flex flex-col gap-1.5">
      <span className="text-body">{sourceTitle(origin)}</span>
      {connectionLine}
    </div>
  );

  const last = step === "confirmation";
  const footer = (
    <>
      <Button type="button" variant="secondary" className="mr-auto" onClick={closeExportWizard} disabled={exporting}>
        {w.cancel}
      </Button>
      <Button type="button" variant="secondary" onClick={() => goTo(previousStep(step) ?? step)} disabled={step === "format" || exporting}>
        {w.back}
      </Button>
      {last ? (
        <Button type="button" onClick={() => void submit()} disabled={exporting}>
          <DownloadIcon />
          {exporting ? (clipboard ? w.copying : w.exporting) : clipboard ? w.copy : w.export}
        </Button>
      ) : (
        <Button type="button" onClick={advance} disabled={problem !== null} title={problem ?? undefined}>
          {w.next}
        </Button>
      )}
    </>
  );

  return (
    <Dialog open title={w.title} size="lg" description={header} pending={exporting} onClose={closeExportWizard} footer={footer}>
      <div className="flex min-h-[420px] gap-6">
        <nav aria-label={w.stepsLabel} className="w-36 flex-none">
          <ol className="flex flex-col gap-1">
            {wizardSteps.map((candidate, index) => {
              const current = candidate === step;
              const visitable = canVisit(candidate, step) && !exporting;
              return (
                <li key={candidate}>
                  <button
                    type="button"
                    aria-current={current ? "step" : undefined}
                    disabled={!current && !visitable}
                    onClick={() => (visitable ? goTo(candidate) : undefined)}
                    className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm", current ? "bg-selected font-semibold text-ink" : visitable ? "cursor-pointer text-body hover:bg-selected" : "cursor-default text-subtle")}
                  >
                    <span aria-hidden className={cn("flex size-5 flex-none items-center justify-center rounded-full border text-xs", current ? "border-accent text-accent" : "border-border-strong")}>
                      {index + 1}
                    </span>
                    {w.steps[candidate]}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="min-w-0 flex-1">{stepBody()}</div>
      </div>
    </Dialog>
  );

  function stepBody(): ReactNode {
    switch (step) {
      case "format":
        return <FormatStep format={choices.format} idPrefix={idPrefix} onChoose={(format) => change({ format })} onAdvance={advance} />;
      case "extraction":
        return (
          <ExtractionStep
            origin={origin}
            columns={columns}
            loadError={loadError}
            onRetry={() => void catalog.refetch()}
            checked={choices.checked}
            onToggle={(index, value) => change({ checked: (choices.checked ?? []).map((old, at) => (at === index ? value : old)) })}
            onAll={(value) => change({ checked: (choices.checked ?? []).map(() => value) })}
            count={choices.count}
            onCount={(count) => change({ count })}
            problem={extractionProblem(choices, context, apiProblems.columns ?? null)}
          />
        );
      case "formatting":
        return (
          <FormattingStep
            format={choices.format}
            options={choices.options}
            onChange={(options: FormatOptions) => change({ options })}
            problems={{ ...formattingProblemsOf(choices, context), ...apiProblems }}
            informix={engine === 3}
            showGenerated={knowsGenerated(origin)}
            onRetryGenerated={generatedFailed ? () => void catalog.refetch() : null}
            onReset={() => change({ options: resetFormat(choices.options, choices.format, defaultOptions(targetDefaults(origin))) })}
          />
        );
      case "output":
        return (
          <OutputStep
            format={choices.format}
            choices={{ pattern: choices.pattern, bom: choices.bom[choices.format], zip: choices.zip, reveal: choices.reveal, clipboard: choices.clipboard }}
            onChange={(next) => change({ ...next, ...(next.bom === undefined ? {} : { bom: { ...choices.bom, [choices.format]: next.bom } }) } as Partial<WizardChoices>)}
            preview={names.fileName}
            problem={apiProblems["output.entryName"] ?? problem}
          />
        );
      case "confirmation":
        return <ConfirmationStep refusals={topRefusals} lines={summaryLines()} warnings={warnings()} />;
    }
  }

  function summaryLines(): SummaryLine[] {
    const total = columns?.length ?? 0;
    const chosen = chosenColumns(choices, context);
    const originLine =
      origin.kind === "table"
        ? { label: c.origin, value: c.allRowsOf(origin.schema, origin.name) }
        : origin.kind === "records"
          ? { label: c.origin, value: origin.filter === "" ? c.allRowsOf(origin.schema, origin.name) : c.recordsOf(origin.schema, origin.name), hint: origin.filter === "" ? undefined : origin.filter }
          : { label: c.origin, value: `${sourceTitle(origin)} · ${origin.sql.slice(0, 80)}${origin.sql.length > 80 ? "…" : ""}`, hint: origin.sql };
    const text = isTextFormat(choices.format);
    const outputParts = clipboard ? [c.clipboard] : [names.fileName, text && choices.bom[choices.format] ? c.utf8Bom : c.utf8, ...(names.zip ? [c.zipped] : []), ...(choices.reveal ? [c.revealed] : [])];
    return [
      originLine,
      { label: c.connection, value: connectionLine ?? "" },
      { label: c.columns, value: `${chosen.length === total ? c.allColumns(total) : c.someColumns(chosen.length, total)} · ${choices.count ? c.counts : c.noCount}`, hint: chosen.map((column) => column.name).join(", ") },
      { label: c.format, value: formatSentence(choices.format, choices.options, engine) },
      { label: c.output, value: outputParts.join(" · ") },
    ];
  }

  function warnings(): string[] {
    const list: string[] = [c.rereadWarning];
    if (source.unsavedEdits > 0) list.push(c.unsavedWarning(source.unsavedEdits));
    const dropped = droppedGenerated(choices, context);
    if (dropped.length > 0) list.push(c.generatedWarning(dropped));
    if (choices.format === "sql" && engine === 3 && choices.options.sql.binary === "literal" && chosenColumns(choices, context).some((column) => isBinaryType(columns?.[column.position]?.type))) list.push(c.informixBinary);
    return list;
  }
}

/** A mensagem do banco quando há (o `detail` da API), senão a frase da tela: a falha de ler as colunas fica na etapa, com "Tentar de novo". */
function catalogMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.error.detail ?? error.error.title;
  return dataExportCopy.extraction.loadFailed;
}

/** Os tipos de binário do Informix (`BYTE`, `BLOB`): as linhas com eles saem como comentário no SQL (RN-EXPORT-011). */
function isBinaryType(type: string | undefined): boolean {
  return type !== undefined && /^(byte|blob)\b/i.test(type.trim());
}
