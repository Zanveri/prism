import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { unwrap } from "@/lib/api/prism-api";

import { isAutoRefreshAction, type AutoRefreshSource } from "./auto-refresh-menu";
import { cellAccess, columnHintsOf, deleteRowAccess, isJoin, newRowAccess, resultReadOnly, type EditAccess, type RowContext } from "./cell-editing";
import type { Engine } from "@/components/ui/engine-tag";

import { cellMenu, type CellMenuAction, type CellMenuItem } from "./cell-menu";
import type { DatabaseSession } from "./database-sessions.schema";
import { databaseSessionKey } from "./database-sessions.service";
import { customPlan, filterMenuItem, filterPlan, isFilterAction, valuesPlan, type FilterMenuContext, type FilterPlan } from "./filter-menu";
import { cutCellsOf, fetchFullValues, noFullValues, type FetchCells, type FullValues, type GridPosition } from "./full-values";
import { resultCells } from "./full-values.service";
import { nextEditable, type GridCell } from "./grid-cursor";
import { customPrefix, distinctValues, type CompareOperator, type DistinctValue } from "./grid-export/value-filter";
import { gridFilterCopy } from "./grid-filter.copy";
import { gridRowOf, gridRowsOf, rowMarksOf, type CellEditorState, type GridEditing } from "./grid-editing";
import { addRow, changeKeyOf, changesOf, deleteRow, editCell, editNewCell, failureOf, linkedCells, noEdits, pendingCell, pendingCount, removeNewRow, savedResultOf, undoCell, undoDelete, undoNewCell, withoutApplied, type EditValue, type PendingEdits, type SavedResult, type SaveFailure } from "./record-edits";
import { editErrorDetails, type EditPreview, type EditTarget } from "./record-edits.schema";
import { editTargetOrRefuse, previewEditsOrRefuse, saveEditsOrRefuse } from "./record-edits.service";
import { recordsCopy } from "./records.copy";
import { recall, remember } from "./tab-memory";
import { unsavedEdits } from "./unsaved-edits";
import { isBusyState, isPersonBusy, type QueryRunner, type RowsState, type RunnerState } from "./use-query-runner";

const copy = recordsCopy.edit;

/** O que o catálogo respondeu para um resultado: o alvo, ou o motivo de o resultado inteiro ser só leitura. */
type TargetAnswer = { resultId: string; target: EditTarget | null; readOnly: string | null };

/** A faixa: o último Salvar recusado (com a linha dele na grade) e o recado da última tentativa. */
type Banner = { resultId: string | null; failure: SaveFailure | null; failedRow: number | null; notice: string | null };

export type OpenCellMenu = {
  groups: CellMenuItem[][];
  point: { x: number; y: number };
  keyboard: boolean;
  onChoose: (action: CellMenuAction) => void;
  /** O F11 abre o menu com o submenu "Filtrar" já aberto (RN-GRADE-013). */
  submenu?: "filter";
};

/**
 * O campo de filtro da grade (RN-GRADE-013), que o "Filtrar" do menu da célula usa: nos Registros, o campo dos Registros; na aba de consulta, o
 * do resultado. `field` e `removable` são lidos na hora da escolha (o campo muda enquanto o menu está aberto); `apply` recebe o texto novo do campo e o
 * executa (com a pergunta das alterações não salvas, RN-EDIT-007), e `clear` é o "Remover todos os filtros e ordenações".
 */
export type GridFilterSource = {
  engine: Engine | undefined;
  field: () => string;
  removable: () => boolean;
  apply: (text: string) => void;
  clear: () => void;
};

/** O diálogo "Filtrar por valor…" aberto: a coluna, os valores distintos das linhas carregadas e o que fazer com os marcados. */
export type OpenValueFilter = { column: string; values: DistinctValue[]; rows: number; more: boolean; onApply: (chosen: (string | null)[]) => void; onClose: () => void };

/** O campo pequeno do "Personalizado", sobre a grade: o que vai antes do valor (`"code" =`), onde ele abre e o problema do último valor. */
export type OpenCustomFilter = { prefix: string; point: { x: number; y: number }; problem: string | null; onApply: (typed: string) => void; onClose: () => void };

export type UnsavedQuestion = { count: number; saving: boolean; onSave: () => void; onDiscard: () => void; onCancel: () => void };

/** Um Salvar que gravou tudo: o resultado em que gravou, a grade como fica sem executar de novo (RN-EDIT-009) e se quem salvou quer ler de novo. */
export type SavedEdits = { resultId: string; result: SavedResult; reread: boolean };

