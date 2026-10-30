import { needsQuotes, normalizeType, sameName } from "./build-engines";
import type {
  BuildEngine,
  BuildModel,
  ModelCheck,
  ModelColumn,
  ModelForeignKey,
  ModelIndex,
  ModelPrimaryKey,
  ModelTable,
  ModelUnique,
  TableShape,
} from "./build-model.schema";

export type {
  BuildEngine,
  BuildModel,
  ModelCheck,
  ModelColumn,
  ModelForeignKey,
  ModelIndex,
  ModelPrimaryKey,
  ModelTable,
  ModelUnique,
  TableShape,
};

function sameIdentifier(
  engine: BuildEngine,
  left: string,
  right: string,
  leftExact = false,
  rightExact = false,
): boolean {
  return sameName(
    engine,
    { name: left, exactName: leftExact },
    { name: right, exactName: rightExact },
  );
}

export function tableKey(table: { schema: string; name: string }): string {
  return `${table.schema}.${table.name}`;
}

export function emptyModel(
  engine: BuildEngine,
  defaultSchema = engine === "db2" ? "DB2INST1" : engine === "informix" ? "informix" : "public",
  createSchema = false,
): BuildModel {
  return {
    version: 1,
    engine,
    defaultSchema,
    schemas: [{ name: defaultSchema, create: createSchema }],
    base: null,
    tables: [],
    layout: {},
    ddl: {
      scope: null,
      constraintNames: true,
      comments: true,
      foreignKeysAtEnd: false,
      dropNewFirst: false,
    },
    ignoredWarnings: [],
  };
}

function ensureSchemaInList(model: BuildModel, schemaName: string): BuildModel["schemas"] {
  if (model.schemas.some((s) => sameIdentifier(model.engine, s.name, schemaName))) {
    return model.schemas;
  }
  const knownInBase =
    model.base?.knownSchemas.some((s) => sameIdentifier(model.engine, s, schemaName)) ?? false;
  return [...model.schemas, { name: schemaName, create: !knownInBase }];
}

export function addTable(
  model: BuildModel,
  schema?: string,
): { model: BuildModel; key: string } {
  const targetSchema = schema ?? model.defaultSchema;
  let index = model.tables.length + 1;
  let candidateName = `tabela_${index}`;
  while (
    model.tables.some(
      (t) =>
        sameIdentifier(model.engine, t.schema, targetSchema) &&
        sameIdentifier(model.engine, t.name, candidateName, t.exactName, false),
    )
  ) {
    index += 1;
    candidateName = `tabela_${index}`;
  }

  const newTable: ModelTable = {
    schema: targetSchema,
    name: candidateName,
    exactName: needsQuotes(model.engine, candidateName, false),
    comment: null,
    columns: [
      {
        name: "id",
        exactName: false,
        originName: null,
        type: "bigint",
        nullable: false,
        default: null,
        identity: "always",
        comment: null,
      },
    ],
    primaryKey: { name: null, columns: ["id"] },
    uniques: [],
    checks: [],
    indexes: [],
    foreignKeys: [],
    origin: null,
    dropInDatabase: false,
  };

  const key = tableKey(newTable);
  return {
    key,
    model: {
      ...model,
      schemas: ensureSchemaInList(model, targetSchema),
      tables: [...model.tables, newTable],
    },
  };
}

export function renameTable(model: BuildModel, key: string, name: string): BuildModel {
  const target = model.tables.find((t) => tableKey(t) === key);
  if (!target) {
    return model;
  }
  const trimmed = name.trim();
  const nextExact = needsQuotes(model.engine, trimmed, false);
  const nextKey = `${target.schema}.${trimmed}`;

  const tables = model.tables.map((t) => {
    const updatedTable =
      tableKey(t) === key ? { ...t, name: trimmed, exactName: nextExact } : t;
    const foreignKeys = updatedTable.foreignKeys.map((fk) => {
      if (
        sameIdentifier(model.engine, fk.target.schema, target.schema) &&
        sameIdentifier(model.engine, fk.target.table, target.name, false, target.exactName)
      ) {
        return {
          ...fk,
          target: { ...fk.target, table: trimmed },
        };
      }
      return fk;
    });
    return { ...updatedTable, foreignKeys };
  });

  const layout = { ...model.layout };
  if (nextKey !== key && key in layout) {
    layout[nextKey] = layout[key]!;
    delete layout[key];
  }

  return { ...model, tables, layout };
}

