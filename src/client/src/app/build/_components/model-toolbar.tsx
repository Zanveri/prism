import { useState, type ReactNode } from "react";
import { engineRules } from "@/app/build/_lib/build-engines";
import type { BuildEngine, BuildModel } from "@/app/build/_lib/build-model.schema";
import { buildCopy } from "@/app/build/_lib/build.copy";
import type { SaveState } from "@/app/build/_lib/model-save";
import {
  AlertIcon,
  Button,
  CheckIcon,
  ChevronIcon,
  CodeIcon,
  ContextMenu,
  EngineTag,
  EnvironmentPill,
  RefreshIcon,
} from "@/components/ui";

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
          <Button
            type="button"
            variant="secondary"
            size="compact"
            aria-label={buildCopy.toolbarBaseAria}
            onClick={onChangeBase}
            className="gap-2 border-border bg-raised px-2.5 font-normal"
          >
            <span className="text-muted">{buildCopy.toolbarBase}</span>
            <span>{baseLabel ?? `${model.base.connectionId} / ${model.base.database}`}</span>
            <EnvironmentPill name={baseEnvironmentName} color={baseEnvironmentColor} />
            <span className="text-subtle">
              <ChevronIcon direction="down" />
            </span>
          </Button>
        ) : null)}

      {model.base !== null && (
        <Button
          type="button"
          variant="secondary"
          size="compact"
          title={buildCopy.toolbarRereadHint}
          onClick={onReread}
          className="gap-1.5 px-3"
        >
          <RefreshIcon />
          <span>{buildCopy.toolbarReread}</span>
        </Button>
      )}

      <Button
        type="button"
        variant="ghost"
        size="compact"
        aria-label={buildCopy.toolbarUndo}
        title={buildCopy.toolbarUndo}
        disabled={!canUndo}
        onClick={onUndo}
        className="h-8 w-8 p-0 text-ink"
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
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="compact"
        aria-label={buildCopy.toolbarRedo}
        title={buildCopy.toolbarRedo}
        disabled={!canRedo}
        onClick={onRedo}
        className="h-8 w-8 p-0 text-ink"
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
      </Button>

      <div className="ml-auto flex items-center gap-2 text-xs text-muted">
        {saveState.status === "conflict" ? (
          <div className="flex items-center gap-2 text-danger">
            <AlertIcon />
            <span>{buildCopy.saveConflict}</span>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              onClick={onReloadConflict}
              className="h-7 bg-raised px-2 text-xs"
            >
              {buildCopy.reloadModel}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              onClick={onKeepMineConflict}
              className="h-7 border-accent px-2 text-xs text-accent"
            >
              {buildCopy.keepMineModel}
            </Button>
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
            <span className="text-success">
              <CheckIcon />
            </span>
            {buildCopy.saveSaved}
          </span>
        )}
      </div>

      <div className="relative">
        <Button
          type="button"
          variant="secondary"
          size="compact"
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          onClick={() => setExportOpen((v) => !v)}
          className="gap-1.5 pr-2.5 pl-3"
        >
          <span>{buildCopy.toolbarExport}</span>
          <span className="text-subtle">
            <ChevronIcon direction="down" />
          </span>
        </Button>
        {exportOpen && (
          <ContextMenu
            label={buildCopy.toolbarExport}
            point={{ x: 0, y: 36 }}
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

      <Button
        type="button"
        variant="primary"
        size="compact"
        onClick={onGenerateDdl}
        className="gap-2 px-3"
      >
        <CodeIcon />
        <span>{buildCopy.toolbarGenerateDdl}</span>
      </Button>
    </div>
  );
}
