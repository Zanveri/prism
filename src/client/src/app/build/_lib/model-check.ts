import {
  closestType,
  engineRules,
  isKnownEngineType,
  needsQuotes,
  normalizeType,
  sameName,
  typeNarrows,
} from "./build-engines";
import {
  addColumn,
  addIndex,
  removeForeignKey,
  restoreColumn,
  revertColumn,
  revertTable,
  setDropInDatabase,
  tableChanges,
  tableKey,
  togglePrimaryKey,
  updateColumn,
  updateForeignKey,
} from "./build-model";
import type {
  BuildEngine,
  BuildModel,
  FkAction,
  ModelForeignKey,
  ModelTable,
} from "./build-model.schema";
import { buildCopy } from "./build.copy";

export type ProblemCode =
  | "E1"
  | "E2"
  | "E3"
  | "E4"
  | "E5"
  | "E6"
  | "E7"
  | "E8"
  | "E9"
  | "E10"
  | "E11"
  | "E12"
  | "E13"
  | "E14"
  | "W1"
  | "W2"
  | "W3"
  | "W4"
  | "W5"
  | "W6"
  | "W7"
  | "W8"
  | "W10"
  | "W11"
  | "W12"
  | "W13"
  | "W14"
  | "I1"
  | "I2"
  | "I3";

export type ProblemFix =
  | { kind: "removeForeignKey"; table: string; index: number }
  | { kind: "createUnique"; table: string; columns: string[] }
  | {
      kind: "useFkAction";
      table: string;
      index: number;
      onDelete: FkAction;
      onUpdate: FkAction;
    }
  | { kind: "useType"; table: string; column: string; type: string }
  | { kind: "createIdColumn"; table: string }
  | { kind: "createIndexes"; items: { table: string; columns: string[] }[] }
  | { kind: "restore"; table: string; column: string | null }
  | { kind: "revert"; table: string; column: string | null }
  | { kind: "removeReferencingForeignKeys"; table: string }
  | { kind: "giveDefault"; table: string; column: string }
  | { kind: "useIdentity"; table: string; column: string }
  | { kind: "reread" };

export function fixButtonLabel(fix: ProblemFix): string {
  switch (fix.kind) {
    case "removeForeignKey":
      return "Remover a FK";
    case "createUnique":
      return `Criar único em (${fix.columns.join(", ")})`;
    case "useFkAction":
      return `Usar ${fix.onDelete}`;
    case "useType":
      return `Trocar para ${fix.type}`;
    case "createIdColumn":
      return "Criar coluna id";
    case "createIndexes":
      return `Criar os ${fix.items.length} índices`;
    case "restore":
      return "Restaurar";
    case "revert":
      return "Voltar como era";
    case "removeReferencingForeignKeys":
      return "Remover as FKs";
    case "giveDefault":
      return "Dar um padrão";
    case "useIdentity":
      return "Trocar por AI";
    case "reread":
      return buildCopy.toolbarReread;
  }
}

export type Problem = {
  code: ProblemCode;
  severity: "error" | "warning" | "info";
  table: string | null;
  column: string | null;
  message: string;
  fix: ProblemFix | null;
  key: string;
};

export type CheckContext = {
  scope: "changes" | "full";
  baseLabel: string | null;
  baseEnvironment: string | null;
  notes: { code: "W8" | "W13"; message: string }[];
};

