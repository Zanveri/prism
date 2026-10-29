import { exactNameFromCatalog, sameName } from "@/app/build/_lib/build-engines";
import { emptyModel } from "@/app/build/_lib/build-model";
import type {
  BuildEngine,
  BuildModel,
  FkAction,
  ModelColumn,
  ModelTable,
  TableShape,
} from "@/app/build/_lib/build-model.schema";
import {
  getColumns,
  getIndexes,
  getObjects,
  getSchemaDiagram,
  getTableChecks,
} from "@/app/workbench/_lib/database-sessions.service";

export type CatalogTable = {
  schema: string;
  name: string;
  comment: string | null;
  columns: {
    name: string;
    type: string;
    isNullable: boolean;
    isPrimaryKey: boolean;
    defaultValue: string | null;
    generated: "always" | "byDefault" | null;
  }[];
  foreignKeys: {
    name: string;
    columns: string[];
    referencedSchema: string;
    referencedTable: string;
    referencedColumns: string[];
    onDelete: string | null;
    onUpdate: string | null;
  }[];
  indexes: {
    name: string;
    columns: string[];
    isUnique: boolean;
  }[];
  checks: {
    name: string;
    expression: string;
  }[];
};

export type CatalogSnapshot = {
  schemas: string[];
  knownTables: string[];
  tables: CatalogTable[];
};

export type CatalogSelection = {
  schema: string;
  tables: string[];
}[];

function sameIdentifier(engine: BuildEngine, a: string, b: string): boolean {
  return sameName(
    engine,
    { name: a, exactName: exactNameFromCatalog(engine, a) },
    { name: b, exactName: exactNameFromCatalog(engine, b) },
  );
}

function sameColumnList(engine: BuildEngine, a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((col, i) => sameIdentifier(engine, col, b[i]));
}

function normalizeFkAction(action: string | null | undefined): FkAction {
  if (!action) return "noAction";
  const upper = action.trim().toUpperCase().replace(/_/g, " ");
  if (upper === "CASCADE") return "cascade";
  if (upper === "SET NULL") return "setNull";
  if (upper === "RESTRICT") return "restrict";
  if (upper === "NO ACTION") return "noAction";
  return "noAction";
}

function mapCatalogColumn(
  engine: BuildEngine,
  col: CatalogTable["columns"][number],
): ModelColumn {
  const lowerType = col.type.trim().toLowerCase();
  if (engine === "informix") {
    if (lowerType === "serial" || lowerType === "serial4") {
      return {
        name: col.name,
        exactName: exactNameFromCatalog(engine, col.name),
        originName: col.name,
        type: "integer",
        nullable: col.isNullable,
        default: null,
        identity: "byDefault",
        comment: null,
      };
    }
    if (lowerType === "bigserial" || lowerType === "serial8") {
      return {
        name: col.name,
        exactName: exactNameFromCatalog(engine, col.name),
        originName: col.name,
        type: "bigint",
        nullable: col.isNullable,
        default: null,
        identity: "byDefault",
        comment: null,
      };
    }
    if (lowerType === "smallserial" || lowerType === "serial2") {
      return {
        name: col.name,
        exactName: exactNameFromCatalog(engine, col.name),
        originName: col.name,
        type: "smallint",
        nullable: col.isNullable,
        default: null,
        identity: "byDefault",
        comment: null,
      };
    }
  }

  const identity = col.generated ?? null;
  return {
    name: col.name,
    exactName: exactNameFromCatalog(engine, col.name),
    originName: col.name,
    type: col.type,
    nullable: col.isNullable,
    default: identity ? null : (col.defaultValue ?? null),
    identity,
    comment: null,
  };
}

/**
 * Converte uma tabela lida do catálogo em `ModelTable` com `origin` preenchido.
 */
