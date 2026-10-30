import { useId, useState } from "react";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import {
  Button,
  Dialog,
  EngineTag,
  EnvironmentPill,
  Field,
  FieldLabel,
  Select,
  type SelectOption,
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
  const dbSelectId = useId();
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

  const databaseOptions: SelectOption[] = availableDatabases.map((db) => ({
    value: db,
    label: db,
    content: <span className="font-mono text-xs">{db}</span>,
  }));

  return (
    <Dialog
      open={true}
      title={buildCopy.connectionChoiceTitle}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" size="compact" onClick={onCancel}>
            {buildCopy.cancelButton}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="compact"
            disabled={!selectedConnection}
            onClick={() => {
              if (!selectedConnection) return;
              onConfirm({
                connectionId: selectedConnection.id,
                database: selectedDatabase || selectedConnection.database || null,
              });
            }}
          >
            {buildCopy.connectionChoiceConfirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
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

        <Field>
          <FieldLabel htmlFor={dbSelectId} className="text-xs">
            {buildCopy.databaseLabel}
          </FieldLabel>
          <Select
            id={dbSelectId}
            aria-label={buildCopy.databaseLabel}
            value={selectedDatabase}
            options={databaseOptions}
            onChange={(nextDb) => setSelectedDatabase(nextDb)}
            className="min-h-8 py-1 font-mono text-xs"
          />
        </Field>
      </div>
    </Dialog>
  );
}