export function moveTableToSchema(
  model: BuildModel,
  key: string,
  schema: string,
): BuildModel {
  const target = model.tables.find((t) => tableKey(t) === key);
  if (!target) {
    return model;
  }
  const trimmedSchema = schema.trim();
  const nextKey = `${trimmedSchema}.${target.name}`;

  const tables = model.tables.map((t) => {
    const updatedTable =
      tableKey(t) === key ? { ...t, schema: trimmedSchema } : t;
    const foreignKeys = updatedTable.foreignKeys.map((fk) => {
      if (
        sameIdentifier(model.engine, fk.target.schema, target.schema) &&
        sameIdentifier(model.engine, fk.target.table, target.name, false, target.exactName)
      ) {
        return {
          ...fk,
          target: { ...fk.target, schema: trimmedSchema },
        };
      }
      return fk;
    });
    return { ...updatedTable, foreignKeys };
  });

  const layout = { ...model.layout };
  if (nextKey !== key && key in layout) {
    layout[nextKey] = layout[key]!;
    delete layout[key];
  }

  return {
    ...model,
    schemas: ensureSchemaInList(model, trimmedSchema),
    tables,
    layout,
  };
}

export function removeTables(model: BuildModel, keys: readonly string[]): BuildModel {
  if (keys.length === 0) return model;
  const keySet = new Set(keys);
  const layout = { ...model.layout };
  for (const k of keySet) {
    delete layout[k];
  }
  const tables = model.tables.filter((t) => !keySet.has(tableKey(t)));
  const knownSchemas = model.base?.knownSchemas ?? [];
  const remainingSchemas = model.schemas.filter((s) => {
    const hasRemainingTables = tables.some((t) =>
      sameIdentifier(model.engine, t.schema, s.name),
    );
    if (hasRemainingTables) return true;
    const isKnown = knownSchemas.some((k) => sameIdentifier(model.engine, k, s.name));
    if (isKnown) return true;
    return sameIdentifier(model.engine, s.name, model.defaultSchema);
  });
  return {
    ...model,
    schemas:
      remainingSchemas.length > 0
        ? remainingSchemas
        : [{ name: model.defaultSchema, create: false }],
    tables,
    layout,
  };
}

export function removeSchema(model: BuildModel, schemaName: string): BuildModel {
  const keysToRemove = model.tables
    .filter((t) => sameIdentifier(model.engine, t.schema, schemaName))
    .map((t) => tableKey(t));
  const keySet = new Set(keysToRemove);
  const layout = { ...model.layout };
  for (const k of keySet) {
    delete layout[k];
  }
  const tables = model.tables.filter((t) => !keySet.has(tableKey(t)));
  const remainingSchemas = model.schemas.filter(
    (s) => !sameIdentifier(model.engine, s.name, schemaName),
  );
  const fallbackSchema =
    remainingSchemas[0]?.name ??
    tables[0]?.schema ??
    model.defaultSchema;
  const nextDefaultSchema = sameIdentifier(model.engine, model.defaultSchema, schemaName)
    ? fallbackSchema
    : model.defaultSchema;
  return {
    ...model,
    defaultSchema: nextDefaultSchema,
    schemas:
      remainingSchemas.length > 0
        ? remainingSchemas
        : [{ name: nextDefaultSchema, create: false }],
    tables,
    layout,
  };
}

export function dropSchemaInDatabase(
  model: BuildModel,
  schemaName: string,
  drop = true,
): BuildModel {
  const knownInBase =
    model.base?.knownSchemas.some((s) => sameIdentifier(model.engine, s, schemaName)) ?? false;
  const hasExistingTables = model.tables.some(
    (t) => sameIdentifier(model.engine, t.schema, schemaName) && t.origin !== null,
  );
  if (drop && !knownInBase && !hasExistingTables) {
    return removeSchema(model, schemaName);
  }

  const layout = { ...model.layout };
  const tables: ModelTable[] = [];
  for (const t of model.tables) {
    if (!sameIdentifier(model.engine, t.schema, schemaName)) {
      tables.push(t);
      continue;
    }
    if (t.origin === null) {
      if (drop) {
        delete layout[tableKey(t)];
        continue;
      }
      tables.push(t);
      continue;
    }
    tables.push({ ...t, dropInDatabase: drop });
  }

  const hasEntry = model.schemas.some((s) => sameIdentifier(model.engine, s.name, schemaName));
  const schemas = hasEntry
    ? model.schemas.map((s) => {
        if (!sameIdentifier(model.engine, s.name, schemaName)) return s;
        if (drop) {
          return { name: s.name, create: false, drop: true };
        }
        return { name: s.name, create: s.create };
      })
    : drop
      ? [...model.schemas, { name: schemaName, create: false, drop: true }]
      : model.schemas;

  return {
    ...model,
    schemas,
    tables,
    layout,
  };
}

