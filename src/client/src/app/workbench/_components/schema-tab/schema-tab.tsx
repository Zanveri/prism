import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";
import { type Preferences } from "@/app/settings/_lib/preferences";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button, EngineTag, RefreshIcon, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { DatabaseObject, SchemaDiagram } from "../../_lib/database-sessions.schema";
import { inDatabase, type ObjectsKind } from "../../_lib/navigator-model";
import { layoutSchemaDiagram, type ColumnsMode } from "../../_lib/schema-diagram";
import { tabEntries } from "../../_lib/tab-focus";
import { recall, remember, type DiagramMemory } from "../../_lib/tab-memory";
import { createRefreshSlot, refreshFromKey, useRefreshSlot, type RefreshSlot } from "../../_lib/tab-refresh";
import type { TableRef } from "../../_lib/table-diagram";
import { levelView } from "../../_lib/table-structure";
import { refreshSchema, schemaDiagramQuery, schemaObjectsQuery } from "../../_lib/table-structure.service";
import { tabForKey } from "../../_lib/table-view";
import type { SchemaTab, SchemaTarget, SchemaView, TableView } from "../../_lib/workbench-model";
import { workbenchCopy } from "../../_lib/workbench.copy";
import { DiagramCanvas } from "../table-tab/diagram-canvas";
import { DisconnectedView } from "../table-tab/disconnected-view";

const copy = workbenchCopy.schemaTab;

export const schemaViews: readonly SchemaView[] = ["tables", "views", "routines", "diagram"];

export function schemaViewOf(requested: SchemaView): SchemaView {
  return schemaViews.includes(requested) ? requested : "tables";
}

export const schemaViewTabId = (tabId: string, view: SchemaView) => `schema-view-${tabId}-${view}`;
export const schemaViewPanelId = (tabId: string) => `schema-view-panel-${tabId}`;

export function SchemaViewTabs({
  tabId,
  view,
  onChange,
}: {
  tabId: string;
  view: SchemaView;
  onChange: (view: SchemaView) => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next = tabForKey(schemaViews, view, event.key);
    if (next === null) return;
    event.preventDefault();
    onChange(next);
    document.getElementById(schemaViewTabId(tabId, next))?.focus();
  }

  return (
    <div role="tablist" aria-label={copy.viewsLabel} className="flex gap-1 rounded-lg border border-border bg-background p-[3px]">
      {schemaViews.map((item) => {
        const selected = item === view;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            id={schemaViewTabId(tabId, item)}
            aria-selected={selected}
            aria-controls={schemaViewPanelId(tabId)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item)}
            onKeyDown={handleKeyDown}
            className={cn("flex h-7 cursor-pointer items-center rounded-md px-3.5 transition-colors", selected ? "bg-selected font-semibold text-ink" : "text-muted hover:text-ink")}
          >
            {copy.views[item]}
          </button>
        );
      })}
    </div>
  );
}

