import type { SchemaDiagram } from "@/app/workbench/_lib/database-sessions.schema";
import { layoutDatabaseDiagram } from "@/app/workbench/_lib/schema-diagram";
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
} from "./build-model";
import { fixButtonLabel, type Problem } from "./model-check";

const boxPadding = 12;
const margin = 64;
const boxCollisionGap = 24;

let cachedAutoLayout: { sig: string; layout: DiagramLayout } | null = null;

function buildAutoLayoutSignature(model: BuildModel): string {
  const parts: string[] = [model.engine];
  for (const t of model.tables) {
    const pk = (t.primaryKey?.columns ?? []).join(",");
    const cols = t.columns.map((c) => `${c.name}:${c.type}`).join(",");
    const originCols = t.origin ? t.origin.columns.map((c) => `${c.name}:${c.type}`).join(",") : "";
    const fks = t.foreignKeys
      .map(
        (fk) =>
          `${fk.name ?? ""}:${fk.columns.join(",")}->${fk.target.schema}.${fk.target.table}(${fk.target.columns.join(",")})`,
      )
      .join(";");
    parts.push(`${t.schema}.${t.name}|${pk}|${cols}|${originCols}|${fks}`);
  }
  return parts.join("\n");
}

function rowCenterY(box: DiagramBox, columnName: string | undefined): number {
  if (!box.columns || !columnName) {
    return box.y + boxPadding + rowHeight / 2;
  }
  const index = box.columns.findIndex((c) => c.name === columnName);
  const rowIndex = index >= 0 ? index : 0;
  return box.y + boxPadding + rowHeight * (rowIndex + 1) + rowHeight / 2;
}

