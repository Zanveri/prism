import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button, DownloadIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { dataExportCopy } from "../../_lib/data-export/data-export.copy";
import { exportTracker, useExportWizard, useTrackedExports } from "../../_lib/data-export/data-exports";
import { entryView, featuredExport, type TrackedExport } from "../../_lib/data-export/transfer-tracker";
import { ExportWizard } from "./export-wizard";

const st = dataExportCopy.status;

/** O texto com o nome da origem (ou do arquivo) isolado do texto em volta (`<bdi>`): um nome do banco pode ter marca de direção (RN-EXPORT-021). */
function isolated(text: string, entry: TrackedExport): ReactNode {
  for (const name of [entry.fileName, entry.name]) {
    if (name === null || name === "") continue;
    const at = text.indexOf(name);
    if (at < 0) continue;
    return (
      <>
        {text.slice(0, at)}
        <bdi>{name}</bdi>
        {text.slice(at + name.length)}
      </>
    );
  }
  return text;
}

/** A barra de progresso pequena: com o total, a porcentagem (`aria-valuenow`); sem ele, a barra sem medida. O texto inteiro vai em `aria-valuetext`. */
function ProgressBar({ entry, percent, hint }: { entry: TrackedExport; percent: number | null; hint: string }) {
  return (
    <span
      role="progressbar"
      aria-label={st.progressLabel(entry.name)}
      aria-valuemin={percent === null ? undefined : 0}
      aria-valuemax={percent === null ? undefined : 100}
      aria-valuenow={percent ?? undefined}
      aria-valuetext={hint}
      className="relative h-1.5 w-16 flex-none overflow-hidden rounded-full bg-border-strong"
    >
      {percent === null ? (
        <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
      ) : (
        <span style={{ width: `${percent}%` }} className="absolute inset-y-0 left-0 rounded-full bg-accent" />
      )}
    </span>
  );
}

const small = "h-5 px-1.5 text-xs aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** Uma exportação: a seta de baixar, o texto (cortado, com o inteiro na dica), a barra de progresso e "Cancelar" (ou "Salvar como…" e "Descartar"). */
export function TransferEntry({ entry, wide = false }: { entry: TrackedExport; wide?: boolean }) {
  const view = entryView(entry);
  const failed = entry.stage === "deliveryFailed";
  return (
    <span className={cn("flex h-6 min-w-0 items-center gap-2", wide ? "w-full" : "max-w-[30rem]")}>
      <DownloadIcon className="size-3.5 flex-none" />
      <span title={view.hint} className="min-w-0 truncate text-ink">
        {isolated(view.text, entry)}
      </span>
      {failed ? null : <ProgressBar entry={entry} percent={view.percent} hint={view.hint} />}
      {failed ? (
        <>
          <Button type="button" variant="secondary" size="compact" className={small} aria-disabled={entry.busy || undefined} onClick={() => void exportTracker.saveAs(entry.id)}>
            {st.saveAs}
          </Button>
          <Button type="button" variant="secondary" size="compact" className={small} aria-disabled={entry.busy || undefined} onClick={() => void exportTracker.discard(entry.id)}>
            {st.discard}
          </Button>
        </>
      ) : (
        <Button type="button" variant="secondary" size="compact" className={small} aria-label={st.cancelLabel(entry.name)} aria-disabled={view.busy || undefined} onClick={() => (view.busy ? undefined : void exportTracker.cancel(entry.id))}>
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
 * RN-EXPORT-021: as exportações desta janela na barra de status, entre o modo de transação e o cofre. A barra continua uma linha de 28 px: aparece uma só
 * (a que pede ação, ou a mais antiga), e, com mais, o botão "+2 exportações" abre a lista acima da barra. Esc fecha a lista e devolve o foco ao botão. O
 * progresso não é anunciado a cada passo: o aviso do fim é.
 */
export function TransferStatus() {
  const entries = useTrackedExports();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const featured = featuredExport(entries);
  const others = entries.length - 1;
  if (open && others < 1) setOpen(false);

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

  return (
    <span aria-label={st.label} role="group" onKeyDown={(event) => closeListOnEscape(event, open, () => setOpen(false), opener.current)} className="relative flex min-w-0 items-center gap-2">
      <TransferEntry entry={featured} />
      {others < 1 ? null : (
        <button
          ref={opener}
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((current) => !current)}
          className="h-5 flex-none cursor-pointer rounded px-1.5 text-xs text-accent hover:bg-selected"
        >
          {st.more(others)}
        </button>
      )}
      {open ? (
        <div
          ref={list}
          id={listId}
          role="dialog"
          aria-label={st.listLabel}
          className="absolute bottom-7 left-0 z-40 flex w-[34rem] max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-border-strong bg-raised p-2 shadow-2xl"
        >
          {entries.map((entry) => (
            <TransferEntry key={entry.id} entry={entry} wide />
          ))}
        </div>
      ) : null}
    </span>
  );
}

/** O assistente "Exportar dados" desta janela, um por vez (RN-EXPORT-003): nasce de novo a cada abertura. */
export function ExportWizardHost() {
  const request = useExportWizard();
  return request === null ? null : <ExportWizard key={request.key} request={request} />;
}
