import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { ShownEnvironmentPill } from "@/app/connections/_components/shown-environment-pill";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import type { ShownEnvironment } from "@/app/connections/_lib/environment";
import { type Preferences } from "@/app/settings/_lib/preferences";
import { usePreferences } from "@/app/settings/_lib/use-preferences";
import { Button, EngineTag, RefreshIcon, useToast } from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { DatabaseProperty, DatabaseSchema, SchemaDiagram } from "../../_lib/database-sessions.schema";
import { inDatabase } from "../../_lib/navigator-model";
import { layoutDatabaseDiagram, type ColumnsMode } from "../../_lib/schema-diagram";
import { tabEntries } from "../../_lib/tab-focus";
import { recall, remember, type DiagramMemory } from "../../_lib/tab-memory";
import { createRefreshSlot, refreshFromKey, useRefreshSlot, type RefreshSlot } from "../../_lib/tab-refresh";
import type { TableRef } from "../../_lib/table-diagram";
import { levelView } from "../../_lib/table-structure";
import { databasePropertiesQuery, databaseSchemasQuery, refreshDatabase, schemaDiagramQuery } from "../../_lib/table-structure.service";
import { tabForKey } from "../../_lib/table-view";
import type { DatabaseTab, DatabaseTarget, DatabaseView, SchemaView, TableView } from "../../_lib/workbench-model";
import { workbenchCopy } from "../../_lib/workbench.copy";
import { DiagramCanvas } from "../table-tab/diagram-canvas";
import { DisconnectedView } from "../table-tab/disconnected-view";

const copy = workbenchCopy.databaseTab;

export const databaseViews: readonly DatabaseView[] = ["schemas", "diagram", "properties"];

export function databaseViewOf(requested: DatabaseView): DatabaseView {
  return databaseViews.includes(requested) ? requested : "schemas";
}

export const databaseViewTabId = (tabId: string, view: DatabaseView) => `database-view-${tabId}-${view}`;
export const databaseViewPanelId = (tabId: string) => `database-view-panel-${tabId}`;

