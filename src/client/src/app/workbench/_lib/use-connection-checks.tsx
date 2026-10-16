import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";

import type { Connection } from "@/app/connections/_lib/connections.schema";
import { connectionsQuery, verifyConnection } from "@/app/connections/_lib/connections.service";
import { useToast } from "@/components/ui";
import { claimVerification, finishVerification, onVerificationPeer } from "@/lib/api/bridge";
import { vaultLock } from "@/lib/api/vault-lock";

import { connectionChecksCopy } from "./connection-checks.copy";
import { createConnectionChecks, notConnectedIds, type CheckState, type CheckTarget } from "./connection-checks";
import { databaseSessionQuery } from "./database-sessions.service";
import type { QueryTab } from "./workbench-model";
import { useWorkbench } from "./workbench-state";

/**
 * A verificação periódica desta janela (RN-VERIF-002): uma só, e não uma por componente que mostra o indicador. Quem a alimenta é o `ConnectionChecks`,
 * montado uma vez pelo provedor da área de trabalho; quem a lê são os indicadores (`useConnectionCheck`, `useConnectionChecksSnapshot`).
 *
 * O pedido não passa pelo cache de mutações: a falha da chamada (a API fora do ar, a conexão que sumiu) não vira aviso, e a do banco é resposta 200, que vai
 * ao indicador. Ele também não é atividade da pessoa nem comando em andamento para o bloqueio por inatividade (RN-SEG-001): o bloqueio só olha a tecla, o
 * ponteiro e os executores das abas, e a verificação não passa por nenhum deles.
 */
export const connectionChecks = createConnectionChecks({
  verify: async (connectionId, signal) => {
    const result = await verifyConnection(connectionId, signal);
    return result.ok ? result.data : null;
  },
  claim: claimVerification,
  finish: (connectionId, result) => finishVerification({ connectionId, result }),
  schedule: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  paused: () => vaultLock.isLocked(),
});

/**
 * As conexões que esta janela verifica agora: as conectadas aqui (a sessão da árvore ou a de alguma aba, a mesma conta de `isConnected`) com a verificação
 * ligada, com o intervalo de cada uma e as sessões dela. Com o cofre bloqueado, nenhuma (RN-VERIF-002). Pura.
 */
export function checkTargets(connections: readonly Connection[], tabs: readonly QueryTab[], treeSession: (connectionId: string) => string | null, locked: boolean): Map<string, CheckTarget> {
  const targets = new Map<string, CheckTarget>();
  if (locked) return targets;

  for (const connection of connections) {
    if (!connection.verificationEnabled) continue;
    const tree = treeSession(connection.id);
    const tabSessions = tabs.flatMap((tab) => (tab.connectionId === connection.id && tab.sessionId !== null ? [tab.sessionId] : [])).sort();
    if (tree === null && tabSessions.length === 0) continue;
    targets.set(connection.id, { intervalSeconds: connection.verificationInterval, sessions: [tree ?? "", ...tabSessions].join(" ") });
  }
  return targets;
}

/**
 * Liga a verificação desta janela ao que ela tem: as conexões, as abas, as sessões da árvore em cache (`enabled: false`: só lê o que a árvore abriu, nunca
 * abre uma sessão por aqui) e o bloqueio. Avisa quando uma conexão passa de responder a não responder, e quando volta (RN-VERIF-003), e recebe a resposta
 * das verificações que outra janela fez. Não desenha nada.
 */
export function ConnectionChecks() {
  const { tabs } = useWorkbench();
  const toast = useToast();
  const connections = useQuery(connectionsQuery);
  const list = connections.data ?? [];
  const sessions = useQueries({ queries: list.map((connection) => ({ ...databaseSessionQuery(connection.id), enabled: false })) });
  const locked = useSyncExternalStore(vaultLock.subscribe, vaultLock.isLocked);

  const treeSessions = new Map(list.map((connection, index) => [connection.id, sessions[index]?.data?.id ?? null]));
  const targets = checkTargets(list, tabs, (connectionId) => treeSessions.get(connectionId) ?? null, locked);
  // Uma chave de texto: o efeito só roda quando o que se verifica muda, e não a cada desenho do provedor.
  const key = JSON.stringify([...targets]);
  useEffect(() => connectionChecks.track(new Map(JSON.parse(key) as [string, CheckTarget][])), [key]);

  // O nome de cada conexão para o aviso, o de agora (ela pode ter sido renomeada).
  const names = useRef(new Map<string, string>());
  useEffect(() => {
    names.current = new Map(list.map((connection) => [connection.id, connection.name]));
  });
  useEffect(
    () =>
      connectionChecks.onTransition((connectionId, transition) => {
        const name = names.current.get(connectionId);
        if (name === undefined) return;
        if (transition === "failed") toast.warning(connectionChecksCopy.toasts.failed(name));
        else toast.success(connectionChecksCopy.toasts.recovered(name));
      }),
    [toast],
  );

  useEffect(() => onVerificationPeer(({ connectionId, result }) => connectionChecks.peer(connectionId, result)), []);

  // Sair do cofre desmonta o provedor: nada mais é verificado, e o indicador esquece tudo.
  useEffect(() => () => connectionChecks.track(new Map()), []);

  return null;
}

/** O que o indicador de uma conexão mostra (RN-VERIF-003); nulo sem verificação (desligada, ou a conexão desconectada): fica o ponto de sempre. */
export function useConnectionCheck(connectionId: string | null | undefined): CheckState | null {
  return useSyncExternalStore(connectionChecks.subscribe, () => (connectionId == null ? null : connectionChecks.get(connectionId)));
}

/** O de todas, numa vez: a árvore desenha muitas linhas, e um gancho por linha não cabe no laço dela. */
export function useConnectionChecksSnapshot(): ReadonlyMap<string, CheckState> {
  return useSyncExternalStore(connectionChecks.subscribe, connectionChecks.snapshot);
}

/**
 * As conexões que a verificação achou sem sessão na API (`notConnectedIds`), para quem conta as conectadas fora do navegador (`useConnectedIds`). A foto é
 * lida numa chave de texto: quem usa só redesenha quando elas mudam, e não a cada verificação.
 */
export function useNotConnectedIds(): ReadonlySet<string> {
  const key = useSyncExternalStore(connectionChecks.subscribe, () => notConnectedIds(connectionChecks.snapshot()).join(" "));
  return useMemo(() => new Set(key === "" ? [] : key.split(" ")), [key]);
}
