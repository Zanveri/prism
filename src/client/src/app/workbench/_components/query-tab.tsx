import { memo, useCallback, useEffect, useId, useMemo, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import type { Engine } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { autoRefreshQuestion, commandQuestion, saveQuestion, scriptQuestion } from "../_lib/command-confirmation";
import { refreshKey } from "../_lib/grid-editing";
import { applyResultFilter, clearResultFilter, filterBaseOf } from "../_lib/result-filter";
import { commandWillRun, initialLayout, layoutReducer, paneFlex, scriptWillRun } from "../_lib/result-layout";
import { saveShortcut } from "../_lib/saved-scripts";
import { entryAt, scriptProgress, scriptShortcut, scriptShortcutLabel, shownScriptTab, statisticsSummary, type ScriptTab } from "../_lib/script-run";
import { scriptsCopy } from "../_lib/scripts.copy";
import { connectionChoices, connectionShortcut } from "../_lib/tab-connection";
import { recall, remember } from "../_lib/tab-memory";
import { isPersonBusy, useQueryRunner, useScriptRun, type QueryRunner, type RunnerState, type RunTarget } from "../_lib/use-query-runner";
import { conditionOf } from "../_lib/table-sql";
import { canClear } from "../_lib/table-view";
import { useRecordEdits, type GridFilterSource, type SavedEdits } from "../_lib/use-record-edits";
import { inDatabase } from "../_lib/navigator-model";
import { useAutoRefresh } from "../_lib/use-auto-refresh";
import { useCommandConfirmation } from "../_lib/use-command-confirmation";
import { useConnectedIds } from "../_lib/use-connected-ids";
import { useWorkbenchOnScreen } from "../_lib/use-workbench-on-screen";
import type { QueryTab, TableView } from "../_lib/workbench-model";
import { AutoRefreshControl, AutoRefreshDialog } from "./auto-refresh-control";
import { ConfirmCommandDialog } from "./confirm-command-dialog";
import { ConnectionPicker } from "./connection-picker";
import { DatabasePicker } from "./database-picker";
import { EditorToolbar } from "./editor-toolbar";
import { EditsBanner } from "./edits-banner";
import { ResultActions } from "./result-actions";
import { resultEditDialogs } from "./result-edit-dialogs";
import { ResultPanel } from "./result-panel";
import { ResultSplitter } from "./result-splitter";
import { NoConnectionBarView, type NoConnectionReason } from "./script-dialogs";
import { ScriptErrorDialog } from "./script-error-dialog";
import { ScriptStatistics } from "./script-statistics";
import { ScriptTabs, scriptTabId } from "./script-tabs";
import { RecordsFilter } from "./table-tab/records-filter";
import { SqlEditor, type SqlEditorHandle } from "./sql-editor";

type QueryTabPanelProps = {
  tab: QueryTab;
  /** O que a aba executa e mostra. Vive no `WorkbenchProvider`, acima das rotas, e não aqui. */
  runner: QueryRunner;
  engine: Engine | undefined;
  active: boolean;
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
 * resultado do executor, com tudo o que vale nele; as outras mostram as linhas guardadas, só para leitura. A pergunta de erro do script fica fora da
 * caixa do teclado, como os outros diálogos.
 *
 * Na conexão que confirma antes de executar (RN-PROT-001), o aviso vem antes de o comando sair, depois da pergunta das alterações não salvas: no
 * "Executar" e no Ctrl+Enter, no "Executar este comando", no "Executar script" (uma vez, com a lista), no F5 e no "Executar de novo", no filtro e na ordem do
 * resultado, no "Salvar" da grade (em "Todos os comandos") e ao ligar a atualização automática (em "Todos os comandos", uma vez). Cancelado, nada sai, e a
 * aba fica como estava, com o resultado de antes.
 */
export const QueryTabPanel = memo(function QueryTabPanel({ tab, runner, engine, active, onSqlChange, onEdited, onSave, onSwitchConnection, onOpenTable, onSwitchDatabase }: QueryTabPanelProps) {
  const state = useQueryRunner(runner);
  const script = useScriptRun(runner);
  // RN-PROT-001: o aviso antes de executar, pelas proteções da conexão da aba.
  const confirmation = useCommandConfirmation(tab.connectionId, tab.database);
  const { confirm, confirmed } = confirmation;
  const { preferences } = usePreferences();
  const editor = useRef<SqlEditorHandle>(null);
  const area = useRef<HTMLDivElement>(null);
  const resultId = useId();
  const [runnable, setRunnable] = useState(false);
  const [layout, dispatch] = useReducer(layoutReducer, tab.id, (tabId) => recall(tabId, "layout") ?? initialLayout);
  useEffect(() => remember(tab.id, "layout", layout), [tab.id, layout]);

  // "Carregar mais" também ocupa a sessão (RN-SESSAO-002), e a contagem em andamento também se cancela (RN-SQL-010). A execução da atualização automática
  // não ocupa a aba para a pessoa (RN-GRADE-014): "Executar" não vira "Cancelar", e o comando dela toma o lugar da automática.
  const busy = isPersonBusy(state);
  const cancelling = (state.status === "running" || state.status === "rows") && state.cancelling;
  // O erro que está na tela, inclusive enquanto um comando novo roda: a marca dele no editor dura o que ele durar.
  const shown = state.status === "running" ? state.previous : state;
  const flex = paneFlex(layout);

  function handleCancel() {
    void runner.cancel();
    editor.current?.focus();
  }

  // Com identidade estável: a grade memorizada recebe isto como "cheguei ao fim" (RN-CONFIG-005).
  const loadMore = useCallback(() => void runner.loadMore(), [runner]);

  // RN-EDIT-009: o Salvar que gravou tudo deixa na grade o que foi salvo, sem executar de novo (também antes de a aba ir para outra janela).
  const keepSaved = useCallback(({ resultId, result }: SavedEdits) => runner.keepSaved(resultId, result), [runner]);

  // RN-GRADE-011: o campo de filtro do resultado, o mesmo dos Registros, acima da grade. Aplicar executa de novo o comando do resultado com o texto do campo
  // (a API o junta ao comando), e o texto do editor não muda; executar pelo editor limpa o filtro. O que se decide é de `result-filter.ts`, com teste.
  const [filterDraft, setFilterDraft] = useState("");
  const [filterApplied, setFilterApplied] = useState("");
  const [filterProblem, setFilterProblem] = useState<{ message: string } | null>(null);
  const [pinned, setPinned] = useState<RunTarget | null>(null);
  // RN-SQL-020: a aba do resultado à frente, depois de um script. A escolha da pessoa vale para aquele script (pelo `id`); o seguinte volta às Estatísticas.
  const [chosenTab, setChosenTab] = useState<{ run: number; tab: ScriptTab } | null>(null);
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
          (protections) => commandQuestion(protections, filter === "" ? before : { ...before, filter }),
          () => {
            const { base: target, applied } = filterNow.current;
            // RN-SQL-020: o filtro do resultado do último comando de um script muda só ele; as outras abas do script ficam.
            void applyResultFilter(target, draft, applied, runner.getState(), { setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned, run: (next) => runner.run(next, { keepScript: true }) });
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
  const rerunRef = useRef<() => void>(() => {});
  const menuRerun = useCallback(() => rerunRef.current(), []);

  const shownTab = script === null ? null : shownScriptTab(script, chosenTab !== null && chosenTab.run === script.id ? chosenTab.tab : null);
  // O resultado do executor está à vista: sem script, ou com a aba do último comando à frente (a do cursor aberto).
  const liveShown = script === null || shownTab === script.live;
  const tabIds = useId();
  // A aba guardada à frente (não a do último comando): as linhas dela, só para leitura.
  const kept = script === null || typeof shownTab !== "number" || shownTab === script.live ? null : (script.results.find((result) => result.entry === shownTab) ?? null);
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
      confirm((protections) => autoRefreshQuestion(protections, target), proceed);
    },
    [runner, confirm],
  );
  const auto = useAutoRefresh(runner, active && onScreen && liveShown, confirmAuto);
  // RN-PROT-001: o "Salvar" da grade, em "Todos os comandos", pergunta uma vez, com quantas alterações vão.
  const confirmSave = useCallback((count: number) => confirmed((protections) => saveQuestion(protections, count)), [confirmed]);

  const edits = useRecordEdits({ tabId: tab.id, runner, state, connectionId: tab.connectionId, database: tab.database, subject: "result", onSaved: keepSaved, filter: filterSource, refresh: menuRerun, autoRefresh: auto.source, confirmSave });
  const { guard } = edits;
  useEffect(() => {
    guardRef.current = guard;
  });

  // O botão e o Ctrl+Enter passam pelo editor: um lugar só para a área recolhida voltar ao executar. Só volta quando o executor vai
  // enviar o comando: sem nada a executar, com mais de um comando ou com a aba ocupada ele só avisa, e não há resultado a caminho.
  // RN-EDIT-007: o comando que vai ser enviado, com alterações não salvas, espera a resposta da pergunta; o que o executor recusaria não pergunta nada.
  // RN-SQL-018: o destaque do comando enviado acende só aqui, quando ele vai mesmo ao banco: sem conexão o executor só pede uma (RN-SCRIPT-003).
  const hasConnection = tab.connectionId !== null;
  const handleRun = useCallback(
    (target: RunTarget, flash: () => void) => {
      const go = () => {
        if (commandWillRun(target, isPersonBusy(runner.getState()))) {
          dispatch({ type: "run" });
          // RN-GRADE-011: o comando do editor vai sem o filtro do resultado, e o campo fica limpo.
          clearResultFilter({ setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned });
          if (hasConnection) flash();
        }
        void runner.run(target);
      };
      // RN-PROT-001: o aviso vem depois da pergunta das alterações não salvas, logo antes de o comando sair; cancelado, nada sai.
      if (commandWillRun(target, isPersonBusy(runner.getState()))) guard(() => confirm((protections) => commandQuestion(protections, target), go));
      else go();
    },
    [runner, guard, hasConnection, confirm],
  );
  // RN-SQL-019: "Executar script" (o botão e o Alt+X): as mesmas regras de uma execução (a pergunta das alterações não salvas, o filtro que sai, a área
  // recolhida que volta), e o executor roda os comandos um por vez.
  const handleRunScript = useCallback(
    (targets: RunTarget[]) => {
      const go = () => {
        if (scriptWillRun(targets, isPersonBusy(runner.getState()))) {
          dispatch({ type: "run" });
          clearResultFilter({ setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned });
        }
        void runner.runScript(targets);
      };
      // RN-PROT-001: uma vez, antes do primeiro comando, com a lista dos que pedem confirmação; confirmado, o script roda sem perguntar de novo.
      if (scriptWillRun(targets, isPersonBusy(runner.getState()))) guard(() => confirm((protections) => scriptQuestion(protections, targets), go));
      else go();
    },
    [runner, guard, confirm],
  );
  // RN-SQL-020: "Executar este comando", numa aba guardada do script: como o Ctrl+Enter nele. O que o executor recusaria (a aba ocupada) não pergunta, não
  // limpa o filtro nem mexe na área.
  const handleRunAlone = useCallback(
    (target: RunTarget) => {
      const go = () => {
        if (commandWillRun(target, isPersonBusy(runner.getState()))) {
          dispatch({ type: "run" });
          clearResultFilter({ setDraft: setFilterDraft, setApplied: setFilterApplied, setProblem: setFilterProblem, setPinned });
        }
        void runner.runCommand(target);
      };
      if (commandWillRun(target, isPersonBusy(runner.getState()))) guard(() => confirm((protections) => commandQuestion(protections, target), go));
      else go();
    },
    [runner, guard, confirm],
  );
  // RN-GRADE-012 e RN-PROT-001: o F5 e o "Executar de novo" perguntam pelo comando do resultado na tela, com o filtro dele, como qualquer execução.
  const handleRerun = useCallback(
    () =>
      guard(() => {
        const target = rowsTargetOf(runner.getState());
        if (target === null || isPersonBusy(runner.getState())) return void runner.rerun();
        confirm(
          (protections) => commandQuestion(protections, target),
          () => void runner.rerun(),
        );
      }),
    [runner, guard, confirm],
  );
  useEffect(() => {
    rerunRef.current = handleRerun;
  });

  // RN-TABELA-011: o campo completa as colunas do resultado. Um filtro que dá erro deixa a área sem grade: as colunas continuam as da última.
  const shownRows = shown?.status === "rows" ? shown : null;
  const [seenColumns, setSeenColumns] = useState<readonly { name: string; type: string }[]>([]);
  if (shownRows !== null && shownRows.columns !== seenColumns) setSeenColumns(shownRows.columns);

  // RN-ARVORE-007: trocar o banco, com alterações não salvas na grade, pergunta antes, como executar outro comando (RN-EDIT-007). O resultado na tela é do
  // banco de antes e sai com o executor dele; o texto fica. (A aba de consulta ainda não tem o Commit manual, RN-TX-001: não há transação aberta a perguntar.)
  const handleChooseDatabase = useCallback((database: string | undefined) => guard(() => onSwitchDatabase(tab.id, database)), [guard, onSwitchDatabase, tab.id]);

  // RN-ARVORE-008: trocar a conexão pergunta o mesmo antes; o resultado sai com o executor de antes, e a aba vai ao banco padrão da conexão nova.
  const [pickingConnection, setPickingConnection] = useState(false);
  const handleChooseConnection = useCallback((connectionId: string) => guard(() => onSwitchConnection(tab.id, connectionId)), [guard, onSwitchConnection, tab.id]);

  // RN-SCRIPT-001: o atalho vale com o foco em qualquer lugar da aba. O editor não o trata, e a tecla chega aqui; os diálogos ficam fora desta árvore.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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
    const mode = event.defaultPrevented ? null : saveShortcut(event);
    if (mode === null) return;
    event.preventDefault();
    onSave(tab.id, mode);
  }

  // A edição desfaz a posição do erro (o executor) e acende o ponto da aba de um script (o provedor).
  const handleEdited = useCallback(() => {
    runner.textEdited();
    onEdited(tab.id);
  }, [runner, onEdited, tab.id]);

  const connectionId = tab.connectionId;
  const openTable = connectionId === null ? undefined : (table: { schema: string; name: string }) => onOpenTable(connectionId, { ...table, view: "data", ...inDatabase(tab.database) });

  return (
    <>
      <div onKeyDown={handleKeyDown} className="flex min-h-0 flex-1 flex-col text-sm">
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
        />
  
        <div ref={area} className="flex min-h-0 flex-1 flex-col">
          {/* Maximizada, o editor fica sem altura e fora da ordem do Tab, mas montado. */}
          <div inert={layout.mode === "maximized"} style={{ flex: flex.editor }} className={cn("min-h-0 overflow-hidden", layout.mode === "maximized" && "h-0")}>
            <SqlEditor
              ref={editor}
              initialSql={tab.sql}
              tabId={tab.id}
              initialSelection={recall(tab.id, "selection") ?? null}
              engine={engine}
              connectionId={tab.connectionId}
              database={tab.database}
              autoFocus={active}
              errorAt={shown?.status === "error" ? shown.errorAt : null}
              onRun={handleRun}
              onRunScript={handleRunScript}
              runningAt={runningAt}
              onChange={(sql) => onSqlChange(tab.id, { sql })}
              onRunnableChange={setRunnable}
              onEdited={handleEdited}
              onOpenTable={openTable}
            />
          </div>
  
          {layout.mode === "split" ? <ResultSplitter area={area} controls={resultId} resultPercent={layout.resultPercent} dispatch={dispatch} /> : null}
  
          <ResultPanel
            id={resultId}
            state={kept === null ? state : kept.rows}
            connected={kept === null && tab.sessionId !== null}
            collapsed={layout.mode === "collapsed"}
            style={{ flex: flex.result }}
            actions={<ResultActions mode={layout.mode} onAction={(type) => dispatch({ type })} />}
            nullText={preferences.results.nullText}
            // RN-CONFIG-005 e RN-GRADE-014: com a atualização automática ligada, a página seguinte espera o botão. Cada execução volta à primeira página, e a
            // grade que ficou no fim (a rolagem fica) pediria a seguinte a cada intervalo, segurando o bloqueio por inatividade e lendo de novo à toa.
            autoLoadMore={kept === null && preferences.results.autoLoadMore && auto.state.status !== "on"}
            onLoadMore={loadMore}
            onCount={() => void runner.countTotal()}
            onRerun={handleRerun}
            editing={edits.editing}
            banner={<EditsBanner {...edits.banner} />}
            autoRefresh={<AutoRefreshControl state={auto.state} blocker={auto.blocker} onChoose={auto.choose} />}
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
            tabs={script === null || shownTab === null ? undefined : { list: <ScriptTabs run={script} shown={shownTab} idPrefix={tabIds} panelId={`${tabIds}-panel`} onChoose={(chosen) => setChosenTab({ run: script.id, tab: chosen })} />, panelId: `${tabIds}-panel`, labelledBy: scriptTabId(tabIds, shownTab) }}
            progress={scriptProgress(script)}
            statistics={script === null || shownTab !== "statistics" ? undefined : { body: <ScriptStatistics run={script} />, summary: statisticsSummary(script) }}
            kept={kept === null ? undefined : { busy, onRunAlone: () => handleRunAlone(kept.rows.target) }}
          />
        </div>
      </div>
      {/* Fora da caixa que trata o Ctrl+S do script: os diálogos e o menu vão por portal, e o teclado deles subiria até ela pela árvore do React. */}
      {resultEditDialogs(edits)}
      {/*
        RN-SQL-021: a pergunta de erro do script, enquanto ele espera a resposta, só na aba à vista (a ativa, com a área de trabalho na tela). O diálogo vai
        por portal, por cima de tudo: o de uma aba escondida, ou da área de trabalho por baixo de Configurações, cobria a tela de outra coisa e tirava o foco
        de quem digitava. O script de outra aba espera, com a marca na faixa (`ScriptWaitingMark`), e a pergunta aparece quando a pessoa vai até ela.
      */}
      {active && onScreen && script !== null && script.phase === "paused" && script.current !== null ? (
        <ScriptErrorDialog entry={entryAt(script, script.current)} number={script.current + 1} total={script.size} onChoose={runner.script.decide} />
      ) : null}
      {auto.asking === null ? null : <AutoRefreshDialog everyMs={auto.state.status === "on" ? auto.state.everyMs : null} error={auto.asking.error} onSubmit={auto.submitCustom} onCancel={auto.closeCustom} />}
      {/* RN-PROT-001: o aviso antes de executar; no Salvar, com o "Ver SQL", que abre os comandos por cima dele. */}
      {confirmation.open === null ? null : <ConfirmCommandDialog {...confirmation.open} onViewSql={confirmation.open.question.kind === "save" ? edits.banner.onViewSql : undefined} />}
    </>
  );
});
