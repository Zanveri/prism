import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { hostClipboard } from "@/lib/host/host";

import { copyAsFormats, type CopyAsFormat } from "../cell-menu";
import type { EditAccess } from "../cell-editing";
import type { TargetAnswer } from "../generate-sql/generate-sql-flow";
import type { DocumentFormat } from "../grid-export/document";
import { activeCell, type SelectionSlice } from "../grid-selection";
import { cellsFloor, clipboardLimit, loadedRowsMeter } from "../grid-copy";
import { gridSelectionCopy } from "../grid-selection.copy";
import { columnEditsOf } from "../record-edits";
import type { CopyAsSource, GridSelectionContext } from "../use-record-edits";
import { copyScopes, runCopyAs, targetOf, type CopyDeps, type CopyOutcome, type CopyPhase, type CopyRequest, type CopyScope, type CopySource } from "./copy-as";
import { readCopyAsChoices, writeCopyAsChoices, type CopyAsChoices } from "./copy-as-choices";
import { copyAsCopy } from "./copy-as.copy";
import { copyOriginOf, copySourceOf, copySourcesOf, type CopyOrigin } from "./copy-source";

/**
 * O "Copiar avançado" da grade ligado (RN-GRADE-003, 016 e 017, seção 37): a fonte do submenu que `useRecordEdits` recebe (`CopyAsSource`), o "Copiar como"
 * direto, o diálogo "Copiar avançado…" (também o Ctrl+Shift+C) e o "Configurar comandos 'Copiar como'…". A seleção, a busca dos valores completos, a faixa e
 * a pausa da atualização automática vêm do contexto da grade (`GridSelectionContext`); as decisões são de `copy-as.ts` e de `copy-source.ts`, puras.
 */

/** O que o diálogo "Copiar avançado…" recebe (`CopyAdvancedDialog`). */
export type CopyAdvancedDialogProps = {
  /** O que cada escolha de "O que copiar" copia: as células da seleção, as linhas inteiras dela e todas as linhas carregadas, cada uma já como origem. */
  sources: Record<CopyScope, CopySource>;
  /** As escolhas lembradas (`readCopyAsChoices`), com a tabela de destino da origem (`targetOf`). */
  initial: CopyAsChoices;
  /** O formato com que o diálogo abre no lugar do lembrado: o do "Copiar como SQL" ou "Copiar como DbUnit" sem tabela conhecida (RN-GRADE-016). */
  initialFormat?: DocumentFormat;
  /**
   * RN-GRADE-022 e 023: com colunas inteiras escolhidas, "As células escolhidas" e "As linhas inteiras da seleção" são todas as linhas do resultado: o tamanho
   * diz "todas as linhas" (com o total, quando se sabe), e, com linhas a carregar, a prévia diz que tem só as carregadas e a cópia as carrega antes.
   */
  whole?: { total: number | null; rowsToLoad: boolean };
  /** O foco nasce no campo da tabela de destino (o mesmo caso). */
  focusTable?: boolean;
  /**
   * Copia (o `runCopyAs` da tela, que busca os valores completos e avisa "3 linhas copiadas em CSV." quando copiou). O diálogo passa o sinal do "Cancelar a
   * busca" e quer saber a fase, para mostrar a busca nele.
   */
  onCopy: (request: CopyRequest, control: { signal: AbortSignal; onPhase: (phase: CopyPhase) => void; onProgress: (text: string) => void }) => Promise<CopyOutcome>;
  /** Lembra o formato e as opções (`writeCopyAsChoices`), no clique em "Copiar": são as do "Copiar como" daquele formato também (RN-GRADE-017). */
  onRemember: (choices: CopyAsChoices) => void;
  onClose: () => void;
};

/** O que o diálogo "Configurar comandos 'Copiar como'…" recebe (`ConfigureCopyAsDialog`): quem o abre grava, avisa e fecha no `onSave`. */
export type ConfigureCopyAsDialogProps = { initial: CopyAsChoices; onSave: (choices: CopyAsChoices) => void; onClose: () => void };

type Params = {
  /** Nos Registros, a tabela da aba: o nome da origem e a tabela de destino do SQL e do DbUnit. Nula no resultado de um comando. */
  records: { schema: string; name: string } | null;
  /** O usuário do cofre, lido na hora da escolha: as escolhas lembradas são dele (RN-GRADE-017). */
  userName: () => string | null;
  /** A área de transferência; por padrão, a da janela onde a pessoa está (`hostClipboard`, RN-ABAS-017). */
  writeText?: (text: string) => Promise<void>;
};

const allowed: EditAccess = { editable: true };

