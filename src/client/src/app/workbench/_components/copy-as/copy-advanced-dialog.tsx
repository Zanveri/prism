import { useId, useMemo, useRef, useState } from "react";

import { Button, Dialog, DuplicateIcon, FormMessage } from "@/components/ui";

import { copyProblems, copyScopes, previewOf, sourceSize, targetOf, type CopyOutcome, type CopyPhase, type CopyScope } from "../../_lib/copy-as/copy-as";
import { copyAsCopy } from "../../_lib/copy-as/copy-as.copy";
import type { CopyAdvancedDialogProps } from "../../_lib/copy-as/use-copy-as";
import { defaultOptions, type FormatOptions } from "../../_lib/data-export/export-options";
import { resetFormat } from "../../_lib/data-export/export-wizard";
import type { DocumentFormat } from "../../_lib/grid-export/document";
import { FormattingStep } from "../data-export/export-wizard-steps";
import { CopyFormatList } from "./copy-format-list";

const a = copyAsCopy.advanced;

export type { CopyAdvancedDialogProps };

/**
 * "Copiar avançado…" (Ctrl+Shift+C, RN-GRADE-003): o diálogo grande. À esquerda, o formato, os nove do "Copiar como"; à direita, "O que copiar" (as células
 * escolhidas, o padrão, que não se lembra; as linhas inteiras da seleção; todas as linhas carregadas), cada uma com o tamanho; as opções do formato, as da
 * exportação, com a tabela de destino do SQL e do DbUnit da origem; e a prévia, o começo do texto, sem pedir nada à API. "Copiar" fica desabilitado com um
 * campo recusado (também a coluna repetida do SQL, que a prévia diz no lugar do texto, RN-GRADE-016); do clique até o texto ir para a área de transferência ele diz "Copiando…", e a busca dos valores completos aparece aqui, com "Cancelar a
 * busca", que volta ao diálogo sem copiar. Copiado, fecha; a recusa do limite de 10 MiB aparece no alto, e o diálogo fica aberto. "Cancelar", Esc e o X
 * fecham sem perguntar, menos enquanto copia.
 */
