import { useEffect, useId, useRef, useState } from "react";

import { Button, ConfirmDialog, DownloadIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { dataExportCopy } from "../../_lib/data-export/data-export.copy";
import { exportTracker, useExportWizard, useTrackedExports } from "../../_lib/data-export/data-exports";
import { entryView, type TrackedExport } from "../../_lib/data-export/transfer-tracker";
import { dataImportCopy } from "../../_lib/data-import/data-import.copy";
import { loadTracker, useTrackedLoads } from "../../_lib/data-import/data-imports";
import { barEntries, featuredBarEntry, othersKind, type BarEntry } from "../../_lib/data-import/transfer-bar";
import { LoadEntry, LoadFailureDialog } from "../data-import/load-status";
import { ExportWizard } from "./export-wizard";
import { isolatedNames, smallButton, TransferProgress } from "./transfer-progress";

const st = dataExportCopy.status;

/** Uma exportação: a seta de baixar, o texto (cortado, com o inteiro na dica), a barra de progresso e "Cancelar" (ou "Salvar como…" e "Descartar"). */
export function TransferEntry({ entry, wide = false }: { entry: TrackedExport; wide?: boolean }) {
  const view = entryView(entry);
  const failed = entry.stage === "deliveryFailed";
  // O nome isolado do texto em volta (`<bdi>`): o do arquivo, quando o texto o traz, ou o da origem (RN-EXPORT-021).
  const name = [entry.fileName, entry.name].find((candidate) => candidate !== null && candidate !== "" && view.text.includes(candidate)) ?? null;
  return (
    <span className={cn("flex h-6 min-w-0 items-center gap-2", wide ? "w-full" : "max-w-[30rem]")}>
      <DownloadIcon className="size-3.5 flex-none" />
      <span title={view.hint} className="min-w-0 truncate text-ink">
        {isolatedNames(view.text, [name])}
      </span>
      {failed ? null : <TransferProgress label={st.progressLabel(entry.name)} percent={view.percent} hint={view.hint} />}
      {failed ? (
        <>
          <Button type="button" variant="secondary" size="compact" className={smallButton} aria-disabled={entry.busy || undefined} onClick={() => void exportTracker.saveAs(entry.id)}>
            {st.saveAs}
          </Button>
          <Button type="button" variant="secondary" size="compact" className={smallButton} aria-disabled={entry.busy || undefined} onClick={() => void exportTracker.discard(entry.id)}>
            {st.discard}
          </Button>
        </>
      ) : (
        <Button type="button" variant="secondary" size="compact" className={smallButton} aria-label={st.cancelLabel(entry.name)} aria-disabled={view.busy || undefined} onClick={() => (view.busy ? undefined : void exportTracker.cancel(entry.id))}>
          {st.cancel}
        </Button>
      )}
    </span>
  );
}

/**
 * RN-EXPORT-021: Esc com a lista aberta fecha a lista e devolve o foco ao botão que a abriu. Vale de onde estiver o foco no grupo da barra: no botão, que o
 * guarda ao abrir a lista com Enter ou Espaço, e dentro da lista. Sem a lista aberta, o Esc segue para quem mais o ouve.
 */
export function closeListOnEscape(event: { key: string; stopPropagation(): void }, open: boolean, close: () => void, opener: { focus(): void } | null): void {
  if (!open || event.key !== "Escape") return;
  event.stopPropagation();
  close();
  opener?.focus();
}

/**
 * RN-EXPORT-021 e RN-IMPORT-019: as transferências desta janela na barra de status (as exportações, as importações e as cópias para outro banco), entre o
 * modo de transação e o cofre. A barra continua uma linha de 28 px: aparece uma só (a que pede ação, ou a mais antiga), e, com mais, o botão "+2
 * exportações" ("+2 importações", "+2 cópias", "+2 transferências") abre a lista acima da barra. Esc fecha a lista e devolve o foco ao botão. O progresso não
 * é anunciado a cada passo: o aviso do fim é. O "Cancelar" de uma importação ou cópia pergunta antes quando algo já ficaria na tabela, com o foco e o Esc em
 * "Continuar importando"; "Ver o erro" abre o diálogo da falha.
 */
export function TransferStatus() {
  const exports = useTrackedExports();
  const loads = useTrackedLoads();
  const entries = barEntries(exports, loads);
  const [open, setOpen] = useState(false);
  /** O "Cancelar" de uma importação ou cópia que pergunta antes: o id dela; a pergunta é lida de novo a cada mudança (as linhas confirmadas andam). */
  const [asking, setAsking] = useState<string | null>(null);
  const [failureOf, setFailureOf] = useState<string | null>(null);
  const listId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const featured = featuredBarEntry(entries);
  const others = entries.filter((bar) => bar !== featured);
  if (open && others.length < 1) setOpen(false);

  // O clique fora da lista a fecha (o do botão já alterna).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target !== null && (list.current?.contains(target) || opener.current?.contains(target))) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (featured === null) return null;

  function cancelLoad(id: string) {
    if (loadTracker.cancelQuestion(id) === null) void loadTracker.confirmCancel(id);
    else setAsking(id);
  }

  const renderBar = (bar: BarEntry, wide: boolean) =>
    bar.kind === "export" ? <TransferEntry key={bar.entry.id} entry={bar.entry} wide={wide} /> : <LoadEntry key={bar.entry.id} entry={bar.entry} wide={wide} onCancel={cancelLoad} onShowError={setFailureOf} />;

  // A pergunta e o diálogo valem enquanto a entrada existe (e, na pergunta, enquanto ela ainda pergunta): o fim lido os fecha.
  const question = asking === null ? null : loadTracker.cancelQuestion(asking);
  const failed = failureOf === null ? null : (loads.find((entry) => entry.id === failureOf && entry.stage === "failed") ?? null);

  return (
    <span aria-label={st.label} role="group" onKeyDown={(event) => closeListOnEscape(event, open, () => setOpen(false), opener.current)} className="relative flex min-w-0 items-center gap-2">
      {renderBar(featured, false)}
      {others.length < 1 ? null : (
        <button
          ref={opener}
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          className="h-5 flex-none cursor-pointer rounded px-1.5 text-xs text-accent hover:bg-selected"
        >
          {dataImportCopy.status.more(others.length, othersKind(others))}
        </button>
      )}
      {open ? (
        <div
          ref={list}
          id={listId}
          role="dialog"
          aria-label={loads.length > 0 ? dataImportCopy.status.listLabel : st.listLabel}
          className="absolute bottom-7 left-0 z-40 flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-border-strong bg-raised p-2 shadow-2xl"
        >
          {entries.map((bar) => renderBar(bar, true))}
        </div>
      ) : null}
      {asking === null || question === null ? null : (
        <ConfirmDialog
          open
          tone="danger"
          title={question.title}
          description={question.text}
          confirmLabel={question.confirm}
          cancelLabel={question.keep}
          onConfirm={() => {
            setAsking(null);
            void loadTracker.confirmCancel(asking);
          }}
          onCancel={() => setAsking(null)}
        />
      )}
      {failed === null ? null : <LoadFailureDialog entry={failed} onClose={() => setFailureOf(null)} />}
    </span>
  );
}

/** O assistente "Exportar dados" desta janela, um por vez (RN-EXPORT-003): nasce de novo a cada abertura. */
export function ExportWizardHost() {
  const request = useExportWizard();
  return request === null ? null : <ExportWizard key={request.key} request={request} />;
}
