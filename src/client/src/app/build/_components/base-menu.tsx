import { useState } from "react";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import {
  ChevronIcon,
  ContextMenu,
  Dialog,
  EngineTag,
  EnvironmentPill,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { BuildModel } from "../_lib/build-model.schema";
import { buildCopy } from "../_lib/build.copy";
import { connectionEngineNumber, supportedConnections } from "../_lib/catalog-tree";

export type BaseMenuProps = {
  model: BuildModel;
  connections: readonly Connection[];
  baseLabel?: string | null;
  baseEnvironmentName?: string | null;
  baseEnvironmentColor?: string | null;
  onChangeBase?: (target: { connectionId: string; database: string | null }) => void;
};

export function BaseMenu({
  model,
  connections,
  baseLabel,
  baseEnvironmentName = null,
  baseEnvironmentColor = null,
  onChangeBase,
}: BaseMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!model.base) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={buildCopy.toolbarBaseAria}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((prev) => !prev)}
        className="flex h-8 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-ink hover:bg-selected"
      >
        <span className="text-muted">{buildCopy.toolbarBase}</span>
        <span>{baseLabel ?? `${model.base.connectionId} / ${model.base.database ?? ""}`}</span>
        <EnvironmentPill name={baseEnvironmentName} color={baseEnvironmentColor} />
        <span className="text-subtle">
          <ChevronIcon direction="down" />
        </span>
      </button>

      {menuOpen && (
        <ContextMenu
          aria-label={buildCopy.toolbarBaseAria}
          className="left-0 top-9 min-w-44"
          onClose={() => setMenuOpen(false)}
          items={[
            {
              key: "change-base",
              label: buildCopy.changeBaseMenuLabel,
              onSelect: () => {
                setMenuOpen(false);
                setDialogOpen(true);
              },
            },
          ]}
        />
      )}

      {dialogOpen && (
        <ChangeBaseDialog
          model={model}
          connections={connections}
          onCancel={() => setDialogOpen(false)}
          onConfirm={(target) => {
            setDialogOpen(false);
            onChangeBase?.(target);
          }}
        />
      )}
    </div>
  );
}

export type ChangeBaseDialogProps = {
  model: BuildModel;
  connections: readonly Connection[];
  databasesByConnection?: Record<string, readonly string[]>;
  loadingProgress?: { current: number; total: number } | null;
  onCancel: () => void;
  onConfirm: (target: { connectionId: string; database: string | null }) => void;
};

export function ChangeBaseDialog({
  model,
  connections,
  databasesByConnection,
  loadingProgress = null,
  onCancel,
  onConfirm,
}: ChangeBaseDialogProps) {
  const validConnections = supportedConnections(connections, model.engine);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(
    model.base?.connectionId ?? validConnections[0]?.id ?? "",
  );
  const selectedConnection =
    validConnections.find((c) => c.id === selectedConnectionId) ?? validConnections[0] ?? null;
  const availableDatabases = selectedConnection
    ? databasesByConnection?.[selectedConnection.id] ?? [selectedConnection.database]
    : [];
  const [selectedDatabase, setSelectedDatabase] = useState<string>(
    model.base?.database ?? selectedConnection?.database ?? "",
  );

  return (
    <Dialog
      title={buildCopy.changeBaseTitle}
      width={480}
      onClose={onCancel}
      footer={
        <>
          <span className="mr-auto text-xs text-subtle">
            {loadingProgress
              ? buildCopy.readingTablesProgress(loadingProgress.current, loadingProgress.total)
              : buildCopy.readOnlyCatalogNotice}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 cursor-pointer items-center justify-center rounded-md border border-border-strong bg-transparent px-3 text-ink hover:bg-selected"
          >
            {buildCopy.cancelButton}
          </button>
          <button
            type="button"
            disabled={!selectedConnection || Boolean(loadingProgress)}
            onClick={() => {
              if (!selectedConnection) return;
              onConfirm({
                connectionId: selectedConnection.id,
                database: selectedDatabase || selectedConnection.database || null,
              });
            }}
            className={cn(
              "flex h-8 items-center justify-center rounded-md border border-accent bg-accent px-3 font-medium text-accent-ink",
              !selectedConnection || loadingProgress
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:bg-accent-hover",
            )}
          >
            {buildCopy.changeBaseConfirm}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5 px-4 py-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{buildCopy.connectionLabel}</span>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={buildCopy.connectionLabel}>
            {validConnections.map((conn) => {
              const active = conn.id === selectedConnection?.id;
              return (
                <button
                  key={conn.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    setSelectedConnectionId(conn.id);
                    setSelectedDatabase(conn.database);
                  }}
                  className={cn(
                    "flex h-9 cursor-pointer items-center justify-between rounded-md border px-2.5 text-left text-ink",
                    active ? "border-accent bg-selected" : "border-border bg-surface hover:bg-hover",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <EngineTag engine={connectionEngineNumber(model.engine)} />
                    <span>{conn.name}</span>
                  </span>
                  <EnvironmentPill name={conn.environmentName} color={conn.environmentColor} />
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{buildCopy.databaseLabel}</span>
          <select
            aria-label={buildCopy.databaseLabel}
            value={selectedDatabase}
            onChange={(e) => setSelectedDatabase(e.target.value)}
            className="h-8 rounded-md border border-border bg-surface px-2.5 font-mono text-xs text-ink"
          >
            {availableDatabases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Dialog>
  );
}
