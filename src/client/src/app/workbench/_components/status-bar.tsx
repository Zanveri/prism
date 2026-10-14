import { useQuery } from "@tanstack/react-query";

import { engineOption } from "@/app/connections/_lib/connections.schema";
import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup } from "@/app/connections/_lib/environment";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { LockOpenIcon } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { databaseSessionQuery } from "../_lib/database-sessions.service";
import { scriptsCopy } from "../_lib/scripts.copy";
import { isConnected } from "../_lib/workbench-model";
import { useWorkbench } from "../_lib/workbench-state";
import { workbenchCopy } from "../_lib/workbench.copy";

const copy = workbenchCopy.status;

/**
 * A barra de status: a conexão e o banco da aba ativa (o outro banco do servidor em que ela roda, RN-ARVORE-006 e 007, ou o da conexão) com a etiqueta do
 * ambiente (RN-CONN-015), "Auto-commit"
 * (RN-SESSAO-005: nesta fatia toda sessão é auto-commit) e o cofre aberto. "Conectada" é a mesma
 * definição do navegador (`isConnected`): a árvore abriu a sessão dela, ou alguma aba tem a sua.
 */
export function StatusBar() {
  const { tabs, activeTabId } = useWorkbench();
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  // O guard já buscou a sessão do cofre (mesma chave): aqui só se lê.
  const vault = useQuery({ ...sessionQuery, staleTime: Infinity });

  const tab = tabs.find((candidate) => candidate.id === activeTabId) ?? null;
  const connection = connections.data?.find((candidate) => candidate.id === tab?.connectionId);
  // `enabled: false`: só lê o que a árvore já guardou, nunca abre uma sessão por aqui.
  const treeSession = useQuery({ ...databaseSessionQuery(tab?.connectionId ?? ""), enabled: false });
  const connected = tab !== null && isConnected(tab.connectionId, tabs, treeSession.isSuccess);

  return (
    <footer aria-label={copy.label} className="flex min-h-7 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-panel px-3 py-1 text-xs text-muted">
      {tab?.connectionId === null ? (
        <span>{scriptsCopy.noConnection.status}</span>
      ) : tab === null || connection === undefined ? (
        <span>{copy.noTab}</span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2 flex-none rounded-full", connected ? "bg-success" : "border-[1.5px] border-subtle")} />
          <span>
            {connected ? copy.connected : copy.disconnected} · {copy.place(connection.name, tab.database ?? connection.database)} · {engineOption(connection.engine).label}
          </span>
          <ShownEnvironmentPill environment={environmentLookup(folders.data ?? []).connection(connection)} />
        </span>
      )}
      <span>{copy.autoCommit}</span>
      {vault.data?.userName ? (
        <span className="ml-auto flex items-center gap-1.5">
          <LockOpenIcon />
          <span>{copy.vaultOpen(vault.data.userName)}</span>
        </span>
      ) : null}
    </footer>
  );
}
