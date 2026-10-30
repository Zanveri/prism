import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { usesInternalDescriptions } from "@/app/connections/_lib/internal-descriptions";
import type { Engine } from "@/components/ui";
import {
  fetchInternalTableDescription,
  runTableStructureEnrichers,
  type TableStructureEnrichment,
} from "@/lib/plugins/plugin-runtime";
import { pluginBundlesQuery } from "@/lib/plugins/plugins.service";

import type { Column } from "./database-sessions.schema";
import { databaseMark, databaseSessionQuery, keepUntilRefreshed } from "./database-sessions.service";

export const tableEnrichmentPrefix = (connectionId: string, schema: string, table: string, database?: string) =>
  ["plugin-table-enrichment", connectionId, ...databaseMark(database), schema, table] as const;

export const internalTableDescriptionPrefix = (connectionId: string, table: string, database?: string) =>
  ["internal-table-description", connectionId, ...databaseMark(database), table.trim().toLowerCase()] as const;

/**
 * Resolve se a conexão `connectionId` está com "Utilizar descrições internas" ativo
 * (marcado na própria conexão ou herdado de uma pasta acima sem ter sido desmarcado na conexão).
 */
export function useConnectionUsesInternalDescriptions(connectionId: string): boolean {
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  const connection = connections.data?.find((candidate) => candidate.id === connectionId);
  return usesInternalDescriptions(connection, folders.data ?? []);
}

/**
 * Busca a descrição interna da tabela (`diaabr`) na mesma sessão de servidor e banco onde a tabela está aberta.
 */
export function useInternalTableDescription({
  connectionId,
  database,
  table,
  visible,
}: {
  connectionId: string;
  database?: string;
  table: string;
  visible: boolean;
}): { enabled: boolean; description: string | null } {
  const queryClient = useQueryClient();
  const enabled = useConnectionUsesInternalDescriptions(connectionId);

  const query = useQuery({
    queryKey: internalTableDescriptionPrefix(connectionId, table, database),
    queryFn: async () => {
      const { id: sessionId } = await queryClient.ensureQueryData(databaseSessionQuery(connectionId, database));
      return fetchInternalTableDescription(sessionId, table);
    },
    enabled: visible && enabled,
    ...keepUntilRefreshed,
  });

  return { enabled, description: query.data ?? null };
}

export function useTableStructureEnrichment({
  connectionId,
  database,
  engine,
  schema,
  table,
  columns,
  visible,
}: {
  connectionId: string;
  database?: string;
  engine: Engine | undefined;
  schema: string;
  table: string;
  columns: Column[] | undefined;
  visible: boolean;
}): TableStructureEnrichment | null {
  const queryClient = useQueryClient();
  const internalDescriptionsEnabled = useConnectionUsesInternalDescriptions(connectionId);
  const bundles = useQuery({ ...pluginBundlesQuery, enabled: visible });
  const bundleList = bundles.data ?? [];

  const bundlesSignature = bundleList.map((b) => `${b.id}@${b.version}`).join(",");
  const shouldRun = bundleList.length > 0 || internalDescriptionsEnabled;

  const enrichment = useQuery({
    queryKey: [
      ...tableEnrichmentPrefix(connectionId, schema, table, database),
      bundlesSignature,
      internalDescriptionsEnabled ? "internal:on" : "internal:off",
    ] as const,
    queryFn: async () => {
      if (columns === undefined || !shouldRun) return null;
      const { id: sessionId } = await queryClient.ensureQueryData(databaseSessionQuery(connectionId, database));
      return runTableStructureEnrichers(bundleList, {
        connectionId,
        sessionId,
        engine,
        database,
        schema,
        table,
        columns,
        useInternalDescriptions: internalDescriptionsEnabled,
      });
    },
    enabled: visible && shouldRun && columns !== undefined,
    ...keepUntilRefreshed,
  });

  if (enrichment.data !== undefined) {
    return enrichment.data;
  }

  if (internalDescriptionsEnabled) {
    return {
      tableDescription: null,
      extraColumns: [{ key: "description", label: "Descrição" }],
      columnValues: {},
    };
  }

  return null;
}
