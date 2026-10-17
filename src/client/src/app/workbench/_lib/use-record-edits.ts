import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { unwrap } from "@/lib/api/prism-api";
import { isMacPlatform } from "@/lib/utils/platform";

import { isAutoRefreshAction, type AutoRefreshSource } from "./auto-refresh-menu";
import { cellAccess, columnHintsOf, deleteRowsAccess, isJoin, newRowAccess, resultReadOnly, type EditAccess, type RowContext, type SelectedRow } from "./cell-editing";
import type { Engine } from "@/components/ui/engine-tag";

import { cellMenu, isCopyAsAction, isGenerateSqlAction, type CellMenuAction, type CellMenuItem, type CopyAsAccess, type CopyAsAction, type GenerateSqlAction, type GenerateSqlKind } from "./cell-menu";
import type { DatabaseSession } from "./database-sessions.schema";
import { databaseSessionKey } from "./database-sessions.service";
import { duplicatePlan, type DuplicatePlan, type DuplicateSource } from "./duplicate-row";
import { editBar, type EditBarAction, type EditBarButton } from "./edit-bar";
import { customPlan, filterMenuItem, filterPlan, isFilterAction, valuesPlan, type FilterMenuContext, type FilterPlan } from "./filter-menu";
import { cutCellsOf, fetchFullValues, noFullValues, type FetchCells, type FullValues, type GridPosition, type KeepGoing } from "./full-values";
import { resultCells } from "./full-values.service";
import { buildCopyText, clipboardLimit, columnNamesText, copiedNotice, copyCeiling, rowNumbersOf, utf8Length } from "./grid-copy";
import { nextEditable, type GridCell } from "./grid-cursor";
import { completeSlice } from "./grid-export/grid-slice";
import { customPrefix, distinctValues, type CompareOperator, type DistinctValue } from "./grid-export/value-filter";
import { gridFilterCopy } from "./grid-filter.copy";
import { editShortcuts, gridRowOf, gridRowsOf, rowMarksOf, type CellEditorState, type GridEditing } from "./grid-editing";
import {
  activeCell,
  afterSave,
  choseWholeRows,
  collapse,
  contextCell,
  contextRow,
  emptySelection,
  hasSeveralCells,
  isSelected,
  positionOf,
  refAt,
  rowSpan,
  select,
  selectedColumns,
  selectedRows,
  selectionSize,
  selectNewRows,
  sliceOf,
  type GridLayout,
  type GridSelection,
  type RowRef,
  type SelectionSlice,
  type SliceScope,
  type SliceSource,
} from "./grid-selection";
import { gridSelectionCopy } from "./grid-selection.copy";
import { addRow, changeKeyOf, changesOf, deleteRow, editCell, editNewCell, failureOf, linkedCells, noEdits, pendingCell, pendingCount, removeNewRow, savedResultOf, undoWhere, withoutApplied, type EditValue, type PendingEdits, type SavedResult, type SaveFailure } from "./record-edits";
import { editErrorDetails, type EditPreview, type EditTarget } from "./record-edits.schema";
import { editTargetOrRefuse, previewEditsOrRefuse, saveEditsOrRefuse } from "./record-edits.service";
import { recordsCopy } from "./records.copy";
import { recall, remember } from "./tab-memory";
import type { RecordsSort } from "./table-sql";
import { unsavedEdits } from "./unsaved-edits";
import { isBusyState, isPersonBusy, type QueryRunner, type RowsState, type RunnerState } from "./use-query-runner";

const copy = recordsCopy.edit;
const selectionCopy = gridSelectionCopy;

/** A plataforma, para os atalhos que o menu da célula escreve (RN-EDIT-015): Option e Cmd no macOS. */
const platform = typeof navigator === "undefined" ? "" : navigator.platform;

/** RN-EDIT-016: "Duplicar linhas" vale para até 1.000 linhas de uma vez. */
export const duplicateLimit = 1_000;

/** Quanto o copiar espera antes de dizer "Copiando…" na faixa (RN-GRADE-002). */
const copyingAfterMs = 500;

/**
 * Seção 37: o que a grade entrega às frentes do "Copiar avançado" e do "Gerar SQL" (RN-GRADE-003, 006 e 016 a 018) quando um item delas é escolhido no menu,
 * ou o Ctrl+Shift+C: a seleção e a grade de quando a ação começou, o recorte dela com os valores que a grade mostra (`slice`), a busca dos valores completos
 * das cortadas (`complete`, com a faixa e o "Cancelar", RN-SQL-017), a pausa da atualização automática (`hold`, RN-GRADE-014), a pergunta "o resultado ainda
 * é o mesmo?" (`moved`) e o alvo da edição (`target`, o que já se sabe, e `ensureTarget`, que pergunta à API uma vez por resultado, RN-EDIT-010).
 */
export type GridSelectionContext = {
  resultId: string | null;
  /** As linhas na tela quando a ação começou (o executor ou a aba guardada do script). */
  shown: RowsState;
  engine: Engine | undefined;
  /** De que grade é: os Registros de uma tabela, ou o resultado de um comando. */
  subject: "table" | "result";
  target: EditTarget | null;
  selection: GridSelection;
  layout: GridLayout;
  /** As linhas da seleção (as que têm uma célula escolhida) e as colunas dela, pela posição na grade, em ordem. */
  rows: readonly number[];
  columns: readonly number[];
  /** O recorte: as células escolhidas (o padrão), as linhas inteiras da seleção, ou todas as linhas carregadas. */
  slice: (scope?: SliceScope) => SelectionSlice;
  /** RN-SQL-017: o recorte com o valor completo das células cortadas; nulo quando a pessoa cancelou a busca. `missing`: quantas não vieram inteiras. */
  complete: (slice: SelectionSlice, keepGoing?: KeepGoing) => Promise<{ slice: SelectionSlice; missing: number; stopped: boolean } | null>;
  /** RN-GRADE-014: a pausa da atualização automática desde o começo da ação; devolve quem a solta. */
  hold: () => () => void;
  /** O resultado da tela já não é o desta seleção: a ação não age. */
  moved: () => boolean;
  ensureTarget: () => Promise<EditTarget | null>;
};

/**
 * Os itens de outra frente no menu da grade (o "Copiar avançado", o "Gerar SQL"): o estado deles ao abrir o menu (se valem, ou por quê não) e o que cada um
 * faz, com a seleção de quando foi escolhido.
 */
export type GridMenuSource<A extends string, S> = { access: (context: GridSelectionContext) => S; choose: (action: A, context: GridSelectionContext) => void };

/** RN-GRADE-003, 016 e 017: o "Copiar avançado…" (também o Ctrl+Shift+C), os nove "Copiar como" e o "Configurar comandos 'Copiar como'…". */
export type CopyAsSource = GridMenuSource<CopyAsAction, CopyAsAccess>;

/** RN-GRADE-006 e 018: os seis itens do "Gerar SQL". */
export type GenerateSqlSource = GridMenuSource<GenerateSqlAction, Partial<Record<GenerateSqlKind, EditAccess>>>;

/**
 * RN-GRADE-004: o "Ordenar" do menu, pelo mesmo caminho do clique no cabeçalho (RN-TABELA-010) nos Registros e do campo de filtro no resultado
 * (RN-GRADE-011): a ordem em uso e o que a troca (`null` tira a ordem).
 */
export type GridSortSource = { current: () => RecordsSort | null; apply: (sort: RecordsSort | null) => void };

