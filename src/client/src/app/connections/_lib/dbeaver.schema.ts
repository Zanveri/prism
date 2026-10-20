import { z } from "zod";

import { dbeaverWheres } from "../../../../electron/dbeaver-messages";
import { importResultSchema, previewConnectionSchema, previewFolderSchema, type ConflictPolicy } from "./transfer.schema";

/**
 * O contrato das rotas do DBeaver (seção 40 da especificação, "Rotas e respostas"). A tela nunca recebe uma senha (RN-CONN-001): a prévia diz só se a
 * conexão leva senha (`hasPassword`), e o schema herdado recusa a resposta que traga `password`. A tela também nunca manda um caminho: a origem é o `sourceId`
 * que o processo principal deu à cópia (RN-DBEAVER-006).
 */

const count = z.number().int().min(0);
const text = z.string().nullish().transform((value) => value ?? null);
const flag = z.boolean().nullish().transform((value) => value === true);
const names = z.array(z.string()).nullish().transform((value) => value ?? []);

/** `GET api/user/connections/dbeaver` (RN-DBEAVER-018): quando o convite foi feito e quando foi a última importação que gravou algo; nulos até acontecer. */
export const dbeaverStateSchema = z.object({ invitedAt: z.string().nullable(), lastImportAt: z.string().nullable() });

export type DbeaverState = z.infer<typeof dbeaverStateSchema>;

/** Um projeto da cópia na contagem (RN-DBEAVER-007): o que o "Comece por aqui" e o seletor do projeto mostram. */
export const dbeaverScanProjectSchema = z.object({
  name: z.string(),
  connections: count,
  importable: count,
  withPassword: count,
  protected: flag,
  nameInvalid: flag,
  credentialsUnreadable: flag,
  credentialsProtected: flag,
});

export type DbeaverScanProject = z.output<typeof dbeaverScanProjectSchema>;

/** `POST api/user/connections/dbeaver/scan`: onde a cópia estava e, de cada projeto, as contagens. A contagem não confere os limites. */
export const dbeaverScanSchema = z.object({ where: z.enum(dbeaverWheres), projects: z.array(dbeaverScanProjectSchema) });

export type DbeaverScan = z.output<typeof dbeaverScanSchema>;

/**
 * O que ficou de fora da conexão importável (RN-DBEAVER-013), por código; mais os dois avisos do ambiente (RN-DBEAVER-012). O código que a tela não conhece
 * é ignorado: não há frase para ele.
 */
export const leftOutCodes = [
  "informixServer",
  "sshTunnel",
  "proxy",
  "driverProperties",
  "bootstrap",
  "autocommitOff",
  "events",
  "authModel",
  "confirmDataChange",
  "permissions",
  "navigatorFilters",
  "environmentCut",
  "environmentInvalid",
] as const;

export type LeftOutCode = (typeof leftOutCodes)[number];

const leftOutSchema = z
  .array(z.string())
  .nullish()
  .transform((codes) => (codes ?? []).filter((code): code is LeftOutCode => (leftOutCodes as readonly string[]).includes(code)));

/**
 * A conexão do Prism que tem a mesma origem (RN-DBEAVER-017): o ID dela, o nome, o caminho na árvore ("Estoque / Production PRD") e se está conectada em
 * alguma janela. Os campos de valor (`host`, `port`, `database`, `userName`, `environmentName`) são o que ela tem hoje: a pergunta de sobrescrever mostra
 * "host a → b" com eles.
 */
const existingSchema = z
  .object({
    connectionID: z.guid(),
    name: z.string(),
    path: text,
    connected: flag,
    host: text,
    port: z.number().int().nullish().transform((value) => value ?? null),
    database: text,
    userName: text,
    environmentName: text,
  })
  .nullish()
  .transform((value) => value ?? null);

export type DbeaverExisting = NonNullable<z.output<typeof existingSchema>>;

