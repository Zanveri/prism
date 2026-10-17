import { buildConnectionTree, type TreeNode } from "@/app/connections/_lib/connection-tree";
import type { Connection, Folder } from "@/app/connections/_lib/connections.schema";
import { readOnlyHintOf } from "@/app/connections/_lib/protections";
import type { Engine } from "@/components/ui";
import type { ApiError } from "@/lib/api/prism-api";

import { requestSource, type ChosenColumn } from "../data-export/export-request";
import type { ExportOrigin, SourceColumn } from "../data-export/export-source";
import { fieldPathOf, type copySteps, type WizardRefusal } from "../data-export/export-wizard";
import { folderPathOf } from "../tab-connection";
import { dataImportCopy } from "./data-import.copy";
import { commitEveryOfChoices } from "./import-load";
import type { CommitChoices } from "./import-choices";
import { entriesOf, type Targets } from "./import-mapping";
import { previewRefusalOf } from "./import-wizard";
import type { ColumnClass, CopyPreviewRequest, CopyStartRequest, ImportTarget, TableColumn } from "./imports.schema";

/**
 * O destino "Banco de dados" do "Exportar dados" (RN-IMPORT-022 a 025) sem React: as seis etapas, a tabela de destino (a conexão, o banco de dados, o
 * esquema e a tabela, com o que vem escolhido e a própria origem), a contagem obrigatória quando a origem e o destino estão no mesmo banco, as notas e os
 * pares desabilitados do mapeamento, os pedidos de `copies/preview` e `copies`, e onde cada recusa aparece. O componente só desenha e chama o que está aqui;
 * o mapeamento e a carga são os da importação (`import-mapping.ts` e `import-load.ts`).
 */

/** As seis etapas da cópia (`copySteps`, em `export-wizard.ts`, que as junta às da exportação). */
export type CopyStep = (typeof copySteps)[number];

const t = dataImportCopy.copyTarget;
const m = dataImportCopy.mapping;
const n = dataImportCopy.copyNotes;
const c = dataImportCopy.confirmation;

/** A tabela de destino escolhida: a conexão, o banco de dados (ausente, o da conexão), o esquema e a tabela (nulos até a escolha). */
export type CopyTarget = { connectionId: string; database?: string; schema: string | null; table: string | null };

/** O que vem escolhido ao abrir (RN-IMPORT-023): a conexão e o banco de dados da origem; o esquema e a tabela, quando as listas chegam (`matchName`). */
export function initialCopyTarget(source: { connectionId: string; database?: string }): CopyTarget {
  return { connectionId: source.connectionId, ...(source.database === undefined ? {} : { database: source.database }), schema: null, table: null };
}

/** Outra conexão: o banco de dados volta ao da origem, quando a conexão é a mesma, e ao padrão da conexão, quando não; o esquema e a tabela, a escolher. */
export function withConnection(source: { connectionId: string; database?: string }, connectionId: string): CopyTarget {
  return connectionId === source.connectionId ? initialCopyTarget(source) : { connectionId, schema: null, table: null };
}

/** O esquema e a tabela de mesmo nome que a origem procuram por estes nomes: a tabela e os Registros dizem; o resultado, só com a tabela única do alvo. */
export function wantedNames(origin: ExportOrigin): { schema: string; table: string } | null {
  if (origin.kind === "result") return origin.table === null ? null : { schema: origin.table.schema, table: origin.table.name };
  return { schema: origin.schema, table: origin.name };
}

/** O nome que vem escolhido numa lista: o igual letra por letra; sem ele, o igual sem diferenciar maiúsculas (o primeiro); senão, nenhum. */
export function matchName(names: readonly string[], wanted: string | undefined): string | null {
  if (wanted === undefined) return null;
  if (names.includes(wanted)) return wanted;
  const lower = wanted.toLowerCase();
  return names.find((name) => name.toLowerCase() === lower) ?? null;
}

/** Uma conexão da lista "Conexão": o caminho das pastas e, quando é somente leitura (pela opção dela ou de uma pasta acima), o motivo do cadeado. */
export type TargetConnection = { connection: Connection; path: string; readOnly: string | null };