/** RN-TABELA-007: o "Ir para o registro referenciado" dos Registros: a coluna é chave estrangeira, o valor tem para onde ir, e o que segue. */
export type GridFollowSource = { links: (column: number) => boolean; linkable: (value: string) => boolean; follow: (column: number, value: string) => void };

/** O que o catálogo respondeu para um resultado: o alvo, ou o motivo de o resultado inteiro ser só leitura. */
type TargetAnswer = { resultId: string; target: EditTarget | null; readOnly: string | null };

/**
 * A faixa: o último Salvar recusado (com a linha dele na grade) e o recado da última tentativa; `tone` `warning` é o recado que não é motivo de só leitura
 * (o de "Duplicar linha", RN-EDIT-016).
 */
type Banner = { resultId: string | null; failure: SaveFailure | null; failedRow: number | null; notice: string | null; tone?: "warning" };

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
  /**
   * RN-PROT-001: o aviso antes do "Salvar", com quantas alterações vão (o `saveQuestion` da conexão, que só pergunta em "Todos os comandos"). Resolve falso
   * quando a pessoa cancela: nada é gravado e as alterações ficam. Sem ele, o Salvar não pergunta.
   */
  confirmSave?: (count: number) => true | Promise<boolean>;
  /**
   * RN-SQL-023: a aba guardada do script que está à frente (não a do último comando): a edição é a das linhas dela, e não a do resultado do executor. O
   * resultado é um dos que a API guarda (RN-SQL-024), e o Salvar fecha o cursor do último (`onSaved`).
   */
  kept?: RowsState | null;
  /** RN-SQL-023: o script roda ou espera a resposta da pergunta de erro (RN-SQL-021): a edição fica ocupada em todas as abas de resultado. */
  scriptBusy?: boolean;
  /**
   * RN-EXPORT-001 e RN-GRADE-004: o "Exportar dados…" do menu da célula, com a origem desta grade: o motivo de não valer agora (lido ao abrir o menu) e o que
   * abre o assistente. Sem ele, o menu não o tem.
   */
  exportData?: { blocker: () => string | null; open: () => void };
  /** O banco da conexão: "Copiar nome da(s) coluna(s)" escreve os nomes como ele pede (RN-GRADE-015). */
  engine?: Engine;
  /** RN-GRADE-004: o "Ordenar" do menu; sem ele, o menu não o tem (as abas guardadas do script, RN-SQL-023). */
  sort?: GridSortSource;
  /** RN-TABELA-007: o "Ir para o registro referenciado" do menu; só os Registros o têm. */
  follow?: GridFollowSource;
  /** Seção 37: o "Copiar avançado…", os "Copiar como" e a configuração, de outra frente; sem ele, o submenu tem só os nomes e os números. */
  copyAs?: CopyAsSource;
  /** Seção 37: o "Gerar SQL", de outra frente; sem ele, o menu não tem o submenu. */
  generateSql?: GenerateSqlSource;
};

const noBanner: Banner = { resultId: null, failure: null, failedRow: null, notice: null };

/** As linhas na tela: com outro comando rodando, as de antes (esmaecidas), sobre as quais nada se edita. */
function shownOf(state: RunnerState): RowsState | null {
  return state.status === "rows" ? state : state.status === "running" && state.previous?.status === "rows" ? state.previous : null;
}

/** A linha da grade: uma lida (com o corte, a exclusão, o que o banco preencheu num Salvar e os valores lidos) ou uma nova. */
function rowContextOf(shown: RowsState | null, edits: PendingEdits, row: number): RowContext {
  const read = shown?.rows.length ?? 0;
  return row < read ? { kind: "read", truncated: shown?.truncated.get(row), deleted: edits.deleted.includes(row), generated: shown?.generated?.get(row), values: shown?.rows[row] } : { kind: "new" };
}

/** As linhas da seleção com o número na grade e o que cada uma é, para as ações de linha (RN-EDIT-014); a exclusão é conferida por um conjunto, uma vez. */
function selectedRowsOf(shown: RowsState | null, edits: PendingEdits, rows: readonly number[]): SelectedRow[] {
  const deleted = new Set(edits.deleted);
  const read = shown?.rows.length ?? 0;
  return rows.map((row) => ({ number: row + 1, row: row < read ? { kind: "read", truncated: shown?.truncated.get(row), deleted: deleted.has(row), generated: shown?.generated?.get(row), values: shown?.rows[row] } : { kind: "new" } }));
}

/** RN-EDIT-016: "Duplicar linhas" sobre as linhas da seleção: o limite de 1.000, que não é motivo de só leitura e vem sozinho. */
const duplicateRowsAccess = (rows: number): EditAccess => (rows > duplicateLimit ? { editable: false, reason: selectionCopy.rows.duplicateLimit } : { editable: true });

type BarState = { shown: RowsState | null; edits: PendingEdits; readOnlyReason: string | null; target: EditTarget | null; busy: boolean | "refresh"; saving: boolean; selection: GridSelection; layout: GridLayout };

/**
 * RN-EDIT-013 e 014: os quatro botões da barra de edição, pelo que a tela já sabe agora (sem perguntar ao catálogo, RN-EDIT-010): o resultado, o alvo
 * quando já foi perguntado, a aba ocupada (o Salvar também), a célula ativa, que só vale numa linha que existe, e as linhas da seleção, sobre as quais
 * "Duplicar linha(s)" e "Excluir linha(s)" agem.
 */
function barOf({ shown, edits, readOnlyReason, target, busy, saving, selection, layout }: BarState): EditBarButton[] {
  const rows = (shown?.rows.length ?? 0) + edits.added.length;
  const active = activeCell(selection, layout);
  const chosen = selectedRows(selection, layout);
  return editBar({
    readOnly: readOnlyReason,
    target,
    busy: saving || busy,
    active: active !== null && active.row < rows ? { cell: active, row: rowContextOf(shown, edits, active.row) } : null,
    rows,
    platform,
    ...(chosen.length === 0 ? {} : { selection: { rows: chosen.length, duplicate: duplicateRowsAccess(chosen.length), remove: deleteRowsAccess(selectedRowsOf(shown, edits, chosen), null, target, false) } }),
  });
}

/** O motivo de "Exportar dados…" não valer, como o acesso de um item do menu. */
const accessOfBlocker = (blocker: string | null): EditAccess => (blocker === null ? { editable: true } : { editable: false, reason: blocker });

/** RN-SQL-017: as recusas com que as células pedidas ficam cortadas, sem o aviso central: o resultado mudou, a sessão caiu, a célula está fora dele. */
const cellRefusals = ["RESULT_NOT_FOUND", "DATABASE_SESSION_NOT_FOUND", "CELLS_INVALID"];

/** A área de transferência do navegador, como o "Copiar nome" do navegador: escreve e dá o aviso de sucesso, ou o de atenção quando falha. */
async function writeClipboard(text: string, toast: ReturnType<typeof useToast>, success: () => void): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast.warning(copy.menu.notCopied);
    return false;
  }
  success();
  return true;
}

/**
 * O que a grade mostra em cada célula, pela posição na grade, de uma foto da tela: a pendência, quando há (numa junção, a repetida nas linhas que mostram a
 * mesma linha da tabela); a linha nova com o que foi preenchido nela, e o resto nulo; a excluída com o lido. As pendências viram um mapa uma vez, e cada
 * célula custa uma consulta a ele.
 */