export function tableFromCatalog(engine: BuildEngine, table: CatalogTable): ModelTable {
  const columns = table.columns.map((c) => mapCatalogColumn(engine, c));
  const pkColumns = table.columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const pkIndex =
    pkColumns.length > 0
      ? table.indexes.find(
          (idx) => idx.isUnique && sameColumnList(engine, idx.columns, pkColumns),
        )
      : undefined;

  const primaryKey =
    pkColumns.length > 0
      ? { name: pkIndex?.name || null, columns: pkColumns }
      : null;

  const indexes = table.indexes
    .filter((idx) => idx !== pkIndex)
    .map((idx) => ({
      name: idx.name || null,
      columns: [...idx.columns],
      unique: idx.isUnique,
    }));

  const checks = table.checks.map((ck) => ({
    name: ck.name || null,
    expression: ck.expression,
  }));

  const foreignKeys = table.foreignKeys.map((fk) => ({
    name: fk.name || null,
    columns: [...fk.columns],
    target: {
      schema: fk.referencedSchema,
      table: fk.referencedTable,
      columns: [...fk.referencedColumns],
    },
    onDelete: normalizeFkAction(fk.onDelete),
    onUpdate: normalizeFkAction(fk.onUpdate),
  }));

  const snapshot: TableShape = {
    schema: table.schema,
    name: table.name,
    exactName: exactNameFromCatalog(engine, table.name),
    comment: table.comment ?? null,
    columns,
    primaryKey,
    uniques: [],
    checks,
    indexes,
    foreignKeys,
  };

  return {
    ...structuredClone(snapshot),
    origin: structuredClone(snapshot),
    dropInDatabase: false,
  };
}

/**
 * RN-CONSTRUIR-056: lê as tabelas escolhidas do catálogo da sessão, com até 4 pedidos simultâneos.
 */
export async function readCatalog(
  sessionId: string,
  selection: CatalogSelection,
  options: {
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<{
  snapshot: CatalogSnapshot;
  failures: { table: string; message: string }[];
}> {
  const total = selection.reduce((sum, item) => sum + item.tables.length, 0);
  options.onProgress?.(0, total);

  const schemas: string[] = [];
  const knownTables: string[] = [];
  const failures: { table: string; message: string }[] = [];

  const diagramsBySchema = new Map<
    string,
    Awaited<ReturnType<typeof getSchemaDiagram>>["data"] | null
  >();
  const commentsBySchemaTable = new Map<string, string | null>();

  for (const group of selection) {
    if (!schemas.includes(group.schema)) {
      schemas.push(group.schema);
    }
    const [diagramRes, objectsRes] = await Promise.all([
      getSchemaDiagram(sessionId, group.schema, options.signal),
      getObjects(sessionId, group.schema, "tables", options.signal),
    ]);

    diagramsBySchema.set(group.schema, diagramRes.ok ? diagramRes.data : null);

    if (objectsRes.ok) {
      for (const obj of objectsRes.data) {
        const key = `${group.schema}.${obj.name}`;
        if (!knownTables.includes(key)) {
          knownTables.push(key);
        }
        commentsBySchemaTable.set(key, obj.comment ?? null);
      }
    } else if (diagramRes.ok) {
      for (const tbl of diagramRes.data.tables) {
        const key = `${group.schema}.${tbl.name}`;
        if (!knownTables.includes(key)) {
          knownTables.push(key);
        }
      }
    } else {
      for (const tblName of group.tables) {
        const key = `${group.schema}.${tblName}`;
        if (!knownTables.includes(key)) {
          knownTables.push(key);
        }
      }
    }
  }

  const tasks: { schema: string; table: string }[] = [];
  for (const group of selection) {
    for (const table of group.tables) {
      tasks.push({ schema: group.schema, table });
    }
  }

  const results: CatalogTable[] = new Array(tasks.length);
  let nextIndex = 0;
  let done = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      const { schema, table } = tasks[idx];
      const key = `${schema}.${table}`;
      const diagram = diagramsBySchema.get(schema);
      const diagramTable = diagram?.tables.find((t) => t.name === table);
      const diagramFks =
        diagram?.foreignKeys
          .filter((fk) => fk.referencingTable === table)
          .map((fk) => ({
            name: fk.name,
            columns: [...fk.columns],
            referencedSchema: fk.referencedSchema,
            referencedTable: fk.referencedTable,
            referencedColumns: [...fk.referencedColumns],
            onDelete: fk.onDelete ?? null,
            onUpdate: fk.onUpdate ?? null,
          })) ?? [];

      const [columnsRes, indexesRes, checksRes] = await Promise.all([
        getColumns(sessionId, schema, table, options.signal),
        getIndexes(sessionId, schema, table, options.signal),
        getTableChecks(sessionId, schema, table, options.signal),
      ]);

      if (!columnsRes.ok || !indexesRes.ok || !checksRes.ok) {
        const err = !columnsRes.ok
          ? columnsRes.error
          : !indexesRes.ok
            ? indexesRes.error
            : !checksRes.ok
              ? checksRes.error
              : null;
        if (err) {
          failures.push({
            table: key,
            message: err.detail ?? err.title,
          });
        }
      }

      const columns: CatalogTable["columns"] = columnsRes.ok
        ? columnsRes.data.map((c) => ({
            name: c.name,
            type: c.type,
            isNullable: c.isNullable,
            isPrimaryKey: c.isPrimaryKey,
            defaultValue: c.defaultValue ?? null,
            generated: c.generated ?? null,
          }))
        : (diagramTable?.columns.map((c) => ({
            name: c.name,
            type: c.type,
            isNullable: c.isNullable,
            isPrimaryKey: c.isPrimaryKey,
            defaultValue: null,
            generated: null,
          })) ?? []);

      const indexes: CatalogTable["indexes"] = indexesRes.ok
        ? indexesRes.data.map((i) => ({
            name: i.name,
            columns: [...i.columns],
            isUnique: i.isUnique,
          }))
        : [];

      const checks: CatalogTable["checks"] = checksRes.ok
        ? checksRes.data.map((ck) => ({
            name: ck.name,
            expression: ck.expression,
          }))
        : [];

      results[idx] = {
        schema,
        name: table,
        comment: commentsBySchemaTable.get(key) ?? null,
        columns,
        foreignKeys: diagramFks,
        indexes,
        checks,
      };

      done += 1;
      options.onProgress?.(done, total);
    }
  }

  const concurrency = Math.min(4, Math.max(1, tasks.length));
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  return {
    snapshot: {
      schemas,
      knownTables,
      tables: results,
    },
    failures,
  };
}

