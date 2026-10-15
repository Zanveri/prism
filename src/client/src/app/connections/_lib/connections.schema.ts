import { z } from "zod";

import { engineTags, type Engine } from "@/components/ui/engine-tag";

/** `""` é "nenhuma" nos campos opcionais do formulário; a API recebe `null`. */
const emptyToNull = (value: string) => (value === "" ? null : value);

const id = z.guid();
const timestamp = z.string();

/**
 * RN-PROT-001: "Confirmar antes de executar", como a API a grava e devolve: `irreversible` ("Só comandos irreversíveis"), `all` ("Todos os comandos"), ou
 * nula, que é "Não" (o `none` que chegar também é "Não"). Um valor que a tela não conhece recusa a resposta, em vez de virar "Não": o próximo `PATCH`
 * gravaria a proteção mais fraca sem ninguém ter pedido.
 */
const confirmationSchema = z
  .enum(["none", "irreversible", "all"])
  .nullable()
  .transform((value) => (value === "none" ? null : value));

/** RN-PROT-001: a confirmação gravada; nula é "Não". */
export type Confirmation = "irreversible" | "all";

/**
 * RN-PROT-004: as proteções que valem para a conexão ou a pasta (as próprias e as das pastas acima) e de onde cada uma vem: `readOnlyFolderID` e
 * `confirmCommandsFolderID` são a pasta acima que impõe o valor, nulos quando ele é o próprio ou quando não há proteção.
 */
export const protectionsSchema = z.object({ readOnly: z.boolean(), readOnlyFolderID: id.nullable(), confirmCommands: confirmationSchema, confirmCommandsFolderID: id.nullable() });

export type Protections = z.infer<typeof protectionsSchema>;

/** RN-PROT-004: nenhuma proteção, nem a própria nem a de cima: o que vale na raiz e na pasta e na conexão sem nada marcado. */
export const unprotected: Protections = { readOnly: false, readOnlyFolderID: null, confirmCommands: null, confirmCommandsFolderID: null };

/**
 * A pasta como a API a devolve (RN-PASTA-001). `parentID` nulo é a raiz. O ambiente (RN-PASTA-005) vem sempre, nulo quando a pasta não tem: é o
 * que as conexões dela sem ambiente próprio herdam (`environment.ts`). A cor (RN-PASTA-007) também, nula na pasta sem cor: é a do ícone dela na árvore,
 * e não passa a ninguém. As proteções (RN-PROT-001 a 004) também vêm sempre: as próprias (`confirmCommands`, `readOnly`) e as que valem (`protections`),
 * que passam a tudo o que está dentro dela.
 */