function valuesOf(shown: RowsState, view: PendingEdits, edits: PendingEdits): (row: number, column: number) => EditValue {
  const pending = new Map<string, EditValue>(view.cells.map((cell) => [`${cell.row}:${cell.column}`, cell.value]));
  const read = shown.rows.length;
  return (row, column) => {
    if (row >= read) return edits.added[row - read]?.values[column] ?? null;
    const key = `${row}:${column}`;
    return pending.has(key) ? (pending.get(key) ?? null) : (shown.rows[row]?.[column] ?? null);
  };
}

/**
 * A edição das células (seção 22, RN-EDIT-001 a 012), entre a grade e a API: a mesma nos Registros de uma tabela e no resultado de um comando
 * da aba de consulta (RN-EDIT-001). As decisões são funções puras com teste (`record-edits.ts`,
 * `cell-editing.ts`, `cell-menu.ts`, `grid-editing.ts`); aqui estão o estado (as pendências, o alvo, a célula ativa, o campo aberto, a
 * faixa, o menu, o "Ver SQL" e a pergunta) e as chamadas.
 *
 * - As pendências são do resultado da página (`resultId`): outra execução começa sem nenhuma, e quem executa de novo com pendências
 *   pergunta antes (`guard`, RN-EDIT-007). Ficam na memória da aba (`tab-memory.ts`): ir à Estrutura e voltar não as perde. Depois de um script, são da aba
 *   de resultado à frente (`kept`, RN-SQL-023): uma por vez, e trocar de aba com pendências pergunta antes.
 * - O catálogo é consultado na primeira tentativa de editar (RN-EDIT-010), pela sessão da árvore da mesma conexão quando ela existe.
 * - O Salvar grava pela sessão da aba, numa transação própria (a aba de uma tabela é sempre Auto-commit, e a de consulta ainda não tem o
 *   Commit manual na tela, RN-TX-001); se gravou tudo, quem usa decide (`onSaved`): os Registros leem de novo, e a aba de consulta fica com a
 *   grade salva. A recusa fica na faixa, com a mensagem do banco como veio e a linha destacada; no banco sem log, o que já foi gravado sai das
 *   pendências (RN-EDIT-012). Sem o alvo (as pendências lembradas com a aba voltam sem ele), o Salvar e o "Ver SQL" o perguntam antes.
 * - As alterações não salvas vão ao registro da aba (`unsaved-edits.ts`), de onde quem fecha abas pergunta.
 */