/** Todas as conexões do cofre, na ordem do navegador (as pastas e, dentro de cada uma, as subpastas antes das conexões, em ordem de nome). */
export function targetConnections(connections: readonly Connection[], folders: readonly Folder[]): TargetConnection[] {
  const flat = (nodes: readonly TreeNode[]): Connection[] => nodes.flatMap((node) => (node.kind === "connection" ? [node.connection] : flat(node.children)));
  return flat(buildConnectionTree([...folders], [...connections])).map((connection) => ({ connection, path: folderPathOf(connection.folderID, folders), readOnly: readOnlyHintOf(connection.protections, folders) }));
}

/** O servidor, a porta e o banco de dados de uma conexão (ou de outro banco do servidor dela), como a API compara: o servidor sem diferenciar maiúsculas. */
export type ServerPlace = { host: string; port: number; database: string };

export const serverOf = (connection: Pick<Connection, "host" | "port" | "database">, database: string | undefined): ServerPlace => ({ host: connection.host, port: connection.port, database: database ?? connection.database });

export const sameServer = (a: ServerPlace, b: ServerPlace) => a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port && a.database === b.database;

/** A tabela de onde as linhas são lidas, quando a tela a sabe: a tabela pelo navegador e os Registros (no resultado, ela não é reconhecida pelo texto). */
export function sourceTableOf(origin: ExportOrigin): { schema: string; name: string } | null {
  if (origin.kind === "result") return null;
  if (origin.kind === "table" && origin.view) return null;
  return { schema: origin.schema, name: origin.name };
}

/**
 * A tabela de destino é a própria origem (RN-IMPORT-023): a mesma conexão, banco de dados, esquema e nome; ou outra conexão que aponta para o mesmo servidor,
 * porta e banco de dados, com o mesmo esquema e nome. O Prism não resolve nomes (`localhost` e `127.0.0.1` são servidores diferentes aqui).
 */
export function isSourceTable(
  source: { connection: Pick<Connection, "id" | "host" | "port" | "database">; database?: string; table: { schema: string; name: string } | null },
  target: { connection: Pick<Connection, "id" | "host" | "port" | "database">; database?: string; schema: string | null; table: string | null },
): boolean {
  if (source.table === null || target.schema === null || target.table === null) return false;
  if (source.table.schema !== target.schema || source.table.name !== target.table) return false;
  if (source.connection.id === target.connection.id && (source.database ?? null) === (target.database ?? null)) return true;
  return sameServer(serverOf(source.connection, source.database), serverOf(target.connection, target.database));
}

/**
 * RN-IMPORT-023, a origem que cresce: na cópia de Db2 ou de Informix em que a origem e o destino estão no mesmo servidor, porta e banco de dados, "Contar as
 * linhas antes" fica ligada e travada, com o motivo (a API conta nesse caso mesmo com `count: false`). Nulo quando a escolha é livre.
 */
export function countForcedReason(sourceEngine: Engine | undefined, source: ServerPlace | null, target: ServerPlace | null): string | null {
  if ((sourceEngine !== 2 && sourceEngine !== 3) || source === null || target === null) return null;
  return sameServer(source, target) ? t.countForced : null;
}

/**
 * O que segura a etapa "Tabela de destino" (o "Avançar" desabilitado, com o motivo à vista), ou `null`: a conexão que não existe mais ou é somente leitura,
 * a espera pelas listas (a conexão abrindo, os esquemas, as tabelas), a falha delas, a tabela por escolher e a tabela que é a própria origem.
 */
export function copyTargetProblem(input: {
  connection: TargetConnection | null;
  waiting: string | null;
  failure: string | null;
  target: CopyTarget;
  isSource: boolean;
}): string | null {
  if (input.connection === null) return t.chooseConnection;
  if (input.connection.readOnly !== null) return t.readOnly;
  if (input.failure !== null) return input.failure;
  if (input.waiting !== null) return input.waiting;
  if (input.target.schema === null) return t.chooseSchema;
  if (input.target.table === null) return t.chooseTable;
  if (input.isSource) return t.isSource;
  return null;
}

