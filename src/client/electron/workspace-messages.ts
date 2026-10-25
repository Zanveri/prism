import { z } from "zod";

/**
 * As abas que voltam na próxima entrada (RN-ABAS-006), como a tela as conta ao processo principal e como a API as grava (`PUT api/user/workspace`): o mesmo
 * schema dos dois lados da ponte, como o de `window-messages.ts`. O processo principal confere o que cada janela manda antes de juntar, e a tela confere o que
 * a API devolve antes de reabrir. Só o que volta: de cada aba de consulta, o texto, a conexão, o banco, o script de onde veio, a marca de mudança não salva e
 * o lugar do resultado (RN-ABAS-016: `panel`, `tab` ou `window`; sem ele, o painel); de cada aba de tabela, a conexão, o banco, o esquema, a tabela e a vista.
 * Nada de resultado, cursor, sessão nem alteração não salva da grade.
 *
 * Os nomes dos campos são os da API (`connectionID`, `scriptID`), e os limites também: o banco de 1 a 128 caracteres (o da abertura de sessão), o esquema e a
 * tabela até 1024, e o texto até 1 MB em bytes de UTF-8 (RN-SCRIPT-004). Este arquivo não importa nada de `src/`; a vista repete a de `workbench-model.ts`,
 * e quem as mantém juntas é o TypeScript, em `saved-workspace.ts`.
 */

/** RN-SCRIPT-004: 1 MB do texto de cada aba, em bytes de UTF-8 (1.048.576), a mesma conta da API (`WorkspaceRules.FitsTheLimit`). */
export const maxSavedSqlBytes = 1024 * 1024;

const encoder = new TextEncoder();

/** Cada unidade UTF-16 vale no máximo 3 bytes: o texto curto não precisa ser codificado. */
export function fitsSavedSqlLimit(sql: string): boolean {
  return sql.length * 3 <= maxSavedSqlBytes || encoder.encode(sql).length <= maxSavedSqlBytes;
}

const guid = z.guid();
const database = z.string().min(1).max(128).nullable();
const objectName = z.string().max(1024);

/**
 * RN-ABAS-016: os três lugares do resultado, como a tela os tem (`resultPlaces`, em `workbench-model.ts`). Um lugar que esta versão não conhece (gravado por uma
 * mais nova) vale nulo, o painel, e a aba volta do mesmo jeito: só o lugar não volta.
 */
const resultPlace = z.enum(["panel", "tab", "window"]).nullable().optional().catch(null);

export const savedQueryTabSchema = z
  .object({ kind: z.literal("query"), connectionID: guid.nullable(), database, sql: z.string().refine(fitsSavedSqlLimit), scriptID: guid.nullable(), dirty: z.boolean(), sqlTooLarge: z.boolean(), resultPlace })
  // O texto que passava de 1 MB não é gravado: a aba vai vazia, com a marca.
  .refine((tab) => !tab.sqlTooLarge || tab.sql === "");

export const savedTableTabSchema = z.object({ kind: z.literal("table"), connectionID: guid, database, schema: objectName, table: objectName.min(1), view: z.enum(["data", "structure", "diagram"]) });

export const savedTabSchema = z.discriminatedUnion("kind", [savedQueryTabSchema, savedTableTabSchema]);

export type SavedTab = z.infer<typeof savedTabSchema>;

/** As abas na ordem em que estavam e o índice da ativa (nulo sem abas, ou sem nenhuma ativa). */
export const savedWorkspaceSchema = z.object({ tabs: z.array(savedTabSchema), activeIndex: z.number().int().min(0).nullable() }).refine((workspace) => workspace.activeIndex === null || workspace.activeIndex < workspace.tabs.length);

export type SavedWorkspace = z.infer<typeof savedWorkspaceSchema>;

/** O que uma janela conta das abas dela. `urgent`: uma aba fechou, e a gravação é na hora (RN-ABAS-006). */
export const workspaceReportSchema = z.object({ workspace: savedWorkspaceSchema, urgent: z.boolean() });

export type WorkspaceReport = z.infer<typeof workspaceReportSchema>;
