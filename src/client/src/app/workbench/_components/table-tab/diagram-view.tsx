import { useCallback, useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button } from "@/components/ui";

import { layoutDiagram, referencedTables, referencingTables, type TableRef } from "../../_lib/table-diagram";
import { useRefreshSlot, type RefreshSlot } from "../../_lib/tab-refresh";
import { recall, remember, type DiagramMemory } from "../../_lib/tab-memory";
import { levelView } from "../../_lib/table-structure";
import { columnsQuery, foreignKeysQuery, referencedByQuery } from "../../_lib/table-structure.service";
import { workbenchCopy } from "../../_lib/workbench.copy";
import { DiagramCanvas } from "./diagram-canvas";
import { useStructureActions } from "./use-structure-actions";

const copy = workbenchCopy.tableTab;

type DiagramViewProps = {
  connectionId: string;
  /** RN-ARVORE-006: o outro banco do servidor da aba; sem ele, o banco da conexão. */
  database?: string;
  schema: string;
  name: string;
  /** A aba está À VISTA: a escondida não busca nada até ser aberta (RN-SEG-001). */
  visible: boolean;
  /** Duplo clique numa vizinha: abre a aba dela (RN-TABELA-004). */
  onOpenTable: (table: TableRef) => void;
  /** Quem guarda o zoom e a rolagem do diagrama desta aba: o id dela (`tab-memory.ts`). */
  memoryKey: string;
  /** RN-GRADE-012: onde a vista deixa o "Atualizar" para o F5 da aba. */
  refreshSlot?: RefreshSlot;
};

/**
 * A vista Diagrama (RN-TABELA-004): as colunas, as chaves estrangeiras da tabela (à direita) e as chaves
 * estrangeiras de outras tabelas que apontam para ela (à esquerda), além das colunas das tabelas vizinhas
 * (até 12 de cada lado), uma consulta por tabela, em paralelo. Todas pelas mesmas consultas da Estrutura
 * (`table-structure.service.ts`): quem já abriu uma vista não busca de novo. O desenho só aparece quando
 * todas chegaram, para as caixas não crescerem por baixo do usuário; a vizinha cujas colunas falharam
 * aparece só com o nome (o aviso central diz o que houve).
 */
export function DiagramView({ connectionId, database, schema, name, visible, onOpenTable, memoryKey, refreshSlot }: DiagramViewProps) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const { refresh } = useStructureActions(connectionId, database);
  const columns = useQuery(columnsQuery(connectionId, schema, name, queryClient, visible, database));
  const foreignKeys = useQuery(foreignKeysQuery(connectionId, schema, name, queryClient, visible, database));
  const referencedBy = useQuery(referencedByQuery(connectionId, schema, name, queryClient, visible, database));

  const neighbors = useMemo(() => (foreignKeys.data === undefined ? null : referencedTables({ schema, name }, foreignKeys.data)), [foreignKeys.data, schema, name]);
  const incoming = useMemo(() => (referencedBy.data === undefined ? null : referencingTables({ schema, name }, referencedBy.data)), [referencedBy.data, schema, name]);
  const neighborTables = useMemo(() => [...(neighbors?.tables ?? []), ...(incoming?.tables ?? [])], [neighbors, incoming]);

  const loaded = useQueries({
    queries: neighborTables.map((table) => columnsQuery(connectionId, table.schema, table.name, queryClient, visible, database)),
    // Um objeto só, com a mesma forma enquanto os dados não mudam: o desenho não é refeito a cada renderização.
    combine: (results) => ({ columns: results.map((result) => result.data ?? null), pending: results.some((result) => result.data === undefined && !result.isError) }),
  });

  const layout = useMemo(() => {
    if (columns.data === undefined || foreignKeys.data === undefined || referencedBy.data === undefined || neighbors === null || incoming === null || loaded.pending) return null;

    const outgoingCount = neighbors.tables.length;
    return layoutDiagram({
      center: { ref: { schema, name }, columns: columns.data },
      foreignKeys: foreignKeys.data,
      neighbors: neighbors.tables.map((ref, index) => ({ ref, columns: loaded.columns[index] })),
      referencedBy: referencedBy.data,
      incomingNeighbors: incoming.tables.map((ref, index) => ({ ref, columns: loaded.columns[outgoingCount + index] })),
    });
  }, [columns.data, foreignKeys.data, referencedBy.data, neighbors, incoming, loaded, schema, name]);

  const rememberView = useCallback((view: DiagramMemory) => remember(memoryKey, "diagram", view), [memoryKey]);
  // RN-GRADE-012: F5 recarrega a vista (a tabela e as vizinhas), como o "Atualizar" dela.
  const refreshByKey = useCallback(() => void refresh([{ schema, name }, ...neighborTables]), [refresh, schema, name, neighborTables]);
  useRefreshSlot(refreshSlot, refreshByKey);

  const failed = levelView(columns).kind === "error" ? levelView(columns) : levelView(foreignKeys).kind === "error" ? levelView(foreignKeys) : levelView(referencedBy);
  const everyone: TableRef[] = [{ schema, name }, ...neighborTables];
  const totalForeignKeyCount = (foreignKeys.data?.length ?? 0) + (referencedBy.data?.filter((fk) => fk.referencingSchema !== schema || fk.referencingTable !== name).length ?? 0);

  if (failed.kind === "error") {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="break-words whitespace-pre-wrap text-danger">{failed.message}</p>
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={() => void refresh(everyone)}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  if (layout === null) {
    return (
      <p role="status" className="p-4 text-muted">
        {copy.diagram.loading}
      </p>
    );
  }

  return (
    <DiagramCanvas
      layout={layout}
      schema={schema}
      subject={`${schema}.${name}`}
      tableCount={layout.boxes.length}
      foreignKeyCount={totalForeignKeyCount}
      omitted={(neighbors?.omitted ?? 0) + (incoming?.omitted ?? 0)}
      fetching={columns.isFetching || foreignKeys.isFetching || referencedBy.isFetching}
      onOpenTable={onOpenTable}
      onRefresh={() => void refresh(everyone)}
      initial={recall(memoryKey, "diagram")}
      onViewChange={rememberView}
      preferences={preferences}
    />
  );
}
