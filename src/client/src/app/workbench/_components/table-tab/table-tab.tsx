import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";
import { EngineTag } from "@/components/ui";

import { inDatabase } from "../../_lib/navigator-model";
import { tabEntries } from "../../_lib/tab-focus";
import { createRefreshSlot, refreshFromKey } from "../../_lib/tab-refresh";
import type { TableRef } from "../../_lib/table-diagram";
import { tableViews, viewOf } from "../../_lib/table-view";
import type { QueryRunner } from "../../_lib/use-query-runner";
import type { TableTab, TableTarget, TableView } from "../../_lib/workbench-model";
import { workbenchCopy } from "../../_lib/workbench.copy";
import type { FilterFieldHandle } from "../filter-field";
import { DiagramView } from "./diagram-view";
import { DisconnectedView } from "./disconnected-view";
import { RecordsView } from "./records-view";
import { StructureView } from "./structure-view";
import { tableViewPanelId, tableViewTabId, TableViewTabs } from "./table-view-tabs";

const copy = workbenchCopy.tableTab;

type TableTabPanelProps = {
  tab: TableTab;
  /** A tabela da aba (RN-TABELA-001): o `table` dela, que quem monta o painel já conferiu que existe. */
  table: TableTarget;
  /** O que a aba executa e mostra; os registros vêm dele, como numa consulta. */
  runner: QueryRunner;
  /** A conexão da aba; `undefined` enquanto a lista não chega. */
  connection: Connection | undefined;
  /** O ambiente que a conexão mostra (RN-PASTA-005): o próprio, ou o herdado da pasta. É o mesmo objeto enquanto nada muda (`environmentLookup`). */
  environment: ShownEnvironment | null;
  /** A aba está À VISTA: é a ativa e a área de trabalho é a tela mostrada. A escondida não fala com o banco (RN-SEG-001). */
  visible: boolean;
  /** A pessoa desconectou a conexão e ainda não a reconectou: nada reconecta sozinho (`connection-intent.ts`). */
  disconnected: boolean;
  onView: (tabId: string, view: TableView) => void;
  /** Abre a aba de outra tabela da mesma conexão: o duplo clique numa vizinha do diagrama e o valor de uma chave estrangeira (RN-TABELA-007, na vista Registros). */
  onOpenTable: (connectionId: string, table: TableRef & { view?: TableView; database?: string }) => void;
  /** RN-GRADE-018: o "Abrir numa aba de consulta" do "Gerar SQL" dos Registros: a aba nova da conexão e do banco desta, com o texto. Estável. */
  onOpenQuery?: (connectionId: string, sql: string, database?: string) => void;
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
export const TableTabPanel = memo(function TableTabPanel({ tab, table, runner, connection, environment, visible, disconnected, onView, onOpenTable, onOpenQuery }: TableTabPanelProps) {
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

  // RN-ABAS-019: a entrada da aba, onde o foco cai quando abrir a tabela (o duplo clique, o Enter, o menu do navegador) o leva "para a aba": nos Registros, o campo
  // de filtro, com o cursor no fim, onde o Ctrl+Espaço completa as colunas e as palavras do filtro (RN-TABELA-011); na Estrutura e no Diagrama, o painel da vista,
  // onde o F5 vale (RN-GRADE-012), conectada a conexão ou não. Quem decide QUANDO é a área das abas; a vista de agora é lida na hora, por ref.
  const filter = useRef<FilterFieldHandle>(null);
  const viewNow = useRef(view);
  useEffect(() => {
    viewNow.current = view;
  });
  useEffect(
    () =>
      tabEntries.register(tab.id, () => {
        if (viewNow.current === "data" && filter.current !== null) {
          filter.current.focus();
          return true;
        }
        if (panel.current === null) return false;
        panel.current.focus({ preventScroll: true });
        return true;
      }),
    [tab.id],
  );

  // RN-GRADE-012: F5 com o foco em qualquer ponto da aba chama o "Atualizar" da vista à vista, que o deixa aqui (`useRefreshSlot`).
  const [refreshSlot] = useState(createRefreshSlot);
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    refreshFromKey(event, refreshSlot);
  }

  return (
    <div onKeyDown={handleKeyDown} className="flex min-h-0 flex-1 flex-col text-sm">
      <header className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-panel px-3 py-1.5">
        {connection ? <EngineTag engine={connection.engine} /> : null}
        <h2 className="font-mono text-[15px] leading-[22px] font-semibold text-ink">{name}</h2>
        {connection ? <span className="text-xs text-muted">{copy.location(connection.name, tab.database ?? connection.database, schema)}</span> : null}
        {connection ? <ShownEnvironmentPill environment={environment} /> : null}
        <TableViewTabs tabId={tab.id} view={view} onChange={(next) => onView(tab.id, next)} />
      </header>

      <div ref={panel} tabIndex={-1} role={hasViews ? "tabpanel" : undefined} id={tableViewPanelId(tab.id)} aria-labelledby={hasViews ? tableViewTabId(tab.id, view) : undefined} className="flex min-h-0 flex-1 flex-col">
        {view === "data" ? <RecordsView tabId={tab.id} runner={runner} engine={connection?.engine} connectionId={tab.connectionId} database={tab.database} schema={schema} name={name} connected={tab.sessionId !== null} environmentColor={environment?.color ?? null} visible={visible} disconnected={disconnected} onOpenTable={(ref) => onOpenTable(tab.connectionId, { ...ref, ...inDatabase(tab.database) })} onOpenQuery={onOpenQuery} refreshSlot={refreshSlot} filterRef={filter} /> : null}
        {view !== "data" && disconnected ? <DisconnectedView connectionId={tab.connectionId} database={tab.database} /> : null}
        {view === "structure" && !disconnected ? <StructureView tabId={tab.id} connectionId={tab.connectionId} database={tab.database} engine={connection?.engine} schema={schema} name={name} visible={visible} onOpenDiagram={() => onView(tab.id, "diagram")} refreshSlot={refreshSlot} /> : null}
        {view === "diagram" && !disconnected ? (
          <DiagramView
            connectionId={tab.connectionId}
            database={tab.database}
            schema={schema}
            name={name}
            visible={visible}
            onOpenTable={(ref) => onOpenTable(tab.connectionId, { ...ref, ...inDatabase(tab.database) })}
            onOpenData={(ref) =>
              ref.schema === schema && ref.name === name
                ? onView(tab.id, "data")
                : onOpenTable(tab.connectionId, { ...ref, view: "data", ...inDatabase(tab.database) })
            }
            onOpenStructure={(ref) =>
              ref.schema === schema && ref.name === name
                ? onView(tab.id, "structure")
                : onOpenTable(tab.connectionId, { ...ref, view: "structure", ...inDatabase(tab.database) })
            }
            onGenerateSelect={
              onOpenQuery
                ? (ref) => onOpenQuery(tab.connectionId, `SELECT *\nFROM ${ref.schema}.${ref.name}\nLIMIT 100;`, tab.database)
                : undefined
            }
            memoryKey={tab.id}
            refreshSlot={refreshSlot}
          />
        ) : null}
      </div>
    </div>
  );
});
