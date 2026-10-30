import { useState } from "react";
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
  onAddTable,
  onImportTables,
  onOpenDdlView,
}: BuildSidebarProps) {
  const [filterText, setFilterText] = useState("");
  const [collapsedSchemas, setCollapsedSchemas] = useState<Record<string, boolean>>({});
  const [relationsExpanded, setRelationsExpanded] = useState(false);
  const [indexesExpanded, setIndexesExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    tableKey: string;
    tableName: string;
    point: { x: number; y: number };
  } | null>(null);

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
          return (
            <div key={group.schema} className={cn("flex flex-col", idx > 0 && "mt-1")}>
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => toggleSchema(group.schema)}
                className="flex h-[30px] w-full cursor-pointer items-center gap-1.5 pr-3 pl-2.5 text-left font-semibold text-ink hover:bg-selected"
              >
                <span className="shrink-0 text-subtle">
                  <ChevronIcon direction={isExpanded ? "down" : "right"} />
                </span>
                <span className="shrink-0">
                  <FolderIcon />
                </span>
                <span className="min-w-0 flex-1 truncate font-mono">{group.schema}</span>
                {group.isExistingSchema ? (
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
                  const isSelected = selectedTableKey === tKey;
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
                        onSelectTable?.(tKey);
                        if (e.ctrlKey || e.metaKey) {
                          onFocusTableInDiagram?.(tKey);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Delete" && onDeleteTable) {
                          e.preventDefault();
                          onDeleteTable(tKey);
                        }
                      }}
                      onContextMenu={(e) => {
                        if (!onDeleteTable) return;
                        e.preventDefault();
                        setContextMenu({
                          tableKey: tKey,
                          tableName: table.name,
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
          label={`Ações de ${contextMenu.tableName}`}
          point={contextMenu.point}
          groups={[
            [
              {
                id: "delete-table",
                label: "Deletar",
                shortcut: "Delete",
                onSelect: () => onDeleteTable?.(contextMenu.tableKey),
              },
            ],
          ]}
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
