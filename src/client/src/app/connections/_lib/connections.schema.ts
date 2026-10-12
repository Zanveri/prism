import { z } from "zod";

import { engineTags, type Engine } from "@/components/ui/engine-tag";

/** `""` é "nenhuma" nos campos opcionais do formulário; a API recebe `null`. */
const emptyToNull = (value: string) => (value === "" ? null : value);

const id = z.guid();
const timestamp = z.string();

/** A pasta como a API a devolve (RN-PASTA-001). `parentID` nulo é a raiz. */
export const folderSchema = z.object({ id, parentID: id.nullable(), name: z.string(), createdAt: timestamp, updatedAt: timestamp });

export type Folder = z.infer<typeof folderSchema>;

export const foldersSchema = z.array(folderSchema);

export const engineSchema = z.literal([1, 2, 3], { error: "Escolha o banco de dados." });

/**
 * A conexão como a API a devolve: sem a senha, só `hasPassword` (RN-CONN-001). A tela não aceita
 * senha fora do diálogo de revelar, então uma resposta que traga `password` (mesmo nula) é recusada
 * por inteiro. Qualquer outro campo novo é ignorado.
 */
export const connectionSchema = z.object({
  id,
  folderID: id.nullable(),
  name: z.string(),
  engine: engineSchema,
  host: z.string(),
  port: z.number().int(),
  database: z.string(),
  userName: z.string(),
  hasPassword: z.boolean(),
  environmentName: z.string().nullable(),
  environmentColor: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  password: z.never().optional(),
});

export type Connection = Omit<z.infer<typeof connectionSchema>, "password">;

export const connectionsSchema = z.array(connectionSchema);

/** A resposta de revelar: a senha da conexão, que só o formulário aberto guarda. */
export const revealedPasswordSchema = z.object({ password: z.string() });

/**
 * Os bancos que o Prism abre e a porta sugerida de cada um (RN-CONN-012). O Informix é 9089, a
 * porta DRDA, e não a 9088 do canvas (seção 9 da especificação).
 */
export const engineOptions = [
  { value: 1, label: "PostgreSQL", tag: engineTags[1], defaultPort: 5432 },
  { value: 2, label: "Db2", tag: engineTags[2], defaultPort: 50000 },
  { value: 3, label: "Informix", tag: engineTags[3], defaultPort: 9089 },
] as const;

/** O rótulo, a etiqueta e a porta sugerida de um banco. */
export function engineOption(engine: Engine) {
  return engineOptions.find((option) => option.value === engine) ?? engineOptions[0];
}

const portMessage ="Informe uma porta de 1 a 65535.";

/** Os campos do formulário de conexão (RN-CONN-010), como o `FormData` os entrega: tudo texto. */
const connectionFields = z.object({
  engine: z.coerce.number().pipe(engineSchema),
  name: z.string().trim().min(1, "Informe o nome da conexão.").max(80, "O nome pode ter no máximo 80 caracteres."),
  folderID: z.string().transform(emptyToNull),
  host: z.string().trim().min(1, "Informe o host."),
  port: z.string().trim().regex(/^\d+$/, portMessage).transform(Number).pipe(z.number().min(1, portMessage).max(65535, portMessage)),
  database: z.string().trim().min(1, "Informe o banco de dados."),
  userName: z.string().trim().min(1, "Informe o usuário do banco."),
  environmentName: z.string().trim().max(30, "O ambiente pode ter no máximo 30 caracteres.").transform(emptyToNull),
  environmentColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, "Use uma cor no formato #RRGGBB.").transform(emptyToNull),
});

/** Na criação a senha é obrigatória. Não é aparada: espaço nas pontas faz parte dela. */
export const createConnectionSchema = connectionFields.extend({ password: z.string().min(1, "Informe a senha do banco.") });

/** Na edição a senha vazia vira `null`, e a API mantém a gravada (RN-CONN-004). */
export const editConnectionSchema = connectionFields.extend({ password: z.string().transform(emptyToNull) });

/** O que a API recebe para criar ou alterar uma conexão; `password` nulo só na alteração. */
export type ConnectionInput = z.output<typeof editConnectionSchema>;

/** A senha do usuário no diálogo de revelar. Como no login, não se apara nem se impõe regra de criação. */
export const revealPasswordSchema = z.object({ password: z.string().min(1, "Informe a sua senha do Prism.") });

const folderName = z.string().trim().min(1, "Informe o nome da pasta.").max(60, "O nome pode ter no máximo 60 caracteres.");

/** Criar uma pasta: o nome e onde ela fica (`""` é a raiz). */
export const createFolderSchema = z.object({ name: folderName, parentID: z.string().transform(emptyToNull) });

export const renameFolderSchema = createFolderSchema.pick({ name: true });

export const moveFolderSchema = createFolderSchema.pick({ parentID: true });

/** O que a API recebe ao criar (`id` ausente) ou alterar uma pasta. */
export type FolderInput = { name: string; parentID: string | null };