export function DatabaseViewTabs({
  tabId,
  view,
  onChange,
}: {
  tabId: string;
  view: DatabaseView;
  onChange: (view: DatabaseView) => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next = tabForKey(databaseViews, view, event.key);
    if (next === null) return;
    event.preventDefault();
    onChange(next);
    document.getElementById(databaseViewTabId(tabId, next))?.focus();
  }

  return (
    <div role="tablist" aria-label={copy.viewsLabel} className="flex gap-1 rounded-lg border border-border bg-background p-[3px]">
      {databaseViews.map((item) => {
        const selected = item === view;
        return (
          <button
            key={item}
            type="button"
            role="tab"
            id={databaseViewTabId(tabId, item)}
            aria-selected={selected}
            aria-controls={databaseViewPanelId(tabId)}
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

export function DatabaseSchemasBody({
  schemas,
  filter,
  onFilterChange,
  includeSystemSchemas,
  onIncludeSystemSchemasChange,
  fetching,
  onRefresh,
  onOpenSchema,
}: {
  schemas: readonly DatabaseSchema[];
  filter: string;
  onFilterChange: (value: string) => void;
  includeSystemSchemas: boolean;
  onIncludeSystemSchemasChange: (value: boolean) => void;
  fetching: boolean;
  onRefresh: () => void;
  onOpenSchema: (schema: string, view?: SchemaView) => void;
}) {
  const normalized = filter.trim().toLowerCase();
  const filtered = useMemo(
    () => (normalized.length === 0 ? schemas : schemas.filter((item) => item.name.toLowerCase().includes(normalized))),
    [schemas, normalized],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-b border-border bg-panel px-3 py-1.5 text-xs">
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={filter}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder={copy.filterPlaceholder}
            aria-label={copy.filterPlaceholder}
            className="h-7 w-64 rounded-md border border-border bg-background px-2 text-xs text-ink placeholder:text-subtle focus:border-accent focus:outline-none"
          />
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted select-none hover:text-ink">
            <input
              type="checkbox"
              checked={includeSystemSchemas}
              onChange={(event) => onIncludeSystemSchemasChange(event.target.checked)}
              className="rounded border-border"
            />
            {copy.includeSystemSchemas}
          </label>
        </div>
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onRefresh} disabled={fetching}>
          <RefreshIcon />
          {copy.refresh}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <p className="p-4 text-muted">{copy.emptySchemas}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-panel text-muted">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">{copy.columns.name}</th>
                <th className="px-3 py-2 font-medium">{copy.columns.system}</th>
                <th className="px-3 py-2 font-medium">{copy.columns.tableCount}</th>
                <th className="px-3 py-2 font-medium">{copy.columns.viewCount}</th>
                <th className="px-3 py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((item) => (
                <tr key={item.name} className="hover:bg-hover/50">
                  <td className="px-3 py-2 font-mono font-medium text-ink">{item.name}</td>
                  <td className="px-3 py-2 font-mono text-muted">{item.isSystem ? copy.systemSchema : copy.userSchema}</td>
                  <td className="px-3 py-2 font-mono text-muted">{item.tables !== null && item.tables !== undefined ? item.tables.toLocaleString("pt-BR") : "—"}</td>
                  <td className="px-3 py-2 font-mono text-muted">{item.views !== null && item.views !== undefined ? item.views.toLocaleString("pt-BR") : "—"}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button type="button" variant="secondary" size="compact" className="h-6 px-2 text-xs" onClick={() => onOpenSchema(item.name, "tables")}>
                        {copy.openSchema}
                      </Button>
                      <Button type="button" variant="secondary" size="compact" className="h-6 px-2 text-xs" onClick={() => onOpenSchema(item.name, "diagram")}>
                        {copy.openSchemaDiagram}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DatabaseDiagramBody({
  database,
  schemas,
  columnsMode,
  onColumnsModeChange,
  fetching,
  onRefresh,
  onOpenTable,
  initial,
  onViewChange,
  preferences,
}: {
  database: string;
  schemas: readonly { schema: string; diagram: SchemaDiagram }[];
  columnsMode: ColumnsMode;
  onColumnsModeChange: (mode: ColumnsMode) => void;
  fetching: boolean;
  onRefresh: () => void;
  onOpenTable: (ref: TableRef) => void;
  initial?: DiagramMemory;
  onViewChange?: (view: DiagramMemory) => void;
  preferences?: Preferences;
}) {
  const layout = useMemo(() => layoutDatabaseDiagram(schemas, { columnsMode }), [schemas, columnsMode]);
  const tableCount = useMemo(() => schemas.reduce((sum, item) => sum + item.diagram.tables.length, 0), [schemas]);
  const foreignKeyCount = useMemo(() => schemas.reduce((sum, item) => sum + item.diagram.foreignKeys.length, 0), [schemas]);

  if (tableCount === 0) {
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
      schema={database}
      subject={database}
      diagramLabel="Diagrama do banco"
      tableCount={tableCount}
      foreignKeyCount={foreignKeyCount}
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

export function DatabasePropertiesBody({
  properties,
  fetching,
  onRefresh,
}: {
  properties: readonly DatabaseProperty[];
  fetching: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-none items-center justify-between gap-2 border-b border-border bg-panel px-3 py-1.5 text-xs">
        <span className="font-medium text-muted">{copy.properties.label}</span>
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={onRefresh} disabled={fetching}>
          <RefreshIcon />
          {copy.refresh}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {properties.length === 0 ? (
          <p className="text-xs text-muted">{copy.properties.notAvailable}</p>
        ) : (
          <dl className="grid max-w-2xl grid-cols-[12rem_1fr] gap-x-4 gap-y-3 text-xs">
            {properties.map((row) => (
              <div key={row.name} className="contents">
                <dt className="font-medium text-muted">{row.name}</dt>
                <dd className="font-mono text-ink">{row.value || copy.properties.notAvailable}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function useDatabaseRefresh(connectionId: string, database?: string) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useCallback(async () => {
    const { sessionReopened } = await refreshDatabase(queryClient, connectionId, database);
    if (sessionReopened) toast.warning(workbenchCopy.toasts.sessionReopened);
  }, [queryClient, toast, connectionId, database]);
}

function DatabaseSchemasView({
  connectionId,
  database,
  visible,
  onOpenSchema,
  refreshSlot,
}: {
  connectionId: string;
  database?: string;
  visible: boolean;
  onOpenSchema: (schema: string, view?: SchemaView) => void;
  refreshSlot?: RefreshSlot;
}) {
  const queryClient = useQueryClient();
  const refresh = useDatabaseRefresh(connectionId, database);
  const [filter, setFilter] = useState("");
  const [includeSystemSchemas, setIncludeSystemSchemas] = useState(false);
  const query = useQuery(databaseSchemasQuery(connectionId, queryClient, database, visible));

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
    <DatabaseSchemasBody
      schemas={query.data}
      filter={filter}
      onFilterChange={setFilter}
      includeSystemSchemas={includeSystemSchemas}
      onIncludeSystemSchemasChange={setIncludeSystemSchemas}
      fetching={query.isFetching}
      onRefresh={() => void refresh()}
      onOpenSchema={onOpenSchema}
    />
  );
}

function DatabaseDiagramView({
  tabId,
  connectionId,
  database,
  databaseName,
  visible,
  onOpenTable,
  refreshSlot,
}: {
  tabId: string;
  connectionId: string;
  database?: string;
  databaseName: string;
  visible: boolean;
  onOpenTable: (ref: TableRef) => void;
  refreshSlot?: RefreshSlot;
}) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const refresh = useDatabaseRefresh(connectionId, database);
  const schemasQuery = useQuery(databaseSchemasQuery(connectionId, queryClient, database, visible));
  const [columnsMode, setColumnsMode] = useState<ColumnsMode>("all");

  const rememberView = useCallback((view: DiagramMemory) => remember(tabId, "diagram", view), [tabId]);
  const refreshByKey = useCallback(() => void refresh(), [refresh]);
  useRefreshSlot(refreshSlot, refreshByKey);

  const targetSchemas = useMemo(() => {
    const all = schemasQuery.data ?? [];
    const userSchemas = all.filter((item) => !item.isSystem);
    return (userSchemas.length > 0 ? userSchemas : all).map((item) => item.name);
  }, [schemasQuery.data]);

  const diagramQueries = useQueries({
    queries: targetSchemas.map((schemaName) => schemaDiagramQuery(connectionId, schemaName, queryClient, visible && schemasQuery.data !== undefined, database)),
  });

  const schemasState = levelView(schemasQuery);
  if (schemasState.kind === "error") {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="break-words whitespace-pre-wrap text-danger">{schemasState.message}</p>
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={() => void refresh()}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  const firstFailedDiagram = diagramQueries.map((q) => levelView(q)).find((s) => s.kind === "error");
  if (firstFailedDiagram && firstFailedDiagram.kind === "error") {
    return (
      <div className="flex flex-col items-start gap-3 p-4">
        <p className="break-words whitespace-pre-wrap text-danger">{firstFailedDiagram.message}</p>
        <Button type="button" variant="secondary" size="compact" className="h-7 px-2.5 text-xs" onClick={() => void refresh()}>
          {copy.retry}
        </Button>
      </div>
    );
  }

  const pendingDiagrams = schemasQuery.data === undefined || diagramQueries.some((q) => q.data === undefined);
  if (pendingDiagrams) {
    return (
      <p role="status" className="p-4 text-muted">
        {copy.loading}
      </p>
    );
  }

  const loadedSchemas = targetSchemas.map((schemaName, index) => ({
    schema: schemaName,
    diagram: diagramQueries[index]!.data!,
  }));
  const fetching = schemasQuery.isFetching || diagramQueries.some((q) => q.isFetching);

  return (
    <DatabaseDiagramBody
      database={databaseName}
      schemas={loadedSchemas}
      columnsMode={columnsMode}
      onColumnsModeChange={setColumnsMode}
      fetching={fetching}
      onRefresh={() => void refresh()}
      onOpenTable={onOpenTable}
      initial={recall(tabId, "diagram")}
      onViewChange={rememberView}
      preferences={preferences}
    />
  );
}

function DatabasePropertiesView({
  connectionId,
  database,
  visible,
  refreshSlot,
}: {
  connectionId: string;
  database?: string;
  visible: boolean;
  refreshSlot?: RefreshSlot;
}) {
  const queryClient = useQueryClient();
  const refresh = useDatabaseRefresh(connectionId, database);
  const query = useQuery(databasePropertiesQuery(connectionId, queryClient, database, visible));

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

  return <DatabasePropertiesBody properties={query.data} fetching={query.isFetching} onRefresh={() => void refresh()} />;
}

type DatabaseTabPanelProps = {
  tab: DatabaseTab;
  databaseTarget: DatabaseTarget;
  connection: Connection | undefined;
  environment: ShownEnvironment | null;
  visible: boolean;
  disconnected: boolean;
  onView: (tabId: string, view: DatabaseView) => void;
  onOpenSchema: (connectionId: string, target: { schema: string; view?: SchemaView; database?: string }) => void;
  onOpenTable: (connectionId: string, table: TableRef & { view?: TableView; database?: string }) => void;
};

export const DatabaseTabPanel = memo(function DatabaseTabPanel({
  tab,
  databaseTarget,
  connection,
  environment,
  visible,
  disconnected,
  onView,
  onOpenSchema,
  onOpenTable,
}: DatabaseTabPanelProps) {
  const { name } = databaseTarget;
  const view = databaseViewOf(databaseTarget.view);

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
        <h2 className="font-mono text-[15px] leading-[22px] font-semibold text-ink">{name}</h2>
        {connection ? <span className="text-xs text-muted">{copy.location(connection.name)}</span> : null}
        {connection ? <ShownEnvironmentPill environment={environment} /> : null}
        <DatabaseViewTabs tabId={tab.id} view={view} onChange={(next) => onView(tab.id, next)} />
      </header>

      <div ref={panel} tabIndex={-1} role="tabpanel" id={databaseViewPanelId(tab.id)} aria-labelledby={databaseViewTabId(tab.id, view)} className="flex min-h-0 flex-1 flex-col">
        {disconnected ? <DisconnectedView connectionId={tab.connectionId} database={tab.database} /> : null}
        {!disconnected && view === "schemas" ? (
          <DatabaseSchemasView
            connectionId={tab.connectionId}
            database={tab.database}
            visible={visible}
            onOpenSchema={(schema, schemaView) => onOpenSchema(tab.connectionId, { schema, view: schemaView, ...inDatabase(tab.database) })}
            refreshSlot={refreshSlot}
          />
        ) : null}
        {!disconnected && view === "diagram" ? (
          <DatabaseDiagramView
            tabId={tab.id}
            connectionId={tab.connectionId}
            database={tab.database}
            databaseName={name}
            visible={visible}
            onOpenTable={(ref) => onOpenTable(tab.connectionId, { ...ref, ...inDatabase(tab.database) })}
            refreshSlot={refreshSlot}
          />
        ) : null}
        {!disconnected && view === "properties" ? (
          <DatabasePropertiesView
            connectionId={tab.connectionId}
            database={tab.database}
            visible={visible}
            refreshSlot={refreshSlot}
          />
        ) : null}
      </div>
    </div>
  );
});