export function removeTable(model: BuildModel, key: string): BuildModel {
  const layout = { ...model.layout };
  delete layout[key];
  return {
    ...model,
    tables: model.tables.filter((t) => tableKey(t) !== key),
    layout,
  };
}

export function setDropInDatabase(
  model: BuildModel,
  key: string,
  drop: boolean,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) =>
      tableKey(t) === key ? { ...t, dropInDatabase: drop } : t,
    ),
  };
}

export function copyAsNewTable(
  model: BuildModel,
  key: string,
  schema: string,
): BuildModel {
  const source = model.tables.find((t) => tableKey(t) === key);
  if (!source) {
    return model;
  }
  let candidateName = source.name;
  let suffix = 2;
  while (
    model.tables.some(
      (t) =>
        sameIdentifier(model.engine, t.schema, schema) &&
        sameIdentifier(model.engine, t.name, candidateName, t.exactName, false),
    )
  ) {
    candidateName = suffix === 2 ? `${source.name}_copia` : `${source.name}_copia_${suffix}`;
    suffix += 1;
  }

  const copy: ModelTable = {
    schema,
    name: candidateName,
    exactName: needsQuotes(model.engine, candidateName, false),
    comment: source.comment,
    columns: source.columns.map((c) => ({
      ...c,
      originName: null,
    })),
    primaryKey: source.primaryKey
      ? { name: null, columns: [...source.primaryKey.columns] }
      : null,
    uniques: source.uniques.map((u) => ({ name: null, columns: [...u.columns] })),
    checks: source.checks.map((ck) => ({ name: null, expression: ck.expression })),
    indexes: source.indexes.map((ix) => ({
      name: `ix_${candidateName}_${ix.columns.join("_")}`,
      columns: [...ix.columns],
      unique: ix.unique,
    })),
    foreignKeys: source.foreignKeys.map((fk) => ({
      name: null,
      columns: [...fk.columns],
      target: {
        schema: fk.target.schema,
        table: fk.target.table,
        columns: [...fk.target.columns],
      },
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    })),
    origin: null,
    dropInDatabase: false,
  };

  return {
    ...model,
    schemas: ensureSchemaInList(model, schema),
    tables: [...model.tables, copy],
  };
}

function cloneShape(shape: TableShape): TableShape {
  return {
    schema: shape.schema,
    name: shape.name,
    exactName: shape.exactName,
    comment: shape.comment,
    columns: shape.columns.map((c) => ({ ...c })),
    primaryKey: shape.primaryKey
      ? { name: shape.primaryKey.name, columns: [...shape.primaryKey.columns] }
      : null,
    uniques: shape.uniques.map((u) => ({ name: u.name, columns: [...u.columns] })),
    checks: shape.checks.map((ck) => ({ name: ck.name, expression: ck.expression })),
    indexes: shape.indexes.map((ix) => ({
      name: ix.name,
      columns: [...ix.columns],
      unique: ix.unique,
    })),
    foreignKeys: shape.foreignKeys.map((fk) => ({
      name: fk.name,
      columns: [...fk.columns],
      target: {
        schema: fk.target.schema,
        table: fk.target.table,
        columns: [...fk.target.columns],
      },
      onDelete: fk.onDelete,
      onUpdate: fk.onUpdate,
    })),
  };
}

export function revertTable(model: BuildModel, key: string): BuildModel {
  const target = model.tables.find((t) => tableKey(t) === key);
  if (!target || !target.origin) {
    return model;
  }
  const restored = cloneShape(target.origin);
  const nextKey = tableKey(restored);
  const layout = { ...model.layout };
  if (nextKey !== key && key in layout) {
    layout[nextKey] = layout[key]!;
    delete layout[key];
  }

  return {
    ...model,
    tables: model.tables.map((t) =>
      tableKey(t) === key
        ? {
            ...restored,
            origin: cloneShape(target.origin!),
            dropInDatabase: false,
          }
        : t,
    ),
    layout,
  };
}