export function SchemaObjectsBody({
  kind,
  objects,
  filter,
  onFilterChange,
  fetching,
  onRefresh,
  onOpenTable,
}: {
  kind: ObjectsKind;
  objects: readonly DatabaseObject[];
  filter: string;
  onFilterChange: (value: string) => void;
  fetching: boolean;
  onRefresh: () => void;
  onOpenTable: (name: string, view?: TableView) => void;
}) {
  const normalized = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => (normalized.length === 0 ? objects : objects.filter((obj) => obj.name.toLowerCase().includes(normalized) || (obj.comment?.toLowerCase().includes(normalized) ?? false))),
    [objects, normalized],
  );

  const emptyMessage = kind === "tables" ? copy.emptyTables : kind === "views" ? copy.emptyViews : copy.emptyRoutines;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-border bg-panel px-3 py-1.5 text-xs">
        <input
          type="search"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder={copy.filterPlaceholder}
          aria-label={copy.filterPlaceholder}
          className="h-7 w-64 rounded-md border border-border bg-background px-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
        />
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onRefresh} disabled={fetching}>
          <RefreshIcon />
          {copy.refresh}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="p-4 text-muted">{emptyMessage}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-panel text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">{copy.columns.name}</th>
                {kind === "tables" ? <th className="px-3 py-2 font-medium">{copy.columns.estimatedRows}</th> : null}
                {kind === "routines" ? <th className="px-3 py-2 font-medium">{copy.columns.kind}</th> : null}
                <th className="px-3 py-2 font-medium">{copy.columns.description}</th>
                {kind !== "routines" ? <th className="px-3 py-2 text-right font-medium" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((item) => (
                <tr key={item.name} className="hover:bg-hover/50">
                  <td className="px-3 py-2 font-mono font-medium text-ink">{item.name}</td>
                  {kind === "tables" ? (
                    <td className="px-3 py-2 font-mono text-muted">
                      {item.estimatedRows !== null && item.estimatedRows !== undefined ? item.estimatedRows.toLocaleString("pt-BR") : "—"}
                    </td>
                  ) : null}
                  {kind === "routines" ? <td className="px-3 py-2 font-mono text-muted">{item.kind}</td> : null}
                  <td className="px-3 py-2 text-muted">{item.comment ?? "—"}</td>
                  {kind !== "routines" ? (
                    <td className="px-3 py-1.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Button type="button" variant="secondary" size="compact" className="h-6 px-2 text-xs" onClick={() => onOpenTable(item.name, "data")}>
                          {kind === "tables" ? copy.openTable : copy.openView}
                        </Button>
                        {kind === "tables" ? (
                          <Button type="button" variant="secondary" size="compact" className="h-6 px-2 text-xs" onClick={() => onOpenTable(item.name, "diagram")}>
                            {copy.openDiagram}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SchemaDiagramBody({
  schema,
  database,
  diagram,
  columnsMode,
  onColumnsModeChange,
  fetching,
  onRefresh,
  onOpenTable,
  initial,
  onViewChange,
  preferences,
}: {
  schema: string;
  database?: string;
  diagram: SchemaDiagram;
  columnsMode: ColumnsMode;
  onColumnsModeChange: (mode: ColumnsMode) => void;
  fetching: boolean;
  onRefresh: () => void;
  onOpenTable: (ref: TableRef) => void;
  initial?: DiagramMemory;
  onViewChange?: (view: DiagramMemory) => void;
  preferences?: Preferences;
}) {
  const layout = useMemo(() => layoutSchemaDiagram(schema, diagram, { columnsMode }), [schema, diagram, columnsMode]);

  if (diagram.tables.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="text-muted">{copy.emptyDiagram}</p>
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onRefresh} disabled={fetching}>
          <RefreshIcon />
          {copy.refresh}
        </Button>
      </div>
    );
  }

  return (
    <DiagramCanvas
      layout={layout}
      schema={schema}
      subject={database === undefined ? schema : `${database}-${schema}`}
      diagramLabel="Diagrama do esquema"
      tableCount={diagram.tables.length}
      foreignKeyCount={diagram.foreignKeys.length}
      omitted={0}
      fetching={fetching}
      onOpenTable={onOpenTable}
      onRefresh={onRefresh}
      initial={initial}
      onViewChange={onViewChange}
      preferences={preferences}
      columnsMode={columnsMode}
      onColumnsModeChange={onColumnsModeChange}
      showIncomingNotice={false}
      enableTableFilter
    />
  );
}

function useSchemaRefresh(connectionId: string, schema: string, database?: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useCallback(async () => {
    const { sessionReopened } = await refreshSchema(queryClient, connectionId, schema, database);
    if (sessionReopened) toast.warning(workbenchCopy.toasts.sessionReopened);
  }, [queryClient, toast, connectionId, schema, database]);
}

function SchemaObjectsView({
  connectionId,
  database,
  schema,
  kind,
  visible,
  onOpenTable,
  refreshSlot,
}: {
  connectionId: string;
  database?: string;
  schema: string;
  kind: ObjectsKind;
  visible: boolean;
  onOpenTable: (ref: TableRef & { view?: TableView }) => void;
  refreshSlot?: RefreshSlot;
}) {
  const queryClient = useQueryClient();
  const refresh = useSchemaRefresh(connectionId, schema, database);
  const [filter, setFilter] = useState("");
  const query = useQuery(schemaObjectsQuery(connectionId, schema, kind, queryClient, visible, database));

  const refreshByKey = useCallback(() => void refresh(), [refresh]);
  useRefreshSlot(refreshSlot, refreshByKey);

  const state = levelView(query);
  if (state.kind === "error") {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="break-words whitespace-pre-wrap text-danger">{state.message}</p>
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={() => void refresh()}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  if (query.data === undefined) {
    return (
      <p role="status" className="p-4 text-muted">
        {copy.loading}
      </p>
    );
  }

  return (
    <SchemaObjectsBody
      kind={kind}
      objects={query.data}
      filter={filter}
      onFilterChange={setFilter}
      fetching={query.isFetching}
      onRefresh={() => void refresh()}
      onOpenTable={(name, view) => onOpenTable({ schema, name, view })}
    />
  );
}

function SchemaDiagramView({
  tabId,
  connectionId,
  database,
  schema,
  visible,
  onOpenTable,
  refreshSlot,
}: {
  tabId: string;
  connectionId: string;
  database?: string;
  schema: string;
  visible: boolean;
  onOpenTable: (ref: TableRef) => void;
  refreshSlot?: RefreshSlot;
}) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const refresh = useSchemaRefresh(connectionId, schema, database);
  const query = useQuery(schemaDiagramQuery(connectionId, schema, queryClient, visible, database));
  const [columnsMode, setColumnsMode] = useState<ColumnsMode>("all");

  const rememberView = useCallback((view: DiagramMemory) => remember(tabId, "diagram", view), [tabId]);
  const refreshByKey = useCallback(() => void refresh(), [refresh]);
  useRefreshSlot(refreshSlot, refreshByKey);

  const state = levelView(query);
  if (state.kind === "error") {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="break-words whitespace-pre-wrap text-danger">{state.message}</p>
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={() => void refresh()}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  if (query.data === undefined) {
    return (
      <p role="status" className="p-4 text-muted">
        {copy.loading}
      </p>
    );
  }

  return (
    <SchemaDiagramBody
      schema={schema}
      database={database}
      diagram={query.data}
      columnsMode={columnsMode}
      onColumnsModeChange={setColumnsMode}
      fetching={query.isFetching}
      onRefresh={() => void refresh()}
      onOpenTable={onOpenTable}
      initial={recall(tabId, "diagram")}
      onViewChange={rememberView}
      preferences={preferences}
    />
  );
}

type SchemaTabPanelProps = {
  tab: SchemaTab;
  schemaTarget: SchemaTarget;
  connection: Connection | undefined;
  environment: ShownEnvironment | null;
  visible: boolean;
  disconnected: boolean;
  onView: (tabId: string, view: SchemaView) => void;
  onOpenTable: (connectionId: string, table: TableRef & { view?: TableView; database?: string }) => void;
};

export const SchemaTabPanel = memo(function SchemaTabPanel({
  tab,
  schemaTarget,
  connection,
  environment,
  visible,
  disconnected,
  onView,
  onOpenTable,
}: SchemaTabPanelProps) {
  const { schema } = schemaTarget;
  const view = schemaViewOf(schemaTarget.view);

  const panel = useRef<HTMLDivElement>(null);
  const wasDisconnected = useRef(disconnected);
  useEffect(() => {
    if (wasDisconnected.current && !disconnected && document.activeElement === document.body) panel.current?.focus({ preventScroll: true });
    wasDisconnected.current = disconnected;
  }, [disconnected]);

  useEffect(
    () =>
      tabEntries.register(tab.id, () => {
        if (panel.current === null) return false;
        panel.current.focus({ preventScroll: true });
        return true;
      }),
    [tab.id],
  );

  const [refreshSlot] = useState(createRefreshSlot);
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    refreshFromKey(event, refreshSlot);
  }

  return (
    <div onKeyDown={handleKeyDown} className="flex min-h-0 flex-1 flex-col text-sm">
      <header className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border bg-panel px-3 py-1.5">
        {connection ? <EngineTag engine={connection.engine} /> : null}
        <h2 className="font-mono text-[15px] leading-[22px] font-semibold text-ink">{schema}</h2>
        {connection ? <span className="text-xs text-muted">{copy.location(connection.name, tab.database ?? connection.database)}</span> : null}
        {connection ? <ShownEnvironmentPill environment={environment} /> : null}
        <SchemaViewTabs tabId={tab.id} view={view} onChange={(next) => onView(tab.id, next)} />
      </header>

      <div ref={panel} tabIndex={-1} role="tabpanel" id={schemaViewPanelId(tab.id)} aria-labelledby={schemaViewTabId(tab.id, view)} className="flex min-h-0 flex-1 flex-col">
        {disconnected ? <DisconnectedView connectionId={tab.connectionId} database={tab.database} /> : null}
        {!disconnected && view !== "diagram" ? (
          <SchemaObjectsView
            connectionId={tab.connectionId}
            database={tab.database}
            schema={schema}
            kind={view}
            visible={visible}
            onOpenTable={(ref) => onOpenTable(tab.connectionId, { ...ref, ...inDatabase(tab.database) })}
            refreshSlot={refreshSlot}
          />
        ) : null}
        {!disconnected && view === "diagram" ? (
          <SchemaDiagramView
            tabId={tab.id}
            connectionId={tab.connectionId}
            database={tab.database}
            schema={schema}
            visible={visible}
            onOpenTable={(ref) => onOpenTable(tab.connectionId, { ...ref, ...inDatabase(tab.database) })}
            refreshSlot={refreshSlot}
          />
        ) : null}
      </div>
    </div>
  );
});
