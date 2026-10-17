import { useId, useMemo, useRef, useState } from "react";

import { Button, Dialog, DuplicateIcon, FormMessage } from "@/components/ui";

import { copyProblems, copyScopes, previewOf, sourceSize, targetOf, type CopyOutcome, type CopyPhase, type CopyRequest, type CopyScope, type CopySource } from "../../_lib/copy-as/copy-as";
import { copyAsCopy } from "../../_lib/copy-as/copy-as.copy";
import type { CopyAsChoices } from "../../_lib/copy-as/copy-as-choices";
import { defaultOptions, type FormatOptions } from "../../_lib/data-export/export-options";
import { resetFormat } from "../../_lib/data-export/export-wizard";
import type { DocumentFormat } from "../../_lib/grid-export/document";
import { FormattingStep } from "../data-export/export-wizard-steps";
import { CopyFormatList } from "./copy-format-list";

const a = copyAsCopy.advanced;

export type CopyAdvancedDialogProps = {
  /** O que cada escolha de "O que copiar" copia: as células da seleção, as linhas inteiras dela e todas as linhas carregadas, cada uma já como origem. */
  sources: Record<CopyScope, CopySource>;
  /** As escolhas lembradas (`readCopyAsChoices`), com a tabela de destino da origem (`targetOf`). */
  initial: CopyAsChoices;
  /** O formato com que o diálogo abre no lugar do lembrado: o do "Copiar como SQL" ou "Copiar como DbUnit" sem tabela conhecida (RN-GRADE-016). */
  initialFormat?: DocumentFormat;
  /** O foco nasce no campo da tabela de destino (o mesmo caso). */
  focusTable?: boolean;
  /**
   * Copia (o `runCopyAs` da tela, que pausa a atualização automática, busca os valores completos e avisa "3 linhas copiadas em CSV." quando copiou). O diálogo
   * passa o sinal do "Cancelar a busca" e quer saber a fase, para mostrar a busca nele.
   */
  onCopy: (request: CopyRequest, control: { signal: AbortSignal; onPhase: (phase: CopyPhase) => void }) => Promise<CopyOutcome>;
  /** Lembra o formato e as opções (`writeCopyAsChoices`), no clique em "Copiar": são as do "Copiar como" daquele formato também (RN-GRADE-017). */
  onRemember: (choices: CopyAsChoices) => void;
  onClose: () => void;
};

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
    const outcome = await onCopy({ format, options, source }, { signal: controller.signal, onPhase: setPhase });
    abort.current = null;
    setPhase(null);
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
            <CopyFormatList format={format} onChoose={(next) => change(() => setFormat(next))} idPrefix={idPrefix} label={a.formats} />
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
                focusTable={focusTable}
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
