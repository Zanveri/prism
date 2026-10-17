import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup } from "@/app/connections/_lib/environment";
import { readOnlyHintOf } from "@/app/connections/_lib/protections";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button, Dialog, UploadIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { loadQuestion } from "../../_lib/command-confirmation";
import { dataImportCopy } from "../../_lib/data-import/data-import.copy";
import { closeImportWizard, useImportWizard, type ImportWizardRequest } from "../../_lib/data-import/data-imports";
import { formatFileSize } from "../../_lib/data-export/transfer-tracker";
import { encodingText, delimiterText } from "../../_lib/data-import/import-file";
import { importStepProblem, mappingProgress, mapsByName, previewTable, shownPreview, shownRead, type ImportFlowState } from "../../_lib/data-import/import-flow";
import { loadSummary, loadWarnings } from "../../_lib/data-import/import-load";
import { autoTargets, columnsSummary, deletePreview, insertPreview, mappingWarnings, noneMappedProblem, previewSummary } from "../../_lib/data-import/import-mapping";
import { readerProblems, importSteps } from "../../_lib/data-import/import-wizard";
import { unsavedEdits } from "../../_lib/unsaved-edits";
import { useCommandConfirmation } from "../../_lib/use-command-confirmation";
import { useWorkbench } from "../../_lib/workbench-state";
import { ConfirmCommandDialog } from "../confirm-command-dialog";
import { CheckboxRow, ConfirmationStep, ExportConnection, type SummaryLine } from "../data-export/export-wizard-steps";
import { WizardStepsNav } from "../data-export/wizard-steps-nav";
import { ConvertedPreview, FileStep, LoadStep, MappingStep } from "./import-wizard-steps";

const w = dataImportCopy.wizard;
const c = dataImportCopy.confirmation;
const q = dataImportCopy.question;

/** O texto da linha "Arquivo" da Confirmação (RN-IMPORT-013): "pedidos.csv · 1,2 MB · CSV · UTF-8 com BOM · ponto e vírgula · com cabeçalho". */
function fileLine(state: ImportFlowState, size: string): string {
  const read = shownRead(state);
  const source = state.source;
  const name = source.status === "ready" ? source.fileName : "";
  const parts = [name, size, dataImportCopy.file.formats[state.format]];
  if (state.format === "csv" || state.format === "tsv") {
    const choices = state.format === "csv" ? state.choices.csv : state.choices.tsv;
    if (read?.encoding !== null && read?.encoding !== undefined) parts.push(encodingText(read.encoding.name, read.encoding.bom));
    if (read?.delimiter !== null && read?.delimiter !== undefined) parts.push(delimiterText(read.delimiter));
    parts.push(choices.header ? c.withHeader : c.withoutHeader);
  } else if (state.format === "xlsx") {
    parts.push(c.sheet(read?.sheet ?? state.sheet ?? ""), state.choices.xlsx.header ? c.withHeader : c.withoutHeader);
  } else {
    parts.push(read?.listKey === null || read?.listKey === undefined ? c.rootList : c.list(read.listKey));
  }
  return parts.join(" · ");
}

/** A linha "Valores" (RN-IMPORT-013): "decimal com vírgula e ponto de milhar · datas dd/mm/aaaa". */
function valuesLine(state: ImportFlowState): string {
  const values = state.choices.values;
  const decimal = values.decimal === "point" ? c.decimalPoint : values.thousandsDot ? c.decimalCommaThousands : c.decimalComma;
  return `${decimal} · ${c.datesOf(dataImportCopy.file.dateFormats[values.dates])}`;
}

/**
 * O assistente "Importar dados" (RN-IMPORT-002 a 013): o diálogo grande, com as quatro etapas à esquerda e a etapa à direita, a tabela de destino já escolhida.
 * O estado e os pedidos são do `createImportFlow` (criado com o pedido de abrir, em `data-imports.ts`); aqui ficam o desenho e a pergunta da RN-PROT-001 da
 * conexão de destino, antes do "Importar". Cancelar, Esc e o X fecham sem perguntar e soltam o arquivo; de "Importar" até a resposta da API o diálogo não
 * fecha.
 */
