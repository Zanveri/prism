import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { connectionsQuery, foldersQuery } from "@/app/connections/_lib/connections.service";
import { environmentLookup } from "@/app/connections/_lib/environment";
import type { Engine } from "@/components/ui";
import { throughMutationCache } from "@/lib/api/mutation-cache";
import { allowRefusal, ApiRequestError, type ApiResult } from "@/lib/api/prism-api";

import { dataExportCopy } from "../../_lib/data-export/data-export.copy";
import type { ChosenColumn } from "../../_lib/data-export/export-request";
import type { ExportSource, SourceColumn } from "../../_lib/data-export/export-source";
import { copySteps, type WizardStep } from "../../_lib/data-export/export-wizard";
import {
  copyPairBlocker,
  copyPairNote,
  copyPreviewRefusalOf,
  copyPreviewRequest,
  copyTargetOf,
  copyTargetProblem,
  countForcedReason,
  initialCopyTarget,
  isSourceTable,
  matchName,
  serverOf,
  sourceClassOf,
  sourceTableOf,
  targetConnections,
  wantedNames,
  withConnection,
  type CopyTarget,
} from "../../_lib/data-import/copy-wizard";
import { dataImportCopy } from "../../_lib/data-import/data-import.copy";
import { autoTargets, carryTargets, chooseTarget, movedText, noneMappedProblem, targetsOf, type Targets } from "../../_lib/data-import/import-mapping";
import type { CopyPreview, ImportTable, TableColumn } from "../../_lib/data-import/imports.schema";
import { copyPreviewRefusals, previewCopy } from "../../_lib/data-import/imports.service";
import { databaseSessionQuery, errorCodeOf, errorDriverIdOf, isSessionLost, reopenDatabaseSession, treeQuery } from "../../_lib/database-sessions.service";
import { inDatabase } from "../../_lib/navigator-model";
import { databaseChoices, databaseOfValue } from "../../_lib/tab-database";

const t = dataImportCopy.copyTarget;
const m = dataImportCopy.mapping;

/** A prévia da cópia (`copies/preview`): a tabela de destino que ela leu, pelo pedido (`key`) de que veio. */
type PreviewState =
  | { status: "idle" }
  | { status: "loading"; key: string; table: ImportTable | null }
  | { status: "done"; key: string; table: ImportTable }
  | { status: "refused"; key: string; message: string; retry: boolean; driverID?: string };

/** As listas da tabela de destino ficam caladas no aviso central: a falha aparece na etapa (RN-IMPORT-023). */
const silent = { meta: { silent: true } } as const;

/** A frase de uma falha de lista: a conexão sem usuário ou sem senha, a do destino; o resto, a mensagem do banco como veio. */
function failureMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return dataExportCopy.extraction.loadFailed;
  if (error.error.code === "CONNECTION_CREDENTIALS_MISSING") {
    const fields = Object.keys(error.error.errors ?? {}).map((key) => key.toLowerCase());
    return fields.some((field) => field.endsWith("username")) ? t.userNameMissing : t.passwordMissing;
  }
  return error.error.detail ?? error.error.title;
}

type CopyWizardInput = {
  source: ExportSource;
  sourceEngine: Engine | undefined;
  /** As colunas da origem (a grade, ou o catálogo na tabela pelo navegador) e as marcadas na Extração. */
  sourceColumns: readonly SourceColumn[] | null;
  chosen: readonly ChosenColumn[];
  /** O destino "Banco de dados" está escolhido, e a etapa: as listas só são pedidas da "Tabela de destino" em diante. */
  active: boolean;
  step: WizardStep;
};

/**
 * O destino "Banco de dados" do "Exportar dados" (RN-IMPORT-022 a 025), as partes com estado: a tabela de destino (as listas da conexão escolhida, na sessão
 * que a árvore abre, o que vem escolhido e a própria origem), o mapeamento (a prévia da cópia e as escolhas), o esvaziamento e a caixa da Confirmação. As
 * decisões são do `copy-wizard.ts`, e o "Copiar linhas" é do `ExportWizard`, que tem a origem e a pergunta das proteções.
 */
