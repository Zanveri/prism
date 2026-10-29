import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { VaultLock } from "@/app/_components/vault-lock";
import { connectionsQuery } from "@/app/connections/_lib/connections.service";
import { defaultPreferences, preferencesStore } from "@/app/settings/_lib/preferences";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { useToast } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { claimWorkspaceRestore, onTabArrived, reportWorkspace, tellWindows, withdrawWorkspace } from "@/lib/api/bridge";
import { allowRefusal } from "@/lib/api/prism-api";
import { workspaceSync } from "@/lib/api/workspace-sync";

import type { DatabaseSession } from "./database-sessions.schema";
import { closeDatabaseSession, databaseSessionKey, treeSessionIds } from "./database-sessions.service";
import { filterHandoff } from "./filter-handoff";
import { createDisconnectLog, type DisconnectLog } from "./connection-intent";
import { liveEditors } from "./live-editors";
import { inDatabase, parseNavKey } from "./navigator-model";
import { isScriptDirty, withEditedSql, withSavedPlace, type SavedPlace, type ScriptRef } from "./saved-scripts";
import { createWorkspaceSource, restoreWorkspace, type LiveSql } from "./saved-workspace";
import type { Script } from "./scripts.schema";
import { getScript, scriptsQuery } from "./scripts.service";
import { cancelQuery } from "./query.service";
import { focusedElement, tabFocus } from "./tab-focus";
import { forgetExcept, rememberTransferred } from "./tab-memory";
import { moveTab, shiftTab } from "./tab-order";
import { withConnection } from "./tab-connection";
import { withDatabase } from "./tab-database";
import { newTabPlace, placeOf, withResultPlace } from "./result-place";
import { readTransfer } from "./tab-transfer";
import { normalizeIsolationLevel } from "./transaction";
import { unsavedEdits } from "./unsaved-edits";
import { createQueryRunner, isPersonBusy, type QueryRunner } from "./use-query-runner";
import { connectExports, exportTracker } from "./data-export/data-exports";
import { connectLoads, loadTracker } from "./data-import/data-imports";
import { createLockHandles } from "./workbench-lock";
import { forgetMissingConnections, nextActiveTab, pruneWorkbench, type DatabaseView, type QueryTab, type ResultPlace, type SchemaView, type TableView } from "./workbench-model";
import { resultPlaceCopy } from "./result-place.copy";
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
  /** Abre a aba de um esquema, ou volta para a que já está aberta; com `view`, já na vista pedida (RN-ESQUEMA-001); com `database`, o esquema é desse outro banco do servidor. */
  openSchemaTab: (connectionId: string, target: { schema: string; view?: SchemaView; database?: string }) => void;
  setSchemaView: (tabId: string, view: SchemaView) => void;
  /** Abre a aba de um banco, ou volta para a que já está aberta; com `view`, já na vista pedida (RN-BANCO-001). */
  openDatabaseTab: (connectionId: string, target: { name: string; view?: DatabaseView; database?: string }) => void;
  setDatabaseView: (tabId: string, view: DatabaseView) => void;
  /** Fecha a aba e a sessão dela (RN-SESSAO-004). */
  closeTab: (tabId: string) => void;
  /** A aba fica ativa, na vista da consulta (a aba do resultado dela, se tem, deixa de ser a ativa). */
  setActiveTab: (tabId: string) => void;
  /**
   * RN-ABAS-012: a aba do resultado da aba ativa é a entrada ativa da faixa. Ela não é uma aba da lista: `activeTabId` continua sendo o da aba dela (a
   * barra de status, a conexão da aba, a ativa gravada), e só o painel que aparece muda. Falso quando o resultado da aba ativa não está numa aba.
   */
  resultActive: boolean;
  /** A aba fica ativa na vista pedida: a da consulta, ou a aba do resultado dela (só quando o resultado está numa aba). */
  showEntry: (tabId: string, view: "query" | "result") => void;
  /**
   * RN-ABAS-011 e 014: troca o lugar do resultado da aba de consulta (no painel, numa aba ou numa janela) sem executar nada: o executor, a sessão, o cursor e
   * as pendências são os mesmos. Com o resultado saindo da aba, a aba do resultado deixa de ser a ativa, e a da consulta fica no lugar dela.
   */
  setResultPlace: (tabId: string, place: ResultPlace) => void;
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
   * RN-SCRIPT-003: abre o script numa aba de consulta, na conexão e no banco dados (`connectionId` nulo: a conexão dele não existe mais, ou o script é genérico
   * e não há uma só conectada, e a aba pede uma), com o lugar salvo que a aba guarda (`saved`, `scriptPlace`). O script que já tem aba volta para ela: uma aba
   * por script. `askedFrom`: quem tinha o foco quando a pessoa pediu o script (RN-ABAS-019), lido ANTES de a API devolver o texto: se o foco saiu dele durante a
   * espera, a aba não o rouba. Sem ele, vale quem tem o foco quando a aba aparece.
   */
  openScriptTab: (script: Script, place: { connectionId: string | null; database?: string; saved: SavedPlace }, askedFrom?: Element | null) => void;
  /**
   * RN-SCRIPT-001: a aba foi salva como o script dado, com este texto e neste lugar (a conexão e o banco da aba, ou o genérico, RN-SCRIPT-005). O ponto é
   * refeito pelo texto do editor deste instante e pelo lugar da aba: o que mudou enquanto a gravação ia continua marcado.
   */
  setTabScript: (tabId: string, script: { id: string; name: string; folderId?: string }, savedSql: string, saved: SavedPlace) => void;
  /** RN-SCRIPT-005: o menu do script o tornou genérico ou o vinculou à conexão da aba; as abas dele guardam o lugar novo e refazem o ponto. */
  setScriptPlace: (scriptId: string, saved: SavedPlace) => void;
  /** RN-SCRIPT-001: o texto do editor mudou, sem atraso: o ponto da aba de um script acende na hora (só a primeira tecla muda o estado). */
  markScriptEdited: (tabId: string) => void;
  /** RN-SCRIPT-003: o script mudou de nome no navegador; as abas dele mudam de título. */
  renameScript: (scriptId: string, name: string) => void;
  /** RN-SCRIPT-003: o script foi excluído; as abas dele continuam, com o texto, como consultas sem script. */
  forgetScript: (scriptId: string) => void;
  /**
   * RN-ARVORE-008: a aba de consulta passa a outra conexão, no banco padrão dela, sem executar nada. Ganha um executor novo nessa conexão, que abre a sessão
   * na próxima execução; o de antes sai de cena com o resultado, e a sessão dele fecha. O texto fica. A aba sem conexão (RN-SCRIPT-003 e 005) recebe a
   * escolhida pelo mesmo caminho. Com comando em andamento não troca (a lista não oferece).
   */
  switchConnection: (tabId: string, connectionId: string) => void;
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
   * Quem a pessoa desconectou (RN-SESSAO-004), e as conexões das abas de tabela que voltaram na entrada (RN-ABAS-006), que voltam desconectadas: as vistas delas
   * esperam o clique para conectar. É do provedor, e não da área das abas, porque a restauração marca as conexões ANTES de as abas existirem (`restoreSaved`).
   */
  disconnectLog: DisconnectLog;
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
  // RN-ABAS-012: a aba (de consulta) cuja aba do resultado é a entrada ativa da faixa. Vale só enquanto ela é a ativa e o resultado dela está numa aba: outra
  // aba ativa (o clique, a aba nova, a que fechou) a desfaz, num ajuste durante a renderização, e voltar àquela aba volta à consulta.
  const [resultTabId, setResultTabId] = useState<string | null>(null);
  if (resultTabId !== null && resultTabId !== activeTabId) setResultTabId(null);
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
  const [disconnectLog] = useState(() => createDisconnectLog(queryClient));
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

  // RN-EXPORT-016 e 021: as exportações desta janela avisam pelos avisos do app; as da página de antes (que caiu ou recarregou) são canceladas; e sair do
  // cofre (o provedor desmonta) as esquece e solta os destinos.
  useEffect(() => connectExports(toast, [loadTracker]), [toast]);
  // RN-IMPORT-019 e 020: as importações e as cópias desta janela avisam pelos avisos do app, e o "Abrir registros" abre a aba da tabela aqui; sair do cofre
  // fecha o assistente (solta o arquivo) e as esquece.
  const openRecordsRef = useRef<(table: { connectionId: string; database?: string; schema: string; name: string }) => void>(() => {});
  useEffect(() => connectLoads(toast, (table) => openRecordsRef.current(table), queryClient), [toast, queryClient]);

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

  // O ponto é recalculado contra o que acabou de ser salvo, pelo texto do editor deste instante e pelo lugar da aba: o texto, a conexão (RN-ARVORE-008) ou o
  // banco (RN-ARVORE-007) podem ter mudado enquanto a gravação ia.
  const setTabScript = useCallback(
    (tabId: string, saved: { id: string; name: string; folderId?: string }, savedSql: string, place: SavedPlace) =>
      setTabs((current) =>
        current.map((tab) => {
          if (tab.id !== tabId) return tab;
          // RN-SCRIPT-010: a aba lembra a pasta em que gravou o script, sem gravá-la no cofre.
          const script: Omit<ScriptRef, "dirty"> = { id: saved.id, name: saved.name, savedSql, ...place, ...(saved.folderId === undefined ? {} : { folderId: saved.folderId }) };
          return { ...tab, title: saved.name, script: { ...script, dirty: isScriptDirty(script, liveSql(tab.id) ?? tab.sql, tab) } };
        }),
      ),
    [],
  );

  const setScriptPlace = useCallback(
    (scriptId: string, saved: SavedPlace) =>
      setTabs((current) => (current.some((tab) => tab.script?.id === scriptId) ? current.map((tab) => (tab.script?.id === scriptId ? withSavedPlace(tab, saved, liveSql(tab.id) ?? tab.sql) : tab)) : current)),
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

  // O nome de cada aba agora, que o executor lê no fim de um script (RN-SQL-020): a aba pode ter sido renomeada, ou salva como script, depois de ele
  // nascer. Criado uma vez e nunca trocado, por `useState`, como `runners`: `createRunner` vai a `createLockHandles` durante a renderização, e o lint do
  // React não deixa uma ref ir junto.
  const [titles] = useState(() => new Map<string, string>());
  useEffect(() => {
    titles.clear();
    for (const tab of tabs) titles.set(tab.id, tab.title);
  });

  // A sessão é de quem executa; a aba só guarda uma cópia dela, para a tela dizer que a conexão está conectada.
  const createRunner = useCallback(
    (tab: Pick<QueryTab, "id" | "connectionId" | "database">, initial?: Parameters<typeof createQueryRunner>[0]["initial"]) =>
      createQueryRunner({
        connectionId: tab.connectionId,
        database: tab.database,
        queryClient,
        toast,
        onSession: (sessionId) => updateTab(tab.id, { sessionId }),
        initial: {
          ...initial,
          transaction: initial?.transaction ?? defaultTabTransaction(queryClient, tab.connectionId),
        },
        title: () => titles.get(tab.id) ?? null,
      }),
    [queryClient, toast, updateTab, titles],
  );

  // RN-ABAS-019: a aba aberta por um gesto leva o foco, quando aparece, à entrada dela (o editor, o filtro dos Registros). O pedido leva quem tinha o foco agora:
  // a área das abas só o atende se ele ainda estiver lá, ou perdido, quando a aba aparecer. Nada escreve no DOM aqui: é um pedido, e quem foca é um efeito.
  const askFocus = useCallback((tabId: string, from?: Element | null) => tabFocus.request(tabId, from === undefined ? focusedElement() : from), []);

  const addTab = useCallback(
    (tab: QueryTab, askedFrom?: Element | null) => {
      runners.set(tab.id, createRunner(tab));
      setTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
      askFocus(tab.id, askedFrom);
    },
    [createRunner, runners, askFocus],
  );

  // O que o bloqueio por inatividade (RN-SEG-001, `VaultLock`) pede à área de trabalho: "há comando em andamento?" (o tempo não conta enquanto
  // há) e "solta o que dependia do cofre" (`discardForLock`: as abas, o texto de SQL, a aba ativa e os nós abertos da árvore FICAM). Quem chama
  // arma a espera dos pedidos ANTES: um pedido nascido destas mudanças não pode chegar à API com o cofre ainda aberto. A montagem e o porquê
  // estão em `createLockHandles`, em `workbench-lock.ts`.
  const lockHandles = createLockHandles({ runners, tabs, createRunner, setTabs, queryClient });
  // RN-SEG-001 e RN-EXPORT-023: a exportação de dados em andamento é comando em andamento desta janela, do começo até a entrega; a entrega que falhou não
  // segura, e o bloqueio a descarta (a API fecha o cofre e esquece os trabalhos; a tela solta os destinos).
  // RN-IMPORT-021: a importação e a cópia também, do começo ao fim lido; a entrada da falha não segura, e o bloqueio a descarta.
  const isBusy = () => lockHandles.isBusy() || exportTracker.holdsLock() || loadTracker.holdsLock();
  const discard = () => {
    lockHandles.discard();
    void exportTracker.vaultClosed();
    loadTracker.vaultClosed();
  };

  // RN-ABAS-016 e RN-CONFIG-010: a aba de consulta nova nasce no lugar da preferência, lida na hora (mudar a preferência não muda as abas abertas).
  const openQueryTab = useCallback(
    (connectionId: string, sql = "", database?: string) =>
      addTab({ id: crypto.randomUUID(), title: `consulta-${nextNumber.current++}.sql`, connectionId, ...inDatabase(database), sessionId: null, sql, resultPlace: newTabPlace(resultPlacePreference(queryClient)) }),
    [addTab, queryClient],
  );

  const openScriptTab = useCallback(
    (script: Script, place: { connectionId: string | null; database?: string; saved: SavedPlace }, askedFrom?: Element | null) => {
      const open = tabs.find((tab) => tab.script?.id === script.id);
      if (open !== undefined) {
        setActiveTabId(open.id);
        // RN-ABAS-019 e RN-SCRIPT-003: o script que já estava aberto também leva o foco ao editor dele.
        askFocus(open.id, askedFrom);
        return;
      }

      // RN-SCRIPT-010: a aba lembra a pasta em que o script estava quando ela o abriu.
      const ref: ScriptRef = { id: script.id, name: script.name, savedSql: script.sql, ...place.saved, ...(script.folderID === null ? {} : { folderId: script.folderID }), dirty: false };
      addTab({ id: crypto.randomUUID(), title: script.name, connectionId: place.connectionId, ...inDatabase(place.database), sessionId: null, sql: script.sql, script: ref, resultPlace: newTabPlace(resultPlacePreference(queryClient)) }, askedFrom);
    },
    [tabs, addTab, askFocus, queryClient],
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
      // Com um comando da pessoa em andamento, nada (a barra o desabilita). A execução da atualização automática (RN-GRADE-014) não segura: `retire()` a
      // desliga e a sessão de antes se encerra com ela.
      if (tab === undefined || (runner !== undefined && isPersonBusy(runner.getState()))) return;
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

  // O mesmo caminho da troca do banco: o executor de antes sai de cena primeiro (o resultado na tela é da conexão anterior), e a sessão dele fecha em segundo
  // plano. A aba sem conexão não tinha sessão (o executor dela não executa), e o fechamento não chama a API.
  const switchConnection = useCallback(
    (tabId: string, connectionId: string) => {
      const tab = tabs.find((candidate) => candidate.id === tabId);
      const runner = runners.get(tabId);
      if (tab === undefined || (runner !== undefined && isPersonBusy(runner.getState()))) return;
      const sql = liveEditors.snapshot(tabId)?.sql;
      const next = withConnection(tab, connectionId, sql);
      if (next === null) return;

      const released = runner?.retire();
      runners.set(tabId, createRunner(next));
      setTabs((current) => current.map((candidate) => (candidate.id === tabId ? (withConnection(candidate, connectionId, sql) ?? candidate) : candidate)));
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
      // RN-ABAS-019 e RN-TABELA-001: a aba que já estava aberta também leva o foco à entrada dela.
      askFocus(open.id);
    },
    [tabs, addTab, setTableView, askFocus],
  );

  const setSchemaView = useCallback((tabId: string, view: SchemaView) => setTabs((current) => current.map((tab) => (tab.id === tabId && tab.schemaTarget ? { ...tab, schemaTarget: { ...tab.schemaTarget, view } } : tab))), []);

  const openSchemaTab = useCallback(
    (connectionId: string, { schema, view, database }: { schema: string; view?: SchemaView; database?: string }) => {
      const open = tabs.find((tab) => tab.connectionId === connectionId && tab.database === database && tab.schemaTarget?.schema === schema);
      if (open === undefined) return addTab({ id: crypto.randomUUID(), title: database === undefined ? schema : `${database}.${schema}`, connectionId, ...inDatabase(database), sessionId: null, sql: "", schemaTarget: { schema, view: view ?? "tables" } });

      if (view !== undefined) setSchemaView(open.id, view);
      setActiveTabId(open.id);
      askFocus(open.id);
    },
    [tabs, addTab, setSchemaView, askFocus],
  );

  const setDatabaseView = useCallback((tabId: string, view: DatabaseView) => setTabs((current) => current.map((tab) => (tab.id === tabId && tab.databaseTarget ? { ...tab, databaseTarget: { ...tab.databaseTarget, view } } : tab))), []);

  const openDatabaseTab = useCallback(
    (connectionId: string, { name, view, database }: { name: string; view?: DatabaseView; database?: string }) => {
      const open = tabs.find((tab) => tab.connectionId === connectionId && tab.database === database && tab.databaseTarget?.name === name);
      if (open === undefined) return addTab({ id: crypto.randomUUID(), title: name, connectionId, ...inDatabase(database), sessionId: null, sql: "", databaseTarget: { name, view: view ?? "schemas" } });

      if (view !== undefined) setDatabaseView(open.id, view);
      setActiveTabId(open.id);
      askFocus(open.id);
    },
    [tabs, addTab, setDatabaseView, askFocus],
  );

  // "Abrir registros" do aviso da importação e da cópia (RN-IMPORT-020): a aba dos Registros da tabela nesta janela.
  useEffect(() => {
    openRecordsRef.current = (table) => openTableTab(table.connectionId, { schema: table.schema, name: table.name, view: "data", ...inDatabase(table.database) });
  });

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

      const { tab, selection, state, memory, resultWindowLost, values } = adopted;
      if (runners.has(tab.id)) return;
      // RN-ABAS-016: a janela do resultado da aba não fechou a tempo na janela de origem, e o resultado chegou no painel.
      if (resultWindowLost) toast.warning(resultPlaceCopy.windowFailed);

      rememberTransferred(tab.id, selection === null ? memory : { ...memory, selection });
      // RN-VAR-023: os valores das variáveis vão com a aba para a janela que a recebe.
      runners.set(tab.id, createRunner(tab, { state, sessionId: tab.sessionId, values }));
      setTabs((current) => {
        const at = index === undefined ? current.length : Math.min(index, current.length);
        return [...current.slice(0, at), tab, ...current.slice(at)];
      });
      setActiveTabId(tab.id);
      askFocus(tab.id);
      // O nome da próxima consulta desta janela não repete o da aba que chegou.
      const numbered = /^consulta-(\d+)\.sql$/.exec(tab.title);
      if (numbered !== null) nextNumber.current = Math.max(nextNumber.current, Number(numbered[1]) + 1);
    },
    [createRunner, runners, toast, askFocus],
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

  // A lista de abas da última renderização. Soltar a aba que foi para outra janela vem depois de uma espera (a ida espera a execução automática em
  // andamento terminar, RN-GRADE-014), por uma função de uma renderização antiga: a lista que ela viu pode não ter a aba aberta nem ter a fechada nesse meio-tempo.
  const latestTabs = useRef(tabs);
  useEffect(() => {
    latestTabs.current = tabs;
  });

  // Tira a aba da lista DE AGORA (`setTabs` funcional, e a vizinha escolhida na lista de agora): com a lista que a função viu, a aba aberta durante a espera
  // sumia (e a sessão dela ficava aberta), e a fechada voltava sem executor.
  const detachTab = useCallback(
    (tabId: string) => {
      const current = latestTabs.current;
      if (!current.some((tab) => tab.id === tabId)) return;

      setTabs((now) => now.filter((tab) => tab.id !== tabId));
      setActiveTabId((active) => nextActiveTab(current, active, current.filter((tab) => tab.id !== tabId)));
      // Só o executor sai de cena: a sessão, com o cursor aberto, é da janela que recebeu a aba.
      runners.get(tabId)?.retire();
      runners.delete(tabId);
    },
    [runners],
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
        scripts: new Map(scriptList.map((script) => [script.id, { name: script.name, sql: read.get(script.id) ?? null, connectionID: script.connectionID, database: script.database }])),
        newId: () => crypto.randomUUID(),
        nextNumber: () => nextNumber.current++,
      });

      for (const tab of restored.tabs) runners.set(tab.id, createRunner(tab));
      // As conexões das abas de tabela são marcadas ANTES de as abas existirem: a primeira carga dos Registros da aba ativa é um efeito da renderização que a
      // mostra, e lê o `disconnected` dessa renderização. Marcadas depois (num efeito da área das abas, que roda depois dos efeitos dos painéis), a aba ativa
      // abria a sessão sozinha, e só as escondidas esperavam o clique.
      for (const connectionId of restored.tableConnections) disconnectLog.mark(connectionId);
      setTabs((current) => [...restored.tabs, ...current]);
      setActiveTabId((current) => restored.activeTabId ?? current);
      if (restored.activeTabId !== null) askFocus(restored.activeTabId);
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

  const showEntry = useCallback((tabId: string, view: "query" | "result") => {
    setActiveTabId(tabId);
    setResultTabId(view === "result" ? tabId : null);
  }, []);
  const setActiveTab = useCallback((tabId: string) => showEntry(tabId, "query"), [showEntry]);

  const setResultPlace = useCallback((tabId: string, place: ResultPlace) => {
    setTabs((current) => withResultPlace(current, tabId, place));
    if (place !== "tab") setResultTabId((current) => (current === tabId ? null : current));
  }, []);

  // A aba do resultado é a ativa só com o resultado da aba ativa numa aba (o lugar pode ter mudado, a aba pode ter ido embora).
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const resultActive = resultTabId !== null && activeTab !== undefined && placeOf(activeTab) === "tab";

  const setNodeOpen = useCallback((key: string, open: boolean) => setExpanded((current) => (current.has(key) === open ? current : new Set(open ? [...current, key] : [...current].filter((other) => other !== key)))), []);

  const disconnecting = disconnectMutation.isPending ? disconnectMutation.variables : null;
  const { mutate: disconnect } = disconnectMutation;

  const value = useMemo<WorkbenchState>(
    () => ({ tabs, activeTabId, resultActive, showEntry, setResultPlace, openQueryTab, openTableTab, openSchemaTab, openDatabaseTab, openScriptTab, setTableView, setSchemaView, setDatabaseView, closeTab, setActiveTab, reorderTab, shiftTab: shiftTabBy, detachTab, releaseWindow, updateTab, setTabScript, setScriptPlace, markScriptEdited, renameScript, forgetScript, switchConnection, switchDatabase, runnerOf, expanded, setNodeOpen, disconnect, disconnecting, disconnectLog, holdForWindowClose, releaseWindowClose }),
    [tabs, activeTabId, resultActive, showEntry, setResultPlace, openQueryTab, openTableTab, openSchemaTab, openDatabaseTab, openScriptTab, setTableView, setSchemaView, setDatabaseView, closeTab, setActiveTab, reorderTab, shiftTabBy, detachTab, releaseWindow, updateTab, setTabScript, setScriptPlace, markScriptEdited, renameScript, forgetScript, switchConnection, switchDatabase, runnerOf, expanded, setNodeOpen, disconnect, disconnecting, disconnectLog, holdForWindowClose, releaseWindowClose],
  );

  return (
    <WorkbenchContext.Provider value={value}>
      {children}
      <VaultLock isBusy={isBusy} discard={discard} discardedExports={exportTracker.failedDeliveries} />
    </WorkbenchContext.Provider>
  );
}

