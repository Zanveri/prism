import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { VaultLock } from "@/app/_components/vault-lock";
import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { useToast } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { claimWorkspaceRestore, onTabArrived, reportWorkspace, tellWindows, withdrawWorkspace } from "@/lib/api/bridge";
import { allowRefusal } from "@/lib/api/prism-api";
import { workspaceSync } from "@/lib/api/workspace-sync";

import type { DatabaseSession } from "./database-sessions.schema";
import { closeDatabaseSession, databaseSessionKey, treeSessionIds } from "./database-sessions.service";
import { filterHandoff } from "./filter-handoff";
import { liveEditors } from "./live-editors";
import { inDatabase, parseNavKey } from "./navigator-model";
import { withEditedSql, type ScriptRef } from "./saved-scripts";
import { createWorkspaceSource, restoreWorkspace, type LiveSql } from "./saved-workspace";
import type { Script } from "./scripts.schema";
import { getScript, scriptsQuery } from "./scripts.service";
import { cancelQuery } from "./query.service";
import { forgetExcept, rememberTransferred } from "./tab-memory";
import { moveTab, shiftTab } from "./tab-order";
import { withDatabase } from "./tab-database";
import { readTransfer } from "./tab-transfer";
import { unsavedEdits } from "./unsaved-edits";
import { createQueryRunner, isBusyState, type QueryRunner } from "./use-query-runner";
import { createLockHandles } from "./workbench-lock";
import { forgetMissingConnections, nextActiveTab, pruneWorkbench, type QueryTab, type TableView } from "./workbench-model";
import { workbenchCopy } from "./workbench.copy";
import { getWorkspace } from "./workspace.service";
import { createWorkspaceReporter } from "./workspace-reporter";

export type { QueryTab };