export function addColumn(
  model: BuildModel,
  key: string,
  column?: Partial<ModelColumn>,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) => {
      if (tableKey(t) !== key) {
        return t;
      }
      let index = t.columns.length + 1;
      let defaultName = `coluna_${index}`;
      while (
        t.columns.some((c) =>
          sameIdentifier(model.engine, c.name, defaultName, c.exactName, false),
        )
      ) {
        index += 1;
        defaultName = `coluna_${index}`;
      }
      const name = column?.name ?? defaultName;
      const newCol: ModelColumn = {
        name,
        exactName: column?.exactName ?? needsQuotes(model.engine, name, false),
        originName: column?.originName ?? null,
        type: column?.type ?? "varchar(80)",
        nullable: column?.identity ? false : (column?.nullable ?? true),
        default: column?.default ?? null,
        identity: column?.identity ?? null,
        comment: column?.comment ?? null,
      };
      return {
        ...t,
        columns: [...t.columns, newCol],
      };
    }),
  };
}

export function updateColumn(
  model: BuildModel,
  key: string,
  name: string,
  patch: Partial<ModelColumn>,
  columnIndex?: number,
): BuildModel {
  let baseModel = model;
  let targetColumnName = name;
  if (patch.name !== undefined && patch.name !== name) {
    baseModel = renameColumn(model, key, name, patch.name, columnIndex);
    targetColumnName = patch.name.trim();
  }
  return {
    ...baseModel,
    tables: baseModel.tables.map((t) => {
      if (tableKey(t) !== key) {
        return t;
      }
      const isPk = t.primaryKey?.columns.includes(targetColumnName) ?? false;
      return {
        ...t,
        columns: t.columns.map((c, idx) => {
          const matches =
            columnIndex !== undefined ? idx === columnIndex : c.name === targetColumnName;
          if (!matches) {
            return c;
          }
          const updated: ModelColumn = {
            ...c,
            ...patch,
            name: targetColumnName,
            exactName:
              patch.exactName ??
              (patch.name !== undefined
                ? needsQuotes(baseModel.engine, targetColumnName, false)
                : c.exactName),
          };
          if (isPk || updated.identity !== null) {
            updated.nullable = false;
          }
          return updated;
        }),
      };
    }),
  };
}

export function renameColumn(
  model: BuildModel,
  key: string,
  from: string,
  to: string,
  columnIndex?: number,
): BuildModel {
  const target = model.tables.find((t) => tableKey(t) === key);
  if (!target) {
    return model;
  }
  const trimmed = to.trim();
  const hasOtherSameName =
    columnIndex !== undefined &&
    target.columns.some((c, idx) => idx !== columnIndex && c.name === from);
  const replaceCol = (cols: string[]) =>
    hasOtherSameName ? cols : cols.map((c) => (c === from ? trimmed : c));

  return {
    ...model,
    tables: model.tables.map((t) => {
      const updatedForeignKeys = t.foreignKeys.map((fk) => {
        const nextColumns = tableKey(t) === key ? replaceCol(fk.columns) : fk.columns;
        const pointsToTarget =
          sameIdentifier(model.engine, fk.target.schema, target.schema) &&
          sameIdentifier(model.engine, fk.target.table, target.name, false, target.exactName);
        const nextTargetColumns = pointsToTarget
          ? replaceCol(fk.target.columns)
          : fk.target.columns;
        return {
          ...fk,
          columns: nextColumns,
          target: {
            ...fk.target,
            columns: nextTargetColumns,
          },
        };
      });

      if (tableKey(t) !== key) {
        return { ...t, foreignKeys: updatedForeignKeys };
      }

      return {
        ...t,
        columns: t.columns.map((c, idx) => {
          const matches = columnIndex !== undefined ? idx === columnIndex : c.name === from;
          return matches
            ? {
                ...c,
                name: trimmed,
                exactName: needsQuotes(model.engine, trimmed, false),
              }
            : c;
        }),
        primaryKey: t.primaryKey
          ? { ...t.primaryKey, columns: replaceCol(t.primaryKey.columns) }
          : null,
        uniques: t.uniques.map((u) => ({ ...u, columns: replaceCol(u.columns) })),
        indexes: t.indexes.map((ix) => ({ ...ix, columns: replaceCol(ix.columns) })),
        foreignKeys: updatedForeignKeys,
      };
    }),
  };
}

export function moveColumn(
  model: BuildModel,
  key: string,
  name: string,
  toIndex: number,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) => {
      if (tableKey(t) !== key) {
        return t;
      }
      const fromIndex = t.columns.findIndex((c) => c.name === name);
      if (fromIndex < 0) {
        return t;
      }
      const bounded = Math.max(0, Math.min(t.columns.length - 1, toIndex));
      if (fromIndex === bounded) {
        return t;
      }
      const columns = [...t.columns];
      const [moved] = columns.splice(fromIndex, 1);
      columns.splice(bounded, 0, moved!);
      return { ...t, columns };
    }),
  };
}

