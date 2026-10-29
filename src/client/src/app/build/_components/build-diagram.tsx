import { useMemo, useState, type KeyboardEvent } from "react";

import { DiagramCanvas } from "@/app/workbench/_components/table-tab/diagram-canvas";
import { Button } from "@/components/ui";

import {
  addForeignKey,
  removeTable,
  tableKey,
  type BuildModel,
  type ModelForeignKey,
} from "../_lib/build-model";
import { buildCopy } from "../_lib/build.copy";
import type { Problem } from "../_lib/model-check";
import {
  connectColumn,
  modelDiagram,
  moveTable,
  organize,
} from "../_lib/model-layout";

export interface BuildDiagramProps {
  model: BuildModel;
  problems: readonly Problem[];
  selectedTableKey: string | null;
  onSelectTable: (key: string) => void;
  onChange: (next: BuildModel) => void;
  onNeedsForeignKeyDialog?: (fromKey: string, initialFk: ModelForeignKey) => void;
}

export function BuildDiagram({
  model,
  problems,
  selectedTableKey,
  onSelectTable,
  onChange,
  onNeedsForeignKeyDialog,
}: BuildDiagramProps) {
  const [undoSnapshot, setUndoSnapshot] = useState<{
    tableName: string;
    previousModel: BuildModel;
  } | null>(null);

  const layout = useMemo(() => modelDiagram(model, problems), [model, problems]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Delete" || !selectedTableKey) return;
    const selectedTable = model.tables.find((t) => tableKey(t) === selectedTableKey);
    if (!selectedTable || selectedTable.origin !== null) return;
    event.preventDefault();
    setUndoSnapshot({ tableName: selectedTable.name, previousModel: model });
    onChange(removeTable(model, selectedTableKey));
  }

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
        onSelect={onSelectTable}
        onOpenTable={(ref) => onSelectTable(`${ref.schema}.${ref.name}`)}
        onRefresh={() => onChange(organize(model))}
        onMoveTable={(key, x, y) => onChange(moveTable(model, key, x, y))}
        onConnect={(fromKey, column, toKey) => {
          const res = connectColumn(model, fromKey, column, toKey);
          if ("model" in res) {
            onChange(res.model);
          } else if (onNeedsForeignKeyDialog) {
            onSelectTable(fromKey);
            onNeedsForeignKeyDialog(fromKey, res.needsDialog);
          } else {
            onChange(
              addForeignKey(model, fromKey, {
                ...res.needsDialog,
                target: {
                  ...res.needsDialog.target,
                  columns: [res.needsDialog.target.columns[0] ?? "id"],
                },
              }),
            );
          }
        }}
      />
      {undoSnapshot ? (
        <div
          role="status"
          className="absolute right-4 bottom-12 flex items-center gap-3 rounded-md border border-border bg-panel px-3 py-2 text-xs text-ink shadow-md"
        >
          <span>{buildCopy.diagramTableRemoved(undoSnapshot.tableName)}</span>
          <Button
            type="button"
            variant="secondary"
            size="compact"
            onClick={() => {
              onChange(undoSnapshot.previousModel);
              setUndoSnapshot(null);
            }}
          >
            {buildCopy.undoAction}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
