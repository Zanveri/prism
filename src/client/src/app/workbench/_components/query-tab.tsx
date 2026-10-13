import { memo, useCallback, useEffect, useId, useReducer, useRef, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";

import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import type { Engine } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { commandWillRun, initialLayout, layoutReducer, paneFlex } from "../_lib/result-layout";
import { saveShortcut } from "../_lib/saved-scripts";
import { recall, remember } from "../_lib/tab-memory";
import { isBusyState, useQueryRunner, type QueryRunner, type RunTarget } from "../_lib/use-query-runner";
import { useRecordEdits, type SavedEdits } from "../_lib/use-record-edits";
import { inDatabase } from "../_lib/navigator-model";
import type { QueryTab, TableView } from "../_lib/workbench-model";
import { EditorToolbar } from "./editor-toolbar";
import { EditsBanner } from "./edits-banner";
import { ResultActions } from "./result-actions";
import { resultEditDialogs } from "./result-edit-dialogs";
import { ResultPanel } from "./result-panel";
import { ResultSplitter } from "./result-splitter";
import { NoConnectionBarView } from "./script-dialogs";
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
  /** RN-SCRIPT-003: a aba sem conexão recebe a que a pessoa escolheu. */
  onAssignConnection: (tabId: string, connectionId: string) => void;
  /** RN-LINK-001: o Ctrl+clique no nome de uma tabela abre a aba dela nos Registros, na conexão e no banco desta aba. Estável. */
  onOpenTable: (connectionId: string, table: { schema: string; name: string; view?: TableView; database?: string }) => void;
};

/** RN-SCRIPT-003: a faixa da aba sem conexão, com as conexões cadastradas para escolher. */
function NoConnectionBar({ tabId, onAssign }: { tabId: string; onAssign: (tabId: string, connectionId: string) => void }) {
  const connections = useQuery(connectionsQuery);
  const [value, setValue] = useState("");
  const options = (connections.data ?? []).map((connection) => ({ value: connection.id, label: connection.name }));

  return <NoConnectionBarView options={options} value={value} onChange={setValue} onAssign={(connectionId) => onAssign(tabId, connectionId)} />;
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
 */
export const QueryTabPanel = memo(function QueryTabPanel({ tab, runner, engine, active, onSqlChange, onEdited, onSave, onAssignConnection, onOpenTable }: QueryTabPanelProps) {
  const state = useQueryRunner(runner);
  const { preferences } = usePreferences();
  const editor = useRef<SqlEditorHandle>(null);
  const area = useRef<HTMLDivElement>(null);
  const resultId = useId();
  const [runnable, setRunnable] = useState(false);
  const [layout, dispatch] = useReducer(layoutReducer, tab.id, (tabId) => recall(tabId, "layout") ?? initialLayout);
  useEffect(() => remember(tab.id, "layout", layout), [tab.id, layout]);

  // "Carregar mais" também ocupa a sessão (RN-SESSAO-002), e a contagem em andamento também se cancela (RN-SQL-010).
  const busy = state.status === "running" || (state.status === "rows" && (state.loadingMore || state.counting));
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
  const edits = useRecordEdits({ tabId: tab.id, runner, state, connectionId: tab.connectionId, database: tab.database, subject: "result", onSaved: keepSaved });
  const { guard } = edits;

  // O botão e o Ctrl+Enter passam pelo editor: um lugar só para a área recolhida voltar ao executar. Só volta quando o executor vai
  // enviar o comando: sem nada a executar, com mais de um comando ou com a aba ocupada ele só avisa, e não há resultado a caminho.
  // RN-EDIT-007: o comando que vai ser enviado, com alterações não salvas, espera a resposta da pergunta; o que o executor recusaria não pergunta nada.
  const handleRun = useCallback(
    (target: RunTarget) => {
      const go = () => {
        if (commandWillRun(target, isBusyState(runner.getState()))) dispatch({ type: "run" });
        void runner.run(target);
      };
      if (commandWillRun(target, isBusyState(runner.getState()))) guard(go);
      else go();
    },
    [runner, guard],
  );
  const handleRerun = useCallback(() => guard(() => void runner.rerun()), [runner, guard]);

  // RN-SCRIPT-001: o atalho vale com o foco em qualquer lugar da aba. O editor não o trata, e a tecla chega aqui; os diálogos ficam fora desta árvore.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
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
        {tab.connectionId === null ? <NoConnectionBar tabId={tab.id} onAssign={onAssignConnection} /> : null}
        <EditorToolbar busy={busy} cancelling={cancelling} runnable={runnable} onRun={() => editor.current?.run()} onCancel={handleCancel} />
  
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
              onChange={(sql) => onSqlChange(tab.id, { sql })}
              onRunnableChange={setRunnable}
              onEdited={handleEdited}
              onOpenTable={openTable}
            />
          </div>
  
          {layout.mode === "split" ? <ResultSplitter area={area} controls={resultId} resultPercent={layout.resultPercent} dispatch={dispatch} /> : null}
  
          <ResultPanel
            id={resultId}
            state={state}
            connected={tab.sessionId !== null}
            collapsed={layout.mode === "collapsed"}
            style={{ flex: flex.result }}
            actions={<ResultActions mode={layout.mode} onAction={(type) => dispatch({ type })} />}
            nullText={preferences.results.nullText}
            autoLoadMore={preferences.results.autoLoadMore}
            onLoadMore={loadMore}
            onCount={() => void runner.countTotal()}
            onRerun={handleRerun}
            editing={edits.editing}
            banner={<EditsBanner {...edits.banner} />}
          />
        </div>
      </div>
      {/* Fora da caixa que trata o Ctrl+S do script: os diálogos e o menu vão por portal, e o teclado deles subiria até ela pela árvore do React. */}
      {resultEditDialogs(edits)}
    </>
  );
});