type WorkbenchState = {
  tabs: QueryTab[];
  activeTabId: string | null;
  /** Abre uma aba de consulta; com `sql`, o editor já nasce com esse texto (nada é executado); com `database`, na sessão desse outro banco do servidor (RN-ARVORE-006). */
  openQueryTab: (connectionId: string, sql?: string, database?: string) => void;
  /** Abre a aba de uma tabela, ou volta para a que já está aberta; com `view`, já na vista pedida (RN-TABELA-001); com `database`, a tabela é desse outro banco do servidor. */
  openTableTab: (connectionId: string, table: { schema: string; name: string; view?: TableView; database?: string }) => void;
  setTableView: (tabId: string, view: TableView) => void;
  /** Fecha a aba e a sessão dela (RN-SESSAO-004). */
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  /** RN-ABAS-001: põe a aba na posição da faixa onde a marca de soltar estava (a posição de antes de ela sair do lugar). */
  reorderTab: (tabId: string, insertAt: number) => void;
  /** RN-ABAS-001: Ctrl+Shift+PageUp e PageDown, uma posição, sem dar a volta. */
  shiftTab: (tabId: string, delta: -1 | 1) => void;
  /**
   * RN-ABAS-002 e 003: a aba foi para outra janela. Sai desta SEM fechar a sessão (a API é a mesma, e a sessão agora é da outra janela) e sem
   * cancelar nada: só a aba parada muda de janela.
   */
  detachTab: (tabId: string) => void;
  /**
   * RN-ABAS-004: a janela vai fechar e as abas dela já fecharam: espera os fechamentos de sessão que estão a caminho e fecha as sessões da árvore
   * desta janela (as das outras janelas são delas). Nenhuma sessão fica aberta na API sem janela.
   */
  releaseWindow: () => Promise<void>;
  /** O editor grava aqui o texto da aba, com atraso (não a cada tecla); a sessão, quem grava é o que a aba executa. */
  updateTab: (tabId: string, patch: Partial<Pick<QueryTab, "sessionId" | "sql">>) => void;
  /**
   * RN-SCRIPT-003: abre o script numa aba de consulta, na conexão e no banco dados (`connectionId` nulo: a conexão dele não existe mais, e a aba pede uma).
   * O script que já tem aba volta para ela: uma aba por script.
   */
  openScriptTab: (script: Script, place: { connectionId: string | null; database?: string }) => void;
  /** RN-SCRIPT-001: a aba foi salva como o script dado, com este texto e neste banco (o ponto apaga, se o editor ainda tem esse texto e a aba, esse banco). */
  setTabScript: (tabId: string, script: { id: string; name: string }, savedSql: string, savedDatabase: string | undefined) => void;
  /** RN-SCRIPT-001: o texto do editor mudou, sem atraso: o ponto da aba de um script acende na hora (só a primeira tecla muda o estado). */
  markScriptEdited: (tabId: string) => void;
  /** RN-SCRIPT-003: o script mudou de nome no navegador; as abas dele mudam de título. */
  renameScript: (scriptId: string, name: string) => void;
  /** RN-SCRIPT-003: o script foi excluído; as abas dele continuam, com o texto, como consultas sem script. */
  forgetScript: (scriptId: string) => void;
  /** RN-SCRIPT-003: a aba sem conexão recebe a que a pessoa escolheu, no banco da conexão, com um executor novo. */
  assignConnection: (tabId: string, connectionId: string) => void;
  /**
   * RN-ARVORE-007: a aba de consulta passa a outro banco do servidor da conexão (`undefined`: o da conexão), sem executar nada. Ganha um executor novo nesse
   * banco, que abre a sessão dele na próxima execução, como a aba aberta pela árvore (RN-ARVORE-006); o de antes sai de cena com o resultado, e a sessão dele
   * fecha. O texto fica. Com comando em andamento não troca (a barra não oferece).
   */
  switchDatabase: (tabId: string, database: string | undefined) => void;
  /** O que a aba executa e mostra: a sessão dela, o comando em andamento e o resultado (`use-query-runner.ts`). */
  runnerOf: (tabId: string) => QueryRunner;

  /** As chaves (`navKey`) dos nós da árvore que estão abertos, sem as pastas, que são só da tela do navegador. */
  expanded: ReadonlySet<string>;
  setNodeOpen: (key: string, open: boolean) => void;
  /** Fecha as sessões da árvore (a de cada banco aberto, RN-ARVORE-006) e as das abas da conexão, e recolhe o que estava aberto nela (RN-SESSAO-004). */
  disconnect: (connectionId: string) => void;
  /** A conexão que está sendo desconectada agora, se alguma. */
  disconnecting: string | null;

  /**
   * RN-ABAS-006: as conexões das abas de tabela que voltaram na entrada. Elas voltam desconectadas, e as vistas delas esperam o clique para conectar
   * (`DisconnectLog.mark`), como as de uma conexão que a pessoa desconectou.
   */
  restoredTableConnections: ReadonlySet<string>;
  /**
   * RN-ABAS-004 com a RN-ABAS-006: a janela começou a fechar. As abas que fecham por causa dela continuam no que volta (a última janela fechada é o app
   * saindo, e as abas voltam na próxima entrada); a janela que fica aberta (a pessoa cancelou uma pergunta) solta, e o que fechou até ali sai do que volta.
   */
  holdForWindowClose: () => void;
  releaseWindowClose: () => void;
};

const WorkbenchContext = createContext<WorkbenchState | null>(null);

/** O que uma aba soltou: a sessão dela na API e se havia comando rodando nela. */
type Released = { sessionId: string | null; busy: boolean };

/**
 * Encerra na API o que uma aba soltou (RN-SESSAO-004): cancela o comando que rodava (RN-SQL-010) e
 * fecha a sessão, mesmo que o cancelamento falhe. Uma sessão que a API já não tem (404) está
 * fechada do mesmo jeito; qualquer outra falha vai ao aviso central.
 */
async function endSession({ sessionId, busy }: Released): Promise<void> {
  if (sessionId === null) return;

  const cancelled = busy ? await cancelQuery(sessionId) : null;
  allowRefusal(await closeDatabaseSession(sessionId), "DATABASE_SESSION_NOT_FOUND");
  if (cancelled !== null) allowRefusal(cancelled, "DATABASE_SESSION_NOT_FOUND");
}

