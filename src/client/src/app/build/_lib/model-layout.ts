import type { SchemaDiagram } from "@/app/workbench/_lib/database-sessions.schema";
import { layoutDatabaseDiagram, layoutSchemaDiagram } from "@/app/workbench/_lib/schema-diagram";
import {
  rowHeight,
  type DiagramBox,
  type DiagramColumn,
  type DiagramEdge,
  type DiagramLayout,
  type Point,
} from "@/app/workbench/_lib/table-diagram";

import {
  addForeignKey,
  tableChanges,
  tableKey,
  type BuildModel,
  type ModelForeignKey,
  type Problem,
} from "./build-model";

const boxPadding = 12;
const margin = 64;

function rowCenterY(box: DiagramBox, columnName: string | undefined): number {
  if (!box.columns || !columnName) {
    return box.y + boxPadding + rowHeight / 2;
  }
  const index = box.columns.findIndex((c) => c.name === columnName);
  const rowIndex = index >= 0 ? index : 0;
  return box.y + boxPadding + rowHeight * (rowIndex + 1) + rowHeight / 2;
}

function computeAutoLayout(model: BuildModel): DiagramLayout {
  const modelKeys = new Set(model.tables.map((t) => tableKey(t)));
  const bySchema = new Map<string, SchemaDiagram>();

  for (const table of model.tables) {
    const existing = bySchema.get(table.schema) ?? { tables: [], foreignKeys: [] };
    const pkCols = new Set(table.primaryKey?.columns ?? []);
    existing.tables.push({
      name: table.name,
      columns: table.columns.map((c, idx) => ({
        name: c.name,
        type: c.type,
        isNullable: c.nullable,
        isPrimaryKey: pkCols.has(c.name),
        position: idx + 1,
      })),
    });
    for (const fk of table.foreignKeys) {
      const targetKey = `${fk.target.schema}.${fk.target.table}`;
      if (!modelKeys.has(targetKey)) continue;
      existing.foreignKeys.push({
        name: fk.name ?? `fk_${table.name}_${fk.target.table}`,
        referencingTable: table.name,
        columns: [...fk.columns],
        referencedSchema: fk.target.schema,
        referencedTable: fk.target.table,
        referencedColumns: [...fk.target.columns],
      });
    }
    bySchema.set(table.schema, existing);
  }

  const entries = [...bySchema.entries()].map(([schema, diagram]) => ({ schema, diagram }));
  if (entries.length === 1) {
    return layoutSchemaDiagram(entries[0].schema, entries[0].diagram, { qualifyNames: false });
  }
  return layoutDatabaseDiagram(entries, { qualifyNames: true });
}