export function removeColumn(
  model: BuildModel,
  key: string,
  name: string,
): { model: BuildModel; droppedForeignKeys: number } {
  const target = model.tables.find((t) => tableKey(t) === key);
  if (!target) {
    return { model, droppedForeignKeys: 0 };
  }
  let droppedForeignKeys = 0;

  const tables = model.tables.map((t) => {
    const isTarget = tableKey(t) === key;
    const remainingFks = t.foreignKeys.filter((fk) => {
      const usesLocal = isTarget && fk.columns.includes(name);
      const usesRemote =
        sameIdentifier(model.engine, fk.target.schema, target.schema) &&
        sameIdentifier(model.engine, fk.target.table, target.name, false, target.exactName) &&
        fk.target.columns.includes(name);
      if (usesLocal || usesRemote) {
        droppedForeignKeys += 1;
        return false;
      }
      return true;
    });

    if (!isTarget) {
      return { ...t, foreignKeys: remainingFks };
    }

    const nextPkCols = t.primaryKey?.columns.filter((c) => c !== name) ?? [];
    const nextPrimaryKey: ModelPrimaryKey | null =
      t.primaryKey && nextPkCols.length > 0
        ? { ...t.primaryKey, columns: nextPkCols }
        : null;

    const nextUniques = t.uniques
      .map((u) => ({ ...u, columns: u.columns.filter((c) => c !== name) }))
      .filter((u) => u.columns.length > 0);

    const nextIndexes = t.indexes
      .map((ix) => ({ ...ix, columns: ix.columns.filter((c) => c !== name) }))
      .filter((ix) => ix.columns.length > 0);

    return {
      ...t,
      columns: t.columns.filter((c) => c.name !== name),
      primaryKey: nextPrimaryKey,
      uniques: nextUniques,
      indexes: nextIndexes,
      foreignKeys: remainingFks,
    };
  });

  return {
    model: { ...model, tables },
    droppedForeignKeys,
  };
}

export function restoreColumn(
  model: BuildModel,
  key: string,
  originName: string,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) => {
      if (tableKey(t) !== key || !t.origin) {
        return t;
      }
      const originIndex = t.origin.columns.findIndex(
        (c) => (c.originName ?? c.name) === originName || c.name === originName,
      );
      if (originIndex < 0) {
        return t;
      }
      const originCol = t.origin.columns[originIndex]!;
      if (t.columns.some((c) => c.originName === (originCol.originName ?? originCol.name))) {
        return t;
      }

      const restoredCol: ModelColumn = {
        ...originCol,
        originName: originCol.originName ?? originCol.name,
      };

      const nextOriginNames = new Set(
        t.origin.columns.slice(originIndex + 1).map((c) => c.originName ?? c.name),
      );
      const insertAt = t.columns.findIndex(
        (c) => c.originName === null || nextOriginNames.has(c.originName),
      );
      const columns = [...t.columns];
      if (insertAt < 0) {
        columns.push(restoredCol);
      } else {
        columns.splice(insertAt, 0, restoredCol);
      }
      return { ...t, columns };
    }),
  };
}

export function revertColumn(
  model: BuildModel,
  key: string,
  name: string,
): BuildModel {
  const target = model.tables.find((t) => tableKey(t) === key);
  if (!target || !target.origin) {
    return model;
  }
  const current = target.columns.find((c) => c.name === name);
  if (!current) {
    return model;
  }
  const originRef = current.originName ?? current.name;
  const originCol = target.origin.columns.find(
    (c) => (c.originName ?? c.name) === originRef || c.name === originRef,
  );
  if (!originCol) {
    return model;
  }

  const renamedBack =
    current.name !== originCol.name
      ? renameColumn(model, key, current.name, originCol.name)
      : model;

  return {
    ...renamedBack,
    tables: renamedBack.tables.map((t) =>
      tableKey(t) === key
        ? {
            ...t,
            columns: t.columns.map((c) =>
              c.name === originCol.name
                ? { ...originCol, originName: originCol.originName ?? originCol.name }
                : c,
            ),
          }
        : t,
    ),
  };
}

export function togglePrimaryKey(
  model: BuildModel,
  key: string,
  column: string,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) => {
      if (tableKey(t) !== key) {
        return t;
      }
      const currentPk = t.primaryKey?.columns ?? [];
      const isCurrentlyPk = currentPk.includes(column);
      const nextPkSet = new Set(
        isCurrentlyPk ? currentPk.filter((c) => c !== column) : [...currentPk, column],
      );
      const orderedPk = t.columns
        .map((c) => c.name)
        .filter((cName) => nextPkSet.has(cName));

      return {
        ...t,
        columns: t.columns.map((c) =>
          c.name === column && !isCurrentlyPk ? { ...c, nullable: false } : c,
        ),
        primaryKey:
          orderedPk.length > 0
            ? { name: t.primaryKey?.name ?? null, columns: orderedPk }
            : null,
      };
    }),
  };
}

