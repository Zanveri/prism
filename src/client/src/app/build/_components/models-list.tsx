import { useState } from "react";
import { engineRules } from "@/app/build/_lib/build-engines";
import type { BuildEngine, BuildModel } from "@/app/build/_lib/build-model.schema";
import { buildCopy } from "@/app/build/_lib/build.copy";
import { modelSummary } from "@/app/build/_lib/model-summary";
import {
  BuildIcon,
  ConfirmDialog,
  ContextMenu,
  EngineTag,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";

export type SavedModelEntry = {
  id: string;
  name: string;
  engine: BuildEngine;
  model: BuildModel;
  updatedAt: string;
};

const engineToNumber: Record<BuildEngine, 1 | 2 | 3> = {
  postgresql: 1,
  db2: 2,
  informix: 3,
};

type ModelsListProps = {
  models: readonly SavedModelEntry[];
  connectionName: (id: string) => string | null;
  onOpenModel?: (id: string) => void;
  onNewModel?: () => void;
  onOpenFile?: () => void;
  onRenameModel?: (id: string, newName: string) => void;
  onDuplicateModel?: (id: string) => void;
  onExportModel?: (id: string, kind: "dbml" | "sql" | "png") => void;
  onDeleteModel?: (id: string) => void;
};

export function ModelsList({
  models,
  connectionName,
  onOpenModel,
  onNewModel,
  onOpenFile,
  onRenameModel,
  onDuplicateModel,
  onExportModel,
  onDeleteModel,
}: ModelsListProps) {
  const [filterText, setFilterText] = useState("");
  const [menuOpenForId, setMenuOpenForId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingModel, setDeletingModel] = useState<SavedModelEntry | null>(null);

  const query = filterText.trim().toLowerCase();
  const filteredModels = models.filter((entry) => {
    if (query === "") return true;
    if (entry.name.toLowerCase().includes(query)) return true;
    return entry.model.tables.some((t) => t.name.toLowerCase().includes(query));
  });

  function startRename(entry: SavedModelEntry) {
    setMenuOpenForId(null);
    setRenamingId(entry.id);
    setRenameValue(entry.name);
  }

  function submitRename(entry: SavedModelEntry) {
    const trimmed = renameValue.trim();
    setRenamingId(null);
    if (trimmed !== "" && trimmed !== entry.name) {
      onRenameModel?.(entry.id, trimmed);
    }
  }

  return (
    <main className="flex min-w-0 flex-[999_1_720px] flex-col gap-5 px-10 pt-8 pb-12">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-[1_1_360px] flex-col gap-1">
          <h1 className="m-0 text-2xl leading-8 font-semibold text-ink">
            {buildCopy.modelsTitle}
          </h1>
          <p className="m-0 text-muted">{buildCopy.modelsSubtitle}</p>
        </div>

        <button
          type="button"
          onClick={onOpenFile}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border-strong bg-transparent px-3.5 text-ink hover:bg-selected"
        >
          <UploadIcon />
          <span>{buildCopy.openFileButton}</span>
        </button>

        <button
          type="button"
          onClick={onNewModel}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-md border-0 bg-accent px-3.5 font-semibold text-panel hover:opacity-95"
        >
          <PlusIcon />
          <span>{buildCopy.newModelButton}</span>
        </button>
      </div>

      <label className="flex h-8 max-w-[360px] items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-subtle">
        <SearchIcon />
        <input
          type="text"
          aria-label="Filtrar modelos"
          placeholder={buildCopy.filterModelsPlaceholder}
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="h-7 min-w-0 flex-1 border-0 bg-transparent p-0 text-ink outline-none"
        />
      </label>

      <div className="overflow-x-auto rounded-lg border border-border bg-panel">
        <table className="w-full min-w-[880px] border-collapse">
          <thead>
            <tr>
              <th
                scope="col"
                className="h-9 border-b border-border bg-surface px-4 text-left text-xs font-medium text-muted"
              >
                {buildCopy.colModel}
              </th>
              <th
                scope="col"
                className="h-9 border-b border-border bg-surface px-4 text-left text-xs font-medium text-muted"
              >
                {buildCopy.colEngine}
              </th>
              <th
                scope="col"
                className="h-9 border-b border-border bg-surface px-4 text-left text-xs font-medium text-muted"
              >
                {buildCopy.colStart}
              </th>
              <th
                scope="col"
                className="h-9 border-b border-border bg-surface px-4 text-left text-xs font-medium text-muted"
              >
                {buildCopy.colTables}
              </th>
              <th
                scope="col"
                className="h-9 border-b border-border bg-surface px-4 text-left text-xs font-medium text-muted"
              >
                {buildCopy.colUpdated}
              </th>
              <th
                scope="col"
                className="h-9 w-[120px] border-b border-border bg-surface px-4"
              >
                <span className="sr-only">{buildCopy.colActions}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredModels.map((entry, idx) => {
              const summary = modelSummary(entry.model, connectionName);
              const isLast = idx === filteredModels.length - 1;
              const isMenuOpen = menuOpenForId === entry.id;

              return (
                <tr key={entry.id}>
                  <td
                    className={cn(
                      "h-[52px] px-4",
                      !isLast && "border-b border-selected",
                    )}
                  >
                    {renamingId === entry.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        aria-label={`Novo nome para ${entry.name}`}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => submitRename(entry)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(entry);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="h-7 rounded border border-accent bg-canvas px-2 font-mono text-ink outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onOpenModel?.(entry.id)}
                        className="flex cursor-pointer items-center gap-2 border-0 bg-transparent p-0 font-mono font-semibold text-ink hover:underline"
                      >
                        <span className="text-muted">
                          <BuildIcon />
                        </span>
                        {entry.name}
                      </button>
                    )}
                  </td>
                  <td
                    className={cn(
                      "px-4",
                      !isLast && "border-b border-selected",
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      <EngineTag engine={engineToNumber[entry.engine]} />
                      <span>{engineRules[entry.engine].label}</span>
                    </span>
                  </td>
                  <td
                    className={cn(
                      "px-4 text-ink-soft",
                      !isLast && "border-b border-selected",
                    )}
                  >
                    {summary.start}
                  </td>
                  <td
                    className={cn(
                      "px-4 text-ink-soft",
                      !isLast && "border-b border-selected",
                    )}
                  >
                    {summary.label}
                  </td>
                  <td
                    className={cn(
                      "px-4 text-ink-soft",
                      !isLast && "border-b border-selected",
                    )}
                  >
                    {entry.updatedAt}
                  </td>
                  <td
                    className={cn(
                      "px-4",
                      !isLast && "border-b border-selected",
                    )}
                  >
                    <div className="relative flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onOpenModel?.(entry.id)}
                        className="flex h-7 cursor-pointer items-center rounded-md border border-border-strong bg-transparent px-2.5 text-xs text-ink hover:bg-selected"
                      >
                        {buildCopy.openAction}
                      </button>
                      <button
                        type="button"
                        aria-label={`Mais ações de ${entry.name}`}
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        onClick={() =>
                          setMenuOpenForId((prev) => (prev === entry.id ? null : entry.id))
                        }
                        className={cn(
                          "flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border-0 text-ink hover:bg-selected",
                          isMenuOpen ? "bg-selected" : "bg-transparent",
                        )}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <circle cx="3.5" cy="8" r="1.25" />
                          <circle cx="8" cy="8" r="1.25" />
                          <circle cx="12.5" cy="8" r="1.25" />
                        </svg>
                      </button>

                      {isMenuOpen && (
                        <ContextMenu
                          label={`Ações de ${entry.name}`}
                          point={{ x: 0, y: 32 }}
                          onClose={() => setMenuOpenForId(null)}
                          groups={[
                            [
                              {
                                id: "rename",
                                label: buildCopy.renameAction,
                                onSelect: () => startRename(entry),
                              },
                              {
                                id: "duplicate",
                                label: buildCopy.duplicateAction,
                                onSelect: () => {
                                  setMenuOpenForId(null);
                                  onDuplicateModel?.(entry.id);
                                },
                              },
                            ],
                            [
                              {
                                id: "export-dbml",
                                label: buildCopy.exportDbmlAction,
                                hint: ".dbml",
                                onSelect: () => {
                                  setMenuOpenForId(null);
                                  onExportModel?.(entry.id, "dbml");
                                },
                              },
                              {
                                id: "export-ddl",
                                label: buildCopy.exportDdlAction,
                                hint: ".sql",
                                onSelect: () => {
                                  setMenuOpenForId(null);
                                  onExportModel?.(entry.id, "sql");
                                },
                              },
                              {
                                id: "export-png",
                                label: buildCopy.exportPngAction,
                                hint: ".png",
                                onSelect: () => {
                                  setMenuOpenForId(null);
                                  onExportModel?.(entry.id, "png");
                                },
                              },
                            ],
                            [
                              {
                                id: "delete",
                                label: buildCopy.deleteModelAction,
                                onSelect: () => {
                                  setMenuOpenForId(null);
                                  setDeletingModel(entry);
                                },
                              },
                            ],
                          ]}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={deletingModel !== null}
        tone="danger"
        title={deletingModel ? buildCopy.deleteModelTitle(deletingModel.name) : ""}
        description={buildCopy.deleteModelDescription}
        confirmLabel={buildCopy.deleteModelConfirm}
        onConfirm={() => {
          if (deletingModel) {
            onDeleteModel?.(deletingModel.id);
          }
          setDeletingModel(null);
        }}
        onCancel={() => setDeletingModel(null)}
      />
    </main>
  );
}
