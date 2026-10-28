import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useToast, type Engine } from "@/components/ui";

import { inDatabase } from "../../_lib/navigator-model";
import { objectKindOf } from "../../_lib/object-kind";
import { firstSection, type StructureSection } from "../../_lib/structure-sections";
import { useRefreshSlot, type RefreshSlot } from "../../_lib/tab-refresh";
import { recall, remember } from "../../_lib/tab-memory";
import { ddlState } from "../../_lib/table-ddl";
import { levelView, structureColumns, structureForeignKeys, structureIndexes } from "../../_lib/table-structure";
import { columnsQuery, foreignKeysQuery, indexesQuery } from "../../_lib/table-structure.service";
import { treeQuery } from "../../_lib/database-sessions.service";
import { useTableStructureEnrichment } from "../../_lib/use-table-structure-enrichment";
import { workbenchCopy } from "../../_lib/workbench.copy";
import { StructureSections } from "./structure-sections";
import { useStructureActions } from "./use-structure-actions";

type StructureViewProps = {
  /** O id da aba: a seção da lista lateral fica lembrada por ele (`tab-memory.ts`) e sobrevive a trocar de vista e ao bloqueio por inatividade. */
  tabId: string;
  connectionId: string;
  /** RN-ARVORE-006: o outro banco do servidor da aba; sem ele, o banco da conexão. */
  database?: string;
  /** O banco da conexão: o DDL aproximado depende dele (o Informix escreve o nome da restrição depois da definição). */
  engine: Engine | undefined;
  schema: string;
  name: string;
  /** A aba está À VISTA: a escondida não busca nada até ser aberta (RN-SEG-001). */
  visible: boolean;
  /** "Ver no diagrama", do canvas: leva à outra vista da mesma aba. */
  onOpenDiagram: () => void;
  /** RN-GRADE-012: onde a vista deixa o "Atualizar" para o F5 da aba. */
  refreshSlot?: RefreshSlot;
};

/**
 * A vista Estrutura (RN-TABELA-003): busca as colunas, as chaves estrangeiras e os índices pelas três
 * consultas de catálogo da API (`table-structure.service.ts`), todas pela sessão da árvore, e as
 * entrega a `StructureSections`, com o DDL aproximado montado do que chegou (RN-TABELA-008). "Padrão", "Ao excluir" e "Método", do canvas, ficam
 * de fora: a API não devolve esses dados. Fica guardado até o "Atualizar".
 *
 * Mostra uma seção por vez, escolhida na lista lateral (RN-TABELA-009). A escolha é desta vista e abre em Colunas, mas fica lembrada com a aba
 * (`tab-memory.ts`, pelo id dela): ir a Registros ou ao Diagrama e voltar, trocar de aba e voltar, e passar pelo bloqueio por inatividade não a perdem; fechar
 * a aba a esquece. As três consultas seguem as mesmas para qualquer seção (a contagem de cada entrada e o DDL dependem das três).
 *
 * O tipo do objeto (tabela ou visão) a aba não carrega: vem do cache da árvore da conexão, dos grupos "Tabelas" e "Visões" do esquema, que ela só lê
 * (`enabled: false`: nenhuma consulta é disparada por aqui). Uma visão não tem DDL aproximado, e sem saber o tipo o texto diz que pode ser uma visão.
 */
export function StructureView({ tabId, connectionId, database, engine, schema, name, visible, onOpenDiagram, refreshSlot }: StructureViewProps) {
  const [section, setSection] = useState<StructureSection>(() => recall(tabId, "structure") ?? firstSection);
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  useEffect(() => remember(tabId, "structure", section), [tabId, section]);

  const queryClient = useQueryClient();
  const { refresh } = useStructureActions(connectionId, database);
  const columns = useQuery(columnsQuery(connectionId, schema, name, queryClient, visible, database));
  const foreignKeys = useQuery(foreignKeysQuery(connectionId, schema, name, queryClient, visible, database));
  const indexes = useQuery(indexesQuery(connectionId, schema, name, queryClient, visible, database));
  const enrichment = useTableStructureEnrichment({
    connectionId,
    database,
    engine,
    schema,
    table: name,
    columns: columns.data,
    visible,
  });
  const table = [{ schema, name }];
  const toast = useToast();
  // RN-GRADE-012: F5 recarrega a vista, como o "Atualizar" dela.
  const refreshByKey = useCallback(() => void refresh([{ schema, name }]), [refresh, schema, name]);
  useRefreshSlot(refreshSlot, refreshByKey);

  // Tabela ou visão, pelo que a árvore já carregou. Só lê o cache: `enabled: false` nunca busca, e a árvore que abrir o grupo depois o preenche.
  const tables = useQuery(treeQuery({ type: "objects", connectionId, ...inDatabase(database), schema, objects: "tables" }, queryClient, false));
  const views = useQuery(treeQuery({ type: "objects", connectionId, ...inDatabase(database), schema, objects: "views" }, queryClient, false));
  const kind = objectKindOf(name, { tables: tables.data, views: views.data });

  // RN-TABELA-008: só com as três listas na mão (uma que falhou, ou que ainda carrega, deixa o DDL de fora e a seção diz por quê); uma visão não tem.
  const ddl = useMemo(
    () => ddlState({ engine, schema, name, kind, columns: columns.data, foreignKeys: foreignKeys.data, indexes: indexes.data }),
    [engine, schema, name, kind, columns.data, foreignKeys.data, indexes.data],
  );

  async function copyDdl(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(workbenchCopy.tableTab.structure.ddl.copied);
    } catch {
      toast.warning(workbenchCopy.tableTab.structure.ddl.notCopied);
    }
  }

  return (
    <StructureSections
      section={section}
      onSection={setSection}
      columns={{ view: levelView(columns), rows: columns.data === undefined ? [] : structureColumns(columns.data, foreignKeys.data) }}
      foreignKeys={{ view: levelView(foreignKeys), rows: foreignKeys.data === undefined ? [] : structureForeignKeys(foreignKeys.data, schema) }}
      indexes={{ view: levelView(indexes), rows: indexes.data === undefined ? [] : structureIndexes(indexes.data) }}
      ddl={ddl}
      onCopyDdl={(text) => void copyDdl(text)}
      fetching={columns.isFetching || foreignKeys.isFetching || indexes.isFetching}
      onRefresh={() => void refresh(table)}
      onRetry={() => void refresh(table)}
      onOpenDiagram={onOpenDiagram}
      tableName={name}
      enrichment={enrichment}
      selectedColumn={selectedColumn}
      onSelectColumn={setSelectedColumn}
    />
  );
}