/**
 * O que a área de trabalho guarda e não pode perder ao ir para Conexões e voltar: as abas (e, com
 * elas, o texto de SQL e a sessão de cada uma) e os nós abertos da árvore. Por isso o provedor fica
 * acima das rotas de dentro do cofre, e não na página. Sair do cofre desmonta tudo: nada passa
 * para o usuário seguinte.
 *
 * O que cada aba executa e mostra (`QueryRunner`) também fica aqui, fora do estado do React: um
 * comando em andamento e o resultado dele sobrevivem a trocar de aba e a ir a Conexões, e mudar o
 * resultado de uma aba não redesenha a área de trabalho, só quem o observa.
 *
 * Quando uma conexão some da lista (excluída em Conexões, ou de qualquer outro jeito) a API já
 * encerrou as sessões dela (RN-CONN-014): o provedor tira as abas e os nós abertos dela e esquece a
 * sessão e os níveis da árvore em cache, para nada ficar apontando para uma conexão que não existe.
 *
 * O bloqueio por inatividade (RN-SEG-001, `VaultLock`) mora aqui, ao lado das telas, e não acima do provedor: bloquear NÃO
 * desmonta nada. A tela de bloqueio é um diálogo modal por cima de tudo, e as abas, o texto de SQL e os nós abertos
 * continuam onde estavam; `discard` solta o que dependia do cofre aberto.
 */
