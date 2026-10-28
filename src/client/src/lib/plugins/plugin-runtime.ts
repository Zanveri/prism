import type { Column } from "@/app/workbench/_lib/database-sessions.schema";
import { executeQuery, type QueryParam } from "@/app/workbench/_lib/query.service";
import type { Engine } from "@/components/ui";

import type { PluginBundle } from "./plugins.schema";

export type PluginQueryResult = {
  columns: string[];
  rows: Array<Record<string, string | null>>;
  rawRows: Array<Array<string | null>>;
};

export type AttributeDetailField = {
  label: string;
  value: string | null;
};

export type TableStructureExtraColumn = {
  key: string;
  label: string;
  monospace?: boolean;
};

export type TableStructureEnrichment = {
  tableDescription?: string | null;
  extraColumns?: TableStructureExtraColumn[];
  columnValues?: Record<string, Record<string, string | null>>;
  attributeDetails?: Record<string, AttributeDetailField[]>;
};

export type TableStructureEnricherContext = {
  sessionId: string;
  connectionId: string;
  engine: Engine | undefined;
  database?: string;
  schema: string;
  table: string;
  columns: Column[];
  useInternalDescriptions?: boolean;
};

export type TableStructureEnricher = {
  id?: string;
  engines?: ReadonlyArray<string | number>;
  enrich: (
    context: TableStructureEnricherContext,
  ) => Promise<TableStructureEnrichment | null | undefined> | TableStructureEnrichment | null | undefined;
};

export type PrismPluginApi = {
  db: {
    query: (sessionId: string, sql: string, params?: readonly QueryParam[]) => Promise<PluginQueryResult>;
  };
  ui: {
    registerTableStructureEnricher: (enricher: TableStructureEnricher) => () => void;
  };
};

export type PluginQueryExecutor = (
  sessionId: string,
  sql: string,
  params?: readonly QueryParam[],
) => Promise<PluginQueryResult>;

const ENGINE_NAMES: Record<Engine, readonly string[]> = {
  1: ["1", "postgres", "postgresql"],
  2: ["2", "db2"],
  3: ["3", "informix"],
};

const sessionQueues = new Map<string, Promise<unknown>>();

