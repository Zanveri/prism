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
  RedoIcon,
  RefreshIcon,
  UndoIcon,
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
  hasErrors?: boolean;
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
  hasErrors = false,
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
  const [exportMenuPoint, setExportMenuPoint] = useState<{
    x: number;
    y: number;
  } | null>(null);
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
        size="icon"
        aria-label={buildCopy.toolbarUndo}
        title={buildCopy.toolbarUndo}
        disabled={!canUndo}
        onClick={onUndo}
        className="text-ink"
      >
        <UndoIcon />
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={buildCopy.toolbarRedo}
        title={buildCopy.toolbarRedo}
        disabled={!canRedo}
        onClick={onRedo}
        className="text-ink"
      >
        <RedoIcon />
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
          aria-expanded={exportMenuPoint !== null}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setExportMenuPoint((prev) =>
              prev === null
                ? { x: Math.max(8, rect.left), y: rect.bottom + 4 }
                : null,
            );
          }}
          className="gap-1.5 pr-2.5 pl-3"
        >
          <span>{buildCopy.toolbarExport}</span>
          <span className="text-subtle">
            <ChevronIcon direction="down" />
          </span>
        </Button>
        {exportMenuPoint !== null && (
          <ContextMenu
            label={buildCopy.toolbarExport}
            point={exportMenuPoint}
            onClose={() => setExportMenuPoint(null)}
            groups={[
              [
                {
                  id: "export-dbml",
                  label: buildCopy.exportDbmlAction,
                  hint: ".dbml",
                  onSelect: () => {
                    setExportMenuPoint(null);
                    onExport?.("dbml");
                  },
                },
                {
                  id: "export-ddl",
                  label: buildCopy.exportDdlAction,
                  hint: ".sql",
                  disabled: hasErrors,
                  onSelect: () => {
                    setExportMenuPoint(null);
                    onExport?.("sql");
                  },
                },
                {
                  id: "export-png",
                  label: buildCopy.exportPngAction,
                  hint: ".png",
                  onSelect: () => {
                    setExportMenuPoint(null);
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
