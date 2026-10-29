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
  DatabaseIcon,
  EngineTag,
  EnvironmentPill,
  FolderIcon,
  InfoIcon,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";

import { engineRules } from "../_lib/build-engines";
import type { BuildEngine } from "../_lib/build-model.schema";
import { buildCopy } from "../_lib/build.copy";
import type { CatalogSelection } from "../_lib/catalog-import";
import {
  buildEngineOfConnection,
  catalogTreeItems,
  connectionEngineNumber,
  selectionOf,
  shouldCreateSchemaByDefault,
  supportedConnections,
} from "../_lib/catalog-tree";

export type NewModelSubmitPayload =
  | {
      mode: "zero";
      name: string;
      engine: BuildEngine;
      defaultSchema: string;
      createSchema: boolean;
    }
  | {
      mode: "database";
      name: string;
      engine: BuildEngine;
      connectionId: string;
      database: string;
      selection: CatalogSelection;
      defaultSchema: string;
      createSchema: boolean;
    };

export type NewModelDialogProps = {
  open?: boolean;
  connections: readonly Connection[];
  initialMode?: "zero" | "database";
  initialName?: string;
  initialEngine?: BuildEngine;
  initialConnectionId?: string | null;
  initialDatabase?: string | null;
  databases?: readonly string[];
  schemas?: readonly { schema: string; tables: readonly string[] }[];
  initialChecked?: ReadonlySet<string>;
  initialDefaultSchema?: string;
  readingProgress?: { done: number; total: number } | null;
  errorMessage?: string | null;
  onSelectConnection?: (connectionId: string) => void;
  onSelectDatabase?: (database: string) => void;
  onCancel: () => void;
  onCancelReading?: () => void;
  onSubmit?: (payload: NewModelSubmitPayload) => void;
};

const enginesList: readonly BuildEngine[] = ["postgresql", "db2", "informix"];

