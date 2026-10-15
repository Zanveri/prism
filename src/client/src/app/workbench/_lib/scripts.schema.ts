import { z } from "zod";

const id = z.guid();

/**
 * Um script na lista (`GET api/user/scripts`, seção 23): sem o SQL, que só vem pela rota do item. A lista que trouxer o SQL é recusada por inteiro: ela fica
 * no cache da tela enquanto o cofre está aberto, e não pode guardar o texto de todos os scripts. `connectionID` pode ser de uma conexão que já não existe
 * (RN-SCRIPT-003); `database` nulo é o banco da conexão.
 */
export const scriptSummarySchema = z.object({ id, name: z.string().min(1), connectionID: id.nullable(), database: z.string().nullable(), updatedAt: z.string(), sql: z.never().optional() });

export type ScriptSummary = Omit<z.infer<typeof scriptSummarySchema>, "sql">;

export const scriptSummariesSchema = z.array(scriptSummarySchema);

/** O script inteiro (`GET api/user/scripts/{id}`), com o SQL que a aba abre. */
export const scriptSchema = z.object({ id, name: z.string().min(1), connectionID: id.nullable(), database: z.string().nullable(), sql: z.string(), updatedAt: z.string() });

export type Script = z.infer<typeof scriptSchema>;

/** O que o Ctrl+S manda (RN-SCRIPT-001): o nome, o texto e o lugar da aba (a conexão e o banco; nulo é o banco da conexão). */
export type ScriptInput = { name: string; sql: string; connectionID: string | null; database: string | null };
