import { useQuery } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup } from "@/app/connections/_lib/environment";
import { readOnlyHintOf } from "@/app/connections/_lib/protections";

import { ExportConnection } from "../data-export/export-wizard-steps";

/**
 * RN-GRADE-018: a conexão ao lado do que se gera, no cabeçalho do diálogo "Gerar SQL", como no assistente da exportação: a etiqueta do banco, a conexão e o
 * banco de dados, com o ambiente e o cadeado do somente leitura (RN-PASTA-005, RN-PROT-002). Lê as listas que a árvore já carregou; sem a conexão nelas,
 * nada.
 */
export function SqlDialogConnection({ connectionId, database }: { connectionId: string; database?: string }) {
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  const connection = connections.data?.find((candidate) => candidate.id === connectionId);
  if (connection === undefined) return null;
  return (
    <ExportConnection
      engine={connection.engine}
      name={connection.name}
      database={database ?? connection.database}
      environment={environmentLookup(folders.data ?? []).connection(connection)}
      readOnlyHint={readOnlyHintOf(connection.protections, folders.data ?? [])}
    />
  );
}
