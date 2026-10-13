import { memo, useEffect, useRef } from "react";

import type { Connection } from "@/app/connections/_lib/connections.schema";
import { EngineTag, EnvironmentPill } from "@/components/ui";

import { inDatabase } from "../../_lib/navigator-model";
import type { TableRef } from "../../_lib/table-diagram";
import { tableViews, viewOf } from "../../_lib/table-view";
import type { QueryRunner } from "../../_lib/use-query-runner";
import type { QueryTab, TableTarget, TableView } from "../../_lib/workbench-model";
import { workbenchCopy } from "../../_lib/workbench.copy";
import { DiagramView } from "./diagram-view";
import { DisconnectedView } from "./disconnected-view";
import { RecordsView } from "./records-view";
import { StructureView } from "./structure-view";
import { tableViewPanelId, tableViewTabId, TableViewTabs } from "./table-view-tabs";

const copy = workbenchCopy.tableTab;

type TableTabPanelProps = {
  tab: QueryTab;
  /** A tabela da aba (RN-TABELA-001): o `table` dela, que quem monta o painel já conferiu que existe. */
  table: TableTarget;
  /** O que a aba executa e mostra; os registros vêm dele, como numa consulta. */
  runner: QueryRunner;
  /** A conexão da aba; `undefined` enquanto a lista não chega. */
  connection: Connection | undefined;
  /** A aba está À VISTA: é a ativa e a área de trabalho é a tela mostrada. A escondida não fala com o banco (RN-SEG-001). */
  visible: boolean;
  /** A pessoa desconectou a conexão e ainda não a reconectou: nada reconecta sozinho (`connection-intent.ts`). */
  disconnected: boolean;
  onView: (tabId: string, view: TableView) => void;
  /** Abre a aba de outra tabela da mesma conexão: o duplo clique numa vizinha do diagrama e o valor de uma chave estrangeira (RN-TABELA-007, na vista Registros). */
  onOpenTable: (connectionId: string, table: TableRef & { view?: TableView; database?: string }) => void;
};

/**
 * O que a aba de uma tabela mostra (RN-TABELA-001): o cabeçalho do canvas (o banco, o nome da
 * tabela, onde ela está e o ambiente da conexão), o seletor de vistas e a vista ativa. Só a vista
 * ativa existe na página: as demais buscam o que mostram quando se abrem, e o que a aba já leu fica
 * guardado (os registros, no executor).
 *
 * Nada reconecta sozinho: com a conexão desconectada pela pessoa, a Estrutura e o Diagrama mostram o aviso com "Conectar", e os
 * Registros esperam o "Atualizar". E a aba escondida (`visible` falso) não busca nada até ser aberta.
 */
export const TableTabPanel = memo(function TableTabPanel({ tab, table, runner, connection, visible, disconnected, onView, onOpenTable }: TableTabPanelProps) {
  const { schema, name } = table;
  const view = viewOf(table.view);
  const hasViews = tableViews.length > 1;

  // "Conectar" tira o botão em que o foco estava, e o foco cairia no corpo da página: ele vai ao painel, que passa a mostrar a vista. Quem
  // reconecta por outro caminho (o nó da conexão no navegador) tem o foco onde o pôs, e ali ele fica. É o estado que decide, e não um aviso
  // do botão: a sessão abre, a conexão deixa de constar como desconectada e a tela se refaz antes de o clique terminar de ser tratado.
  const panel = useRef<HTMLDivElement>(null);
  const wasDisconnected = useRef(disconnected);
  useEffect(() => {
    if (wasDisconnected.current && !disconnected && document.activeElement === document.body) panel.current?.focus({ preventScroll: true });
    wasDisconnected.current = disconnected;
  }, [disconnected]);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm">
      <header className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-panel px-3 py-1.5">
        {connection ? <EngineTag engine={connection.engine} /> : null}
        <h2 className="font-mono text-[15px] leading-[22px] font-semibold text-ink">{name}</h2>
        {connection ? <span className="text-xs text-muted">{copy.location(connection.name, tab.database ?? connection.database, schema)}</span> : null}
        {connection ? <EnvironmentPill name={connection.environmentName} color={connection.environmentColor} /> : null}
        <TableViewTabs tabId={tab.id} view={view} onChange={(next) => onView(tab.id, next)} />
      </header>

      <div ref={panel} tabIndex={-1} role={hasViews ? "tabpanel" : undefined} id={tableViewPanelId(tab.id)} aria-labelledby={hasViews ? tableViewTabId(tab.id, view) : undefined} className="flex min-h-0 flex-1 flex-col">
        {view === "data" ? <RecordsView tabId={tab.id} runner={runner} engine={connection?.engine} connectionId={tab.connectionId} database={tab.database} schema={schema} name={name} connected={tab.sessionId !== null} visible={visible} disconnected={disconnected} onOpenTable={(ref) => onOpenTable(tab.connectionId, { ...ref, ...inDatabase(tab.database) })} /> : null}
        {view !== "data" && disconnected ? <DisconnectedView connectionId={tab.connectionId} database={tab.database} /> : null}
        {view === "structure" && !disconnected ? <StructureView tabId={tab.id} connectionId={tab.connectionId} database={tab.database} engine={connection?.engine} schema={schema} name={name} visible={visible} onOpenDiagram={() => onView(tab.id, "diagram")} /> : null}
        {view === "diagram" && !disconnected ? <DiagramView connectionId={tab.connectionId} database={tab.database} schema={schema} name={name} visible={visible} onOpenTable={(ref) => onOpenTable(tab.connectionId, { ...ref, ...inDatabase(tab.database) })} memoryKey={tab.id} /> : null}
      </div>
    </div>
  );
});