export function toggleUnique(
  model: BuildModel,
  key: string,
  column: string,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) => {
      if (tableKey(t) !== key) {
        return t;
      }
      const existingIdx = t.uniques.findIndex(
        (u) => u.columns.length === 1 && u.columns[0] === column,
      );
      const uniques: ModelUnique[] =
        existingIdx >= 0
          ? t.uniques.filter((_, i) => i !== existingIdx)
          : [...t.uniques, { name: null, columns: [column] }];
      return { ...t, uniques };
    }),
  };
}

export function addForeignKey(
  model: BuildModel,
  key: string,
  fk: ModelForeignKey,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) =>
      tableKey(t) === key ? { ...t, foreignKeys: [...t.foreignKeys, fk] } : t,
    ),
  };
}

export function updateForeignKey(
  model: BuildModel,
  key: string,
  index: number,
  fk: ModelForeignKey,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) =>
      tableKey(t) === key
        ? {
            ...t,
            foreignKeys: t.foreignKeys.map((item, i) => (i === index ? fk : item)),
          }
        : t,
    ),
  };
}

export function removeForeignKey(
  model: BuildModel,
  key: string,
  index: number,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) =>
      tableKey(t) === key
        ? {
            ...t,
            foreignKeys: t.foreignKeys.filter((_, i) => i !== index),
          }
        : t,
    ),
  };
}

export function addIndex(
  model: BuildModel,
  key: string,
  columns: string[],
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) => {
      if (tableKey(t) !== key) {
        return t;
      }
      const name = `ix_${t.name}_${columns.join("_")}`;
      return {
        ...t,
        indexes: [...t.indexes, { name, columns: [...columns], unique: false }],
      };
    }),
  };
}

export function updateIndex(
  model: BuildModel,
  key: string,
  index: number,
  value: ModelIndex,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) =>
      tableKey(t) === key
        ? {
            ...t,
            indexes: t.indexes.map((item, i) => (i === index ? value : item)),
          }
        : t,
    ),
  };
}

export function removeIndex(
  model: BuildModel,
  key: string,
  index: number,
): BuildModel {
  return {
    ...model,
    tables: model.tables.map((t) =>
      tableKey(t) === key
        ? {
            ...t,
            indexes: t.indexes.filter((_, i) => i !== index),
          }
        : t,
    ),
  };
}

export function replaceTables(
  model: BuildModel,
  tables: ModelTable[],
  schemas: string[],
): BuildModel {
  let nextSchemas = [...model.schemas];
  for (const s of schemas) {
    if (!nextSchemas.some((existing) => sameIdentifier(model.engine, existing.name, s))) {
      const knownInBase =
        model.base?.knownSchemas.some((k) => sameIdentifier(model.engine, k, s)) ?? false;
      nextSchemas = [...nextSchemas, { name: s, create: !knownInBase }];
    }
  }
  const activeKeys = new Set(tables.map((t) => tableKey(t)));
  const layout: BuildModel["layout"] = {};
  for (const [k, pos] of Object.entries(model.layout)) {
    if (activeKeys.has(k)) {
      layout[k] = pos;
    }
  }

  return {
    ...model,
    schemas: nextSchemas,
    tables,
    layout,
  };
}

export type ColumnChange = {
  name: string;
  originName: string;
  renamed: boolean;
  type: boolean;
  nullable: boolean;
  default: boolean;
  comment: boolean;
};

export type TableChanges = {
  kind: "new" | "same" | "changed" | "dropped";
  renamedFrom: string | null;
  addedColumns: string[];
  removedColumns: string[];
  changedColumns: ColumnChange[];
  addedUniques: TableShape["uniques"];
  removedUniques: TableShape["uniques"];
  addedChecks: TableShape["checks"];
  removedChecks: TableShape["checks"];
  addedForeignKeys: ModelForeignKey[];
  removedForeignKeys: ModelForeignKey[];
  addedIndexes: ModelIndex[];
  removedIndexes: ModelIndex[];
  commentChanged: boolean;
  forbidden: ("primaryKey" | "identity" | "schema")[];
};

function mapToOriginColumns(table: ModelTable, cols: readonly string[]): string[] {
  return cols.map((colName) => {
    const found = table.columns.find((c) => c.name === colName);
    return found?.originName ?? colName;
  });
}