type Params = {
  tabId: string;
  runner: QueryRunner;
  state: RunnerState;
  /** A conexão da aba: a sessão da árvore dela serve ao catálogo da edição (RN-EDIT-010). Nula na aba de um script sem conexão, que não tem resultado. */
  connectionId: string | null;
  database?: string;
  /** De que grade é a edição, para as frases da faixa: os Registros de uma tabela, ou o resultado de um comando da aba de consulta. */
  subject?: "table" | "result";
  /**
   * Depois de um Salvar que gravou tudo. Os Registros leem de novo (o comando em vigor, executado outra vez), salvo quando quem salvou vai executar
   * outra coisa logo em seguida (`reread` falso); a aba de consulta fica com a grade salva, sem executar (RN-EDIT-009).
   */
  onSaved: (saved: SavedEdits) => void;
  /** RN-GRADE-013: o campo de filtro da grade; sem ele, o menu da célula não tem o "Filtrar". */
  filter?: GridFilterSource;
  /** RN-GRADE-012: o "Atualizar" (F5) do menu da grade: os Registros lidos de novo, ou o comando do resultado executado de novo. */
  refresh?: () => void;
  /** RN-GRADE-014: o "Atualizar automaticamente" do menu da grade, logo depois do "Atualizar"; sem ele, o menu não o tem. */
  autoRefresh?: AutoRefreshSource;
};

const noBanner: Banner = { resultId: null, failure: null, failedRow: null, notice: null };

/** As linhas na tela: com outro comando rodando, as de antes (esmaecidas), sobre as quais nada se edita. */
function shownOf(state: RunnerState): RowsState | null {
  return state.status === "rows" ? state : state.status === "running" && state.previous?.status === "rows" ? state.previous : null;
}

/** RN-SQL-017: as recusas com que as células pedidas ficam cortadas, sem o aviso central: o resultado mudou, a sessão caiu, a célula está fora dele. */
const cellRefusals = ["RESULT_NOT_FOUND", "DATABASE_SESSION_NOT_FOUND", "CELLS_INVALID"];

/**
 * "Copiar valor" e Ctrl+C: o mesmo jeito de copiar do "Copiar nome" do navegador, a área de transferência do navegador e o aviso. `cut` são os
 * valores que não puderam vir inteiros (RN-SQL-017): copiados cortados, e o aviso diz quantos.
 */
async function copyText(text: string, toast: ReturnType<typeof useToast>, cut = 0) {
  try {
    await navigator.clipboard.writeText(text);
    if (cut > 0) toast.warning(copy.menu.copiedCut(cut));
    else toast.success(copy.menu.copied);
  } catch {
    toast.warning(copy.menu.notCopied);
  }
}

/**
 * A edição das células (seção 22, RN-EDIT-001 a 012), entre a grade e a API: a mesma nos Registros de uma tabela e no resultado de um comando
 * da aba de consulta (RN-EDIT-001). As decisões são funções puras com teste (`record-edits.ts`,
 * `cell-editing.ts`, `cell-menu.ts`, `grid-editing.ts`); aqui estão o estado (as pendências, o alvo, a célula ativa, o campo aberto, a
 * faixa, o menu, o "Ver SQL" e a pergunta) e as chamadas.
 *
 * - As pendências são do resultado da página (`resultId`): outra execução começa sem nenhuma, e quem executa de novo com pendências
 *   pergunta antes (`guard`, RN-EDIT-007). Ficam na memória da aba (`tab-memory.ts`): ir à Estrutura e voltar não as perde.
 * - O catálogo é consultado na primeira tentativa de editar (RN-EDIT-010), pela sessão da árvore da mesma conexão quando ela existe.
 * - O Salvar grava pela sessão da aba, numa transação própria (a aba de uma tabela é sempre Auto-commit, e a de consulta ainda não tem o
 *   Commit manual na tela, RN-TX-001); se gravou tudo, quem usa decide (`onSaved`): os Registros leem de novo, e a aba de consulta fica com a
 *   grade salva. A recusa fica na faixa, com a mensagem do banco como veio e a linha destacada; no banco sem log, o que já foi gravado sai das
 *   pendências (RN-EDIT-012). Sem o alvo (as pendências lembradas com a aba voltam sem ele), o Salvar e o "Ver SQL" o perguntam antes.
 * - As alterações não salvas vão ao registro da aba (`unsaved-edits.ts`), de onde quem fecha abas pergunta.
 */
