import { useId, useMemo, useState } from "react";

import {
  checkStates,
  checkTree,
  markAll,
  toggle,
  unmarkAll,
} from "@/app/connections/_lib/check-tree";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import {
  BuildIcon,
  Button,
  ChevronIcon,
  Dialog,
  EngineTag,
  EnvironmentPill,
  Field,
  FieldLabel,
  FolderIcon,
  InfoIcon,
  Select,
  type SelectOption,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { BuildModel } from "../_lib/build-model.schema";
import { buildCopy } from "../_lib/build.copy";
import type { CatalogSelection } from "../_lib/catalog-import";
import {
  buildEngineOfConnection,
  catalogTreeItems,
  connectionEngineNumber,
  selectionOf,
  supportedConnections,
} from "../_lib/catalog-tree";

export type ImportTablesDialogProps = {
  open?: boolean;
  model: BuildModel;
  connections: readonly Connection[];
  databases?: readonly string[];
  schemas?: readonly { schema: string; tables: readonly string[] }[];
  initialChecked?: ReadonlySet<string>;
  readingProgress?: { done: number; total: number } | null;
  errorMessage?: string | null;
  onSelectConnection?: (connectionId: string) => void;
  onSelectDatabase?: (database: string) => void;
  onCancel: () => void;
  onCancelReading?: () => void;
  onSubmit?: (payload: {
    connectionId: string;
    database: string;
    selection: CatalogSelection;
  }) => void;
};

export function ImportTablesDialog({
  open = true,
  model,
  connections,
  databases,
  schemas = [],
  initialChecked,
  readingProgress = null,
  errorMessage = null,
  onSelectConnection,
  onSelectDatabase,
  onCancel,
  onCancelReading,
  onSubmit,
}: ImportTablesDialogProps) {
  const idPrefix = useId();
  const validConnections = useMemo(
    () => supportedConnections(connections, model.engine),
    [connections, model.engine],
  );

  const lockedToBase = model.base !== null;

  const [connectionId, setConnectionId] = useState<string>(
    model.base?.connectionId ?? validConnections[0]?.id ?? "",
  );
  const selectedConnection =
    validConnections.find((c) => c.id === connectionId) ??
    validConnections[0] ??
    null;

  const availableDatabases: readonly string[] =
    databases && databases.length > 0
      ? databases
      : model.base?.database
        ? [model.base.database]
        : selectedConnection
          ? [selectedConnection.database]
          : [];

  const [database, setDatabase] = useState<string>(
    model.base?.database ?? availableDatabases[0] ?? "",
  );
  const effectiveDatabase = availableDatabases.includes(database)
    ? database
    : (availableDatabases[0] ?? "");
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(
    () => new Set(),
  );

  const tree = useMemo(
    () => checkTree(catalogTreeItems(schemas)),
    [schemas],
  );

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialChecked ?? []),
  );

  const summary = useMemo(
    () => selectionOf(tree, checked, model),
    [tree, checked, model],
  );
  const alreadySet = useMemo(
    () => new Set(summary.alreadyInModel),
    [summary.alreadyInModel],
  );

  const effectiveChecked = useMemo(() => {
    const set = new Set(checked);
    for (const k of alreadySet) {
      set.add(k);
    }
    return set;
  }, [checked, alreadySet]);

  const states = useMemo(
    () => checkStates(tree, effectiveChecked),
    [tree, effectiveChecked],
  );

  const connectionOptions: SelectOption[] = validConnections.map((conn) => {
    const connEngine =
      buildEngineOfConnection(conn.engine) ?? model.engine;
    return {
      value: conn.id,
      label: conn.name,
      content: (
        <span className="flex items-center gap-2">
          <EngineTag engine={connectionEngineNumber(connEngine)} />
          <span className="truncate">{conn.name}</span>
          {conn.environmentName && (
            <EnvironmentPill
              name={conn.environmentName}
              color={conn.environmentColor}
            />
          )}
        </span>
      ),
    };
  });

  const databaseOptions: SelectOption[] = availableDatabases.map((db) => ({
    value: db,
    label: db,
    content: <span className="font-mono text-[13px]">{db}</span>,
  }));

  if (!open) return null;

  const isReading = readingProgress !== null;

  const handleSubmit = () => {
    if (!selectedConnection || isReading || summary.selection.length === 0) {
      return;
    }
    onSubmit?.({
      connectionId: selectedConnection.id,
      database: effectiveDatabase || selectedConnection.database,
      selection: summary.selection,
    });
  };

  return (
    <Dialog
      open={open}
      title={buildCopy.importTablesTitle}
      icon={<BuildIcon />}
      size="lg"
      pending={isReading}
      onClose={() => (isReading ? onCancelReading?.() : onCancel())}
      footer={
        <>
          <span className="mr-auto flex items-center gap-1.5 text-xs text-muted">
            <InfoIcon />
            <span>
              {readingProgress
                ? buildCopy.readingTablesProgress(
                    readingProgress.done,
                    readingProgress.total,
                  )
                : buildCopy.readOnlyCatalogNotice}
            </span>
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={isReading ? onCancelReading : onCancel}
          >
            {buildCopy.cancelButton}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={isReading || summary.selection.length === 0}
            onClick={handleSubmit}
          >
            {buildCopy.importTablesButton}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-3">
          <Field>
            <FieldLabel
              htmlFor={`${idPrefix}-conn`}
              className="flex items-center gap-2"
            >
              <span>{buildCopy.connectionLabel}</span>
              {selectedConnection?.environmentName && (
                <EnvironmentPill
                  name={selectedConnection.environmentName}
                  color={selectedConnection.environmentColor}
                />
              )}
            </FieldLabel>
            <Select
              id={`${idPrefix}-conn`}
              value={selectedConnection?.id ?? ""}
              disabled={lockedToBase || isReading}
              options={connectionOptions}
              onChange={(nextId) => {
                setConnectionId(nextId);
                const nextConn = validConnections.find((c) => c.id === nextId);
                if (nextConn) {
                  setDatabase(nextConn.database);
                }
                setChecked(new Set());
                onSelectConnection?.(nextId);
              }}
              className="min-h-9 py-1.5 text-[13px]"
            />
          </Field>

          <Field>
            <FieldLabel htmlFor={`${idPrefix}-db`}>
              {buildCopy.databaseLabel}
            </FieldLabel>
            <Select
              id={`${idPrefix}-db`}
              value={effectiveDatabase}
              disabled={lockedToBase || isReading}
              options={databaseOptions}
              onChange={(nextDb) => {
                setDatabase(nextDb);
                setChecked(new Set());
                onSelectDatabase?.(nextDb);
              }}
              className="min-h-9 py-1.5 font-mono text-[13px]"
            />
          </Field>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span id="importar-legenda" className="text-sm text-muted">
              {buildCopy.schemasAndTablesLegend}
            </span>
            <span className="text-xs text-muted">
              {buildCopy.markedCount(
                summary.counts.checked,
                summary.counts.total,
              )}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="compact"
              disabled={isReading}
              onClick={() => setChecked((prev) => markAll(tree, prev))}
              className="ml-auto h-7 px-2.5 text-xs"
            >
              {buildCopy.markAllLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="compact"
              disabled={isReading}
              onClick={() => setChecked((prev) => unmarkAll(tree, prev))}
              className="h-7 px-2.5 text-xs"
            >
              {buildCopy.unmarkLabel}
            </Button>
          </div>

          <div
            role="group"
            aria-labelledby="importar-legenda"
            className="flex max-h-60 flex-col overflow-auto rounded-md border border-border bg-background py-1.5"
          >
            {schemas.map((group) => {
              const isCollapsed = collapsedSchemas.has(group.schema);
              const schemaState = states.get(group.schema) ?? "unchecked";

              return (
                <div key={group.schema} className="flex flex-col">
                  <div className="flex h-7.5 items-center gap-1.5 pr-2.5 pl-1.5">
                    <button
                      type="button"
                      aria-label={`${isCollapsed ? "Expandir" : "Recolher"} ${group.schema}`}
                      aria-expanded={!isCollapsed}
                      onClick={() =>
                        setCollapsedSchemas((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.schema)) {
                            next.delete(group.schema);
                          } else {
                            next.add(group.schema);
                          }
                          return next;
                        })
                      }
                      className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-subtle hover:text-ink"
                    >
                      <ChevronIcon
                        className={cn(
                          "transition-transform",
                          isCollapsed && "-rotate-90",
                        )}
                      />
                    </button>
                    <label className="flex flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={schemaState === "checked"}
                        disabled={isReading}
                        onChange={() =>
                          setChecked((prev) =>
                            toggle(tree, group.schema, prev),
                          )
                        }
                        className="size-4 accent-accent"
                      />
                      <FolderIcon />
                      <span className="font-mono font-semibold">
                        {group.schema}
                      </span>
                    </label>
                  </div>
                  {!isCollapsed &&
                    group.tables.map((table) => {
                      const key = `${group.schema}.${table}`;
                      const inModel = alreadySet.has(key);
                      return (
                        <label
                          key={key}
                          className={cn(
                            "flex h-7 items-center gap-2 pr-2.5 pl-14",
                            inModel
                              ? "cursor-not-allowed text-muted"
                              : "cursor-pointer hover:bg-selected",
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={inModel || checked.has(key)}
                            disabled={inModel || isReading}
                            onChange={() =>
                              setChecked((prev) => toggle(tree, key, prev))
                            }
                            className="size-4 accent-accent"
                          />
                          <span className="font-mono">{table}</span>
                          {inModel && (
                            <span className="ml-auto text-xs text-subtle">
                              {buildCopy.alreadyInModelNote}
                            </span>
                          )}
                        </label>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>

        {errorMessage && (
          <p role="alert" className="m-0 text-xs text-danger">
            {errorMessage}
          </p>
        )}
      </div>
    </Dialog>
  );
}