function sameStringList(
  engine: BuildEngine,
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, i) => sameIdentifier(engine, item, right[i]!));
}

function sameUniqueDefinition(
  engine: BuildEngine,
  table: ModelTable,
  current: ModelUnique,
  origin: ModelUnique,
): boolean {
  return sameStringList(engine, mapToOriginColumns(table, current.columns), origin.columns);
}

function sameCheckDefinition(current: ModelCheck, origin: ModelCheck): boolean {
  return current.expression.trim() === origin.expression.trim();
}

function sameForeignKeyDefinition(
  engine: BuildEngine,
  table: ModelTable,
  current: ModelForeignKey,
  origin: ModelForeignKey,
): boolean {
  return (
    sameStringList(engine, mapToOriginColumns(table, current.columns), origin.columns) &&
    sameIdentifier(engine, current.target.schema, origin.target.schema) &&
    sameIdentifier(engine, current.target.table, origin.target.table) &&
    sameStringList(engine, current.target.columns, origin.target.columns) &&
    current.onDelete === origin.onDelete &&
    current.onUpdate === origin.onUpdate
  );
}

function sameIndexDefinition(
  engine: BuildEngine,
  table: ModelTable,
  current: ModelIndex,
  origin: ModelIndex,
): boolean {
  return (
    current.unique === origin.unique &&
    sameStringList(engine, mapToOriginColumns(table, current.columns), origin.columns)
  );
}

function diffNamedItems<T extends { name: string | null }>(
  engine: BuildEngine,
  currentItems: readonly T[],
  originItems: readonly T[],
  sameDef: (current: T, origin: T) => boolean,
): { added: T[]; removed: T[] } {
  const added: T[] = [];
  const removed: T[] = [];
  const matchedOriginIndices = new Set<number>();

  for (const current of currentItems) {
    if (!current.name) {
      added.push(current);
      continue;
    }
    const originIdx = originItems.findIndex(
      (o, idx) =>
        !matchedOriginIndices.has(idx) &&
        o.name !== null &&
        sameIdentifier(engine, current.name!, o.name),
    );
    if (originIdx < 0) {
      added.push(current);
      continue;
    }
    matchedOriginIndices.add(originIdx);
    const origin = originItems[originIdx]!;
    if (!sameDef(current, origin)) {
      removed.push(origin);
      added.push(current);
    }
  }

  for (let i = 0; i < originItems.length; i++) {
    if (!matchedOriginIndices.has(i)) {
      removed.push(originItems[i]!);
    }
  }

  return { added, removed };
}

