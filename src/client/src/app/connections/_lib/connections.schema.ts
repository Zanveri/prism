import { z } from "zod";

import { engineTags, type Engine } from "@/components/ui/engine-tag";
import { firstFieldErrors, type FieldErrors, type ParsedForm } from "@/lib/utils/form";

import { connectionsCopy } from "./connections.copy";

const { validation } = connectionsCopy;

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
  useInternalDescriptions: z.boolean().optional(),
  protections: protectionsSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export type Folder = z.infer<typeof folderSchema>;

export const foldersSchema = z.array(folderSchema);

export const engineSchema = z.literal([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], { error: validation.engine });

/** A configuração de túnel SSH da conexão como a API a devolve (sem a senha ou frase secreta, só `hasSecret`). */
export const connectionSshSchema = z.object({
  host: z.string(),
  port: z.number().int(),
  userName: z.string(),
  authMethod: z.enum(["password", "privateKey"]),
  privateKeyPath: z.string().nullable(),
  hasSecret: z.boolean(),
  saveCredentials: z.boolean(),
  ignoreHostVerification: z.boolean(),
  keepAliveIntervalMs: z.number().int(),
  tunnelTimeoutMs: z.number().int(),
  localHost: z.string().nullable(),
  localPort: z.number().int(),
  remoteHost: z.string().nullable(),
  remotePort: z.number().int(),
  hostKeyFingerprint: z.string().nullable(),
  secret: z.never().optional(),
});

export type ConnectionSsh = Omit<z.infer<typeof connectionSshSchema>, "secret">;

export const sslModes = ["", "disable", "allow", "prefer", "require", "verify-ca", "verify-full"] as const;
export type SslMode = (typeof sslModes)[number];

/** A configuração SSL da conexão como a API a devolve e recebe (os nomes são os do `ConnectionSslSettings`; o modo "Padrão do driver" volta nulo). */
export const connectionSslSchema = z.object({
  caCertificatePath: z.string().nullable(),
  clientCertificatePath: z.string().nullable(),
  clientKeyPath: z.string().nullable(),
  sslMode: z.enum(sslModes).nullable(),
});

export type ConnectionSsl = z.infer<typeof connectionSslSchema>;
export type ConnectionSslInput = ConnectionSsl;

/** A configuração de proxy SOCKS5 da conexão como a API a devolve (sem a senha, só `hasPassword`). */
export const connectionProxySchema = z.object({
  host: z.string(),
  port: z.number().int(),
  userName: z.string().nullable(),
  hasPassword: z.boolean(),
  saveCredentials: z.boolean(),
  password: z.never().optional(),
});

export type ConnectionProxy = Omit<z.infer<typeof connectionProxySchema>, "password">;

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
  useInternalDescriptions: z.boolean().nullable().optional(),
  ssh: connectionSshSchema.nullable().optional(),
  ssl: connectionSslSchema.nullable().optional(),
  proxy: connectionProxySchema.nullable().optional(),
  protections: protectionsSchema,
  createdAt: timestamp,
  updatedAt: timestamp,
  password: z.never().optional(),
});

export type Connection = Omit<z.infer<typeof connectionSchema>, "password" | "ssh" | "proxy"> & {
  ssh?: ConnectionSsh | null;
  proxy?: ConnectionProxy | null;
};

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

const portMessage = validation.port;

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
const controlMessage = validation.control;