function hasControlChar(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function buildProblemKey(
  code: ProblemCode,
  table: string | null,
  column: string | null,
): string {
  if (!table) {
    return `${code}:`;
  }
  return column ? `${code}:${table}.${column}` : `${code}:${table}`;
}

function isInvalidName(name: string): boolean {
  return name.trim().length === 0 || hasControlChar(name);
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function sameColName(engine: BuildEngine, a: string, b: string): boolean {
  return sameName(
    engine,
    { name: a, exactName: false },
    { name: b, exactName: false },
  );
}

function findTargetTable(
  engine: BuildEngine,
  tables: readonly ModelTable[],
  schema: string,
  name: string,
): ModelTable | null {
  return (
    tables.find(
      (t) =>
        sameColName(engine, t.schema, schema) &&
        sameName(
          engine,
          { name: t.name, exactName: t.exactName },
          { name, exactName: false },
        ),
    ) ?? null
  );
}

function hasExactColSet(
  engine: BuildEngine,
  candidateCols: readonly string[],
  targetCols: readonly string[],
): boolean {
  if (candidateCols.length !== targetCols.length) {
    return false;
  }
  return targetCols.every((tc) =>
    candidateCols.some((cc) => sameColName(engine, cc, tc)),
  );
}

function isCoveredByUniqueOrPk(
  engine: BuildEngine,
  table: ModelTable,
  columns: readonly string[],
): boolean {
  if (
    table.primaryKey &&
    hasExactColSet(engine, table.primaryKey.columns, columns)
  ) {
    return true;
  }
  if (table.uniques.some((u) => hasExactColSet(engine, u.columns, columns))) {
    return true;
  }
  if (
    table.indexes.some(
      (ix) => ix.unique && hasExactColSet(engine, ix.columns, columns),
    )
  ) {
    return true;
  }
  return false;
}

function hasIndexPrefix(
  engine: BuildEngine,
  table: ModelTable,
  fkColumns: readonly string[],
): boolean {
  const matchesPrefix = (indexCols: readonly string[]) => {
    if (indexCols.length < fkColumns.length) {
      return false;
    }
    for (let i = 0; i < fkColumns.length; i++) {
      if (!sameColName(engine, indexCols[i]!, fkColumns[i]!)) {
        return false;
      }
    }
    return true;
  };

  if (table.primaryKey && matchesPrefix(table.primaryKey.columns)) {
    return true;
  }
  if (table.uniques.some((u) => matchesPrefix(u.columns))) {
    return true;
  }
  if (table.indexes.some((ix) => matchesPrefix(ix.columns))) {
    return true;
  }
  return false;
}

function isUnchangedExistingFk(
  engine: BuildEngine,
  table: ModelTable,
  fk: ModelForeignKey,
): boolean {
  if (!table.origin) {
    return false;
  }
  return table.origin.foreignKeys.some(
    (ofk) =>
      ofk.columns.length === fk.columns.length &&
      ofk.columns.every((c, idx) => sameColName(engine, c, fk.columns[idx]!)) &&
      sameColName(engine, ofk.target.schema, fk.target.schema) &&
      sameColName(engine, ofk.target.table, fk.target.table) &&
      ofk.target.columns.length === fk.target.columns.length &&
      ofk.target.columns.every((c, idx) =>
        sameColName(engine, c, fk.target.columns[idx]!),
      ) &&
      ofk.onDelete === fk.onDelete &&
      ofk.onUpdate === fk.onUpdate,
  );
}

function isAllowedIdentityType(engine: BuildEngine, rawType: string): boolean {
  const norm = normalizeType(engine, rawType);
  if (
    norm.base === "smallint" ||
    norm.base === "integer" ||
    norm.base === "bigint"
  ) {
    return true;
  }
  if (
    engine === "db2" &&
    norm.base === "numeric" &&
    norm.args.length >= 1 &&
    (norm.args[1] ?? 0) === 0
  ) {
    return true;
  }
  return false;
}

export function checkModel(
  model: BuildModel,
  context: CheckContext,
): Problem[] {
  const engine = model.engine;
  const rules = engineRules[engine];
  const problems: Problem[] = [];

  const pushProblem = (
    code: ProblemCode,
    severity: "error" | "warning" | "info",
    table: string | null,
    column: string | null,
    message: string,
    fix: ProblemFix | null = null,
  ) => {
    const key = buildProblemKey(code, table, column);
    if (
      severity === "warning" &&
      (model.ignoredWarnings.includes(key) ||
        model.ignoredWarnings.includes(code))
    ) {
      return;
    }
    problems.push({ code, severity, table, column, message, fix, key });
  };

  const activeTables = model.tables.filter((t) => !t.dropInDatabase);

  // E1: empty or control char in table, column, constraint, or index name
  for (const table of activeTables) {
    const tKey = tableKey(table);
    if (isInvalidName(table.name) || isInvalidName(table.schema)) {
      pushProblem("E1", "error", tKey, null, buildCopy.problems.e1("tabela"));
    }
    for (const col of table.columns) {
      if (isInvalidName(col.name)) {
        pushProblem(
          "E1",
          "error",
          tKey,
          col.name,
          buildCopy.problems.e1("coluna"),
        );
      }
    }
    if (table.primaryKey?.name !== null && table.primaryKey?.name !== undefined) {
      if (isInvalidName(table.primaryKey.name)) {
        pushProblem(
          "E1",
          "error",
          tKey,
          null,
          buildCopy.problems.e1("restrição"),
        );
      }
    }
    for (const u of table.uniques) {
      if (u.name !== null && isInvalidName(u.name)) {
        pushProblem(
          "E1",
          "error",
          tKey,
          null,
          buildCopy.problems.e1("restrição"),
        );
      }
    }
    for (const ck of table.checks) {
      if (ck.name !== null && isInvalidName(ck.name)) {
        pushProblem(
          "E1",
          "error",
          tKey,
          null,
          buildCopy.problems.e1("restrição"),
        );
      }
    }
    for (const fk of table.foreignKeys) {
      if (fk.name !== null && isInvalidName(fk.name)) {
        pushProblem(
          "E1",
          "error",
          tKey,
          null,
          buildCopy.problems.e1("restrição"),
        );
      }
    }
    for (const ix of table.indexes) {
      if (ix.name !== null && isInvalidName(ix.name)) {
        pushProblem(
          "E1",
          "error",
          tKey,
          null,
          buildCopy.problems.e1("índice"),
        );
      }
    }
  }

  // E2: duplicate table in schema, column in table, or constraint/index in schema
  for (let i = 0; i < activeTables.length; i++) {
    const table = activeTables[i]!;
    const tKey = tableKey(table);
    const hasEarlierDuplicateTable = activeTables
      .slice(0, i)
      .some(
        (other) =>
          sameColName(engine, other.schema, table.schema) &&
          sameName(
            engine,
            { name: other.name, exactName: other.exactName },
            { name: table.name, exactName: table.exactName },
          ),
      );
    if (hasEarlierDuplicateTable) {
      pushProblem("E2", "error", tKey, null, buildCopy.problems.e2(tKey));
    }

    for (let cIdx = 0; cIdx < table.columns.length; cIdx++) {
      const col = table.columns[cIdx]!;
      const hasEarlierDuplicateCol = table.columns
        .slice(0, cIdx)
        .some((other) =>
          sameName(
            engine,
            { name: other.name, exactName: other.exactName },
            { name: col.name, exactName: col.exactName },
          ),
        );
      if (hasEarlierDuplicateCol) {
        pushProblem(
          "E2",
          "error",
          tKey,
          col.name,
          buildCopy.problems.e2(`${tKey}.${col.name}`),
        );
      }
    }
  }

  // Check duplicate constraint/index names per schema
  const seenSchemaObjects = new Map<
    string,
    { name: string; exactName: boolean }[]
  >();
  for (const table of activeTables) {
    const tKey = tableKey(table);
    const schemaBucketKey =
      engine === "postgresql"
        ? table.schema.toLowerCase()
        : engine === "db2"
          ? table.schema.toUpperCase()
          : table.schema.toLowerCase();
    const bucket = seenSchemaObjects.get(schemaBucketKey) ?? [];
    seenSchemaObjects.set(schemaBucketKey, bucket);

    const namedObjects: string[] = [];
    if (table.primaryKey?.name) namedObjects.push(table.primaryKey.name);
    for (const u of table.uniques) if (u.name) namedObjects.push(u.name);
    for (const ck of table.checks) if (ck.name) namedObjects.push(ck.name);
    for (const fk of table.foreignKeys) if (fk.name) namedObjects.push(fk.name);
    for (const ix of table.indexes) if (ix.name) namedObjects.push(ix.name);

    for (const objName of namedObjects) {
      if (!objName.trim()) continue;
      const dup = bucket.some((prev) =>
        sameName(engine, prev, { name: objName, exactName: false }),
      );
      if (dup) {
        pushProblem("E2", "error", tKey, null, buildCopy.problems.e2(objName));
      } else {
        bucket.push({ name: objName, exactName: false });
      }
    }
  }

  // E3: table without columns
  for (const table of activeTables) {
    if (table.columns.length === 0) {
      const tKey = tableKey(table);
      pushProblem("E3", "error", tKey, null, buildCopy.problems.e3(tKey));
    }
  }

  // E4: column without type
  for (const table of activeTables) {
    const tKey = tableKey(table);
    for (const col of table.columns) {
      if (col.type.trim().length === 0) {
        pushProblem(
          "E4",
          "error",
          tKey,
          col.name,
          buildCopy.problems.e4(tKey, col.name),
        );
      }
    }
  }

  // E5, E6, E7: Foreign keys
  for (const table of activeTables) {
    const tKey = tableKey(table);
    table.foreignKeys.forEach((fk, fkIndex) => {
      const firstCol = fk.columns[0] ?? null;
      const unchangedExisting = isUnchangedExistingFk(engine, table, fk);

      // Check local columns exist on table
      const missingLocalCol = fk.columns.find(
        (fkCol) =>
          !table.columns.some((c) => sameColName(engine, c.name, fkCol)),
      );
      if (missingLocalCol) {
        pushProblem(
          "E5",
          "error",
          tKey,
          missingLocalCol,
          buildCopy.problems.e5(tKey, `${tKey}.${missingLocalCol}`),
          { kind: "removeForeignKey", table: tKey, index: fkIndex },
        );
        return;
      }

      const targetTable = findTargetTable(
        engine,
        model.tables,
        fk.target.schema,
        fk.target.table,
      );
      if (!targetTable) {
        if (!unchangedExisting) {
          pushProblem(
            "E5",
            "error",
            tKey,
            firstCol,
            buildCopy.problems.e5(
              tKey,
              `${fk.target.schema}.${fk.target.table}`,
            ),
            { kind: "removeForeignKey", table: tKey, index: fkIndex },
          );
        }
        return;
      }

      if (targetTable.dropInDatabase) {
        // Handled by E13 on targetTable
        return;
      }

      if (fk.columns.length !== fk.target.columns.length) {
        pushProblem(
          "E6",
          "error",
          tKey,
          firstCol,
          buildCopy.problems.e6(tKey, tableKey(targetTable)),
        );
        return;
      }

      const missingTargetCol = fk.target.columns.find(
        (targetCol) =>
          !targetTable.columns.some((c) =>
            sameColName(engine, c.name, targetCol),
          ),
      );
      if (missingTargetCol) {
        if (!unchangedExisting) {
          pushProblem(
            "E5",
            "error",
            tKey,
            firstCol,
            buildCopy.problems.e5(
              tKey,
              `${tableKey(targetTable)}.${missingTargetCol}`,
            ),
            { kind: "removeForeignKey", table: tKey, index: fkIndex },
          );
        }
        return;
      }

      // E7: FK to columns of a NEW table that are neither PK nor unique
      if (
        targetTable.origin === null &&
        !isCoveredByUniqueOrPk(engine, targetTable, fk.target.columns)
      ) {
        pushProblem(
          "E7",
          "error",
          tKey,
          firstCol,
          buildCopy.problems.e7(
            tKey,
            tableKey(targetTable),
            fk.target.columns.join(", "),
          ),
          {
            kind: "createUnique",
            table: tableKey(targetTable),
            columns: [...fk.target.columns],
          },
        );
      }
    });
  }

  // E8: index without columns or with non-existent column
  for (const table of activeTables) {
    const tKey = tableKey(table);
    for (const ix of table.indexes) {
      const ixLabel = ix.name ?? "(sem nome)";
      const missingCol =
        ix.columns.find(
          (ic) => !table.columns.some((c) => sameColName(engine, c.name, ic)),
        ) ?? null;
      if (ix.columns.length === 0 || missingCol !== null) {
        pushProblem(
          "E8",
          "error",
          tKey,
          missingCol,
          buildCopy.problems.e8(tKey, ixLabel),
        );
      }
    }
  }

  // E9: identifier exceeds engine identifierLimit
  for (const table of activeTables) {
    const tKey = tableKey(table);
    if (byteLength(table.name) > rules.identifierLimit) {
      pushProblem(
        "E9",
        "error",
        tKey,
        null,
        buildCopy.problems.e9(table.name, rules.identifierLimit),
      );
    }
    for (const col of table.columns) {
      if (byteLength(col.name) > rules.identifierLimit) {
        pushProblem(
          "E9",
          "error",
          tKey,
          col.name,
          buildCopy.problems.e9(col.name, rules.identifierLimit),
        );
      }
    }
    const namedConstraints = [
      table.primaryKey?.name ?? null,
      ...table.uniques.map((u) => u.name),
      ...table.checks.map((c) => c.name),
      ...table.foreignKeys.map((f) => f.name),
      ...table.indexes.map((i) => i.name),
    ];
    for (const cName of namedConstraints) {
      if (cName && byteLength(cName) > rules.identifierLimit) {
        pushProblem(
          "E9",
          "error",
          tKey,
          null,
          buildCopy.problems.e9(cName, rules.identifierLimit),
        );
      }
    }
  }

  // E10: identity on non-integer column
  for (const table of activeTables) {
    const tKey = tableKey(table);
    for (const col of table.columns) {
      if (
        col.identity !== null &&
        col.type.trim().length > 0 &&
        !isAllowedIdentityType(engine, col.type)
      ) {
        pushProblem(
          "E10",
          "error",
          tKey,
          col.name,
          buildCopy.problems.e10(tKey, col.name, col.type),
        );
      }
    }
  }

  // E11: FK action not supported by target engine
  for (const table of activeTables) {
    const tKey = tableKey(table);
    table.foreignKeys.forEach((fk, fkIndex) => {
      const validDelete = (rules.deleteActions as readonly string[]).includes(
        fk.onDelete,
      );
      const validUpdate = (rules.updateActions as readonly string[]).includes(
        fk.onUpdate,
      );
      if (!validDelete || !validUpdate) {
        const badAction = !validDelete
          ? `ON DELETE ${fk.onDelete}`
          : `ON UPDATE ${fk.onUpdate}`;
        pushProblem(
          "E11",
          "error",
          tKey,
          fk.columns[0] ?? null,
          buildCopy.problems.e11(tKey, badAction),
          {
            kind: "useFkAction",
            table: tKey,
            index: fkIndex,
            onDelete: validDelete ? fk.onDelete : "noAction",
            onUpdate: validUpdate ? fk.onUpdate : "noAction",
          },
        );
      }
    });
  }

  // E12: Informix varchar(n) with n > 255
  if (engine === "informix") {
    for (const table of activeTables) {
      const tKey = tableKey(table);
      for (const col of table.columns) {
        const norm = normalizeType(engine, col.type);
        if (
          norm.base === "varchar" &&
          norm.args.length >= 1 &&
          norm.args[0]! > 255
        ) {
          pushProblem(
            "E12",
            "error",
            tKey,
            col.name,
            buildCopy.problems.e12(tKey, col.name, col.type),
            {
              kind: "useType",
              table: tKey,
              column: col.name,
              type: `lvarchar(${norm.args[0]!})`,
            },
          );
        }
      }
    }
  }

  // E13: table marked dropInDatabase still referenced by another table that stays
  for (const table of model.tables) {
    if (!table.dropInDatabase) continue;
    const tKey = tableKey(table);
    const referencedByStaying = activeTables.some((other) =>
      other.foreignKeys.some(
        (fk) =>
          sameColName(engine, fk.target.schema, table.schema) &&
          sameName(
            engine,
            { name: fk.target.table, exactName: false },
            { name: table.name, exactName: table.exactName },
          ),
      ),
    );
    if (referencedByStaying) {
      pushProblem(
        "E13",
        "error",
        tKey,
        null,
        buildCopy.problems.e13(tKey),
        { kind: "removeReferencingForeignKeys", table: tKey },
      );
    }
  }

  // E14: existing table with forbidden changes (PK, identity on existing col, or schema)
  for (const table of activeTables) {
    if (!table.origin) continue;
    const changes = tableChanges(engine, table);
    if (changes.forbidden.length > 0) {
      const tKey = tableKey(table);
      pushProblem(
        "E14",
        "error",
        tKey,
        null,
        buildCopy.problems.e14(tKey),
        { kind: "revert", table: tKey, column: null },
      );
    }
  }

  // W1: new table without PK (when it has columns)
  for (const table of activeTables) {
    if (
      table.origin === null &&
      table.columns.length > 0 &&
      (!table.primaryKey || table.primaryKey.columns.length === 0)
    ) {
      const tKey = tableKey(table);
      pushProblem("W1", "warning", tKey, null, buildCopy.problems.w1(tKey), {
        kind: "createIdColumn",
        table: tKey,
      });
    }
  }

  // W2: FK column with different normalized type from referenced column
  for (const table of activeTables) {
    const tKey = tableKey(table);
    for (const fk of table.foreignKeys) {
      const targetTable = findTargetTable(
        engine,
        activeTables,
        fk.target.schema,
        fk.target.table,
      );
      if (!targetTable || fk.columns.length !== fk.target.columns.length) {
        continue;
      }
      for (let i = 0; i < fk.columns.length; i++) {
        const localCol = table.columns.find((c) =>
          sameColName(engine, c.name, fk.columns[i]!),
        );
        const targetCol = targetTable.columns.find((c) =>
          sameColName(engine, c.name, fk.target.columns[i]!),
        );
        if (!localCol || !targetCol) continue;
        if (!localCol.type.trim() || !targetCol.type.trim()) continue;
        const leftNorm = normalizeType(engine, localCol.type);
        const rightNorm = normalizeType(engine, targetCol.type);
        const sameNormalized =
          leftNorm.family === rightNorm.family &&
          leftNorm.base === rightNorm.base &&
          leftNorm.args.join(",") === rightNorm.args.join(",");
        if (!sameNormalized) {
          pushProblem(
            "W2",
            "warning",
            tKey,
            localCol.name,
            buildCopy.problems.w2(
              table.name,
              localCol.name,
              localCol.type,
              tableKey(targetTable),
              targetCol.name,
              targetCol.type,
            ),
            {
              kind: "useType",
              table: tKey,
              column: localCol.name,
              type: targetCol.type,
            },
          );
        }
      }
    }
  }

  // W3: PostgreSQL and Db2: FK columns not starting any index, PK or unique
  if (engine === "postgresql" || engine === "db2") {
    const missingIndexItems: { table: string; columns: string[] }[] = [];
    for (const table of activeTables) {
      const tKey = tableKey(table);
      for (const fk of table.foreignKeys) {
        if (fk.columns.length === 0) continue;
        if (isUnchangedExistingFk(engine, table, fk)) continue;
        const allColsExist = fk.columns.every((fkCol) =>
          table.columns.some((c) => sameColName(engine, c.name, fkCol)),
        );
        if (!allColsExist) continue;
        if (!hasIndexPrefix(engine, table, fk.columns)) {
          missingIndexItems.push({ table: tKey, columns: [...fk.columns] });
        }
      }
    }
    if (missingIndexItems.length > 0) {
      pushProblem("W3", "warning", null, null, buildCopy.problems.w3(), {
        kind: "createIndexes",
        items: missingIndexItems,
      });
    }
  }

  // W4: name that requires quotes in target engine
  for (const table of activeTables) {
    const tKey = tableKey(table);
    if (
      !isInvalidName(table.name) &&
      needsQuotes(engine, table.name, table.exactName)
    ) {
      pushProblem(
        "W4",
        "warning",
        tKey,
        null,
        buildCopy.problems.w4(table.name, engine === "informix"),
      );
    }
    for (const col of table.columns) {
      if (
        !isInvalidName(col.name) &&
        needsQuotes(engine, col.name, col.exactName)
      ) {
        pushProblem(
          "W4",
          "warning",
          tKey,
          col.name,
          buildCopy.problems.w4(col.name, engine === "informix"),
        );
      }
    }
  }

  // W5: column type not in target engine catalog
  for (const table of activeTables) {
    const tKey = tableKey(table);
    for (const col of table.columns) {
      if (col.type.trim().length > 0 && !isKnownEngineType(engine, col.type)) {
        const suggestion = closestType(engine, col.type);
        pushProblem(
          "W5",
          "warning",
          tKey,
          col.name,
          buildCopy.problems.w5(tKey, col.name, col.type, suggestion),
          suggestion
            ? {
                kind: "useType",
                table: tKey,
                column: col.name,
                type: suggestion,
              }
            : null,
        );
      }
    }
  }

  // W6: FK to columns of an EXISTING table that are neither PK nor unique index of it
  for (const table of activeTables) {
    const tKey = tableKey(table);
    for (const fk of table.foreignKeys) {
      const targetTable = findTargetTable(
        engine,
        activeTables,
        fk.target.schema,
        fk.target.table,
      );
      if (
        !targetTable ||
        targetTable.origin === null ||
        fk.columns.length !== fk.target.columns.length
      ) {
        continue;
      }
      const allTargetColsExist = fk.target.columns.every((tc) =>
        targetTable.columns.some((c) => sameColName(engine, c.name, tc)),
      );
      if (!allTargetColsExist) continue;
      if (!isCoveredByUniqueOrPk(engine, targetTable, fk.target.columns)) {
        pushProblem(
          "W6",
          "warning",
          tKey,
          fk.columns[0] ?? null,
          buildCopy.problems.w6(
            tKey,
            tableKey(targetTable),
            fk.target.columns.join(", "),
          ),
        );
      }
    }
  }

  // W7: new table with same schema.name as a table in base.knownTables not in model
  if (model.base) {
    for (const table of activeTables) {
      if (table.origin !== null) continue;
      const tKey = tableKey(table);
      const inKnown = model.base.knownTables.some((kt) => {
        const dot = kt.indexOf(".");
        if (dot < 0) return false;
        const kSchema = kt.slice(0, dot);
        const kName = kt.slice(dot + 1);
        return (
          sameColName(engine, kSchema, table.schema) &&
          sameName(
            engine,
            { name: kName, exactName: false },
            { name: table.name, exactName: table.exactName },
          )
        );
      });
      if (inKnown) {
        pushProblem(
          "W7",
          "warning",
          tKey,
          null,
          buildCopy.problems.w7(tKey),
        );
      }
    }
  }

  // W8: ignored SQL or DBML construct from context.notes
  for (const note of context.notes) {
    if (note.code === "W8") {
      pushProblem("W8", "warning", null, null, note.message);
    }
  }

  // W10 & W11: only in scope === "changes"
  if (context.scope === "changes") {
    for (const table of model.tables) {
      if (!table.origin) continue;
      const tKey = tableKey(table);
      if (table.dropInDatabase) {
        pushProblem(
          "W10",
          "warning",
          tKey,
          null,
          buildCopy.problems.w10DropTable(tKey),
          { kind: "restore", table: tKey, column: null },
        );
        continue;
      }

      const changes = tableChanges(engine, table);

      // W10: type narrows or family changes on existing columns
      for (const ch of changes.changedColumns) {
        if (!ch.type) continue;
        const currentCol = table.columns.find((c) => c.name === ch.name);
        const originCol = table.origin.columns.find(
          (oc) => (oc.originName ?? oc.name) === ch.originName || oc.name === ch.originName,
        );
        if (
          currentCol &&
          originCol &&
          typeNarrows(engine, originCol.type, currentCol.type)
        ) {
          pushProblem(
            "W10",
            "warning",
            tKey,
            currentCol.name,
            buildCopy.problems.w10NarrowType(
              tKey,
              currentCol.name,
              originCol.type,
              currentCol.type,
            ),
            { kind: "revert", table: tKey, column: currentCol.name },
          );
        }
      }

      // W10: removed columns (DROP COLUMN)
      for (const removedOriginName of changes.removedColumns) {
        pushProblem(
          "W10",
          "warning",
          tKey,
          removedOriginName,
          buildCopy.problems.w10DropColumn(tKey, removedOriginName),
          { kind: "restore", table: tKey, column: removedOriginName },
        );
      }

      // W11: new NOT NULL column without default on existing table, or existing column changed from nullable to NOT NULL without default
      for (const addedColName of changes.addedColumns) {
        const col = table.columns.find((c) => c.name === addedColName);
        if (
          col &&
          !col.nullable &&
          col.identity === null &&
          (col.default === null || col.default.trim().length === 0)
        ) {
          pushProblem(
            "W11",
            "warning",
            tKey,
            col.name,
            buildCopy.problems.w11(tKey, col.name),
            { kind: "giveDefault", table: tKey, column: col.name },
          );
        }
      }
      for (const ch of changes.changedColumns) {
        if (!ch.nullable) continue;
        const col = table.columns.find((c) => c.name === ch.name);
        const originCol = table.origin.columns.find(
          (oc) => (oc.originName ?? oc.name) === ch.originName || oc.name === ch.originName,
        );
        if (
          col &&
          originCol &&
          originCol.nullable &&
          !col.nullable &&
          (col.default === null || col.default.trim().length === 0)
        ) {
          pushProblem(
            "W11",
            "warning",
            tKey,
            col.name,
            buildCopy.problems.w11(tKey, col.name),
            { kind: "giveDefault", table: tKey, column: col.name },
          );
        }
      }
    }
  }

  // W12: full DDL: FK of existing table to table outside model
  if (context.scope === "full") {
    for (const table of activeTables) {
      if (!table.origin) continue;
      const tKey = tableKey(table);
      for (const fk of table.foreignKeys) {
        const targetTable = findTargetTable(
          engine,
          model.tables,
          fk.target.schema,
          fk.target.table,
        );
        if (!targetTable) {
          pushProblem(
            "W12",
            "warning",
            tKey,
            fk.columns[0] ?? null,
            buildCopy.problems.w12(
              tKey,
              `${fk.target.schema}.${fk.target.table}`,
            ),
          );
        }
      }
    }
  }

  // W13: reread note from context.notes
  for (const note of context.notes) {
    if (note.code === "W13") {
      pushProblem("W13", "warning", null, null, note.message);
    }
  }

  // W14: full DDL: default uses nextval(...) sequence not created by script
  if (context.scope === "full") {
    for (const table of activeTables) {
      const tKey = tableKey(table);
      for (const col of table.columns) {
        if (col.default && /\bnextval\s*\(/i.test(col.default)) {
          pushProblem(
            "W14",
            "warning",
            tKey,
            col.name,
            buildCopy.problems.w14(tKey, col.name, col.default),
            { kind: "useIdentity", table: tKey, column: col.name },
          );
        }
      }
    }
  }

  // I1: base has environment (e.g. Produção) and scope is changes
  if (
    context.scope === "changes" &&
    model.base !== null &&
    context.baseEnvironment !== null
  ) {
    pushProblem(
      "I1",
      "info",
      null,
      null,
      buildCopy.problems.i1(
        context.baseLabel ??
          `${model.base.connectionId} / ${model.base.database}`,
      ),
    );
  }

  // I2: existing tables read date
  if (
    model.base !== null &&
    activeTables.some((t) => t.origin !== null)
  ) {
    pushProblem(
      "I2",
      "info",
      null,
      null,
      buildCopy.problems.i2(model.base.readAt),
      { kind: "reread" },
    );
  }

  // I3: full DDL of a model with existing tables and a base
  if (
    context.scope === "full" &&
    model.base !== null &&
    activeTables.some((t) => t.origin !== null)
  ) {
    pushProblem(
      "I3",
      "info",
      null,
      null,
      buildCopy.problems.i3(
        context.baseLabel ??
          `${model.base.connectionId} / ${model.base.database}`,
      ),
    );
  }

  return problems;
}

export function applyFix(model: BuildModel, fix: ProblemFix): BuildModel {
  switch (fix.kind) {
    case "removeForeignKey":
      return removeForeignKey(model, fix.table, fix.index);

    case "createUnique":
      return {
        ...model,
        tables: model.tables.map((t) =>
          tableKey(t) === fix.table
            ? {
                ...t,
                uniques: [
                  ...t.uniques,
                  {
                    name: `uq_${t.name}_${fix.columns.join("_")}`,
                    columns: [...fix.columns],
                  },
                ],
              }
            : t,
        ),
      };

    case "useFkAction": {
      const table = model.tables.find((t) => tableKey(t) === fix.table);
      const existingFk = table?.foreignKeys[fix.index];
      if (!existingFk) return model;
      return updateForeignKey(model, fix.table, fix.index, {
        ...existingFk,
        onDelete: fix.onDelete,
        onUpdate: fix.onUpdate,
      });
    }

    case "useType":
      return updateColumn(model, fix.table, fix.column, { type: fix.type });

    case "createIdColumn": {
      const table = model.tables.find((t) => tableKey(t) === fix.table);
      if (!table) return model;
      const hasId = table.columns.some((c) => c.name === "id");
      const withCol = hasId
        ? model
        : addColumn(model, fix.table, {
            name: "id",
            type: "bigint",
            nullable: false,
            identity: "always",
          });
      return togglePrimaryKey(withCol, fix.table, "id");
    }

    case "createIndexes": {
      let next = model;
      for (const item of fix.items) {
        next = addIndex(next, item.table, item.columns);
      }
      return next;
    }

    case "restore":
      if (fix.column === null) {
        return setDropInDatabase(model, fix.table, false);
      }
      return restoreColumn(model, fix.table, fix.column);

    case "revert":
      if (fix.column === null) {
        return revertTable(model, fix.table);
      }
      return revertColumn(model, fix.table, fix.column);

    case "removeReferencingForeignKeys": {
      const target = model.tables.find((t) => tableKey(t) === fix.table);
      if (!target) return model;
      return {
        ...model,
        tables: model.tables.map((t) => ({
          ...t,
          foreignKeys: t.foreignKeys.filter(
            (fk) =>
              !(
                sameColName(model.engine, fk.target.schema, target.schema) &&
                sameName(
                  model.engine,
                  { name: fk.target.table, exactName: false },
                  { name: target.name, exactName: target.exactName },
                )
              ),
          ),
        })),
      };
    }

    case "giveDefault": {
      const table = model.tables.find((t) => tableKey(t) === fix.table);
      const col = table?.columns.find((c) => c.name === fix.column);
      if (!col) return model;
      const norm = normalizeType(model.engine, col.type);
      const fallbackDefault =
        norm.family === "integer" || norm.family === "decimal" || norm.family === "float"
          ? "0"
          : norm.family === "boolean"
            ? "false"
            : "''";
      return updateColumn(model, fix.table, fix.column, {
        default: fallbackDefault,
      });
    }

    case "useIdentity":
      return updateColumn(model, fix.table, fix.column, {
        default: null,
        identity: "byDefault",
      });

    case "reread":
      return model;
  }
}

export function problemCounts(problems: readonly Problem[]): {
  errors: number;
  warnings: number;
} {
  let errors = 0;
  let warnings = 0;
  for (const p of problems) {
    if (p.severity === "error") errors++;
    else if (p.severity === "warning") warnings++;
  }
  return { errors, warnings };
}