export const folderSchema = z.object({
  id,
  parentID: id.nullable(),
  name: z.string(),
  environmentName: z.string().nullable(),
  environmentColor: z.string().nullable(),
  color: z.string().nullable(),
  confirmCommands: confirmationSchema,
  readOnly: z.boolean(),
  protections: protectionsSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export type Folder = z.infer<typeof folderSchema>;

export const foldersSchema = z.array(folderSchema);

export const engineSchema = z.literal([1, 2, 3], { error: "Escolha o banco de dados." });

/**
 * A conexão como a API a devolve: sem a senha, só `hasPassword` (RN-CONN-001). A tela não aceita
 * senha fora do diálogo de revelar, então uma resposta que traga `password` (mesmo nula) é recusada
 * por inteiro. Qualquer outro campo novo é ignorado. As proteções próprias e as que valem (RN-PROT-001 a 004) e a verificação periódica
 * (RN-VERIF-001) vêm sempre, como valem (`true`, `30` e nula no padrão): o `PATCH` grava a conexão por inteiro, e quem só renomeia ou move as manda
 * de volta como estão.
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
  confirmCommands: confirmationSchema,
  readOnly: z.boolean(),
  verificationEnabled: z.boolean(),
  verificationInterval: z.number().int(),
  verificationQuery: z.string().nullable(),
  protections: protectionsSchema,
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

const portMessage = "Informe uma porta de 1 a 65535.";

/** O ambiente do formulário (RN-CONN-010), o mesmo na conexão e na pasta (RN-PASTA-005): o nome em branco e a cor vazia viram `null`. */
const environmentFields = {
  environmentName: z.string().trim().max(30, "O ambiente pode ter no máximo 30 caracteres.").transform(emptyToNull),
  environmentColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, "Use uma cor no formato #RRGGBB.").transform(emptyToNull),
};

/**
 * As proteções próprias do formulário (RN-PROT-001 e 002), as mesmas na conexão e na pasta. Vêm de campos escondidos com a escolha PRÓPRIA (a herdada
 * aparece marcada, e não é gravada nela): `confirmCommands` é `none`, `irreversible` ou `all` (`none` vai à API nulo, como ela devolve), e `readOnly` é
 * `true` ou `false`. Sem os campos o formulário é recusado, e não gravado com as proteções mais fracas.
 */
const protectionFields = {
  confirmCommands: z
    .enum(["none", "irreversible", "all"], { error: "Escolha não confirmar, só os comandos irreversíveis ou todos os comandos." })
    .transform((value): Confirmation | null => (value === "none" ? null : value)),
  readOnly: z.enum(["true", "false"]).transform((value) => value === "true"),
};

/** Os campos do formulário de conexão (RN-CONN-010), como o `FormData` os entrega: tudo texto. */
const connectionFields = z.object({
  engine: z.coerce.number().pipe(engineSchema),
  name: z.string().trim().min(1, "Informe o nome da conexão.").max(80, "O nome pode ter no máximo 80 caracteres."),
  folderID: z.string().transform(emptyToNull),
  host: z.string().trim().min(1, "Informe o host."),
  port: z.string().trim().regex(/^\d+$/, portMessage).transform(Number).pipe(z.number().min(1, portMessage).max(65535, portMessage)),
  database: z.string().trim().min(1, "Informe o banco de dados."),
  userName: z.string().trim().min(1, "Informe o usuário do banco."),
  ...environmentFields,
  ...protectionFields,
});

/** Na criação a senha é obrigatória. Não é aparada: espaço nas pontas faz parte dela. */
export const createConnectionSchema = connectionFields.extend({ password: z.string().min(1, "Informe a senha do banco.") });

/** Na edição a senha vazia vira `null`, e a API mantém a gravada (RN-CONN-004). */
export const editConnectionSchema = connectionFields.extend({ password: z.string().transform(emptyToNull) });

/** RN-NAV-009: o diálogo de renomear conexão, só com o nome, na regra do formulário. */
export const renameConnectionSchema = connectionFields.pick({ name: true });

/**
 * RN-VERIF-001: a verificação periódica da conexão. O formulário ainda não a pergunta, e o `PATCH` grava a conexão por inteiro: vai a que a conexão já
 * tem, e na nova o padrão (`newVerification`).
 */
export type ConnectionVerification = Pick<Connection, "verificationEnabled" | "verificationInterval" | "verificationQuery">;

/** RN-VERIF-001: a verificação de uma conexão nova, ligada a cada 30 segundos com a consulta do banco, como a API grava sem os campos. */
export const newVerification: ConnectionVerification = { verificationEnabled: true, verificationInterval: 30, verificationQuery: null };

/** A verificação como a conexão a tem, para o `PATCH` que não a pergunta mandá-la de volta. */
export function verificationOf(connection: ConnectionVerification): ConnectionVerification {
  return { verificationEnabled: connection.verificationEnabled, verificationInterval: connection.verificationInterval, verificationQuery: connection.verificationQuery };
}

/**
 * O que a API recebe para criar ou alterar uma conexão; `password` nulo só na alteração. O `PATCH` grava a conexão por inteiro: as proteções e a
 * verificação vão sempre, as que a conexão já tem quando quem chama não as pergunta (sem elas, voltariam ao padrão).
 */
export type ConnectionInput = z.output<typeof editConnectionSchema> & ConnectionVerification;

/** A senha do usuário no diálogo de revelar. Como no login, não se apara nem se impõe regra de criação. */
export const revealPasswordSchema = z.object({ password: z.string().min(1, "Informe a sua senha do Prism.") });

const folderName = z.string().trim().min(1, "Informe o nome da pasta.").max(60, "O nome pode ter no máximo 60 caracteres.");

/**
 * Criar uma pasta: o nome, onde ela fica (`""` é a raiz), a cor do ícone dela (RN-PASTA-007, no formato da cor do ambiente), o ambiente (RN-PASTA-005) e as
 * proteções (RN-PROT-001 e 002).
 */
export const createFolderSchema = z.object({ name: folderName, parentID: z.string().transform(emptyToNull), color: environmentFields.environmentColor, ...environmentFields, ...protectionFields });

/** "Editar pasta…" (RN-PASTA-006) pergunta o nome, a cor, o ambiente e as proteções. */
export const editFolderSchema = createFolderSchema.pick({ name: true, color: true, environmentName: true, environmentColor: true, confirmCommands: true, readOnly: true });

/** O "Renomear" da pasta (F2, RN-NAV-009) pergunta só o nome. */
export const renameFolderSchema = createFolderSchema.pick({ name: true });

export const moveFolderSchema = createFolderSchema.pick({ parentID: true });

/** O que a API recebe ao criar (`id` ausente) ou alterar uma pasta: o `PATCH` grava a pasta por inteiro, o ambiente, a cor e as proteções inclusive. */
export type FolderInput = z.output<typeof createFolderSchema>;
