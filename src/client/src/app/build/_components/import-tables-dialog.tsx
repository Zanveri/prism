import { useMemo, useState } from "react";

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
  CloseIcon,
  EngineTag,
  EnvironmentPill,
  FolderIcon,
  InfoIcon,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import type { BuildModel } from "../_lib/build-model.schema";
import { buildCopy } from "../_lib/build.copy";
import type { CatalogSelection } from "../_lib/catalog-import";
import {
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

  const availableDatabases = useMemo(() => {
    if (databases && databases.length > 0) return databases;
    if (model.base?.database) return [model.base.database];
    return selectedConnection ? [selectedConnection.database] : [];
  }, [databases, model.base?.database, selectedConnection]);

  const [database, setDatabase] = useState<string>(
    model.base?.database ?? availableDatabases[0] ?? "",
  );
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

  if (!open) return null;

  const isReading = readingProgress !== null;

  const handleSubmit = () => {
    if (!selectedConnection || isReading || summary.selection.length === 0) {
      return;
    }
    onSubmit?.({
      connectionId: selectedConnection.id,
      database: database || selectedConnection.database,
      selection: summary.selection,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-canvas/75 px-4 pt-10 pb-14">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="importar-tabelas-titulo"
        className="flex w-full max-w-[680px] flex-col rounded-lg border border-border-strong bg-surface text-ink shadow-lg"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex-none text-muted">
            <BuildIcon />
          </span>
          <h1 id="importar-tabelas-titulo" className="m-0 text-lg font-semibold">
            {buildCopy.importTablesTitle}
          </h1>
          <EngineTag engine={connectionEngineNumber(model.engine)} />
          <button
            type="button"
            aria-label={buildCopy.closeEscLabel}
            onClick={isReading ? onCancelReading : onCancel}
            className="ml-auto flex size-8 cursor-pointer items-center justify-center rounded-sm text-muted hover:bg-selected hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_200px] gap-3">
            <label className="flex flex-col gap-1.5 font-medium">
              <span className="flex items-center gap-2">
                <span>{buildCopy.connectionLabel}</span>
                {selectedConnection?.environmentName && (
                  <EnvironmentPill
                    name={selectedConnection.environmentName}
                    color={selectedConnection.environmentColor}
                  />
                )}
              </span>
              <select
                value={selectedConnection?.id ?? ""}
                disabled={lockedToBase || isReading}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setConnectionId(nextId);
                  onSelectConnection?.(nextId);
                }}
                className="h-9 rounded-sm border border-border-strong bg-elevated px-2.5 text-[13px] font-normal text-ink disabled:opacity-70"
              >
                {validConnections.map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {conn.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 font-medium">
              {buildCopy.databaseLabel}
              <select
                value={database}
                disabled={lockedToBase || isReading}
                onChange={(e) => {
                  const nextDb = e.target.value;
                  setDatabase(nextDb);
                  onSelectDatabase?.(nextDb);
                }}
                className="h-9 rounded-sm border border-border-strong bg-elevated px-2 font-mono text-[13px] font-normal text-ink disabled:opacity-70"
              >
                {availableDatabases.map((db) => (
                  <option key={db} value={db}>
                    {db}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span id="importar-legenda" className="font-medium">
                {buildCopy.schemasAndTablesLegend}
              </span>
              <span className="text-xs text-muted">
                {buildCopy.markedCount(
                  summary.counts.checked,
                  summary.counts.total,
                )}
              </span>
              <button
                type="button"
                disabled={isReading}
                onClick={() => setChecked((prev) => markAll(tree, prev))}
                className="ml-auto h-7 cursor-pointer rounded-sm px-2.5 text-xs text-muted hover:bg-selected hover:text-ink"
              >
                {buildCopy.markAllLabel}
              </button>
              <button
                type="button"
                disabled={isReading}
                onClick={() => setChecked((prev) => unmarkAll(tree, prev))}
                className="h-7 cursor-pointer rounded-sm px-2.5 text-xs text-muted hover:bg-selected hover:text-ink"
              >
                {buildCopy.unmarkLabel}
              </button>
            </div>

            <div
              role="group"
              aria-labelledby="importar-legenda"
              className="flex max-h-60 flex-col overflow-auto rounded-sm border border-border bg-canvas py-1.5"
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

        <div className="flex flex-wrap items-center gap-2 rounded-b-lg border-t border-border bg-elevated px-5 py-3.5">
          <span className="flex items-center gap-1.5 text-xs text-muted">
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
          <div className="ml-auto flex items-center gap-2">
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
          </div>
        </div>
      </section>
    </div>
  );
}