function computeAutoLayout(model: BuildModel): DiagramLayout {
  const sig = buildAutoLayoutSignature(model);
  if (cachedAutoLayout !== null && cachedAutoLayout.sig === sig) {
    return cachedAutoLayout.layout;
  }

  const modelKeys = new Set(model.tables.map((t) => tableKey(t)));
  const bySchema = new Map<string, SchemaDiagram>();

  for (const table of model.tables) {
    const existing = bySchema.get(table.schema) ?? { tables: [], foreignKeys: [] };
    const pkCols = new Set(table.primaryKey?.columns ?? []);
    const changes = tableChanges(model.engine, table);
    const cols = table.columns.map((c, idx) => ({
      name: c.name,
      type: c.type,
      isNullable: c.nullable,
      isPrimaryKey: pkCols.has(c.name),
      position: idx + 1,
    }));
    if (table.origin !== null && changes.removedColumns.length > 0) {
      for (const removedName of changes.removedColumns) {
        const originCol = table.origin.columns.find((c) => c.name === removedName);
        if (originCol) {
          cols.push({
            name: originCol.name,
            type: originCol.type,
            isNullable: originCol.nullable,
            isPrimaryKey: false,
            position: cols.length + 1,
          });
        }
      }
    }
    existing.tables.push({
      name: table.name,
      columns: cols,
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
  const layout = layoutDatabaseDiagram(entries, { qualifyNames: true });
  cachedAutoLayout = { sig, layout };
  return layout;
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  gap: number,
): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export function modelDiagram(model: BuildModel, problems: readonly Problem[]): DiagramLayout {
  const auto = computeAutoLayout(model);
  const autoBoxQueueByKey = new Map<string, DiagramBox[]>();
  for (const box of auto.boxes) {
    const k = `${box.ref.schema}.${box.ref.name}`;
    const list = autoBoxQueueByKey.get(k) ?? [];
    list.push(box);
    autoBoxQueueByKey.set(k, list);
  }

  const activeProblems = problems.filter((p) => !model.ignoredWarnings.includes(p.key));
  const usedSavedPosKeys = new Set<string>();
  const seenBoxKeys = new Set<string>();

  const draftBoxes = model.tables.map((table, tableIdx) => {
    const baseKey = tableKey(table);
    const boxKey = seenBoxKeys.has(baseKey) ? `${baseKey}#${tableIdx}` : baseKey;
    seenBoxKeys.add(baseKey);

    const autoBox = autoBoxQueueByKey.get(baseKey)?.shift();
    const rawSavedPos = model.layout[baseKey];
    const hasUniqueSavedPos = rawSavedPos !== undefined && !usedSavedPosKeys.has(baseKey);
    if (hasUniqueSavedPos) {
      usedSavedPosKeys.add(baseKey);
    }
    const savedPos = hasUniqueSavedPos ? rawSavedPos : undefined;

    const changes = tableChanges(model.engine, table);
    const pkSet = new Set(table.primaryKey?.columns ?? []);
    const fkSet = new Set(table.foreignKeys.flatMap((fk) => fk.columns));
    const uniqueSet = new Set(
      table.uniques.filter((u) => u.columns.length === 1).map((u) => u.columns[0]!),
    );
    const changedByColName = new Map(
      changes.changedColumns.map((cc) => [cc.name, cc]),
    );

    const columns: DiagramColumn[] = table.columns.map((col) => {
      const changed = changedByColName.get(col.name);
      const originCol =
        table.origin && col.originName
          ? table.origin.columns.find(
              (oc) => (oc.originName ?? oc.name) === col.originName || oc.name === col.originName,
            )
          : undefined;
      const state: DiagramColumn["state"] =
        table.origin !== null && col.originName === null
          ? "added"
          : table.origin !== null && changed !== undefined
            ? "changed"
            : undefined;
      const previousType =
        changed?.type && originCol && originCol.type !== col.type
          ? originCol.type
          : undefined;

      return {
        name: col.name,
        type: col.type,
        primaryKey: pkSet.has(col.name),
        foreignKey: fkSet.has(col.name),
        nullable: col.nullable,
        ...(uniqueSet.has(col.name) ? { unique: true } : {}),
        ...(state ? { state } : {}),
        ...(previousType ? { previousType } : {}),
      };
    });

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
        p.table === baseKey ||
        (p.fix?.kind === "createIndexes" &&
          p.fix.items.some((item) => item.table === baseKey)),
    );
    const warning: "error" | "warning" | undefined = tableProbs.some((p) => p.severity === "error")
      ? "error"
      : tableProbs.some((p) => p.severity === "warning")
        ? "warning"
        : undefined;

    const width = autoBox?.width ?? 264;
    const height = rowHeight * (columns.length + 1) + 2 * boxPadding;

    return {
      baseKey,
      autoBox,
      hasSavedPos: savedPos !== undefined,
      pinned: savedPos?.pinned ?? false,
      box: {
        key: boxKey,
        ref: { schema: table.schema, name: table.name },
        title: table.origin !== null ? `${table.schema}.${table.name}` : table.name,
        variant: table.origin !== null ? "existing" : "new",
        ...(table.origin !== null && changes.kind === "changed" ? { badge: "alterada" } : {}),
        ...(table.dropInDatabase ? { dropped: true } : {}),
        ...(warning ? { warning } : {}),
        ...(tableProbs.length > 0
          ? {
              problems: tableProbs.map((p) => ({
                code: p.code,
                severity: p.severity,
                message: p.message,
                key: p.key,
                ...(p.fix ? { fixLabel: fixButtonLabel(p.fix) } : {}),
              })),
            }
          : {}),
        center: false,
        x: savedPos ? savedPos.x : (autoBox?.x ?? margin),
        y: savedPos ? savedPos.y : (autoBox?.y ?? margin),
        width,
        height,
        columns,
      } satisfies DiagramBox,
    };
  });

  // Garante que nenhuma tabela fique sobreposta a outra (priorizando tabelas fixadas pelo usuário).
  const autoBoxByKey = new Map<string, DiagramBox>();
  for (const item of draftBoxes) {
    if (item.autoBox && !autoBoxByKey.has(item.baseKey)) {
      autoBoxByKey.set(item.baseKey, item.autoBox);
    }
  }

  const order = draftBoxes
    .map((item, index) => ({
      index,
      priority: item.pinned ? 0 : item.hasSavedPos ? 1 : 2,
    }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index);

  const placedRects: { x: number; y: number; width: number; height: number }[] = [];
  const resolvedBoxes = new Array<DiagramBox>(draftBoxes.length);

  for (const { index } of order) {
    const item = draftBoxes[index]!;
    let x = item.box.x;
    let y = item.box.y;
    const { width, height } = item.box;

    let guard = 0;
    while (guard < 200) {
      const hit = placedRects.find((r) =>
        rectsOverlap({ x, y, width, height }, r, boxCollisionGap),
      );
      if (!hit) break;
      if (x >= hit.x + hit.width / 2 && x < hit.x + hit.width + boxCollisionGap) {
        x = hit.x + hit.width + boxCollisionGap;
      } else {
        y = hit.y + hit.height + boxCollisionGap;
      }
      guard += 1;
    }

    placedRects.push({ x, y, width, height });
    resolvedBoxes[index] =
      x === item.box.x && y === item.box.y ? item.box : { ...item.box, x, y };
  }

  const boxes: DiagramBox[] = resolvedBoxes;

  const boxByKey = new Map(boxes.map((b) => [b.key, b]));
  const autoEdgeQueue = new Map<string, DiagramEdge[]>();
  for (const edge of auto.edges) {
    const sig = `${edge.fromTable}->${edge.toTable}:${edge.fromColumn ?? ""}->${edge.toColumn ?? ""}:${edge.name}`;
    const list = autoEdgeQueue.get(sig) ?? [];
    list.push(edge);
    autoEdgeQueue.set(sig, list);
  }

  const edges: DiagramEdge[] = [];
  let edgeOrder = 0;

  for (const table of model.tables) {
    const fromKey = tableKey(table);
    const sourceBox = boxByKey.get(fromKey);
    const autoSource = autoBoxByKey.get(fromKey);
    if (!sourceBox) continue;

    for (const fk of table.foreignKeys) {
      const toKey = `${fk.target.schema}.${fk.target.table}`;
      const targetBox = boxByKey.get(toKey);
      const autoTarget = autoBoxByKey.get(toKey);
      if (!targetBox) continue;

      const fromCol = fk.columns[0];
      const toCol = fk.target.columns[0];
      const fkName = fk.name ?? `fk_${table.name}_${fk.target.table}`;
      const sig = `${fromKey}->${toKey}:${fromCol ?? ""}->${toCol ?? ""}:${fkName}`;
      const queued = autoEdgeQueue.get(sig)?.shift();

      const atAutoPosition =
        Boolean(
          queued &&
            autoSource &&
            autoTarget &&
            sourceBox.x === autoSource.x &&
            sourceBox.y === autoSource.y &&
            targetBox.x === autoTarget.x &&
            targetBox.y === autoTarget.y,
        );

      let from: Point;
      let to: Point;
      let points: Point[];

      if (atAutoPosition && queued) {
        from = queued.from;
        to = queued.to;
        points = queued.points;
      } else {
        const fromY = rowCenterY(sourceBox, fromCol);
        const toY = rowCenterY(targetBox, toCol);

        if (sourceBox.x + sourceBox.width <= targetBox.x) {
          from = { x: sourceBox.x + sourceBox.width, y: fromY };
          to = { x: targetBox.x, y: toY };
          const midX = Math.round((from.x + to.x) / 2);
          points =
            from.y === to.y
              ? [from, to]
              : [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
        } else if (targetBox.x + targetBox.width <= sourceBox.x) {
          from = { x: sourceBox.x, y: fromY };
          to = { x: targetBox.x + targetBox.width, y: toY };
          const midX = Math.round((from.x + to.x) / 2);
          points =
            from.y === to.y
              ? [from, to]
              : [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
        } else {
          from = { x: sourceBox.x + sourceBox.width, y: fromY };
          to = { x: targetBox.x + targetBox.width, y: toY };
          const loopX = Math.max(sourceBox.x + sourceBox.width, targetBox.x + targetBox.width) + 32;
          points = [from, { x: loopX, y: from.y }, { x: loopX, y: to.y }, to];
        }
      }

      const srcCol = table.columns.find((c) => c.name === fromCol);
      const isSinglePk =
        table.primaryKey?.columns.length === 1 && table.primaryKey.columns[0] === fromCol;
      const isSingleUnique = table.uniques.some(
        (u) => u.columns.length === 1 && u.columns[0] === fromCol,
      );
      const tableDiff = tableChanges(model.engine, table);
      const isNewFk = table.origin === null || tableDiff.addedForeignKeys.includes(fk);

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
        cardinality: isSinglePk || isSingleUnique ? "1:1" : "1:N",
        optional: Boolean(srcCol?.nullable),
        self: fromKey === toKey,
        variant: isNewFk ? "new" : "existing",
      });
    }
  }

  const maxBoxRight = boxes.length > 0 ? Math.max(...boxes.map((b) => b.x + b.width)) : margin;
  const maxBoxBottom = boxes.length > 0 ? Math.max(...boxes.map((b) => b.y + b.height)) : margin;
  const maxEdgeX =
    edges.length > 0 ? Math.max(...edges.flatMap((e) => e.points.map((p) => p.x))) : 0;
  const maxEdgeY =
    edges.length > 0 ? Math.max(...edges.flatMap((e) => e.points.map((p) => p.y))) : 0;

  return {
    boxes,
    edges,
    width: Math.max(maxBoxRight, maxEdgeX) + margin * 4,
    height: Math.max(maxBoxBottom, maxEdgeY) + margin * 4,
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

  const defaultOnDelete = model.engine === "informix" ? "noAction" : "restrict";
  const pkCols = targetTable.primaryKey?.columns ?? [];
  const fallbackTargetCol = pkCols.length === 1 ? pkCols[0]! : null;
  if (fallbackTargetCol !== null) {
    const fk: ModelForeignKey = {
      name: null,
      columns: [column],
      target: {
        schema: targetTable.schema,
        table: targetTable.name,
        columns: [fallbackTargetCol],
      },
      onDelete: defaultOnDelete,
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
      onDelete: defaultOnDelete,
      onUpdate: "noAction",
    },
  };
}