/** O ambiente do formulário (RN-CONN-010), o mesmo na conexão e na pasta (RN-PASTA-005): o nome em branco e a cor vazia viram `null`. */
const environmentFields = {
  environmentName: z
    .string()
    .trim()
    .max(30, validation.environmentMax)
    .refine((value) => withoutControl(value, true), controlMessage(validation.fields.environmentName))
    .transform(emptyToNull),
  environmentColor: z.string().regex(/^(#[0-9a-fA-F]{6})?$/, validation.colorFormat).transform(emptyToNull),
};

/**
 * As proteções próprias do formulário (RN-PROT-001 e 002), as mesmas na conexão e na pasta. Vêm de campos escondidos com a escolha PRÓPRIA (a herdada
 * aparece marcada, e não é gravada nela): `confirmCommands` é `none`, `irreversible` ou `all` (`none` vai à API nulo, como ela devolve), e `readOnly` é
 * `true` ou `false`. Sem os campos o formulário é recusado, e não gravado com as proteções mais fracas.
 */
const protectionFields = {
  confirmCommands: z
    .enum(["none", "irreversible", "all"], { error: validation.confirmCommands })
    .transform((value): Confirmation | null => (value === "none" ? null : value)),
  readOnly: z.enum(["true", "false"]).transform((value) => value === "true"),
};

/** RN-VERIF-001: a frase do intervalo fora da faixa, a mesma da API (na criação, na alteração e no teste). */
const verificationIntervalMessage = validation.verificationInterval;

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
    .max(1000, validation.verificationQueryMax)
    .refine(queryWithoutControl, controlMessage(validation.fields.verificationQuery))
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
    .min(1, validation.connectionNameRequired)
    .max(80, validation.connectionNameMax)
    .refine((value) => withoutControl(value, true), controlMessage(validation.fields.connectionName)),
  folderID: z.string().transform(emptyToNull),
  host: z.string().trim().min(1, validation.hostRequired).max(255, validation.hostMax).refine((value) => withoutControl(value), controlMessage(validation.fields.host)),
  port: z.string().trim().regex(/^\d+$/, portMessage).transform(Number).pipe(z.number().min(1, portMessage).max(65535, portMessage)),
  database: z.string().trim().min(1, validation.databaseRequired).max(128, validation.databaseMax).refine((value) => withoutControl(value), controlMessage(validation.fields.database)),
  userName: z.string().trim().min(1, validation.userRequired).max(128, validation.userMax).refine((value) => withoutControl(value), controlMessage(validation.fields.databaseUser)),
  ...environmentFields,
  ...protectionFields,
  ...verificationFields,
  useInternalDescriptions: z.enum(["true", "false", ""]).transform((value) => (value === "" ? null : value === "true")).optional(),
});

/** A senha do banco tem até 1.024 caracteres, contados como veio (RN-CONN-010): ela não é aparada. */
const passwordMessage = validation.passwordMax;

/** Na criação a senha é obrigatória. Não é aparada: espaço nas pontas faz parte dela. */
export const createConnectionSchema = connectionFields.extend({ password: z.string().min(1, validation.passwordRequired).max(1024, passwordMessage) });

/** Na edição a senha vazia vira `null`, e a API mantém a gravada (RN-CONN-004). */
export const editConnectionSchema = connectionFields.extend({ password: z.string().max(1024, passwordMessage).transform(emptyToNull) });

/**
 * RN-TRANSF-015: salvar a edição de uma conexão sem senha gravada (a que a importação trouxe sem ela) exige a senha: não há o que manter, e vazio é "Informe a
 * senha do banco.". O "Testar conexão" usa o `editConnectionSchema`: a senha em branco vai à API, que responde que a conexão não tem senha gravada.
 */
export const editWithoutPasswordSchema = connectionFields.extend({ password: z.string().min(1, validation.passwordRequired).max(1024, passwordMessage) });

/** RN-NAV-009: o diálogo de renomear conexão, só com o nome, na regra do formulário. */
export const renameConnectionSchema = connectionFields.pick({ name: true });

/** O que a API recebe para configurar o túnel SSH da conexão (`secret` nulo mantém a senha/frase secreta gravada). */
export type ConnectionSshInput = {
  host: string;
  port: number;
  userName: string;
  authMethod: "password" | "privateKey";
  privateKeyPath: string | null;
  secret: string | null;
  saveCredentials: boolean;
  ignoreHostVerification: boolean;
  keepAliveIntervalMs: number;
  tunnelTimeoutMs: number;
  localHost: string | null;
  localPort: number;
  remoteHost: string | null;
  remotePort: number;
  hostKeyFingerprint: string | null;
};

/** O que a API recebe para configurar o proxy SOCKS5 da conexão (`password` nulo mantém a senha gravada). */
export type ConnectionProxyInput = {
  host: string;
  port: number;
  userName: string | null;
  password: string | null;
  saveCredentials: boolean;
};

