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

export const engineSchema = z.literal([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], { error: "Escolha o banco de dados." });

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

/**
 * RN-VERIF-002: a resposta da verificação periódica (`POST api/user/connections/{id}/verification`). `status` é `ok`, `failed`, `busy` ou `notConnected`;
 * `checkedAt`, o instante da resposta (UTC); `elapsedMs`, o tempo da consulta (só em `ok` e `failed`); `message` e `sqlState`, só em `failed`, com a mensagem
 * do banco como veio. A falha do banco é resposta 200: a tela a mostra no indicador (RN-VERIF-003), sem o aviso de erro.
 */
export const connectionVerificationSchema = z.object({
  status: z.enum(["ok", "failed", "busy", "notConnected"]),
  checkedAt: z.string().min(1),
  elapsedMs: z.number().min(0).nullish().transform((value) => value ?? null),
  message: z.string().nullish().transform((value) => value ?? null),
  sqlState: z.string().nullish().transform((value) => value ?? null),
});

export type ConnectionVerificationResult = z.output<typeof connectionVerificationSchema>;

/** A resposta de revelar: a senha da conexão, que só o formulário aberto guarda. */
export const revealedPasswordSchema = z.object({ password: z.string() });

/**
 * Os bancos que o Prism abre, a porta sugerida de cada um (RN-CONN-012) e a consulta com que a API o verifica quando a conexão não tem uma própria (RN-CONN-013
 * e RN-VERIF-001: a `PingSql` de cada banco na API), que é a dica do campo "Consulta de verificação". O Informix é 9089, a porta DRDA, e não a 9088 do canvas
 * (seção 9 da especificação).
 */
export const engineOptions = [
  { value: 1, label: "PostgreSQL", tag: engineTags[1], defaultPort: 5432, verificationQuery: "SELECT 1" },
  { value: 2, label: "Db2", tag: engineTags[2], defaultPort: 50000, verificationQuery: "SELECT 1 FROM SYSIBM.SYSDUMMY1" },
  { value: 3, label: "Informix", tag: engineTags[3], defaultPort: 9089, verificationQuery: "SELECT 1 FROM systables WHERE tabid = 1" },
  { value: 4, label: "SQLite", tag: engineTags[4], defaultPort: 1, verificationQuery: "SELECT 1" },
  { value: 5, label: "MySQL", tag: engineTags[5], defaultPort: 3306, verificationQuery: "SELECT 1" },
  { value: 6, label: "MariaDB", tag: engineTags[6], defaultPort: 3306, verificationQuery: "SELECT 1" },
  { value: 7, label: "Microsoft SQL Server", tag: engineTags[7], defaultPort: 1433, verificationQuery: "SELECT 1" },
  { value: 8, label: "Oracle", tag: engineTags[8], defaultPort: 1521, verificationQuery: "SELECT 1 FROM DUAL" },
  { value: 9, label: "Firebird", tag: engineTags[9], defaultPort: 3050, verificationQuery: "SELECT 1 FROM RDB$DATABASE" },
  { value: 10, label: "DuckDB", tag: engineTags[10], defaultPort: 1, verificationQuery: "SELECT 1" },
  { value: 11, label: "ClickHouse", tag: engineTags[11], defaultPort: 8123, verificationQuery: "SELECT 1" },
  { value: 12, label: "Google BigQuery", tag: engineTags[12], defaultPort: 443, verificationQuery: "SELECT 1" },
  { value: 13, label: "Databricks", tag: engineTags[13], defaultPort: 443, verificationQuery: "SELECT 1" },
] as const;

/** O rótulo, a etiqueta, a porta sugerida e a consulta de verificação de um banco. */
export function engineOption(engine: Engine) {
  return engineOptions.find((option) => option.value === engine) ?? engineOptions[0];
}

const portMessage = "Informe uma porta de 1 a 65535.";