export function useCopyWizard({ source, sourceEngine, sourceColumns, chosen, active, step }: CopyWizardInput) {
  const queryClient = useQueryClient();
  const connections = useQuery(connectionsQuery);
  const folders = useQuery(foldersQuery);
  const list = useMemo(() => {
    const lookup = environmentLookup(folders.data ?? []);
    return targetConnections(connections.data ?? [], folders.data ?? []).map((entry) => ({ ...entry, environment: lookup.connection(entry.connection) }));
  }, [connections.data, folders.data]);

  const [target, setTarget] = useState<CopyTarget>(() => initialCopyTarget(source));
  /** O esquema e a tabela de mesmo nome que a origem vêm escolhidos uma vez, quando a lista chega; a escolha da pessoa vale dali em diante. */
  const [auto, setAuto] = useState({ schema: true, table: true });
  const [search, setSearch] = useState("");

  const entry = list.find((candidate) => candidate.connection.id === target.connectionId) ?? null;
  const targetEngine = entry?.connection.engine;
  const sourceConnection = connections.data?.find((candidate) => candidate.id === source.connectionId) ?? null;
  const reachable = active && copySteps.indexOf(step as (typeof copySteps)[number]) >= copySteps.indexOf("target") && entry !== null && entry.readOnly === null;

  // As listas da árvore (RN-IMPORT-023): a sessão daquele banco de dados, a que a árvore abre; escolher uma conexão desconectada a conecta, e o navegador
  // passa a mostrá-la conectada (a sessão está no mesmo cache).
  const session = useQuery({ ...databaseSessionQuery(target.connectionId, target.database), enabled: reachable, ...silent });
  const databases = useQuery({ ...treeQuery({ type: "connection", connectionId: target.connectionId }, queryClient, reachable && targetEngine !== 2), ...silent });
  const schemas = useQuery({ ...treeQuery({ type: "database", connectionId: target.connectionId, ...inDatabase(target.database) }, queryClient, reachable && session.isSuccess), ...silent });
  const tables = useQuery({
    ...treeQuery({ type: "objects", connectionId: target.connectionId, ...inDatabase(target.database), schema: target.schema ?? "", objects: "tables" }, queryClient, reachable && session.isSuccess && target.schema !== null),
    ...silent,
  });
  const schemaNames = useMemo(() => schemas.data?.map((node) => node.label) ?? null, [schemas.data]);
  const tableNames = useMemo(() => (target.schema === null ? null : (tables.data?.filter((node) => node.kind === "table").map((node) => node.label) ?? null)), [tables.data, target.schema]);

  // O que vem escolhido: o esquema e a tabela de mesmo nome que a origem, quando existem (ajuste durante a renderização, quando a lista chega).
  const wanted = wantedNames(source.origin);
  if (auto.schema && schemaNames !== null && target.schema === null) {
    setAuto({ ...auto, schema: false });
    const schema = matchName(schemaNames, wanted?.schema);
    if (schema !== null) setTarget({ ...target, schema });
  }
  if (auto.table && tableNames !== null && target.table === null && target.schema !== null) {
    setAuto({ ...auto, table: false });
    const table = matchName(tableNames, wanted?.table);
    if (table !== null) setTarget({ ...target, table });
  }

  const listFailure = session.isError ? session.error : schemas.isError ? schemas.error : tables.isError ? tables.error : null;
  const failure =
    listFailure === null || !reachable
      ? null
      : {
          message: failureMessage(listFailure),
          retry: errorCodeOf(listFailure) === "CONNECTION_CREDENTIALS_MISSING" ? null : () => void retryLists(),
          ...(errorDriverIdOf(listFailure) === undefined ? {} : { driverID: errorDriverIdOf(listFailure) }),
        };
  const waiting = !reachable || failure !== null ? null : session.data === undefined ? t.connecting(entry?.connection.name ?? "") : schemaNames === null ? t.loadingSchemas : target.schema !== null && tableNames === null ? t.loadingTables : null;

  /** "Tentar de novo": a sessão que caiu abre outra no lugar; o resto busca de novo. */
  async function retryLists() {
    if (session.isError) return void session.refetch();
    if (listFailure !== null && isSessionLost(listFailure)) return void reopenDatabaseSession(queryClient, target.connectionId, target.database);
    if (schemas.isError) return void schemas.refetch();
    if (tables.isError) return void tables.refetch();
  }

  const isSource =
    sourceConnection !== null && entry !== null && isSourceTable({ connection: sourceConnection, database: source.database, table: sourceTableOf(source.origin) }, { connection: entry.connection, database: target.database, schema: target.schema, table: target.table });
  const targetProblem = copyTargetProblem({ connection: entry, waiting, failure: failure?.message ?? null, target, isSource });

  // RN-IMPORT-023: a origem que cresce. A contagem é obrigatória na cópia de Db2 ou de Informix com a origem e o destino no mesmo banco.
  const countForced = active && sourceConnection !== null && entry !== null ? countForcedReason(sourceEngine, serverOf(sourceConnection, source.database), serverOf(entry.connection, target.database)) : null;

  const databaseList = databaseChoices({ nodes: databases.data, current: target.database, connectionDatabase: entry?.connection.database, engine: targetEngine });

  function chooseConnection(connectionId: string) {
    if (connectionId === target.connectionId) return;
    setTarget(withConnection(source, connectionId));
    setAuto({ schema: true, table: true });
    setSearch("");
  }

  function chooseDatabase(value: string) {
    const database = databaseOfValue(value);
    if (database === target.database) return;
    setTarget({ connectionId: target.connectionId, ...inDatabase(database), schema: null, table: null });
    setAuto({ schema: true, table: true });
    setSearch("");
  }

  function chooseSchema(schema: string) {
    if (schema === target.schema) return;
    setTarget({ ...target, schema, table: null });
    setAuto({ schema: false, table: true });
    setSearch("");
  }

  function chooseTable(table: string) {
    setTarget({ ...target, table });
    setAuto({ schema: false, table: false });
  }

  // O mapeamento (RN-IMPORT-024): a tabela de destino vem da prévia da cópia; as escolhas são da tela, uma por coluna marcada na Extração.
  const apiTarget = copyTargetOf(target);
  const names = useMemo(() => chosen.map((column) => column.name), [chosen]);
  const previewKey = apiTarget === null ? null : JSON.stringify([apiTarget, chosen]);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [targets, setTargets] = useState<(string | null)[] | null>(null);
  /** As colunas e a tabela a que o mapeamento se refere: voltar à Extração e marcar outras colunas leva as escolhas pelo nome. */
  const mappedFor = useRef<{ names: readonly string[]; target: string } | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const generation = useRef(0);

  const classes = useMemo(() => chosen.map((column) => sourceClassOf(sourceColumns?.[column.position] ?? { type: "" }, sourceEngine)), [chosen, sourceColumns, sourceEngine]);
  const pairBlocker = (index: number, column: TableColumn) => copyPairBlocker(classes[index] ?? "other", column);
  const pairNote = (index: number, column: TableColumn) =>
    copyPairNote({ type: sourceColumns?.[chosen[index]?.position ?? -1]?.type ?? "", class: classes[index] ?? "other", engine: sourceEngine }, { column, engine: targetEngine });

  const table = preview.status === "done" || (preview.status === "loading" && preview.table !== null) ? preview.table : null;
  const ambiguous = useMemo(() => (table === null ? new Set<number>() : autoTargets(names, table, { byName: true, blocked: (index, column) => copyPairBlocker(classes[index] ?? "other", column) }).ambiguous), [table, names, classes]);

  /** A prévia, ao entrar no Mapeamento com outra tabela ou outras colunas (ou no "Tentar de novo"). A resposta de um pedido de antes não muda nada. */
  async function loadPreview(force = false) {
    if (previewKey === null || apiTarget === null) return;
    if (!force && preview.status !== "idle" && preview.key === previewKey && preview.status !== "refused") return;
    const run = ++generation.current;
    const targetKey = JSON.stringify(apiTarget);
    const before = mappedFor.current;
    // A mesma tabela com outras colunas: as escolhas seguem pelo nome; outra tabela: o mapeamento sugerido.
    const carried = before !== null && before.target === targetKey && targets !== null ? carryTargets(before.names, names, targets, true) : null;
    setPreview({ status: "loading", key: previewKey, table: carried === null ? null : table });
    setMoved(null);
    let result: ApiResult<CopyPreview>;
    try {
      // Sem o mapeamento: a API devolve a tabela e o sugerido, e o que a pessoa já tinha escolhido segue pelo nome (nunca uma recusa do mapeamento de antes).
      const body = copyPreviewRequest({ connectionId: source.connectionId, ...inDatabase(source.database), origin: source.origin, columns: chosen }, apiTarget, null);
      result = await throughMutationCache(queryClient, async () => allowRefusal(await previewCopy(body), ...copyPreviewRefusals));
    } catch {
      if (run === generation.current) setPreview({ status: "refused", key: previewKey, message: dataExportCopy.extraction.loadFailed, retry: true });
      return;
    }
    if (run !== generation.current) return;
    if (!result.ok) {
      const refusal = copyPreviewRefusalOf(result.error, { schema: apiTarget.schema, table: apiTarget.table });
      setPreview({ status: "refused", key: previewKey, message: refusal.message, retry: refusal.retry, ...(refusal.driverID === undefined ? {} : { driverID: refusal.driverID }) });
      return;
    }
    const read = result.data.table;
    const columns = new Map(read.columns.map((column) => [column.name, column]));
    // O sugerido pela API (ou o que veio da escolha de antes), sem o par que a tela sabe que não vale (o binário de um lado só) nem a coluna que sumiu.
    const suggested = carried ?? targetsOf(result.data.mapping, names.length);
    const allowed = suggested.map((name, index) => {
      const column = name === null ? undefined : columns.get(name);
      return column === undefined || copyPairBlocker(classes[index] ?? "other", column) !== null || column.generated === "always" || !column.importable ? null : name;
    });
    mappedFor.current = { names, target: targetKey };
    setTargets(allowed);
    setPreview({ status: "done", key: previewKey, table: read });
  }

  const mappingProblem = (() => {
    if (apiTarget === null) return t.chooseTable;
    if (preview.status === "refused") return preview.message;
    if (preview.status !== "done" || targets === null) return m.loading(apiTarget.schema, apiTarget.table);
    return noneMappedProblem(targets);
  })();

  const [empty, setEmptyState] = useState(false);
  const [understood, setUnderstood] = useState(false);

  return {
    connections: list,
    entry,
    target,
    targetEngine,
    apiTarget,
    search,
    setSearch,
    schemaNames,
    tableNames,
    databaseList,
    waiting,
    failure,
    isSource,
    targetProblem,
    countForced,
    chooseConnection,
    chooseDatabase,
    chooseSchema,
    chooseTable,
    // O mapeamento.
    names,
    sourceTypes: chosen.map((column) => sourceColumns?.[column.position]?.type ?? ""),
    table,
    targets,
    ambiguous,
    moved,
    preview,
    mappingProblem,
    loadPreview,
    pairBlocker,
    pairNote,
    setTarget(index: number, value: string | null) {
      if (targets === null) return;
      const next = chooseTarget(targets, index, value);
      setTargets(next.targets);
      setMoved(next.moved === null ? null : movedText(next.moved, names));
    },
    mapByName() {
      if (table === null) return;
      setTargets(autoTargets(names, table, { byName: true, blocked: pairBlocker }).targets);
      setMoved(null);
    },
    mapNone() {
      if (targets === null) return;
      setTargets(targets.map(() => null));
      setMoved(null);
    },
    // A carga e a Confirmação.
    empty,
    setEmpty(value: boolean) {
      setEmptyState(value);
      setUnderstood(false);
    },
    understood,
    setUnderstood,
    /** A Confirmação desmarca a caixa do esvaziamento a cada abertura (RN-IMPORT-013 e 025). */
    resetUnderstood: () => setUnderstood(false),
    targetsNow: (): Targets => targets ?? [],
  };
}

export type CopyWizard = ReturnType<typeof useCopyWizard>;
