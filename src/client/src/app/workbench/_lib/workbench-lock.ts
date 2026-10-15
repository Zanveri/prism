import type { QueryClient } from "@tanstack/react-query";

import { isPersonBusy, type QueryRunner } from "./use-query-runner";
import type { QueryTab } from "./workbench-model";

/**
 * O que o bloqueio por inatividade faz com a área de trabalho (RN-SEG-001). Bloquear fecha o cofre na API, e as sessões com os
 * bancos caem do lado dela: as abas e o texto de SQL ficam, e tudo o que dependia da sessão vai embora.
 */

/**
 * A aba continua a mesma, com o texto e a tabela que mostrava; só deixa de ter sessão (a API já a fechou). Devolve SEMPRE uma lista nova,
 * de abas novas, mesmo quando nenhuma tinha sessão (SQL digitado e ainda não executado, só a árvore aberta: o estado mais comum): a
 * mudança de identidade é o que os painéis veem do bloqueio. Devolver a mesma lista nesse caso deixava `WorkbenchTabs` sem redesenhar e o
 * painel com o executor velho, que o provedor já tinha largado.
 */
export function withoutSessions(tabs: QueryTab[]): QueryTab[] {
  return tabs.map((tab) => ({ ...tab, sessionId: null }));
}

/**
 * Alguma aba tem comando em andamento (executar, "carregar mais" ou contar): o bloqueio por inatividade não conta o tempo enquanto isso. A execução da
 * atualização automática (RN-GRADE-014) não conta (`isPersonBusy`): com ela ligada o Prism bloqueia no prazo, e o bloqueio a desliga.
 */
export function anyRunnerBusy(runners: ReadonlyMap<string, QueryRunner>): boolean {
  return [...runners.values()].some((runner) => isPersonBusy(runner.getState()));
}

export type DiscardForLockDeps = {
  /** Os executores das abas, por id: o mapa que `runnerOf` lê. É mudado aqui. */
  runners: Map<string, QueryRunner>;
  tabs: readonly QueryTab[];
  createRunner: (tab: QueryTab) => QueryRunner;
  setTabs: (update: (tabs: QueryTab[]) => QueryTab[]) => void;
  queryClient: QueryClient;
};

/**
 * O que o bloqueio descarta da área de trabalho (RN-SEG-001), nesta ordem:
 * - cada aba ganha um executor novo, sem resultado e sem sessão (a primeira execução abre outra), e o velho sai de cena de vez
 *   (`retire`): a resposta que ainda estiver a caminho chega e não muda nada, ele não devolve a sessão a ninguém (a API já a fechou) e,
 *   se um painel ainda o segurar por um instante, ele recusa executar. Executor novo, e não o mesmo vazio, porque a vista Registros de uma
 *   tabela à vista executa sozinha quando o executor da aba é novo;
 * - a lista de abas é publicada de novo, sempre: é o que faz os painéis largarem o executor velho (`withoutSessions`);
 * - o dado de banco em cache sai (`dropDataAtLock`).
 * As abas, o texto de SQL, a aba ativa e os nós abertos da árvore ficam.
 */
export function discardForLock({ runners, tabs, createRunner, setTabs, queryClient }: DiscardForLockDeps): void {
  for (const tab of tabs) {
    runners.get(tab.id)?.retire();
    runners.set(tab.id, createRunner(tab));
  }
  setTabs(withoutSessions);
  dropDataAtLock(queryClient);
}

/**
 * Os dois ganchos que a área de trabalho entrega ao bloqueio (`VaultLock`): "há comando em andamento?" (o tempo não conta enquanto há) e
 * "solta o que dependia do cofre". É aqui que são montados, e o provedor só chama isto. Os dois agem sobre o MESMO mapa de executores
 * (a identidade importa: é o mapa que `runnerOf` lê, e um mapa copiado seria trocado em vão, deixando a tela com os executores
 * aposentados) e sobre as abas correntes, e `isBusy` olha o mapa a cada chamada, não o que havia quando foi montado.
 */
export function createLockHandles(deps: DiscardForLockDeps): { isBusy: () => boolean; discard: () => void } {
  return {
    isBusy: () => anyRunnerBusy(deps.runners),
    discard: () => discardForLock(deps),
  };
}

/**
 * As famílias de consulta que sobrevivem ao bloqueio: quem está entrando, as listas do cofre (pastas e conexões, que a tela de
 * bloqueio deixa por baixo exatamente como estavam), os drivers e as preferências de atualização (que não são do cofre). Todo o
 * resto é dado de banco ou depende de uma sessão que morreu, e "nada do que estava em cache de dados de banco sobrevive ao
 * bloqueio": uma família nova cai por padrão, e a tela a busca de novo ao desbloquear.
 */
const keptAtLock: ReadonlySet<string> = new Set(["session", "folders", "connections", "drivers", "update-preferences"]);

/** A chave de uma consulta é descartada no bloqueio? */
export function isDroppedAtLock(queryKey: readonly unknown[]): boolean {
  return !keptAtLock.has(String(queryKey[0]));
}

/**
 * Tira do cache o que o bloqueio não deixa sobreviver: a sessão da árvore, os níveis dela e a estrutura de cada tabela (a das vistas
 * da aba de uma tabela). As consultas ainda observadas por uma tela montada por baixo se refazem do zero ao desbloquear, numa sessão nova.
 */
export function dropDataAtLock(queryClient: QueryClient): void {
  queryClient.removeQueries({ predicate: (query) => isDroppedAtLock(query.queryKey) });
}
