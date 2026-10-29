import { engineRules } from "./build-engines";
import { tableChanges } from "./build-model";
import type { BuildEngine, FkAction, ModelColumn, ModelTable } from "./build-model.schema";

export type RowState = {
  marker: "none" | "changed" | "new";
  before: string | null;
  locks: { primaryKey: boolean; identity: boolean };
};

export function columnRowState(
  engine: BuildEngine,
  table: ModelTable,
  column: ModelColumn,
): RowState {
  if (!table.origin) {
    return {
      marker: "none",
      before: null,
      locks: { primaryKey: false, identity: false },
    };
  }

  const locks = { primaryKey: true, identity: true };

  if (!column.originName) {
    return {
      marker: "new",
      before: null,
      locks,
    };
  }

  const originCol = table.origin.columns.find(
    (c) => (c.originName ?? c.name) === column.originName || c.name === column.originName,
  );
  if (!originCol) {
    return {
      marker: "new",
      before: null,
      locks,
    };
  }

  const changes = tableChanges(engine, table);
  const changed = changes.changedColumns.some((cc) => cc.name === column.name);
  if (changed) {
    return {
      marker: "changed",
      before: `${originCol.name} ${originCol.type}`,
      locks,
    };
  }

  return {
    marker: "none",
    before: null,
    locks,
  };
}

export function removedColumns(table: ModelTable): ModelColumn[] {
  if (!table.origin) {
    return [];
  }
  const presentOriginNames = new Set(
    table.columns.map((c) => c.originName).filter((name): name is string => Boolean(name)),
  );
  return table.origin.columns.filter(
    (c) => !presentOriginNames.has(c.originName ?? c.name),
  );
}

export function fkActionOptions(engine: BuildEngine): {
  onDelete: FkAction[];
  onUpdate: FkAction[];
} {
  return {
    onDelete: [...engineRules[engine].deleteActions],
    onUpdate: [...engineRules[engine].updateActions],
  };
}
