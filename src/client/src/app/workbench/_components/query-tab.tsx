import { memo, useCallback, useEffect, useId, useReducer, useRef, useState } from "react";

import { usePreferences } from "@/app/settings/_lib/use-preferences";
import type { Engine } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { commandWillRun, initialLayout, layoutReducer, paneFlex } from "../_lib/result-layout";
import { recall, remember } from "../_lib/tab-memory";
import { isBusyState, useQueryRunner, type QueryRunner, type RunTarget } from "../_lib/use-query-runner";
import type { QueryTab } from "../_lib/workbench-model";
import { EditorToolbar } from "./editor-toolbar";
import { ResultActions } from "./result-actions";
import { ResultPanel } from "./result-panel";
import { ResultSplitter } from "./result-splitter";
import { SqlEditor, type SqlEditorHandle } from "./sql-editor";

type QueryTabPanelProps = {
  tab: QueryTab;
  /** O que a aba executa e mostra. Vive no `WorkbenchProvider`, acima das rotas, e não aqui. */
  runner: QueryRunner;
  engine: Engine | undefined;
  active: boolean;
  onSqlChange: (tabId: string, patch: { sql: string }) => void;
};

/**
 * O que uma aba de consulta mostra: a barra, o editor de SQL e a área de resultado. As abas ficam
 * todas montadas, e só a ativa aparece: trocar de aba não desfaz o editor (o desfazer, o cursor e a
 * rolagem continuam lá). Memorizado para a digitação numa aba não redesenhar as outras.
 *
 * A divisão entre o editor e o resultado é da aba (RN-PAINEL-001): o resultado se recolhe, se
 * maximiza e a divisória se arrasta. Recolher e maximizar só mudam o tamanho: o editor e a grade
 * seguem montados, e ficam sem altura em vez de saírem da página. A divisão fica guardada fora do
 * componente (`tab-memory.ts`, pelo id da aba): o que desmonta e volta, e o bloqueio por inatividade, que troca o executor, a devolvem.
 */
export const QueryTabPanel = memo(function QueryTabPanel({ tab, runner, engine, active, onSqlChange }: QueryTabPanelProps) {
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

  // O botão e o Ctrl+Enter passam pelo editor: um lugar só para a área recolhida voltar ao executar. Só volta quando o executor vai
  // enviar o comando: sem nada a executar, com mais de um comando ou com a aba ocupada ele só avisa, e não há resultado a caminho.
  const handleRun = useCallback(
    (target: RunTarget) => {
      if (commandWillRun(target, isBusyState(runner.getState()))) dispatch({ type: "run" });
      void runner.run(target);
    },
    [runner],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm">
      <EditorToolbar busy={busy} cancelling={cancelling} runnable={runnable} onRun={() => editor.current?.run()} onCancel={handleCancel} />

      <div ref={area} className="flex min-h-0 flex-1 flex-col">
        {/* Maximizada, o editor fica sem altura e fora da ordem do Tab, mas montado. */}
        <div inert={layout.mode === "maximized"} style={{ flex: flex.editor }} className={cn("min-h-0 overflow-hidden", layout.mode === "maximized" && "h-0")}>
          <SqlEditor
            ref={editor}
            initialSql={tab.sql}
            engine={engine}
            connectionId={tab.connectionId}
            autoFocus={active}
            errorAt={shown?.status === "error" ? shown.errorAt : null}
            onRun={handleRun}
            onChange={(sql) => onSqlChange(tab.id, { sql })}
            onRunnableChange={setRunnable}
            onEdited={runner.textEdited}
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
          onRerun={() => void runner.rerun()}
        />
      </div>
    </div>
  );
});