export function useRecordEdits({ tabId, runner, state, connectionId, database, subject = "table", onSaved, filter, refresh, autoRefresh }: Params) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const shown = shownOf(state);
  const resultId = shown?.resultId ?? null;
  // RN-SESSAO-002: algo em andamento na aba. "Atualizar" e "Filtrar" seguem o comando da PESSOA (`personBusy`): a execução da atualização automática não os
  // segura, e o comando toma o lugar dela (RN-GRADE-014). A edição espera também por ela (`"refresh"`, com o motivo próprio): as linhas e o resultado da API
  // vão mudar, e o que se editasse agora sumiria com eles.
  const personBusy = isPersonBusy(state);
  const busy: boolean | "refresh" = personBusy || (isBusyState(state) ? "refresh" : false);

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
  // O menu é do resultado em que abriu, como o campo: as linhas trocadas debaixo dele (a execução automática que já rodava quando ele abriu) o fecham, em vez
  // de deixar a escolha cair na mesma posição de outra linha.
  const [menuState, setMenu] = useState<(OpenCellMenu & { resultId: string | null }) | null>(null);
  const menu: OpenCellMenu | null = menuState !== null && menuState.resultId === resultId ? menuState : null;
  const [preview, setPreview] = useState<EditPreview | null>(null);
  const [question, setQuestion] = useState<{ count: number; proceed: () => void } | null>(null);
  // RN-GRADE-013: o diálogo "Filtrar por valor…" e o campo do "Personalizado", com o que cada um precisa para juntar a condição ao campo.
  const [valueFilter, setValueFilter] = useState<{ cell: GridCell; values: DistinctValue[]; rows: number; more: boolean } | null>(null);
  const [customFilter, setCustomFilter] = useState<{ cell: GridCell; operator: CompareOperator; point: { x: number; y: number }; problem: string | null } | null>(null);
  const sources = useRef({ filter, refresh, autoRefresh });
  useEffect(() => {
    sources.current = { filter, refresh, autoRefresh };
  });
  // RN-SQL-017: a busca dos valores completos em andamento, que a faixa mostra e deixa cancelar.
  const [fetching, setFetching] = useState<AbortController | null>(null);
  const fetchingRef = useRef<AbortController | null>(null);

  // RN-EDIT-002: numa junção, a pendência de uma linha de uma tabela aparece em todas as linhas da grade que a mostram.
  const view = useMemo(() => (shown === null || target === null || !isJoin(target) ? edits : linkedCells(edits, shown.rows, target)), [edits, shown, target]);
  const rows = useMemo(() => (shown === null ? [] : gridRowsOf(shown.rows, view, shown.columns.length)), [shown, view]);
  const marks = useMemo(() => rowMarksOf(view, shown?.rows.length ?? 0, banner.failedRow), [view, shown, banner.failedRow]);
  const count = pendingCount(edits);
  const columnHints = useMemo(() => columnHintsOf(target), [target]);
  // Na aba de consulta o cabeçalho marca a coluna que não se edita, como no canvas; os Registros, de uma tabela só, ficam como estavam. Memorizado:
  // a grade conta a largura das colunas por ele.
  const columnReadOnly = useMemo(() => (subject === "result" && target !== null ? target.columns.map((column) => !column.editable) : null), [subject, target]);

  // Tudo o que as ações leem depois de um `await`: o estado de agora, e não o da renderização em que a ação começou.
  const latest = useRef({ shown, resultId, edits, target, readOnlyReason, busy, personBusy, saving });
  useEffect(() => {
    latest.current = { shown, resultId, edits, target, readOnlyReason, busy, personBusy, saving };
  });

  /** As pendências como a grade as mostra agora (numa junção, repetidas nas linhas que mostram a mesma linha da tabela). */
  const viewNow = useCallback((): PendingEdits => {
    const { shown: current, edits: pending, target: known } = latest.current;
    return current === null || known === null || !isJoin(known) ? pending : linkedCells(pending, current.rows, known);
  }, []);

  /** Numa junção, a linha da tabela da coluna nesta linha lida (RN-EDIT-002); fora dela, nada. */
  const changeAt = useCallback((cell: GridCell): string | undefined => {
    const { shown: current, target: known } = latest.current;
    if (current === null || known === null || !isJoin(known) || cell.row >= current.rows.length) return undefined;
    return changeKeyOf(current.rows, known, cell.row, cell.column) ?? undefined;
  }, []);
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

    const catalogSessionId = connectionId === null ? null : (queryClient.getQueryData<DatabaseSession>(databaseSessionKey(connectionId, database))?.id ?? null);
    const promise = (async () => {
      say(subject === "result" ? copy.loadingResultTarget : copy.loadingTarget);
      const result = await throughMutationCache(queryClient, () => editTargetOrRefuse(sessionId, id, catalogSessionId)).catch(() => null);
      // O recado de "conferindo" é deste resultado; o de agora pode ser outro (RN-GRADE-014), e o que vale nele fica.
      setBanner((current) => (current.resultId === id ? { ...current, notice: null } : current));
      // A resposta é deste resultado (`setAnswer` a guarda com ele); o que as ações leem agora só a recebe se ele ainda é o da tela: o alvo de um resultado
      // que já saiu não vale para as linhas que entraram no lugar dele.
      const stillShown = latest.current.resultId === id;
      if (result === null) return null;
      if (result.ok) {
        setAnswer({ resultId: id, target: result.data, readOnly: null });
        if (stillShown) latest.current = { ...latest.current, target: result.data };
        return result.data;
      }
      if (result.error.code === "RESULT_NOT_EDITABLE") {
        const why = editErrorDetails(result.error.extensions).reason ?? result.error.detail ?? result.error.title;
        setAnswer({ resultId: id, target: null, readOnly: why });
        if (stillShown) latest.current = { ...latest.current, readOnlyReason: why };
        return null;
      }
      setBanner({ resultId: id, failure: { headline: subject === "result" ? copy.checkResultFailed : copy.checkFailed, detail: result.error.detail ?? result.error.title, origin: null, column: null, applied: 0, written: false }, failedRow: null, notice: null });
      return null;
    })();
    asking.current = { resultId: id, promise };
    void promise.finally(() => {
      if (asking.current?.promise === promise) asking.current = null;
    });

    return promise;
  }, [runner, queryClient, connectionId, database, subject, say]);

  /**
   * RN-GRADE-014: segura a atualização automática desde o COMEÇO de uma ação que pergunta o alvo à API antes de agir (abrir o campo ou o menu, a linha
   * nova, excluir a linha, colar). A pausa da edição só vinha com o campo ou o menu já abertos: a execução que saísse durante a pergunta trocava as linhas, e
   * a ação caía na mesma posição de OUTRA linha do banco. A pausa entra na hora; ao soltar, a vista decide de novo com o que a ação abriu (o campo, o menu),
   * na mesma renderização, sem um instante livre entre uma coisa e outra.
   */
  const holds = useRef(0);
  const [released, setReleased] = useState(0);
  const hold = useCallback(() => {
    holds.current += 1;
    runner.autoRefresh.pause("editing", true);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      holds.current -= 1;
      setReleased((times) => times + 1);
    };
  }, [runner]);

  /**
   * O resultado da tela já não é `from`, o de quando a ação começou: as linhas são outras, e a ação que era sobre as de antes não vale nelas. Lê também o
   * executor na hora, e não só a última renderização.
   */
  const moved = useCallback((from: string | null) => latest.current.resultId !== from || (shownOf(runner.getState())?.resultId ?? null) !== from, [runner]);

  /** A linha da grade: uma lida (com o corte e a exclusão) ou uma nova. */
  const rowOf = useCallback((row: number): RowContext => {
    const { shown: current, edits: pending } = latest.current;
    const read = current?.rows.length ?? 0;
    return row < read ? { kind: "read", truncated: current?.truncated.get(row), deleted: pending.deleted.includes(row), generated: current?.generated?.get(row), values: current?.rows[row] } : { kind: "new" };
  }, []);

  const accessOf = useCallback((cell: GridCell, known: EditTarget | null = latest.current.target): EditAccess => {
    const { readOnlyReason: reason, busy: running, saving: writing } = latest.current;
    return cellAccess({ readOnly: reason, target: known, busy: writing || running, column: cell.column, row: rowOf(cell.row) });
  }, [rowOf]);

  /** O texto que a célula mostra agora: a pendência, quando há, ou o valor lido. */
  const valueAt = useCallback((cell: GridCell): EditValue => {
    const { shown: current, edits: pending } = latest.current;
    const read = current?.rows.length ?? 0;
    if (cell.row < read) {
      const changed = pendingCell(viewNow(), cell.row, cell.column);
      return changed === null ? (current?.rows[cell.row][cell.column] ?? null) : changed.value;
    }
    return pending.added[cell.row - read]?.values[cell.column] ?? null;
  }, [viewNow]);

  /**
   * RN-SQL-017: o valor completo das células cortadas entre `cells`, pedido à API pela linha do resultado, em lotes de até 10.000. Sem célula
   * cortada, responde na hora, sem pedido. Enquanto busca, a faixa diz e oferece cancelar (nulo: quem pediu não copia nem grava nada), e a grade
   * segue livre; uma busca nova cancela a anterior. `from` é o resultado de onde as células são (por padrão, o da tela).
   */
  const completeValues = useCallback(
    async (cells: Iterable<GridPosition>, from: RowsState | null = latest.current.shown): Promise<FullValues | null> => {
      const cut = from === null ? [] : cutCellsOf(cells, from.truncated, from.sourceRows);
      if (cut.length === 0) return noFullValues;
      const sessionId = runner.sessionOf();
      const id = from?.resultId ?? null;
      if (sessionId === null || id === null) return { valueOf: () => undefined, missing: cut.length };

      fetchingRef.current?.abort();
      const controller = new AbortController();
      fetchingRef.current = controller;
      setFetching(controller);
      const fetchCells: FetchCells = async (batch, signal) => {
        const answer = await resultCells(sessionId, id, batch, signal);
        if (signal.aborted) return null;
        if (answer.ok) return answer.data;
        // O resto (a API fora do ar) vai também ao aviso central, como toda chamada que falha (RN-AVISO-004); as células ficam cortadas do mesmo jeito.
        if (!cellRefusals.includes(answer.error.code)) await throughMutationCache(queryClient, async () => unwrap(answer)).catch(() => undefined);
        return null;
      };
      const full = await fetchFullValues(cut, fetchCells, controller.signal);
      if (fetchingRef.current === controller) {
        fetchingRef.current = null;
        setFetching(null);
      }
      return full;
    },
    [runner, queryClient],
  );

  const cancelFetch = useCallback(() => {
    fetchingRef.current?.abort();
    fetchingRef.current = null;
    setFetching(null);
  }, []);

  /** Grava um valor na célula como pendência; voltar ao valor lido tira a pendência. */
  const applyValue = useCallback((cell: GridCell, value: EditValue) => {
    const { shown: current, edits: pending } = latest.current;
    const read = current?.rows.length ?? 0;
    if (cell.row < read) putEdits(editCell(pending, cell.row, cell.column, value, current!.rows[cell.row][cell.column], changeAt(cell)));
    else {
      const row = pending.added[cell.row - read];
      if (row !== undefined) putEdits(editNewCell(pending, row.id, cell.column, value));
    }
  }, [putEdits, changeAt]);

  /** RN-GRADE-002 e RN-SQL-017: copiar a célula (Ctrl+C, "Copiar valor"), com o valor completo quando ela chegou cortada. */
  const copyCell = useCallback(
    async (cell: GridCell) => {
      const shownValue = valueAt(cell) ?? "";
      const full = await completeValues([cell]);
      if (full === null) return;
      await copyText(full.valueOf(cell.row, cell.column) ?? shownValue, toast, full.missing);
    },
    [valueAt, completeValues, toast],
  );

  /**
   * A ação que precisa da célula editável: pergunta o alvo, confere, e só então age; senão a faixa diz por quê. A recusa que não depende do alvo (a aba
   * ocupada, o resultado só leitura) sai antes, sem perguntar à API por um resultado que está para mudar. `from` é o resultado da célula (por padrão, o da
   * tela): se ele saiu antes de a ação agir, ela não age (RN-GRADE-014).
   */
  const whenEditable = useCallback(async (cell: GridCell, act: () => void, from: string | null = latest.current.resultId) => {
    if (moved(from)) return;
    const early = accessOf(cell);
    if (!early.editable) return say(early.reason);
    const release = hold();
    try {
      const known = await ensureTarget();
      if (moved(from)) return;
      const access = accessOf(cell, known);
      if (!access.editable) return say(access.reason);
      if (known === null) return;
      say(null);
      act();
    } finally {
      release();
    }
  }, [ensureTarget, accessOf, say, hold, moved]);

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
    const from = latest.current.resultId;
    const early = newRowAccess(latest.current.readOnlyReason, latest.current.target, latest.current.saving || latest.current.busy);
    if (!early.editable) return say(early.reason);
    const release = hold();
    try {
      const known = await ensureTarget();
      if (moved(from)) return;
      const { readOnlyReason: reason, busy: running, saving: writing, shown: current } = latest.current;
      const access = newRowAccess(reason, known, writing || running);
      if (!access.editable) return say(access.reason);
      if (known === null || current === null) return;

      const { edits: next } = addRow(latest.current.edits);
      putEdits(next);
      const row = current.rows.length + next.added.length - 1;
      const column = known.columns.findIndex((info) => info.editable);
      setActive({ row, column: Math.max(column, 0) });
      say(null);
    } finally {
      release();
    }
  }, [ensureTarget, putEdits, say, setActive, hold, moved]);

  /** Exclui a linha (ou tira a nova). `from` é o resultado da linha (por padrão, o da tela): se ele saiu antes de a exclusão valer, nada muda. */
  const removeRow = useCallback(async (row: number, from: string | null = latest.current.resultId) => {
    if (moved(from)) return;
    const early = deleteRowAccess(rowOf(row), latest.current.readOnlyReason, latest.current.target, latest.current.saving || latest.current.busy);
    if (!early.editable) return say(early.reason);
    const release = hold();
    try {
      const known = await ensureTarget();
      if (moved(from)) return;
      const { readOnlyReason: reason, busy: running, saving: writing, shown: current, edits: pending } = latest.current;
      const access = deleteRowAccess(rowOf(row), reason, known, writing || running);
      if (!access.editable) return say(access.reason);
      if (known === null || current === null) return;

      const read = current.rows.length;
      putEdits(row < read ? deleteRow(pending, row) : removeNewRow(pending, pending.added[row - read].id));
      say(null);
    } finally {
      release();
    }
  }, [ensureTarget, rowOf, putEdits, say, hold, moved]);

  const undo = useCallback((cell: GridCell) => {
    const { shown: current, edits: pending } = latest.current;
    const read = current?.rows.length ?? 0;
    if (cell.row < read) putEdits(pending.deleted.includes(cell.row) ? undoDelete(pending, cell.row) : undoCell(pending, cell.row, cell.column, changeAt(cell)));
    else {
      const row = pending.added[cell.row - read];
      if (row !== undefined) putEdits(undoNewCell(pending, row.id, cell.column));
    }
  }, [putEdits, changeAt]);

  const discard = useCallback(() => {
    setEditor(null);
    putEdits(noEdits);
    setBanner(noBanner);
  }, [setEditor, putEdits]);

  /** RN-EDIT-005 e 012: o Salvar. Devolve se gravou tudo; `reread` vai a `onSaved` (os Registros leem de novo). */
  const save = useCallback(async (reread = true): Promise<boolean> => {
    const { shown: current, resultId: id, edits: pending, saving: writing } = latest.current;
    const sessionId = runner.sessionOf();
    if (pendingCount(pending) === 0) return true;
    if (writing || current === null || id === null || sessionId === null) return false;

    setSaving(true);
    latest.current = { ...latest.current, saving: true };
    try {
      const known = latest.current.target ?? (await ensureTarget());
      if (known === null || latest.current.resultId !== id) return false;

      const plan = changesOf(pending, current.rows, known);
      const result = await throughMutationCache(queryClient, () => saveEditsOrRefuse(sessionId, id, plan.changes)).catch(() => null);
      if (result === null) return false;

      if (result.ok) {
        toast.success(copy.saved(result.data.applied));
        putEdits(noEdits);
        setBanner(noBanner);
        // RN-EDIT-009: numa junção, o valor salvo fica em todas as linhas que mostram a mesma linha da tabela.
        const saved = savedResultOf(current, isJoin(known) ? linkedCells(pending, current.rows, known) : pending, current.columns.length);
        // Na grade que fica (a aba de consulta), as excluídas saíram: a célula ativa não aponta para depois da última linha.
        setActiveState((held) => (held === null || held.resultId !== id || held.cell.row < saved.rows.length ? held : { resultId: id, cell: { row: Math.max(saved.rows.length - 1, 0), column: held.cell.column } }));
        onSaved({ resultId: id, result: saved, reread });
        return true;
      }

      const failure = failureOf(result.error, plan, known.oneAtATime);
      const done = failure.applied + (failure.written ? 1 : 0);
      const left = done > 0 ? withoutApplied(pending, plan.origins, done) : pending;
      if (left !== pending) putEdits(left);
      setBanner({ resultId: id, failure, failedRow: failure.origin === null || failure.written ? null : gridRowOf(failure.origin, left, current.rows.length), notice: null });
      return false;
    } finally {
      setSaving(false);
      latest.current = { ...latest.current, saving: false };
    }
  }, [runner, queryClient, toast, putEdits, ensureTarget, onSaved]);

  /** RN-EDIT-008: "Ver SQL", pela API, sem executar nada. */
  const viewSql = useCallback(async () => {
    const { shown: current, resultId: id, edits: pending } = latest.current;
    const sessionId = runner.sessionOf();
    if (current === null || id === null || sessionId === null) return;
    const known = latest.current.target ?? (await ensureTarget());
    if (known === null || latest.current.resultId !== id) return;

    const plan = changesOf(pending, current.rows, known);
    const result = await throughMutationCache(queryClient, () => previewEditsOrRefuse(sessionId, id, plan.changes)).catch(() => null);
    if (result === null) return;
    if (result.ok) setPreview(result.data);
    else setBanner({ resultId: id, failure: failureOf(result.error, plan, known.oneAtATime), failedRow: null, notice: null });
  }, [runner, queryClient, ensureTarget]);

  /**
   * O que o "Filtrar" sabe da célula agora (RN-GRADE-013): o valor LIDO (a pendência ainda não está no banco), se chegou cortado, a linha nova, o
   * texto do campo e se a aba está ocupada. Nulo sem campo de filtro, sem o banco da conexão ou sem a coluna.
   */
  const filterContextOf = useCallback((cell: GridCell): FilterMenuContext | null => {
    const source = sources.current.filter;
    const { shown: current, personBusy: running, saving: writing } = latest.current;
    const column = current?.columns[cell.column];
    if (source === undefined || source.engine === undefined || current === null || column === undefined) return null;

    const read = cell.row < current.rows.length;
    return {
      engine: source.engine,
      column,
      cell: read ? { kind: "read", value: current.rows[cell.row][cell.column] ?? null, truncated: current.truncated.get(cell.row)?.has(cell.column) === true } : { kind: "new" },
      field: source.field(),
      removable: source.removable(),
      busy: running || writing,
    };
  }, []);

  /** Faz o que a escolha do "Filtrar" pede: juntar ao campo e executar, abrir o diálogo dos valores, o campo do personalizado, ou limpar tudo. */
  const runFilterPlan = useCallback((cell: GridCell, plan: FilterPlan, point: { x: number; y: number }) => {
    const source = sources.current.filter;
    const current = latest.current.shown;
    if (source === undefined || current === null) return;
    if (plan.kind === "apply") return source.apply(plan.text);
    if (plan.kind === "clear") return source.clear();
    if (plan.kind === "custom") return setCustomFilter({ cell, operator: plan.operator, point, problem: null });

    const column = current.columns[cell.column];
    if (source.engine === undefined || column === undefined) return;
    setValueFilter({ cell, values: distinctValues(source.engine, column, current.rows, cell.column, current.truncated), rows: current.rows.length, more: current.hasMore });
  }, []);

  /** Ctrl+F11: o "Filtrar por valor…" direto; o que não se aplica diz por quê na faixa. */
  const openValueFilter = useCallback((cell: GridCell, point: { x: number; y: number }) => {
    const context = filterContextOf(cell);
    if (context === null) return;
    const plan = filterPlan(context, "filter:byValue");
    if (plan !== null) return runFilterPlan(cell, plan, point);
    const first = filterMenuItem(context).submenu?.groups[0];
    say((Array.isArray(first) ? first[0]?.hint : undefined) ?? null);
  }, [filterContextOf, runFilterPlan, say]);

  /**
   * O menu da célula: o alvo é perguntado antes, para cada item dizer se vale e por quê. `submenu` é o F11, que abre com o "Filtrar" aberto. O menu é do
   * resultado em que abriu (RN-GRADE-014): se as linhas mudaram enquanto o alvo era perguntado, ele não abre; e a escolha sobre a célula feita depois de elas
   * mudarem não age (só "Atualizar" e "Atualizar automaticamente", que não são da célula).
   */
  const openMenu = useCallback(async (cell: GridCell, point: { x: number; y: number }, keyboard: boolean, submenu?: "filter") => {
    const from = latest.current.resultId;
    const release = hold();
    try {
      // Com algo em andamento a edição está recusada de todo jeito: o menu sai com o alvo que já se sabe, sem perguntar à API por um resultado que vai mudar.
      const known = latest.current.busy === false ? await ensureTarget() : latest.current.target;
      if (moved(from)) return;
      const { readOnlyReason: reason, busy: running, personBusy, saving: writing, shown: current, edits: pending } = latest.current;
      if (current === null) return;

      const access = accessOf(cell, known);
      const read = current.rows.length;
      const changed = cell.row < read ? pendingCell(viewNow(), cell.row, cell.column) !== null : pending.added[cell.row - read]?.values[cell.column] !== undefined;
      const filterContext = filterContextOf(cell);
      const groups = cellMenu({
        value: valueAt(cell),
        access,
        pending: changed,
        deletedRow: cell.row < read && pending.deleted.includes(cell.row),
        nullable: known?.columns[cell.column]?.nullable ?? true,
        newRow: newRowAccess(reason, known, writing || running),
        deleteRow: deleteRowAccess(rowOf(cell.row), reason, known, writing || running),
        ...(filterContext === null ? {} : { filter: filterMenuItem(filterContext) }),
        ...(sources.current.refresh === undefined ? {} : { refresh: personBusy || writing ? { editable: false, reason: gridFilterCopy.menu.unavailable(gridFilterCopy.reasons.busy) } : { editable: true } }),
        ...(sources.current.autoRefresh === undefined ? {} : { autoRefresh: sources.current.autoRefresh.item() }),
      });

      setMenu({
        resultId: from,
        groups,
        point,
        keyboard,
        ...(submenu !== undefined && filterContext !== null ? { submenu } : {}),
        onChoose: (action) => {
          setMenu(null);
          if (isAutoRefreshAction(action)) return sources.current.autoRefresh?.choose(action);
          if (action === "refresh") return sources.current.refresh?.();
          // As linhas mudaram com o menu aberto (a execução automática que já rodava quando ele abriu): a célula escolhida é de uma linha que não está mais ali.
          if (moved(from)) return;
          if (isFilterAction(action)) {
            // O campo e a aba podem ter mudado com o menu aberto: a escolha é decidida de novo, com o que vale agora.
            const now = filterContextOf(cell);
            const plan = now === null ? null : filterPlan(now, action);
            if (plan !== null) runFilterPlan(cell, plan, point);
            return;
          }
          switch (action) {
            case "copy":
              void copyCell(cell);
              break;
            case "paste": {
              // A leitura da área de transferência também segura a atualização automática: o menu já fechou, e a colagem é na linha que ele mostrava.
              const reading = hold();
              void navigator.clipboard
                .readText()
                .then(
                  (text) => whenEditable(cell, () => applyValue(cell, text), from),
                  () => toast.warning(copy.menu.pasteFailed),
                )
                .finally(reading);
              break;
            }
            case "edit":
              openEditor(cell);
              break;
            case "setNull":
              void whenEditable(cell, () => applyValue(cell, null), from);
              break;
            case "undo":
              undo(cell);
              break;
            case "newRow":
              void newRow();
              break;
            case "deleteRow":
              void removeRow(cell.row, from);
              break;
          }
        },
      });
    } finally {
      release();
    }
  }, [ensureTarget, accessOf, valueAt, rowOf, whenEditable, applyValue, openEditor, undo, newRow, removeRow, copyCell, toast, viewNow, filterContextOf, runFilterPlan, hold, moved]);

  /** RN-EDIT-007: com pendências, a ação (filtrar, ordenar, atualizar, executar de novo) espera a resposta da pergunta. */
  const guard = useCallback((proceed: () => void) => {
    const pending = pendingCount(latest.current.edits);
    if (pending === 0) proceed();
    else setQuestion({ count: pending, proceed });
  }, []);

  // RN-GRADE-014: a atualização automática fica em pausa enquanto a grade é editada (alteração não salva, célula aberta) ou tem um menu ou diálogo aberto
  // sobre ela, e enquanto uma ação pergunta o alvo para abrir um deles (`hold`): a execução trocaria as linhas debaixo do que a pessoa está fazendo. Ao sair
  // da pausa ela executa na hora, se o prazo já passou. `released` faz decidir de novo quando uma ação solta a pausa. A vista que sai de cena (ou o executor
  // trocado) tira a pausa dela do executor.
  const gridInUse = count > 0 || editor !== null || menu !== null || valueFilter !== null || customFilter !== null;
  useEffect(() => {
    runner.autoRefresh.pause("editing", gridInUse || holds.current > 0);
  }, [runner, gridInUse, released]);
  useEffect(() => () => runner.autoRefresh.pause("editing", false), [runner]);

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
          pending: count,
          marks,
          active,
          editor,
          columnHints,
          columnReadOnly,
          onActivate: setActive,
          onEdit: openEditor,
          onDraft: (text) => {
            const open = editorRef.current;
            if (open !== null) setEditor({ row: open.row, column: open.column, draft: text });
          },
          onCommit: commit,
          onCancel: cancel,
          onMenu: (cell, point, keyboard) => void openMenu(cell, point, keyboard),
          onCopy: (cell) => void copyCell(cell),
          onSave: () => void save(),
          onNewRow: () => void newRow(),
          ...(filter === undefined
            ? {}
            : {
                onFilter: (cell: GridCell, point: { x: number; y: number }, mode: "menu" | "values") => {
                  if (mode === "values") openValueFilter(cell, point);
                  else void openMenu(cell, point, true, "filter");
                },
              }),
        };

  return {
    editing,
    pending: count,
    banner: {
      pending: count,
      oneAtATime: target?.oneAtATime === true,
      saving,
      readOnly: resultReadOnly(readOnlyReason, target),
      notice: banner.notice,
      failure: banner.failure,
      fetching: fetching !== null,
      onCancelFetch: cancelFetch,
      onViewSql: () => void viewSql(),
      onDiscard: discard,
      onSave: () => void save(),
    },
    menu,
    closeMenu: () => setMenu(null),
    valueFilter:
      valueFilter === null
        ? null
        : ({
            column: shown?.columns[valueFilter.cell.column]?.name ?? "",
            values: valueFilter.values,
            rows: valueFilter.rows,
            more: valueFilter.more,
            onApply: (chosen) => {
              const context = filterContextOf(valueFilter.cell);
              const plan = context === null ? null : valuesPlan(context, chosen);
              setValueFilter(null);
              if (plan !== null) runFilterPlan(valueFilter.cell, plan, { x: 0, y: 0 });
            },
            onClose: () => setValueFilter(null),
          } satisfies OpenValueFilter),
    customFilter:
      customFilter === null || shown?.columns[customFilter.cell.column] === undefined
        ? null
        : ({
            prefix: customPrefix(shown.columns[customFilter.cell.column], customFilter.operator),
            point: customFilter.point,
            problem: customFilter.problem,
            onApply: (typed) => {
              const context = filterContextOf(customFilter.cell);
              const plan = context === null ? null : customPlan(context, customFilter.operator, typed);
              if (plan !== null && "problem" in plan) return setCustomFilter({ ...customFilter, problem: plan.problem });
              setCustomFilter(null);
              if (plan !== null) runFilterPlan(customFilter.cell, plan, customFilter.point);
            },
            onClose: () => setCustomFilter(null),
          } satisfies OpenCustomFilter),
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
    /** RN-SQL-017: o valor completo das células cortadas, para exportar (copiar já passa por aqui). */
    completeValues,
  };
}

/** O que a edição devolve a quem a usa: a vista Registros e a aba de consulta. */
export type RecordEdits = ReturnType<typeof useRecordEdits>;
