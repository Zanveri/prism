import { useState } from "react";
import { engineRules } from "@/app/build/_lib/build-engines";
import { tableChanges, tableKey } from "@/app/build/_lib/build-model";
import type { BuildModel, ModelTable } from "@/app/build/_lib/build-model.schema";
import { buildCopy } from "@/app/build/_lib/build.copy";
import type { Problem } from "@/app/build/_lib/model-check";
import { countModelRelationsAndIndexes } from "@/app/build/_lib/model-summary";
import {
  BuildIcon,
  Button,
  ChevronIcon,
  ContextMenu,
  DatabaseIcon,
  FolderIcon,
  ForeignKeyIcon,
  IndexIcon,
  PlusIcon,
  SearchIcon,
  StatusBadge,
  TableIcon,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";

type BuildSidebarProps = {
  model: BuildModel | null;
  width?: number;
  selectedTableKey?: string | null;
  problems?: readonly Problem[];
  onSelectTable?: (tableKey: string) => void;
  onFocusTableInDiagram?: (tableKey: string) => void;
  onDeleteTable?: (tableKey: string) => void;
  onDeleteTables?: (tableKeys: readonly string[]) => void;
  onDeleteSchema?: (schemaName: string) => void;
  onDropSchema?: (schemaName: string, drop: boolean) => void;
  onAddTable?: () => void;
  onImportTables?: () => void;
  onOpenDdlView?: () => void;
};

type SchemaGroup = {
  schema: string;
  isExistingSchema: boolean;
  tables: ModelTable[];
};

function groupTablesBySchema(model: BuildModel, filterText: string): SchemaGroup[] {
  const query = filterText.trim().toLowerCase();
  const baseSchemas = new Set((model.base?.knownSchemas ?? []).map((s) => s.toLowerCase()));
  const bySchema = new Map<string, ModelTable[]>();

  for (const table of model.tables) {
    if (query !== "") {
      const matchesTable = table.name.toLowerCase().includes(query) || table.schema.toLowerCase().includes(query);
      const matchesCol = table.columns.some((c) => c.name.toLowerCase().includes(query));
      if (!matchesTable && !matchesCol) continue;
    }
    const existing = bySchema.get(table.schema);
    if (existing) {
      existing.push(table);
    } else {
      bySchema.set(table.schema, [table]);
    }
  }

  const groups: SchemaGroup[] = [];
  for (const [schema, tables] of bySchema.entries()) {
    const isExistingSchema =
      baseSchemas.has(schema.toLowerCase()) ||
      tables.some((t) => t.origin !== null);
    groups.push({ schema, isExistingSchema, tables });
  }
  return groups;
}

export function BuildSidebar({
  model,
  width = 272,
  selectedTableKey = null,
  problems = [],
  onSelectTable,
  onFocusTableInDiagram,
  onDeleteTable,
  onDeleteTables,
  onDeleteSchema,
  onDropSchema,
  onAddTable,
  onImportTables,
  onOpenDdlView,
}: BuildSidebarProps) {
  const [filterText, setFilterText] = useState("");
  const [collapsedSchemas, setCollapsedSchemas] = useState<Record<string, boolean>>({});
  const [relationsExpanded, setRelationsExpanded] = useState(false);
  const [indexesExpanded, setIndexesExpanded] = useState(false);
  const [prevSelectedTableKey, setPrevSelectedTableKey] = useState(selectedTableKey);
  const [multiSelectedKeys, setMultiSelectedKeys] = useState<string[]>(() =>
    selectedTableKey ? [selectedTableKey] : [],
  );
  const [anchorKey, setAnchorKey] = useState<string | null>(selectedTableKey);
  if (prevSelectedTableKey !== selectedTableKey) {
    setPrevSelectedTableKey(selectedTableKey);
    if (selectedTableKey === null) {
      setMultiSelectedKeys([]);
    } else if (!multiSelectedKeys.includes(selectedTableKey)) {
      setMultiSelectedKeys([selectedTableKey]);
      setAnchorKey(selectedTableKey);
    }
  }
  const [contextMenu, setContextMenu] = useState<
    | {
        kind: "tables";
        tableKeys: string[];
        label: string;
        point: { x: number; y: number };
      }
    | {
        kind: "schema";
        schema: string;
        isExistingSchema: boolean;
        isDropped: boolean;
        point: { x: number; y: number };
      }
    | null
  >(null);

  if (!model) {
    return (
      <aside
        aria-label={buildCopy.sidebarTitle}
        style={{ width }}
        className="flex min-h-0 min-w-0 flex-none flex-col overflow-hidden border-r border-border bg-panel"
      >
        <div className="flex min-h-8 items-center py-2 pr-2 pl-3">
          <span className="text-xs font-semibold tracking-wider text-muted uppercase">
            {buildCopy.sidebarTitle}
          </span>
        </div>
        <div className="mx-3 my-2 flex flex-col gap-3 rounded-lg border border-dashed border-border-strong p-4">
          <span className="text-subtle">
            <BuildIcon />
          </span>
          <p className="m-0 text-body">{buildCopy.emptyModels}</p>
          <p className="m-0 text-xs leading-[18px] text-muted">{buildCopy.emptyModelsHint}</p>
        </div>
      </aside>
    );
  }

  const groups = groupTablesBySchema(model, filterText);
  const { relations, indexes } = countModelRelationsAndIndexes(model);
  const errorCount = problems.filter((p) => p.severity === "error").length;
  const warningCount = problems.filter((p) => p.severity === "warning").length;
  const hasSchemas = engineRules[model.engine].hasSchemas;

  const visibleTableKeys: string[] = [];
  for (const group of groups) {
    if (!collapsedSchemas[group.schema]) {
      for (const table of group.tables) {
        visibleTableKeys.push(tableKey(table));
      }
    }
  }

  const validModelKeys = new Set(model.tables.map((t) => tableKey(t)));
  const validMultiKeys = multiSelectedKeys.filter((k) => validModelKeys.has(k));
  const effectiveSelectedKeys =
    validMultiKeys.length > 0
      ? validMultiKeys
      : selectedTableKey && validModelKeys.has(selectedTableKey)
        ? [selectedTableKey]
        : [];
  const effectiveSelectedSet = new Set(effectiveSelectedKeys);

  function executeDeleteTables(keys: readonly string[]) {
    if (keys.length === 0) return;
    if (onDeleteTables) {
      onDeleteTables(keys);
    } else if (onDeleteTable) {
      for (const k of keys) {
        onDeleteTable(k);
      }
    }
    setMultiSelectedKeys([]);
  }

  function toggleSchema(schema: string) {
    setCollapsedSchemas((prev) => ({ ...prev, [schema]: !prev[schema] }));
  }

  return (
    <aside
      id="build-sidebar"
      aria-label={buildCopy.sidebarTitle}
      style={{ width }}
      className="flex min-h-0 min-w-0 flex-none flex-col overflow-hidden border-r border-border bg-panel"
    >
      <div className="flex items-center gap-1 py-2 pr-2 pl-3">
        <span className="text-xs font-semibold tracking-wider text-muted uppercase">
          {buildCopy.sidebarTitle}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={buildCopy.newTableLabel}
          title={buildCopy.newTableTitle}
          onClick={onAddTable}
          className="ml-auto text-ink"
        >
          <PlusIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={buildCopy.importTablesLabel}
          title={buildCopy.importTablesLabel}
          onClick={onImportTables}
          className="text-ink"
        >
          <DatabaseIcon />
        </Button>
      </div>

      <label className="mx-2 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-md border border-border bg-raised px-2.5 text-subtle">
        <SearchIcon />
        <input
          type="text"
          aria-label={buildCopy.filterTablesPlaceholder}
          placeholder={buildCopy.filterTablesPlaceholder}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 text-ink outline-none"
        />
      </label>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        {groups.map((group, idx) => {
          const isExpanded = !collapsedSchemas[group.schema];
          const schemaEntry = model.schemas.find(
            (s) => s.name.toLowerCase() === group.schema.toLowerCase(),
          );
          const isSchemaDropped =
            Boolean(schemaEntry?.drop) ||
            (group.isExistingSchema &&
              group.tables.length > 0 &&
              group.tables.every((t) => t.dropInDatabase));
          const canActOnSchema = Boolean(onDeleteSchema || (hasSchemas && onDropSchema));

          return (
            <div key={group.schema} className={cn("flex flex-col", idx > 0 && "mt-1")}>
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => toggleSchema(group.schema)}
                onKeyDown={(e) => {
                  if (e.key !== "Delete" || !canActOnSchema) return;
                  e.preventDefault();
                  if (hasSchemas && group.isExistingSchema && onDropSchema) {
                    onDropSchema(group.schema, !isSchemaDropped);
                  } else if (onDeleteSchema) {
                    onDeleteSchema(group.schema);
                  } else if (hasSchemas && onDropSchema) {
                    onDropSchema(group.schema, true);
                  }
                }}
                onContextMenu={(e) => {
                  if (!canActOnSchema) return;
                  e.preventDefault();
                  setContextMenu({
                    kind: "schema",
                    schema: group.schema,
                    isExistingSchema: group.isExistingSchema,
                    isDropped: isSchemaDropped,
                    point: { x: e.clientX, y: e.clientY },
                  });
                }}
                className="flex h-[30px] w-full cursor-pointer items-center gap-1.5 pr-3 pl-2.5 text-left font-semibold text-ink hover:bg-selected"
              >
                <span className="shrink-0 text-subtle">
                  <ChevronIcon direction={isExpanded ? "down" : "right"} />
                </span>
                <span className="shrink-0">
                  <FolderIcon />
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate font-mono",
                    isSchemaDropped && "line-through opacity-70",
                  )}
                >
                  {group.schema}
                </span>
                {isSchemaDropped ? (
                  <StatusBadge
                    tone="error"
                    className="h-4 shrink-0 px-1.5 py-0 text-[10px] font-semibold"
                  >
                    {buildCopy.droppedTableBadge}
                  </StatusBadge>
                ) : group.isExistingSchema ? (
                  <span className="inline-flex h-[18px] shrink-0 items-center rounded border border-dashed border-subtle px-1.5 text-[11px] font-medium text-muted">
                    {buildCopy.existingSchemaBadge}
                  </span>
                ) : (
                  <span className="inline-flex h-[18px] shrink-0 items-center rounded border border-border-strong px-1.5 text-[11px] font-medium text-muted">
                    {buildCopy.newSchemaBadge}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs font-normal text-subtle">
                  {group.tables.length}
                </span>
              </button>

              {isExpanded &&
                group.tables.map((table) => {
                  const tKey = tableKey(table);
                  const isSelected = effectiveSelectedSet.has(tKey);
                  const isExisting = table.origin !== null;
                  const changes = tableChanges(model.engine, table);
                  const changed = isExisting && changes.kind === "changed";
                  const tableProblems = problems.filter((p) => p.table === tKey);
                  const hasError = tableProblems.some((p) => p.severity === "error");
                  const hasWarning = tableProblems.some((p) => p.severity === "warning");

                  return (
                    <button
                      key={tKey}
                      type="button"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          const startKey = anchorKey ?? selectedTableKey ?? tKey;
                          const startIdx = visibleTableKeys.indexOf(startKey);
                          const endIdx = visibleTableKeys.indexOf(tKey);
                          if (startIdx >= 0 && endIdx >= 0) {
                            const [from, to] =
                              startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
                            const range = visibleTableKeys.slice(from, to + 1);
                            const nextKeys =
                              e.ctrlKey || e.metaKey
                                ? Array.from(new Set([...effectiveSelectedKeys, ...range]))
                                : range;
                            setMultiSelectedKeys(nextKeys);
                          } else {
                            setMultiSelectedKeys([tKey]);
                            setAnchorKey(tKey);
                          }
                          onSelectTable?.(tKey);
                          return;
                        }
                        if (e.ctrlKey || e.metaKey) {
                          const exists = effectiveSelectedSet.has(tKey);
                          const nextKeys = exists
                            ? effectiveSelectedKeys.filter((k) => k !== tKey)
                            : [...effectiveSelectedKeys, tKey];
                          const resolvedKeys = nextKeys.length > 0 ? nextKeys : [tKey];
                          setMultiSelectedKeys(resolvedKeys);
                          setAnchorKey(tKey);
                          onSelectTable?.(tKey);
                          return;
                        }
                        setMultiSelectedKeys([tKey]);
                        setAnchorKey(tKey);
                        onSelectTable?.(tKey);
                        onFocusTableInDiagram?.(tKey);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Delete" && (onDeleteTables || onDeleteTable)) {
                          e.preventDefault();
                          const targetKeys =
                            effectiveSelectedSet.has(tKey) && effectiveSelectedKeys.length > 1
                              ? effectiveSelectedKeys
                              : [tKey];
                          executeDeleteTables(targetKeys);
                        }
                      }}
                      onContextMenu={(e) => {
                        if (!onDeleteTables && !onDeleteTable) return;
                        e.preventDefault();
                        const targetKeys =
                          effectiveSelectedSet.has(tKey) && effectiveSelectedKeys.length > 1
                            ? effectiveSelectedKeys
                            : [tKey];
                        if (!effectiveSelectedSet.has(tKey)) {
                          setMultiSelectedKeys([tKey]);
                          setAnchorKey(tKey);
                        }
                        setContextMenu({
                          kind: "tables",
                          tableKeys: targetKeys,
                          label:
                            targetKeys.length > 1
                              ? `${targetKeys.length} tabelas`
                              : table.name,
                          point: { x: e.clientX, y: e.clientY },
                        });
                      }}
                      className={cn(
                        "flex h-[30px] w-full shrink-0 cursor-pointer items-center gap-1.5 pr-3 pl-8 text-left",
                        isSelected
                          ? "bg-selected text-ink"
                          : isExisting
                            ? "text-muted hover:bg-selected"
                            : "text-body hover:bg-selected",
                      )}
                    >
                      <span className={cn("shrink-0", isExisting && "text-subtle")}>
                        <TableIcon />
                      </span>
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate font-mono",
                          table.dropInDatabase && "line-through opacity-70",
                        )}
                      >
                        {table.name}
                      </span>
                      {table.dropInDatabase ? (
                        <StatusBadge
                          tone="error"
                          className="h-4 shrink-0 px-1.5 py-0 text-[10px] font-semibold"
                        >
                          {buildCopy.droppedTableBadge}
                        </StatusBadge>
                      ) : changed ? (
                        <StatusBadge
                          tone="warning"
                          className="h-4 shrink-0 px-1.5 py-0 text-[10px] font-semibold"
                        >
                          {buildCopy.changedTableBadge}
                        </StatusBadge>
                      ) : null}
                      {(hasError || hasWarning) && (
                        <span
                          title={
                            hasError
                              ? `${tableProblems.filter((p) => p.severity === "error").length} erro(s)`
                              : `${tableProblems.filter((p) => p.severity === "warning").length} aviso(s)`
                          }
                          className={cn(
                            "ml-auto h-2 w-2 flex-none rounded-full",
                            hasError ? "bg-danger" : "bg-accent",
                          )}
                        />
                      )}
                      <span
                        className={cn(
                          "shrink-0 text-xs text-subtle",
                          !hasError && !hasWarning && "ml-auto",
                        )}
                      >
                        {table.columns.length}
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}

        <button
          type="button"
          aria-expanded={relationsExpanded}
          onClick={() => setRelationsExpanded((v) => !v)}
          className="mt-1 flex h-[30px] w-full shrink-0 cursor-pointer items-center gap-1.5 pr-3 pl-2.5 text-left text-body hover:bg-selected"
        >
          <span className="text-subtle">
            <ChevronIcon direction={relationsExpanded ? "down" : "right"} />
          </span>
          <ForeignKeyIcon />
          <span>{buildCopy.relationsSection}</span>
          <span className="ml-auto text-xs text-subtle">{relations}</span>
        </button>

        <button
          type="button"
          aria-expanded={indexesExpanded}
          onClick={() => setIndexesExpanded((v) => !v)}
          className="flex h-[30px] w-full shrink-0 cursor-pointer items-center gap-1.5 pr-3 pl-2.5 text-left text-body hover:bg-selected"
        >
          <span className="text-subtle">
            <ChevronIcon direction={indexesExpanded ? "down" : "right"} />
          </span>
          <IndexIcon />
          <span>{buildCopy.indexesSection}</span>
          <span className="ml-auto text-xs text-subtle">{indexes}</span>
        </button>
      </div>

      {contextMenu !== null ? (
        <ContextMenu
          label={
            contextMenu.kind === "tables"
              ? `Ações de ${contextMenu.label}`
              : `Ações do esquema ${contextMenu.schema}`
          }
          point={contextMenu.point}
          groups={
            contextMenu.kind === "tables"
              ? [
                  [
                    {
                      id: "delete-table",
                      label:
                        contextMenu.tableKeys.length > 1
                          ? `Deletar (${contextMenu.tableKeys.length} tabelas)`
                          : "Deletar",
                      shortcut: "Delete",
                      onSelect: () => executeDeleteTables(contextMenu.tableKeys),
                    },
                  ],
                ]
              : [
                  [
                    ...(hasSchemas && onDropSchema
                      ? [
                          {
                            id: "drop-schema",
                            label:
                              contextMenu.isExistingSchema && contextMenu.isDropped
                                ? "Cancelar drop do esquema"
                                : "Dropar esquema",
                            shortcut: "Delete",
                            onSelect: () =>
                              onDropSchema(
                                contextMenu.schema,
                                contextMenu.isExistingSchema ? !contextMenu.isDropped : true,
                              ),
                          },
                        ]
                      : []),
                    ...(onDeleteSchema && (!hasSchemas || !onDropSchema || contextMenu.isExistingSchema)
                      ? [
                          {
                            id: "delete-schema",
                            label:
                              hasSchemas && onDropSchema && contextMenu.isExistingSchema
                                ? "Tirar esquema do modelo"
                                : "Deletar esquema",
                            shortcut: !hasSchemas || !onDropSchema ? "Delete" : undefined,
                            onSelect: () => onDeleteSchema(contextMenu.schema),
                          },
                        ]
                      : []),
                  ],
                ]
          }
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {(errorCount > 0 || warningCount > 0) && (
        <button
          type="button"
          onClick={onOpenDdlView}
          className="mx-2 mt-auto mb-3 flex min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-border bg-raised px-2.5 py-2 text-left text-xs leading-[18px] text-ink hover:bg-selected"
        >
          <span
            className={cn(
              "h-2 w-2 flex-none rounded-full",
              errorCount > 0 ? "bg-danger" : "bg-accent",
            )}
          />
          <span className="flex-1">
            {errorCount > 0
              ? `${errorCount} ${errorCount === 1 ? "erro" : "erros"} no modelo`
              : `${warningCount} ${warningCount === 1 ? "aviso" : "avisos"} no modelo`}
          </span>
          <span className="text-muted">{buildCopy.viewProblems}</span>
        </button>
      )}
    </aside>
  );
}
