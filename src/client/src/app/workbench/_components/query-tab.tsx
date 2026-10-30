import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button, Dialog, HostProvider, type Engine } from "@/components/ui";
import { focusedHost, hostFocus, mainHost } from "@/lib/host/host";
import { cn } from "@/lib/utils/cn";

import { resultWindowNameOf } from "../../../../electron/result-window-messages";

import { autoRefreshQuestion, commandQuestion, saveQuestion, scriptQuestion, type WholeColumnQuestion } from "../_lib/command-confirmation";
import { confirmedOf } from "../_lib/command-wire";
import { goToOffset } from "../_lib/editor-goto";
import { liveEditors } from "../_lib/live-editors";
import { declarationOffset, useEditorVariables, useTabVariables } from "../_lib/use-tab-variables";
import { readScript } from "../_lib/variables/script";
import { multiEditCopy } from "../_lib/multi-edit.copy";
import { useCopyAs } from "../_lib/copy-as/use-copy-as";
import { openExportWizard } from "../_lib/data-export/data-exports";
import { exportBlocker, exportRows, resultSource } from "../_lib/data-export/export-entry";
import { useGridGenerateSql } from "../_lib/generate-sql/use-grid-generate-sql";
import { cachedReadOnly, cachedUserName } from "../_lib/grid-action-context";
import { refreshKey } from "../_lib/grid-editing";
import { applyResultFilter, clearResultFilter, filterBaseOf } from "../_lib/result-filter";
import { commandWillRun, initialLayout, layoutReducer, paneFlex, scriptWillRun } from "../_lib/result-layout";
import { f6Action, isF6, placeMenu } from "../_lib/result-place";
import { resultActivity, resultFocus, resultSlots } from "../_lib/result-slots";
import { saveShortcut } from "../_lib/saved-scripts";
import { entryAt, scriptProgress, scriptShortcut, scriptShortcutLabel, shownScriptTab, statisticsSummary, type ScriptTab } from "../_lib/script-run";
import { scriptsCopy } from "../_lib/scripts.copy";
import { connectionChoices, connectionShortcut } from "../_lib/tab-connection";
import { tabEntries } from "../_lib/tab-focus";
import { useTabTransaction } from "../_lib/transaction";
import { transactionCopy } from "../_lib/transaction.copy";
import { recall, remember } from "../_lib/tab-memory";
import { isPersonBusy, useQueryRunner, useScriptRun, type DocRange, type QueryRunner, type RunHooks, type RunnerState, type RunTarget } from "../_lib/use-query-runner";
import { conditionOf, sortOf, withOrder } from "../_lib/table-sql";
import { canClear } from "../_lib/table-view";
import { useRecordEdits, type GridFilterSource, type GridFollowSource, type GridSortSource, type SavedEdits } from "../_lib/use-record-edits";
import { useResultLinks } from "../_lib/use-result-links";
import { inDatabase } from "../_lib/navigator-model";
import { useAutoRefresh } from "../_lib/use-auto-refresh";
import { useCommandConfirmation } from "../_lib/use-command-confirmation";
import { useConnectedIds } from "../_lib/use-connected-ids";
import { useWorkbenchOnScreen } from "../_lib/use-workbench-on-screen";
import type { QueryTab, ResultPlace, TableView } from "../_lib/workbench-model";
import { AutoRefreshControl, AutoRefreshDialog } from "./auto-refresh-control";
import { ConfirmCommandDialog } from "./confirm-command-dialog";
import { ConnectionPicker } from "./connection-picker";
import { DatabasePicker } from "./database-picker";
import { EditorToolbar } from "./editor-toolbar";
import { EditsBanner } from "./edits-banner";
import { BackToPanelButton, ResultActions } from "./result-actions";
import { resultEditDialogs } from "./result-edit-dialogs";
import { focusResultIn, ResultHost } from "./result-host";
import { ResultPlaceButton } from "./result-place-button";
import { ResultPanel } from "./result-panel";
import { ResultSplitter } from "./result-splitter";
import { NoConnectionBarView, type NoConnectionReason } from "./script-dialogs";
import { ScriptErrorDialog } from "./script-error-dialog";
import { ScriptStatistics } from "./script-statistics";
import { ResultTabs, ScriptTabs, ScriptWaitingMark, scriptTabId } from "./script-tabs";
import { SentSqlDialog } from "./sent-sql-dialog";
import { TransactionControl } from "./transaction-control";
import { VariablesPanel } from "./variables-panel";
import { variablesPanelCopy } from "../_lib/variables-panel.copy";
import { RecordsFilter } from "./table-tab/records-filter";
import { SqlEditor, type FlashRun, type SqlEditorHandle } from "./sql-editor";
import { HistoryPanel } from "./history-panel";
import { openFromHistory } from "../_lib/history";
import type { HistoryItem } from "../_lib/history.service";

type QueryTabPanelProps = {
  tab: QueryTab;
  /** O que a aba executa e mostra. Vive no `WorkbenchProvider`, acima das rotas, e não aqui. */
  runner: QueryRunner;
  engine: Engine | undefined;
  /**
   * RN-AMB-002: a cor (`#RRGGBB`) do ambiente da conexão da aba, o próprio ou o herdado da pasta; nula sem ambiente, com ambiente sem cor e na aba sem conexão. É um
   * texto, para o painel memorizado só se refazer quando a cor muda, e vai à área de resultado, que a põe na própria `<section>`: ela vai por portal para o
   * painel, a aba do resultado ou a janela do resultado, e só dentro dela a variável de CSS chega aos destaques.
   */
  environmentColor: string | null;
  /** A aba é a ativa da janela (a da consulta ou a aba do resultado dela à frente): a pergunta de erro do script aparece (RN-SQL-021). */
  active: boolean;
  /**
   * Seção 39: o lugar do resultado que vale (`placeOf`), se o editor está à vista (a aba ativa, com a da consulta à frente) e se o resultado está à vista
   * (RN-ABAS-015: no painel, a aba ativa; numa aba, a aba do resultado ativa; numa janela, a janela não minimizada), que é o que deixa a atualização automática
   * executar. Sem eles, o painel e a aba ativa, como antes.
   */
  place?: ResultPlace;
  editorShown?: boolean;
  resultShown?: boolean;
  /** RN-ABAS-014: "Numa janela" fica desabilitado enquanto a aba vai para outra janela. */
  moving?: boolean;
  /** RN-ABAS-014: o botão "Onde mostrar o resultado" da barra trocou o lugar. Estável. */
  onPlace?: (tabId: string, place: ResultPlace) => void;
  /** RN-ABAS-014: o F6 com o resultado numa aba troca a aba ativa entre a da consulta e a do resultado. Estável. */
  onToggleEntry?: (tabId: string, view: "query" | "result") => void;
  /** RN-ABAS-013: "Voltar para o painel" da janela do resultado, e o Ctrl+W nela. Estável. */
  onBackToPanel?: (tabId: string) => void;
  /** RN-ABAS-014: o F6 com o resultado numa janela traz à frente a janela do resultado (do editor) ou a da aba (do resultado). Estável. */
  onFocusWindow?: (tabId: string, target: "result" | "opener" | "link") => void;
  onSqlChange: (tabId: string, patch: { sql: string }) => void;
  /** RN-SCRIPT-001: o texto mudou, sem atraso (o ponto da aba de um script acende na hora). Estável, como as outras: o painel é memorizado. */
  onEdited: (tabId: string) => void;
  /** RN-SCRIPT-001: Ctrl+S e Ctrl+Shift+S com o foco em qualquer lugar da aba (o editor, a barra, o resultado). */
  onSave: (tabId: string, mode: "save" | "saveAs") => void;
  /**
   * RN-ARVORE-008: a aba passa a outra conexão (pelo botão da conexão, ou a aba sem conexão pela faixa, RN-SCRIPT-003 e 005), depois da pergunta das
   * alterações não salvas. Estável.
   */
  onSwitchConnection: (tabId: string, connectionId: string) => void;
  /** RN-LINK-001: o Ctrl+clique no nome de uma tabela abre a aba dela nos Registros, na conexão e no banco desta aba. Estável. */
  onOpenTable: (connectionId: string, table: { schema: string; name: string; view?: TableView; database?: string }) => void;
  /** RN-ARVORE-007: a aba passa a outro banco do servidor da conexão (`undefined`: o da conexão), depois da pergunta das alterações não salvas. Estável. */
  onSwitchDatabase: (tabId: string, database: string | undefined) => void;
  /** RN-GRADE-018: o "Abrir numa aba de consulta" do "Gerar SQL": uma aba de consulta nova, com o texto no editor. Estável. */
  onOpenQuery?: (connectionId: string | null, sql: string, database?: string) => void;
};

