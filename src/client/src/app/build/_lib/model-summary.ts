import { exactNameFromCatalog, sameName } from "@/app/build/_lib/build-engines";
import { tableChanges } from "@/app/build/_lib/build-model";
import type { BuildEngine, BuildModel } from "@/app/build/_lib/build-model.schema";
import { buildUiCopy } from "./build-ui.copy";

function sameIdentifier(engine: BuildEngine, a: string, b: string): boolean {
  return sameName(
    engine,
    { name: a, exactName: exactNameFromCatalog(engine, a) },
    { name: b, exactName: exactNameFromCatalog(engine, b) },
  );
}

export function modelSummary(
  model: BuildModel,
  connectionName: (id: string) => string | null,
): {
  newTables: number;
  existing: number;
  changed: number;
  start: string;
  label: string;
} {
  let newTables = 0;
  let existing = 0;
  let changed = 0;

  for (const table of model.tables) {
    if (table.origin === null) {
      newTables += 1;
    } else {
      existing += 1;
      const ch = tableChanges(model.engine, table);
      if (ch.kind === "changed" || ch.kind === "dropped") {
        changed += 1;
      }
    }
  }

  const parts: string[] = [];
  if (newTables > 0) {
    parts.push(buildUiCopy.summary.newCount(newTables));
  }
  if (existing > 0) {
    const existingLabel = buildUiCopy.summary.existingCount(existing);
    const changedLabel =
      changed > 0
        ? `, ${buildUiCopy.summary.changedCount(changed)}`
        : "";
    parts.push(`${existingLabel}${changedLabel}`);
  }

  const label = parts.length > 0 ? parts.join(" · ") : buildUiCopy.summary.noTables;

  let start: string = buildUiCopy.summary.fromScratch;
  if (model.base) {
    const conn = connectionName(model.base.connectionId) ?? buildUiCopy.summary.connectionRemoved;
    const dbPart = model.base.database ? `${conn} / ${model.base.database}` : conn;
    const existingSchemas = Array.from(
      new Set(
        model.tables
          .filter((t) => t.origin !== null)
          .map((t) => t.schema),
      ),
    );
    const schemasList =
      existingSchemas.length > 0 ? existingSchemas : model.base.knownSchemas;
    start =
      schemasList.length > 0
        ? `${dbPart} · ${schemasList.join(", ")}`
        : dbPart;
  }

  return {
    newTables,
    existing,
    changed,
    start,
    label,
  };
}

export function countModelRelations(model: BuildModel): number {
  let count = 0;
  for (const table of model.tables) {
    for (const fk of table.foreignKeys) {
      if (table.origin === null) {
        count += 1;
      } else {
        const targetInModel = model.tables.some(
          (t) =>
            sameIdentifier(model.engine, t.schema, fk.target.schema) &&
            sameIdentifier(model.engine, t.name, fk.target.table),
        );
        if (targetInModel) {
          count += 1;
        }
      }
    }
  }
  return count;
}

export function countModelIndexes(model: BuildModel): number {
  return model.tables.reduce((sum, table) => sum + table.indexes.length, 0);
}

export function countModelRelationsAndIndexes(model: BuildModel): {
  relations: number;
  indexes: number;
} {
  return {
    relations: countModelRelations(model),
    indexes: countModelIndexes(model),
  };
}

export function footerCountsLabel(model: BuildModel): string {
  const { label } = modelSummary(model, () => null);
  const relations = countModelRelations(model);
  const indexes = countModelIndexes(model);
  const relText = buildUiCopy.summary.relationCount(relations);
  const idxText = buildUiCopy.summary.indexCount(indexes);
  return `${label} · ${relText} · ${idxText}`;
}
