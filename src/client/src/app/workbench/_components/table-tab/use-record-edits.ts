import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";

import { cellAccess, deleteRowAccess, newRowAccess, type EditAccess, type RowContext } from "../../_lib/cell-editing";
import { cellMenu, type CellMenuAction, type CellMenuItem } from "../../_lib/cell-menu";
import type { DatabaseSession } from "../../_lib/database-sessions.schema";
import { databaseSessionKey } from "../../_lib/database-sessions.service";
import { nextEditable, type GridCell } from "../../_lib/grid-cursor";
import { gridRowOf, gridRowsOf, rowMarksOf, type CellEditorState, type GridEditing } from "../../_lib/grid-editing";
import { addRow, changesOf, deleteRow, editCell, editNewCell, failureOf, noEdits, pendingCell, pendingCount, removeNewRow, undoCell, undoDelete, undoNewCell, withoutApplied, type EditValue, type PendingEdits, type SaveFailure } from "../../_lib/record-edits";
import { editErrorDetails, type EditPreview, type EditTarget } from "../../_lib/record-edits.schema";
import { editTargetOrRefuse, previewEditsOrRefuse, saveEditsOrRefuse } from "../../_lib/record-edits.service";
import { recordsCopy } from "../../_lib/records.copy";
import { recall, remember } from "../../_lib/tab-memory";
import { unsavedEdits } from "../../_lib/unsaved-edits";
import { isBusyState, type QueryRunner, type RowsState, type RunnerState } from "../../_lib/use-query-runner";

const copy = recordsCopy.edit;

/** O que o catálogo respondeu para um resultado: o alvo, ou o motivo de o resultado inteiro ser só leitura. */
type TargetAnswer = { resultId: string; target: EditTarget | null; readOnly: string | null };

/** A faixa: o último Salvar recusado (com a linha dele na grade) e o recado da última tentativa. */
type Banner = { resultId: string | null; failure: SaveFailure | null; failedRow: number | null; notice: string | null };

export type OpenCellMenu = { groups: CellMenuItem[][]; point: { x: number; y: number }; keyboard: boolean; onChoose: (action: CellMenuAction) => void };

export type UnsavedQuestion = { count: number; saving: boolean; onSave: () => void; onDiscard: () => void; onCancel: () => void };

type Params = {
  tabId: string;
  runner: QueryRunner;
  state: RunnerState;
  connectionId: string;
  database?: string;
  /** Depois de um Salvar que gravou tudo: os registros são lidos de novo (o comando em vigor, executado outra vez). */
  onSaved: () => void;
};

const noBanner: Banner = { resultId: null, failure: null, failedRow: null, notice: null };

/** "Copiar valor": o mesmo jeito de copiar do "Copiar nome" do navegador, a área de transferência do navegador e o aviso. */
async function copyText(text: string, toast: ReturnType<typeof useToast>) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(copy.menu.copied);
  } catch {
    toast.warning(copy.menu.notCopied);
  }
}

/**
 * A edição dos Registros (seção 22, RN-EDIT-001 a 012), entre a grade e a API. As decisões são funções puras com teste (`record-edits.ts`,
 * `cell-editing.ts`, `cell-menu.ts`, `grid-editing.ts`); aqui estão o estado (as pendências, o alvo, a célula ativa, o campo aberto, a
 * faixa, o menu, o "Ver SQL" e a pergunta) e as chamadas.
 *
 * - As pendências são do resultado da página (`resultId`): outra execução começa sem nenhuma, e quem executa de novo com pendências
 *   pergunta antes (`guard`, RN-EDIT-007). Ficam na memória da aba (`tab-memory.ts`): ir à Estrutura e voltar não as perde.
 * - O catálogo é consultado na primeira tentativa de editar (RN-EDIT-010), pela sessão da árvore da mesma conexão quando ela existe.
 * - O Salvar grava pela sessão da aba, numa transação própria (a aba de uma tabela é sempre Auto-commit, RN-TX-001); se gravou tudo, os
 *   registros são lidos de novo. A recusa fica na faixa, com a mensagem do banco como veio e a linha destacada; no banco sem log, o que já
 *   foi gravado sai das pendências (RN-EDIT-012).
 * - As alterações não salvas vão ao registro da aba (`unsaved-edits.ts`), de onde quem fecha abas pergunta.
 */