function enqueueSessionTask<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const prev = sessionQueues.get(sessionId) ?? Promise.resolve();
  const next = prev.then(task, task);
  sessionQueues.set(
    sessionId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const defaultPluginQueryExecutor: PluginQueryExecutor = async (sessionId, sql, params = []) =>
  enqueueSessionTask(sessionId, async () => {
    const normalizedParams: QueryParam[] = params.map((param) => ({
      value: String(param?.value ?? ""),
      type: param?.type ?? "text",
    }));

    let result = await executeQuery(sessionId, sql, undefined, [], normalizedParams);
    for (let attempt = 0; !result.ok && result.error.code === "SESSION_BUSY" && attempt < 25; attempt++) {
      await waitMs(40);
      result = await executeQuery(sessionId, sql, undefined, [], normalizedParams);
    }

    if (!result.ok) {
      throw new Error(result.error.detail || result.error.title || "Falha ao executar consulta do plugin.");
    }

    if (result.data.kind !== "rows") {
      return { columns: [], rows: [], rawRows: [] };
    }

    const columns = result.data.columns.map((col) => col.name);
    const rawRows = result.data.rows;
    const rows = rawRows.map((row) => {
      const record: Record<string, string | null> = {};
      for (let i = 0; i < columns.length; i++) {
        const colName = columns[i]!;
        const cell = row[i] ?? null;
        record[colName] = cell;
        record[colName.toLowerCase()] = cell;
      }
      return record;
    });

    return { columns, rows, rawRows };
  });

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

/**
 * Consulta a descrição interna de uma tabela (`diaabr`) no mesmo servidor e banco da sessão ativa:
 * ```sql
 * select abrdescr
 *   from diaabr
 *  where abrtip = 'T'
 *    and abrabrev = 'pcaord';
 * ```
 */
export async function fetchInternalTableDescription(
  sessionId: string,
  table: string,
  queryExecutor: PluginQueryExecutor = defaultPluginQueryExecutor,
): Promise<string | null> {
  const tableLower = escapeSqlLiteral(String(table ?? "").trim().toLowerCase());
  if (!tableLower) return null;

  const sql = `select abrdescr
  from diaabr
 where abrtip = 'T'
   and abrabrev = '${tableLower}'`;

  try {
    const res = await queryExecutor(sessionId, sql);
    const raw = res.rows[0]?.abrdescr ?? res.rawRows[0]?.[0] ?? null;
    const trimmed = raw !== null && raw !== undefined ? String(raw).trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Consulta a descrição interna de um atributo (`diadii`) no mesmo servidor e banco da sessão ativa:
 * ```sql
 * select diidescr
 *   from diadii
 *  where diccod = 'ordemb'
 *    and diiidioma = 'P';
 * ```
 */
export async function fetchInternalColumnDescription(
  sessionId: string,
  columnName: string,
  queryExecutor: PluginQueryExecutor = defaultPluginQueryExecutor,
): Promise<string | null> {
  const colLower = escapeSqlLiteral(String(columnName ?? "").trim().toLowerCase());
  if (!colLower) return null;

  const sql = `select diidescr
  from diadii
 where diccod = '${colLower}'
   and diiidioma = 'P'`;

  try {
    const res = await queryExecutor(sessionId, sql);
    const raw = res.rows[0]?.diidescr ?? res.rawRows[0]?.[0] ?? null;
    const trimmed = raw !== null && raw !== undefined ? String(raw).trim() : "";
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Executa o enriquecimento de descrições internas (`diaabr` para a tabela e `diadii` para cada coluna)
 * na mesma sessão do servidor e banco onde a tabela está aberta.
 */
export async function enrichWithInternalDescriptions(
  context: TableStructureEnricherContext,
  queryExecutor: PluginQueryExecutor = defaultPluginQueryExecutor,
  cachedTableDescription?: string | null,
): Promise<TableStructureEnrichment> {
  const tableDescription =
    cachedTableDescription !== undefined
      ? cachedTableDescription
      : await fetchInternalTableDescription(context.sessionId, context.table, queryExecutor);

  const columnValues: Record<string, Record<string, string | null>> = {};
  for (const col of context.columns) {
    const colKey = String(col.name ?? "").trim().toLowerCase();
    if (!colKey) continue;
    const descr = await fetchInternalColumnDescription(context.sessionId, colKey, queryExecutor);
    columnValues[colKey] = { description: descr };
  }

  return {
    tableDescription,
    extraColumns: [{ key: "description", label: "Descrição" }],
    columnValues,
  };
}

function matchesEngine(allowed: ReadonlyArray<string | number> | undefined, engine: Engine | undefined): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (engine === undefined) return false;
  const known = ENGINE_NAMES[engine] ?? [];
  return allowed.some((item) => {
    const normalized = String(item).trim().toLowerCase();
    return known.includes(normalized);
  });
}

export function loadEnrichersFromBundle(
  bundle: PluginBundle,
  queryExecutor: PluginQueryExecutor = defaultPluginQueryExecutor,
): TableStructureEnricher[] {
  const registered: TableStructureEnricher[] = [];

  const prism: PrismPluginApi = {
    db: {
      query: (sessionId, sql, params) => queryExecutor(sessionId, sql, params),
    },
    ui: {
      registerTableStructureEnricher: (enricher) => {
        if (enricher && typeof enricher.enrich === "function") {
          registered.push(enricher);
        }
        return () => {
          const index = registered.indexOf(enricher);
          if (index >= 0) registered.splice(index, 1);
        };
      },
    },
  };

  try {
    const moduleObj: { exports: unknown } = { exports: {} };
    const factory = new Function("prism", "module", "exports", bundle.code) as (
      prismApi: PrismPluginApi,
      mod: { exports: unknown },
      exp: unknown,
    ) => unknown;

    const returned = factory(prism, moduleObj, moduleObj.exports);
    const exported = moduleObj.exports ?? returned;

    if (typeof exported === "function") {
      (exported as (api: PrismPluginApi) => void)(prism);
    } else if (
      exported &&
      typeof exported === "object" &&
      "activate" in exported &&
      typeof (exported as { activate: unknown }).activate === "function"
    ) {
      (exported as { activate: (api: PrismPluginApi) => void }).activate(prism);
    }
  } catch {
    // Isola falhas de sintaxe ou inicialização de plugins de terceiros para nunca interromper o Prism.
  }

  return registered;
}

export async function runTableStructureEnrichers(
  bundles: readonly PluginBundle[],
  context: TableStructureEnricherContext,
  queryExecutor: PluginQueryExecutor = defaultPluginQueryExecutor,
): Promise<TableStructureEnrichment | null> {
  if (bundles.length === 0 && !context.useInternalDescriptions) return null;

  let tableDescription: string | null = null;
  const extraColumns: TableStructureExtraColumn[] = [];
  const columnValues: Record<string, Record<string, string | null>> = {};
  const attributeDetails: Record<string, AttributeDetailField[]> = {};

  for (const bundle of bundles) {
    if (!matchesEngine(bundle.engines, context.engine)) continue;

    const enrichers = loadEnrichersFromBundle(bundle, queryExecutor);
    for (const enricher of enrichers) {
      if (!matchesEngine(enricher.engines, context.engine)) continue;

      try {
        const result = await enricher.enrich(context);
        if (!result) continue;

        if (result.tableDescription && !tableDescription) {
          tableDescription = result.tableDescription;
        }

        if (result.extraColumns) {
          for (const col of result.extraColumns) {
            if (!extraColumns.some((existing) => existing.key === col.key)) {
              extraColumns.push(col);
            }
          }
        }

        if (result.columnValues) {
          for (const [colName, values] of Object.entries(result.columnValues)) {
            const key = colName.toLowerCase();
            columnValues[key] = { ...(columnValues[key] ?? {}), ...values };
          }
        }

        if (result.attributeDetails) {
          for (const [colName, fields] of Object.entries(result.attributeDetails)) {
            const key = colName.toLowerCase();
            attributeDetails[key] = fields;
          }
        }
      } catch {
        // Falha na consulta ou no código de um plugin de terceiro não interrompe a exibição da estrutura.
      }
    }
  }

  if (context.useInternalDescriptions && !extraColumns.some((col) => col.key === "description")) {
    const internal = await enrichWithInternalDescriptions(
      context,
      queryExecutor,
      tableDescription !== null ? tableDescription : undefined,
    );
    if (internal.tableDescription && !tableDescription) {
      tableDescription = internal.tableDescription;
    }
    for (const col of internal.extraColumns ?? []) {
      if (!extraColumns.some((existing) => existing.key === col.key)) {
        extraColumns.unshift(col);
      }
    }
    if (internal.columnValues) {
      for (const [colName, values] of Object.entries(internal.columnValues)) {
        const key = colName.toLowerCase();
        columnValues[key] = { ...values, ...(columnValues[key] ?? {}) };
      }
    }
  }

  const hasData =
    Boolean(context.useInternalDescriptions) ||
    tableDescription !== null ||
    extraColumns.length > 0 ||
    Object.keys(columnValues).length > 0 ||
    Object.keys(attributeDetails).length > 0;

  return hasData ? { tableDescription, extraColumns, columnValues, attributeDetails } : null;
}
