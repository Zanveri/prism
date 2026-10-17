import { useId, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup } from "@/app/connections/_lib/environment";
import { readOnlyHintOf } from "@/app/connections/_lib/protections";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { Button, DatabaseIcon, Dialog, DownloadIcon } from "@/components/ui";
import { chooseExportDestination, currentWindowId, releaseExportDestination, transfersAvailable } from "@/lib/api/bridge";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { allowRefusal, ApiRequestError } from "@/lib/api/prism-api";
import { cn } from "@/lib/utils/cn";

import { loadQuestion } from "../../_lib/command-confirmation";
import { dataExportCopy } from "../../_lib/data-export/data-export.copy";
import { readExportChoices, writeExportChoices } from "../../_lib/data-export/export-choices";
import { closeExportWizard, exportTracker, type ExportWizardRequest } from "../../_lib/data-export/data-exports";
import { defaultOptions, formatSentence, isTextFormat, type FormatOptions } from "../../_lib/data-export/export-options";
import { exportRequest, maxRequestBytes, requestBytes } from "../../_lib/data-export/export-request";
import { knowsGenerated, originName, originSchema, progressName, sourceTitle, targetDefaults, toastSubject, type SourceColumn } from "../../_lib/data-export/export-source";
import {
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
  stepsOf,
  usesClipboard,
  type WizardChoices,
  type WizardContext,
  type WizardRefusal,
  type WizardStep,
} from "../../_lib/data-export/export-wizard";
import { startExport, startRefusals } from "../../_lib/data-export/transfers.service";
import { copyRefusalsOf, copyStartRequest, originSql, readsTable, stepOfCopyField } from "../../_lib/data-import/copy-wizard";
import { dataImportCopy } from "../../_lib/data-import/data-import.copy";
import { loadTracker } from "../../_lib/data-import/data-imports";
import { commitProblem, loadSummary, loadWarnings } from "../../_lib/data-import/import-load";
import { columnsSummary, deletePreview, insertPreview, mappingWarnings, noneMappedProblem } from "../../_lib/data-import/import-mapping";
import { importRequestBytes, maxImportRequestBytes } from "../../_lib/data-import/import-request";
import { copyStartRefusals, startCopy } from "../../_lib/data-import/imports.service";
import { inDatabase } from "../../_lib/navigator-model";
import { columnsQuery } from "../../_lib/table-structure.service";
import { unsavedEdits } from "../../_lib/unsaved-edits";
import { useCommandConfirmation } from "../../_lib/use-command-confirmation";
import { useWorkbench } from "../../_lib/workbench-state";
import { ConfirmCommandDialog } from "../confirm-command-dialog";
import { CopyTargetStep } from "../data-import/copy-target-step";
import { LoadStep, MappingStep } from "../data-import/import-wizard-steps";
import { useCopyWizard } from "../data-import/use-copy-wizard";
import { CheckboxRow, ConfirmationStep, ExportConnection, ExtractionStep, FormatStep, FormattingStep, OutputStep, type SummaryLine } from "./export-wizard-steps";
import { WizardStepsNav } from "./wizard-steps-nav";

const w = dataExportCopy.wizard;
const c = dataExportCopy.confirmation;
const ct = dataImportCopy.copyTarget;
const ic = dataImportCopy.confirmation;
const q = dataImportCopy.question;

/** As etapas da exportação e as da cópia, com os nomes de cada uma (RN-EXPORT-003 e RN-IMPORT-022). */
const stepNames: Record<WizardStep, string> = { ...w.steps, ...ct.steps };

/** As colunas do catálogo na ordem dele (a posição), como a exportação as numera na tabela pelo navegador (RN-EXPORT-002). */
const byPosition = (columns: readonly { name: string; type: string; position: number; generated?: "always" | "byDefault" | null }[]): SourceColumn[] =>
  [...columns].sort((a, b) => a.position - b.position).map(({ name, type, generated }) => ({ name, type, generated: generated ?? null }));