export function useWorkbench(): WorkbenchState {
  const context = useContext(WorkbenchContext);
  if (context === null) throw new Error("useWorkbench precisa de um <WorkbenchProvider> acima na árvore.");
  return context;
}

/** RN-CONFIG-010: o lugar do resultado das abas novas, nas preferências do usuário do cofre aberto (a sessão que o guard já buscou), lido na hora. */
function defaultTabTransaction(queryClient: QueryClient, connectionId: string | null) {
  const userName = queryClient.getQueryData(sessionQuery.queryKey)?.userName;
  const prefs = (userName === undefined || userName === null ? defaultPreferences : preferencesStore.get(userName)).transactions;
  const connections = connectionId === null ? undefined : queryClient.getQueryData(connectionsQuery.queryKey);
  const engine = Array.isArray(connections) ? connections.find((c) => c.id === connectionId)?.engine : undefined;
  return { mode: prefs.mode, isolationLevel: normalizeIsolationLevel(prefs.isolationLevel, engine) };
}

function resultPlacePreference(queryClient: QueryClient): ResultPlace {
  const userName = queryClient.getQueryData(sessionQuery.queryKey)?.userName;
  return (userName === undefined || userName === null ? defaultPreferences : preferencesStore.get(userName)).results.resultPlace;
}

/** O texto do editor da aba agora (`liveEditors`): a cópia da aba chega com atraso. */
const liveSql: LiveSql = (tabId) => liveEditors.snapshot(tabId)?.sql ?? null;

/** As chaves abertas são sempre de nós que abrem e não de pastas (`setNodeOpen` só recebe essas). */
function isOfConnection(key: string, connectionId: string): boolean {
  const path = parseNavKey(key);
  return path.type !== "folder" && path.connectionId === connectionId;
}
