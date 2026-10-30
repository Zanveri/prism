import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { DiagramCanvas } from "@/app/workbench/_components/table-tab/diagram-canvas";
import type { TableRef } from "@/app/workbench/_lib/table-diagram";
import { Button, Dialog, Select } from "@/components/ui";

import {
  addColumn,
  addForeignKey,
  addTable,
  ignoreWarning,
  removeTable,
  tableKey,
  type BuildModel,
  type ModelForeignKey,
} from "../_lib/build-model";
import { buildCopy } from "../_lib/build.copy";
import { applyFix, type Problem } from "../_lib/model-check";
import {
  connectColumn,
  modelDiagram,
  moveTable,
  organize,
} from "../_lib/model-layout";

export type PendingForeignKeyChoice = {
  fromKey: string;
  fk: ModelForeignKey;
  selectedTargetCol: string;
};

/**
 * Resolve a ligação entre uma coluna de `fromKey` e a tabela `toKey`:
 * - quando `toKey` tem PK de coluna única, devolve `{ kind: "model", model }` com a FK já criada;
 * - quando `toKey` não tem PK ou tem PK composta, devolve `{ kind: "dialog", pending }` para o usuário escolher a coluna referenciada.
 */
export function resolveDiagramConnect(
  model: BuildModel,
  fromKey: string,
  column: string,
  toKey: string,
): { kind: "model"; model: BuildModel } | { kind: "dialog"; pending: PendingForeignKeyChoice } {
  const res = connectColumn(model, fromKey, column, toKey);
  if ("model" in res) {
    return { kind: "model", model: res.model };
  }
  const targetTable = model.tables.find((t) => tableKey(t) === toKey);
  const defaultCol =
    res.needsDialog.target.columns[0] ??
    targetTable?.primaryKey?.columns[0] ??
    targetTable?.columns[0]?.name ??
    "id";
  return {
    kind: "dialog",
    pending: {
      fromKey,
      fk: res.needsDialog,
      selectedTargetCol: defaultCol,
    },
  };
}

export interface BuildDiagramProps {
  model: BuildModel;
  problems: readonly Problem[];
  selectedTableKey: string | null;
  focusRequest?: { key: string; seq: number } | null;
  problemsOpen?: boolean;
  onCloseProblems?: () => void;
  onSelectTable: (key: string | null) => void;
  onChange: (next: BuildModel) => void;
  onUndo?: () => void;
  onTableRemovedToast?: (tableName: string) => void;
  onNeedsForeignKeyDialog?: (fromKey: string, initialFk: ModelForeignKey) => void;
}