/**
 * Cria um modelo novo já populado com as tabelas importadas do catálogo.
 */
export function modelFromCatalog(input: {
  engine: BuildEngine;
  defaultSchema: string;
  createSchema: boolean;
  base: { connectionId: string; database: string | null };
  snapshot: CatalogSnapshot;
  readAt: string;
}): BuildModel {
  const initial = emptyModel(
    input.engine,
    input.defaultSchema,
    input.createSchema,
  );

  const withBase: BuildModel = {
    ...initial,
    base: {
      connectionId: input.base.connectionId,
      database: input.base.database,
      readAt: input.readAt,
      knownSchemas: [...input.snapshot.schemas],
      knownTables: [...input.snapshot.knownTables],
    },
  };

  return addCatalogTables(withBase, input.snapshot, input.readAt);
}

/**
 * Acrescenta tabelas lidas do catálogo a um modelo existente.
 */
export function addCatalogTables(
  model: BuildModel,
  snapshot: CatalogSnapshot,
  readAt: string,
): BuildModel {
  const schemas = [...model.schemas];
  const ensureSchema = (schemaName: string) => {
    if (!schemas.some((s) => sameIdentifier(model.engine, s.name, schemaName))) {
      schemas.push({ name: schemaName, create: false });
    }
  };

  for (const s of snapshot.schemas) {
    ensureSchema(s);
  }

  const tables = [...model.tables];
  for (const catTable of snapshot.tables) {
    ensureSchema(catTable.schema);
    const imported = tableFromCatalog(model.engine, catTable);
    const existingIdx = tables.findIndex(
      (t) =>
        sameIdentifier(model.engine, t.schema, imported.schema) &&
        sameName(model.engine, t, imported),
    );
    if (existingIdx >= 0) {
      tables[existingIdx] = imported;
    } else {
      tables.push(imported);
    }
  }

  const knownSchemas = model.base ? [...model.base.knownSchemas] : [];
  for (const s of snapshot.schemas) {
    if (!knownSchemas.includes(s)) {
      knownSchemas.push(s);
    }
  }

  const knownTables = model.base ? [...model.base.knownTables] : [];
  for (const t of snapshot.knownTables) {
    if (!knownTables.includes(t)) {
      knownTables.push(t);
    }
  }

  return {
    ...model,
    schemas,
    tables,
    base: model.base
      ? {
          ...model.base,
          readAt,
          knownSchemas,
          knownTables,
        }
      : null,
  };
}