export function ImportWizard({ request }: { request: ImportWizardRequest }) {
  const { flow, place } = request;
  const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  const { preferences } = usePreferences();
  const { tabs } = useWorkbench();
  const connection = connections.data?.find((candidate) => candidate.id === place.connectionId);
  const engine = connection?.engine;
  const confirmation = useCommandConfirmation(place.connectionId, place.database);
  const [asking, setAsking] = useState(false);
  const pending = state.starting || asking;
  const fileButton = useRef<HTMLButtonElement>(null);

  const read = shownRead(state);
  const table = previewTable(state);
  const preview = shownPreview(state);
  const targets = useMemo(() => state.targets ?? [], [state.targets]);
  const sources = useMemo(() => read?.columns ?? [], [read]);
  const problem = importStepProblem(state, state.step);
  const qualified = `${place.schema}.${place.name}`;

  // A dica "Mais de uma coluna da tabela casa com este nome.": o automático, com a tabela que a prévia leu, diz quais ficaram sem por isso.
  const byName = mapsByName(state);
  const ambiguous = useMemo(() => (table === null ? new Set<number>() : autoTargets(sources, table, { byName }).ambiguous), [table, sources, byName]);

  // RN-IMPORT-013: a aba de Registros desta tabela, nesta janela, com alterações não salvas.
  const unsaved = tabs
    .filter((tab) => tab.connectionId === place.connectionId && tab.table?.schema === place.schema && tab.table.name === place.name && (tab.database ?? undefined) === place.database)
    .reduce((total, tab) => total + unsavedEdits.countOf(tab.id), 0);

  const connectionLine =
    connection === undefined ? null : (
      <ExportConnection
        engine={connection.engine}
        name={connection.name}
        database={place.database ?? connection.database}
        environment={environmentLookup(folders.data ?? []).connection(connection)}
        readOnlyHint={readOnlyHintOf(connection.protections, folders.data ?? [])}
      />
    );
  const header = (
    <div className="flex flex-col gap-1.5">
      <span className="text-body">{w.target(place.schema, place.name)}</span>
      {connectionLine}
    </div>
  );

  /**
   * "Escolher arquivo…" e "Trocar arquivo…": o diálogo do sistema. Quando ele fecha, o botão que tinha o foco pode ter saído da página (a cópia começou, e o
   * campo mostra "Cancelar"): o foco vai ao botão do campo, e não fica no `body`. Conferido no fim do evento, depois de a etapa se desenhar de novo.
   */
  function chooseFile() {
    void flow.chooseFile().then(() =>
      setTimeout(() => {
        const lost = document.activeElement === null || document.activeElement === document.body;
        if (lost) fileButton.current?.focus({ preventScroll: true });
      }, 0),
    );
  }

  /** "Importar": a pergunta da RN-PROT-001 da conexão de destino (em "Só comandos irreversíveis", só com o esvaziamento), e então o pedido. */
  function importNow() {
    if (pending || importStepProblem(state, "confirmation") !== null) return;
    const source = state.source;
    const fileName = source.status === "ready" ? source.fileName : "";
    const commands = [...(state.empty ? [deletePreview(place.schema, place.name)] : []), insertPreview(place.schema, place.name, targets)];
    setAsking(true);
    confirmation.confirm(
      (protections) =>
        loadQuestion(protections, {
          empty: state.empty,
          title: state.empty ? q.emptyAndImport : q.import,
          does: state.empty ? q.emptyDoes(qualified, fileName) : q.writeDoes(fileName, qualified),
          commands,
          confirm: q.confirmImport,
        }),
      () => {
        setAsking(false);
        void flow.submit();
      },
      () => setAsking(false),
    );
  }

  const last = state.step === "confirmation";
  const footer = (
    <>
      <Button type="button" variant="secondary" className="mr-auto" onClick={closeImportWizard} disabled={pending}>
        {w.cancel}
      </Button>
      <Button type="button" variant="secondary" onClick={() => flow.goTo(importSteps[importSteps.indexOf(state.step) - 1] ?? state.step)} disabled={state.step === "file" || pending}>
        {w.back}
      </Button>
      {last ? (
        <Button type="button" onClick={importNow} disabled={pending || problem !== null} title={problem ?? undefined}>
          <UploadIcon />
          {pending ? w.importing : w.import}
        </Button>
      ) : (
        <Button type="button" onClick={() => flow.advance()} disabled={problem !== null} title={problem ?? undefined}>
          {w.next}
        </Button>
      )}
    </>
  );

  return (
    <>
      <Dialog open title={w.title} size="lg" description={header} pending={pending} onClose={closeImportWizard} footer={footer}>
        <div className="flex min-h-[420px] gap-6">
          <WizardStepsNav label={w.stepsLabel} steps={importSteps} names={w.steps} current={state.step} locked={pending} onVisit={(step) => flow.goTo(step)} />
          <div className="min-w-0 flex-1">{stepBody()}</div>
        </div>
      </Dialog>
      {confirmation.open === null ? null : <ConfirmCommandDialog {...confirmation.open} />}
    </>
  );

  function stepBody(): ReactNode {
    switch (state.step) {
      case "file":
        return (
          <FileStep
            source={state.source}
            format={state.format}
            choices={state.choices}
            sheet={state.sheet}
            read={state.read}
            shown={read}
            problems={{ ...readerProblems(state.format, state.format === "csv" ? state.choices.csv : state.format === "tsv" ? state.choices.tsv : null), ...(state.read.status === "refused" && state.read.field !== null ? { [state.read.field]: state.read.message } : {}) }}
            nullText={preferences.results.nullText}
            onChoose={chooseFile}
            fileButtonRef={fileButton}
            onCancelCopy={flow.cancelCopy}
            onFormat={flow.setFormat}
            onCsv={flow.setCsv}
            onTsv={flow.setTsv}
            onXlsx={flow.setXlsx}
            onSheet={flow.setSheet}
            onValues={flow.setValues}
            onRetryRead={flow.retryRead}
          />
        );
      case "mapping": {
        const refusal = state.preview.status === "refused" ? state.preview : null;
        const loading = state.preview.status === "loading";
        // Só a recusa do mapeamento fica embaixo da lista; o que a etapa espera vai à linha de estado, e a recusa da tabela, ao alto da etapa.
        const mappingProblem = state.targets === null || state.preview.status !== "done" ? null : noneMappedProblem(state.targets);
        return (
          <MappingStep
            copy={false}
            place={{ schema: place.schema, table: place.name }}
            engine={engine}
            table={table}
            sources={sources.map((name, index) => ({ name, first: read?.rows[0]?.values[index] ?? null }))}
            targets={state.targets}
            ambiguous={ambiguous}
            loading={mappingProgress(state)}
            refusal={refusal === null ? null : { message: refusal.message, retry: refusal.retry, ...(refusal.driverID === undefined ? {} : { driverID: refusal.driverID }) }}
            moved={state.moved}
            busy={loading && state.preview.status === "loading" && state.preview.auto}
            warnings={table === null ? [] : mappingWarnings(table, targets, { engine, copy: false })}
            problem={mappingProblem}
            onTarget={flow.setTarget}
            onByName={flow.mapByName}
            onNone={flow.mapNone}
            onRetry={flow.retryPreview}
            preview={preview === null || targets.every((target) => target === null) ? undefined : <ConvertedPreview preview={preview} engine={engine} nullText={preferences.results.nullText} loading={loading} />}
          />
        );
      }
      case "load":
        return table === null ? null : (
          <LoadStep
            copy={false}
            table={table}
            engine={engine}
            empty={state.empty}
            commit={state.choices.load}
            check={state.choices.load.check}
            problem={state.refusals.find((refusal) => refusal.field === "load.commitEvery")?.message ?? problem}
            onEmpty={flow.setEmpty}
            onCommit={(change) => flow.setLoad(change)}
            onCheck={(check) => flow.setLoad({ check })}
          />
        );
      case "confirmation":
        return <ConfirmationStep refusals={state.refusals.filter((refusal) => refusal.field === null)} lines={summaryLines()} warnings={warnings()} after={understand()} />;
    }
  }

  function summaryLines(): SummaryLine[] {
    const source = state.source;
    const size = source.status === "ready" ? source.size : 0;
    const columns = columnsSummary(sources, targets, table?.columns.length ?? 0, false);
    return [
      { label: c.file, value: fileLine(state, formatFileSize(size)) },
      { label: c.values, value: valuesLine(state) },
      {
        label: c.target,
        value: (
          <span className="flex flex-col gap-1">
            {connectionLine}
            <span className="font-mono">{qualified}</span>
          </span>
        ),
      },
      { label: c.columns, value: columns.text, hint: columns.pairs },
      { label: c.load, value: loadSummary({ empty: state.empty, commit: state.choices.load, check: state.choices.load.check }, table?.oneAtATime ?? false) },
    ];
  }

  function warnings(): string[] {
    if (table === null) return [];
    const list = [...mappingWarnings(table, targets, { engine, copy: false })];
    if (preview !== null) {
      const summary = previewSummary(preview.rows);
      if (summary.stopLine !== null) list.push(c.previewProblems(summary.problems, summary.rows, summary.stopLine));
    }
    // Com "Esvaziar", os das chaves e o do esvaziamento confirmado com as primeiras linhas; no Informix sem log, o da Carga (sem repetir o "serão apagadas").
    list.push(...loadWarnings(table, { empty: state.empty, commit: state.choices.load }, false).filter((warning) => warning !== dataImportCopy.load.emptyWarning(place.schema, place.name, false)));
    if (unsaved > 0) list.push(c.unsaved(place.name, unsaved, state.empty));
    return list;
  }

  function understand(): ReactNode {
    if (!state.empty) return null;
    return (
      <div className={cn("rounded-md border px-3 py-2", state.understood ? "border-border" : "border-danger/40")}>
        <CheckboxRow label={c.understand(place.schema, place.name)} checked={state.understood} onChange={flow.setUnderstood} error={state.understood ? undefined : c.understandFirst} />
      </div>
    );
  }
}

/** O assistente "Importar dados" desta janela, um por vez (RN-IMPORT-002): nasce de novo a cada abertura. */
export function ImportWizardHost() {
  const request = useImportWizard();
  return request === null ? null : <ImportWizard key={request.key} request={request} />;
}