export function CopyAdvancedDialog({ sources, initial, initialFormat, focusTable = false, onCopy, onRemember, onClose }: CopyAdvancedDialogProps) {
  const idPrefix = useId();
  const [format, setFormat] = useState<DocumentFormat>(initialFormat ?? initial.format);
  const [options, setOptions] = useState<FormatOptions>(initial.options);
  const [scope, setScope] = useState<CopyScope>("cells");
  const [phase, setPhase] = useState<CopyPhase | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // O foco no campo da tabela é só do abrir (RN-GRADE-016): a primeira troca de formato o desliga, e o campo da tabela que aparece depois (as setas na lista
  // passando pelo SQL ou pelo DbUnit) não tira o foco da lista.
  const [tableFocus, setTableFocus] = useState(focusTable);
  const abort = useRef<AbortController | null>(null);

  const source = sources[scope];
  const problems = useMemo(() => copyProblems(format, options, source), [format, options, source]);
  const blocked = Object.keys(problems).length > 0;
  const preview = useMemo(() => previewOf(format, options, source), [format, options, source]);
  const copying = phase !== null;

  /** Toda mudança tira a recusa do alto: ela era da cópia de antes. */
  const change = (next: () => void) => {
    next();
    setRefusal(null);
  };

  async function copy() {
    if (blocked || copying) return;
    setRefusal(null);
    onRemember({ format, options });
    const controller = new AbortController();
    abort.current = controller;
    setPhase("writing");
    // O que a cópia lançar não deixa o diálogo preso em "Copiando…", com o Esc, o X e o "Cancelar" desabilitados: a fase volta, e a recusa aparece no alto.
    let outcome: CopyOutcome;
    try {
      outcome = await onCopy({ format, options, source }, { signal: controller.signal, onPhase: setPhase });
    } catch (error) {
      console.error("[prism] copiar avançado:", error);
      outcome = { kind: "failed", message: copyAsCopy.notice.failed };
    } finally {
      abort.current = null;
      setPhase(null);
    }
    if (outcome.kind === "copied") onClose();
    else if (outcome.kind === "tooLarge" || outcome.kind === "noColumns" || outcome.kind === "duplicateColumn" || outcome.kind === "failed") setRefusal(outcome.message);
  }

  const footer = (
    <>
      <Button type="button" variant="secondary" className="mr-auto" onClick={onClose} disabled={copying}>
        {a.cancel}
      </Button>
      <Button type="button" onClick={() => void copy()} disabled={blocked || copying}>
        <DuplicateIcon />
        {copying ? a.copying : a.copy}
      </Button>
    </>
  );

  return (
    <Dialog open title={a.title} size="lg" pending={copying} onClose={onClose} footer={footer}>
      <div className="flex flex-col gap-4">
        {refusal === null ? null : <FormMessage tone="error">{refusal}</FormMessage>}
        <div className="flex gap-6">
          <section className="w-44 flex-none" aria-labelledby={`${idPrefix}-format`}>
            <h3 id={`${idPrefix}-format`} className="mb-2 font-medium">
              {a.format}
            </h3>
            <CopyFormatList
              format={format}
              onChoose={(next) =>
                change(() => {
                  setTableFocus(false);
                  setFormat(next);
                })
              }
              idPrefix={idPrefix}
              label={a.formats}
            />
          </section>
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">{a.scope}</legend>
              {copyScopes.map((candidate) => {
                const size = sourceSize(sources[candidate]);
                const detailId = `${idPrefix}-${candidate}-detail`;
                return (
                  <label key={candidate} className="flex cursor-pointer items-start gap-2.5 text-ink">
                    <input
                      type="radio"
                      name={`${idPrefix}-scope`}
                      value={candidate}
                      checked={scope === candidate}
                      onChange={() => change(() => setScope(candidate))}
                      aria-describedby={detailId}
                      className="mt-[3px] size-4 flex-none cursor-pointer accent-accent"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span>{a.scopes[candidate]}</span>
                      <span id={detailId} className="text-sm text-muted">
                        {a.size(size.rows, size.columns)}
                        {candidate === "loaded" ? `. ${a.loadedHint}` : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <section className="flex flex-col gap-2" aria-labelledby={`${idPrefix}-options`}>
              <h3 id={`${idPrefix}-options`} className="font-medium">
                {a.options}
              </h3>
              <FormattingStep
                format={format}
                options={options}
                onChange={(next) => change(() => setOptions(next))}
                problems={problems}
                informix={source.engine === 3}
                showGenerated={source.table !== null}
                focusTable={tableFocus}
                onReset={() => change(() => setOptions(resetFormat(options, format, defaultOptions(targetOf(source)))))}
              />
            </section>

            <section className="flex flex-col gap-2" aria-labelledby={`${idPrefix}-preview`}>
              <h3 id={`${idPrefix}-preview`} className="font-medium">
                {a.preview}
              </h3>
              {preview.cut ? <p className="text-sm text-muted">{a.previewCut}</p> : null}
              <pre tabIndex={0} aria-labelledby={`${idPrefix}-preview`} className="max-h-56 overflow-auto rounded-md border border-border bg-panel p-2 font-mono text-xs whitespace-pre text-ink outline-none focus-visible:ring-1 focus-visible:ring-accent">
                {preview.refusal ?? (preview.text === "" ? a.previewEmpty : preview.text)}
              </pre>
            </section>

            {phase === "fetching" ? (
              <div role="status" className="flex items-center gap-3 text-sm text-body">
                <span>{a.fetching}</span>
                <Button type="button" variant="secondary" size="compact" onClick={() => abort.current?.abort()}>
                  {a.cancelFetch}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
