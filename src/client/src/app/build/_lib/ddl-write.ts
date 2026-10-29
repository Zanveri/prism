import { engineRules, normalizeType, quoteName, sameName } from "./build-engines";
import { tableKey } from "./build-model";
import type {
  BuildEngine,
  BuildModel,
  FkAction,
  ModelColumn,
  ModelForeignKey,
  ModelIndex,
  ModelTable,
} from "./build-model.schema";

export function qualifiedName(
  engine: BuildEngine,
  schema: string,
  name: string,
  exactName: boolean,
): string {
  const quotedTable = quoteName(engine, name, exactName);
  if (!schema) return quotedTable;
  const quotedSchema = quoteName(engine, schema, false);
  return `${quotedSchema}.${quotedTable}`;
}

export function fkActionSql(action: FkAction): string | null {
  switch (action) {
    case "noAction":
      return null;
    case "restrict":
      return "RESTRICT";
    case "cascade":
      return "CASCADE";
    case "setNull":
      return "SET NULL";
  }
}

export function fkActionsClause(engine: BuildEngine, fk: ModelForeignKey): string {
  const parts: string[] = [];
  if (fk.onDelete !== "noAction" && !(engine === "informix" && fk.onDelete === "restrict")) {
    const del = fkActionSql(fk.onDelete);
    if (del) parts.push(`ON DELETE ${del}`);
  }
  if (fk.onUpdate !== "noAction" && !(engine === "informix" && fk.onUpdate === "restrict")) {
    const upd = fkActionSql(fk.onUpdate);
    if (upd) parts.push(`ON UPDATE ${upd}`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export function columnDefinition(
  engine: BuildEngine,
  column: ModelColumn,
  options: {
    inlinePrimaryKey: boolean;
    inlineReference: ModelForeignKey | null;
    nameWidth?: number;
  },
): string {
  const rawName = quoteName(engine, column.name, column.exactName);
  const namePart = options.nameWidth ? rawName.padEnd(options.nameWidth, " ") : rawName;

  let body: string;
  if (column.identity !== null) {
    if (engine === "informix") {
      const norm = normalizeType(engine, column.type);
      const serialType = norm.base === "bigint" ? "BIGSERIAL" : "SERIAL";
      body = serialType;
    } else {
      const mode = column.identity === "always" ? "ALWAYS" : "BY DEFAULT";
      body = `${column.type} GENERATED ${mode} AS IDENTITY`;
    }
  } else if (engine === "informix") {
    const parts = [column.type];
    if (column.default !== null && column.default.trim() !== "") {
      parts.push(`DEFAULT ${column.default}`);
    }
    if (!column.nullable) {
      parts.push("NOT NULL");
    }
    body = parts.join(" ");
  } else {
    const parts = [column.type];
    if (!column.nullable) {
      parts.push("NOT NULL");
    }
    if (column.default !== null && column.default.trim() !== "") {
      parts.push(`DEFAULT ${column.default}`);
    }
    body = parts.join(" ");
  }

  if (options.inlinePrimaryKey) {
    body += " PRIMARY KEY";
  }

  if (options.inlineReference) {
    const fk = options.inlineReference;
    const targetTable = qualifiedName(engine, fk.target.schema, fk.target.table, false);
    const targetCols = fk.target.columns.map((c) => quoteName(engine, c, false)).join(", ");
    const actions = fkActionsClause(engine, fk);
    body += ` REFERENCES ${targetTable} (${targetCols})${actions}`;
  }

  return `${namePart} ${body}`;
}

export function constraintClause(engine: BuildEngine, name: string | null, body: string): string {
  if (!name) return body;
  const quoted = quoteName(engine, name, false);
  if (engine === "informix") {
    return `${body} CONSTRAINT ${quoted}`;
  }
  return `CONSTRAINT ${quoted} ${body}`;
}

function measureLength(engine: BuildEngine, value: string): number {
  const rules = engineRules[engine];
  return rules.limitInBytes ? new TextEncoder().encode(value).byteLength : value.length;
}

function truncateToLimit(engine: BuildEngine, value: string, maxLen: number): string {
  if (measureLength(engine, value) <= maxLen) return value;
  let result = "";
  for (const ch of value) {
    if (measureLength(engine, result + ch) > maxLen) break;
    result += ch;
  }
  return result;
}

function checkColumnHint(table: ModelTable, expression: string, fallbackIndex: number): string {
  const tokens = expression.match(/[A-Za-z_][A-Za-z0-9_$]*/g) ?? [];
  for (const tok of tokens) {
    const match = table.columns.find((col) => col.name.toLowerCase() === tok.toLowerCase());
    if (match) return match.name;
  }
  return String(fallbackIndex + 1);
}

export function resolvedConstraintNames(model: BuildModel): Map<string, string> {
  const engine = model.engine;
  const rules = engineRules[engine];
  const limit = rules.identifierLimit;
  const fold = (n: string) => (rules.fold === "upper" ? n.toUpperCase() : n.toLowerCase());

  const usedBySchema = new Map<string, Set<string>>();
  const getUsed = (schema: string) => {
    const key = fold(schema);
    let set = usedBySchema.get(key);
    if (!set) {
      set = new Set<string>();
      usedBySchema.set(key, set);
    }
    return set;
  };

  for (const table of model.tables) {
    const used = getUsed(table.schema);
    if (table.primaryKey?.name) used.add(fold(table.primaryKey.name));
    for (const uq of table.uniques) {
      if (uq.name) used.add(fold(uq.name));
    }
    for (const ck of table.checks) {
      if (ck.name) used.add(fold(ck.name));
    }
    for (const fk of table.foreignKeys) {
      if (fk.name) used.add(fold(fk.name));
    }
    for (const ix of table.indexes) {
      if (ix.name) used.add(fold(ix.name));
    }
  }

  const allocate = (schema: string, base: string): string => {
    const used = getUsed(schema);
    const trimmedBase = truncateToLimit(engine, base, limit);
    if (!used.has(fold(trimmedBase))) {
      used.add(fold(trimmedBase));
      return trimmedBase;
    }
    let counter = 2;
    while (true) {
      const suffix = `_${counter}`;
      const suffixLen = measureLength(engine, suffix);
      const prefix = truncateToLimit(engine, base, Math.max(1, limit - suffixLen));
      const candidate = `${prefix}${suffix}`;
      if (!used.has(fold(candidate))) {
        used.add(fold(candidate));
        return candidate;
      }
      counter++;
    }
  };

  const result = new Map<string, string>();
  for (const table of model.tables) {
    const tKey = tableKey(table);
    if (table.primaryKey && table.primaryKey.columns.length > 0) {
      const pkName = table.primaryKey.name ?? allocate(table.schema, `pk_${table.name}`);
      result.set(`${tKey}#pk#0`, pkName);
    }
    table.uniques.forEach((uq, idx) => {
      const uqName =
        uq.name ?? allocate(table.schema, `uq_${table.name}_${uq.columns.join("_")}`);
      result.set(`${tKey}#uq#${idx}`, uqName);
    });
    table.checks.forEach((ck, idx) => {
      const colPart = checkColumnHint(table, ck.expression, idx);
      const ckName = ck.name ?? allocate(table.schema, `ck_${table.name}_${colPart}`);
      result.set(`${tKey}#ck#${idx}`, ckName);
    });
    table.foreignKeys.forEach((fk, idx) => {
      const fkName =
        fk.name ?? allocate(table.schema, `fk_${table.name}_${fk.target.table}`);
      result.set(`${tKey}#fk#${idx}`, fkName);
    });
  }

  return result;
}

export function dependencyOrder(tables: readonly ModelTable[]): {
  order: ModelTable[];
  deferred: ReadonlySet<string>;
} {
  const byKey = new Map<string, ModelTable>();
  for (const table of tables) {
    byKey.set(tableKey(table), table);
  }

  type Edge = { fromKey: string; toKey: string; fkKey: string };
  const edges: Edge[] = [];
  for (const table of tables) {
    const tKey = tableKey(table);
    table.foreignKeys.forEach((fk, idx) => {
      const targetKey = `${fk.target.schema}.${fk.target.table}`;
      const targetTable =
        byKey.get(targetKey) ??
        tables.find(
          (candidate) =>
            sameName("postgresql", { name: candidate.schema, exactName: false }, { name: fk.target.schema, exactName: false }) &&
            sameName("postgresql", candidate, { name: fk.target.table, exactName: false }),
        );
      if (!targetTable) return;
      const resolvedTargetKey = tableKey(targetTable);
      if (resolvedTargetKey === tKey) return;
      edges.push({
        fromKey: resolvedTargetKey,
        toKey: tKey,
        fkKey: `${tKey}#fk#${idx}`,
      });
    });
  }

  const deferred = new Set<string>();
  const placed = new Set<string>();
  const order: ModelTable[] = [];

  const runKahnPass = () => {
    const activeEdges = edges.filter(
      (e) => !deferred.has(e.fkKey) && !placed.has(e.fromKey) && !placed.has(e.toKey),
    );
    const inDegree = new Map<string, number>();
    const outgoing = new Map<string, Edge[]>();
    for (const table of tables) {
      const k = tableKey(table);
      if (!placed.has(k)) {
        inDegree.set(k, 0);
        outgoing.set(k, []);
      }
    }
    for (const edge of activeEdges) {
      inDegree.set(edge.toKey, (inDegree.get(edge.toKey) ?? 0) + 1);
      outgoing.get(edge.fromKey)?.push(edge);
    }

    const queue = [...inDegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([k]) => k)
      .sort((a, b) => a.localeCompare(b));

    while (queue.length > 0) {
      const currentKey = queue.shift()!;
      if (placed.has(currentKey)) continue;
      placed.add(currentKey);
      order.push(byKey.get(currentKey)!);

      const newlyReady: string[] = [];
      for (const edge of outgoing.get(currentKey) ?? []) {
        if (placed.has(edge.toKey)) continue;
        const nextDeg = (inDegree.get(edge.toKey) ?? 1) - 1;
        inDegree.set(edge.toKey, nextDeg);
        if (nextDeg === 0) {
          newlyReady.push(edge.toKey);
        }
      }
      newlyReady.sort((a, b) => a.localeCompare(b));
      for (const ready of newlyReady) {
        if (!queue.includes(ready)) {
          queue.push(ready);
        }
      }
    }
  };

  while (placed.size < tables.length) {
    const beforeSize = placed.size;
    runKahnPass();
    if (placed.size === tables.length) break;

    if (placed.size === beforeSize) {
      const remainingEdges = edges.filter(
        (e) => !deferred.has(e.fkKey) && !placed.has(e.fromKey) && !placed.has(e.toKey),
      );
      const canReach = (start: string, goal: string): boolean => {
        const visited = new Set<string>();
        const stack = [start];
        while (stack.length > 0) {
          const cur = stack.pop()!;
          if (cur === goal) return true;
          if (visited.has(cur)) continue;
          visited.add(cur);
          for (const e of remainingEdges) {
            if (e.fromKey === cur && !visited.has(e.toKey)) {
              stack.push(e.toKey);
            }
          }
        }
        return false;
      };

      let brokeAny = false;
      for (const edge of remainingEdges) {
        if (canReach(edge.toKey, edge.fromKey)) {
          deferred.add(edge.fkKey);
          brokeAny = true;
        }
      }
      if (!brokeAny && remainingEdges.length > 0) {
        deferred.add(remainingEdges[0].fkKey);
      }
    }
  }

  return { order, deferred };
}

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function findColumnExactName(
  table: ModelTable | undefined,
  colName: string,
  engine: BuildEngine,
): boolean {
  if (!table) return false;
  const col =
    table.columns.find((c) => c.name === colName) ??
    table.columns.find((c) => sameName(engine, c, { name: colName, exactName: false }));
  return col?.exactName ?? false;
}

export function formatForeignKeyBody(
  engine: BuildEngine,
  table: ModelTable,
  fk: ModelForeignKey,
  allTables: readonly ModelTable[],
): string {
  const localCols = fk.columns
    .map((c) => quoteName(engine, c, findColumnExactName(table, c, engine)))
    .join(", ");
  const targetTableObj =
    allTables.find((t) => t.schema === fk.target.schema && t.name === fk.target.table) ??
    allTables.find(
      (t) =>
        sameName(
          engine,
          { name: t.schema, exactName: false },
          { name: fk.target.schema, exactName: false },
        ) && sameName(engine, t, { name: fk.target.table, exactName: false }),
    );
  const targetTable = qualifiedName(
    engine,
    fk.target.schema,
    fk.target.table,
    targetTableObj?.exactName ?? false,
  );
  const targetCols = fk.target.columns
    .map((c) => quoteName(engine, c, findColumnExactName(targetTableObj, c, engine)))
    .join(", ");
  const actions = fkActionsClause(engine, fk);
  return `FOREIGN KEY (${localCols})\n    REFERENCES ${targetTable} (${targetCols})${actions}`;
}

export function formatCreateIndex(
  engine: BuildEngine,
  table: ModelTable,
  index: ModelIndex,
): string {
  const uniquePart = index.unique ? "UNIQUE " : "";
  const rawIndexName = quoteName(engine, index.name, false);
  const indexName =
    engine === "db2" && table.schema
      ? `${quoteName(engine, table.schema, false)}.${rawIndexName}`
      : rawIndexName;
  const tableName = qualifiedName(engine, table.schema, table.name, table.exactName);
  const cols = index.columns
    .map((c) => quoteName(engine, c, findColumnExactName(table, c, engine)))
    .join(", ");
  return `CREATE ${uniquePart}INDEX ${indexName}\n  ON ${tableName} (${cols});`;
}

export function formatAddForeignKey(
  engine: BuildEngine,
  table: ModelTable,
  fk: ModelForeignKey,
  constraintName: string | null,
  allTables: readonly ModelTable[],
): string {
  const tableName = qualifiedName(engine, table.schema, table.name, table.exactName);
  const fkBody = formatForeignKeyBody(engine, table, fk, allTables);
  if (engine === "informix") {
    const clause = constraintClause(engine, constraintName, fkBody);
    return `ALTER TABLE ${tableName}\n  ADD CONSTRAINT ${clause};`;
  }
  const clause = constraintClause(engine, constraintName, fkBody);
  return `ALTER TABLE ${tableName}\n  ADD ${clause};`;
}