export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [tabs, setTabs] = useState<QueryTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  // O número só cresce: fechar "consulta-2.sql" não faz a próxima aba reaproveitar o nome.
  const nextNumber = useRef(1);
  // Um mapa só, criado uma vez e nunca trocado: `useState` com inicializador, e não `useRef`, porque o lint do React não deixa passar o
  // conteúdo de uma ref a `createLockHandles` durante a renderização, e o mapa tem de ir inteiro (a identidade importa, ver lá).
  const [runners] = useState(() => new Map<string, QueryRunner>());
  // Os fechamentos de sessão a caminho (as abas fechadas): a janela que fecha espera por eles antes de sumir (`releaseWindow`).
  const [closing] = useState(() => new Set<Promise<unknown>>());

  // RN-ABAS-006: as abas desta janela, contadas ao processo principal, que junta as de todas e as grava pela API. O relato lê o estado DESTE instante (a
  // fonte, que recebe as abas a cada renderização) e o texto vivo dos editores; a aba que fecha é contada com urgência (`urgentReport`), e a gravação é na hora.
  // Criados uma vez e nunca trocados, por `useState`, como `runners`.
  const [source] = useState(() => createWorkspaceSource(liveSql));
  const [reporter] = useState(() =>
    createWorkspaceReporter({
      read: () => source.read(),
      send: reportWorkspace,
      schedule: (run, ms) => {
        const timer = setTimeout(run, ms);
        return () => clearTimeout(timer);
      },
    }),
  );
  const urgentReport = useRef(false);
  const [restoredTableConnections, setRestoredTableConnections] = useState<ReadonlySet<string>>(() => new Set());
  const [reporting, setReporting] = useState(false);

  // A mesma consulta de Conexões e do navegador (mesma chave, mesmo cache): aqui só se olha o que sumiu dela.
  const connections = useQuery(connectionsQuery);
  const existing = useMemo(() => (connections.data === undefined ? null : new Set(connections.data.map((connection) => connection.id))), [connections.data]);

  // Ajuste durante a renderização (e não num efeito): nenhum filho chega a ver a aba nem o nó de uma conexão que já não existe.
  const pruned = pruneWorkbench({ tabs, activeTabId, expanded }, existing);
  if (pruned !== null) {
    setTabs(pruned.tabs);
    setActiveTabId(pruned.activeTabId);
    setExpanded(pruned.expanded);
  }

  useEffect(() => {
    if (existing !== null) forgetMissingConnections(queryClient, existing);
  }, [existing, queryClient]);

  // As abas que saíram (fechadas, ou podadas com a conexão excluída) soltam o que executavam: a
  // resposta que ainda chegar não reabre sessão nem avisa nada.
  useEffect(() => {
    for (const [tabId, runner] of runners) {
      if (tabs.some((tab) => tab.id === tabId)) continue;
      runner.retire();
      runners.delete(tabId);
    }
  }, [tabs, runners]);

  // A aba que sai (fechada, ou podada com a conexão excluída) leva o que a tela dela lembrava: o filtro, a ordem, a divisão, o zoom (`tab-memory.ts`, por id de
  // aba), e o filtro que uma chave estrangeira tinha pedido à tabela dela e que ainda esperava (`filter-handoff.ts`): reabrir a mesma tabela não leva o filtro
  // velho. O bloqueio por inatividade não tira aba nenhuma, então não apaga nada: o filtro sobrevive a ele (RN-SEG-001).
  useEffect(() => {
    forgetExcept(new Set(tabs.map((tab) => tab.id)));
    unsavedEdits.forgetExcept(new Set(tabs.map((tab) => tab.id)));
    filterHandoff.forgetExcept(tabs.flatMap((tab) => (tab.table && tab.connectionId !== null ? [{ connectionId: tab.connectionId, table: { ...inDatabase(tab.database), ...tab.table } }] : [])));
  }, [tabs]);

  // O filtro pedido que ninguém levou a tempo (a aba da tabela estava ocupada, ou a conexão desconectada) não some calado.
  useEffect(() => filterHandoff.onExpired((table) => toast.warning(workbenchCopy.toasts.filterNotApplied(`${table.schema}.${table.name}`))), [toast]);

  // Sair do cofre desmonta o provedor: a API fecha as sessões (RN-SESSAO-004) e nenhuma aba espera mais resposta. O que as abas lembravam (o texto dos filtros,
  // entre o resto) e os filtros pedidos que ainda esperavam saem junto: são de módulo, e ficariam na memória até o próximo usuário abrir a área de trabalho. O
  // bloqueio por inatividade não passa por aqui (não desmonta nada): o filtro sobrevive a ele.
  useEffect(() => {
    return () => {
      for (const runner of runners.values()) runner.retire();
      forgetExcept(new Set());
      unsavedEdits.forgetExcept(new Set());
      filterHandoff.forgetExcept([]);
    };
  }, [runners]);

  const disconnectMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      // As sessões da árvore são uma por banco aberto da conexão (RN-ARVORE-006): a do banco da conexão e a de cada outro banco que se abriu.
      const treeSessions = treeSessionIds(queryClient, connectionId);
      // As abas soltam a sessão antes de ela fechar: o comando que rodava não a reabre ao saber que ela sumiu.
      // Se o fechamento falhar, a aba já a soltou: a segunda tentativa usa a cópia que ficou em `tab.sessionId`.
      const released = tabs
        .filter((tab) => tab.connectionId === connectionId)
        .map((tab): Released => {
          const fromRunner = runners.get(tab.id)?.release();
          return { sessionId: fromRunner?.sessionId ?? tab.sessionId, busy: fromRunner?.busy ?? false };
        });
      await Promise.all([...treeSessions.map((sessionId): Released => ({ sessionId, busy: false })), ...released].map(endSession));
    },
    onSuccess: (_result, connectionId) => {
      // Primeiro recolhe, depois esquece: com o nó ainda aberto a consulta removida seria refeita e abriria outra sessão.
      setExpanded((current) => new Set([...current].filter((key) => !isOfConnection(key, connectionId))));
      setTabs((current) => current.map((tab) => (tab.connectionId === connectionId ? { ...tab, sessionId: null } : tab)));
      queryClient.removeQueries({ queryKey: databaseSessionKey(connectionId) });
      queryClient.removeQueries({ queryKey: ["tree", connectionId] });
      toast.success(workbenchCopy.toasts.disconnected);
    },
  });

  // O texto que chega do editor recalcula o ponto da aba de um script (RN-SCRIPT-001): desfazer até o texto salvo o apaga.
  const updateTab = useCallback(
    (tabId: string, patch: Partial<Pick<QueryTab, "sessionId" | "sql">>) =>
      setTabs((current) => current.map((tab) => (tab.id !== tabId ? tab : patch.sql === undefined ? { ...tab, ...patch } : withEditedSql({ ...tab, ...patch }, patch.sql)))),
    [],
  );

  // A cada tecla, e sem atraso: só a primeira depois de salvar muda a lista de abas. As outras devolvem a MESMA lista, e o React não redesenha nada. A tecla
  // também avisa o relato das abas (RN-ABAS-006): o texto da aba chega com atraso, e digitar sem parar não pode adiar a gravação.
  const markScriptEdited = useCallback(
    (tabId: string) => {
      reporter.touch();
      setTabs((current) => {
        const tab = current.find((candidate) => candidate.id === tabId);
        if (tab?.script === undefined || tab.script.dirty) return current;
        return current.map((candidate) => (candidate === tab && candidate.script !== undefined ? { ...candidate, script: { ...candidate.script, dirty: true } } : candidate));
      });
    },
    [reporter],
  );

  // O ponto é recalculado contra o que acabou de ser salvo: o banco pode ter mudado enquanto a gravação ia (RN-ARVORE-007).
  const setTabScript = useCallback(
    (tabId: string, saved: { id: string; name: string }, savedSql: string, savedDatabase: string | undefined) =>
      setTabs((current) =>
        current.map((tab) => {
          if (tab.id !== tabId) return tab;
          const script: ScriptRef = { id: saved.id, name: saved.name, savedSql, ...(savedDatabase === undefined ? {} : { savedDatabase }), dirty: tab.database !== savedDatabase };
          return { ...tab, title: saved.name, script };
        }),
      ),
    [],
  );

  const renameScript = useCallback((scriptId: string, name: string) => setTabs((current) => (current.some((tab) => tab.script?.id === scriptId) ? current.map((tab) => (tab.script?.id === scriptId ? { ...tab, title: name, script: { ...tab.script, name } } : tab)) : current)), []);

  const forgetScript = useCallback(
    (scriptId: string) =>
      setTabs((current) =>
        current.some((tab) => tab.script?.id === scriptId)
          ? current.map((tab) => {
              if (tab.script?.id !== scriptId) return tab;
              const rest = { ...tab };
              delete rest.script;
              return rest;
            })
          : current,
      ),
    [],
  );

  // A sessão é de quem executa; a aba só guarda uma cópia dela, para a tela dizer que a conexão está conectada.
  const createRunner = useCallback(
    (tab: Pick<QueryTab, "id" | "connectionId" | "database">, initial?: Parameters<typeof createQueryRunner>[0]["initial"]) =>
      createQueryRunner({ connectionId: tab.connectionId, database: tab.database, queryClient, toast, onSession: (sessionId) => updateTab(tab.id, { sessionId }), initial }),
    [queryClient, toast, updateTab],
  );

  const addTab = useCallback(
    (tab: QueryTab) => {
      runners.set(tab.id, createRunner(tab));
      setTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
    },
    [createRunner, runners],
  );

  // O que o bloqueio por inatividade (RN-SEG-001, `VaultLock`) pede à área de trabalho: "há comando em andamento?" (o tempo não conta enquanto
  // há) e "solta o que dependia do cofre" (`discardForLock`: as abas, o texto de SQL, a aba ativa e os nós abertos da árvore FICAM). Quem chama
  // arma a espera dos pedidos ANTES: um pedido nascido destas mudanças não pode chegar à API com o cofre ainda aberto. A montagem e o porquê
  // estão em `createLockHandles`, em `workbench-lock.ts`.
  const { isBusy, discard } = createLockHandles({ runners, tabs, createRunner, setTabs, queryClient });

  const openQueryTab = useCallback(
    (connectionId: string, sql = "", database?: string) => addTab({ id: crypto.randomUUID(), title: `consulta-${nextNumber.current++}.sql`, connectionId, ...inDatabase(database), sessionId: null, sql }),
    [addTab],
  );

  const openScriptTab = useCallback(
    (script: Script, place: { connectionId: string | null; database?: string }) => {
      const open = tabs.find((tab) => tab.script?.id === script.id);
      if (open !== undefined) return setActiveTabId(open.id);

      const ref: ScriptRef = { id: script.id, name: script.name, savedSql: script.sql, ...(place.database === undefined ? {} : { savedDatabase: place.database }), dirty: false };
      addTab({ id: crypto.randomUUID(), title: script.name, connectionId: place.connectionId, ...inDatabase(place.database), sessionId: null, sql: script.sql, script: ref });
    },
    [tabs, addTab],
  );

  // A aba sem conexão não abriu sessão nenhuma (o executor dela não executa): o executor novo é o da conexão escolhida, no banco da conexão.
  const assignConnection = useCallback(
    (tabId: string, connectionId: string) => {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      if (tab === undefined || tab.connectionId !== null) return;

      runners.get(tabId)?.retire();
      runners.set(tabId, createRunner({ id: tabId, connectionId }));
      setTabs((current) => current.map((candidate) => (candidate.id === tabId ? { ...candidate, connectionId, database: undefined, sessionId: null } : candidate)));
    },
    [tabs, runners, createRunner],
  );

  // O que uma aba soltou fecha na API em segundo plano (cancela o que rodava e fecha a sessão, RN-SESSAO-004), pelo cache de mutações sem ficar nele; a falha
  // já foi ao aviso central. A janela que fecha espera por estes fechamentos (`closing`).
  const endInBackground = useCallback(
    (released: Released) => {
      const ending = throughMutationCache(queryClient, () => endSession(released)).catch(() => undefined);
      closing.add(ending);
      void ending.finally(() => closing.delete(ending));
    },
    [queryClient, closing],
  );

  const switchDatabase = useCallback(
    (tabId: string, database: string | undefined) => {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      const runner = runners.get(tabId);
      if (tab === undefined || (runner !== undefined && isBusyState(runner.getState()))) return;
      // O texto do editor deste instante: o da aba chega com atraso, e o ponto de um script é recalculado por ele.
      const sql = liveEditors.snapshot(tabId)?.sql;
      const next = withDatabase(tab, database, sql);
      if (next === null) return;

      // O executor de antes sai de cena primeiro: o resultado na tela é do banco anterior, e nada do que estava a caminho chega ao executor novo.
      const released = runner?.retire();
      runners.set(tabId, createRunner(next));
      setTabs((current) => current.map((candidate) => (candidate.id === tabId ? (withDatabase(candidate, database, sql) ?? candidate) : candidate)));
      if (released) endInBackground(released);
    },
    [tabs, runners, createRunner, endInBackground],
  );

  const setTableView = useCallback((tabId: string, view: TableView) => setTabs((current) => current.map((tab) => (tab.id === tabId && tab.table ? { ...tab, table: { ...tab.table, view } } : tab))), []);

  const openTableTab = useCallback(
    (connectionId: string, { schema, name, view, database }: { schema: string; name: string; view?: TableView; database?: string }) => {
      // Uma aba por tabela: abrir de novo volta para ela, e só troca a vista se uma foi pedida. A mesma tabela em outro banco do servidor é outra aba, com o banco no título.
      const open = tabs.find((tab) => tab.connectionId === connectionId && tab.database === database && tab.table?.schema === schema && tab.table.name === name);
      if (open === undefined) return addTab({ id: crypto.randomUUID(), title: database === undefined ? `${schema}.${name}` : `${database}.${schema}.${name}`, connectionId, ...inDatabase(database), sessionId: null, sql: "", table: { schema, name, view: view ?? "data" } });

      if (view !== undefined) setTableView(open.id, view);
      setActiveTabId(open.id);
    },
    [tabs, addTab, setTableView],
  );

  const runnerOf = useCallback(
    (tabId: string) => {
      const runner = runners.get(tabId);
      if (runner === undefined) throw new Error(`A aba ${tabId} não existe.`);
      return runner;
    },
    [runners],
  );

  /**
   * RN-ABAS-002 e 003: chegou uma aba de outra janela (o processo principal a entrega quando esta área de trabalho está montada). Ela nasce como
   * estava lá: o que a tela dela lembrava vai antes para a memória (os painéis a leem ao montar), e o executor nasce com o resultado e a sessão.
   * Nada é executado. Uma aba que já está aqui (o mesmo id) não entra duas vezes.
   */
  const adoptTab = useCallback(
    (raw: unknown, index?: number) => {
      const adopted = readTransfer(raw);
      if (adopted === null) return;

      const { tab, selection, state, memory } = adopted;
      if (runners.has(tab.id)) return;

      rememberTransferred(tab.id, selection === null ? memory : { ...memory, selection });
      runners.set(tab.id, createRunner(tab, { state, sessionId: tab.sessionId }));
      setTabs((current) => {
        const at = index === undefined ? current.length : Math.min(index, current.length);
        return [...current.slice(0, at), tab, ...current.slice(at)];
      });
      setActiveTabId(tab.id);
      // O nome da próxima consulta desta janela não repete o da aba que chegou.
      const numbered = /^consulta-(\d+)\.sql$/.exec(tab.title);
      if (numbered !== null) nextNumber.current = Math.max(nextNumber.current, Number(numbered[1]) + 1);
    },
    [createRunner, runners],
  );

  // RN-ABAS-005: esta área de trabalho está montada (o cofre aberto) e pronta para receber abas; ao desmontar (sair do cofre), deixa de estar, e o
  // processo principal guarda o que chegar até ela voltar.
  useEffect(() => {
    const stop = onTabArrived((delivery) => adoptTab(delivery.transfer, delivery.index));
    tellWindows((windows) => windows.setReady(true));
    return () => {
      stop();
      tellWindows((windows) => windows.setReady(false));
    };
  }, [adoptTab]);

  // O resumo desta janela, para "Mover para a janela…" das outras dizer qual é qual (RN-ABAS-003).
  const activeTitle = tabs.find((tab) => tab.id === activeTabId)?.title ?? null;
  useEffect(() => tellWindows((windows) => windows.describe({ activeTitle, tabCount: tabs.length })), [activeTitle, tabs.length]);

  const reorderTab = useCallback((tabId: string, insertAt: number) => setTabs((current) => moveTab(current, tabId, insertAt) ?? current), []);
  const shiftTabBy = useCallback((tabId: string, delta: -1 | 1) => setTabs((current) => shiftTab(current, tabId, delta) ?? current), []);

  const detachTab = useCallback(
    (tabId: string) => {
      const remaining = tabs.filter((tab) => tab.id !== tabId);
      if (remaining.length === tabs.length) return;

      setTabs(remaining);
      setActiveTabId(nextActiveTab(tabs, activeTabId, remaining));
      // Só o executor sai de cena: a sessão, com o cursor aberto, é da janela que recebeu a aba.
      runners.get(tabId)?.retire();
      runners.delete(tabId);
    },
    [tabs, activeTabId, runners],
  );

  const releaseWindow = useCallback(async () => {
    await Promise.allSettled([...closing]);
    const treeSessions = queryClient.getQueriesData<DatabaseSession>({ queryKey: ["database-session"] }).flatMap(([, session]) => (session === undefined ? [] : [session.id]));
    await Promise.allSettled(treeSessions.map((sessionId) => throughMutationCache(queryClient, () => endSession({ sessionId, busy: false }))));
  }, [closing, queryClient]);

  const closeTab = useCallback(
    (tabId: string) => {
      const index = tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return;

      // RN-ABAS-006: fechar uma aba a tira do que volta, e a gravação é na hora.
      urgentReport.current = true;
      const remaining = tabs.filter((tab) => tab.id !== tabId);
      setTabs(remaining);
      // Fechou a ativa: passa para a vizinha da direita, ou da esquerda se era a última.
      setActiveTabId(nextActiveTab(tabs, activeTabId, remaining));
      // Fechar a aba cancela o que estiver rodando e fecha a sessão dela (RN-SESSAO-004).
      const released = runners.get(tabId)?.retire();
      if (released) endInBackground(released);
    },
    [tabs, activeTabId, runners, endInBackground],
  );

  /**
   * RN-ABAS-006: na entrada, a janela principal reabre as abas gravadas (as de todas as janelas, na ordem em que estavam), desconectadas: nada conecta nem
   * executa. Precisa das conexões (a aba cuja conexão foi excluída volta sem ela) e dos scripts (a aba de um script volta com o nome dele, e a de um script
   * excluído volta como consulta comum); o texto salvo de um script só é lido para a aba que tinha mudança não salva. Uma falha em qualquer leitura não reabre
   * nada e não grava nada nesta entrada: gravar sem ter reaberto apagaria o que ainda não voltou.
   */
  const restoreSaved = useEffectEvent(async (isCancelled: () => boolean): Promise<boolean> => {
    const saved = await getWorkspace();
    if (!saved.ok) {
      console.error("[prism] abas: as abas gravadas não puderam ser lidas:", saved.error.code);
      return false;
    }
    if (saved.data.tabs.length === 0) return true;

    try {
      const [connectionList, scriptList] = await Promise.all([queryClient.fetchQuery(connectionsQuery), queryClient.fetchQuery(scriptsQuery)]);
      const known = new Set(scriptList.map((script) => script.id));
      const toRead = [...new Set(saved.data.tabs.flatMap((tab) => (tab.kind === "query" && tab.dirty && tab.scriptID !== null && known.has(tab.scriptID) ? [tab.scriptID] : [])))];
      const read = new Map((await Promise.all(toRead.map(async (id) => [id, await getScript(id)] as const))).flatMap(([id, result]) => (result.ok ? [[id, result.data.sql] as const] : [])));
      if (isCancelled()) return false;

      const restored = restoreWorkspace(saved.data, {
        connections: new Set(connectionList.map((connection) => connection.id)),
        scripts: new Map(scriptList.map((script) => [script.id, { name: script.name, sql: read.get(script.id) ?? null, database: script.database }])),
        newId: () => crypto.randomUUID(),
        nextNumber: () => nextNumber.current++,
      });

      for (const tab of restored.tabs) runners.set(tab.id, createRunner(tab));
      setTabs((current) => [...restored.tabs, ...current]);
      setActiveTabId((current) => restored.activeTabId ?? current);
      setRestoredTableConnections(restored.tableConnections);
      for (const title of restored.emptied) toast.warning(workbenchCopy.toasts.restoredEmpty(title));
      if (restored.withoutConnection > 0) toast.warning(workbenchCopy.toasts.restoredWithoutConnection(restored.withoutConnection));
      if (restored.droppedTables > 0) toast.warning(workbenchCopy.toasts.restoredTablesDropped(restored.droppedTables));
      return true;
    } catch (error) {
      console.error("[prism] abas: as abas gravadas não puderam ser reabertas:", error);
      return false;
    }
  });

  // RN-ABAS-006: a área de trabalho montou (o cofre abriu). A janela principal reabre as abas gravadas e só então começa a contar as suas; as outras contam
  // desde já. Ao desmontar (saiu do cofre), as abas desta janela deixam de contar. O bloqueio por inatividade não desmonta nada: as abas continuam contando.
  useEffect(() => {
    let cancelled = false;
    const unregister = workspaceSync.register(() => reporter.urgent());
    void (async () => {
      const restores = await claimWorkspaceRestore();
      if (cancelled) return;
      if (restores && !(await restoreSaved(() => cancelled))) return;
      if (!cancelled) setReporting(true);
    })();

    return () => {
      cancelled = true;
      unregister();
      reporter.stop();
      withdrawWorkspace();
    };
  }, [reporter]);

  // O estado deste instante, para o relato: a fonte se atualiza a cada renderização, antes do efeito que conta.
  useEffect(() => source.update(tabs, activeTabId));

  useEffect(() => {
    if (reporting) reporter.start();
  }, [reporting, reporter]);

  useEffect(() => {
    if (!urgentReport.current) return reporter.touch();
    urgentReport.current = false;
    reporter.urgent();
  }, [tabs, activeTabId, reporter]);

  const holdForWindowClose = useCallback(() => {
    source.hold();
    reporter.urgent();
  }, [source, reporter]);

  const releaseWindowClose = useCallback(() => {
    source.release();
    reporter.urgent();
  }, [source, reporter]);

  const setNodeOpen = useCallback((key: string, open: boolean) => setExpanded((current) => (current.has(key) === open ? current : new Set(open ? [...current, key] : [...current].filter((other) => other !== key)))), []);

  const disconnecting = disconnectMutation.isPending ? disconnectMutation.variables : null;
  const { mutate: disconnect } = disconnectMutation;

  const value = useMemo<WorkbenchState>(
    () => ({ tabs, activeTabId, openQueryTab, openTableTab, openScriptTab, setTableView, closeTab, setActiveTab: setActiveTabId, reorderTab, shiftTab: shiftTabBy, detachTab, releaseWindow, updateTab, setTabScript, markScriptEdited, renameScript, forgetScript, assignConnection, switchDatabase, runnerOf, expanded, setNodeOpen, disconnect, disconnecting, restoredTableConnections, holdForWindowClose, releaseWindowClose }),
    [tabs, activeTabId, openQueryTab, openTableTab, openScriptTab, setTableView, closeTab, reorderTab, shiftTabBy, detachTab, releaseWindow, updateTab, setTabScript, markScriptEdited, renameScript, forgetScript, assignConnection, switchDatabase, runnerOf, expanded, setNodeOpen, disconnect, disconnecting, restoredTableConnections, holdForWindowClose, releaseWindowClose],
  );

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
      <VaultLock isBusy={isBusy} discard={discard} />
    </WorkbenchContext.Provider>
  );
}

export function useWorkbench(): WorkbenchState {
  const context = useContext(WorkbenchContext);
  if (context === null) throw new Error("useWorkbench precisa de um <WorkbenchProvider> acima na árvore.");
  return context;
}

/** O texto do editor da aba agora (`liveEditors`): a cópia da aba chega com atraso. */
const liveSql: LiveSql = (tabId) => liveEditors.snapshot(tabId)?.sql ?? null;

/** As chaves abertas são sempre de nós que abrem e não de pastas (`setNodeOpen` só recebe essas). */
function isOfConnection(key: string, connectionId: string): boolean {
  const path = parseNavKey(key);
  return path.type !== "folder" && path.connectionId === connectionId;
}
