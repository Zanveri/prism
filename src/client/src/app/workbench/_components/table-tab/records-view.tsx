import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { useToast, type Engine } from "@/components/ui";

import { csvExportOf } from "../../_lib/csv";
import { filterHandoff } from "../../_lib/filter-handoff";
import { followOf, recordLinks } from "../../_lib/foreign-key-links";
import { isBusy } from "../../_lib/result-paging";
import { saveText } from "../../_lib/save-file";
import { recall, remember } from "../../_lib/tab-memory";
import type { TableRef } from "../../_lib/table-diagram";
import { recordsSql, sortOf, sqlLiteral } from "../../_lib/table-sql";
import { foreignKeysQuery } from "../../_lib/table-structure.service";
import { clearRecords, idleNotice, needsFirstRun, runRecords, settleHandoff, sortRecords, takeHandoff } from "../../_lib/table-view";
import { useQueryRunner, type QueryRunner } from "../../_lib/use-query-runner";
import type { TableView } from "../../_lib/workbench-model";
import { ResultPanel } from "../result-panel";
import { RecordsFilter } from "./records-filter";

type RecordsViewProps = {
  /** O id da aba: o filtro e a ordem ficam lembrados por ele (`tab-memory.ts`), e sobrevivem a trocar de vista e ao bloqueio, que troca o executor. */
  tabId: string;
  /** O executor da aba: o mesmo da consulta, com a sessão, as páginas, a contagem e o cancelamento. */
  runner: QueryRunner;
  /** O banco da conexão. Sem ele não se sabe como escrever o nome da tabela, e nada é executado. */
  engine: Engine | undefined;
  /** A conexão da aba: as chaves estrangeiras da tabela e a passagem do filtro para outra aba são dela (RN-TABELA-007). */
  connectionId: string;
  schema: string;
  name: string;
  /** A aba tem sessão aberta: sem ela não há sobre o que contar. */
  connected: boolean;
  /** A aba está À VISTA (a ativa, com a área de trabalho na tela): a escondida não executa nada, nem a primeira carga (RN-SEG-001). */
  visible: boolean;
  /** A pessoa desconectou a conexão e ainda não a reconectou: nada executa sozinho, e "Atualizar" conecta e carrega. */
  disconnected: boolean;
  /** Abre, ou traz à frente, a aba de outra tabela da mesma conexão: o clique no valor de uma chave estrangeira. */
  onOpenTable: (table: TableRef & { view?: TableView }) => void;
};

/**
 * A vista Registros (RN-TABELA-002, 005 e 010): executa `SELECT * FROM` a tabela pelo executor da aba, com o
 * texto do campo depois do nome dela (a condição, a ordem ou as duas), e mostra o que já existe para a consulta
 * (grade, "carregar mais", contar o total, cancelar). Só leitura. O texto do comando não passa por editor: o
 * executor recebe o comando pronto, e a tela o mostra embaixo do filtro.
 *
 * A ordem mora no texto do campo: clicar no cabeçalho de uma coluna escreve, troca ou tira o `ORDER BY` ali e executa
 * (`sortRecords`), "Limpar" tira a condição e a ordem de uma vez (`clearRecords`), e a seta do cabeçalho é lida do filtro
 * em vigor, quando a ordem dele é de uma coluna só (`sortOf`).
 *
 * Executa ao abrir e, ao voltar a esta vista, só se a aba ainda não tem resultado nenhum: um erro, um
 * cancelamento ou as linhas que estão na tela ficam como estão, e quem as refaz é "Atualizar". A vista
 * desmonta ao trocar para outra e o resultado fica no executor: voltar não perde as linhas. O filtro e a
 * ordem ficam lembrados com a aba (`tab-memory.ts`, pelo id dela), inclusive ao ir a outra vista e voltar e ao bloquear e desbloquear.
 *
 * Só executa sozinha com a aba à vista (a escondida espera ser aberta, também ao desbloquear: RN-SEG-001) e nunca sobre uma
 * conexão que a pessoa desconectou (`needsFirstRun`): ali a vista diz que está desconectada, e "Atualizar" conecta e carrega.
 *
 * O valor de uma coluna que é chave estrangeira é um link (RN-TABELA-007): leva à aba da tabela referenciada, com o filtro
 * `"coluna" = valor` já no campo. O filtro viaja pela passagem (`filter-handoff.ts`), porque a aba de lá ainda pode não existir: esta vista,
 * quando a tabela é a dela, ela está à vista, a aba não tem nada em andamento e a conexão está de pé, o leva ao campo e o executa (`takeHandoff` e
 * `settleHandoff`, em `table-view.ts`); com algo em andamento, ou com a conexão desconectada, o pedido espera na passagem, porque o comando não seria enviado.
 * Com a conexão desconectada pela pessoa os valores deixam de ser link (`recordLinks`): nada reconecta sem o clique em "Atualizar" (RN-SESSAO-004).
 *
 * O que esta vista DECIDE (a primeira carga, enviar ou não o comando pedido, a entrega do filtro, o aviso de "Carregando…" ou "desconectada") e o que faz com
 * cada decisão está em `table-view.ts`, em funções sem React, com as peças injetadas e com teste: aqui só se entregam o estado do executor e os `setState`.
 */