export function tableChanges(engine: BuildEngine, table: ModelTable): TableChanges {
  const origin = table.origin;
  if (!origin) {
    return {
      kind: "new",
      renamedFrom: null,
      addedColumns: table.columns.map((c) => c.name),
      removedColumns: [],
      changedColumns: [],
      addedUniques: [...table.uniques],
      removedUniques: [],
      addedChecks: [...table.checks],
      removedChecks: [],
      addedForeignKeys: [...table.foreignKeys],
      removedForeignKeys: [],
      addedIndexes: [...table.indexes],
      removedIndexes: [],
      commentChanged: (table.comment ?? null) !== null,
      forbidden: [],
    };
  }

  const renamedFrom = !sameIdentifier(
    engine,
    table.name,
    origin.name,
    table.exactName,
    origin.exactName,
  )
    ? origin.name
    : null;

  const addedColumns: string[] = [];
  const changedColumns: ColumnChange[] = [];
  const presentOriginNames = new Set<string>();
  let identityChanged = false;

  for (const col of table.columns) {
    if (!col.originName) {
      addedColumns.push(col.name);
      continue;
    }
    presentOriginNames.add(col.originName);
    const originCol = origin.columns.find(
      (oc) => (oc.originName ?? oc.name) === col.originName || oc.name === col.originName,
    );
    if (!originCol) {
      addedColumns.push(col.name);
      continue;
    }
    const renamed = !sameIdentifier(
      engine,
      col.name,
      originCol.name,
      col.exactName,
      originCol.exactName,
    );
    const leftNorm = normalizeType(engine, col.type);
    const rightNorm = normalizeType(engine, originCol.type);
    const type =
      leftNorm.family !== rightNorm.family ||
      leftNorm.base !== rightNorm.base ||
      leftNorm.args.join(",") !== rightNorm.args.join(",");
    const nullable = col.nullable !== originCol.nullable;
    const defChanged = (col.default ?? null) !== (originCol.default ?? null);
    const comment = (col.comment ?? null) !== (originCol.comment ?? null);
    if (col.identity !== originCol.identity) {
      identityChanged = true;
    }
    if (renamed || type || nullable || defChanged || comment) {
      changedColumns.push({
        name: col.name,
        originName: col.originName,
        renamed,
        type,
        nullable,
        default: defChanged,
        comment,
      });
    }
  }

  const removedColumns = origin.columns
    .map((oc) => oc.originName ?? oc.name)
    .filter((originColName) => !presentOriginNames.has(originColName));

  const uniquesDiff = diffNamedItems(engine, table.uniques, origin.uniques, (c, o) =>
    sameUniqueDefinition(engine, table, c, o),
  );
  const checksDiff = diffNamedItems(engine, table.checks, origin.checks, sameCheckDefinition);
  const fksDiff = diffNamedItems(engine, table.foreignKeys, origin.foreignKeys, (c, o) =>
    sameForeignKeyDefinition(engine, table, c, o),
  );
  const indexesDiff = diffNamedItems(engine, table.indexes, origin.indexes, (c, o) =>
    sameIndexDefinition(engine, table, c, o),
  );

  const commentChanged = (table.comment ?? null) !== (origin.comment ?? null);

  const forbidden: ("primaryKey" | "identity" | "schema")[] = [];
  const currentPkOriginCols = mapToOriginColumns(table, table.primaryKey?.columns ?? []);
  const originPkCols = origin.primaryKey?.columns ?? [];
  if (!sameStringList(engine, currentPkOriginCols, originPkCols)) {
    forbidden.push("primaryKey");
  }
  if (identityChanged) {
    forbidden.push("identity");
  }
  if (!sameIdentifier(engine, table.schema, origin.schema)) {
    forbidden.push("schema");
  }

  if (table.dropInDatabase) {
    return {
      kind: "dropped",
      renamedFrom,
      addedColumns,
      removedColumns,
      changedColumns,
      addedUniques: uniquesDiff.added,
      removedUniques: uniquesDiff.removed,
      addedChecks: checksDiff.added,
      removedChecks: checksDiff.removed,
      addedForeignKeys: fksDiff.added,
      removedForeignKeys: fksDiff.removed,
      addedIndexes: indexesDiff.added,
      removedIndexes: indexesDiff.removed,
      commentChanged,
      forbidden,
    };
  }

  const hasChanges =
    renamedFrom !== null ||
    addedColumns.length > 0 ||
    removedColumns.length > 0 ||
    changedColumns.length > 0 ||
    uniquesDiff.added.length > 0 ||
    uniquesDiff.removed.length > 0 ||
    checksDiff.added.length > 0 ||
    checksDiff.removed.length > 0 ||
    fksDiff.added.length > 0 ||
    fksDiff.removed.length > 0 ||
    indexesDiff.added.length > 0 ||
    indexesDiff.removed.length > 0 ||
    commentChanged ||
    forbidden.length > 0;

  return {
    kind: hasChanges ? "changed" : "same",
    renamedFrom,
    addedColumns,
    removedColumns,
    changedColumns,
    addedUniques: uniquesDiff.added,
    removedUniques: uniquesDiff.removed,
    addedChecks: checksDiff.added,
    removedChecks: checksDiff.removed,
    addedForeignKeys: fksDiff.added,
    removedForeignKeys: fksDiff.removed,
    addedIndexes: indexesDiff.added,
    removedIndexes: indexesDiff.removed,
    commentChanged,
    forbidden,
  };
}

export function ignoreWarning(model: BuildModel, key: string): BuildModel {
  if (model.ignoredWarnings.includes(key)) {
    return model;
  }
  return {
    ...model,
    ignoredWarnings: [...model.ignoredWarnings, key],
  };
}

const maxHistoryEntries = 100;

export type History = {
  past: BuildModel[];
  present: BuildModel;
  future: BuildModel[];
};

export function startHistory(model: BuildModel): History {
  return {
    past: [],
    present: model,
    future: [],
  };
}

export function commit(history: History, next: BuildModel): History {
  if (history.present === next) {
    return history;
  }
  const past = [...history.past, history.present];
  if (past.length > maxHistoryEntries) {
    past.splice(0, past.length - maxHistoryEntries);
  }
  return {
    past,
    present: next,
    future: [],
  };
}

export function undo(history: History): History {
  if (history.past.length === 0) {
    return history;
  }
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo(history: History): History {
  if (history.future.length === 0) {
    return history;
  }
  const next = history.future[0]!;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
