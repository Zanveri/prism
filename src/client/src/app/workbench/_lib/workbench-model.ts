import type { QueryClient } from "@tanstack/react-query";

import { parseNavKey } from "./navigator-model";

/** As vistas da aba de uma tabela: os registros, a estrutura (colunas, chaves estrangeiras e índices) e o diagrama. */
export type TableView = "data" | "structure" | "diagram";

/** A tabela (ou visão) que uma aba mostra, e a vista em que ela está. */
export type TableTarget = { schema: string; name: string; view: TableView };

/**
 * Uma aba. `sessionId` é a sessão da aba (RN-SESSAO-001), aberta na primeira execução; `sql`, o texto do editor.
 * Com `table`, é a aba de uma tabela, aberta pelo navegador (RN-TABELA-001): tem a sessão dela como qualquer aba, e os
 * registros vêm do mesmo executor.
 */
export type QueryTab = { id: string; title: string; connectionId: string; sessionId: string | null; sql: string; table?: TableTarget };

/**
 * A definição única de "conectada", para o ponto e o "Desconectar" do navegador e para a barra de
 * status: a conexão tem sessão aberta na API, seja a da árvore, seja a de alguma aba (RN-SESSAO-001).
 * Com a árvore fechada e uma aba que já executou, ainda há sessão para desconectar.
 */
export function isConnected(connectionId: string, tabs: QueryTab[], treeSessionOpen: boolean): boolean {
  return treeSessionOpen || tabs.some((tab) => tab.connectionId === connectionId && tab.sessionId !== null);
}

/** O que a área de trabalho guarda e que aponta para conexões: as abas e os nós abertos da árvore. */
export type WorkbenchSnapshot = { tabs: QueryTab[]; activeTabId: string | null; expanded: ReadonlySet<string> };

/**
 * A aba ativa depois de algumas saírem: a mesma, se ainda existe; senão a primeira que resta à
 * direita de onde ela estava, e, sem nenhuma à direita, a última que resta à esquerda.
 */
export function nextActiveTab(tabs: QueryTab[], activeTabId: string | null, remaining: QueryTab[]): string | null {
  if (activeTabId === null || remaining.some((tab) => tab.id === activeTabId)) return activeTabId;

  const position = tabs.findIndex((tab) => tab.id === activeTabId);
  const stay = new Set(remaining.map((tab) => tab.id));
  const right = tabs.slice(position + 1).find((tab) => stay.has(tab.id));
  const left = tabs.slice(0, position).findLast((tab) => stay.has(tab.id));
  return (right ?? left)?.id ?? null;
}

/**
 * O que sobra da área de trabalho quando uma conexão some da lista (excluída na tela de Conexões,
 * ou por qualquer outro caminho): a API já encerrou as sessões dela (RN-CONN-014), então as abas,
 * com a sessão morta, e os nós abertos da árvore dela não servem mais. `null` quando não há o que
 * podar, e também enquanto a lista não chegou (`existing` nulo): ainda não se sabe o que sumiu.
 */
export function pruneWorkbench(snapshot: WorkbenchSnapshot, existing: ReadonlySet<string> | null): WorkbenchSnapshot | null {
  if (existing === null) return null;

  const tabs = snapshot.tabs.filter((tab) => existing.has(tab.connectionId));
  // Os nós abertos guardam só caminhos de conexão, nunca de pasta (`setNodeOpen` só recebe esses).
  const expanded = [...snapshot.expanded].filter((key) => {
    const path = parseNavKey(key);
    return path.type === "folder" || existing.has(path.connectionId);
  });
  if (tabs.length === snapshot.tabs.length && expanded.length === snapshot.expanded.size) return null;

  return { tabs, activeTabId: nextActiveTab(snapshot.tabs, snapshot.activeTabId, tabs), expanded: new Set(expanded) };
}

/**
 * As famílias de consulta que são de UMA conexão, com o id dela na posição 1 da chave: a sessão da árvore, os níveis da árvore e a
 * estrutura de cada tabela, que a aba da tabela mostra (`["table-structure", conexão, esquema, tabela, nível]`).
 */
export const connectionOwnedFamilies = ["database-session", "tree", "table-structure"] as const;

/** Uma consulta de uma dessas famílias: de quem a conexão sumiu da lista? */
export function ownedByMissingConnection(queryKey: readonly unknown[], existing: ReadonlySet<string>): boolean {
  return !existing.has(String(queryKey[1]));
}

/**
 * A conexão saiu da lista (excluída, ou de qualquer outro jeito): a API já encerrou as sessões dela (RN-CONN-014), e o que a tela
 * guardava em cache dela, nas três famílias, não aponta para mais nada. Quem chama já tirou os nós abertos e as abas dela, para
 * nenhuma consulta removida ser refeita na hora.
 */
export function forgetMissingConnections(queryClient: QueryClient, existing: ReadonlySet<string>): void {
  const predicate = (query: { queryKey: readonly unknown[] }) => ownedByMissingConnection(query.queryKey, existing);
  for (const family of connectionOwnedFamilies) queryClient.removeQueries({ queryKey: [family], predicate });
}