export function RecordsView({ tabId, runner, engine, connectionId, schema, name, connected, visible, disconnected, onOpenTable }: RecordsViewProps) {
  const state = useQueryRunner(runner);
  const { preferences } = usePreferences();
  const toast = useToast();
  const queryClient = useQueryClient();

  const remembered = recall(tabId, "records");
  const [draft, setDraft] = useState(remembered?.draft ?? "");
  // O filtro em vigor: o texto do último comando ENVIADO (a condição, a ordem ou as duas). A memória da aba o guarda em `query.where`, o formato de quando a
  // ordem vivia fora do texto (`tab-memory.ts` é de outra frente nesta leva); `sort` vai sempre `null`.
  const [filter, setFilter] = useState(remembered?.query.where ?? "");
  const [problem, setProblem] = useState<"severalStatements" | null>(null);
  useEffect(() => remember(tabId, "records", { draft, query: { where: filter, sort: null } }), [tabId, draft, filter]);

  /** Pede ao executor o comando do filtro dado. */
  const execute = useCallback(
    (next: string) => {
      if (engine !== undefined) void runner.run({ sql: recordsSql(engine, schema, name, next), offset: 0, engine });
    },
    [runner, engine, schema, name],
  );

  /**
   * Executa o filtro dado e o lembra como o em vigor: o comando que a tela mostra é sempre o do último
   * comando ENVIADO. Só entra como aplicado o que o executor vai de fato enviar: com algo em andamento ele o recusaria (RN-SESSAO-002), e com
   * mais de um comando também (RN-SQL-001); nos dois casos nada muda (a seta do cabeçalho, o comando à vista e o filtro em vigor ficam como
   * estavam), e nos vários comandos o campo diz o que há de errado. A decisão e o que se faz com ela são de `runRecords` (`table-view.ts`, com teste).
   */
  const run = useCallback(
    (next: string) => {
      if (engine !== undefined) runRecords({ engine, schema, name }, next, runner.getState(), { setProblem, setFilter, execute });
    },
    [runner, engine, schema, name, execute],
  );

  const refresh = useCallback(() => run(filter), [run, filter]);

  /** "Exportar CSV" (RN-TABELA-006): as linhas carregadas agora, pelo download do navegador, e o aviso com quantas saíram. */
  const exportCsv = useCallback(() => {
    const current = runner.getState();
    if (current.status !== "rows") return;

    const { fileName, text, notice } = csvExportOf(current, schema, name);
    saveText(fileName, text, "text/csv;charset=utf-8");
    toast[notice.tone](notice.text);
  }, [runner, schema, name, toast]);

  // Com identidade estável: a grade memorizada recebe isto como "cheguei ao fim" (RN-CONFIG-005).
  const loadMore = useCallback(() => void runner.loadMore(), [runner]);

  // As chaves estrangeiras da tabela: o catálogo que a Estrutura e o Diagrama também usam (mesma consulta, mesmo cache). Só com linhas na tela, a vista
  // à frente e a conexão de pé: nada se busca por conta de uma aba escondida ou de uma conexão que a pessoa desconectou.
  const shown = state.status === "rows" ? state : null;
  const foreignKeys = useQuery(foreignKeysQuery(connectionId, schema, name, queryClient, visible && !disconnected && shown !== null));
  const resultColumns = shown?.columns;
  // Com a conexão desconectada nenhum valor é link (`recordLinks`): o catálogo das chaves pode seguir em cache, mas seguir a chave não enviaria nada.
  const links = useMemo(() => recordLinks(resultColumns, foreignKeys.data, disconnected), [resultColumns, foreignKeys.data, disconnected]);

  // Que valores viram link diz o mesmo `sqlLiteral` que o clique usa, com o banco da conexão (hoje só o valor com caractere de controle não vira, em banco nenhum).
  const linkable = useCallback((value: string) => engine !== undefined && sqlLiteral(engine, value, "text") !== null, [engine]);

  // A seta do cabeçalho é a da ordem EM VIGOR, quando ela é de uma coluna só da grade que está na tela (as linhas ficam lá, esmaecidas, enquanto outro comando roda).
  const onScreen = state.status === "running" ? state.previous : state;
  const gridColumns = onScreen?.status === "rows" ? onScreen.columns : null;
  const sort = useMemo(() => (gridColumns === null ? null : sortOf(filter, gridColumns, engine)), [filter, gridColumns, engine]);

  // O clique tem identidade fixa (a linha da grade é memorizada) e lê o que muda por uma ref atualizada depois de cada renderização.
  const latest = useRef({ engine, links, connectionId, onOpenTable });
  useEffect(() => {
    latest.current = { engine, links, connectionId, onOpenTable };
  });
  const follow = useCallback(
    (columnIndex: number, value: string) => {
      const current = latest.current;
      const result = runner.getState();
      const link = current.links?.get(columnIndex);
      if (current.engine === undefined || result.status !== "rows" || link === undefined) return;

      const request = followOf(current.engine, result.columns[columnIndex], link, value);
      if (request === null) return;

      // O pedido sai antes de a aba abrir: a vista de lá, ainda por montar, ou já montada e escondida, o encontra à espera.
      filterHandoff.request(current.connectionId, request.table, request.where);
      current.onOpenTable({ ...request.table, view: "data" });
    },
    [runner],
  );

  // O filtro que outra aba pediu para esta tabela (RN-TABELA-007), levado ao campo quando esta vista está à vista, a aba não tem nada em andamento e a conexão
  // está de pé (`takeHandoff`, em `table-view.ts`). O ajuste é na renderização, e não num efeito: o campo e o comando já saem com ele, e a primeira carga de uma
  // aba nova (abaixo) executa com ele.
  const requested = useSyncExternalStore(filterHandoff.subscribe, () => filterHandoff.peek(connectionId, { schema, name }));
  const [applied, setApplied] = useState<number | null>(null);
  takeHandoff(requested, applied, { visible, disconnected, state, filter, engine }, { setApplied, setDraft, setProblem, setFilter });

  useEffect(() => {
    // `idle` é "nunca executou"; `running` (o segundo efeito do StrictMode, uma abertura em curso) não repete.
    if (needsFirstRun(runner.getState(), { engine, visible, disconnected })) execute(filter);
  }, [runner, engine, visible, disconnected, execute, filter]);

  // O pedido levado ao campo sai da passagem e, com resultado na tela, a consulta se refaz com ele (`settleHandoff`).
  useEffect(() => {
    settleHandoff(requested, applied, runner.getState(), { clear: (id) => filterHandoff.clear(connectionId, { schema, name }, id), execute: () => execute(filter) });
  }, [requested, applied, connectionId, schema, name, runner, execute, filter]);

  const notice = idleNotice(state, { engine, disconnected });

  /** "Aplicar filtro": o texto do campo, inteiro. O aviso de antes sai, e `runRecords` o põe de volta se o texto tem mais de um comando. */
  function apply() {
    setProblem(null);
    run(draft);
  }

  /** O clique no cabeçalho escreve, troca ou tira o `ORDER BY` no texto do campo e o envia (`sortRecords`, RN-TABELA-010). */
  function sortBy(column: string) {
    if (engine !== undefined && gridColumns !== null) sortRecords({ engine, schema, name }, { draft, filter, column, columns: gridColumns }, runner.getState(), { setDraft, setProblem, setFilter, execute });
  }

  /** "Limpar" tira a condição e a ordem de uma vez (`clearRecords`, RN-TABELA-010). */
  function clear() {
    clearRecords({ engine, schema, name }, filter, runner.getState(), { setDraft, setProblem, setFilter, execute });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordsFilter
        draft={draft}
        onDraft={(text) => {
          setDraft(text);
          setProblem(null);
        }}
        applied={filter}
        problem={problem}
        busy={isBusy(state)}
        command={engine === undefined ? null : recordsSql(engine, schema, name, filter)}
        onApply={apply}
        onClear={clear}
      />
      <ResultPanel
        state={state}
        connected={connected}
        // As larguras das colunas (RN-GRADE-009) ficam lembradas pela aba: esta vista desmonta ao trocar para a Estrutura ou o Diagrama.
        tabId={tabId}
        records={{
          name: `${schema}.${name}`,
          onRefresh: refresh,
          onCancel: () => void runner.cancel(),
          sort,
          onSort: sortBy,
          onExport: exportCsv,
          links,
          onFollow: follow,
          linkable,
          // Sem resultado e sem desconexão, a primeira carga está para começar (o banco chegando, a aba sendo aberta): "Carregando…".
          waiting: notice.waiting,
          disconnected: notice.disconnected,
        }}
        nullText={preferences.results.nullText}
        autoLoadMore={preferences.results.autoLoadMore}
        onLoadMore={loadMore}
        onCount={() => void runner.countTotal()}
        onRerun={refresh}
      />
    </div>
  );
}