/**
 * RN-CONSTRUIR-058: relê as tabelas existentes do banco, preservando as mudanças feitas no modelo.
 */
export function rereadModel(
  model: BuildModel,
  snapshot: CatalogSnapshot,
  readAt: string,
): { model: BuildModel; notes: string[] } {
  const notes: string[] = [];
  const engine = model.engine;

  const updatedTables: ModelTable[] = model.tables.map((table) => {
    if (table.origin === null) {
      return table;
    }

    const prevOrigin = table.origin;
    const catTable = snapshot.tables.find(
      (ct) =>
        sameIdentifier(engine, ct.schema, prevOrigin.schema) &&
        sameIdentifier(engine, ct.name, prevOrigin.name),
    );

    if (!catTable) {
      notes.push(
        `${table.schema}.${table.name} sumiu do banco e virou tabela nova no modelo.`,
      );
      return {
        ...table,
        columns: table.columns.map((c) => ({ ...c, originName: null })),
        origin: null,
        dropInDatabase: false,
      };
    }

    const freshTable = tableFromCatalog(engine, catTable);
    const matchedFreshCols = new Set<string>();
    const existingProcessed: ModelColumn[] = [];
    const modelNewCols: ModelColumn[] = [];

    for (const col of table.columns) {
      if (col.originName === null) {
        modelNewCols.push(col);
        continue;
      }

      const prevCol = prevOrigin.columns.find((c) =>
        sameIdentifier(engine, c.name, col.originName!),
      );
      const freshCol = freshTable.columns.find((c) =>
        sameIdentifier(engine, c.name, col.originName!),
      );

      if (!freshCol) {
        notes.push(
          `${table.schema}.${table.name}.${col.name} sumiu do banco e virou coluna nova no modelo.`,
        );
        existingProcessed.push({
          ...col,
          originName: null,
        });
        continue;
      }

      matchedFreshCols.add(freshCol.name);

      if (prevCol) {
        const dbChanged =
          prevCol.type !== freshCol.type ||
          prevCol.nullable !== freshCol.nullable ||
          prevCol.default !== freshCol.default ||
          prevCol.identity !== freshCol.identity ||
          prevCol.comment !== freshCol.comment;

        if (dbChanged) {
          if (prevCol.type !== freshCol.type) {
            notes.push(
              `${table.schema}.${table.name}.${freshCol.name} mudou no banco (${prevCol.type} → ${freshCol.type}).`,
            );
          } else {
            notes.push(
              `${table.schema}.${table.name}.${freshCol.name} mudou no banco.`,
            );
          }
        }
      }

      existingProcessed.push({
        name: prevCol && col.name === prevCol.name ? freshCol.name : col.name,
        exactName:
          prevCol && col.exactName === prevCol.exactName
            ? freshCol.exactName
            : col.exactName,
        originName: freshCol.name,
        type: prevCol && col.type === prevCol.type ? freshCol.type : col.type,
        nullable:
          prevCol && col.nullable === prevCol.nullable
            ? freshCol.nullable
            : col.nullable,
        default:
          prevCol && col.default === prevCol.default
            ? freshCol.default
            : col.default,
        identity:
          prevCol && col.identity === prevCol.identity
            ? freshCol.identity
            : col.identity,
        comment:
          prevCol && col.comment === prevCol.comment
            ? freshCol.comment
            : col.comment,
      });
    }

    const dbNewCols: ModelColumn[] = [];
    for (const freshCol of freshTable.columns) {
      if (matchedFreshCols.has(freshCol.name)) continue;
      const existedInPrevOrigin = prevOrigin.columns.some((c) =>
        sameIdentifier(engine, c.name, freshCol.name),
      );
      if (!existedInPrevOrigin) {
        notes.push(
          `${table.schema}.${table.name} ganhou a coluna ${freshCol.name} no banco.`,
        );
        dbNewCols.push(structuredClone(freshCol));
      }
    }

    return {
      ...table,
      columns: [...existingProcessed, ...dbNewCols, ...modelNewCols],
      origin: freshTable.origin,
    };
  });

  return {
    model: {
      ...model,
      tables: updatedTables,
      base: model.base
        ? {
            ...model.base,
            readAt,
            knownSchemas: [...snapshot.schemas],
            knownTables: [...snapshot.knownTables],
          }
        : null,
    },
    notes,
  };
}