export function useRecordEdits({ tabId, runner, state, connectionId, database, onSaved }: Params) {
  const queryClient = useQueryClient();
  const toast = useToast();

  // As linhas na tela: com outro comando rodando, as de antes (esmaecidas), sobre as quais nada se edita.
  const shown: RowsState | null = state.status === "rows" ? state : state.status === "running" && state.previous?.status === "rows" ? state.previous : null;
  const resultId = shown?.resultId ?? null;
  const busy = isBusyState(state);

  const [stored, setStored] = useState(() => recall(tabId, "edits") ?? null);
  const edits: PendingEdits = stored !== null && stored.resultId === resultId ? stored.edits : noEdits;
  const [answer, setAnswer] = useState<TargetAnswer | null>(null);
  const known = answer !== null && answer.resultId === resultId ? answer : null;
  const target = known?.target ?? null;
  const readOnlyReason = shown?.readOnly ?? known?.readOnly ?? null;
  const [bannerState, setBanner] = useState<Banner>(noBanner);
  const banner = bannerState.resultId === resultId ? bannerState : noBanner;
  // A célula ativa e o campo aberto são do resultado: outra execução não os herda (a grade é outra).
  const [activeState, setActiveState] = useState<{ resultId: string | null; cell: GridCell } | null>(null);
  const active = activeState !== null && activeState.resultId === resultId ? activeState.cell : null;
  const [editorState, setEditorState] = useState<(CellEditorState & { resultId: string | null }) | null>(null);
  const editor: CellEditorState | null = editorState !== null && editorState.resultId === resultId ? editorState : null;
  const [saving, setSaving] = useState(false);
  const [menu, setMenu] = useState<OpenCellMenu | null>(null);
  const [preview, setPreview] = useState<EditPreview | null>(null);
  const [question, setQuestion] = useState<{ count: number; proceed: () => void } | null>(null);

  const rows = useMemo(() => (shown === null ? [] : gridRowsOf(shown.rows, edits, shown.columns.length)), [shown, edits]);
  const marks = useMemo(() => rowMarksOf(edits, shown?.rows.length ?? 0, banner.failedRow), [edits, shown, banner.failedRow]);
  const count = pendingCount(edits);

  // Tudo o que as ações leem depois de um `await`: o estado de agora, e não o da renderização em que a ação começou.
  const latest = useRef({ shown, resultId, edits, target, readOnlyReason, busy, saving });
  useEffect(() => {
    latest.current = { shown, resultId, edits, target, readOnlyReason, busy, saving };
  });
  const editorRef = useRef<(CellEditorState & { resultId: string | null }) | null>(null);
  const setEditor = useCallback((next: CellEditorState | null) => {
    const value = next === null ? null : { ...next, resultId: latest.current.resultId };
    editorRef.current = value;
    setEditorState(value);
  }, []);
  const setActive = useCallback((cell: GridCell) => setActiveState({ resultId: latest.current.resultId, cell }), []);
  const asking = useRef<{ resultId: string; promise: Promise<EditTarget | null> } | null>(null);

  const putEdits = useCallback(
    (next: PendingEdits) => {
      const id = latest.current.resultId;
      if (id === null) return;
      const value = { resultId: id, edits: next };
      latest.current = { ...latest.current, edits: next };
      remember(tabId, "edits", value);
      setStored(value);
    },
    [tabId],
  );

  const say = useCallback((notice: string | null) => setBanner((current) => ({ ...(current.resultId === latest.current.resultId ? current : noBanner), resultId: latest.current.resultId, notice })), []);

  /** RN-EDIT-010: o alvo da edição, perguntado uma vez por resultado; nulo quando o resultado é só leitura ou a pergunta falhou (a faixa diz). */
  const ensureTarget = useCallback(async (): Promise<EditTarget | null> => {
    const { resultId: id, target: current, readOnlyReason: reason } = latest.current;
    const sessionId = runner.sessionOf();
    if (id === null || reason !== null || sessionId === null) return null;
    if (current !== null) return current;
    if (asking.current?.resultId === id) return asking.current.promise;

    const catalogSessionId = queryClient.getQueryData<DatabaseSession>(databaseSessionKey(connectionId, database))?.id ?? null;
    const promise = (async () => {
      say(copy.loadingTarget);
      const result = await throughMutationCache(queryClient, () => editTargetOrRefuse(sessionId, id, catalogSessionId)).catch(() => null);
      say(null);
      if (result === null) return null;
      if (result.ok) {
        setAnswer({ resultId: id, target: result.data, readOnly: null });
        latest.current = { ...latest.current, target: result.data };
        return result.data;
      }
      if (result.error.code === "RESULT_NOT_EDITABLE") {
        const why = editErrorDetails(result.error.extensions).reason ?? result.error.detail ?? result.error.title;
        setAnswer({ resultId: id, target: null, readOnly: why });
        latest.current = { ...latest.current, readOnlyReason: why };
        return null;
      }
      setBanner({ resultId: id, failure: { headline: copy.checkFailed, detail: result.error.detail ?? result.error.title, origin: null, column: null, applied: 0, written: false }, failedRow: null, notice: null });
      return null;
    })();
    asking.current = { resultId: id, promise };
    void promise.finally(() => {
      if (asking.current?.promise === promise) asking.current = null;
    });

    return promise;
  }, [runner, queryClient, connectionId, database, say]);

  /** A linha da grade: uma lida (com o corte e a exclusão) ou uma nova. */
  const rowOf = useCallback((row: number): RowContext => {
    const { shown: current, edits: pending } = latest.current;
    const read = current?.rows.length ?? 0;
    return row < read ? { kind: "read", truncated: current?.truncated.get(row), deleted: pending.deleted.includes(row) } : { kind: "new" };
  }, []);

  const accessOf = useCallback((cell: GridCell, known: EditTarget | null = latest.current.target): EditAccess => {
    const { readOnlyReason: reason, busy: running, saving: writing } = latest.current;
    return cellAccess({ readOnly: reason, target: known, busy: running || writing, column: cell.column, row: rowOf(cell.row) });
  }, [rowOf]);

  /** O texto que a célula mostra agora: a pendência, quando há, ou o valor lido. */
  const valueAt = useCallback((cell: GridCell): EditValue => {
    const { shown: current, edits: pending } = latest.current;
    const read = current?.rows.length ?? 0;
    if (cell.row < read) {
      const changed = pendingCell(pending, cell.row, cell.column);
      return changed === null ? (current?.rows[cell.row][cell.column] ?? null) : changed.value;
    }
    return pending.added[cell.row - read]?.values[cell.column] ?? null;
  }, []);

  /** Grava um valor na célula como pendência; voltar ao valor lido tira a pendência. */
  const applyValue = useCallback((cell: GridCell, value: EditValue) => {
    const { shown: current, edits: pending } = latest.current;
    const read = current?.rows.length ?? 0;
    if (cell.row < read) putEdits(editCell(pending, cell.row, cell.column, value, current!.rows[cell.row][cell.column]));
    else {
      const row = pending.added[cell.row - read];
      if (row !== undefined) putEdits(editNewCell(pending, row.id, cell.column, value));
    }
  }, [putEdits]);

  /** A ação que precisa da célula editável: pergunta o alvo, confere, e só então age; senão a faixa diz por quê. */
  const whenEditable = useCallback(async (cell: GridCell, act: () => void) => {
    const known = await ensureTarget();
    const access = accessOf(cell, known);
    if (!access.editable) return say(access.reason);
    if (known === null) return;
    say(null);
    act();
  }, [ensureTarget, accessOf, say]);

  const openEditor = useCallback((cell: GridCell, initial?: string) => {
    void whenEditable(cell, () => {
      setActive(cell);
      setEditor({ ...cell, draft: initial ?? valueAt(cell) ?? "" });
    });
  }, [whenEditable, valueAt, setEditor, setActive]);

  const commit = useCallback((move?: 1 | -1) => {
    const open = editorRef.current;
    if (open === null) return;
    setEditor(null);
    // O campo de um resultado que já saiu da tela não grava no novo.
    if (open.resultId !== latest.current.resultId) return;
    applyValue(open, open.draft);

    const columns = latest.current.shown?.columns.length ?? 0;
    const next = move === undefined ? null : nextEditable(open, move, columns, (row, column) => accessOf({ row, column }).editable);
    if (next !== null) {
      setActive(next);
      setEditor({ ...next, draft: valueAt(next) ?? "" });
    }
  }, [setEditor, setActive, applyValue, accessOf, valueAt]);

  const cancel = useCallback(() => setEditor(null), [setEditor]);

  const newRow = useCallback(async () => {
    const known = await ensureTarget();
    const { readOnlyReason: reason, busy: running, saving: writing, shown: current } = latest.current;
    const access = newRowAccess(reason, known, running || writing);
    if (!access.editable) return say(access.reason);
    if (known === null || current === null) return;

    const { edits: next } = addRow(latest.current.edits);
    putEdits(next);
    const row = current.rows.length + next.added.length - 1;
    const column = known.columns.findIndex((info) => info.editable);
    setActive({ row, column: Math.max(column, 0) });
    say(null);
  }, [ensureTarget, putEdits, say, setActive]);

  const removeRow = useCallback(async (row: number) => {
    const known = await ensureTarget();
    const { readOnlyReason: reason, busy: running, saving: writing, shown: current, edits: pending } = latest.current;
    const access = deleteRowAccess(rowOf(row), reason, known, running || writing);
    if (!access.editable) return say(access.reason);
    if (known === null || current === null) return;

    const read = current.rows.length;
    putEdits(row < read ? deleteRow(pending, row) : removeNewRow(pending, pending.added[row - read].id));
    say(null);
  }, [ensureTarget, rowOf, putEdits, say]);

  const undo = useCallback((cell: GridCell) => {
    const { shown: current, edits: pending } = latest.current;
    const read = current?.rows.length ?? 0;
    if (cell.row < read) putEdits(pending.deleted.includes(cell.row) ? undoDelete(pending, cell.row) : undoCell(pending, cell.row, cell.column));
    else {
      const row = pending.added[cell.row - read];
      if (row !== undefined) putEdits(undoNewCell(pending, row.id, cell.column));
    }
  }, [putEdits]);

  const discard = useCallback(() => {
    setEditor(null);
    putEdits(noEdits);
    setBanner(noBanner);
  }, [setEditor, putEdits]);

  /** RN-EDIT-005 e 012: o Salvar. Devolve se gravou tudo; com `reload`, os registros são lidos de novo. */
  const save = useCallback(async (reload = true): Promise<boolean> => {
    const { shown: current, resultId: id, edits: pending, target: known, saving: writing } = latest.current;
    const sessionId = runner.sessionOf();
    if (pendingCount(pending) === 0) return true;
    if (writing || current === null || id === null || known === null || sessionId === null) return false;

    const plan = changesOf(pending, current.rows, known);
    setSaving(true);
    latest.current = { ...latest.current, saving: true };
    const result = await throughMutationCache(queryClient, () => saveEditsOrRefuse(sessionId, id, plan.changes)).catch(() => null);
    setSaving(false);
    latest.current = { ...latest.current, saving: false };
    if (result === null) return false;

    if (result.ok) {
      toast.success(copy.saved(result.data.applied));
      putEdits(noEdits);
      setBanner(noBanner);
      if (reload) onSaved();
      return true;
    }

    const failure = failureOf(result.error, plan, known.oneAtATime);
    const done = failure.applied + (failure.written ? 1 : 0);
    const left = done > 0 ? withoutApplied(pending, plan.origins, done) : pending;
    if (left !== pending) putEdits(left);
    setBanner({ resultId: id, failure, failedRow: failure.origin === null || failure.written ? null : gridRowOf(failure.origin, left, current.rows.length), notice: null });
    return false;
  }, [runner, queryClient, toast, putEdits, onSaved]);

  /** RN-EDIT-008: "Ver SQL", pela API, sem executar nada. */
  const viewSql = useCallback(async () => {
    const { shown: current, resultId: id, edits: pending, target: known } = latest.current;
    const sessionId = runner.sessionOf();
    if (current === null || id === null || known === null || sessionId === null) return;

    const plan = changesOf(pending, current.rows, known);
    const result = await throughMutationCache(queryClient, () => previewEditsOrRefuse(sessionId, id, plan.changes)).catch(() => null);
    if (result === null) return;
    if (result.ok) setPreview(result.data);
    else setBanner({ resultId: id, failure: failureOf(result.error, plan, known.oneAtATime), failedRow: null, notice: null });
  }, [runner, queryClient]);

  /** O menu da célula: o alvo é perguntado antes, para cada item dizer se vale e por quê. */
  const openMenu = useCallback(async (cell: GridCell, point: { x: number; y: number }, keyboard: boolean) => {
    const known = await ensureTarget();
    const { readOnlyReason: reason, busy: running, saving: writing, shown: current, edits: pending } = latest.current;
    if (current === null) return;

    const access = accessOf(cell, known);
    const read = current.rows.length;
    const changed = cell.row < read ? pendingCell(pending, cell.row, cell.column) !== null : pending.added[cell.row - read]?.values[cell.column] !== undefined;
    const groups = cellMenu({
      value: valueAt(cell),
      access,
      pending: changed,
      deletedRow: cell.row < read && pending.deleted.includes(cell.row),
      nullable: known?.columns[cell.column]?.nullable ?? true,
      newRow: newRowAccess(reason, known, running || writing),
      deleteRow: deleteRowAccess(rowOf(cell.row), reason, known, running || writing),
    });

    setMenu({
      groups,
      point,
      keyboard,
      onChoose: (action) => {
        setMenu(null);
        switch (action) {
          case "copy":
            void copyText(valueAt(cell) ?? "", toast);
            break;
          case "paste":
            void navigator.clipboard.readText().then(
              (text) => whenEditable(cell, () => applyValue(cell, text)),
              () => toast.warning(copy.menu.pasteFailed),
            );
            break;
          case "edit":
            openEditor(cell);
            break;
          case "setNull":
            void whenEditable(cell, () => applyValue(cell, null));
            break;
          case "undo":
            undo(cell);
            break;
          case "newRow":
            void newRow();
            break;
          case "deleteRow":
            void removeRow(cell.row);
            break;
        }
      },
    });
  }, [ensureTarget, accessOf, valueAt, rowOf, whenEditable, applyValue, openEditor, undo, newRow, removeRow, toast]);

  /** RN-EDIT-007: com pendências, a ação (filtrar, ordenar, atualizar, executar de novo) espera a resposta da pergunta. */
  const guard = useCallback((proceed: () => void) => {
    const pending = pendingCount(latest.current.edits);
    if (pending === 0) proceed();
    else setQuestion({ count: pending, proceed });
  }, []);

  // O registro da aba, de onde quem fecha abas pergunta; desmontada (a aba na Estrutura), a vista não tem como salvar.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    unsavedEdits.set(tabId, count === 0 ? null : { count, save: () => saveRef.current(false) });
  }, [tabId, count]);
  useEffect(() => () => unsavedEdits.set(tabId, unsavedEdits.countOf(tabId) === 0 ? null : { count: unsavedEdits.countOf(tabId), save: null }), [tabId]);

  const editing: GridEditing | undefined =
    shown === null
      ? undefined
      : {
          rows,
          marks,
          active,
          editor,
          columnHints: target === null ? null : target.columns.map((column) => (column.editable ? null : copy.readOnly(column.reason ?? ""))),
          onActivate: setActive,
          onEdit: openEditor,
          onDraft: (text) => {
            const open = editorRef.current;
            if (open !== null) setEditor({ row: open.row, column: open.column, draft: text });
          },
          onCommit: commit,
          onCancel: cancel,
          onMenu: (cell, point, keyboard) => void openMenu(cell, point, keyboard),
          onSave: () => void save(),
          onNewRow: () => void newRow(),
        };

  return {
    editing,
    pending: count,
    banner: {
      pending: count,
      oneAtATime: target?.oneAtATime === true,
      saving,
      readOnly: readOnlyReason === null ? (target !== null && !target.tables[0].editable ? copy.readOnly(target.tables[0].reason ?? "") : null) : copy.readOnly(readOnlyReason),
      notice: banner.notice,
      failure: banner.failure,
      onViewSql: () => void viewSql(),
      onDiscard: discard,
      onSave: () => void save(),
    },
    menu,
    closeMenu: () => setMenu(null),
    preview,
    closePreview: () => setPreview(null),
    question:
      question === null
        ? null
        : ({
            count: question.count,
            saving,
            onSave: () => {
              void save(false).then((saved) => {
                if (!saved) return;
                setQuestion(null);
                question.proceed();
              });
            },
            onDiscard: () => {
              discard();
              setQuestion(null);
              question.proceed();
            },
            onCancel: () => setQuestion(null),
          } satisfies UnsavedQuestion),
    guard,
    discard,
    /** Salvar sem ler de novo: quem pediu vai executar outro comando logo em seguida (o filtro que chegou de outra aba). */
    saveOnly: () => void save(false),
  };
}
