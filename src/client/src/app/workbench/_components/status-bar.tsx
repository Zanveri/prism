import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { engineOption } from "@/app/connections/_lib/connections.schema";
import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup } from "@/app/connections/_lib/environment";
import { readOnlyHintOf } from "@/app/connections/_lib/protections";
import { sessionQuery } from "@/app/sign-in/_lib/sign-in.service";
import { LockIcon, LockOpenIcon } from "@/components/ui";

import { databaseSessionQuery } from "../_lib/database-sessions.service";
import { useConnectionCheck } from "../_lib/use-connection-checks";
import { scriptsCopy } from "../_lib/scripts.copy";
import { isConnected } from "../_lib/workbench-model";
import { useWorkbench } from "../_lib/workbench-state";
import { workbenchCopy } from "../_lib/workbench.copy";
import { CheckFailureDialog, CheckLabel } from "./connection-check";

const copy = workbenchCopy.status;

/**
 * RN-VERIF-003: a conexão conectada da aba, na barra de status: com a verificação ligada, o indicador dela no lugar do ponto de conectada ("Respondeu na
 * última verificação", com a hora e o tempo na dica; "Não respondeu", que mostra a mensagem do banco num clique); sem ela, o ponto e "Conectada" de sempre.
 */
export function StatusConnectionState({ connectionId, name }: { connectionId: string; name: string }) {
  const state = useConnectionCheck(connectionId);
  const [failureOpen, setFailureOpen] = useState(false);
  // A janela da falha fecha de vez quando a conexão volta a responder (ajuste durante a renderização): a falha seguinte não a abre sozinha.
  if (failureOpen && state?.kind !== "failed") setFailureOpen(false);

  if (state === null) {
    return (
      <>
        <span aria-hidden className="size-2 flex-none rounded-full bg-success" />
        <span>{copy.connected}</span>
      </>
    );
  }

  return (
    <>
      <CheckLabel state={state} onFailure={() => setFailureOpen(true)} />
      {failureOpen && state.kind === "failed" ? <CheckFailureDialog connection={name} state={state} onClose={() => setFailureOpen(false)} /> : null}
    </>
  );
}

/**
 * A barra de status: a conexão e o banco da aba ativa (o outro banco do servidor em que ela roda, RN-ARVORE-006 e 007, ou o da conexão) com a etiqueta do
 * ambiente (RN-CONN-015), o indicador da verificação periódica (RN-VERIF-003), o cadeado da conexão somente leitura (RN-PROT-002, com a dica de onde ele vem), "Auto-commit"
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
  const readOnly = connection === undefined ? null : readOnlyHintOf(connection.protections, folders.data ?? []);

  return (
    <footer aria-label={copy.label} className="flex min-h-7 flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-panel px-3 py-1 text-xs text-muted">
      {tab?.connectionId === null ? (
        <span>{scriptsCopy.noConnection.status}</span>
      ) : tab === null || connection === undefined ? (
        <span>{copy.noTab}</span>
      ) : (
        <span className="flex items-center gap-1.5">
          {connected ? (
            <StatusConnectionState connectionId={connection.id} name={connection.name} />
          ) : (
            <>
              <span aria-hidden className="size-2 flex-none rounded-full border-[1.5px] border-subtle" />
              <span>{copy.disconnected}</span>
            </>
          )}
          <span>
            · {copy.place(connection.name, tab.database ?? connection.database)} · {engineOption(connection.engine).label}
          </span>
          <ShownEnvironmentPill environment={environmentLookup(folders.data ?? []).connection(connection)} />
          {readOnly === null ? null : (
            <span title={readOnly} className="flex items-center gap-1">
              <LockIcon className="size-3.5" />
              <span>{copy.readOnly}</span>
            </span>
          )}
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
