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

/** Um esquema do banco. No Informix, "esquema" é o dono do objeto (RN-ARVORE-004). */
export const databaseSchemaSchema = z.object({ name: z.string(), isSystem: z.boolean() });

export type DatabaseSchema = z.infer<typeof databaseSchemaSchema>;

export const databaseSchemasSchema = z.array(databaseSchemaSchema);

/** O que `objects?kind=` lista: tabelas, visões, ou as rotinas (procedimentos e funções). */
export const databaseObjectSchema = z.object({ name: z.string(), kind: z.enum(["table", "view", "procedure", "function"]) });

export type DatabaseObject = z.infer<typeof databaseObjectSchema>;

export const databaseObjectsSchema = z.array(databaseObjectSchema);

/**
 * `generated` (RN-CAT-001): a coluna que o banco calcula, `always` (a identidade "sempre", a calculada) ou `byDefault` (a identidade "por padrão", o
 * `serial`); nula nas outras. O SQL da exportação de dados deixa de fora a `always` (RN-EXPORT-011). Fora do formato vale nula: a lista não cai por ela.
 */
export const columnSchema = z.object({ name: z.string(), type: z.string(), isNullable: z.boolean(), isPrimaryKey: z.boolean(), position: z.number().int(), generated: z.enum(["always", "byDefault"]).nullish().catch(null) });

export type Column = z.infer<typeof columnSchema>;

export const columnsSchema = z.array(columnSchema);

export const indexSchema = z.object({ name: z.string(), columns: z.array(z.string()), isUnique: z.boolean() });

export type TableIndex = z.infer<typeof indexSchema>;

export const indexesSchema = z.array(indexSchema);

export const foreignKeySchema = z.object({ name: z.string(), columns: z.array(z.string()), referencedSchema: z.string(), referencedTable: z.string(), referencedColumns: z.array(z.string()) });

export type ForeignKey = z.infer<typeof foreignKeySchema>;

export const foreignKeysSchema = z.array(foreignKeySchema);