export function NewModelDialog({
  open = true,
  connections,
  initialMode,
  initialName = "",
  initialEngine = "postgresql",
  initialConnectionId = null,
  initialDatabase = null,
  databases,
  schemas = [],
  initialChecked,
  initialDefaultSchema = "public",
  readingProgress = null,
  errorMessage = null,
  onSelectConnection,
  onSelectDatabase,
  onCancel,
  onCancelReading,
  onSubmit,
}: NewModelDialogProps) {
  const validConnections = useMemo(
    () => supportedConnections(connections),
    [connections],
  );

  const [mode, setMode] = useState<"zero" | "database">(
    initialMode ?? (validConnections.length > 0 ? "database" : "zero"),
  );
  const [name, setName] = useState(initialName);
  const [engine, setEngine] = useState<BuildEngine>(initialEngine);
  const [connectionId, setConnectionId] = useState<string>(
    initialConnectionId ?? validConnections[0]?.id ?? "",
  );
  const selectedConnection =
    validConnections.find((c) => c.id === connectionId) ??
    validConnections[0] ??
    null;

  const availableDatabases = useMemo(() => {
    if (databases && databases.length > 0) return databases;
    return selectedConnection ? [selectedConnection.database] : [];
  }, [databases, selectedConnection]);

  const [database, setDatabase] = useState<string>(
    initialDatabase ?? availableDatabases[0] ?? "",
  );
  const [defaultSchema, setDefaultSchema] = useState(initialDefaultSchema);
  const [customCreateSchema, setCustomCreateSchema] = useState<boolean | null>(
    null,
  );
  const [collapsedSchemas, setCollapsedSchemas] = useState<Set<string>>(
    () => new Set(),
  );

  const effectiveEngine: BuildEngine =
    mode === "database" && selectedConnection
      ? (buildEngineOfConnection(selectedConnection.engine) ?? "postgresql")
      : engine;

  const baseSchemaNames = useMemo(
    () => (mode === "database" ? schemas.map((s) => s.schema) : []),
    [mode, schemas],
  );

  const createSchema =
    customCreateSchema ??
    shouldCreateSchemaByDefault(effectiveEngine, defaultSchema, baseSchemaNames);

  const tree = useMemo(
    () => checkTree(catalogTreeItems(schemas)),
    [schemas],
  );

  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(initialChecked ?? []),
  );

  const states = useMemo(() => checkStates(tree, checked), [tree, checked]);
  const summary = useMemo(
    () => selectionOf(tree, checked, null),
    [tree, checked],
  );

  if (!open) return null;

  const isReading = readingProgress !== null;

  const handleSubmit = () => {
    const trimmedName = name.trim();
    if (!trimmedName || isReading) return;
    if (mode === "zero") {
      onSubmit?.({
        mode: "zero",
        name: trimmedName,
        engine: effectiveEngine,
        defaultSchema: defaultSchema.trim(),
        createSchema,
      });
      return;
    }
    if (!selectedConnection) return;
    onSubmit?.({
      mode: "database",
      name: trimmedName,
      engine: effectiveEngine,
      connectionId: selectedConnection.id,
      database: database || selectedConnection.database,
      selection: summary.selection,
      defaultSchema: defaultSchema.trim(),
      createSchema,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-canvas/75 px-4 pt-10 pb-14">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="novo-modelo-titulo"
        className=" flex w-full max-w-[680px] flex-col rounded-lg border border-border-strong bg-surface text-ink shadow-lg"
      >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="flex-none text-muted">
            <BuildIcon />
          </span>
          <h1 id="novo-modelo-titulo" className="m-0 text-lg font-semibold">
            {buildCopy.newModelTitle}
          </h1>
          <button
            type="button"
            aria-label={buildCopy.closeEscLabel}
            onClick={isReading ? onCancelReading : onCancel}
            className="ml-auto flex size-8 cursor-pointer items-center justify-center rounded-sm text-muted hover:bg-selected hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex flex-col gap-5 p-5">
          <label className="flex flex-col gap-1.5 font-medium">
            {buildCopy.modelNameLabel}
            <input
              type="text"
              value={name}
              disabled={isReading}
              onChange={(e) => setName(e.target.value)}
              className="h-9 rounded-sm border border-border-strong bg-canvas px-3 font-mono text-[13px] font-normal text-ink"
            />
          </label>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="pb-2 font-medium">
              {buildCopy.startPointLegend}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={mode === "zero"}
                disabled={isReading}
                onClick={() => setMode("zero")}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-md border px-3.5 py-3 text-left",
                  mode === "zero"
                    ? "border-accent bg-selected text-ink"
                    : "border-border-strong bg-transparent text-ink hover:bg-elevated",
                )}
              >
                <span className="flex items-center gap-2 font-semibold">
                  {buildCopy.startZeroLabel}
                </span>
                <span className="text-xs text-muted">
                  {buildCopy.startZeroHint}
                </span>
              </button>
              <button
                type="button"
                aria-pressed={mode === "database"}
                disabled={isReading}
                onClick={() => setMode("database")}
                className={cn(
                  "flex cursor-pointer flex-col gap-1 rounded-md border px-3.5 py-3 text-left",
                  mode === "database"
                    ? "border-accent bg-selected text-ink"
                    : "border-border-strong bg-transparent text-ink hover:bg-elevated",
                )}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <DatabaseIcon />
                  {buildCopy.startDatabaseLabel}
                </span>
                <span className="text-xs text-muted">
                  {buildCopy.startDatabaseHint}
                </span>
              </button>
            </div>
          </fieldset>

          {mode === "zero" ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="pb-2 font-medium">
                {buildCopy.targetEngineLegend}
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {enginesList.map((item) => {
                  const active = engine === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setEngine(item)}
                      className={cn(
                        "flex h-11 cursor-pointer items-center gap-2.5 rounded-sm border px-3",
                        active
                          ? "border-accent bg-selected text-ink"
                          : "border-border-strong bg-transparent text-ink hover:bg-elevated",
                      )}
                    >
                      <EngineTag engine={connectionEngineNumber(item)} />
                      <span>{engineRules[item].label}</span>
                    </button>
                  );
                })}
              </div>
              <p className="m-0 text-xs text-muted">
                {buildCopy.targetEngineHint}
              </p>
            </fieldset>
          ) : (
            <div className="flex flex-col gap-4">
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
                    disabled={isReading}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setConnectionId(nextId);
                      onSelectConnection?.(nextId);
                    }}
                    className="h-9 rounded-sm border border-border-strong bg-elevated px-2.5 text-[13px] font-normal text-ink"
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
                    disabled={isReading}
                    onChange={(e) => {
                      const nextDb = e.target.value;
                      setDatabase(nextDb);
                      onSelectDatabase?.(nextDb);
                    }}
                    className="h-9 rounded-sm border border-border-strong bg-elevated px-2 font-mono text-[13px] font-normal text-ink"
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
                  <span id="tabelas-legenda" className="font-medium">
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
                  aria-labelledby="tabelas-legenda"
                  className="flex max-h-60 flex-col overflow-auto rounded-sm border border-border bg-canvas py-1.5"
                >
                  {schemas.map((group) => {
                    const isCollapsed = collapsedSchemas.has(group.schema);
                    const schemaState = states.get(group.schema) ?? "unchecked";
                    const checkedInSchema = group.tables.filter((t) =>
                      checked.has(`${group.schema}.${t}`),
                    ).length;

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
                          <span className="text-xs text-subtle">
                            {buildCopy.schemaTablesCount(
                              checkedInSchema,
                              group.tables.length,
                            )}
                          </span>
                        </div>
                        {!isCollapsed &&
                          group.tables.map((table) => {
                            const key = `${group.schema}.${table}`;
                            return (
                              <label
                                key={key}
                                className="flex h-7 cursor-pointer items-center gap-2 pr-2.5 pl-14 hover:bg-selected"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked.has(key)}
                                  disabled={isReading}
                                  onChange={() =>
                                    setChecked((prev) => toggle(tree, key, prev))
                                  }
                                  className="size-4 accent-accent"
                                />
                                <span className="font-mono">{table}</span>
                              </label>
                            );
                          })}
                      </div>
                    );
                  })}
                </div>
              </div>

              <p className="m-0 rounded-sm border border-dashed border-border-strong px-3 py-2.5 text-xs text-ink">
                {buildCopy.existingTablesExplain}
              </p>

              <p className="m-0 flex items-center gap-2 text-xs text-muted">
                <EngineTag engine={connectionEngineNumber(effectiveEngine)} />
                <span>
                  {buildCopy.targetSameAsConnection(
                    engineRules[effectiveEngine].label,
                  )}
                </span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-2 border-t border-border pt-4">
            <label className="flex flex-col gap-1.5 font-medium">
              {buildCopy.defaultSchemaLabel}
              <input
                type="text"
                value={defaultSchema}
                disabled={isReading}
                onChange={(e) => {
                  setDefaultSchema(e.target.value);
                  setCustomCreateSchema(null);
                }}
                className="h-9 rounded-sm border border-border-strong bg-canvas px-3 font-mono text-[13px] font-normal text-ink"
              />
            </label>
            <label className="flex h-9 cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={createSchema}
                disabled={isReading || effectiveEngine === "informix"}
                onChange={(e) => setCustomCreateSchema(e.target.checked)}
              />
              <span>{buildCopy.createSchemaCheckbox}</span>
            </label>
            <p className="col-span-full m-0 text-xs text-muted">
              {buildCopy.informixSchemaNote}
            </p>
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
              disabled={isReading || !name.trim()}
              onClick={handleSubmit}
            >
              {buildCopy.createModelButton}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