export function useRecordEdits({ tabId, runner, state, connectionId, database, subject = "table", onSaved, filter, refresh, autoRefresh, confirmSave, kept = null, scriptBusy = false, exportData, engine, sort, follow, copyAs, generateSql }: Params) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const shown = kept ?? shownOf(state);
  const resultId = shown?.resultId ?? null;
  // RN-SESSAO-002: algo em andamento na aba. "Atualizar" e "Filtrar" seguem o comando da PESSOA (`personBusy`): a execução da atualização automática não os
  // segura, e o comando toma o lugar dela (RN-GRADE-014). A edição espera também por ela (`"refresh"`, com o motivo próprio): as linhas e o resultado da API
  // vão mudar, e o que se editasse agora sumiria com eles.
  const personBusy = isPersonBusy(state) || scriptBusy;
  const busy: boolean | "refresh" = personBusy || (isBusyState(state) ? "refresh" : false);

  const [stored, setStored] = useState(() => recall(tabId, "edits") ?? null);
  const edits: PendingEdits = stored !== null && stored.resultId === resultId ? stored.edits : noEdits;
  const [answer, setAnswer] = useState<TargetAnswer | null>(null);
  const known = answer !== null && answer.resultId === resultId ? answer : null;
  const target = known?.target ?? null;
  const readOnlyReason = shown?.readOnly ?? known?.readOnly ?? null;
  const [bannerState, setBanner] = useState<Banner>(noBanner);
  const banner = bannerState.resultId === resultId ? bannerState : noBanner;
  // RN-GRADE-001: a seleção (com a célula ativa) é das linhas na tela: outra execução (também o F5, o filtro, a ordem e a atualização automática) e a troca de
  // aba de resultado do script começam sem ela. A chave é a execução (`id`, que o "carregar mais" mantém) e o resultado da API; trocada, a seleção de antes é
  // esquecida na mesma renderização, e voltar à aba de antes não a traz de volta.
  const scope = shown === null ? null : `${shown.id}:${shown.resultId ?? ""}`;
  const [selectionState, setSelectionState] = useState<{ scope: string | null; selection: GridSelection }>({ scope, selection: emptySelection });
  // A seleção está mudando (o arraste, a tecla presa): a contagem da barra espera ela parar, e fica a de antes (RN-GRADE-001).
  const [settled, setSettled] = useState<string | null | undefined>(undefined);
  if (selectionState.scope !== scope) {
    setSelectionState({ scope, selection: emptySelection });
    setSettled(undefined);
  }
  const selection = selectionState.scope === scope ? selectionState.selection : emptySelection;
  // A grade de agora, pela identidade das linhas: as lidas e os ids das novas, na ordem.
  const readCount = shown?.rows.length ?? 0;
  const columnCount = shown?.columns.length ?? 0;
  const layout = useMemo<GridLayout>(() => ({ read: readCount, added: edits.added.map((row) => row.id), columns: columnCount }), [readCount, columnCount, edits.added]);
  const active = activeCell(selection, layout);
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
  const sources = useRef({ filter, refresh, autoRefresh, confirmSave, exportData, engine, sort, follow, copyAs, generateSql });
  useEffect(() => {
    sources.current = { filter, refresh, autoRefresh, confirmSave, exportData, engine, sort, follow, copyAs, generateSql };
  });
  // RN-SQL-017: a busca dos valores completos em andamento, que a faixa mostra e deixa cancelar.
  const [fetching, setFetching] = useState<AbortController | null>(null);
  const fetchingRef = useRef<AbortController | null>(null);
  // RN-GRADE-002: a cópia que monta o texto em partes; passado meio segundo, a faixa diz "Copiando…", com "Cancelar".
  const [copying, setCopying] = useState(false);
  const copyingRef = useRef<AbortController | null>(null);

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
  const latest = useRef({ shown, resultId, edits, target, readOnlyReason, busy, personBusy, saving, active, selection, layout, scope });
  useEffect(() => {
    latest.current = { shown, resultId, edits, target, readOnlyReason, busy, personBusy, saving, active, selection, layout, scope };
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
  /**
   * RN-GRADE-001: muda a seleção pela função pura (`grid-selection.ts`) que recebe a de agora e a grade de agora. O que as ações leem depois de um `await`
   * (`latest`) já a tem, antes da renderização seguinte.
   */
  const updateSelection = useCallback((change: (current: GridSelection, grid: GridLayout) => GridSelection) => {
    const { scope: now, layout: grid, selection: current } = latest.current;
    const next = change(current, grid);
    if (next === current) return;
    latest.current = { ...latest.current, selection: next, active: activeCell(next, grid) };
    setSelectionState({ scope: now, selection: next });
  }, []);
  /** O clique numa célula (e as setas, o Tab do campo, a linha nova): ela é a ativa e a seleção. */
  const setActive = useCallback((cell: GridCell) => updateSelection((current, grid) => select(current, cell, grid)), [updateSelection]);
  const asking = useRef<{ resultId: string; promise: Promise<EditTarget | null> } | null>(null);

  const putEdits = useCallback(
    (next: PendingEdits) => {
      const id = latest.current.resultId;
      if (id === null) return;
      const value = { resultId: id, edits: next };
      // A grade de agora também: a linha nova acrescentada aqui já é uma posição que a seleção acha, antes da renderização seguinte.
      latest.current = { ...latest.current, edits: next, layout: { ...latest.current.layout, added: next.added.map((row) => row.id) } };
      remember(tabId, "edits", value);
      setStored(value);
    },
    [tabId],
  );

  const say = useCallback(
    (notice: string | null, tone?: "warning") => setBanner((current) => ({ ...(current.resultId === latest.current.resultId ? current : noBanner), resultId: latest.current.resultId, notice, tone })),
    [],
  );

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

  /** RN-SQL-024: a sessão em que o resultado da tela foi lido (a da aba, sem ela): a edição pergunta e grava nela. */
  const sessionOfShown = useCallback(() => latest.current.shown?.sessionId ?? runner.sessionOf(), [runner]);

  /** RN-EDIT-010: o alvo da edição, perguntado uma vez por resultado; nulo quando o resultado é só leitura ou a pergunta falhou (a faixa diz). */
  const ensureTarget = useCallback(async (): Promise<EditTarget | null> => {
    const { resultId: id, target: current, readOnlyReason: reason } = latest.current;
    const sessionId = sessionOfShown();
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
      // RN-PROT-002: a conexão que passou a ser somente leitura depois de o resultado chegar responde como o resultado só leitura, com o motivo da página.
      if (result.error.code === "RESULT_NOT_EDITABLE" || result.error.code === "CONNECTION_READ_ONLY") {
        const why = result.error.code === "CONNECTION_READ_ONLY" ? copy.reasons.connectionReadOnly : (editErrorDetails(result.error.extensions).reason ?? result.error.detail ?? result.error.title);
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
  }, [sessionOfShown, queryClient, connectionId, database, subject, say]);

  // RN-SQL-023: a aba guardada do script está à frente: as linhas dela são as de um resultado guardado, e não as do executor.
  const keptNow = useRef(kept !== null);
  useEffect(() => {
    keptNow.current = kept !== null;
  });

  /**
   * O resultado da tela já não é `from`, o de quando a ação começou: as linhas são outras, e a ação que era sobre as de antes não vale nelas. Lê também o
   * executor na hora, e não só a última renderização: o resultado dele, ou, numa aba guardada do script, se o script ainda a tem.
   */
  const moved = useCallback(
    (from: string | null) =>
      latest.current.resultId !== from ||
      (keptNow.current ? !(runner.script.getState()?.results.some((result) => result.rows.resultId === from) ?? false) : (shownOf(runner.getState())?.resultId ?? null) !== from),
    [runner],
  );

  /** A linha da grade: uma lida (com o corte e a exclusão) ou uma nova. */
  const rowOf = useCallback((row: number): RowContext => rowContextOf(latest.current.shown, latest.current.edits, row), []);

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
    async (cells: Iterable<GridPosition>, from: RowsState | null = latest.current.shown, keepGoing?: KeepGoing): Promise<FullValues | null> => {
      const cut = from === null ? [] : cutCellsOf(cells, from.truncated, from.sourceRows);
      if (cut.length === 0) return noFullValues;
      const sessionId = from?.sessionId ?? runner.sessionOf();
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
      const full = await fetchFullValues(cut, fetchCells, controller.signal, keepGoing);
      if (fetchingRef.current === controller) {
        fetchingRef.current = null;
        setFetching(null);
      }
      return full;
    },
    [runner, queryClient],
  );

  /** O "Cancelar" da faixa: desiste da busca dos valores completos e da cópia que monta o texto (RN-GRADE-002), sem tocar na área de transferência. */
  const cancelFetch = useCallback(() => {
    fetchingRef.current?.abort();
    fetchingRef.current = null;
    setFetching(null);
    copyingRef.current?.abort();
    copyingRef.current = null;
    setCopying(false);
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

  /** O que a grade mostra agora, como recorte para os formatos (`sliceOf`): as pendências, as cortadas e as "gerado pelo banco" das linhas na tela. */
  const sliceSourceOf = useCallback((current: RowsState, pending: PendingEdits, view: PendingEdits): SliceSource => {
    const valueOf = valuesOf(current, view, pending);
    return {
      columns: current.columns,
      valueAt: valueOf,
      truncatedAt: (row, column) => current.truncated.get(row)?.has(column) === true,
      generatedAt: (row, column) => current.generated?.get(row)?.has(column) === true,
    };
  }, []);

  /**
   * RN-GRADE-002: "Copiar" (Ctrl+C) e "Copiar com cabeçalho", da seleção: as linhas escolhidas, na ordem da grade, e nelas as colunas escolhidas, com o que a
   * grade mostra. A célula cortada vai com o valor completo (RN-SQL-017), pedido só para as que vão no texto; antes, a conta do que a grade já tem (cada cortada
   * vale, no mínimo, o que a grade tem dela): o que já passa de 10 MiB não busca nada, e a busca para quando o texto passa. O texto é montado em partes, e,
   * passado meio segundo, a faixa diz "Copiando…", com "Cancelar". A atualização automática fica em pausa do começo até o texto ir para a área de
   * transferência (RN-GRADE-014), e a cópia leva as linhas que estavam escolhidas quando começou. Sem célula ativa, nada.
   */
  const copySelection = useCallback(
    async (header: boolean) => {
      const { shown: current, edits: pending, selection: chosen, layout: grid } = latest.current;
      if (current === null || activeCell(chosen, grid) === null) return;
      const rows = selectedRows(chosen, grid);
      const columns = selectedColumns(chosen, grid);
      if (rows.length === 0 || columns.length === 0) return;

      const valueOf = valuesOf(current, viewNow(), pending);
      const names = header ? columns.map((column) => current.columns[column]?.name ?? "") : null;
      const plan = { header: names, rows: rows.length, columns: columns.length, valueAt: (row: number, column: number) => valueOf(rows[row], columns[column]) };
      const cut: GridPosition[] = [];
      for (const row of rows) for (const column of columns) if (row < current.rows.length && current.truncated.get(row)?.has(column) === true) cut.push({ row, column });

      const release = hold();
      copyingRef.current?.abort();
      const controller = new AbortController();
      copyingRef.current = controller;
      const timer = setTimeout(() => {
        if (copyingRef.current === controller) setCopying(true);
      }, copyingAfterMs);
      try {
        let full: FullValues = noFullValues;
        if (cut.length > 0) {
          // A conta do que a grade já tem: o teto de cada valor (três bytes por unidade, as aspas e o separador) quase sempre basta, sem montar nada; só quando
          // ele passa do limite o tamanho exato é medido, em partes.
          let bytes = copyCeiling(plan);
          if (bytes > clipboardLimit) {
            const measured = await buildCopyText(plan, { signal: controller.signal, measure: true });
            if (measured.kind === "cancelled") return;
            if (measured.kind === "tooLarge") return void toast.error(selectionCopy.copy.tooLarge);
            bytes = measured.bytes;
          }
          const got = await completeValues(cut, current, (batch) => {
            for (const { cell, value } of batch) if (value !== null) bytes += utf8Length(value) - utf8Length(valueOf(cell.row, cell.column) ?? "");
            return bytes <= clipboardLimit;
          });
          if (got === null || controller.signal.aborted) return;
          if (got.stopped === true) return void toast.error(selectionCopy.copy.tooLarge);
          full = got;
        }

        const outcome = await buildCopyText({ ...plan, valueAt: (row, column) => full.valueOf(rows[row], columns[column]) ?? valueOf(rows[row], columns[column]) }, { signal: controller.signal });
        if (outcome.kind === "cancelled") return;
        if (outcome.kind === "tooLarge") return void toast.error(selectionCopy.copy.tooLarge);
        await writeClipboard(outcome.text, toast, () => {
          if (full.missing > 0) toast.warning(copy.menu.copiedCut(full.missing));
          else toast.success(copiedNotice({ rows: rows.length, cells: rows.length * columns.length, header }));
        });
      } finally {
        clearTimeout(timer);
        if (copyingRef.current === controller) {
          copyingRef.current = null;
          setCopying(false);
        }
        release();
      }
    },
    [viewNow, completeValues, toast, hold],
  );

  /**
   * RN-GRADE-015: "Copiar nome da(s) coluna(s)", das colunas da seleção (todas, com linhas inteiras), na ordem da grade, como o banco pede que sejam escritos,
   * separados por tabulação. Não pede nada à API nem espera a aba.
   */
  const copyColumnNames = useCallback(() => {
    const { shown: current, selection: chosen, layout: grid } = latest.current;
    if (current === null) return;
    const names = selectedColumns(chosen, grid).map((column) => current.columns[column]?.name ?? "");
    if (names.length === 0) return;
    void writeClipboard(columnNamesText(names, sources.current.engine), toast, () => toast.success(selectionCopy.names.copied(names.length)));
  }, [toast]);

  /** RN-GRADE-015: "Copiar número de linha(s)", das linhas da seleção, como a grade os mostra, um por linha; as linhas novas não têm número. */
  const copyRowNumbers = useCallback(() => {
    const { selection: chosen, layout: grid } = latest.current;
    const numbers = rowNumbersOf(selectedRows(chosen, grid), grid.read);
    if (numbers.length === 0) return;
    void writeClipboard(numbers.join("\n"), toast, () => toast.success(selectionCopy.numbers.copied(numbers.length)));
  }, [toast]);

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
      // RN-GRADE-001: abrir o campo mantém a seleção; só a célula que não era a ativa passa a ser ela.
      const now = latest.current.active;
      if (now === null || now.row !== cell.row || now.column !== cell.column) setActive(cell);
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

  /** As linhas pela identidade (RN-GRADE-001): as ações que perguntam o alvo antes de agir as acham de novo depois, mesmo que a grade tenha mudado no meio. */
  const refsOf = useCallback((rows: readonly number[]): RowRef[] => rows.flatMap((row) => refAt(latest.current.layout, row) ?? []), []);
  const positionsOf = useCallback((refs: readonly RowRef[]): number[] => refs.flatMap((ref) => positionOf(latest.current.layout, ref) ?? []), []);

  /**
   * RN-EDIT-014 e 015: "Excluir linha(s)" sobre as linhas `rows` (as da seleção): marca as lidas para exclusão, que ficam riscadas, e tira da grade as novas.
   * Quando uma delas não se exclui (a chave que não se sabe), nada é excluído, e a faixa diz o motivo da primeira, com o número; a já marcada fica como está.
   * As linhas são seguidas pela identidade, e não pela posição: enquanto o alvo é perguntado, outra ação (o segundo clique em "Excluir linha", o
   * "Descartar", o "Carregar mais") pode tirar uma linha nova ou mudá-la de lugar; tirada no meio, ela não conta. `from` é o resultado das linhas (por
   * padrão, o da tela): se ele saiu antes de a exclusão valer, nada muda. Tiradas linhas novas, a seleção passa a ser a célula ativa, que vai para a linha que
   * ficou no lugar da primeira tirada, ou para a de cima, quando não ficou nenhuma depois dela; sem linha nenhuma, não há célula ativa.
   */
  const removeRows = useCallback(async (rows: readonly number[], from: string | null = latest.current.resultId) => {
    if (moved(from) || rows.length === 0) return;
    const early = deleteRowsAccess(selectedRowsOf(latest.current.shown, latest.current.edits, rows), latest.current.readOnlyReason, latest.current.target, latest.current.saving || latest.current.busy);
    if (!early.editable) return say(early.reason);
    const refs = refsOf(rows);
    if (refs.length === 0) return;
    const release = hold();
    try {
      const known = await ensureTarget();
      if (moved(from)) return;
      const { readOnlyReason: reason, busy: running, saving: writing, shown: current } = latest.current;
      const positions = positionsOf(refs);
      if (positions.length === 0) return;
      const access = deleteRowsAccess(selectedRowsOf(current, latest.current.edits, positions), reason, known, writing || running);
      if (!access.editable) return say(access.reason);
      if (known === null || current === null) return;

      const read = current.rows.length;
      let next = latest.current.edits;
      let firstNew: number | null = null;
      for (const position of positions) {
        if (position < read) next = deleteRow(next, position);
        else {
          firstNew = firstNew === null ? position : Math.min(firstNew, position);
          const id = latest.current.layout.added[position - read];
          if (id !== undefined) next = removeNewRow(next, id);
        }
      }
      if (next !== latest.current.edits) putEdits(next);
      if (firstNew !== null) {
        const total = read + next.added.length;
        const column = latest.current.active?.column ?? 0;
        updateSelection((held, grid) => (total === 0 ? emptySelection : select(collapse(held), { row: Math.min(firstNew, total - 1), column: Math.min(column, grid.columns - 1) }, grid)));
      }
      say(null);
    } finally {
      release();
    }
  }, [ensureTarget, putEdits, say, hold, moved, refsOf, positionsOf, updateSelection]);

  /** Cada "Duplicar linha" que busca os valores completos ganha uma vez: a busca nova cancela a anterior, que não é o "Cancelar" da pessoa. */
  const duplicating = useRef(0);

  /**
   * RN-EDIT-016: "Duplicar linha(s)" põe no fim da grade, na ordem das linhas de origem `rows` (as da seleção), uma linha nova pendente para cada uma, com o
   * valor que a tela mostra em cada coluna da tabela que se copia (`duplicatePlan`), onde "Adicionar linha" vale, até 1.000 de uma vez. A célula cortada vai
   * com o valor completo, buscado antes na API para todas as linhas de uma vez (RN-SQL-017, com "Buscando os valores completos…" e "Cancelar" na faixa); o
   * valor que não vem inteiro, ou a busca cancelada, não duplica nada, nem as outras, e a faixa diz por quê. Depois, a seleção é das cópias, inteiras, com a
   * célula ativa na primeira, na primeira coluna editável (na que copiou a chave, na coluna da chave mais à esquerda), e a faixa avisa a chave copiada e as
   * colunas que ficaram de fora, uma vez para todas. A atualização automática fica em pausa desde o começo, também durante a busca, e o resultado que mudou no
   * meio não recebe as linhas (RN-GRADE-014). `from` é o resultado das linhas (por padrão, o da tela).
   */
  const duplicateRows = useCallback(async (rows: readonly number[], from: string | null = latest.current.resultId) => {
    if (moved(from) || rows.length === 0) return;
    const early = newRowAccess(latest.current.readOnlyReason, latest.current.target, latest.current.saving || latest.current.busy);
    if (!early.editable) return say(early.reason);
    const limit = duplicateRowsAccess(rows.length);
    if (!limit.editable) return say(limit.reason, "warning");
    const refs = refsOf(rows);
    const release = hold();
    try {
      const known = await ensureTarget();
      if (moved(from)) return;
      const { readOnlyReason: reason, busy: running, saving: writing, shown: current, edits: pending } = latest.current;
      const access = newRowAccess(reason, known, writing || running);
      if (!access.editable) return say(access.reason);
      if (known === null || current === null) return;

      const read = current.rows.length;
      const sources = positionsOf(refs).flatMap((row): { row: number; plan: DuplicatePlan }[] => {
        const source: DuplicateSource | null =
          row < read
            ? { kind: "read", values: current.columns.map((_, column) => valueAt({ row, column })), truncated: current.truncated.get(row), generated: current.generated?.get(row) }
            : pending.added[row - read] === undefined
              ? null
              : { kind: "new", values: pending.added[row - read].values };
        return source === null ? [] : [{ row, plan: duplicatePlan(known, source) }];
      });
      if (sources.length === 0) return;
      const many = sources.length > 1;
      const valuesOfCopies = sources.map(({ plan }) => ({ ...plan.values }));

      const cut = sources.flatMap(({ row, plan }) => plan.cut.map((column) => ({ row, column })));
      if (cut.length > 0) {
        const turn = ++duplicating.current;
        const full = await completeValues(cut, current);
        if (moved(from)) return;
        // A busca de um "Duplicar linha" seguinte (o duplo clique no botão) cancela esta: quem duplica e diz o que houve é o seguinte, e esta sai calada.
        if (full === null && duplicating.current !== turn) return;
        if (full === null) return say(many ? selectionCopy.rows.fetchCancelled : copy.duplicate.fetchCancelled, "warning");
        const missing = cut.find(({ row, column }) => full.valueOf(row, column) === undefined);
        if (missing !== undefined) {
          const name = current.columns[missing.column]?.name ?? "";
          return say(many ? selectionCopy.rows.fullValueMissing(name, missing.row + 1, subject) : copy.duplicate.fullValueMissing(name, subject), "warning");
        }
        sources.forEach(({ row, plan }, index) => {
          for (const column of plan.cut) valuesOfCopies[index][column] = full.valueOf(row, column) ?? null;
        });
      }

      // As pendências e as linhas de agora: a busca deixa a grade livre, e o que foi feito nela enquanto isso (uma célula editada, o "Carregar mais") fica.
      let next = latest.current.edits;
      const ids: number[] = [];
      for (const values of valuesOfCopies) {
        const added = addRow(next, values);
        next = added.edits;
        ids.push(added.id);
      }
      putEdits(next);
      const first = sources[0].plan;
      const editable = known.columns.findIndex((info) => info.editable);
      updateSelection(() => selectNewRows(ids, first.key === null ? Math.max(editable, 0) : first.key[0]));

      const names = (columns: readonly number[]) => columns.map((column) => current.columns[column]?.name ?? "");
      const keyed = sources.find(({ plan }) => plan.key !== null)?.plan.key ?? null;
      const skipped = [...new Set(sources.flatMap(({ plan }) => plan.skipped))].sort((left, right) => left - right);
      const keyNote = keyed === null ? null : (many ? selectionCopy.rows.keyCopied : copy.duplicate.keyCopied)(known.tables[0]?.name ?? "", names(keyed));
      const notes = [keyNote, skipped.length === 0 ? null : copy.duplicate.notCopied(names(skipped))].filter((note) => note !== null);
      say(notes.length === 0 ? null : notes.join(" "), "warning");
    } finally {
      release();
    }
  }, [ensureTarget, valueAt, completeValues, putEdits, say, hold, moved, subject, refsOf, positionsOf, updateSelection]);

  /** As linhas sobre as quais as ações de linha agem: as da seleção (as que têm uma célula escolhida), na ordem da grade (RN-GRADE-001). */
  const rowsNow = useCallback(() => selectedRows(latest.current.selection, latest.current.layout), []);

  /**
   * RN-EDIT-015: Ctrl+Alt+Insert e Alt+Delete, nas linhas da seleção. O que a barra mostraria desabilitado (sem célula ativa, o resultado só leitura, a aba
   * ocupada, o limite do duplicar…) vai à faixa, com o motivo dela; o resto a ação confere, e a primeira tentativa pergunta o alvo.
   */
  const rowAction = useCallback((id: "duplicateRow" | "deleteRow") => {
    const reason = barOf(latest.current).find((button) => button.id === id)?.reason ?? null;
    const rows = rowsNow();
    if (reason !== null || rows.length === 0) return say(reason, reason === selectionCopy.rows.duplicateLimit ? "warning" : undefined);
    void (id === "duplicateRow" ? duplicateRows(rows) : removeRows(rows));
  }, [say, duplicateRows, removeRows, rowsNow]);

  /** RN-EDIT-015: o Delete sozinho exclui as linhas inteiras escolhidas, como o "Excluir linhas"; com um retângulo, ou só com a célula ativa, nada. */
  const deleteKey = useCallback(() => {
    if (choseWholeRows(latest.current.selection, latest.current.layout)) rowAction("deleteRow");
  }, [rowAction]);

  /**
   * RN-EDIT-004: "Desfazer alteração" nas células escolhidas: o valor alterado volta ao lido, a linha marcada para exclusão que tem uma célula escolhida
   * volta, e, numa linha nova, a célula volta ao padrão da tabela. Sem nada escolhido além da célula ativa, a dela.
   */
  const undoSelection = useCallback(() => {
    // O recado da faixa é da última tentativa (o aviso do "Duplicar linha" fica até a próxima ação de edição, RN-EDIT-016).
    say(null);
    const { edits: pending, selection: chosen, layout: grid } = latest.current;
    const next = undoWhere(pending, viewNow(), grid.read, (row, column) => isSelected(chosen, grid, { row, column }), (row) => rowSpan(chosen, grid, row) !== null);
    if (next !== null) putEdits(next);
  }, [putEdits, say, viewNow]);

  /** RN-EDIT-004: "Descartar". As linhas novas saem da grade, e a seleção é desfeita: fica só a célula ativa, quando a linha dela continua (RN-GRADE-001). */
  const discard = useCallback(() => {
    setEditor(null);
    const hadNew = latest.current.edits.added.length > 0;
    putEdits(noEdits);
    setBanner(noBanner);
    if (hadNew) updateSelection(collapse);
  }, [setEditor, putEdits, updateSelection]);

  /** O aviso antes do Salvar (RN-PROT-001) em espera: um segundo Salvar não abre outro. */
  const confirming = useRef(false);

  /**
   * RN-EDIT-005 e 012: o Salvar. Devolve se gravou tudo; `reread` vai a `onSaved` (os Registros leem de novo). Na conexão com "Todos os comandos"
   * (RN-PROT-001), pergunta antes, uma vez por Salvar, com quantas alterações vão; cancelado, nada é gravado. A resposta pode chegar depois de as linhas
   * mudarem: o Salvar segue com o que está na tela então, e só se for o mesmo resultado.
   */
  const save = useCallback(async (reread = true): Promise<boolean> => {
    const before = latest.current;
    if (pendingCount(before.edits) === 0) return true;
    if (before.saving || before.shown === null || before.resultId === null || sessionOfShown() === null || confirming.current) return false;

    // Sem a pergunta, a resposta vem na hora (`true`), e o Salvar segue na mesma chamada, como antes.
    const answer = sources.current.confirmSave?.(pendingCount(before.edits)) ?? true;
    if (answer !== true) {
      confirming.current = true;
      const confirmed = await answer.finally(() => {
        confirming.current = false;
      });
      if (!confirmed || latest.current.resultId !== before.resultId) return false;
    }

    const { shown: current, resultId: id, edits: pending, saving: writing } = latest.current;
    const sessionId = sessionOfShown();
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
        // RN-GRADE-001: na grade que fica (a aba de consulta), as excluídas saíram e as novas viraram lidas no fim: a seleção é desfeita, e fica só a célula
        // ativa, quando a linha dela continua na grade.
        if (pending.deleted.length > 0 || pending.added.length > 0) updateSelection((held) => afterSave(held, { deleted: pending.deleted, read: current.rows.length, added: pending.added.map((row) => row.id) }));
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
  }, [sessionOfShown, queryClient, toast, putEdits, ensureTarget, onSaved, updateSelection]);

  /** RN-EDIT-008: "Ver SQL", pela API, sem executar nada. */
  const viewSql = useCallback(async () => {
    const { shown: current, resultId: id, edits: pending } = latest.current;
    const sessionId = sessionOfShown();
    if (current === null || id === null || sessionId === null) return;
    const known = latest.current.target ?? (await ensureTarget());
    if (known === null || latest.current.resultId !== id) return;

    const plan = changesOf(pending, current.rows, known);
    const result = await throughMutationCache(queryClient, () => previewEditsOrRefuse(sessionId, id, plan.changes)).catch(() => null);
    if (result === null) return;
    if (result.ok) setPreview(result.data);
    else setBanner({ resultId: id, failure: failureOf(result.error, plan, known.oneAtATime), failedRow: null, notice: null });
  }, [sessionOfShown, queryClient, ensureTarget]);

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
   * Seção 37: o que o menu entrega às frentes do "Copiar avançado" e do "Gerar SQL", com a seleção e as linhas de agora (`GridSelectionContext`). Nulo sem
   * linhas na tela.
   */
  const selectionContext = useCallback((): GridSelectionContext | null => {
    const { shown: current, edits: pending, selection: chosen, layout: grid, resultId: from, target: known } = latest.current;
    if (current === null) return null;
    const source = sliceSourceOf(current, pending, viewNow());
    return {
      resultId: from,
      shown: current,
      engine: sources.current.engine,
      subject,
      target: known,
      selection: chosen,
      layout: grid,
      rows: selectedRows(chosen, grid),
      columns: selectedColumns(chosen, grid),
      slice: (scope: SliceScope = "cells") => sliceOf(chosen, grid, source, scope),
      complete: async (slice, keepGoing) => {
        const cells = slice.truncated.map(([row, column]) => ({ row: slice.positions[row], column: slice.columnIndexes[column] }));
        const full = await completeValues(cells, current, keepGoing);
        if (full === null) return null;
        return { slice: { ...slice, ...completeSlice(slice, (row, column) => full.valueOf(slice.positions[row], slice.columnIndexes[column])) }, missing: full.missing, stopped: full.stopped === true };
      },
      hold,
      moved: () => moved(from),
      ensureTarget,
    };
  }, [sliceSourceOf, viewNow, subject, completeValues, hold, moved, ensureTarget]);

  /** RN-GRADE-003: Ctrl+Shift+C, o "Copiar avançado…" da outra frente, sobre a seleção; sem célula ativa, ou sem a frente, nada. */
  const copyAdvanced = useCallback(() => {
    const source = sources.current.copyAs;
    const context = selectionContext();
    if (source === undefined || context === null || activeCell(context.selection, context.layout) === null) return;
    const access = source.access(context).dialog;
    if (access.editable) source.choose("copyAdvanced", context);
    else say(access.reason);
  }, [selectionContext, say]);

  /**
   * O menu da grade (RN-GRADE-004): o alvo é perguntado antes, para cada item dizer se vale e por quê. O botão direito numa célula fora da seleção a escolhe
   * antes; dentro dela, a seleção fica, e ela passa a ser a ativa (pelo teclado, Shift+F10 e a tecla de menu, a célula é a ativa e nada muda; pelo número da
   * linha, quem escolhe antes é `openRowMenu`). `submenu` é o F11, que abre com o "Filtrar" aberto. O menu é do resultado em que abriu (RN-GRADE-014): se as
   * linhas mudaram enquanto o alvo era perguntado, ele não abre; e a escolha sobre a célula feita depois de elas mudarem não age (só "Atualizar" e "Atualizar
   * automaticamente", que não são da célula).
   */
  const openMenu = useCallback(async (cell: GridCell, point: { x: number; y: number }, keyboard: boolean, submenu?: "filter", chooseFirst = !keyboard) => {
    const from = latest.current.resultId;
    if (chooseFirst) updateSelection((held, grid) => contextCell(held, cell, grid));
    const release = hold();
    try {
      // Com algo em andamento a edição está recusada de todo jeito: o menu sai com o alvo que já se sabe, sem perguntar à API por um resultado que vai mudar.
      const known = latest.current.busy === false ? await ensureTarget() : latest.current.target;
      if (moved(from)) return;
      const { readOnlyReason: reason, busy: running, personBusy, saving: writing, shown: current, edits: pending, selection: chosen, layout: grid } = latest.current;
      if (current === null) return;

      const access = accessOf(cell, known);
      const read = current.rows.length;
      const rows = selectedRows(chosen, grid);
      const several = hasSeveralCells(chosen, grid);
      const undoable = undoWhere(pending, viewNow(), grid.read, (row, column) => isSelected(chosen, grid, { row, column }), (row) => rowSpan(chosen, grid, row) !== null) !== null;
      const filterContext = filterContextOf(cell);
      const context = selectionContext();
      const busyReason: EditAccess = { editable: false, reason: gridFilterCopy.menu.unavailable(gridFilterCopy.reasons.busy) };
      const sortSource = sources.current.sort;
      const sortNow = sortSource?.current() ?? null;
      const columnName = current.columns[cell.column]?.name;
      const followSource = sources.current.follow;
      const readValue = cell.row < read ? (current.rows[cell.row]?.[cell.column] ?? null) : null;
      const followable = readValue !== null && current.truncated.get(cell.row)?.has(cell.column) !== true && followSource?.linkable(readValue) === true;
      const rowAccess = newRowAccess(reason, known, writing || running);
      const groups = cellMenu({
        value: valueAt(cell),
        access,
        pending: undoable,
        deletedRow: false,
        nullable: known?.columns[cell.column]?.nullable ?? true,
        rows: rows.length,
        several,
        hasActive: activeCell(chosen, grid) !== null,
        newRow: rowAccess,
        duplicateRow: rowAccess.editable ? duplicateRowsAccess(rows.length) : rowAccess,
        deleteRow: deleteRowsAccess(selectedRowsOf(current, pending, rows), reason, known, writing || running),
        rowNumbers: rows.length > 0 && rowNumbersOf(rows, grid.read).length === 0 ? { editable: false, reason: selectionCopy.numbers.onlyNew } : { editable: true },
        shortcuts: editShortcuts(platform),
        mac: isMacPlatform(platform),
        ...(sources.current.copyAs === undefined || context === null ? {} : { copyAs: sources.current.copyAs.access(context) }),
        ...(filterContext === null ? {} : { filter: filterMenuItem(filterContext) }),
        ...(sortSource === undefined || columnName === undefined ? {} : { sort: { direction: sortNow?.column === columnName ? sortNow.direction : null, access: personBusy || writing ? busyReason : { editable: true } } }),
        ...(followSource === undefined || !followSource.links(cell.column) ? {} : { follow: followable ? { editable: true } : { editable: false, reason: selectionCopy.menu.followUnavailable } }),
        ...(sources.current.refresh === undefined ? {} : { refresh: personBusy || writing ? busyReason : { editable: true } }),
        ...(sources.current.autoRefresh === undefined ? {} : { autoRefresh: sources.current.autoRefresh.item() }),
        ...(sources.current.exportData === undefined ? {} : { exportData: accessOfBlocker(sources.current.exportData.blocker()) }),
        ...(sources.current.generateSql === undefined || context === null ? {} : { generateSql: sources.current.generateSql.access(context) }),
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
          // RN-EXPORT-001: o assistente abre com a origem da grade; a escolha não depende da célula.
          if (action === "exportData") return sources.current.exportData?.open();
          // As linhas mudaram com o menu aberto (a execução automática que já rodava quando ele abriu): a célula escolhida é de uma linha que não está mais ali.
          if (moved(from)) return;
          if (isFilterAction(action)) {
            // O campo e a aba podem ter mudado com o menu aberto: a escolha é decidida de novo, com o que vale agora.
            const now = filterContextOf(cell);
            const plan = now === null ? null : filterPlan(now, action);
            if (plan !== null) runFilterPlan(cell, plan, point);
            return;
          }
          // Seção 37: os itens das outras frentes recebem a seleção de agora (a mesma de quando o menu abriu: com ele aberto, ela não muda).
          if (isCopyAsAction(action)) {
            const now = selectionContext();
            if (now !== null) sources.current.copyAs?.choose(action, now);
            return;
          }
          if (isGenerateSqlAction(action)) {
            const now = selectionContext();
            if (now !== null) sources.current.generateSql?.choose(action, now);
            return;
          }
          switch (action) {
            case "copy":
              void copySelection(false);
              break;
            case "copyWithHeader":
              void copySelection(true);
              break;
            case "copyColumnNames":
              copyColumnNames();
              break;
            case "copyRowNumbers":
              copyRowNumbers();
              break;
            case "paste": {
              if (several) break;
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
              if (!several) void whenEditable(cell, () => applyValue(cell, null), from);
              break;
            case "undo":
              undoSelection();
              break;
            case "newRow":
              void newRow();
              break;
            case "duplicateRow":
              void duplicateRows(rows, from);
              break;
            case "deleteRow":
              void removeRows(rows, from);
              break;
            case "sort:asc":
            case "sort:desc":
            case "sort:none":
              if (columnName !== undefined) sources.current.sort?.apply(action === "sort:none" ? null : { column: columnName, direction: action === "sort:asc" ? "asc" : "desc" });
              break;
            case "follow":
              if (followable && readValue !== null) sources.current.follow?.follow(cell.column, readValue);
              break;
          }
        },
      });
    } finally {
      release();
    }
  }, [ensureTarget, accessOf, valueAt, whenEditable, applyValue, openEditor, undoSelection, newRow, duplicateRows, removeRows, copySelection, copyColumnNames, copyRowNumbers, toast, viewNow, filterContextOf, runFilterPlan, hold, moved, updateSelection, selectionContext]);

  /** O botão direito no número da linha: fora da seleção, escolhe a linha inteira antes; dentro dela, deixa como está; e abre o menu sobre a célula ativa. */
  const openRowMenu = useCallback((row: number, point: { x: number; y: number }) => {
    updateSelection((held, grid) => contextRow(held, row, grid));
    const cell = latest.current.active;
    if (cell !== null) void openMenu(cell, point, false, undefined, false);
  }, [updateSelection, openMenu]);

  /** RN-EDIT-007: com pendências, a ação (filtrar, ordenar, atualizar, executar de novo) espera a resposta da pergunta. */
  const guard = useCallback((proceed: () => void) => {
    const pending = pendingCount(latest.current.edits);
    if (pending === 0) proceed();
    else setQuestion({ count: pending, proceed });
  }, []);

  // RN-GRADE-014: a atualização automática fica em pausa enquanto a grade é editada (alteração não salva, célula aberta) ou tem um menu ou diálogo aberto
  // sobre ela, e enquanto uma ação pergunta o alvo para abrir um deles (`hold`): a execução trocaria as linhas debaixo do que a pessoa está fazendo. Ao sair
  // da pausa ela executa na hora, se o prazo já passou. `released` faz decidir de novo quando uma ação solta a pausa. A vista que sai de cena (ou o executor
  // trocado) tira a pausa dela do executor. Também com mais de uma célula escolhida (RN-GRADE-001): a execução esqueceria a seleção antes do botão direito ou
  // do Ctrl+C; escolher uma célula só, ou o Esc, a liberam.
  const several = hasSeveralCells(selection, layout);
  const gridInUse = count > 0 || editor !== null || menu !== null || valueFilter !== null || customFilter !== null || several;
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

  // RN-EDIT-013 e 014: os botões da barra, pelas linhas da seleção; contar e conferir as linhas de uma seleção grande custa uma volta nelas, uma vez por mudança.
  const buttons = useMemo(() => barOf({ shown, edits, readOnlyReason, target, busy, saving, selection, layout }), [shown, edits, readOnlyReason, target, busy, saving, selection, layout]);
  // RN-GRADE-001: a contagem da barra do resultado, com mais de uma célula escolhida; enquanto a seleção muda (o arraste, a tecla presa), fica a de antes.
  const size = selectionSize(selection, layout);
  const statusNow = size.cells > 1 ? selectionCopy.count(size.rows, size.cells, size.whole) : null;

  const editing: GridEditing | undefined =
    shown === null
      ? undefined
      : {
          rows,
          selection,
          layout,
          onSelection: updateSelection,
          onSelecting: (on) => setSettled((held) => (on ? (held === undefined ? statusNow : held) : undefined)),
          status: settled === undefined ? statusNow : settled,
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
          onRowMenu: openRowMenu,
          onCopy: () => void copySelection(false),
          ...(copyAs === undefined ? {} : { onCopyAdvanced: copyAdvanced }),
          onDeleteRows: deleteKey,
          onSave: () => void save(),
          onNewRow: () => void newRow(),
          onDuplicateRow: () => rowAction("duplicateRow"),
          onDeleteRow: () => rowAction("deleteRow"),
          bar: {
            buttons,
            onAction: (id: EditBarAction) => {
              // RN-EDIT-014: cada botão faz o que o item de mesmo nome do menu faz: "Editar célula" na célula ativa (é o F2), "Duplicar linha(s)" e
              // "Excluir linha(s)" nas linhas da seleção.
              const cell = latest.current.active;
              if (id === "newRow") return void newRow();
              if (cell === null) return;
              if (id === "edit") openEditor(cell);
              else if (id === "duplicateRow") void duplicateRows(rowsNow());
              else void removeRows(rowsNow());
            },
          },
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
    /**
     * RN-EXPORT-011: a tabela única do resultado, quando o alvo da edição já disse que ele é de uma tabela só (RN-EDIT-002, `rowOperations`); preenche a
     * tabela de destino do SQL e do DbUnit ao exportar, sem perguntar ao banco. Nula antes de o alvo chegar e numa junção.
     */
    singleTable: target !== null && target.rowOperations && target.tables.length === 1 ? { schema: target.tables[0].schema, name: target.tables[0].name } : null,
    banner: {
      pending: count,
      oneAtATime: target?.oneAtATime === true,
      saving,
      readOnly: resultReadOnly(readOnlyReason, target),
      notice: banner.notice,
      noticeTone: banner.tone ?? ("lock" as const),
      failure: banner.failure,
      fetching: fetching !== null,
      copying,
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
    /**
     * Seção 37: a seleção de agora para as frentes do "Copiar avançado" e do "Gerar SQL" (os diálogos delas leem o recorte e buscam os valores completos por
     * aqui); nulo sem linhas na tela.
     */
    selectionContext,
  };
}

/** O que a edição devolve a quem a usa: a vista Registros e a aba de consulta. */
export type RecordEdits = ReturnType<typeof useRecordEdits>;
