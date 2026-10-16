import { z } from "zod";

const id = z.guid();

/**
 * Um script na lista (`GET api/user/scripts`, seção 23): sem o SQL, que só vem pela rota do item. A lista que trouxer o SQL é recusada por inteiro: ela fica
 * no cache da tela enquanto o cofre está aberto, e não pode guardar o texto de todos os scripts. `connectionID` pode ser de uma conexão que já não existe
 * (RN-SCRIPT-003), e nulo é o script genérico (RN-SCRIPT-005); `database` nulo é o banco da conexão. O ícone e a cor (RN-SCRIPT-006) vêm sempre, nulos no
 * padrão e no script sem cor; o ícone é texto, e não a lista fechada, para um ícone que esta versão não conhece não derrubar a lista (`scriptIconOf` o
 * troca pelo padrão). `folderID` é a pasta de scripts dele (RN-SCRIPT-007), nula na raiz da seção; pode ser de uma pasta que outra janela acabou de tirar
 * da lista, e a árvore o põe na raiz até a leitura seguinte.
 */
export const scriptSummarySchema = z.object({ id, name: z.string().min(1), connectionID: id.nullable(), database: z.string().nullable(), folderID: id.nullable(), icon: z.string().nullable(), color: z.string().nullable(), updatedAt: z.string(), sql: z.never().optional() });

export type ScriptSummary = Omit<z.infer<typeof scriptSummarySchema>, "sql">;

export const scriptSummariesSchema = z.array(scriptSummarySchema);

/** O script inteiro (`GET api/user/scripts/{id}`), com o SQL que a aba abre. */
export const scriptSchema = z.object({ id, name: z.string().min(1), connectionID: id.nullable(), database: z.string().nullable(), folderID: id.nullable(), icon: z.string().nullable(), color: z.string().nullable(), sql: z.string(), updatedAt: z.string() });

export type Script = z.infer<typeof scriptSchema>;

/**
 * O que o Ctrl+S manda (RN-SCRIPT-001): o nome, o texto e o lugar da aba (a conexão e o banco; nulo é o banco da conexão). O script genérico (RN-SCRIPT-005)
 * vai com os dois nulos.
 */
export type ScriptInput = { name: string; sql: string; connectionID: string | null; database: string | null };

/**
 * Uma pasta de scripts (`GET api/user/script-folders`, seção 33: RN-SCRIPT-007): o nome e a pasta pai, nula na raiz da seção Scripts. A lista traz as pastas de
 * todos os níveis, e a tela monta a árvore (`buildScriptTree`).
 */
export const scriptFolderSchema = z.object({ id, parentID: id.nullable(), name: z.string().min(1), createdAt: z.string(), updatedAt: z.string() });

export type ScriptFolder = z.infer<typeof scriptFolderSchema>;

export const scriptFoldersSchema = z.array(scriptFolderSchema);

/**
 * O lugar que o `PATCH` grava: a conexão e o banco (a conexão nula mantém o lugar que o script tem, porque o ausente fica), ou o genérico (RN-SCRIPT-005), que
 * apaga o lugar. Nunca os dois: a API recusa o genérico com conexão ou banco.
 */
export type ScriptPlaceInput = { connectionID: string | null; database: string | null } | { generic: true };
