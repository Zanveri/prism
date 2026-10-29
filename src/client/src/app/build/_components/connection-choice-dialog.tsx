import { useState } from "react";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import {
  Dialog,
  EngineTag,
  EnvironmentPill,
} from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import type { BuildEngine } from "../_lib/build-model.schema";
import { buildCopy } from "../_lib/build.copy";
import { connectionEngineNumber, supportedConnections } from "../_lib/catalog-tree";

export type ConnectionChoiceDialogProps = {
  engine: BuildEngine;
  connections: readonly Connection[];
  baseConnectionId?: string | null;
  databasesByConnection?: Record<string, readonly string[]>;
  onCancel: () => void;
  onConfirm: (target: { connectionId: string; database: string | null }) => void;
};

export function ConnectionChoiceDialog({
  engine,
  connections,
  baseConnectionId = null,
  databasesByConnection,
  onCancel,
  onConfirm,
}: ConnectionChoiceDialogProps) {
  const validConnections = supportedConnections(connections, engine);
  const defaultConn =
    validConnections.find((c) => c.id !== baseConnectionId) ??
    validConnections[0] ??
    null;

  const [selectedConnectionId, setSelectedConnectionId] = useState<string>(
    defaultConn?.id ?? "",
  );
  const selectedConnection =
    validConnections.find((c) => c.id === selectedConnectionId) ??
    defaultConn;

  const availableDatabases = selectedConnection
    ? databasesByConnection?.[selectedConnection.id] ?? [selectedConnection.database]
    : [];
  const [selectedDatabase, setSelectedDatabase] = useState<string>(
    selectedConnection?.database ?? "",
  );

  return (
    <Dialog
      open={true}
      title={buildCopy.connectionChoiceTitle}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-8 cursor-pointer items-center justify-center rounded-md border border-border-strong bg-transparent px-3 text-ink hover:bg-selected"
          >
            {buildCopy.cancelButton}
          </button>
          <button
            type="button"
            disabled={!selectedConnection}
            onClick={() => {
              if (!selectedConnection) return;
              onConfirm({
                connectionId: selectedConnection.id,
                database: selectedDatabase || selectedConnection.database || null,
              });
            }}
            className={cn(
              "flex h-8 items-center justify-center rounded-md border border-accent bg-accent px-3 font-medium text-background",
              !selectedConnection
                ? "cursor-not-allowed opacity-60"
                : "cursor-pointer hover:opacity-95",
            )}
          >
            {buildCopy.connectionChoiceConfirm}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5 px-4 py-4">
        <p className="m-0 text-xs text-muted">{buildCopy.connectionChoiceIntro}</p>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">{buildCopy.connectionLabel}</span>
          <div
            className="flex flex-col gap-1.5"
            role="radiogroup"
            aria-label={buildCopy.connectionLabel}
          >
            {validConnections.map((conn) => {
              const active = conn.id === selectedConnection?.id;
              const isBase = conn.id === baseConnectionId;
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
                    active
                      ? "border-accent bg-selected"
                      : "border-border bg-raised hover:bg-selected",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <EngineTag engine={connectionEngineNumber(engine)} />
                    <span>{conn.name}</span>
                    {isBase && (
                      <span className="text-xs text-muted">
                        ({buildCopy.connectionChoiceBaseNote})
                      </span>
                    )}
                  </span>
                  <EnvironmentPill
                    name={conn.environmentName}
                    color={conn.environmentColor}
                  />
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
            className="h-8 rounded-md border border-border bg-raised px-2.5 font-mono text-xs text-ink [&>option]:bg-raised [&>option]:text-ink"
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