/**
 * RN-PASTA-001 e RN-CONN-010: os caracteres de controle (U+0000 a U+001F e U+007F a U+009F) e os de direção do texto (U+200E, U+200F, U+202A a U+202E e U+2066
 * a U+2069), que um nome, um host, um banco de dados, um usuário ou um ambiente não têm: um U+202E faria o host que a prévia da importação manda conferir
 * parecer outro (RN-TRANSF-014). A tela e a API conferem do mesmo jeito.
 */
const controlOrBidi = /[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
/** O espaço que a normalização de um nome (a da API, `NormalizeName`) junta num espaço só: a tabulação e a quebra de linha num nome viram espaço, e não são recusadas. */
const nameSpaces = /[\t\n\v\f\r \u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/gu;

/** O texto passa, quanto aos caracteres de controle e de direção, depois da normalização do campo (`asName`: a do nome, que junta os espaços). */
export function withoutControl(value: string, asName = false): boolean {
  return !controlOrBidi.test(asName ? value.replace(nameSpaces, " ") : value);
}

/** O que um texto de várias linhas, a consulta de verificação, tem e os outros campos não: a tabulação, a quebra de linha e o retorno de carro. */
const lineBreaks = /[\t\n\r]/g;

/**
 * RN-VERIF-001 (alterada a pedido do dono em 2026-10-17): a consulta de verificação passa, quanto aos caracteres de controle e de direção, com a tabulação, a
 * quebra de linha e o retorno de carro, que uma consulta de várias linhas tem; os outros, não. É a regra da API (`HasControlOrDirectionBesidesLineBreaks`).
 */
export function queryWithoutControl(value: string): boolean {
  return withoutControl(value.replace(lineBreaks, ""));
}

/** A frase da recusa, com o nome do campo (RN-CONN-010). */
const controlMessage = (field: string) => `${field} não pode ter caractere de controle nem de direção do texto.`;

/** O ambiente do formulário (RN-CONN-010), o mesmo na conexão e na pasta (RN-PASTA-005): o nome em branco e a cor vazia viram `null`. */
const environmentFields = {
  environmentName: z
    .string()
    .trim()
    .max(30, "O ambiente pode ter no máximo 30 caracteres.")
    .refine((value) => withoutControl(value, true), controlMessage("O nome do ambiente"))
    .transform(emptyToNull),
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

/** RN-VERIF-001: a frase do intervalo fora da faixa, a mesma da API (na criação, na alteração e no teste). */
const verificationIntervalMessage = "A verificação deve ser feita a cada 5 a 3.600 segundos.";

/**
 * A sessão da conexão do formulário (RN-VERIF-001): "Verificar a cada [N] segundos" (`verificationEnabled`, `true` ou `false`, do campo escondido, e o
 * intervalo, de 5 a 3.600 inteiros) e a consulta de verificação, aparada, até 1.000 caracteres, sem caractere de controle nem de direção do texto (menos a
 * tabulação e as quebras de linha, `queryWithoutControl`), com as frases da API, e nula em branco (vale a do banco). Que ela seja uma leitura só quem diz é a
 * API, no banco da conexão: a recusa volta no campo, com o motivo.
 */
const verificationFields = {
  verificationEnabled: z.enum(["true", "false"]).transform((value) => value === "true"),
  verificationInterval: z
    .string()
    .trim()
    .regex(/^\d+$/, verificationIntervalMessage)
    .transform(Number)
    .pipe(z.number().min(5, verificationIntervalMessage).max(3600, verificationIntervalMessage)),
  verificationQuery: z
    .string()
    .trim()
    .max(1000, "A consulta de verificação pode ter no máximo 1.000 caracteres.")
    .refine(queryWithoutControl, controlMessage("A consulta de verificação"))
    .transform(emptyToNull),
};

/**
 * Os campos do formulário de conexão (RN-CONN-010), como o `FormData` os entrega: tudo texto. O host tem até 255 caracteres, o banco de dados e o usuário até
 * 128 (contados depois de aparados, que é o que se grava), e nenhum deles, nem o nome, tem caractere de controle ou de direção do texto: são as regras da
 * importação também (RN-TRANSF-014), para o arquivo que o Prism exporta voltar por ela.
 */
const connectionFields = z.object({
  engine: z.coerce.number().pipe(engineSchema),
  name: z
    .string()
    .trim()
    .min(1, "Informe o nome da conexão.")
    .max(80, "O nome pode ter no máximo 80 caracteres.")
    .refine((value) => withoutControl(value, true), controlMessage("O nome da conexão")),
  folderID: z.string().transform(emptyToNull),
  host: z.string().trim().min(1, "Informe o host.").max(255, "O host pode ter até 255 caracteres.").refine((value) => withoutControl(value), controlMessage("O host")),
  port: z.string().trim().regex(/^\d+$/, portMessage).transform(Number).pipe(z.number().min(1, portMessage).max(65535, portMessage)),
  database: z.string().trim().min(1, "Informe o banco de dados.").max(128, "O banco de dados pode ter até 128 caracteres.").refine((value) => withoutControl(value), controlMessage("O banco de dados")),
  userName: z.string().trim().min(1, "Informe o usuário do banco.").max(128, "O usuário do banco pode ter até 128 caracteres.").refine((value) => withoutControl(value), controlMessage("O usuário do banco")),
  ...environmentFields,
  ...protectionFields,
  ...verificationFields,
});

/** A senha do banco tem até 1.024 caracteres, contados como veio (RN-CONN-010): ela não é aparada. */
const passwordMessage = "A senha do banco pode ter até 1.024 caracteres.";

/** Na criação a senha é obrigatória. Não é aparada: espaço nas pontas faz parte dela. */
export const createConnectionSchema = connectionFields.extend({ password: z.string().min(1, "Informe a senha do banco.").max(1024, passwordMessage) });

/** Na edição a senha vazia vira `null`, e a API mantém a gravada (RN-CONN-004). */
export const editConnectionSchema = connectionFields.extend({ password: z.string().max(1024, passwordMessage).transform(emptyToNull) });

/**
 * RN-TRANSF-015: salvar a edição de uma conexão sem senha gravada (a que a importação trouxe sem ela) exige a senha: não há o que manter, e vazio é "Informe a
 * senha do banco.". O "Testar conexão" usa o `editConnectionSchema`: a senha em branco vai à API, que responde que a conexão não tem senha gravada.
 */
export const editWithoutPasswordSchema = connectionFields.extend({ password: z.string().min(1, "Informe a senha do banco.").max(1024, passwordMessage) });

/** RN-NAV-009: o diálogo de renomear conexão, só com o nome, na regra do formulário. */
export const renameConnectionSchema = connectionFields.pick({ name: true });

/**
 * RN-VERIF-001: a verificação periódica da conexão. O formulário a pergunta (o painel "Sessão da conexão"), e o `PATCH` grava a conexão por inteiro: quem
 * não a pergunta (renomear, mover) manda a que a conexão já tem (`verificationOf`).
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
export type ConnectionInput = z.output<typeof editConnectionSchema>;

/** A senha do usuário no diálogo de revelar. Como no login, não se apara nem se impõe regra de criação. */
export const revealPasswordSchema = z.object({ password: z.string().min(1, "Informe a sua senha do Prism.") });

/** RN-PASTA-001: o nome da pasta, de 1 a 60, sem caractere de controle nem de direção do texto (depois da normalização, que junta os espaços). */
const folderName = z
  .string()
  .trim()
  .min(1, "Informe o nome da pasta.")
  .max(60, "O nome pode ter no máximo 60 caracteres.")
  .refine((value) => withoutControl(value, true), "O nome da pasta não pode ter caractere de controle nem de direção do texto.");

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