const browserClipboard = (text: string) => hostClipboard().writeText(text);

type Open = { kind: "advanced"; props: CopyAdvancedDialogProps } | { kind: "configure"; props: ConfigureCopyAsDialogProps };

/**
 * O gancho do "Copiar avançado". O que vale para os três caminhos:
 *
 * - A atualização automática fica em pausa do clique até o texto ir para a área de transferência, e com um diálogo aberto até ele fechar (RN-GRADE-014).
 * - A cópia é das linhas escolhidas no começo (o recorte é tirado antes de qualquer espera).
 * - O SQL e o DbUnit precisam da tabela de destino (RN-GRADE-016): sem o alvo na tela, e com a aba livre, ele é perguntado antes (`sqlTarget`, o mesmo do
 *   "Gerar SQL"), com "Conferindo a tabela deste resultado…" na faixa; com a aba ocupada, não se pergunta, e a tabela fica como não conhecida. O "Copiar
 *   avançado…" pergunta do mesmo jeito antes de abrir, para a tabela e as colunas que o banco calcula já virem nas opções.
 * - Sem tabela conhecida, o "Copiar como SQL" e o "Copiar como DbUnit" abrem o "Copiar avançado…" no formato, com o foco no campo da tabela.
 * - O "Copiar como" direto mostra "Copiando…" na faixa passado meio segundo, com o "Cancelar" dela; a busca dos valores completos também vai à faixa.
 */
