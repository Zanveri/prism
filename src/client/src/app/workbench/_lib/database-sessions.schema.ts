import { z } from "zod";

import { engineSchema } from "@/app/connections/_lib/connections.schema";

/**
 * A sessão que a API abre com o banco de uma conexão (RN-SESSAO-001). A tela só usa o `id`, que é
 * opaco, e o `database`; o resto é tolerado em qualquer formato e vira `undefined` se não servir.
 * A sessão já está aberta na API quando a resposta chega: recusá-la por um campo que a árvore nem
 * usa a deixaria órfã, e cada "Tentar de novo" abriria outra.
 */
export const databaseSessionSchema = z.object({
  id: z.string().min(1),
  database: z.string(),
  connectionID: z.guid().optional().catch(undefined),
  engine: engineSchema.optional().catch(undefined),
  serverVersion: z.string().optional().catch(undefined),
});

export type DatabaseSession = z.infer<typeof databaseSessionSchema>;

/** RN-ARVORE-006: um banco do servidor a que a conta pode se conectar; `isCurrent` é o da sessão que listou (o da conexão). */
export const serverDatabaseSchema = z.object({ name: z.string(), isCurrent: z.boolean() });

export type ServerDatabase = z.infer<typeof serverDatabaseSchema>;

export const serverDatabasesSchema = z.array(serverDatabaseSchema);

/** Um esquema do banco. No Informix, "esquema" é o dono do objeto (RN-ARVORE-004). Traz também as contagens para a aba do banco (RN-BANCO-001). */
export const databaseSchemaSchema = z.object({
  name: z.string(),
  isSystem: z.boolean(),
  tables: z.number().int().optional(),
  views: z.number().int().optional(),
  routines: z.number().int().optional(),
});

export type DatabaseSchema = z.infer<typeof databaseSchemaSchema>;

export const databaseSchemasSchema = z.array(databaseSchemaSchema);

/** O que `objects?kind=` lista: tabelas, visões, rotinas (procedimentos e funções) ou sequências, mais estimativa de linhas e comentário (RN-ESQUEMA-002 e RN-CAT-009). */
export const databaseObjectSchema = z.object({
  name: z.string(),
  kind: z.enum(["table", "view", "procedure", "function", "sequence"]),
  estimatedRows: z.number().nullish(),
  comment: z.string().nullish(),
});

export type DatabaseObject = z.infer<typeof databaseObjectSchema>;

export const databaseObjectsSchema = z.array(databaseObjectSchema);

/**
 * RN-BUSCA-002: os nomes das tabelas e das visões de um esquema, no índice que a busca do navegador lê (`GET …/object-names`). Os nomes vêm exatamente como o
 * catálogo os guarda, na ordem do banco: a chave da linha na árvore e o `SELECT` que a tela monta dependem disso.
 */
export const schemaObjectNamesSchema = z.object({ name: z.string(), isSystem: z.boolean(), tables: z.array(z.string()), views: z.array(z.string()) });

export type SchemaObjectNames = z.infer<typeof schemaObjectNamesSchema>;

/**
 * RN-BUSCA-002: o índice de nomes de um banco: os esquemas que têm ao menos uma tabela ou visão (os comuns primeiro, depois os de sistema) e `truncated`, ligado
 * quando o banco tem mais nomes do que o limite da API (50.000) e o índice traz só os primeiros.
 */
export const objectNamesSchema = z.object({ schemas: z.array(schemaObjectNamesSchema), truncated: z.boolean() });

export type ObjectNames = z.infer<typeof objectNamesSchema>;

/**
 * `generated` (RN-CAT-001): a coluna que o banco calcula, `always` (a identidade "sempre", a calculada) ou `byDefault` (a identidade "por padrão", o
 * `serial`); nula nas outras. O SQL da exportação de dados deixa de fora a `always` (RN-EXPORT-011). Fora do formato vale nula: a lista não cai por ela.
 */
export const columnSchema = z.object({ name: z.string(), type: z.string(), isNullable: z.boolean(), isPrimaryKey: z.boolean(), position: z.number().int(), defaultValue: z.string().nullish().catch(null), generated: z.enum(["always", "byDefault"]).nullish().catch(null) });

export type Column = z.infer<typeof columnSchema>;

export const columnsSchema = z.array(columnSchema);

export const checkSchema = z.object({ name: z.string(), expression: z.string() });

export type TableCheck = z.infer<typeof checkSchema>;

export const checksSchema = z.array(checkSchema);

export const indexSchema = z.object({ name: z.string(), columns: z.array(z.string()), isUnique: z.boolean() });

export type TableIndex = z.infer<typeof indexSchema>;

export const indexesSchema = z.array(indexSchema);

export const foreignKeySchema = z.object({ name: z.string(), columns: z.array(z.string()), referencedSchema: z.string(), referencedTable: z.string(), referencedColumns: z.array(z.string()) });

export type ForeignKey = z.infer<typeof foreignKeySchema>;

export const foreignKeysSchema = z.array(foreignKeySchema);

/**
 * RN-CAT-004: uma chave estrangeira de outra tabela (ou da própria) que aponta para a tabela pedida: `columns` são as colunas da tabela de origem
 * (`referencingSchema.referencingTable`) e `referencedColumns`, as da tabela pedida, na ordem da chave. A API devolve também as duas regras (`onDelete`,
 * `onUpdate`), que a tela não usa.
 */
export const referencingForeignKeySchema = z.object({
  name: z.string(),
  referencingSchema: z.string(),
  referencingTable: z.string(),
  columns: z.array(z.string()),
  referencedColumns: z.array(z.string()),
  onDelete: z.string().nullish(),
  onUpdate: z.string().nullish(),
});

export type ReferencingForeignKey = z.infer<typeof referencingForeignKeySchema>;

export const referencingForeignKeysSchema = z.array(referencingForeignKeySchema);

/** RN-ESQUEMA-003 e RN-CAT-008: o diagrama de um esquema inteiro num único lote (tabelas com colunas e chaves estrangeiras do esquema). */
export const schemaDiagramColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  isNullable: z.boolean(),
  isPrimaryKey: z.boolean(),
});

export type SchemaDiagramColumn = z.infer<typeof schemaDiagramColumnSchema>;

export const schemaDiagramTableSchema = z.object({
  name: z.string(),
  columns: z.array(schemaDiagramColumnSchema),
});

export type SchemaDiagramTable = z.infer<typeof schemaDiagramTableSchema>;

export const schemaDiagramForeignKeySchema = z.object({
  name: z.string(),
  referencingTable: z.string(),
  columns: z.array(z.string()),
  referencedSchema: z.string(),
  referencedTable: z.string(),
  referencedColumns: z.array(z.string()),
  onDelete: z.string().nullish(),
  onUpdate: z.string().nullish(),
});

export type SchemaDiagramForeignKey = z.infer<typeof schemaDiagramForeignKeySchema>;

export const schemaDiagramSchema = z.object({
  tables: z.array(schemaDiagramTableSchema),
  foreignKeys: z.array(schemaDiagramForeignKeySchema),
});

export type SchemaDiagram = z.infer<typeof schemaDiagramSchema>;

/** RN-BANCO-001 e RN-CAT-010: propriedade somente leitura do servidor e do banco da sessão. */
export const databasePropertySchema = z.object({
  name: z.string(),
  value: z.string(),
});

export type DatabaseProperty = z.infer<typeof databasePropertySchema>;

export const databasePropertiesSchema = z.array(databasePropertySchema);