/** A plataforma, para o atalho do script (RN-SQL-019): Alt+X, ou Cmd+Option+X no macOS. */
const platform = typeof navigator === "undefined" ? "" : navigator.platform;

/** O comando das linhas na tela (com a execução automática rodando, o do resultado de antes dela), que o F5 e a atualização automática executam de novo. */
function rowsTargetOf(state: RunnerState): RunTarget | null {
  const shown = state.status === "running" ? state.previous : state;
  return shown?.status === "rows" ? shown.target : null;
}

/**
 * RN-SCRIPT-003 e 005: a faixa da aba sem conexão, com as conexões cadastradas para escolher: as conectadas primeiro, com o caminho de pastas, na ordem da
 * lista do botão da conexão (RN-ARVORE-008). Nada vem escolhido: a pessoa diz em qual o SQL vai rodar.
 */
function NoConnectionBar({ reason, onAssign }: { reason: NoConnectionReason; onAssign: (connectionId: string) => void }) {
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  const connected = useConnectedIds(connections.data);
  const [value, setValue] = useState("");
  const options = connectionChoices(connections.data ?? [], folders.data ?? [], connected).map(({ connection, path, connected: isConnected }) => ({
    value: connection.id,
    label: connection.name,
    content: (
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="min-w-0 truncate">{connection.name}</span>
        {path === "" ? null : <span className="min-w-0 truncate text-xs text-muted">{path}</span>}
        {isConnected ? <span className="flex-none text-xs text-success">{scriptsCopy.noConnection.connectedMark}</span> : null}
      </span>
    ),
  }));

  return <NoConnectionBarView options={options} value={value} onChange={setValue} onAssign={onAssign} reason={reason} />;
}

/**
 * O que uma aba de consulta mostra: a barra, o editor de SQL e a área de resultado. As abas ficam
 * todas montadas, e só a ativa aparece: trocar de aba não desfaz o editor (o desfazer, o cursor e a
 * rolagem continuam lá). Memorizado para a digitação numa aba não redesenhar as outras.
 *
 * A divisão entre o editor e o resultado é da aba (RN-PAINEL-001): o resultado se recolhe, se
 * maximiza e a divisória se arrasta. Recolher e maximizar só mudam o tamanho: o editor e a grade
 * seguem montados, e ficam sem altura em vez de saírem da página. A divisão fica guardada fora do
 * componente (`tab-memory.ts`, pelo id da aba): o que desmonta e volta, e o bloqueio por inatividade, que troca o executor, a devolvem.
 *
 * A grade do resultado se edita como a dos Registros (seção 22, RN-EDIT-001): o mesmo campo na célula, a mesma faixa, o mesmo menu e os mesmos
 * atalhos (`useRecordEdits`). Com alterações não salvas, executar outro comando e "Executar de novo" perguntam antes (RN-EDIT-007); o Salvar deixa
 * a grade com o que foi salvo, sem executar de novo, e o cursor que estava aberto fecha (RN-EDIT-009).
 *
 * Depois de um script (seção 31, RN-SQL-019 a 022), a área de resultado tem abas: uma por resultado guardado e as Estatísticas. A do último comando é o
 * resultado do executor, com tudo o que vale nele; as outras mostram as linhas guardadas, que se editam como as dele (RN-SQL-023), sem o que é do cursor
 * (carregar mais, contar, o filtro, atualizar). As pendências são de uma aba por vez: trocar de aba com alterações não salvas pergunta antes. A pergunta
 * de erro do script fica fora da caixa do teclado, como os outros diálogos.
 *
 * Na conexão que confirma antes de executar (RN-PROT-001), o aviso vem antes de o comando sair, depois da pergunta das alterações não salvas: no
 * "Executar" e no Ctrl+Enter, no "Executar este comando", no "Executar script" (uma vez, com a lista), no F5 e no "Executar de novo", no filtro e na ordem do
 * resultado, no "Salvar" da grade (em "Todos os comandos") e ao ligar a atualização automática (em "Todos os comandos", uma vez). Cancelado, nada sai, e a
 * aba fica como estava, com o resultado de antes.
 */
