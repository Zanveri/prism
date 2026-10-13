import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { VaultLock } from "@/app/_components/vault-lock";
import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { useToast } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { allowRefusal } from "@/lib/api/prism-api";

import { closeDatabaseSession, databaseSessionKey, treeSessionIds } from "./database-sessions.service";
import { filterHandoff } from "./filter-handoff";
import { inDatabase, parseNavKey } from "./navigator-model";
import { cancelQuery } from "./query.service";
import { forgetExcept } from "./tab-memory";
import { createQueryRunner, type QueryRunner } from "./use-query-runner";
import { createLockHandles } from "./workbench-lock";
import { forgetMissingConnections, nextActiveTab, pruneWorkbench, type QueryTab, type TableView } from "./workbench-model";
import { workbenchCopy } from "./workbench.copy";

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
  /** O editor grava aqui o texto da aba, com atraso (não a cada tecla); a sessão, quem grava é o que a aba executa. */
  updateTab: (tabId: string, patch: Partial<Pick<QueryTab, "sessionId" | "sql">>) => void;
  /** O que a aba executa e mostra: a sessão dela, o comando em andamento e o resultado (`use-query-runner.ts`). */
  runnerOf: (tabId: string) => QueryRunner;

  /** As chaves (`navKey`) dos nós da árvore que estão abertos, sem as pastas, que são só da tela do navegador. */
  expanded: ReadonlySet<string>;
  setNodeOpen: (key: string, open: boolean) => void;
  /** Fecha as sessões da árvore (a de cada banco aberto, RN-ARVORE-006) e as das abas da conexão, e recolhe o que estava aberto nela (RN-SESSAO-004). */
  disconnect: (connectionId: string) => void;
  /** A conexão que está sendo desconectada agora, se alguma. */
  disconnecting: string | null;
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
    filterHandoff.forgetExcept(tabs.flatMap((tab) => (tab.table ? [{ connectionId: tab.connectionId, table: { ...inDatabase(tab.database), ...tab.table } }] : [])));
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

  const updateTab = useCallback((tabId: string, patch: Partial<Pick<QueryTab, "sessionId" | "sql">>) => setTabs((current) => current.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab))), []);

  // A sessão é de quem executa; a aba só guarda uma cópia dela, para a tela dizer que a conexão está conectada.
  const createRunner = useCallback(
    (tab: Pick<QueryTab, "id" | "connectionId" | "database">) => createQueryRunner({ connectionId: tab.connectionId, database: tab.database, queryClient, toast, onSession: (sessionId) => updateTab(tab.id, { sessionId }) }),
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

  const closeTab = useCallback(
    (tabId: string) => {
      const index = tabs.findIndex((tab) => tab.id === tabId);
      if (index < 0) return;

      const remaining = tabs.filter((tab) => tab.id !== tabId);
      setTabs(remaining);
      // Fechou a ativa: passa para a vizinha da direita, ou da esquerda se era a última.
      setActiveTabId(nextActiveTab(tabs, activeTabId, remaining));
      // Fechar a aba cancela o que estiver rodando e fecha a sessão dela (RN-SESSAO-004). Como as
      // chamadas da aba, passa pelo cache de mutações sem ficar nele; a falha já foi ao aviso central.
      const released = runners.get(tabId)?.retire();
      if (released) void throughMutationCache(queryClient, () => endSession(released)).catch(() => undefined);
    },
    [tabs, activeTabId, queryClient, runners],
  );

  const setNodeOpen = useCallback((key: string, open: boolean) => setExpanded((current) => (current.has(key) === open ? current : new Set(open ? [...current, key] : [...current].filter((other) => other !== key)))), []);

  const disconnecting = disconnectMutation.isPending ? disconnectMutation.variables : null;
  const { mutate: disconnect } = disconnectMutation;

  const value = useMemo<WorkbenchState>(
    () => ({ tabs, activeTabId, openQueryTab, openTableTab, setTableView, closeTab, setActiveTab: setActiveTabId, updateTab, runnerOf, expanded, setNodeOpen, disconnect, disconnecting }),
    [tabs, activeTabId, openQueryTab, openTableTab, setTableView, closeTab, updateTab, runnerOf, expanded, setNodeOpen, disconnect, disconnecting],
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

/** As chaves abertas são sempre de nós que abrem e não de pastas (`setNodeOpen` só recebe essas). */
function isOfConnection(key: string, connectionId: string): boolean {
  const path = parseNavKey(key);
  return path.type !== "folder" && path.connectionId === connectionId;
}
