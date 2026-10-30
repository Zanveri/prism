import { useId, useState } from "react";
import type { Connection } from "@/app/connections/_lib/connections.schema";
import {
  Button,
  ChevronIcon,
  ContextMenu,
  Dialog,
  EngineTag,
  EnvironmentPill,
  Field,
  FieldLabel,
  Select,
  type SelectOption,
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
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!model.base) return null;

  return (
    <div className="relative">
      <Button
        type="button"
        variant="secondary"
        size="compact"
        aria-label={buildCopy.toolbarBaseAria}
        aria-haspopup="menu"
        aria-expanded={menuPoint !== null}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setMenuPoint((prev) =>
            prev === null ? { x: rect.left, y: rect.bottom + 4 } : null,
          );
        }}
        className="bg-raised px-2.5 font-normal"
      >
        <span className="text-muted">{buildCopy.toolbarBase}</span>
        <span>{baseLabel ?? `${model.base.connectionId} / ${model.base.database ?? ""}`}</span>
        <EnvironmentPill name={baseEnvironmentName} color={baseEnvironmentColor} />
        <span className="text-subtle">
          <ChevronIcon direction="down" />
        </span>
      </Button>

      {menuPoint !== null && (
        <ContextMenu
          label={buildCopy.toolbarBaseAria}
          point={menuPoint}
          onClose={() => setMenuPoint(null)}
          groups={[
            [
              {
                id: "change-base",
                label: buildCopy.changeBaseMenuLabel,
                onSelect: () => {
                  setMenuPoint(null);
                  setDialogOpen(true);
                },
              },
            ],
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
  const dbSelectId = useId();
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

  const databaseOptions: SelectOption[] = availableDatabases.map((db) => ({
    value: db,
    label: db,
    content: <span className="font-mono text-xs">{db}</span>,
  }));

  return (
    <Dialog
      open={true}
      title={buildCopy.changeBaseTitle}
      size="sm"
      pending={Boolean(loadingProgress)}
      onClose={onCancel}
      footer={
        <>
          <span className="mr-auto text-xs text-subtle">
            {loadingProgress
              ? buildCopy.readingTablesProgress(loadingProgress.current, loadingProgress.total)
              : buildCopy.readOnlyCatalogNotice}
          </span>
          <Button type="button" variant="secondary" size="compact" onClick={onCancel}>
            {buildCopy.cancelButton}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="compact"
            disabled={!selectedConnection || Boolean(loadingProgress)}
            onClick={() => {
              if (!selectedConnection) return;
              onConfirm({
                connectionId: selectedConnection.id,
                database: selectedDatabase || selectedConnection.database || null,
              });
            }}
          >
            {buildCopy.changeBaseConfirm}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
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
                    active ? "border-accent bg-selected" : "border-border bg-raised hover:bg-selected",
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