const sshPortMessage = "Informe uma porta SSH de 1 a 65535.";
const sshKeepAliveMessage = "O intervalo de keep-alive SSH deve ficar entre 0 e 3.600.000 ms.";
// O teto é o da API (`ConnectionRules.SshRefusal`).
const sshTimeoutMessage = "O timeout do túnel SSH deve ficar entre 0 e 600.000 ms.";
const sshLocalPortMessage = "A porta local do encaminhamento SSH deve ficar entre 0 e 65535.";
const sshRemotePortMessage = "A porta remota do encaminhamento SSH deve ficar entre 0 e 65535.";
const proxyPortMessage = "Informe uma porta de proxy de 1 a 65535.";

const sshFormFieldsSchema = z
  .object({
    sshHost: z.string().trim().min(1, "Informe o host SSH.").max(255, "O host SSH pode ter até 255 caracteres.").refine((value) => withoutControl(value), controlMessage("O host SSH")),
    sshPort: z.string().trim().regex(/^\d+$/, sshPortMessage).transform(Number).pipe(z.number().min(1, sshPortMessage).max(65535, sshPortMessage)),
    sshUserName: z.string().trim().min(1, "Informe o usuário SSH.").max(128, "O usuário SSH pode ter até 128 caracteres.").refine((value) => withoutControl(value), controlMessage("O usuário SSH")),
    sshAuthMethod: z.enum(["password", "privateKey"], { error: "Escolha o método de autenticação SSH (senha ou chave privada)." }),
    sshPrivateKeyPath: z.string().trim().max(1024, "O caminho da chave privada SSH pode ter até 1.024 caracteres.").refine((value) => withoutControl(value), controlMessage("O caminho da chave privada SSH")),
    sshSecret: z.string().max(1024, "A senha ou frase secreta SSH pode ter até 1.024 caracteres.").transform(emptyToNull),
    sshSaveCredentials: z.enum(["true", "false"]).transform((value) => value === "true"),
    sshIgnoreHostVerification: z.enum(["true", "false"]).transform((value) => value === "true"),
    sshKeepAliveIntervalMs: z.string().trim().regex(/^\d+$/, sshKeepAliveMessage).transform(Number).pipe(z.number().min(0, sshKeepAliveMessage).max(3600000, sshKeepAliveMessage)),
    sshTunnelTimeoutMs: z.string().trim().regex(/^\d+$/, sshTimeoutMessage).transform(Number).pipe(z.number().min(0, sshTimeoutMessage).max(600000, sshTimeoutMessage)),
    sshLocalHost: z.string().trim().max(255, "O host local do encaminhamento SSH pode ter até 255 caracteres.").refine((value) => withoutControl(value), controlMessage("O host local do encaminhamento SSH")).transform(emptyToNull),
    sshLocalPort: z.string().trim().regex(/^\d+$/, sshLocalPortMessage).transform(Number).pipe(z.number().min(0, sshLocalPortMessage).max(65535, sshLocalPortMessage)),
    sshRemoteHost: z.string().trim().max(255, "O host remoto do encaminhamento SSH pode ter até 255 caracteres.").refine((value) => withoutControl(value), controlMessage("O host remoto do encaminhamento SSH")).transform(emptyToNull),
    sshRemotePort: z.string().trim().regex(/^\d+$/, sshRemotePortMessage).transform(Number).pipe(z.number().min(0, sshRemotePortMessage).max(65535, sshRemotePortMessage)),
    sshHostKeyFingerprint: z.string().trim().max(255, "A impressão digital do host pode ter até 255 caracteres.").refine((value) => withoutControl(value), controlMessage("A impressão digital do host")).transform(emptyToNull),
  })
  .superRefine((data, ctx) => {
    if (data.sshAuthMethod === "privateKey" && data.sshPrivateKeyPath === "") {
      ctx.addIssue({ code: "custom", path: ["sshPrivateKeyPath"], message: "Informe o caminho da chave privada SSH." });
    }
  })
  .transform(
    (data): ConnectionSshInput => ({
      host: data.sshHost,
      port: data.sshPort,
      userName: data.sshUserName,
      authMethod: data.sshAuthMethod,
      privateKeyPath: data.sshAuthMethod === "privateKey" ? emptyToNull(data.sshPrivateKeyPath) : null,
      secret: data.sshSecret,
      saveCredentials: data.sshSaveCredentials,
      ignoreHostVerification: data.sshIgnoreHostVerification,
      keepAliveIntervalMs: data.sshKeepAliveIntervalMs,
      tunnelTimeoutMs: data.sshTunnelTimeoutMs,
      localHost: data.sshLocalHost,
      localPort: data.sshLocalPort,
      remoteHost: data.sshRemoteHost,
      remotePort: data.sshRemotePort,
      hostKeyFingerprint: data.sshHostKeyFingerprint,
    }),
  );