/**
 * O assistente "Exportar dados" (RN-EXPORT-003 a 015): o diálogo grande, com as cinco etapas à esquerda e a etapa à direita. Um por janela
 * (`openExportWizard`), aberto com a origem já escolhida. Cancelar, Esc e o X fecham sem perguntar; de "Exportar" até a resposta da API (o diálogo de
 * salvar do sistema e o pedido) ele não fecha. Aceito o pedido (202), fecha, e a exportação aparece na barra de status.
 *
 * Com o destino "Banco de dados" (RN-IMPORT-022 a 025), as etapas são seis ("Tabela de destino", "Mapeamento" e "Carga" no lugar de "Formatação" e
 * "Saída"), o estado da cópia é do `useCopyWizard`, e "Copiar linhas" pergunta pelas proteções da conexão de destino (RN-PROT-001) antes do pedido.
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
  const database = choices.database;
  const steps = stepsOf(database);

  // O destino "Banco de dados" (RN-IMPORT-022 a 025): a tabela de destino, o mapeamento, a carga e a pergunta das proteções da conexão de destino.
  const chosen = chosenColumns(choices, context);
  const copy = useCopyWizard({ source, sourceEngine: engine, sourceColumns: columns, chosen, active: database, step });
  const confirmation = useCommandConfirmation(copy.target.connectionId, copy.target.database);
  const [asking, setAsking] = useState(false);
  const busy = exporting || asking;
  const { tabs } = useWorkbench();

  /** Toda mudança nas escolhas tira as recusas que vieram da API: elas eram do pedido de antes. */
  const change = (next: Partial<WizardChoices>) => {
    setChoices((current) => ({ ...current, ...next }));
    setRefusals([]);
  };

  // As recusas de campo da API, cada uma no campo dela (RN-EXPORT-015); as outras, no alto da Confirmação.
  const apiProblems = Object.fromEntries(refusals.filter((refusal) => refusal.field !== null).map((refusal) => [refusal.field as string, refusal.message]));
  const topRefusals = refusals.filter((refusal) => refusal.field === null);
  const problem = database ? copyStepProblem(step) : stepProblem(step, choices, context);
  const values = { tabela: originName(origin), esquema: originSchema(origin), conexao: connection?.name ?? "" };
  const names = fileNamesOf(choices, values, new Date());

  function goTo(target: WizardStep) {
    setStep(target);
  }

  /** O que segura cada etapa da cópia: a Extração é a da exportação; as outras são do destino (RN-IMPORT-022 a 025). */
  function copyStepProblem(at: WizardStep): string | null {
    switch (at) {
      case "target":
        return copy.targetProblem;
      case "mapping":
        return copy.mappingProblem;
      case "load":
        return commitProblem(choices.copyLoad, copy.table?.oneAtATime ?? false);
      case "confirmation":
        return copy.empty && !copy.understood ? ic.understandFirst : null;
      default:
        return stepProblem(at, choices, context);
    }
  }

  function advance() {
    if (problem !== null) return;
    const next = nextStep(step, steps);
    if (next === null) return;
    setStep(next);
    // A prévia da cópia é pedida ao entrar no Mapeamento; a caixa do esvaziamento vem desmarcada cada vez que a Confirmação abre (RN-IMPORT-013 e 025).
    if (database && next === "mapping") void copy.loadPreview();
    if (database && next === "confirmation") copy.resetUnderstood();
  }

  /**
   * "Copiar linhas" (RN-IMPORT-025): a pergunta da RN-PROT-001 da conexão de DESTINO (em "Só comandos irreversíveis", só com o esvaziamento), o tamanho do
   * pedido e o `POST api/user/transfers/copies`. A cópia não passa pelo processo principal e funciona também fora do Electron (RN-EXPORT-019).
   */
  function copyRows() {
    if (busy || problem !== null || copy.apiTarget === null || copy.table === null) return;
    const qualified = `${copy.apiTarget.schema}.${copy.apiTarget.table}`;
    const sourceName = origin.kind === "result" ? progressName(origin) : `${origin.schema}.${origin.name}`;
    const commands = [...(copy.empty ? [deletePreview(copy.apiTarget.schema, copy.apiTarget.table)] : []), insertPreview(copy.apiTarget.schema, copy.apiTarget.table, copy.targetsNow())];
    setAsking(true);
    confirmation.confirm(
      (protections) =>
        loadQuestion(protections, {
          empty: copy.empty,
          title: copy.empty ? q.emptyAndCopy : q.copy,
          does: copy.empty ? q.emptyDoes(qualified, sourceName) : q.writeDoes(sourceName, qualified),
          commands,
          confirm: q.confirmCopy,
        }),
      () => {
        setAsking(false);
        void submitCopy();
      },
      () => setAsking(false),
    );
  }

  async function submitCopy() {
    const target = copy.apiTarget;
    const table = copy.table;
    if (target === null || table === null) return;
    setRefusals([]);
    // Fora do Electron (só em desenvolvimento) não há número de janela: a cópia vale ali também, com o 1.
    const windowId = currentWindowId() ?? 1;
    const draft = { connectionId: source.connectionId, ...inDatabase(source.database), origin, columns: chosen };
    const body = copyStartRequest(draft, target, copy.targetsNow(), { empty: copy.empty, commit: choices.copyLoad }, choices.count || copy.countForced !== null, windowId);
    if (importRequestBytes(body) > maxImportRequestBytes) {
      setRefusals([{ field: null, message: c.tooLarge }]);
      return;
    }
    setExporting(true);
    try {
      const result = await throughMutationCache(queryClient, async () => allowRefusal(await startCopy(body), ...copyStartRefusals));
      if (!result.ok) {
        const shown = copyRefusalsOf(result.error);
        setRefusals(shown);
        setStep(stepOfCopyField(shown[0]?.field ?? null));
        return;
      }
      writeExportChoices(userName, choicesToRemember(choices));
      loadTracker.start({
        id: result.data.id,
        kind: "copy",
        sourceName: progressName(origin),
        format: null,
        sheet: null,
        table: { connectionId: target.connectionID, ...inDatabase(target.database), schema: target.schema, name: target.table },
        oneAtATime: table.oneAtATime,
        empty: copy.empty,
        single: choices.copyLoad.commit === "single",
      });
      closeExportWizard();
    } catch (error) {
      // A falha que não é recusa já foi ao aviso central (pelo cache de mutações).
      if (!(error instanceof ApiRequestError)) console.error("[prism] copiar linhas:", error);
    } finally {
      setExporting(false);
    }
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
      <Button type="button" variant="secondary" className="mr-auto" onClick={closeExportWizard} disabled={busy}>
        {w.cancel}
      </Button>
      <Button type="button" variant="secondary" onClick={() => goTo(previousStep(step, steps) ?? step)} disabled={step === "format" || busy}>
        {w.back}
      </Button>
      {last && database ? (
        <Button type="button" onClick={copyRows} disabled={busy || problem !== null} title={problem ?? undefined}>
          <DatabaseIcon />
          {busy ? ct.copying : ct.copyRows}
        </Button>
      ) : last ? (
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
    <>
      <Dialog open title={w.title} size="lg" description={header} pending={busy} onClose={closeExportWizard} footer={footer}>
        <div className="flex min-h-[420px] gap-6">
          <WizardStepsNav label={w.stepsLabel} steps={steps} names={stepNames} current={step} locked={busy} onVisit={goTo} />
          <div className="min-w-0 flex-1">{stepBody()}</div>
        </div>
      </Dialog>
      {confirmation.open === null ? null : <ConfirmCommandDialog {...confirmation.open} />}
    </>
  );

  function stepBody(): ReactNode {
    switch (step) {
      case "format":
        return <FormatStep format={choices.format} database={database} idPrefix={idPrefix} onChoose={(format) => change({ format, database: false })} onDatabase={() => change({ database: true })} onAdvance={advance} />;
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
            countLocked={database ? copy.countForced : null}
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
      case "target":
        return (
          <CopyTargetStep
            connections={copy.connections}
            connectionId={copy.target.connectionId}
            onConnection={copy.chooseConnection}
            databases={copy.databaseList}
            onDatabase={copy.chooseDatabase}
            schemas={copy.schemaNames}
            schema={copy.target.schema}
            onSchema={copy.chooseSchema}
            tables={copy.tableNames}
            table={copy.target.table}
            onTable={copy.chooseTable}
            search={copy.search}
            onSearch={copy.setSearch}
            waiting={copy.waiting}
            failure={copy.failure}
            problem={copy.waiting !== null || copy.failure !== null ? null : copy.targetProblem}
          />
        );
      case "mapping": {
        const refusal = copy.preview.status === "refused" ? copy.preview : null;
        return (
          <MappingStep
            copy
            place={{ schema: copy.apiTarget?.schema ?? "", table: copy.apiTarget?.table ?? "" }}
            engine={copy.targetEngine}
            table={copy.table}
            sources={copy.names.map((name, index) => ({ name, detail: copy.sourceTypes[index] }))}
            targets={copy.targets}
            ambiguous={copy.ambiguous}
            pairBlocker={copy.pairBlocker}
            pairNote={copy.pairNote}
            loading={copy.preview.status === "loading" ? copy.mappingProblem : null}
            refusal={refusal === null ? null : { message: refusal.message, retry: refusal.retry, ...(refusal.driverID === undefined ? {} : { driverID: refusal.driverID }) }}
            moved={copy.moved}
            busy={copy.preview.status === "loading"}
            warnings={copy.table === null ? [] : mappingWarnings(copy.table, copy.targetsNow(), { engine: copy.targetEngine, copy: true })}
            problem={copy.targets === null || copy.preview.status !== "done" ? null : noneMappedProblem(copy.targets)}
            onTarget={copy.setTarget}
            onByName={copy.mapByName}
            onNone={copy.mapNone}
            onRetry={() => void copy.loadPreview(true)}
          />
        );
      }
      case "load":
        return copy.table === null ? null : (
          <LoadStep
            copy
            table={copy.table}
            engine={copy.targetEngine}
            empty={copy.empty}
            commit={choices.copyLoad}
            check={null}
            problem={refusals.find((refusal) => refusal.field === "load.commitEvery")?.message ?? problem}
            onEmpty={copy.setEmpty}
            onCommit={(next) => change({ copyLoad: { ...choices.copyLoad, ...next } })}
            onCheck={() => {}}
          />
        );
      case "confirmation":
        return database ? (
          <ConfirmationStep refusals={topRefusals} lines={copySummaryLines()} warnings={copyWarnings()} after={understand()} />
        ) : (
          <ConfirmationStep refusals={topRefusals} lines={summaryLines()} warnings={warnings()} />
        );
    }
  }

  /** A linha "Origem" da Confirmação (RN-EXPORT-015), a mesma da exportação e da cópia. */
  function originLine(): SummaryLine {
    return origin.kind === "table"
      ? { label: c.origin, value: c.allRowsOf(origin.schema, origin.name) }
      : origin.kind === "records"
        ? { label: c.origin, value: origin.filter === "" ? c.allRowsOf(origin.schema, origin.name) : c.recordsOf(origin.schema, origin.name), hint: origin.filter === "" ? undefined : origin.filter }
        : { label: c.origin, value: `${sourceTitle(origin)} · ${origin.sql.slice(0, 80)}${origin.sql.length > 80 ? "…" : ""}`, hint: origin.sql };
  }

  /** O resumo da cópia (RN-IMPORT-025): a origem e a conexão, como na exportação, com a contagem; o destino; as colunas; e a carga. */
  function copySummaryLines(): SummaryLine[] {
    const origin = originLine();
    const counted = choices.count || copy.countForced !== null;
    const target = copy.entry?.connection;
    const columns = columnsSummary(copy.names, copy.targetsNow(), copy.table?.columns.length ?? 0, true);
    return [
      { ...origin, value: `${String(origin.value)} · ${counted ? c.counts : c.noCount}` },
      { label: c.connection, value: connectionLine ?? "" },
      {
        label: ic.target,
        value: (
          <span className="flex flex-col gap-1">
            {target === undefined ? null : (
              <ExportConnection engine={target.engine} name={target.name} database={copy.target.database ?? target.database} environment={copy.entry?.environment ?? null} readOnlyHint={copy.entry?.readOnly ?? null} />
            )}
            <span className="font-mono">{copy.apiTarget === null ? "" : `${copy.apiTarget.schema}.${copy.apiTarget.table}`}</span>
          </span>
        ),
      },
      { label: ic.columns, value: columns.text, hint: columns.pairs },
      { label: ic.load, value: loadSummary({ empty: copy.empty, commit: choices.copyLoad, check: null }, copy.table?.oneAtATime ?? false) },
    ];
  }

  /**
   * Os avisos da cópia (RN-IMPORT-025): os da exportação que valem para a origem (a leitura de novo e as alterações não salvas da grade), os da importação
   * que valem para o destino (o mapeamento, o esvaziamento, o Informix sem log, os Registros da tabela de destino com alterações não salvas) e o comando da
   * origem que lê a tabela de destino.
   */
  function copyWarnings(): string[] {
    const list: string[] = [ct.rereadWarning];
    if (source.unsavedEdits > 0) list.push(ct.unsavedSource(source.unsavedEdits));
    const table = copy.table;
    const target = copy.apiTarget;
    if (table === null || target === null) return list;
    list.push(...mappingWarnings(table, copy.targetsNow(), { engine: copy.targetEngine, copy: true }));
    list.push(...loadWarnings(table, { empty: copy.empty, commit: choices.copyLoad }, true).filter((warning) => warning !== dataImportCopy.load.emptyWarning(target.schema, target.table, true)));
    const unsaved = tabs
      .filter((tab) => tab.connectionId === target.connectionID && tab.table?.schema === target.schema && tab.table.name === target.table && (tab.database ?? undefined) === target.database)
      .reduce((total, tab) => total + unsavedEdits.countOf(tab.id), 0);
    if (unsaved > 0) list.push(ic.unsaved(target.table, unsaved, copy.empty, true));
    const sql = originSql(origin);
    if (sql !== null && !copy.isSource && readsTable(sql, target.table)) list.push(ct.readsTarget(target.table));
    return list;
  }

  /** Com "Esvaziar", a caixa "Entendo que as linhas atuais de dw.pedido_hist serão apagadas.", que segura o "Copiar linhas" até ser marcada. */
  function understand(): ReactNode {
    if (!copy.empty || copy.apiTarget === null) return null;
    return (
      <div className={cn("rounded-md border px-3 py-2", copy.understood ? "border-border" : "border-danger/40")}>
        <CheckboxRow label={ic.understand(copy.apiTarget.schema, copy.apiTarget.table)} checked={copy.understood} onChange={copy.setUnderstood} error={copy.understood ? undefined : ic.understandFirst} />
      </div>
    );
  }

  function summaryLines(): SummaryLine[] {
    const total = columns?.length ?? 0;
    const text = isTextFormat(choices.format);
    const outputParts = clipboard ? [c.clipboard] : [names.fileName, text && choices.bom[choices.format] ? c.utf8Bom : c.utf8, ...(names.zip ? [c.zipped] : []), ...(choices.reveal ? [c.revealed] : [])];
    return [
      originLine(),
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