/** As tabelas do esquema que a busca acha: o pedaço no nome, sem diferenciar maiúsculas nem acentos. Em branco, todas. */
export function filterTables(names: readonly string[], query: string): string[] {
  const wanted = fold(query.trim());
  return wanted === "" ? [...names] : names.filter((name) => fold(name).includes(wanted));
}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// As classes da origem (RN-IMPORT-010 e 024), pelo tipo como a grade (ou o catálogo) o escreve e pelo `kind` da coluna do resultado.
const binaryType = /^(bytea|binary|varbinary|blob|byte)\b|\bfor\s+bit\s+data\b/i;
const booleanType = /^bool(ean)?\b/i;
const dateTimeType = /^(timestamp|timestamptz|smalldatetime)\b|^datetime\s+year\b/i;
const timeType = /^(time|timetz)\b|^datetime\s+hour\b/i;
const dateType = /^date$/i;
const numberType = /^(smallint|integer|int|int2|int4|int8|bigint|serial|serial8|bigserial|smallserial|numeric|decimal|dec|real|double|float|float4|float8|smallfloat|decfloat|money)\b/i;
const textType = /^(text|character|char|varchar|nchar|nvarchar|lvarchar|name|citext|clob|dbclob|graphic|vargraphic|long\s+varchar|"char")\b/i;

/** A classe de uma coluna da origem (as notas e os pares desabilitados são da tela, RN-IMPORT-024). O `money` do PostgreSQL é de "outra", como no destino. */
export function sourceClassOf(column: Pick<SourceColumn, "type"> & { kind?: string }, engine: Engine | undefined): ColumnClass {
  const type = column.type.trim();
  if (binaryType.test(type)) return "binary";
  if (booleanType.test(type)) return "boolean";
  if (timeType.test(type)) return "time";
  if (dateTimeType.test(type)) return "dateTime";
  if (dateType.test(type)) return "date";
  if (/^money\b/i.test(type)) return engine === 1 ? "other" : "number";
  if (numberType.test(type)) return "number";
  if (textType.test(type)) return "text";
  switch (column.kind) {
    case "binary":
      return "binary";
    case "boolean":
      return "boolean";
    case "number":
      return "number";
    case "datetime":
      return "dateTime";
    default:
      return "other";
  }
}

/** O par em que só um dos lados é binário não vale (RN-IMPORT-024): o binário só vai para uma coluna binária, e a coluna binária só recebe binário. */
export function copyPairBlocker(sourceClass: ColumnClass, column: Pick<TableColumn, "class">): string | null {
  return (sourceClass === "binary") !== (column.class === "binary") ? m.binaryReason : null;
}

/** A data e hora com fuso, e a hora com fuso, do PostgreSQL. */
const withZone = (type: string) => /\bwith\s+time\s+zone\b|^(timestamptz|timetz)\b/i.test(type.trim());

/**
 * As casas que um tipo diz que guarda, ou `null` quando não diz: a escala do decimal (`numeric(12,4)`, `DECIMAL(10,2)`, `MONEY(8,2)`), a fração da data e
 * hora (`timestamp(3)`; o `timestamp` do PostgreSQL e o `TIMESTAMP` do Db2 sem número, 6; o `DATETIME … TO FRACTION(5)` do Informix, 5, e sem número, 3; o
 * `… TO SECOND`, nenhuma). O decimal sem escala e o ponto flutuante não têm casas fixas.
 */
export function placesOf(type: string, cls: ColumnClass): number | null {
  const text = type.trim();
  if (cls === "number") {
    const decimal = /^(numeric|decimal|dec|money)\s*\(\s*\d+\s*,\s*(\d+)\s*\)/i.exec(text);
    return decimal === null ? null : Number(decimal[2]);
  }
  if (cls === "dateTime" || cls === "time") {
    const fraction = /\bfraction\s*(?:\(\s*(\d+)\s*\))?\s*$/i.exec(text);
    if (fraction !== null) return fraction[1] === undefined ? 3 : Number(fraction[1]);
    if (/^datetime\b.*\bto\s+second\s*$/i.test(text)) return 0;
    const precision = /^(timestamp|time|timestamptz|timetz)\s*\(\s*(\d+)\s*\)/i.exec(text);
    if (precision !== null) return Number(precision[2]);
    if (/^(timestamp|time|timestamptz|timetz)\b/i.test(text)) return 6;
    return null;
  }
  return null;
}

