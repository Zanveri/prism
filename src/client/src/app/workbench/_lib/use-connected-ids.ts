import { useQueries } from "@tanstack/react-query";

import type { Connection } from "@/app/connections/_lib/connections.schema";

import { databaseSessionQuery } from "./database-sessions.service";
import { useNotConnectedIds } from "./use-connection-checks";
import { connectedConnectionIds } from "./workbench-model";
import { useWorkbench } from "./workbench-state";

/**
 * As conexões conectadas, na definição única (`connectedConnectionIds`: a sessão da árvore em cache, ou a de alguma aba, menos as que a verificação achou
 * sem sessão na API), para a lista da troca da conexão da aba (RN-ARVORE-008) e para a faixa da aba sem conexão (RN-SCRIPT-005), que as põem primeiro. As
 * consultas das sessões são `enabled: false`: só leem o que a árvore já abriu e nunca abrem uma sessão por aqui (RN-SESSAO-004). Lê as abas da área de
 * trabalho, então redesenha a cada mudança delas: use só onde isso é barato (a lista aberta, a faixa da aba sem conexão), e não no botão de cada aba.
 */
export function useConnectedIds(connections: readonly Connection[] | undefined): ReadonlySet<string> {
  const { tabs } = useWorkbench();
  const notConnected = useNotConnectedIds();
  const list = connections ?? [];
  const sessions = useQueries({ queries: list.map((connection) => ({ ...databaseSessionQuery(connection.id), enabled: false })) });
  const treeOpen = new Set(list.flatMap((connection, index) => (sessions[index]?.isSuccess === true ? [connection.id] : [])));

  return new Set(
    connectedConnectionIds(
      list.map((connection) => connection.id),
      tabs,
      (connectionId) => treeOpen.has(connectionId),
      notConnected,
    ),
  );
}
