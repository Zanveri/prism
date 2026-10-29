import { useState, type ReactNode } from "react";
import { engineRules } from "@/app/build/_lib/build-engines";
import type { BuildEngine, BuildModel } from "@/app/build/_lib/build-model.schema";
import { buildCopy } from "@/app/build/_lib/build.copy";
import type { SaveState } from "@/app/build/_lib/model-save";
import {
  AlertIcon,
  CheckIcon,
  ChevronIcon,
  CodeIcon,
  ContextMenu,
  EngineTag,
  EnvironmentPill,
  RefreshIcon,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";

const engineToNumber: Record<BuildEngine, 1 | 2 | 3> = {
  postgresql: 1,
  db2: 2,
  informix: 3,
};

type ModelToolbarProps = {
  model: BuildModel;
  baseLabel?: string | null;
  baseEnvironmentName?: string | null;
  baseEnvironmentColor?: string | null;
  baseMenuSlot?: ReactNode;
  canUndo?: boolean;
  canRedo?: boolean;
  saveState?: SaveState;
  onUndo?: () => void;
  onRedo?: () => void;
  onReread?: () => void;
  onChangeBase?: () => void;
  onReloadConflict?: () => void;
  onKeepMineConflict?: () => void;
  onExport?: (kind: "dbml" | "sql" | "png") => void;
  onGenerateDdl?: () => void;
};

export function ModelToolbar({
  model,
  baseLabel,
  baseEnvironmentName = null,
  baseEnvironmentColor = null,
  baseMenuSlot,
  canUndo = false,
  canRedo = false,
  saveState = { status: "saved", savedAt: null, message: null },
  onUndo,
  onRedo,
  onReread,
  onChangeBase,
  onReloadConflict,
  onKeepMineConflict,
  onExport,
  onGenerateDdl,
}: ModelToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const rules = engineRules[model.engine];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-3 py-2">
      <span className="text-xs text-muted">{buildCopy.toolbarTarget}</span>
      <span
        title={buildCopy.toolbarTargetHint}
        className="flex h-8 items-center gap-2 rounded-md border border-border px-2.5 text-ink"
      >
        <EngineTag engine={engineToNumber[model.engine]} />
        <span>{rules.label}</span>
      </span>

      {baseMenuSlot ??
        (model.base !== null ? (
          <button
            type="button"
            aria-label={buildCopy.toolbarBaseAria}
            onClick={onChangeBase}
            className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-ink hover:bg-selected"
          >
            <span className="text-muted">{buildCopy.toolbarBase}</span>
            <span>{baseLabel ?? `${model.base.connectionId} / ${model.base.database}`}</span>
            <EnvironmentPill name={baseEnvironmentName} color={baseEnvironmentColor} />
            <span className="text-subtle">
              <ChevronIcon direction="down" />
            </span>
          </button>
        ) : null)}

      {model.base !== null && (
        <button
          type="button"
          title={buildCopy.toolbarRereadHint}
          onClick={onReread}
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-transparent px-3 text-ink hover:bg-selected"
        >
          <RefreshIcon />
          <span>{buildCopy.toolbarReread}</span>
        </button>
      )}

      <button
        type="button"
        aria-label={buildCopy.toolbarUndo}
        title={buildCopy.toolbarUndo}
        disabled={!canUndo}
        onClick={onUndo}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent",
          canUndo
            ? "cursor-pointer text-ink hover:bg-selected"
            : "cursor-not-allowed text-subtle",
        )}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5.5 4L2.5 7l3 3" />
          <path d="M2.5 7H10a3.5 3.5 0 0 1 0 7H8" />
        </svg>
      </button>

      <button
        type="button"
        aria-label={buildCopy.toolbarRedo}
        title={buildCopy.toolbarRedo}
        disabled={!canRedo}
        onClick={onRedo}
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md border-0 bg-transparent",
          canRedo
            ? "cursor-pointer text-ink hover:bg-selected"
            : "cursor-not-allowed text-subtle",
        )}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10.5 4l3 3-3 3" />
          <path d="M13.5 7H6a3.5 3.5 0 0 0 0 7h2" />
        </svg>
      </button>

      <div className="ml-auto flex items-center gap-2 text-xs text-muted">
        {saveState.status === "conflict" ? (
          <div className="flex items-center gap-2 text-danger">
            <AlertIcon />
            <span>{buildCopy.saveConflict}</span>
            <button
              type="button"
              onClick={onReloadConflict}
              className="h-7 cursor-pointer rounded border border-border-strong bg-surface px-2 text-ink hover:bg-selected"
            >
              {buildCopy.reloadModel}
            </button>
            <button
              type="button"
              onClick={onKeepMineConflict}
              className="h-7 cursor-pointer rounded border border-accent bg-transparent px-2 text-accent hover:bg-selected"
            >
              {buildCopy.keepMineModel}
            </button>
          </div>
        ) : saveState.status === "failed" ? (
          <span className="flex items-center gap-1.5 text-danger" title={saveState.message ?? undefined}>
            <AlertIcon />
            {buildCopy.saveFailed}
          </span>
        ) : saveState.status === "saving" ? (
          <span>{buildCopy.saveSaving}</span>
        ) : saveState.status === "pending" ? (
          <span>{buildCopy.savePending}</span>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="text-ok">
              <CheckIcon />
            </span>
            {buildCopy.saveSaved}
          </span>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          onClick={() => setExportOpen((v) => !v)}
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-transparent pr-2.5 pl-3 text-ink hover:bg-selected"
        >
          <span>{buildCopy.toolbarExport}</span>
          <span className="text-subtle">
            <ChevronIcon direction="down" />
          </span>
        </button>
        {exportOpen && (
          <ContextMenu
            aria-label={buildCopy.toolbarExport}
            className="top-9 right-0 z-20 w-52"
            onClose={() => setExportOpen(false)}
            groups={[
              [
                {
                  id: "export-dbml",
                  label: buildCopy.exportDbmlAction,
                  hint: ".dbml",
                  onSelect: () => {
                    setExportOpen(false);
                    onExport?.("dbml");
                  },
                },
                {
                  id: "export-ddl",
                  label: buildCopy.exportDdlAction,
                  hint: ".sql",
                  onSelect: () => {
                    setExportOpen(false);
                    onExport?.("sql");
                  },
                },
                {
                  id: "export-png",
                  label: buildCopy.exportPngAction,
                  hint: ".png",
                  onSelect: () => {
                    setExportOpen(false);
                    onExport?.("png");
                  },
                },
              ],
            ]}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onGenerateDdl}
        className="flex h-8 cursor-pointer items-center gap-2 rounded-md border-0 bg-accent px-3 font-semibold text-panel hover:opacity-95"
      >
        <CodeIcon />
        <span>{buildCopy.toolbarGenerateDdl}</span>
      </button>
    </div>
  );
}