/**
 * As notas de um par da cópia (RN-IMPORT-024), na dica da escolha e para o leitor de tela, ou `null`: o `money` do PostgreSQL para o Db2 ou o Informix; as
 * classes diferentes (a data e hora para uma coluna só de data tem a frase dela); o fuso do PostgreSQL que fica para trás; as casas a mais (o Db2 e o
 * Informix recusam, o PostgreSQL arredonda); e as casas de fração do Db2 acima de 7, que o driver não entrega.
 */
export function copyPairNote(source: { type: string; class: ColumnClass; engine: Engine | undefined }, target: { column: Pick<TableColumn, "type" | "class">; engine: Engine | undefined }): string | null {
  const notes: string[] = [];
  const column = target.column;
  const pgMoney = source.engine === 1 && /^money\b/i.test(source.type.trim());
  if (pgMoney && (target.engine === 2 || target.engine === 3)) return n.money;

  if (source.class === "dateTime" && column.class === "date") notes.push(n.timeToDate);
  else if (source.class !== column.class && !(source.class === "other" && column.class === "other")) notes.push(n.differentClass(n.classes[source.class] ?? source.class, n.classes[column.class] ?? column.class));

  if (source.engine === 1 && withZone(source.type) && (source.class === "dateTime" || source.class === "time") && (column.class === "dateTime" || column.class === "time") && !(target.engine === 1 && withZone(column.type))) notes.push(n.zoneDropped);

  if (source.class === column.class && (source.class === "number" || source.class === "dateTime" || source.class === "time")) {
    const from = placesOf(source.type, source.class);
    const to = placesOf(column.type, column.class);
    if (from !== null && to !== null && from > to) notes.push(target.engine === 1 ? n.postgresRounds(from, to) : n.fewerPlaces(from, to));
  }

  if (source.engine === 2 && (source.class === "dateTime" || source.class === "time")) {
    const fraction = placesOf(source.type, source.class);
    if (fraction !== null && fraction > 7) notes.push(n.db2Fraction);
  }
  return notes.length === 0 ? null : notes.join(" ");
}

/** O destino como a API o lê: a conexão, o banco de dados (quando não é o da conexão), o esquema e a tabela. */
export function copyTargetOf(target: CopyTarget): ImportTarget | null {
  if (target.schema === null || target.table === null) return null;
  return { connectionID: target.connectionId, ...(target.database === undefined ? {} : { database: target.database }), schema: target.schema, table: target.table };
}

export type CopySourceDraft = { connectionId: string; database?: string; origin: ExportOrigin; columns: readonly ChosenColumn[] };

/**
 * A prévia da cópia (`copies/preview`): a origem como a da exportação, as colunas marcadas na Extração e o destino. O mapeamento vai pela posição da coluna
 * na lista `columns` (a partir de 0); sem ele (`targets` nulo, ou nenhuma mapeada), a API devolve o sugerido.
 */
export function copyPreviewRequest(draft: CopySourceDraft, target: ImportTarget, targets: Targets | null): CopyPreviewRequest {
  const mapping = targets === null ? [] : entriesOf(targets);
  return {
    source: requestSource(draft.connectionId, draft.database, draft.origin),
    columns: draft.columns.map(({ position, name }) => ({ position, name })),
    target,
    ...(mapping.length === 0 ? {} : { mapping }),
  };
}

/** O começo da cópia (`copies`), com a contagem (ligada quando a etapa a trava) e a carga (sem a conferência, que é do arquivo). */
export function copyStartRequest(draft: CopySourceDraft, target: ImportTarget, targets: Targets, load: { empty: boolean; commit: CommitChoices }, count: boolean, windowId: number): CopyStartRequest {
  return {
    source: requestSource(draft.connectionId, draft.database, draft.origin),
    columns: draft.columns.map(({ position, name }) => ({ position, name })),
    count,
    target,
    mapping: entriesOf(targets),
    load: { empty: load.empty, commitEvery: commitEveryOfChoices(load.commit) },
    windowID: windowId,
  };
}

/** Os campos que o assistente desenha com um campo de texto, onde a recusa de campo aparece; a de outro campo vai ao alto da Confirmação. */
const copyFieldsShown: ReadonlySet<string> = new Set(["columns", "load.commitEvery"]);