const sslFormFieldsSchema = z
  .object({
    sslCaCertificatePath: z.string().trim().max(1024, "O caminho do certificado CA pode ter até 1.024 caracteres.").refine((value) => withoutControl(value), controlMessage("O caminho do certificado CA")).transform(emptyToNull),
    sslClientCertificatePath: z.string().trim().max(1024, "O caminho do certificado de cliente pode ter até 1.024 caracteres.").refine((value) => withoutControl(value), controlMessage("O caminho do certificado de cliente")).transform(emptyToNull),
    sslClientPrivateKeyPath: z.string().trim().max(1024, "O caminho da chave privada de cliente pode ter até 1.024 caracteres.").refine((value) => withoutControl(value), controlMessage("O caminho da chave privada de cliente")).transform(emptyToNull),
    sslMode: z.enum(sslModes, { error: "Escolha um modo SSL válido." }),
  })
  .transform(
    (data): ConnectionSslInput => ({
      caCertificatePath: data.sslCaCertificatePath,
      clientCertificatePath: data.sslClientCertificatePath,
      clientKeyPath: data.sslClientPrivateKeyPath,
      sslMode: data.sslMode,
    }),
  );

const proxyFormFieldsSchema = z
  .object({
    proxyHost: z.string().trim().min(1, "Informe o host do proxy.").max(255, "O host do proxy pode ter até 255 caracteres.").refine((value) => withoutControl(value), controlMessage("O host do proxy")),
    proxyPort: z.string().trim().regex(/^\d+$/, proxyPortMessage).transform(Number).pipe(z.number().min(1, proxyPortMessage).max(65535, proxyPortMessage)),
    proxyUserName: z.string().trim().max(128, "O usuário do proxy pode ter até 128 caracteres.").refine((value) => withoutControl(value), controlMessage("O usuário do proxy")).transform(emptyToNull),
    proxyPassword: z.string().max(1024, "A senha do proxy pode ter até 1.024 caracteres.").transform(emptyToNull),
    proxySavePassword: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .transform(
    (data): ConnectionProxyInput => ({
      host: data.proxyHost,
      port: data.proxyPort,
      userName: data.proxyUserName,
      password: data.proxyPassword,
      saveCredentials: data.proxySavePassword,
    }),
  );

/** Os nomes dos campos de SSH, SSL e Proxy no formulário, além das chaves `ssh`, `ssl` e `proxy` que a API pode devolver num 422. */
export const networkFieldNames = [
  "ssh",
  "ssl",
  "proxy",
  "sshHost",
  "sshPort",
  "sshUserName",
  "sshAuthMethod",
  "sshPrivateKeyPath",
  "sshSecret",
  "sshSaveCredentials",
  "sshIgnoreHostVerification",
  "sshKeepAliveIntervalMs",
  "sshTunnelTimeoutMs",
  "sshLocalHost",
  "sshLocalPort",
  "sshRemoteHost",
  "sshRemotePort",
  "sshHostKeyFingerprint",
  "sslCaCertificatePath",
  "sslClientCertificatePath",
  "sslClientPrivateKeyPath",
  "sslMode",
  "proxyHost",
  "proxyPort",
  "proxyUserName",
  "proxyPassword",
  "proxySavePassword",
] as const;

export type ConnectionNetworkInput = {
  ssh?: ConnectionSshInput | null;
  ssl?: ConnectionSslInput | null;
  proxy?: ConnectionProxyInput | null;
};

/**
 * Valida as abas opcionais de rede (SSH, SSL e Proxy) quando presentes no formulário (`sshEnabled`, `sslEnabled`, `proxyEnabled`).
 * Quando uma aba está desativada (`"false"`), devolve `null` para que o `PATCH` apague a configuração anterior; quando omitida (nos testes sem DOM), não inclui a chave.
 */
export function parseConnectionNetworkFields(raw: Record<string, unknown>): ParsedForm<ConnectionNetworkInput> {
  const errors: FieldErrors = {};
  const data: ConnectionNetworkInput = {};

  if (raw.sshEnabled === "true") {
    const parsed = sshFormFieldsSchema.safeParse(raw);
    if (parsed.success) data.ssh = parsed.data;
    else Object.assign(errors, firstFieldErrors(parsed.error));
  } else if (raw.sshEnabled === "false") {
    data.ssh = null;
  }

  if (raw.sslEnabled === "true") {
    const parsed = sslFormFieldsSchema.safeParse(raw);
    if (parsed.success) data.ssl = parsed.data;
    else Object.assign(errors, firstFieldErrors(parsed.error));
  } else if (raw.sslEnabled === "false") {
    data.ssl = null;
  }

  if (raw.proxyEnabled === "true") {
    const parsed = proxyFormFieldsSchema.safeParse(raw);
    if (parsed.success) data.proxy = parsed.data;
    else Object.assign(errors, firstFieldErrors(parsed.error));
  } else if (raw.proxyEnabled === "false") {
    data.proxy = null;
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, data };
}

/** Converte o túnel SSH gravado na entrada do `PATCH` que mantém a senha/frase secreta gravada (`secret: null`). */
export function sshInputOf(ssh: ConnectionSsh | null | undefined): ConnectionSshInput | null {
  if (!ssh) return null;
  return {
    host: ssh.host,
    port: ssh.port,
    userName: ssh.userName,
    authMethod: ssh.authMethod,
    privateKeyPath: ssh.privateKeyPath,
    secret: null,
    saveCredentials: ssh.saveCredentials,
    ignoreHostVerification: ssh.ignoreHostVerification,
    keepAliveIntervalMs: ssh.keepAliveIntervalMs,
    tunnelTimeoutMs: ssh.tunnelTimeoutMs,
    localHost: ssh.localHost,
    localPort: ssh.localPort,
    remoteHost: ssh.remoteHost,
    remotePort: ssh.remotePort,
    hostKeyFingerprint: ssh.hostKeyFingerprint,
  };
}

/** Converte o proxy gravado na entrada do `PATCH` que mantém a senha gravada (`password: null`). */
export function proxyInputOf(proxy: ConnectionProxy | null | undefined): ConnectionProxyInput | null {
  if (!proxy) return null;
  return {
    host: proxy.host,
    port: proxy.port,
    userName: proxy.userName,
    password: null,
    saveCredentials: proxy.saveCredentials,
  };
}

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
export type ConnectionInput = z.output<typeof editConnectionSchema> & ConnectionNetworkInput;

/** A senha do usuário no diálogo de revelar. Como no login, não se apara nem se impõe regra de criação. */
export const revealPasswordSchema = z.object({ password: z.string().min(1, validation.userPasswordRequired) });

/** RN-PASTA-001: o nome da pasta, de 1 a 60, sem caractere de controle nem de direção do texto (depois da normalização, que junta os espaços). */
const folderName = z
  .string()
  .trim()
  .min(1, validation.folderNameRequired)
  .max(60, validation.folderNameMax)
  .refine((value) => withoutControl(value, true), controlMessage(validation.fields.folderName));

/**
 * Criar uma pasta: o nome, onde ela fica (`""` é a raiz), a cor do ícone dela (RN-PASTA-007, no formato da cor do ambiente), o ambiente (RN-PASTA-005) e as
 * proteções (RN-PROT-001 e 002).
 */
export const createFolderSchema = z.object({ name: folderName, parentID: z.string().transform(emptyToNull), color: environmentFields.environmentColor, ...environmentFields, ...protectionFields, useInternalDescriptions: z.enum(["true", "false"]).transform((value) => value === "true").optional() });

/** "Editar pasta…" (RN-PASTA-006) pergunta o nome, a cor, o ambiente e as proteções. */
export const editFolderSchema = createFolderSchema.pick({ name: true, color: true, environmentName: true, environmentColor: true, confirmCommands: true, readOnly: true, useInternalDescriptions: true });

/** O "Renomear" da pasta (F2, RN-NAV-009) pergunta só o nome. */
export const renameFolderSchema = createFolderSchema.pick({ name: true });

export const moveFolderSchema = createFolderSchema.pick({ parentID: true });

/** O que a API recebe ao criar (`id` ausente) ou alterar uma pasta: o `PATCH` grava a pasta por inteiro, o ambiente, a cor e as proteções inclusive. */
export type FolderInput = z.output<typeof createFolderSchema>;