export function modelDiagram(model: BuildModel, problems: readonly Problem[]): DiagramLayout {
  const auto = computeAutoLayout(model);
  const autoBoxByKey = new Map<string, DiagramBox>();
  for (const box of auto.boxes) {
    autoBoxByKey.set(`${box.ref.schema}.${box.ref.name}`, box);
  }

  const activeProblems = problems.filter((p) => !model.ignoredWarnings.includes(p.key));

  const boxes: DiagramBox[] = model.tables.map((table) => {
    const key = tableKey(table);
    const autoBox = autoBoxByKey.get(key);
    const savedPos = model.layout[key];
    const changes = tableChanges(model.engine, table);
    const pkSet = new Set(table.primaryKey?.columns ?? []);
    const fkSet = new Set(table.foreignKeys.flatMap((fk) => fk.columns));

    const columns: DiagramColumn[] = table.columns.map((col) => ({
      name: col.name,
      type: col.type,
      primaryKey: pkSet.has(col.name),
      foreignKey: fkSet.has(col.name),
      ...(table.origin !== null && col.originName === null ? { state: "added" as const } : {}),
    }));

    if (table.origin !== null && changes.removedColumns.length > 0) {
      for (const removedName of changes.removedColumns) {
        const originCol = table.origin.columns.find((c) => c.name === removedName);
        if (originCol) {
          columns.push({
            name: originCol.name,
            type: originCol.type,
            primaryKey: false,
            foreignKey: false,
            state: "removed",
          });
        }
      }
    }

    const tableProbs = activeProblems.filter(
      (p) =>
        p.table === key ||
        (p.fix?.kind === "createIndexes" &&
          p.fix.items.some((item) => item.table === key)),
    );
    const warning: "error" | "warning" | undefined = tableProbs.some((p) => p.severity === "error")
      ? "error"
      : tableProbs.some((p) => p.severity === "warning")
        ? "warning"
        : undefined;

    const width = autoBox?.width ?? 264;
    const height = rowHeight * (columns.length + 1) + 2 * boxPadding;

    return {
      key,
      ref: { schema: table.schema, name: table.name },
      title: table.origin !== null ? `${table.schema}.${table.name}` : table.name,
      variant: table.origin !== null ? "existing" : "new",
      ...(table.origin !== null && changes.kind === "changed" ? { badge: "alterada" } : {}),
      ...(table.dropInDatabase ? { dropped: true } : {}),
      ...(warning ? { warning } : {}),
      center: false,
      x: savedPos ? savedPos.x : (autoBox?.x ?? margin),
      y: savedPos ? savedPos.y : (autoBox?.y ?? margin),
      width,
      height,
      columns,
    };
  });

  const boxByKey = new Map(boxes.map((b) => [b.key, b]));
  const edges: DiagramEdge[] = [];
  let edgeOrder = 0;

  for (const table of model.tables) {
    const fromKey = tableKey(table);
    const sourceBox = boxByKey.get(fromKey);
    if (!sourceBox) continue;

    for (const fk of table.foreignKeys) {
      const toKey = `${fk.target.schema}.${fk.target.table}`;
      const targetBox = boxByKey.get(toKey);
      if (!targetBox) continue;

      const fromCol = fk.columns[0];
      const toCol = fk.target.columns[0];
      const fromY = rowCenterY(sourceBox, fromCol);
      const toY = rowCenterY(targetBox, toCol);

      const goingRight = sourceBox.x + sourceBox.width / 2 <= targetBox.x + targetBox.width / 2;
      const from: Point = {
        x: goingRight ? sourceBox.x + sourceBox.width : sourceBox.x,
        y: fromY,
      };
      const to: Point = {
        x: goingRight ? targetBox.x : targetBox.x + targetBox.width,
        y: toY,
      };
      const midX = Math.round((from.x + to.x) / 2);
      const points: Point[] =
        from.y === to.y
          ? [from, to]
          : [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];

      const fkName = fk.name ?? `fk_${table.name}_${fk.target.table}`;
      edges.push({
        key: `${edgeOrder++}:${fromKey}:${fkName}:${fromCol ?? ""}`,
        name: fkName,
        label: `${fkName}: ${fk.columns.join(", ")} → ${fk.target.schema}.${fk.target.table} (${fk.target.columns.join(", ")})`,
        from,
        to,
        points,
        fromTable: fromKey,
        toTable: toKey,
        fromColumn: fromCol,
        toColumn: toCol,
      });
    }
  }

  const rightmost = boxes.length > 0 ? Math.max(...boxes.map((b) => b.x + b.width)) : margin;
  const bottommost = boxes.length > 0 ? Math.max(...boxes.map((b) => b.y + b.height)) : margin;

  return {
    boxes,
    edges,
    width: rightmost + margin,
    height: bottommost + margin,
  };
}

export function organize(model: BuildModel): BuildModel {
  const auto = computeAutoLayout(model);
  const autoByKey = new Map<string, DiagramBox>();
  for (const box of auto.boxes) {
    autoByKey.set(`${box.ref.schema}.${box.ref.name}`, box);
  }

  const nextLayout = { ...model.layout };
  for (const table of model.tables) {
    const key = tableKey(table);
    const current = nextLayout[key];
    if (current?.pinned) continue;
    const autoBox = autoByKey.get(key);
    nextLayout[key] = {
      x: autoBox?.x ?? current?.x ?? margin,
      y: autoBox?.y ?? current?.y ?? margin,
      pinned: false,
    };
  }

  return {
    ...model,
    layout: nextLayout,
  };
}

export function moveTable(model: BuildModel, key: string, x: number, y: number): BuildModel {
  return {
    ...model,
    layout: {
      ...model.layout,
      [key]: { x, y, pinned: true },
    },
  };
}

export function connectColumn(
  model: BuildModel,
  fromKey: string,
  column: string,
  toKey: string,
): { model: BuildModel } | { needsDialog: ModelForeignKey } {
  const targetTable = model.tables.find((t) => tableKey(t) === toKey);
  if (!targetTable) {
    return { model };
  }

  const pkCols = targetTable.primaryKey?.columns ?? [];
  if (pkCols.length === 1) {
    const fk: ModelForeignKey = {
      name: null,
      columns: [column],
      target: {
        schema: targetTable.schema,
        table: targetTable.name,
        columns: [pkCols[0]],
      },
      onDelete: "restrict",
      onUpdate: "noAction",
    };
    return { model: addForeignKey(model, fromKey, fk) };
  }

  return {
    needsDialog: {
      name: null,
      columns: [column],
      target: {
        schema: targetTable.schema,
        table: targetTable.name,
        columns: [...pkCols],
      },
      onDelete: "restrict",
      onUpdate: "noAction",
    },
  };
}
