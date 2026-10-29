import { sameName } from "@/app/build/_lib/build-engines";
import type {
  BuildEngine,
  BuildModel,
  ModelColumn,
  ModelTable,
  ModelUnique,
} from "@/app/build/_lib/build-model.schema";

export type TextError = { line: number; column: number; message: string };
export type TextWarning = { line: number; message: string };
export type TextRead =
  | { ok: true; tables: ModelTable[]; schemas: string[]; warnings: TextWarning[] }
  | { ok: false; error: TextError };

export function sameIdent(engine: BuildEngine, a: string, b: string): boolean {
  return a === b || sameName(engine, { name: a, exactName: false }, { name: b, exactName: false });
}

export function sameColumnList(
  engine: BuildEngine,
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!sameIdent(engine, a[i], b[i])) return false;
  }
  return true;
}

export function mergeTextTables(
  read: ModelTable[],
  before: BuildModel,
  format: "sql" | "dbml",
): ModelTable[] {
  const engine = before.engine;

  return read.map((table) => {
    const prev = before.tables.find(
      (candidate) =>
        sameIdent(engine, candidate.schema, table.schema) &&
        sameName(engine, candidate, table),
    );
    if (!prev) {
      return table;
    }

    const columns: ModelColumn[] = table.columns.map((col) => {
      const prevCol = prev.columns.find((c) => sameName(engine, c, col));
      const originCol = prev.origin?.columns.find((c) => sameName(engine, c, col));
      const originName = prevCol ? prevCol.originName : originCol ? originCol.name : null;
      const exactName = col.exactName || (prevCol?.exactName ?? false);
      const identity =
        format === "dbml" && col.identity !== null && prevCol?.identity
          ? prevCol.identity
          : col.identity;
      const comment =
        format === "sql" && engine === "informix"
          ? (col.comment ?? prevCol?.comment ?? null)
          : col.comment;

      return {
        ...col,
        exactName,
        originName,
        identity,
        comment,
      };
    });

    const primaryKey = table.primaryKey
      ? {
          name:
            table.primaryKey.name ??
            (prev.primaryKey &&
            sameColumnList(engine, table.primaryKey.columns, prev.primaryKey.columns)
              ? prev.primaryKey.name
              : null),
          columns: table.primaryKey.columns,
        }
      : null;

    const restoredUniquesFromIndexes: ModelUnique[] = [];
    const remainingIndexes = table.indexes.filter((idx) => {
      if (format === "dbml" && idx.unique) {
        const prevUq = prev.uniques.find((u) => sameColumnList(engine, u.columns, idx.columns));
        if (prevUq) {
          restoredUniquesFromIndexes.push({
            name: (idx.name || null) ?? prevUq.name,
            columns: idx.columns,
          });
          return false;
        }
      }
      return true;
    });

    const uniques: ModelUnique[] = [
      ...table.uniques.map((uq) => {
        const prevUq = prev.uniques.find((u) => sameColumnList(engine, u.columns, uq.columns));
        return {
          name: uq.name ?? prevUq?.name ?? null,
          columns: uq.columns,
        };
      }),
      ...restoredUniquesFromIndexes,
    ];

    const checks = table.checks.map((chk) => {
      const prevChk = prev.checks.find((c) => c.expression.trim() === chk.expression.trim());
      return {
        name: chk.name ?? prevChk?.name ?? null,
        expression: chk.expression,
      };
    });

    const foreignKeys = table.foreignKeys.map((fk) => {
      const prevFk = prev.foreignKeys.find(
        (f) =>
          sameColumnList(engine, f.columns, fk.columns) &&
          sameIdent(engine, f.target.schema, fk.target.schema) &&
          sameIdent(engine, f.target.table, fk.target.table) &&
          sameColumnList(engine, f.target.columns, fk.target.columns),
      );
      return {
        ...fk,
        name: fk.name ?? prevFk?.name ?? null,
      };
    });

    const comment =
      format === "sql" && engine === "informix" ? (table.comment ?? prev.comment) : table.comment;

    return {
      ...table,
      exactName: table.exactName || prev.exactName,
      comment,
      columns,
      primaryKey,
      uniques,
      checks,
      indexes: remainingIndexes,
      foreignKeys,
      origin: prev.origin,
      dropInDatabase: false,
    };
  });
}

export function applyTextRead(
  model: BuildModel,
  read: Extract<TextRead, { ok: true }>,
): BuildModel {
  const schemas = [...model.schemas];
  const ensureSchema = (name: string, explicitCreate: boolean) => {
    const existingIdx = schemas.findIndex((s) => sameIdent(model.engine, s.name, name));
    if (existingIdx >= 0) {
      if (explicitCreate && !schemas[existingIdx].create) {
        schemas[existingIdx] = { ...schemas[existingIdx], create: true };
      }
      return;
    }
    const inKnown =
      model.base?.knownSchemas.some((s) => sameIdent(model.engine, s, name)) ?? false;
    schemas.push({
      name,
      create: explicitCreate || (!inKnown && !sameIdent(model.engine, name, "public")),
    });
  };

  for (const s of read.schemas) {
    ensureSchema(s, true);
  }
  for (const t of read.tables) {
    ensureSchema(t.schema, false);
  }

  return {
    ...model,
    schemas,
    tables: read.tables,
  };
}