export function BuildDiagram({
  model,
  problems,
  selectedTableKey,
  focusRequest = null,
  problemsOpen = false,
  onCloseProblems,
  onSelectTable,
  onChange,
  onUndo,
  onTableRemovedToast,
  onNeedsForeignKeyDialog,
}: BuildDiagramProps) {
  const [removedBanner, setRemovedBanner] = useState<{
    tableName: string;
    fallbackModel: BuildModel;
  } | null>(null);
  const [pendingFk, setPendingFk] = useState<PendingForeignKeyChoice | null>(null);

  useEffect(() => {
    if (!removedBanner) return;
    const timer = setTimeout(() => setRemovedBanner(null), 5000);
    return () => clearTimeout(timer);
  }, [removedBanner]);

  const layout = useMemo(() => modelDiagram(model, problems), [model, problems]);

  const handleOpenTable = useCallback(
    (ref: TableRef) => {
      onSelectTable(tableKey(ref));
    },
    [onSelectTable],
  );

  const handleOrganize = useCallback(() => {
    onChange(organize(model));
  }, [model, onChange]);

  const handleMoveTable = useCallback(
    (key: string, x: number, y: number) => {
      onChange(moveTable(model, key, x, y));
    },
    [model, onChange],
  );

  const handleAddTable = useCallback(() => {
    const added = addTable(model);
    onChange(added.model);
    onSelectTable(added.key);
  }, [model, onChange, onSelectTable]);

  const handleAddColumn = useCallback(
    (key: string) => {
      onChange(addColumn(model, key));
    },
    [model, onChange],
  );

  const handleApplyProblemFix = useCallback(
    (problemId: string) => {
      const problem = problems.find((p) => p.key === problemId);
      if (!problem?.fix) return;
      onChange(applyFix(model, problem.fix));
    },
    [model, onChange, problems],
  );

  const handleIgnoreProblem = useCallback(
    (problemId: string) => {
      onChange(ignoreWarning(model, problemId));
    },
    [model, onChange],
  );

  const handleConnect = useCallback(
    (fromKey: string, column: string, toKey: string) => {
      const resolved = resolveDiagramConnect(model, fromKey, column, toKey);
      if (resolved.kind === "model") {
        onChange(resolved.model);
        return;
      }
      onSelectTable(fromKey);
      if (onNeedsForeignKeyDialog) {
        onNeedsForeignKeyDialog(fromKey, resolved.pending.fk);
        return;
      }
      setPendingFk(resolved.pending);
    },
    [model, onChange, onNeedsForeignKeyDialog, onSelectTable],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Delete" || !selectedTableKey) return;
    const selectedTable = model.tables.find((t) => tableKey(t) === selectedTableKey);
    if (!selectedTable || selectedTable.origin !== null) return;
    event.preventDefault();
    onChange(removeTable(model, selectedTableKey));
    if (onTableRemovedToast) {
      onTableRemovedToast(selectedTable.name);
    } else {
      setRemovedBanner({ tableName: selectedTable.name, fallbackModel: model });
    }
  }

  const pendingTargetTable = useMemo(() => {
    if (!pendingFk) return null;
    const key = tableKey({ schema: pendingFk.fk.target.schema, name: pendingFk.fk.target.table });
    return model.tables.find((t) => tableKey(t) === key) ?? null;
  }, [model.tables, pendingFk]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={handleKeyDown}>
      <DiagramCanvas
        layout={layout}
        schema={model.defaultSchema}
        diagramLabel={buildCopy.diagramLabel}
        tableCount={layout.boxes.length}
        foreignKeyCount={layout.edges.length}
        omitted={0}
        fetching={false}
        showIncomingNotice={false}
        selectedKey={selectedTableKey}
        focusRequest={focusRequest}
        problemsOpen={problemsOpen}
        onCloseProblems={onCloseProblems}
        onSelect={onSelectTable}
        onOpenTable={handleOpenTable}
        onRefresh={handleOrganize}
        onOrganize={handleOrganize}
        onMoveTable={handleMoveTable}
        onConnect={handleConnect}
        onAddTable={handleAddTable}
        onAddColumn={handleAddColumn}
        onApplyProblemFix={handleApplyProblemFix}
        onIgnoreProblem={handleIgnoreProblem}
      />

      {removedBanner ? (
        <div
          role="status"
          className="absolute right-4 bottom-14 z-30 flex items-center gap-3 rounded-md border border-border-strong bg-panel px-3 py-2 text-xs text-ink shadow-md"
        >
          <span>{buildCopy.diagramTableRemoved(removedBanner.tableName)}</span>
          <Button
            type="button"
            variant="secondary"
            size="compact"
            onClick={() => {
              if (onUndo) {
                onUndo();
              } else {
                onChange(removedBanner.fallbackModel);
              }
              setRemovedBanner(null);
            }}
          >
            {buildCopy.undoAction}
          </Button>
        </div>
      ) : null}

      {pendingFk ? (
        <Dialog
          open
          title="Escolher coluna referenciada"
          size="sm"
          onClose={() => setPendingFk(null)}
        >
          <div className="space-y-4">
            <p className="text-xs text-muted">
              A tabela <span className="font-mono font-semibold text-ink">{pendingFk.fk.target.table}</span> não tem chave primária de coluna única. Escolha a coluna de destino para{" "}
              <span className="font-mono font-semibold text-ink">{pendingFk.fk.columns.join(", ")}</span>:
            </p>
            <Select
              aria-label="Coluna referenciada"
              value={pendingFk.selectedTargetCol}
              onChange={(value) =>
                setPendingFk((current) => (current ? { ...current, selectedTargetCol: value } : null))
              }
              options={
                pendingTargetTable && pendingTargetTable.columns.length > 0
                  ? pendingTargetTable.columns.map((c) => ({
                      value: c.name,
                      label: `${c.name} (${c.type})`,
                    }))
                  : [{ value: "id", label: "id" }]
              }
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setPendingFk(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  onChange(
                    addForeignKey(model, pendingFk.fromKey, {
                      ...pendingFk.fk,
                      target: {
                        ...pendingFk.fk.target,
                        columns: [pendingFk.selectedTargetCol],
                      },
                    }),
                  );
                  setPendingFk(null);
                }}
              >
                Criar chave estrangeira
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