export function useCopyAs({ records, userName, writeText = browserClipboard }: Params) {
  const toast = useToast();
  const [open, setOpen] = useState<Open | null>(null);
  const latest = useRef({ records, userName, writeText });
  useEffect(() => {
    latest.current = { records, userName, writeText };
  });
  // Quem solta a pausa da atualização automática do diálogo aberto.
  const releaseRef = useRef<(() => void) | null>(null);

  const close = useCallback(() => {
    const release = releaseRef.current;
    releaseRef.current = null;
    release?.();
    setOpen(null);
  }, []);
  // A vista que sai de cena com um diálogo aberto solta a pausa dele.
  useEffect(
    () => () => {
      releaseRef.current?.();
      releaseRef.current = null;
    },
    [],
  );

  const show = useCallback((next: Open, release: () => void) => {
    releaseRef.current?.();
    releaseRef.current = release;
    setOpen(next);
  }, []);

  /** O alvo que a cópia usa: o que a tela já sabe, ou, quando ela precisa e a aba está livre, o perguntado à API, com a faixa dizendo. */
  const targetFor = useCallback(async (context: GridSelectionContext, wanted: boolean): Promise<TargetAnswer | null> => {
    const known = context.knownSqlTarget();
    if (known !== null || !wanted || context.busy !== false) return known;
    return context.sqlTarget(copyAsCopy.checkingTable);
  }, []);

  /**
   * As peças de `runCopyAs` para uma origem: a busca dos valores completos pelo recorte dela, só das células que `runCopyAs` pede (RN-SQL-017: as que o
   * documento escreve), com o `keepGoing` dele, na linha e na coluna da origem, que é a do recorte; e a área de transferência. As cortadas que não foram
   * pedidas continuam cortadas.
   */
  const depsOf = useCallback(
    (context: GridSelectionContext, slice: SelectionSlice, origin: CopyOrigin): Pick<CopyDeps, "complete" | "write"> => ({
      complete: async (_source, cells, keepGoing, signal) => {
        const key = (row: number, column: number) => `${row}:${column}`;
        const wanted = new Set(cells.map(([row, column]) => key(row, column)));
        const asked = slice.truncated.filter(([row, column]) => wanted.has(key(row, column)));
        const left = slice.truncated.filter(([row, column]) => !wanted.has(key(row, column)));
        // O lote vem pela posição na grade; a origem é a do recorte.
        const back = new Map(asked.map(([row, column]) => [key(slice.positions[row], slice.columnIndexes[column]), { row, column }]));
        const got = await context.complete(
          { ...slice, truncated: asked },
          (batch) => keepGoing(batch.flatMap(({ cell, value }) => { const at = back.get(key(cell.row, cell.column)); return at === undefined ? [] : [{ ...at, value }]; })),
          signal,
        );
        if (got === null) return null;
        return { source: copySourceOf({ ...got.slice, truncated: [...got.slice.truncated, ...left] }, origin), stopped: got.stopped };
      },
      write: (text) => latest.current.writeText(text).then(
        () => true,
        () => false,
      ),
    }),
    [],
  );

  /**
   * O aviso do que a cópia fez: o sucesso (ou a atenção, com o resumo), a recusa do limite e as das colunas (nenhuma no INSERT, ou duas com o mesmo nome,
   * RN-GRADE-016), e a falha da área de transferência.
   */
  const tell = useCallback(
    (outcome: CopyOutcome) => {
      if (outcome.kind === "copied") toast[outcome.notice.tone](outcome.notice.text);
      else if (outcome.kind === "tooLarge" || outcome.kind === "noColumns" || outcome.kind === "duplicateColumn") toast.error(outcome.message);
      else if (outcome.kind === "failed") toast.warning(outcome.message);
    },
    [toast],
  );

  /**
   * RN-GRADE-023: com colunas inteiras e linhas a carregar, carrega as que faltam (com o limite de 10 MiB contado a cada página) e devolve o contexto e o
   * recorte com todas as linhas; sem nada a carregar, os de agora. A recusa volta como o desfecho da cópia: o limite, a frase de por que as linhas não
   * vieram (com a mensagem do banco, como veio), ou o cancelamento. Sem `onProgress`, o andamento e as recusas das linhas vão à faixa sobre a grade.
   */
  const withAllRows = useCallback(
    async (
      context: GridSelectionContext,
      scope: Exclude<CopyScope, "loaded">,
      control: { signal?: AbortSignal; onProgress?: (text: string) => void; onPhase?: (phase: CopyPhase) => void } = {},
    ): Promise<{ context: GridSelectionContext; slice: SelectionSlice } | CopyOutcome> => {
      const slice = context.slice(scope);
      if (context.wholeColumns === null || !context.rowsToLoad) return { context, slice };
      control.onPhase?.("loading");
      // As linhas que chegam são medidas com o valor da coluna inteira pendente, como a grade as mostra (RN-EDIT-018).
      const wholes = new Map(columnEditsOf(context.pending).map((edit) => [edit.column, edit.value]));
      const keepGoing = loadedRowsMeter(slice.columnIndexes, cellsFloor(slice.rows), clipboardLimit, wholes);
      const loaded = await context.loadRest({ keepGoing, signal: control.signal, onProgress: control.onProgress });
      if (loaded.kind === "stopped") return { kind: "tooLarge", message: copyAsCopy.notice.tooLarge };
      if (loaded.kind === "refused") return control.onProgress === undefined ? { kind: "cancelled" } : { kind: "failed", message: loaded.detail === null ? loaded.reason : `${loaded.reason} ${loaded.detail}` };
      if (loaded.kind === "cancelled") return { kind: "cancelled" };
      return { context: loaded.context, slice: loaded.context.slice(scope) };
    },
    [],
  );

  /**
   * Abre o "Copiar avançado…" com as três origens; `release` é a pausa já segura por quem abre, que passa a ser do diálogo. `focus` é o formato do "Copiar
   * como SQL" ou DbUnit sem tabela conhecida, com o foco no campo da tabela.
   */
  const showAdvanced = useCallback(
    (context: GridSelectionContext, slices: Record<CopyScope, SelectionSlice>, origin: CopyOrigin, release: () => void, focus?: DocumentFormat) => {
      const sources = copySourcesOf(slices, origin);
      const props: CopyAdvancedDialogProps = {
        sources,
        initial: readCopyAsChoices(latest.current.userName(), targetOf(sources.cells)),
        ...(focus === undefined ? {} : { initialFormat: focus, focusTable: true }),
        // RN-GRADE-022: o total das colunas inteiras soma as linhas novas ainda não salvas, que a cópia leva, como a contagem da barra.
        ...(context.wholeColumns === null ? {} : { whole: { total: context.total === null ? null : context.total + context.layout.added.length, rowsToLoad: context.rowsToLoad } }),
        onCopy: async (request, control) => {
          const scope = copyScopes.find((candidate) => sources[candidate] === request.source) ?? "cells";
          // RN-GRADE-023: com colunas inteiras, as linhas que faltam vêm antes, com o andamento no diálogo; a recusa aparece no alto dele.
          const loaded = scope === "loaded" || context.wholeColumns === null || !context.rowsToLoad ? { context, slice: slices[scope] } : await withAllRows(context, scope, { signal: control.signal, onProgress: control.onProgress, onPhase: control.onPhase });
          if ("kind" in loaded) return loaded;
          const outcome = await runCopyAs(loaded.slice === slices[scope] ? request : { ...request, source: copySourceOf(loaded.slice, origin) }, { ...depsOf(loaded.context, loaded.slice, origin), signal: control.signal, onPhase: control.onPhase });
          // No diálogo, a recusa aparece no alto dele, que fica aberto (RN-GRADE-003): só o copiado vira aviso.
          if (outcome.kind === "copied") tell(outcome);
          return outcome;
        },
        onRemember: (choices) => writeCopyAsChoices(latest.current.userName(), choices),
        onClose: close,
      };
      show({ kind: "advanced", props }, release);
    },
    [depsOf, tell, close, show, withAllRows],
  );

  /** RN-GRADE-003: o "Copiar avançado…" e o Ctrl+Shift+C. O alvo é perguntado antes, quando a tela não o tem e a aba está livre. */
  const openAdvanced = useCallback(
    async (context: GridSelectionContext) => {
      const engine = context.engine;
      if (engine === undefined) return;
      const release = context.hold();
      let handed = false;
      try {
        const slices = { cells: context.slice("cells"), rows: context.slice("rows"), loaded: context.slice("loaded") };
        const answer = await targetFor(context, true);
        showAdvanced(context, slices, copyOriginOf(engine, latest.current.records, answer), release);
        handed = true;
      } finally {
        if (!handed) release();
      }
    },
    [targetFor, showAdvanced],
  );

  /**
   * RN-GRADE-016: "Copiar como <formato>", na hora, das células escolhidas, com as opções lembradas do formato. Sem tabela de destino, o SQL e o DbUnit abrem
   * o "Copiar avançado…" no formato, com o foco no campo da tabela.
   */
  const copyAs = useCallback(
    async (format: DocumentFormat, context: GridSelectionContext) => {
      const engine = context.engine;
      if (engine === undefined || activeCell(context.selection, context.layout) === null) return;
      const release = context.hold();
      let handed = false;
      try {
        const { records } = latest.current;
        const answer = await targetFor(context, format === "sql" || (format === "dbUnit" && records === null));
        // RN-GRADE-023: com colunas inteiras, as linhas que faltam vêm antes, com o andamento e as recusas na faixa sobre a grade.
        const loaded = await withAllRows(context, "cells");
        if ("kind" in loaded) return tell(loaded);
        const { slice } = loaded;
        const origin = copyOriginOf(engine, records, answer);
        const source = copySourceOf(slice, origin);
        const { options } = readCopyAsChoices(latest.current.userName(), targetOf(source));

        const controller = new AbortController();
        const done = context.copying(controller);
        let outcome: CopyOutcome;
        try {
          outcome = await runCopyAs({ format, options, source }, { ...depsOf(loaded.context, slice, origin), signal: controller.signal });
        } finally {
          done();
        }
        if (outcome.kind === "needsTable") {
          showAdvanced(loaded.context, { cells: slice, rows: loaded.context.slice("rows"), loaded: loaded.context.slice("loaded") }, origin, release, format);
          handed = true;
          return;
        }
        tell(outcome);
      } finally {
        if (!handed) release();
      }
    },
    [targetFor, depsOf, showAdvanced, tell, withAllRows],
  );

  /** RN-GRADE-017: "Configurar comandos 'Copiar como'…": as opções lembradas de cada formato; "Salvar" grava, avisa e fecha. */
  const configure = useCallback(
    (context: GridSelectionContext) => {
      const props: ConfigureCopyAsDialogProps = {
        initial: readCopyAsChoices(latest.current.userName()),
        onSave: (choices) => {
          writeCopyAsChoices(latest.current.userName(), choices);
          toast.success(copyAsCopy.configure.saved);
          close();
        },
        onClose: close,
      };
      show({ kind: "configure", props }, context.hold());
    },
    [toast, close, show],
  );

  const source = useMemo<CopyAsSource>(
    () => ({
      // RN-GRADE-002 e 003: valem em qualquer resultado, também no só leitura e na conexão somente leitura; sem célula ativa, a cópia não tem o que levar.
      access: (context) => {
        const access: EditAccess = activeCell(context.selection, context.layout) === null ? { editable: false, reason: gridSelectionCopy.copy.chooseCell } : allowed;
        return { dialog: access, ...(access.editable ? {} : { formats: Object.fromEntries(copyAsFormats.map((format) => [format, access])) }), configure: allowed };
      },
      choose: (action, context) => {
        if (action === "copyAdvanced") return void openAdvanced(context);
        if (action === "copyAsConfigure") return configure(context);
        void copyAs(action.slice("copyAs:".length) as CopyAsFormat, context);
      },
    }),
    [openAdvanced, configure, copyAs],
  );

  return {
    source,
    advanced: open?.kind === "advanced" ? open.props : null,
    configure: open?.kind === "configure" ? open.props : null,
  };
}

/** O que o gancho devolve a quem monta os diálogos (`resultEditDialogs`). */
export type CopyAs = ReturnType<typeof useCopyAs>;
