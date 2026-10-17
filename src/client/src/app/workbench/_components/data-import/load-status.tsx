import { Button, DatabaseIcon, Dialog, UploadIcon, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { dataImportCopy } from "../../_lib/data-import/data-import.copy";
import { loadTracker, openLoadRecords } from "../../_lib/data-import/data-imports";
import { failurePlace, loadEntryView, type TrackedLoad } from "../../_lib/data-import/load-tracker";
import { isolatedNames, smallButton, TransferProgress } from "../data-export/transfer-progress";

const st = dataImportCopy.status;
const fc = dataImportCopy.failure;
const t = dataImportCopy.toasts;

type LoadEntryProps = {
  entry: TrackedLoad;
  wide?: boolean;
  /** "Cancelar": quem mostra a barra pergunta antes, quando algo já ficaria na tabela (`loadTracker.cancelQuestion`). */
  onCancel: (id: string) => void;
  /** "Ver o erro": o diálogo "Importação interrompida" (ou "Cópia interrompida"). */
  onShowError: (id: string) => void;
};

/**
 * Uma importação ou cópia na barra de status (RN-IMPORT-019 e 027): a seta para cima (na cópia, o banco de dados), o texto pela fase com os nomes isolados
 * (`<bdi>`) e o inteiro na dica, a barra de progresso e "Cancelar" com o nome acessível. A que parou é a entrada da falha (RN-IMPORT-020): "A importação para
 * pedido parou." com "Ver o erro" e "Descartar", sem barra; a que não se sabe como está fica sem barra, com "Cancelar".
 */
export function LoadEntry({ entry, wide = false, onCancel, onShowError }: LoadEntryProps) {
  const view = loadEntryView(entry);
  const copy = entry.kind === "copy";
  const Icon = copy ? DatabaseIcon : UploadIcon;
  const failed = entry.stage === "failed";
  return (
    <span className={cn("flex h-6 min-w-0 items-center gap-2", wide ? "w-full" : "max-w-[30rem]")}>
      <Icon className="size-3.5 flex-none" />
      <span title={view.hint} className="min-w-0 truncate text-ink">
        {isolatedNames(view.text, view.names)}
      </span>
      {failed || entry.stage === "lost" ? null : <TransferProgress label={copy ? st.copyProgressLabel(entry.sourceName) : st.importProgressLabel(entry.sourceName)} percent={view.percent} hint={view.hint} />}
      {failed ? (
        <>
          <Button type="button" variant="secondary" size="compact" className={smallButton} onClick={() => onShowError(entry.id)}>
            {st.showError}
          </Button>
          <Button type="button" variant="secondary" size="compact" className={smallButton} onClick={() => loadTracker.discard(entry.id)}>
            {st.discard}
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="compact"
          className={smallButton}
          aria-label={copy ? st.cancelCopyLabel(entry.sourceName) : st.cancelImportLabel(entry.sourceName)}
          aria-disabled={view.busy || undefined}
          onClick={() => (view.busy ? undefined : onCancel(entry.id))}
        >
          {st.cancel}
        </Button>
      )}
    </span>
  );
}

/** As linhas do diálogo da falha, na ordem: o arquivo (ou a origem), a tabela, a linha, a coluna, o SQLSTATE e o que ficou. A mensagem vem à parte. */
export function failureLines(entry: TrackedLoad): { label: string; value: string }[] {
  const failure = entry.failure;
  const copy = entry.kind === "copy";
  const lines: { label: string; value: string }[] = [
    { label: copy ? fc.source : fc.file, value: entry.sourceName },
    { label: fc.table, value: `${entry.table.schema}.${entry.table.name}` },
  ];
  if (failure === null) return lines;
  const place = failurePlace(entry, failure.line, null);
  if (place !== null) lines.push({ label: fc.line, value: place });
  if (failure.column !== null) lines.push({ label: fc.column, value: failure.column });
  if (failure.sqlState !== null) lines.push({ label: fc.sqlState, value: failure.sqlState });
  lines.push({ label: fc.stayed, value: failure.stayed });
  return lines;
}

/**
 * "Ver o erro" (RN-IMPORT-020): o diálogo "Importação interrompida" ("Cópia interrompida"), com o arquivo (ou a origem), a tabela, a linha, a coluna, a
 * mensagem inteira, como veio do banco, que dá para copiar, o SQLSTATE e o que ficou; "Abrir registros" e "Fechar", que nasce com o foco. A mensagem vai
 * como texto (RN-SQL-009), com as quebras de linha dela.
 */
export function LoadFailureDialog({ entry, onClose }: { entry: TrackedLoad; onClose: () => void }) {
  const toast = useToast();
  const copy = entry.kind === "copy";
  const failure = entry.failure;
  const side = failure === null || !copy || failure.side === null ? null : failure.side === "source" ? t.readingSource : t.writingTarget;

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(failure?.message ?? "");
      toast.success(fc.copied);
    } catch {
      toast.error(fc.notCopied);
    }
  }

  return (
    <Dialog
      open
      size="lg"
      title={copy ? fc.copyTitle : fc.importTitle}
      description={copy ? st.failedCopy(entry.sourceName, entry.table.name) : st.failedImport(entry.table.name)}
      onClose={onClose}
      footer={
        <>
          <Button autoFocus type="button" variant="secondary" onClick={onClose}>
            {fc.close}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onClose();
              openLoadRecords(entry.table);
            }}
          >
            {t.openRecords}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-2">
          {failureLines(entry).map((line) => (
            <div key={line.label} className="contents">
              <dt className="text-sm text-muted">{line.label}</dt>
              <dd className="text-sm break-words text-ink">
                <bdi>{line.value}</bdi>
              </dd>
            </div>
          ))}
        </dl>
        {failure === null ? null : (
          <section className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-danger">{fc.message}</h3>
              <Button type="button" variant="secondary" size="compact" className="ml-auto h-7 px-2.5 text-xs" onClick={() => void copyMessage()}>
                {fc.copyMessage}
              </Button>
            </div>
            {side === null ? null : <p className="text-sm text-muted">{side}</p>}
            <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs break-words whitespace-pre-wrap text-ink">{failure.message}</pre>
          </section>
        )}
      </div>
    </Dialog>
  );
}