/** A etapa de um campo da API: as colunas na Extração, o destino na Tabela de destino, o mapeamento no Mapeamento, a carga na Carga; o resto, na Confirmação. */
export function stepOfCopyField(field: string | null): CopyStep {
  if (field === null) return "confirmation";
  if (field === "columns" || field.startsWith("columns[") || field.startsWith("columns.")) return "extraction";
  if (field === "load" || field.startsWith("load.")) return "load";
  return "confirmation";
}

/** A conexão sem usuário ou sem senha diz qual é (RN-IMPORT-025): a de origem ou a de destino, pelo campo da recusa. */
function credentialRefusals(fields: ReadonlySet<string | null>): WizardRefusal[] {
  const refusals: WizardRefusal[] = [];
  if (fields.has("source.userName")) refusals.push({ field: null, message: c.sourceUserNameMissing });
  if (fields.has("source.password")) refusals.push({ field: null, message: c.sourcePasswordMissing });
  if (fields.has("target.userName")) refusals.push({ field: null, message: c.targetUserNameMissing });
  if (fields.has("target.password") || refusals.length === 0) refusals.push({ field: null, message: c.targetPasswordMissing });
  return refusals;
}

/**
 * Onde cada recusa do começo da cópia aparece (RN-IMPORT-025, como na exportação): a de campo no campo que o assistente desenha, ou no alto da Confirmação;
 * a conexão sem usuário ou sem senha, a frase de cada lado; o limite, a conexão que não existe mais e o somente leitura do destino, as frases da tela; o
 * resto (a tabela ocupada, a própria origem, as recusas da origem da exportação), a frase da API.
 */
export function copyRefusalsOf(error: ApiError): WizardRefusal[] {
  const fieldErrors = Object.entries(error.errors ?? {}).flatMap(([key, messages]) => messages.map((message) => ({ field: fieldPathOf(key), message })));
  switch (error.code) {
    case "IMPORT_OPTIONS_INVALID":
    case "IMPORT_MAPPING_INVALID":
      return fieldErrors.length === 0 ? [{ field: null, message: error.detail ?? error.title }] : fieldErrors.map((refusal) => (copyFieldsShown.has(refusal.field) ? refusal : { ...refusal, field: null }));
    case "CONNECTION_CREDENTIALS_MISSING":
      return credentialRefusals(new Set(fieldErrors.map((refusal) => refusal.field)));
    case "TRANSFER_LIMIT_REACHED":
      return [{ field: null, message: c.limitReached }];
    case "CONNECTION_NOT_FOUND":
      return [{ field: null, message: c.connectionMissing }];
    case "CONNECTION_READ_ONLY":
      return [{ field: null, message: t.readOnlyRefused }];
    case "DRIVER_NOT_INSTALLED": {
      const driverID = typeof error.extensions.driverID === "string" ? error.extensions.driverID : undefined;
      return [{ field: null, message: error.detail ?? error.title, ...(driverID === undefined ? {} : { driverID }) }];
    }
    default:
      return [{ field: null, message: error.detail ?? error.title }];
  }
}

/** A recusa da prévia da cópia, na etapa Mapeamento (RN-IMPORT-024): as da importação, com as frases da cópia para o somente leitura e as credenciais. */
export function copyPreviewRefusalOf(error: ApiError, place: { schema: string; table: string }): { message: string; retry: boolean; driverID?: string } {
  if (error.code === "CONNECTION_READ_ONLY") return { message: t.readOnlyRefused, retry: false };
  if (error.code === "CONNECTION_CREDENTIALS_MISSING") return { message: copyRefusalsOf(error).map((refusal) => refusal.message).join(" "), retry: false };
  return previewRefusalOf(error, place);
}

/**
 * O nome da tabela de destino aparece no comando da origem (RN-IMPORT-023 e 025): a palavra inteira, sem diferenciar maiúsculas, também entre aspas. A
 * Confirmação avisa; a tela não reconhece o comando sobre a tabela pelo texto além disso.
 */
export function readsTable(sql: string, table: string): boolean {
  if (table === "") return false;
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_$])${escaped}($|[^\\p{L}\\p{N}_$])`, "iu").test(sql);
}

/** O comando da origem, quando a origem é um comando (os Registros e o resultado); a tabela pelo navegador não tem. */
export const originSql = (origin: ExportOrigin): string | null => (origin.kind === "table" ? null : origin.sql);