export const QueryTabPanel = memo(function QueryTabPanel({ tab, runner, engine, environmentColor, active, place = "panel", editorShown = active, resultShown = active, moving = false, onPlace, onToggleEntry, onBackToPanel, onFocusWindow, onSqlChange, onEdited, onSave, onSwitchConnection, onOpenTable, onSwitchDatabase, onOpenQuery }: QueryTabPanelProps) {
  const state = useQueryRunner(runner);
  const queryClient = useQueryClient();
  const script = useScriptRun(runner);
  // RN-PROT-001: o aviso antes de executar, pelas proteções da conexão da aba.
  const confirmation = useCommandConfirmation(tab.connectionId, tab.database);
  const { confirm: rawConfirm, confirmed } = confirmation;
  const confirm = useCallback(
    (make: Parameters<typeof rawConfirm>[0], proceed: (asked: boolean) => void) => {
      let asked = false;
      rawConfirm(
        (protections) => {
          const question = make(protections);
          asked = question !== null && protections.confirm !== null;
          return question;
        },
        () => proceed(asked),
      );
    },
    [rawConfirm],
  );
  const { preferences } = usePreferences();
  const editor = useRef<SqlEditorHandle>(null);
  const area = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const resultId = useId();
  const [runnable, setRunnable] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [layout, dispatch] = useReducer(layoutReducer, tab.id, (tabId) => recall(tabId, "layout") ?? initialLayout);
  useEffect(() => remember(tab.id, "layout", layout), [tab.id, layout]);

  // "Carregar mais" também ocupa a sessão (RN-SESSAO-002), e a contagem em andamento também se cancela (RN-SQL-010). A execução da atualização automática
  // não ocupa a aba para a pessoa (RN-GRADE-014): "Executar" não vira "Cancelar", e o comando dela toma o lugar da automática.
  const busy = isPersonBusy(state);
  const cancelling = (state.status === "running" || state.status === "rows") && state.cancelling;
  // O erro que está na tela, inclusive enquanto um comando novo roda: a marca dele no editor dura o que ele durar.
  const shown = state.status === "running" ? state.previous : state;
  // RN-PAINEL-001: numa aba e numa janela o editor ocupa a aba da consulta inteira, sem a divisória, e o que o painel tinha (a divisão, o recolhido, o
  // maximizado) fica guardado e volta com o resultado.
  const inPanel = place === "panel";
  const flex = inPanel ? paneFlex(layout) : { editor: "1 1 0px", result: "none" };
  const maximized = inPanel && layout.mode === "maximized";

  // Seção 39 (RN-ABAS-011 e 017): a área de resultado é uma só, e muda só de lugar: no painel, abaixo do editor; numa aba, no painel da aba do resultado; numa
  // janela, na raiz da janela do resultado (os dois registrados em `resultSlots`).
  const [panelSlot, setPanelSlot] = useState<HTMLDivElement | null>(null);
  const placedSlot = useSyncExternalStore(resultSlots.subscribe, () => (place === "panel" ? null : resultSlots.get(tab.id, place)));
  const slot = inPanel ? panelSlot : placedSlot;
  // RN-ABAS-015: a janela do resultado desta aba tem o foco? A pergunta de erro do script também aparece nela, mesmo com a aba da consulta atrás de outra tela.
  const focusedWindow = useSyncExternalStore(hostFocus.subscribe, hostFocus.getSnapshot);
  const resultWindowFocused = place === "window" && focusedWindow.resultWindow === resultWindowNameOf(tab.id);
  function handleCancel() {
    void runner.cancel();
    editor.current?.focus();
  }

  // Com identidade estável: a grade memorizada recebe isto como "cheguei ao fim" (RN-CONFIG-005).
  const loadMore = useCallback(() => void runner.loadMore(), [runner]);

  // RN-EDIT-022: a nota da aba guardada do script em que a coluna inteira foi salva (ela não lê de novo), pelo resultado dela.
  const [keptNotes, setKeptNotes] = useState<ReadonlyMap<string, string>>(() => new Map());
  // RN-EDIT-009: o Salvar que gravou tudo deixa na grade o que foi salvo, sem executar de novo (também antes de a aba ir para outra janela). Com a coluna
  // inteira (RN-EDIT-022), o resultado do último comando é lido de novo, como o F5 (com o filtro, mantendo as outras abas do script), sem a pergunta da
  // proteção: a da coluna inteira já disse que ela viria; a aba guardada do script fica com as linhas que tem, com a nota. O Salvar do Informix sem log que
  // parou no meio (`partial`) só deixa na grade o que foi gravado (RN-EDIT-021).
  const keepSaved = useCallback(
    ({ resultId, result, reread, whole, kept: inKept, partial }: SavedEdits) => {
      runner.keepSaved(resultId, result);
      if (whole === undefined || partial === true) return;
      if (inKept === true) return setKeptNotes((notes) => new Map(notes).set(resultId, multiEditCopy.keptNote(whole.columns, whole.rows)));
      if (reread) void runner.rerun();
    },
    [runner],
  );

  // RN-GRADE-011: o campo de filtro do resultado, o mesmo dos Registros, acima da grade. Aplicar executa de novo o comando do resultado com o texto do campo
  // (a API o junta ao comando), e o texto do editor não muda; executar pelo editor limpa o filtro. O que se decide é de `result-filter.ts`, com teste.
  const [filterDraft, setFilterDraft] = useState("");
  const [filterApplied, setFilterApplied] = useState("");
  const [filterProblem, setFilterProblem] = useState<{ message: string } | null>(null);
  const [pinned, setPinned] = useState<RunTarget | null>(null);
  // RN-SQL-020: a aba do resultado à frente, depois de um script. A escolha da pessoa vale para aquele script (pelo `id`); o seguinte volta às Estatísticas.
  const [chosenTab, setChosenTab] = useState<{ run: number; tab: ScriptTab } | null>(null);
  // RN-VAR-024: sem script, mas com variáveis avaliadas, a área tem as abas "Resultado" e "Variáveis"; esta é a que está à frente.
  const [plainTab, setPlainTab] = useState<"result" | "variables">("result");
  // RN-VAR-018: o "SQL enviado" aberto, do comando que levou variáveis.
  const [sentView, setSentView] = useState<RunTarget | null>(null);
  const variables = useTabVariables(runner, liveEditors.snapshot(tab.id)?.sql ?? tab.sql, engine, preferences.editor.blankLineSeparates);
  // RN-VAR-025: os mesmos valores, para o editor (a dica do ponteiro e o valor no fim da linha).
  const editorVariables = useEditorVariables(variables);
  // O pedido de trazer o painel à frente (o Ctrl+Enter numa declaração, o script sem comando): ajuste durante a renderização, uma vez por pedido.
  const [revealSeen, setRevealSeen] = useState(variables.reveal.serial);
  if (revealSeen !== variables.reveal.serial) {
    setRevealSeen(variables.reveal.serial);
    setPlainTab("variables");
    if (script !== null) setChosenTab({ run: script.id, tab: "variables" });
  }
  // RN-VAR-024: só o pedido de trazer o painel o põe à frente. O comando novo da pessoa (e a lista "Erros nas variáveis" que o recusa) mostra o resultado dele: sem isto
  // o "Executando…", as linhas e o erro ficavam atrás do painel até a pessoa clicar em "Resultado". A atualização automática, que roda sozinha, não tira o painel.
  const [stateSeen, setStateSeen] = useState(state);
  if (stateSeen !== state) {
    setStateSeen(state);
    if ((state.status === "running" && stateSeen.status !== "running" && state.auto !== true) || (state.status === "variableErrors" && !(stateSeen.status === "variableErrors" && stateSeen.errors === state.errors))) setPlainTab("result");
  }
  // O filtro é do resultado do executor da aba. Trocar o banco (RN-ARVORE-007) ou a conexão (RN-ARVORE-008) da aba, e o bloqueio por inatividade, dão a ela
  // um executor novo, sem resultado: o filtro do resultado anterior sai junto. Sem isso o campo ficava à vista com o comando fixado (`pinned`) do resultado
  // anterior, e "Aplicar" o executava, com o filtro, no banco ou na conexão novos. Ajuste durante a renderização: o campo velho não chega a aparecer.
  // A aba do script escolhida sai também: cada executor numera os scripts dele desde o 1, e o primeiro script do executor novo herdava a escolha feita no
  // do anterior (abria nela, e não nas Estatísticas, e às vezes no resultado de outro comando).
  const [filterRunner, setFilterRunner] = useState(runner);
  if (filterRunner !== runner) {
    setFilterRunner(runner);
    clearResultFilter({ setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned });
    setChosenTab(null);
    setPlainTab("result");
  }
  const base = filterBaseOf(state, pinned);
  const filterNow = useRef({ base, draft: filterDraft, applied: filterApplied });
  useEffect(() => {
    filterNow.current = { base, draft: filterDraft, applied: filterApplied };
  });
  const guardRef = useRef<(proceed: () => void) => void>((proceed) => proceed());
  const sendFilter = useCallback(
    (draft: string) =>
      guardRef.current(() => {
        // RN-PROT-001: aplicar o filtro e ordenar executam de novo o comando do resultado, e perguntam pelo comando que vai ao banco, com o filtro junto.
        const before = filterNow.current.base;
        if (before === null || isPersonBusy(runner.getState())) return;
        const filter = conditionOf(draft);
        confirm(
          (protections) => commandQuestion(protections, confirmedOf(filter === "" ? before : { ...before, filter })),
          (asked) => {
            const { base: target, applied } = filterNow.current;
            // RN-SQL-020: o filtro do resultado do último comando de um script muda só ele; as outras abas do script ficam.
            void applyResultFilter(target, draft, applied, runner.getState(), { setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned, run: (next) => runner.run(next, asked ? { keepScript: true, confirmed: true } : { keepScript: true }) });
          },
        );
      }),
    [runner, confirm],
  );
  const filterSource = useMemo<GridFilterSource>(
    () => ({
      engine,
      field: () => filterNow.current.draft,
      removable: () => canClear(filterNow.current.draft, filterNow.current.applied),
      apply: sendFilter,
      clear: () => sendFilter(""),
    }),
    [engine, sendFilter],
  );
  // RN-GRADE-004 e RN-GRADE-021: o "Ordenar" do menu da grade e o botão de ordenar do cabeçalho, pelo campo de filtro do resultado (RN-GRADE-011): a ordem em
  // uso é a do filtro aplicado, e a escolhida é escrita no campo (`withOrder`) e aplicada como o "Aplicar".
  // RN-GRADE-021: a ordem em uso é a desta renderização: o botão de ordenar do cabeçalho mostra a seta dela.
  const sortColumns = (state.status === "rows" ? state : state.status === "running" && state.previous?.status === "rows" ? state.previous : null)?.columns ?? null;
  const appliedSort = useMemo(() => (sortColumns === null ? null : sortOf(filterApplied, sortColumns, engine)), [sortColumns, filterApplied, engine]);
  const resultSort = useMemo<GridSortSource>(
    () => ({
      applied: () => appliedSort,
      apply: (next) => sendFilter(withOrder(filterNow.current.draft, next, engine)),
    }),
    [appliedSort, engine, sendFilter],
  );
  const rerunRef = useRef<() => void>(() => {});
  const menuRerun = useCallback(() => rerunRef.current(), []);
  // RN-EXPORT-001: o "Exportar dados…" do menu da célula lê o motivo e abre o assistente pelo que está mais abaixo (o "Salvar" em andamento vem da edição).
  const exportRef = useRef<{ blocker: string | null; open: () => void }>({ blocker: null, open: () => {} });
  const menuExport = useMemo(() => ({ blocker: () => exportRef.current.blocker, open: () => exportRef.current.open() }), []);

  const shownTab = script === null ? null : shownScriptTab(script, chosenTab !== null && chosenTab.run === script.id ? chosenTab.tab : null, variables.shown);
  // Sem script, o painel Variáveis só vale com variáveis avaliadas no texto.
  const plainShown = script === null && variables.shown ? plainTab : "result";
  // O resultado do executor está à vista: sem script, ou com a aba do último comando à frente (a do cursor aberto); o painel Variáveis não é o resultado.
  const liveShown = script === null ? plainShown === "result" : shownTab === script.live;
  const tabIds = useId();
  // A aba guardada à frente (não a do último comando): as linhas dela, que se editam como as do último (RN-SQL-023).
  const kept = script === null || typeof shownTab !== "number" || shownTab === script.live ? null : (script.results.find((result) => result.entry === shownTab) ?? null);
  // RN-EDIT-022: a nota da aba guardada à frente, depois de salvar a coluna inteira nela.
  const keptNote = kept === null ? null : (keptNotes.get(kept.rows.resultId ?? "") ?? null);
  // RN-VAR-024: o painel Variáveis está à frente (na aba do script ou, sem script, na lista de duas abas).
  const showVariables = variables.shown && (script === null ? plainShown === "variables" : shownTab === "variables");
  // RN-SQL-019: o comando do script em execução, que o editor marca.
  const runningAt = script !== null && script.phase === "running" && script.current !== null ? entryAt(script, script.current).target : null;

  // RN-GRADE-014: a atualização automática do resultado, na barra dele e no menu da grade. Só a aba à vista (a ativa, com a área de trabalho na tela) a deixa
  // executar; escondida, ela espera. Com outra aba do script à frente (RN-SQL-020), o resultado do último comando também não está à vista, e ela espera.
  const onScreen = useWorkbenchOnScreen();
  // RN-PROT-001: em "Todos os comandos", ligar pergunta uma vez, pelo comando do resultado na tela (com o filtro dele).
  const confirmAuto = useCallback(
    (proceed: () => void) => {
      const target = rowsTargetOf(runner.getState());
      if (target === null) return proceed();
      confirm((protections) => autoRefreshQuestion(protections, confirmedOf(target)), proceed);
    },
    [runner, confirm],
  );
  // RN-ABAS-015: o resultado à vista é o do lugar dele (a aba do resultado ativa, a janela não minimizada), e não a aba da consulta. Numa janela, vale qualquer que
  // seja a aba ativa e a tela da janela da aba: a janela do resultado não é a área de trabalho, e continua atualizando por baixo de Configurações.
  const auto = useAutoRefresh(runner, resultShown && (onScreen || place === "window") && liveShown, confirmAuto);
  // RN-PROT-001: o "Salvar" da grade, em "Todos os comandos", pergunta uma vez, com quantas alterações vão.
  const confirmSave = useCallback((count: number) => confirmed((protections) => saveQuestion(protections, count)), [confirmed]);
  // RN-EDIT-019: o "Salvar" com a coluna inteira pergunta sempre, com o ambiente e a conexão da aba, e cobre a pergunta da proteção.
  const { always } = confirmation;
  const confirmWholeColumn = useCallback((question: WholeColumnQuestion) => always(question), [always]);

  // RN-SQL-023: numa aba guardada do script a edição é a das linhas dela, e o menu da célula fica sem "Filtrar", "Atualizar" e "Atualizar automaticamente",
  // que são do resultado do último comando. Enquanto o script roda ou espera a pergunta de erro, a edição fica ocupada em todas as abas de resultado.
  const scriptBusy = script !== null && (script.phase === "running" || script.phase === "paused");
  // Seção 37: o submenu "Copiar avançado" (RN-GRADE-003, 016 e 017) e o "Gerar SQL" (RN-GRADE-006 e 018) da grade, no resultado do último comando e em cada
  // aba guardada do script (RN-SQL-023): a origem é `resultado`, e a tabela de destino, a do alvo de uma tabela só. O usuário e o somente leitura da conexão
  // são lidos do cache na hora da escolha.
  const userName = useCallback(() => cachedUserName(queryClient), [queryClient]);
  const copyAs = useCopyAs({ records: null, userName });
  const generateSql = useGridGenerateSql({
    connectionId: tab.connectionId,
    database: tab.database,
    userName: cachedUserName(queryClient),
    records: () => null,
    readOnlyConnection: () => cachedReadOnly(queryClient, tab.connectionId),
    openQueryTab: (id, sql, db) => onOpenQuery?.(id, sql, db),
  });
  // RN-TABELA-007: o "Ir para o registro referenciado" do menu da célula, nas colunas que são link do resultado (`useResultLinks`, mais abaixo, que precisa do
  // alvo que `useRecordEdits` guarda): a fonte tem identidade fixa e lê o que o gancho entregou na última renderização.
  const followRef = useRef<GridFollowSource | null>(null);
  const followSource = useMemo<GridFollowSource>(() => ({ links: (column) => followRef.current?.links(column) === true, linkable: (value) => followRef.current?.linkable(value) === true, follow: (column, value) => followRef.current?.follow(column, value) }), []);
  const edits = useRecordEdits({
    tabId: tab.id,
    runner,
    state,
    connectionId: tab.connectionId,
    database: tab.database,
    subject: "result",
    onSaved: keepSaved,
    filter: kept === null ? filterSource : undefined,
    refresh: kept === null ? menuRerun : undefined,
    autoRefresh: kept === null ? auto.source : undefined,
    confirmSave,
    confirmWholeColumn,
    kept: kept?.rows ?? null,
    scriptBusy,
    exportData: menuExport,
    engine,
    sort: kept === null && base !== null ? resultSort : undefined,
    follow: followSource,
    copyAs: copyAs.source,
    generateSql: generateSql.source,
  });
  const { guard } = edits;
  useEffect(() => {
    guardRef.current = guard;
  });
  // RN-ABAS-012: o "Salvar" das alterações em andamento acende o ponto da aba do resultado, como um comando.
  const saving = edits.banner.saving === true;
  useEffect(() => {
    resultActivity.setSaving(tab.id, saving);
  }, [tab.id, saving]);
  useEffect(() => () => resultActivity.setSaving(tab.id, false), [tab.id]);

  // RN-ABAS-012 e 014: o foco que a troca de lugar ou o F6 pediu para o editor, quando ele está à vista (a aba da consulta voltou à frente).
  useLayoutEffect(() => {
    if (editorShown && resultFocus.take(tab.id, ["editor"]) !== null) editor.current?.focus();
  });

  // RN-ABAS-019: a entrada da aba, onde o foco cai quando ela é aberta por um gesto, ou quando a aba em que ele estava fecha: o editor, com o cursor onde estava;
  // com o editor escondido (o resultado maximizado) ou a aba do resultado ativa, o resultado (a grade, ou o botão "Onde mostrar o resultado"). O editor não toma o
  // foco sozinho ao nascer: quem o leva é a área das abas, com a guarda de não roubá-lo de quem já foi para outro lugar. O estado de agora é lido na hora, por ref.
  const entryNow = useRef({ editorShown, maximized, slot });
  useEffect(() => {
    entryNow.current = { editorShown, maximized, slot };
  });
  useEffect(
    () =>
      tabEntries.register(tab.id, () => {
        const now = entryNow.current;
        if (now.editorShown && !now.maximized && editor.current !== null) {
          editor.current.focus();
          return true;
        }
        return now.slot !== null && focusResultIn(now.slot);
      }),
    [tab.id],
  );

  // O botão e o Ctrl+Enter passam pelo editor: um lugar só para a área recolhida voltar ao executar. Só volta quando o executor vai
  // enviar o comando: sem nada a executar, com mais de um comando ou com a aba ocupada ele só avisa, e não há resultado a caminho.
  // RN-EDIT-007: o comando que vai ser enviado, com alterações não salvas, espera a resposta da pergunta; o que o executor recusaria não pergunta nada.
  // RN-SQL-018: o destaque do comando enviado acende só aqui, quando ele vai mesmo ao banco: sem conexão o executor só pede uma (RN-SCRIPT-003).
  const hasConnection = tab.connectionId !== null;
  const blankLines = preferences.editor.blankLineSeparates;
  /**
   * RN-VAR-019 e 020: o texto do editor agora, com a seleção, quando ele declara variáveis. Nesse caso o Ctrl+Enter e o Alt+X vão pelo executor com variáveis
   * (`runItem`, `runScriptDoc`), que lê o texto inteiro (as declarações de cima valem) e faz a pergunta da proteção no meio, com os valores calculados. Sem
   * declarações, o caminho é o de sempre.
   */
  const variableRange = useCallback(
    (wholeScript: boolean): DocRange | null => {
      const live = liveEditors.snapshot(tab.id);
      if (live === null) return null;
      if (readScript(live.sql, engine, { blankLines }).declarations.size === 0) return null;
      const from = Math.min(live.anchor, live.head);
      const to = Math.max(live.anchor, live.head);
      // Sem seleção, o Alt+X leva o texto inteiro, e o Ctrl+Enter o item do cursor.
      return { doc: { text: live.sql, blankLines }, engine, ...(wholeScript && from === to ? { from: 0, to: live.sql.length } : { from, to }) };
    },
    [tab.id, engine, blankLines],
  );
  // RN-PROT-001: a pergunta no meio da execução, pela proteção da conexão da aba; e o que sai quando ela vai mesmo começar.
  const runHooks = useCallback(
    (flash?: FlashRun): RunHooks => ({
      confirm: (make) => confirmed(make),
      begin: () => {
        if (inPanel) dispatch({ type: "run" });
        clearResultFilter({ setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned });
      },
      // O destaque é do item que o executor com variáveis escolheu (a declaração também), e não do comando que o leitor sem declarações acharia no cursor.
      flash: (item) => {
        if (hasConnection) flash?.(item);
      },
    }),
    [confirmed, inPanel, hasConnection],
  );
  const handleRun = useCallback(
    (target: RunTarget, flash: FlashRun) => {
      const range = variableRange(false);
      if (range !== null) return guard(() => void runner.runItem(range, runHooks(flash)));

      const go = (asked?: boolean) => {
        if (commandWillRun(target, isPersonBusy(runner.getState()))) {
          // RN-PAINEL-001: executar com a área recolhida a restaura, no painel; numa aba ou numa janela o que o painel tinha fica guardado como estava.
          if (inPanel) dispatch({ type: "run" });
          // RN-GRADE-011: o comando do editor vai sem o filtro do resultado, e o campo fica limpo.
          clearResultFilter({ setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned });
          if (hasConnection) flash();
        }
        if (asked) void runner.run(target, { confirmed: true });
        else void runner.run(target);
      };
      // RN-PROT-001: o aviso vem depois da pergunta das alterações não salvas, logo antes de o comando sair; cancelado, nada sai.
      if (commandWillRun(target, isPersonBusy(runner.getState()))) guard(() => confirm((protections) => commandQuestion(protections, confirmedOf(target)), go));
      else go();
    },
    [runner, guard, hasConnection, confirm, inPanel, variableRange, runHooks],
  );
  // RN-SQL-019: "Executar script" (o botão e o Alt+X): as mesmas regras de uma execução (a pergunta das alterações não salvas, o filtro que sai, a área
  // recolhida que volta), e o executor roda os comandos um por vez.
  const handleRunScript = useCallback(
    (targets: RunTarget[]) => {
      const range = variableRange(true);
      if (range !== null) return guard(() => void runner.runScriptDoc(range, runHooks()));
      const go = (asked?: boolean) => {
        if (scriptWillRun(targets, isPersonBusy(runner.getState()))) {
          if (inPanel) dispatch({ type: "run" });
          clearResultFilter({ setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned });
        }
        if (asked) void runner.runScript(targets, { confirmed: true });
        else void runner.runScript(targets);
      };
      // RN-PROT-001: uma vez, antes do primeiro comando, com a lista dos que pedem confirmação; confirmado, o script roda sem perguntar de novo.
      if (scriptWillRun(targets, isPersonBusy(runner.getState()))) guard(() => confirm((protections) => scriptQuestion(protections, targets), go));
      else go();
    },
    [runner, guard, confirm, inPanel, variableRange, runHooks],
  );
  // RN-SQL-020: "Executar este comando", numa aba guardada do script: como o Ctrl+Enter nele. O que o executor recusaria (a aba ocupada) não pergunta, não
  // limpa o filtro nem mexe na área.
  const handleRunAlone = useCallback(
    (target: RunTarget) => {
      const go = (asked?: boolean) => {
        if (commandWillRun(target, isPersonBusy(runner.getState()))) {
          if (inPanel) dispatch({ type: "run" });
          clearResultFilter({ setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned });
        }
        if (asked) void runner.runCommand(target, { confirmed: true });
        else void runner.runCommand(target);
      };
      if (commandWillRun(target, isPersonBusy(runner.getState()))) guard(() => confirm((protections) => commandQuestion(protections, confirmedOf(target)), go));
      else go();
    },
    [runner, guard, confirm, inPanel],
  );
  // RN-GRADE-012 e RN-PROT-001: o F5 e o "Executar de novo" perguntam pelo comando do resultado na tela, com o filtro dele, como qualquer execução.
  const handleRerun = useCallback(
    () =>
      guard(() => {
        const target = rowsTargetOf(runner.getState());
        if (target === null || isPersonBusy(runner.getState())) return void runner.rerun();
        confirm(
          (protections) => commandQuestion(protections, confirmedOf(target)),
          (asked) => (asked ? void runner.rerun({ confirmed: true }) : void runner.rerun()),
        );
      }),
    [runner, guard, confirm],
  );
  useEffect(() => {
    rerunRef.current = handleRerun;
  });

  // RN-SQL-023: as pendências são de uma aba de resultado por vez. Trocar de aba (clique, setas, Home, End, também para as Estatísticas) com alterações não
  // salvas pergunta antes (RN-EDIT-007): "Salvar" grava e troca, "Descartar" joga fora e troca, "Cancelar" fica onde estava. Devolve se trocou já: a lista
  // das abas leva o foco à escolhida só então.
  const pending = edits.pending;
  const chooseScriptTab = useCallback(
    (chosen: ScriptTab) => {
      if (script === null || chosen === shownTab) return true;
      const choose = () => setChosenTab({ run: script.id, tab: chosen });
      if (pending === 0) {
        choose();
        return true;
      }
      // RN-EDIT-022: o "Salvar" do aviso que grava a coluna inteira lê de novo o resultado do último comando, como o da faixa: a troca de aba não executa nada.
      guard(choose, true);
      return false;
    },
    [script, shownTab, pending, guard],
  );

  /**
   * "Exportar…" (RN-EXPORT-001), na barra da área: todas as linhas do resultado à frente, pelo assistente. Depois de um script, o da aba de resultado à
   * frente (o comando daquele resultado, RN-SQL-020); com as Estatísticas à frente, desabilitado. Com a aba ocupada (um comando da pessoa, o "Salvar", o
   * script rodando ou parado na pergunta de erro), também; a execução da atualização automática não desabilita, e a origem é a grade que está na tela.
   */
  const exportShown = kept === null ? exportRows(state) : kept.rows;
  const exportReason = exportBlocker(exportShown, { busy: busy || scriptBusy || edits.banner.saving, statistics: script !== null ? shownTab === "statistics" || shownTab === "variables" : plainShown === "variables" });
  const exportNumber = script !== null && typeof shownTab === "number" ? shownTab + 1 : null;
  const { singleTable, chosenColumns } = edits;
  const openExport = useCallback(() => {
    if (tab.connectionId === null || exportShown === null) return;
    // RN-EXPORT-005: com colunas inteiras escolhidas na grade, só elas vêm marcadas na Extração.
    openExportWizard(resultSource(exportShown, { connectionId: tab.connectionId, ...inDatabase(tab.database), tabTitle: tab.title, scriptNumber: exportNumber, unsavedEdits: pending, table: singleTable, checkedColumns: chosenColumns() }));
  }, [tab.connectionId, tab.database, tab.title, exportShown, exportNumber, pending, singleTable, chosenColumns]);
  useEffect(() => {
    exportRef.current = { blocker: exportReason, open: openExport };
  });

  // RN-TABELA-011: o campo completa as colunas do resultado. Um filtro que dá erro deixa a área sem grade: as colunas continuam as da última.
  const shownRows = shown?.status === "rows" ? shown : null;
  const [seenColumns, setSeenColumns] = useState<readonly { name: string; type: string }[]>([]);
  if (shownRows !== null && shownRows.columns !== seenColumns) setSeenColumns(shownRows.columns);

  // RN-TABELA-007: o valor de uma chave estrangeira leva ao registro referenciado, como nos Registros, no resultado do último comando e nas abas guardadas do
  // script, em qualquer lugar em que a área esteja. Abre a aba da tabela na janela da aba da consulta (é ela que guarda as abas) e, com o resultado numa janela
  // própria (seção 39), traz essa janela à frente: o `link` do F6 e do "Instalar driver".
  const followTable = useCallback(
    (table: { schema: string; name: string }) => {
      if (tab.connectionId === null) return;
      onOpenTable(tab.connectionId, { ...table, view: "data", ...inDatabase(tab.database) });
      if (place === "window") onFocusWindow?.(tab.id, "link");
    },
    [tab.id, tab.connectionId, tab.database, place, onOpenTable, onFocusWindow],
  );
  const resultLinks = useResultLinks({
    shown: kept !== null ? kept.rows : shownRows,
    connectionId: tab.connectionId,
    database: tab.database,
    engine,
    connected: tab.sessionId !== null,
    onView: resultShown && (onScreen || place === "window"),
    sqlTarget: edits.sqlTarget,
    onOpenTable: followTable,
  });
  useEffect(() => {
    followRef.current = { links: (column) => resultLinks.links?.has(column) === true, linkable: resultLinks.linkable, follow: resultLinks.follow };
  });

  // RN-ARVORE-007: trocar o banco, com alterações não salvas na grade, pergunta antes, como executar outro comando (RN-EDIT-007). O resultado na tela é do
  // banco de antes e sai com o executor dele; o texto fica. (A aba de consulta ainda não tem o Commit manual, RN-TX-001: não há transação aberta a perguntar.)
  const txState = useTabTransaction(runner.transaction);
  const [pendingSwitch, setPendingSwitch] = useState<(() => void) | null>(null);
  const guardSwitch = useCallback(
    (proceed: () => void) =>
      guard(() => {
        if (runner.transaction.getState().open) setPendingSwitch(() => proceed);
        else proceed();
      }),
    [guard, runner],
  );
  const handleChooseDatabase = useCallback((database: string | undefined) => guardSwitch(() => onSwitchDatabase(tab.id, database)), [guardSwitch, onSwitchDatabase, tab.id]);

  // RN-ARVORE-008: trocar a conexão pergunta o mesmo antes; o resultado sai com o executor de antes, e a aba vai ao banco padrão da conexão nova.
  const [pickingConnection, setPickingConnection] = useState(false);
  const handleChooseConnection = useCallback((connectionId: string) => guardSwitch(() => onSwitchConnection(tab.id, connectionId)), [guardSwitch, onSwitchConnection, tab.id]);

  // RN-SCRIPT-001: o atalho vale com o foco em qualquer lugar da aba. O editor não o trata, e a tecla chega aqui; os diálogos ficam fora desta árvore.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // RN-ABAS-014: o F6 alterna entre o editor e o resultado da aba, onde quer que ele esteja. O campo de edição da célula, os menus e os diálogos não deixam a
    // tecla subir até aqui. O resultado está noutro lugar da página (a área vai por portal), mas a tecla sobe pela árvore do React.
    if (!event.defaultPrevented && isF6(event)) {
      event.preventDefault();
      const target = event.target as Node;
      const fromResult = slot?.contains(target) === true;
      const action = f6Action({ place, from: fromResult ? "result" : "editor", mode: layout.mode, resultActive: false });
      if (action === "focusResult" && slot !== null) focusResultIn(slot);
      else if (action === "focusEditor") editor.current?.focus();
      else if (action === "showResult" || action === "showQuery") onToggleEntry?.(tab.id, action === "showResult" ? "result" : "query");
      // Numa janela: do editor traz a janela do resultado à frente, com o foco nela; do resultado traz a janela da aba, com a consulta ativa e o foco no editor.
      else if (action === "focusWindow") {
        if (slot !== null) focusResultIn(slot);
        onFocusWindow?.(tab.id, "result");
      } else if (action === "focusOpener") {
        onFocusWindow?.(tab.id, "opener");
        if (editorShown) editor.current?.focus();
      }
      return;
    }
    // RN-GRADE-012: F5 executa de novo o comando do resultado, com o filtro ("Executar de novo"), com o foco em qualquer ponto da aba; com algo em
    // andamento, nada. O campo de edição da célula não deixa a tecla subir.
    // Depois de um script, só na aba do resultado do último comando (RN-SQL-020): é o resultado que o F5 executa de novo.
    if (!event.defaultPrevented && refreshKey(event)) {
      event.preventDefault();
      if (!isPersonBusy(runner.getState()) && liveShown) handleRerun();
      return;
    }
    // RN-SQL-019: Alt+X (Cmd+Option+X no macOS), como no DBeaver, com o foco em qualquer ponto da aba; o campo da célula não deixa a tecla subir. Segurar as
    // teclas repete o evento (`repeat`): o script começa uma vez só, no primeiro, e a repetição não o começa de novo (com a pergunta de erro esperando, ela a
    // responderia "Parar" e começaria outro).
    if (!event.defaultPrevented && scriptShortcut(event, platform)) {
      event.preventDefault();
      if (!event.repeat) editor.current?.runScript();
      return;
    }
    // RN-ARVORE-008: Ctrl+9, como no DBeaver, abre a lista das conexões desta aba, e fecha com o foco no botão dela. Com o foco dentro da lista (a busca),
    // o teclado não sobe até aqui, e quem a fecha pelo mesmo atalho é ela.
    if (!event.defaultPrevented && connectionShortcut(event)) {
      event.preventDefault();
      setPickingConnection((open) => !open);
      return;
    }
    // RN-HIST-001: Ctrl+Shift+H (Cmd+Shift+H no macOS) abre ou fecha o painel do histórico desta aba.
    if (!event.defaultPrevented && (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "h") {
      event.preventDefault();
      if (!event.repeat) setHistoryOpen((open) => !open);
      return;
    }
    const mode = event.defaultPrevented ? null : saveShortcut(event);
    if (mode === null) return;
    event.preventDefault();
    onSave(tab.id, mode);
  }

  /**
   * RN-VAR-012 e 024: leva o cursor do editor ao `offset` (o clique num erro das variáveis, "Ir para a declaração"). Com o resultado numa aba ou numa janela, traz
   * antes o editor à frente, como o F6 (RN-ABAS-014); na aba de execução, que não tem editor, ainda não existe (a aba chega com a segunda parte da seção 41).
   */
  const goToEditor = useCallback(
    (offset: number) => {
      if (place === "tab") onToggleEntry?.(tab.id, "query");
      else if (place === "window") onFocusWindow?.(tab.id, "opener");
      // O editor volta à frente no quadro seguinte (a aba ou a janela ainda estão trocando).
      if (place === "panel") goToOffset(root.current, offset);
      else requestAnimationFrame(() => goToOffset(root.current, offset));
    },
    [place, onToggleEntry, onFocusWindow, tab.id],
  );
  const goToDeclaration = useCallback(
    (name: string) => {
      const offset = declarationOffset(variables.model, name);
      if (offset !== null) goToEditor(offset);
    },
    [variables.model, goToEditor],
  );

  // A edição desfaz a posição do erro (o executor) e acende o ponto da aba de um script (o provedor).
  const handleEdited = useCallback(() => {
    runner.textEdited();
    onEdited(tab.id);
  }, [runner, onEdited, tab.id]);

  const connectionId = tab.connectionId;
  const openTable = connectionId === null ? undefined : (table: { schema: string; name: string }) => onOpenTable(connectionId, { ...table, view: "data", ...inDatabase(tab.database) });

  return (
    <>
      <div ref={root} onKeyDown={handleKeyDown} className="flex min-h-0 flex-1 flex-col text-sm">
        {tab.connectionId === null ? <NoConnectionBar reason={tab.script === undefined ? "restored" : tab.script.generic === true ? "generic" : "scriptMissing"} onAssign={handleChooseConnection} /> : null}
        <EditorToolbar
          busy={busy}
          cancelling={cancelling}
          runnable={runnable}
          onRun={() => editor.current?.run()}
          onRunScript={() => editor.current?.runScript()}
          scriptShortcut={scriptShortcutLabel(platform)}
          onCancel={handleCancel}
          connection={<ConnectionPicker connectionId={connectionId} busy={busy} open={pickingConnection} onOpenChange={setPickingConnection} onChoose={handleChooseConnection} />}
          database={connectionId === null ? null : <DatabasePicker key={connectionId} connectionId={connectionId} database={tab.database} engine={engine} busy={busy} onChoose={handleChooseDatabase} />}
          transaction={connectionId === null ? null : <TransactionControl transaction={runner.transaction} engine={engine} busy={busy} />}
          historyOpen={historyOpen}
          onToggleHistory={() => setHistoryOpen((open) => !open)}
        />
  
        <div className="flex min-h-0 min-w-0 flex-1 flex-row">
        <div ref={area} className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Maximizada, o editor fica sem altura e fora da ordem do Tab, mas montado. */}
          <div inert={maximized} style={{ flex: flex.editor }} className={cn("min-h-0 overflow-hidden", maximized && "h-0")}>
            <SqlEditor
              ref={editor}
              initialSql={tab.sql}
              tabId={tab.id}
              initialSelection={recall(tab.id, "selection") ?? null}
              engine={engine}
              connectionId={tab.connectionId}
              database={tab.database}
              errorAt={shown?.status === "error" ? shown.errorAt : null}
              onRun={handleRun}
              onRunScript={handleRunScript}
              runningAt={runningAt}
              onChange={(sql) => onSqlChange(tab.id, { sql })}
              onRunnableChange={setRunnable}
              onEdited={handleEdited}
              onOpenTable={openTable}
              variables={editorVariables}
            />
          </div>
  
          {inPanel && layout.mode === "split" ? <ResultSplitter area={area} controls={resultId} resultPercent={layout.resultPercent} dispatch={dispatch} /> : null}

          {/* O lugar da área de resultado no painel. Numa aba ou numa janela, ela está no lugar de lá, e aqui não há nada. */}
          {inPanel ? <div ref={setPanelSlot} style={{ flex: flex.result }} className="flex min-h-0 min-w-0 flex-col" /> : null}
        </div>
        {historyOpen ? (
          <HistoryPanel
            connectionId={connectionId}
            onInsertAtCursor={(sql) => editor.current?.insertText(sql)}
            onOpenInNewTab={(item: HistoryItem) => {
              const target = openFromHistory(item, queryClient.getQueryData<{ id: string }[]>(connectionsQuery.queryKey) ?? []);
              onOpenQuery?.(target.connectionId, target.sql);
            }}
            onClose={() => {
              setHistoryOpen(false);
              editor.current?.focus();
            }}
          />
        ) : null}
        </div>
        <ResultHost tabId={tab.id} slot={slot} onBack={onBackToPanel === undefined ? undefined : () => onBackToPanel(tab.id)} onLink={onFocusWindow === undefined ? undefined : () => onFocusWindow(tab.id, "link")}>
          <ResultPanel
            id={resultId}
            environmentColor={environmentColor}
            state={kept === null ? state : kept.rows}
            connected={kept === null && tab.sessionId !== null}
            collapsed={inPanel && layout.mode === "collapsed"}
            placeControl={onPlace === undefined ? undefined : <ResultPlaceButton place={place} items={placeMenu(place, { moving })} onChoose={(next) => onPlace(tab.id, next)} />}
            actions={inPanel ? <ResultActions mode={layout.mode} onAction={(type) => dispatch({ type })} /> : place === "window" && onBackToPanel !== undefined ? <BackToPanelButton onClick={() => onBackToPanel(tab.id)} /> : undefined}
            nullText={preferences.results.nullText}
            // RN-CONFIG-005 e RN-GRADE-014: com a atualização automática ligada, a página seguinte espera o botão. Cada execução volta à primeira página, e a
            // grade que ficou no fim (a rolagem fica) pediria a seguinte a cada intervalo, segurando o bloqueio por inatividade e lendo de novo à toa.
            autoLoadMore={kept === null && preferences.results.autoLoadMore && auto.state.status !== "on"}
            onLoadMore={loadMore}
            follow={{ links: resultLinks.links, onFollow: resultLinks.follow, linkable: resultLinks.linkable }}
            onCount={() => void runner.countTotal()}
            onRerun={handleRerun}
            editing={edits.editing}
            banner={<EditsBanner {...edits.banner} />}
            autoRefresh={<AutoRefreshControl state={auto.state} blocker={auto.blocker} size="bar" onChoose={auto.choose} />}
            filter={
              base === null ? undefined : (
                <RecordsFilter
                  subject="result"
                  draft={filterDraft}
                  onDraft={(text) => {
                    setFilterDraft(text);
                    setFilterProblem(null);
                  }}
                  applied={filterApplied}
                  problem={filterProblem}
                  busy={busy}
                  command={null}
                  onApply={() => sendFilter(filterDraft)}
                  onClear={() => sendFilter("")}
                  engine={engine}
                  columns={shownRows?.columns ?? seenColumns}
                  autocomplete={preferences.editor.autocomplete}
                />
              )
            }
            // RN-ABAS-015: na janela do resultado o ponto vermelho do script parado na pergunta de erro fica na barra dela, ao lado das abas do script: sem o foco nela, a
            // pergunta não abre sozinha.
            tabs={
              script !== null && shownTab !== null
                ? { list: <ScriptTabs run={script} shown={shownTab} idPrefix={tabIds} panelId={`${tabIds}-panel`} variables={variables.shown} onChoose={chooseScriptTab} />, ...(place === "window" ? { mark: <ScriptWaitingMark runner={runner} /> } : {}), panelId: `${tabIds}-panel`, labelledBy: scriptTabId(tabIds, shownTab) }
                : script === null && variables.shown
                  ? { list: <ResultTabs shown={plainShown} idPrefix={tabIds} panelId={`${tabIds}-panel`} onChoose={setPlainTab} />, panelId: `${tabIds}-panel`, labelledBy: `${tabIds}-${plainShown}` }
                  : undefined
            }
            progress={scriptProgress(script)}
            statistics={script === null || shownTab !== "statistics" ? undefined : { body: <ScriptStatistics run={script} onViewSent={setSentView} />, summary: statisticsSummary(script) }}
            variables={showVariables ? { body: <VariablesPanel model={variables.model} values={variables.values} select={variables.reveal} onGoTo={goToDeclaration} />, summary: variablesPanelCopy.tab } : undefined}
            onGoTo={goToEditor}
            onViewSent={() => setSentView(kept === null ? (shownRows?.target ?? null) : kept.rows.target)}
            kept={kept === null ? undefined : { busy, onRunAlone: () => handleRunAlone(kept.rows.target), note: keptNote }}
            exporter={{ blocker: exportReason, onExport: openExport }}
          />
        </ResultHost>
      </div>
      {/*
        Os diálogos que a aba desenha por ela (fora da área de resultado) abrem na janela em que a pessoa está, entre a da aba e a do resultado dela (RN-ABAS-015):
        o que nasceu de uma ação no resultado abre na janela do resultado, e o que nasceu no editor, na da aba. Cada diálogo fixa a página onde abriu.
      */}
      <ActiveHostProvider tabId={tab.id}>
        {/* Fora da caixa que trata o Ctrl+S do script: os diálogos e o menu vão por portal, e o teclado deles subiria até ela pela árvore do React. */}
        {resultEditDialogs(edits, { copyAs, generateSql, engine, connectionId: tab.connectionId, database: tab.database })}
        {/*
          RN-SQL-021: a pergunta de erro do script, enquanto ele espera a resposta, só na aba à vista (a ativa, com a área de trabalho na tela) ou com o foco na janela do
          resultado. O diálogo vai por portal, por cima de tudo: o de uma aba escondida, ou da área de trabalho por baixo de Configurações, cobria a tela de outra coisa e
          tirava o foco de quem digitava. O script de outra aba espera, com a marca na faixa (`ScriptWaitingMark`), e a pergunta aparece quando a pessoa vai até ela.
          Com as duas valendo, abre na janela do resultado se ela tem o foco, e senão na da aba; sem o foco na janela do resultado, ela só mostra o ponto vermelho.
        */}
        {(active && onScreen) || resultWindowFocused ? (script !== null && script.phase === "paused" && script.current !== null ? <ScriptErrorDialog entry={entryAt(script, script.current)} number={script.current + 1} total={script.size} onChoose={runner.script.decide} onViewSent={setSentView} /> : null) : null}
        {/* RN-VAR-018: o "SQL enviado" do comando que levou variáveis, no resultado, nas Estatísticas e na pergunta de erro. */}
        {sentView?.sent === undefined ? null : <SentSqlDialog command={sentView.sent} engine={sentView.engine} onClose={() => setSentView(null)} />}
        {auto.asking === null ? null : <AutoRefreshDialog everyMs={auto.state.status === "on" ? auto.state.everyMs : null} error={auto.asking.error} onSubmit={auto.submitCustom} onCancel={auto.closeCustom} />}
        {pendingSwitch === null ? null : (
          <Dialog
            open
            role="alertdialog"
            title={transactionCopy.switching.title}
            description={txState.failed ? transactionCopy.switching.failedDescription : transactionCopy.switching.description(txState.commands)}
            pending={txState.pending}
            onClose={() => setPendingSwitch(null)}
            footer={
              <>
                <Button autoFocus type="button" variant="secondary" onClick={() => setPendingSwitch(null)} disabled={txState.pending}>
                  {transactionCopy.switching.cancel}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={txState.pending}
                  onClick={() =>
                    void runner.transaction.end(false).then((ok) => {
                      const proceed = pendingSwitch;
                      setPendingSwitch(null);
                      if (ok) proceed();
                    })
                  }
                >
                  {transactionCopy.switching.rollback}
                </Button>
                {txState.failed ? null : (
                  <Button
                    type="button"
                    disabled={txState.pending}
                    onClick={() =>
                      void runner.transaction.end(true).then((ok) => {
                        const proceed = pendingSwitch;
                        setPendingSwitch(null);
                        if (ok) proceed();
                      })
                    }
                  >
                    {transactionCopy.switching.commit}
                  </Button>
                )}
              </>
            }
          />
        )}
        {/* RN-PROT-001: o aviso antes de executar; no Salvar, com o "Ver SQL", que abre os comandos por cima dele. */}
        {confirmation.open === null ? null : <ConfirmCommandDialog {...confirmation.open} onViewSql={confirmation.open.question.kind === "save" || confirmation.open.question.kind === "wholeColumn" ? edits.banner.onViewSql : undefined} />}
      </ActiveHostProvider>
    </>
  );
});

/**
 * Os diálogos que a aba de consulta desenha por ela abrem na janela em que a pessoa está (RN-ABAS-015): a do resultado desta aba, se ela tem o foco, e senão a da
 * aba. É o valor de agora; cada diálogo guarda a página que valia quando abriu.
 */
function ActiveHostProvider({ tabId, children }: { tabId: string; children: ReactNode }) {
  const name = resultWindowNameOf(tabId);
  const host = useSyncExternalStore(hostFocus.subscribe, () => {
    const focused = focusedHost();
    return focused.resultWindow === name ? focused : mainHost();
  });
  return <HostProvider host={host}>{children}</HostProvider>;
}
