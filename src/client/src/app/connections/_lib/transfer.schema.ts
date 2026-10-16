import { z } from "zod";

import type { Engine } from "@/components/ui";

import type { Confirmation } from "./connections.schema";

/**
 * O contrato das rotas de exportar e importar conexões (seção 34 da especificação, "Rotas e respostas"). A tela nunca recebe uma senha de banco
 * (RN-CONN-001): a exportação devolve o arquivo já cifrado, e a prévia diz só se a conexão tem senha. Os schemas recusam a resposta que traga `password`.
 */

/** RN-TRANSF-003: o que vai de cada conexão. `none` é o padrão, o mais seguro. */
export type CredentialsChoice = "none" | "user" | "userAndPassword";

/**
 * O corpo de `POST api/user/connections/export`: as pastas marcadas (as do caminho de cada item vão sozinhas), as conexões marcadas com a escolha de cada
 * uma, a senha de exportação (na forma NFC) e, só quando a RN-TRANSF-005 a pede, a senha do Prism. Nada disto fica guardado: a mutação que o leva tem
 * `gcTime: 0` e é esvaziada assim que a resposta chega.
 */
export type ExportRequest = { folderIDs: string[]; connections: { id: string; credentials: CredentialsChoice }[]; passphrase: string; userPassword?: string };

const count = z.number().int().min(0);

/**
 * A resposta da exportação: o texto do arquivo, já cifrado (RN-TRANSF-007), que a tela entrega ao diálogo de salvar sem conseguir ler; e as contagens do que foi
 * nele (as pastas do caminho contam), para o aviso de sucesso.
 */
export const exportResultSchema = z.object({ content: z.string().min(1), folders: count, connections: count, withUser: count, withPassword: count });

export type ExportResult = z.infer<typeof exportResultSchema>;

/** A confirmação como a API a escreve; o valor que a tela não conhece não vale nada na prévia (a do item que não pode ser importado, que vem como veio). */
const confirmation = z
  .string()
  .nullish()
  .transform((value): Confirmation | null => (value === "irreversible" || value === "all" ? value : null));

const text = z.string().nullish().transform((value) => value ?? null);
const flag = z.boolean().nullish().transform((value) => value ?? null);
const integer = z.number().int().nullish().transform((value) => value ?? null);

/**
 * RN-TRANSF-013: o que a importação gravaria no item para ele não ficar mais fraco que na origem, com os campos nulos quando nada muda. Na pasta, só as
 * proteções: o ambiente de uma pasta não passa às subpastas.
 */
const strengthenedSchema = z
  .object({ readOnly: flag, confirmCommands: confirmation, environmentName: text, environmentColor: text })
  .nullish()
  .transform((value) => ({ readOnly: value?.readOnly === true, confirmCommands: value?.confirmCommands ?? null, environmentName: value?.environmentName ?? null, environmentColor: value?.environmentColor ?? null }));

export type Strengthened = z.output<typeof strengthenedSchema>;

/** O que valia na conexão na origem (RN-PROT-004 e RN-PASTA-005), como o arquivo diz: o somente leitura, a confirmação e o ambiente que ela mostrava. */
const effectiveSchema = z
  .object({ readOnly: flag, confirmCommands: confirmation, environmentName: text, environmentColor: text })
  .nullish()
  .transform((value) => ({ readOnly: value?.readOnly === true, confirmCommands: value?.confirmCommands ?? null, environmentName: value?.environmentName ?? null, environmentColor: value?.environmentColor ?? null }));

/**
 * Uma pasta do arquivo na prévia (RN-TRANSF-011). `key` e `parentKey` são as chaves do arquivo (nulo é a raiz do arquivo, que vai para o lugar escolhido);
 * `existing`, a pasta que já existe no lugar (o conteúdo entra nela); `invalid`, o motivo de ela não poder ser importada, ou nulo. Os textos do item que não
 * pode ser importado vêm cortados pela API, e podem faltar.
 */
export const previewFolderSchema = z.object({
  key: z.string(),
  parentKey: z.string().nullable(),
  name: text,
  color: text,
  environmentName: text,
  environmentColor: text,
  confirmCommands: confirmation,
  readOnly: flag.transform((value) => value === true),
  existing: z.boolean().nullish().transform((value) => value === true),
  strengthened: strengthenedSchema,
  invalid: text,
});

export type PreviewFolder = z.output<typeof previewFolderSchema>;

/**
 * Uma conexão do arquivo na prévia (RN-TRANSF-011): o banco pelo número de sempre (nulo quando este Prism não o conhece), o servidor, o usuário (vazio quando
 * não veio) e se há senha, nunca a senha (RN-CONN-001); a verificação do arquivo (`verificationQuery` nula é a do banco); o que valia na origem
 * (`effective`); se o nome está tomado no lugar (`conflict`) e o nome da cópia (`copyName`); o que a importação gravaria nela (`strengthened`); e o motivo
 * de ela não poder ser importada (`invalid`).
 */
export const previewConnectionSchema = z.object({
  key: z.string(),
  folderKey: z.string().nullable(),
  name: text,
  engine: z
    .number()
    .nullish()
    .transform((value): Engine | null => (value === 1 || value === 2 || value === 3 ? value : null)),
  host: text,
  port: integer,
  database: text,
  userName: z.string().nullish().transform((value) => value ?? ""),
  hasPassword: z.boolean().nullish().transform((value) => value === true),
  verificationEnabled: flag,
  verificationInterval: integer,
  verificationQuery: text,
  effective: effectiveSchema,
  conflict: z.boolean().nullish().transform((value) => value === true),
  copyName: text,
  strengthened: strengthenedSchema,
  invalid: text,
  password: z.never().optional(),
});

export type PreviewConnection = Omit<z.output<typeof previewConnectionSchema>, "password">;

/** A resposta de `POST api/user/connections/import/preview`: a árvore do arquivo, com o que a importação faria no lugar escolhido, sem gravar nada. */
export const importPreviewSchema = z.object({ folders: z.array(previewFolderSchema), connections: z.array(previewConnectionSchema) });

export type ImportPreview = { folders: PreviewFolder[]; connections: PreviewConnection[] };

/** RN-TRANSF-012: a escolha única dos conflitos de nome. */
export type ConflictPolicy = "rename" | "skip";

/** O corpo da prévia: o texto do arquivo, a senha de exportação (aparada e em NFC) e o lugar (`null` é a raiz do navegador). */
export type PreviewRequest = { content: string; passphrase: string; targetFolderID: string | null };

/**
 * O corpo de `POST api/user/connections/import`: o da prévia, mais as chaves marcadas do arquivo (as pastas do caminho de cada uma vão sozinhas), a escolha
 * dos conflitos e a caixa "Manter as consultas de verificação do arquivo".
 */
export type ImportRequest = PreviewRequest & { items: string[]; onConflict: ConflictPolicy; keepVerificationQueries: boolean };

/**
 * A resposta da importação (RN-TRANSF-014): os IDs criados (pastas e conexões), quantas pastas do arquivo entraram numa que já existia, e quantas conexões
 * foram com outro nome e quantas ficaram de fora.
 */
export const importResultSchema = z.object({ folderIDs: z.array(z.guid()), connectionIDs: z.array(z.guid()), mergedFolders: count, renamed: count, skipped: count });

export type ImportResult = z.infer<typeof importResultSchema>;
