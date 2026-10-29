import { z } from "zod";

/**
 * Formato do modelo do Construir (RN-CONSTRUIR-010) e do DTO da API (`api/user/build-models`).
 */
export const buildEngines = ["postgresql", "db2", "informix"] as const;
export type BuildEngine = (typeof buildEngines)[number];

export const fkActions = ["noAction", "restrict", "cascade", "setNull"] as const;
export type FkAction = (typeof fkActions)[number];

export const identitySchema = z.enum(["always", "byDefault"]).nullable();
export type Identity = z.infer<typeof identitySchema>;
export type IdentityMode = Identity;

export const modelColumnSchema = z.object({
  name: z.string(),
  exactName: z.boolean().default(false),
  originName: z.string().nullable(),
  type: z.string(),
  nullable: z.boolean(),
  default: z.string().nullable(),
  identity: identitySchema,
  comment: z.string().nullable(),
});

export type ModelColumn = z.infer<typeof modelColumnSchema>;

export const modelForeignKeySchema = z.object({
  name: z.string().nullable(),
  columns: z.array(z.string()),
  target: z.object({
    schema: z.string(),
    table: z.string(),
    columns: z.array(z.string()),
  }),
  onDelete: z.enum(fkActions),
  onUpdate: z.enum(fkActions),
});

export const modelIndexSchema = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  unique: z.boolean(),
});

export const tableShapeSchema = z.object({
  schema: z.string(),
  name: z.string(),
  exactName: z.boolean().default(false),
  comment: z.string().nullable(),
  columns: z.array(modelColumnSchema),
  primaryKey: z
    .object({
      name: z.string().nullable(),
      columns: z.array(z.string()),
    })
    .nullable(),
  uniques: z.array(
    z.object({
      name: z.string().nullable(),
      columns: z.array(z.string()),
    }),
  ),
  checks: z.array(
    z.object({
      name: z.string().nullable(),
      expression: z.string(),
    }),
  ),
  indexes: z.array(modelIndexSchema),
  foreignKeys: z.array(modelForeignKeySchema),
});

export type TableShape = z.infer<typeof tableShapeSchema>;
export type ModelPrimaryKey = NonNullable<TableShape["primaryKey"]>;
export type ModelUnique = TableShape["uniques"][number];
export type ModelCheck = TableShape["checks"][number];
export type ModelForeignKey = TableShape["foreignKeys"][number];
export type ModelIndex = TableShape["indexes"][number];

export const modelTableSchema = tableShapeSchema.extend({
  origin: tableShapeSchema.nullable(),
  dropInDatabase: z.boolean().default(false),
});

export type ModelTable = z.infer<typeof modelTableSchema>;

export const buildModelSchema = z.object({
  version: z.literal(1),
  engine: z.enum(buildEngines),
  defaultSchema: z.string(),
  schemas: z.array(
    z.object({
      name: z.string(),
      create: z.boolean(),
    }),
  ),
  base: z
    .object({
      connectionId: z.string(),
      database: z.string().nullable(),
      readAt: z.string(),
      knownSchemas: z.array(z.string()),
      knownTables: z.array(z.string()),
    })
    .nullable(),
  tables: z.array(modelTableSchema),
  layout: z.record(
    z.string(),
    z.object({
      x: z.number(),
      y: z.number(),
      pinned: z.boolean(),
    }),
  ),
  ddl: z.object({
    scope: z.enum(["changes", "full"]).nullable(),
    constraintNames: z.boolean(),
    comments: z.boolean(),
    foreignKeysAtEnd: z.boolean(),
    dropNewFirst: z.boolean(),
  }),
  ignoredWarnings: z.array(z.string()).default([]),
});

export type BuildModel = z.infer<typeof buildModelSchema>;

export function parseModelBody(body: string): BuildModel | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const result = buildModelSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function serializeModel(model: BuildModel): string {
  return JSON.stringify(model);
}

export const serializeModelBody = serializeModel;

export function engineIdOf(engine: BuildEngine): 1 | 2 | 3 {
  if (engine === "postgresql") return 1;
  if (engine === "db2") return 2;
  return 3;
}

export function buildEngineOf(engineId: number): BuildEngine | null {
  if (engineId === 1) return "postgresql";
  if (engineId === 2) return "db2";
  if (engineId === 3) return "informix";
  return null;
}

export const buildModelDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const buildModelDtosSchema = z.array(buildModelDtoSchema);

export type BuildModelDto = z.infer<typeof buildModelDtoSchema>;