/** O que sobrescrever mudaria na conexão que já existe: cada campo é verdadeiro quando muda. */
const overwriteSchema = z
  .object({ name: flag, engine: flag, host: flag, port: flag, database: flag, userName: flag, password: flag, environment: flag, keepsName: flag, dropsPassword: flag })
  .nullish()
  .transform((value) => value ?? null);

export type DbeaverOverwrite = NonNullable<z.output<typeof overwriteSchema>>;

export const dbeaverPreviewFolderSchema = previewFolderSchema.extend({ nameCut: flag });

export const dbeaverPreviewConnectionSchema = previewConnectionSchema.extend({
  server: text,
  dbeaverPort: z.number().int().nullish().transform((value) => value ?? null),
  drdaPort: z.number().int().nullish().transform((value) => value ?? null),
  authModel: text,
  dbeaverType: text,
  existing: existingSchema,
  overwrite: overwriteSchema,
  leftOut: leftOutSchema,
});

export type DbeaverPreviewFolder = z.output<typeof dbeaverPreviewFolderSchema>;

export type DbeaverPreviewConnection = Omit<z.output<typeof dbeaverPreviewConnectionSchema>, "password">;

/** Os avisos da prévia (RN-DBEAVER-015): nomes de projetos e contagens. */
export const dbeaverNotesSchema = z
  .object({
    protectedProjects: names,
    credentialsUnreadable: names,
    credentialsProtected: names,
    unreadableFiles: names,
    unreadableProjects: names,
    withoutSavedPassword: count.nullish().transform((value) => value ?? 0),
    savedPasswordMissing: count.nullish().transform((value) => value ?? 0),
  })
  .nullish()
  .transform((value) => value ?? { protectedProjects: [], credentialsUnreadable: [], credentialsProtected: [], unreadableFiles: [], unreadableProjects: [], withoutSavedPassword: 0, savedPasswordMissing: 0 });

export type DbeaverNotes = z.output<typeof dbeaverNotesSchema>;

/** `POST api/user/connections/dbeaver/import/preview`: a árvore do DBeaver com o que a importação faria, sem gravar nada. */
export const dbeaverPreviewSchema = z.object({ folders: z.array(dbeaverPreviewFolderSchema), connections: z.array(dbeaverPreviewConnectionSchema), notes: dbeaverNotesSchema });

export type DbeaverPreview = { folders: DbeaverPreviewFolder[]; connections: DbeaverPreviewConnection[]; notes: DbeaverNotes };

/** A resposta da importação (RN-DBEAVER-016): as da seção 34, mais os IDs das conexões sobrescritas. */
export const dbeaverImportResultSchema = importResultSchema.extend({ updatedIDs: z.array(z.guid()) });

export type DbeaverImportResult = z.output<typeof dbeaverImportResultSchema>;

/**
 * A porta DRDA que a pessoa digitou para um servidor do DBeaver (RN-DBEAVER-010 e 015): o host, a porta SQLI e o `INFORMIXSERVER` como a prévia os dá, e a
 * porta nova. Toda conexão Informix importada daquele servidor, nova ou sobrescrita, é gravada com a `drdaPort`.
 */
export type DbeaverDrdaPort = { host: string; port: number; server: string | null; drdaPort: number };

/**
 * O corpo da prévia: a cópia, o projeto (`null` é todos), o lugar (`null` é a raiz), "Levar as senhas" e as portas DRDA digitadas. O corpo da importação tem
 * também as chaves marcadas, a escolha dos conflitos de nome e as chaves das conexões que já existem e devem ser sobrescritas.
 */
export type DbeaverPreviewRequest = { sourceId: string; project: string | null; targetFolderID: string | null; withPasswords: boolean; drdaPorts: DbeaverDrdaPort[] };

export type DbeaverImportRequest = DbeaverPreviewRequest & { items: string[]; onConflict: ConflictPolicy; overwrite: string[] };
