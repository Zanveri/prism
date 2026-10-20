import type { Engine } from "@/components/ui/engine-tag";
import type { ApiResult } from "@/lib/api/prism-api";

import type { Column, ForeignKey, TableIndex } from "../database-sessions.schema";
import type { ObjectKind } from "../object-kind";
import type { QueryColumn } from "../query.schema";
import { editErrorDetails, type SqlTarget } from "../record-edits.schema";
import { approximateDdl } from "../table-ddl";
import { workbenchCopy } from "../workbench.copy";
import { generateSql, type GeneratedSql, type SqlItem, type SqlOptions, type SqlPlan, type SqlRow, type SqlTable } from "./generate-sql";
import { generateSqlCopy } from "./generate-sql.copy";
import { completeRows, cutCellsFor, optionRefusal, planRefusal, sqlPlanOf } from "./sql-plan";

/**
 * O caminho do diálogo "Gerar SQL" (RN-GRADE-018), sem React: do item escolhido ao texto, pelas fases que o lugar do SQL mostra ("Conferindo a tabela e a
 * chave deste resultado…", "Buscando os valores completos…", "Lendo o catálogo…"), com as peças que falam com a API injetadas (`SqlFlowDeps`), e o que o
 * diálogo desenha de cada fase (`sqlDialogView`). Quem liga é `use-generate-sql.ts`.
 */

const dialogCopy = generateSqlCopy.dialog;

/** O que o diálogo recebe ao abrir: o item, e o resultado e as linhas da seleção daquele instante (RN-GRADE-018: as linhas são as de quando ele abriu). */
export type SqlDialogRequest = {
  item: SqlItem;
  engine: Engine;
  /** As colunas do resultado, como a página as dá. */
  resultColumns: readonly QueryColumn[];
  /** As linhas da seleção que estão no banco, na ordem da grade (`SqlRow`, com os valores da grade, os lidos e as células cortadas). */
  rows: readonly SqlRow[];
  /** Quantas linhas novas ainda não salvas estavam na seleção: ficam de fora, com o aviso. */
  newRows: number;
  /** Nos Registros, a tabela da aba e o que a árvore diz dela: o "CREATE" dos Registros vai direto ao catálogo, sem o `edit-target`. */
  records: { schema: string; name: string; kind: ObjectKind } | null;
  /** A conexão somente leitura (RN-PROT-002): o aviso de que o SQL que grava será recusado nela. */
  readOnlyConnection: boolean;
};

/** O que o `edit-target` do "Gerar SQL" respondeu, como o diálogo o usa. `message` é a da API ou a do banco, como veio. */
export type TargetAnswer = { kind: "target"; target: SqlTarget } | { kind: "notEditable"; reason: string } | { kind: "changed" } | { kind: "failed"; message: string | null };

/**
 * RN-GRADE-020: a resposta do `edit-target` com `purpose: "sql"`, como o diálogo a usa: o alvo; o resultado inteiro só leitura por outro motivo (só o INSERT
 * vale, com o motivo da API); o resultado que mudou; ou a falha, com a mensagem da API ou a do banco. `null` é a chamada que lançou: o aviso central já disse
 * por quê (RN-AVISO-004), e o diálogo oferece "Tentar de novo".
 */
export function sqlTargetAnswer(result: ApiResult<SqlTarget> | null): TargetAnswer {
  if (result === null) return { kind: "failed", message: null };
  if (result.ok) return { kind: "target", target: result.data };
  if (result.error.code === "RESULT_NOT_EDITABLE") return { kind: "notEditable", reason: editErrorDetails(result.error.extensions).reason ?? result.error.detail ?? result.error.title };
  if (result.error.code === "RESULT_CHANGED") return { kind: "changed" };
  return { kind: "failed", message: result.error.detail ?? result.error.title };
}

/** O valor completo das células cortadas (RN-SQL-017): `valueOf` com `undefined` para o que não veio inteiro; o resultado que mudou; ou a busca cancelada. */
export type FullValuesAnswer = { kind: "values"; valueOf: (row: SqlRow, column: number) => string | undefined } | { kind: "changed" } | { kind: "cancelled" };

/** As três listas da Estrutura (RN-TABELA-003), pela sessão da árvore e do mesmo cache, ou a falha, com a mensagem da API ou a do banco. */
export type CatalogAnswer = { kind: "catalog"; columns: readonly Column[]; foreignKeys: readonly ForeignKey[]; indexes: readonly TableIndex[] } | { kind: "failed"; message: string | null };

/** As peças que falam com a API e com a grade, injetadas: quem liga é a tela, com o cache do alvo, a rota das células e o da Estrutura. */
export type SqlFlowDeps = {
  /** O alvo do resultado: o que a edição já pediu, quando ele serve (`sqlTargetOf`), ou o `edit-target` com `purpose: "sql"`. */
  target: (signal: AbortSignal) => Promise<TargetAnswer>;
  fullValues: (cells: readonly { row: SqlRow; column: number }[], signal: AbortSignal) => Promise<FullValuesAnswer>;
  catalog: (table: SqlTable, signal: AbortSignal) => Promise<CatalogAnswer>;
  /** O resultado da grade ainda é o de quando o diálogo abriu (a execução que já rodava não trocou as linhas). */
  stillCurrent: () => boolean;
  /**
   * RN-GRADE-023: com colunas inteiras e linhas que o cursor ainda não leu, carrega as que faltam e devolve as linhas do diálogo, todas as do resultado
   * (`rows`, com as novas não salvas contadas em `newRows`); `progress` mostra o andamento no lugar do SQL. Para quando o texto passaria de 1 MB, com a recusa
   * dele (`tooLarge`); recusa com a frase quando as linhas não podem vir (`refused`). Nulo quando não há o que carregar: as linhas são as do pedido.
   */
  loadRows?: (request: SqlDialogRequest, plan: SqlPlan, signal: AbortSignal, progress: (text: string) => void) => Promise<LoadedRows | null>;
};

/** O que o carregar das linhas que faltam devolveu ao diálogo (RN-GRADE-023). */
export type LoadedRows = { kind: "rows"; rows: readonly SqlRow[]; newRows: number } | { kind: "tooLarge" } | { kind: "refused"; reason: string; detail: string | null } | { kind: "cancelled" } | { kind: "changed" };

/** Onde o diálogo está. `rows` e `ddl` são o texto pronto para as opções refazerem; o plano vai junto para a tela lembrar o que o resultado permite. */
export type SqlDialogPhase =
  | { kind: "checking" }
  | { kind: "loading"; text: string }
  | { kind: "fetching" }
  | { kind: "catalog" }
  /** `newRows`: com as linhas que faltavam carregadas (RN-GRADE-023), as novas não salvas que ficam de fora; sem ele, as do pedido. */
  | { kind: "rows"; plan: SqlPlan; rows: readonly SqlRow[]; newRows?: number }
  | { kind: "ddl"; plan: SqlPlan; text: string }
  | { kind: "refused"; reason: string; plan: SqlPlan | null }
  | { kind: "failed"; title: string; message: string | null }
  | { kind: "changed" };

/** O plano da tabela dos Registros, para o "CREATE" que não precisa do alvo: a tabela da aba, com o tipo que a árvore diz. */
function recordsPlan(engine: Engine, records: NonNullable<SqlDialogRequest["records"]>): SqlPlan {
  return { engine, table: { schema: records.schema, name: records.name }, kind: records.kind, unknownReason: null, columns: [], key: { kind: "none" } };
}

/**
 * Do item ao texto (RN-GRADE-018 e 019), mostrando cada fase por `show`. Cancelado (`signal`: o "Cancelar" da busca dos valores, o "Fechar", o Esc), para
 * sem mostrar mais nada. O resultado que mudou no meio (a API diz `RESULT_CHANGED`, ou a grade trocou as linhas) não gera nada.
 */
export async function runSqlFlow(request: SqlDialogRequest, deps: SqlFlowDeps, signal: AbortSignal, show: (phase: SqlDialogPhase) => void): Promise<void> {
  const { item, engine } = request;
  let plan: SqlPlan;

  if (item === "create" && request.records !== null) {
    plan = recordsPlan(engine, request.records);
  } else {
    show({ kind: "checking" });
    const answer = await deps.target(signal);
    if (signal.aborted) return;
    if (answer.kind === "changed") return show({ kind: "changed" });
    if (answer.kind === "failed") return show({ kind: "failed", title: dialogCopy.targetFailed, message: answer.message });
    plan = sqlPlanOf(engine, request.resultColumns, answer);
  }

  const refusal = planRefusal(item, plan);
  if (refusal !== null) return show({ kind: "refused", reason: refusal, plan });
  if (!deps.stillCurrent()) return show({ kind: "changed" });

  if (item === "create") {
    show({ kind: "catalog" });
    const table = plan.table as SqlTable;
    const catalog = await deps.catalog(table, signal);
    if (signal.aborted) return;
    if (catalog.kind === "failed") return show({ kind: "failed", title: dialogCopy.catalogFailed, message: catalog.message });
    const text = approximateDdl({ engine, schema: table.schema, name: table.name, kind: plan.kind === "table" ? "table" : "unknown", columns: catalog.columns, foreignKeys: catalog.foreignKeys, indexes: catalog.indexes });
    return show(text === null ? { kind: "refused", reason: workbenchCopy.tableTab.structure.ddl.empty, plan } : { kind: "ddl", plan, text });
  }

  let rows = request.rows;
  let newRows: number | undefined;
  // RN-GRADE-023: com colunas inteiras, as linhas que faltam vêm antes dos valores completos, com o andamento no lugar do SQL.
  if (deps.loadRows !== undefined) {
    const loaded = await deps.loadRows(request, plan, signal, (text) => show({ kind: "loading", text }));
    if (signal.aborted) return;
    if (loaded !== null) {
      if (loaded.kind === "cancelled") return;
      if (loaded.kind === "changed") return show({ kind: "changed" });
      if (loaded.kind === "tooLarge") return show({ kind: "refused", reason: dialogCopy.tooLarge, plan });
      if (loaded.kind === "refused") return show(loaded.detail === null ? { kind: "refused", reason: loaded.reason, plan } : { kind: "failed", title: loaded.reason, message: loaded.detail });
      rows = loaded.rows;
      newRows = loaded.newRows;
    }
  }
  const cells = cutCellsFor(item, plan, rows);
  if (cells.length > 0) {
    show({ kind: "fetching" });
    const full = await deps.fullValues(cells, signal);
    if (signal.aborted || full.kind === "cancelled") return;
    if (full.kind === "changed") return show({ kind: "changed" });
    rows = completeRows(rows, full.valueOf);
  }

  if (!deps.stillCurrent()) return show({ kind: "changed" });
  show({ kind: "rows", plan, rows, ...(newRows === undefined ? {} : { newRows }) });
}

/** O limite do texto (RN-GRADE-018): 1 MB em UTF-8, o teto do texto de uma aba de consulta (RN-ABAS-006) e de um script (RN-SCRIPT-004). */
export const sqlTextLimit = 1_048_576;

/** Os bytes do texto em UTF-8 (o par substituto solto vale o U+FFFD que ele vira, três bytes). */
export const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/** O nome da tabela como o cabeçalho do diálogo o escreve, sem aspas: `estoque.pedido`. */
const shownTable = (table: SqlTable) => (table.schema === "" ? table.name : `${table.schema}.${table.name}`);

/** As caixas de "Opções" que o item tem (RN-GRADE-018): o CREATE não tem nenhuma; "Excluir as colunas que o banco gera" é só do INSERT de uma tabela conhecida. */
export type SqlOptionsShown = { qualified: boolean; compact: boolean; excludeGenerated: boolean };

/** O lugar do SQL: o texto, ou a frase que diz o que acontece (`status`), por que o item não vale (`refused`) ou a falha (`failed`, com "Tentar de novo"). */
export type SqlDialogBody =
  | { kind: "text"; text: string }
  | { kind: "status"; text: string; cancel: boolean }
  | { kind: "refused"; text: string }
  | { kind: "failed"; title: string; message: string | null };

export type SqlDialogView = {
  /** O que se gera, embaixo do título: o item, a tabela e as linhas ("UPDATE · estoque.pedido · 3 linhas"). */
  subtitle: string;
  shown: SqlOptionsShown;
  /** Os campos "Esquema" e "Tabela" do INSERT da tabela que o Prism não conhece. */
  targetFields: boolean;
  /** As frases no tom de atenção, acima do editor. */
  warnings: readonly string[];
  body: SqlDialogBody;
  /** "Copiar" e "Abrir numa aba de consulta": só com o texto pronto. */
  canOutput: boolean;
  /** O texto gerado e o que ficou de fora, quando há (para os testes e o aviso). */
  generated: GeneratedSql | null;
};

/** O plano da fase, quando ela já o tem. */
const planOf = (phase: SqlDialogPhase): SqlPlan | null => (phase.kind === "rows" || phase.kind === "ddl" ? phase.plan : phase.kind === "refused" ? phase.plan : null);

/** O que o diálogo desenha da fase, com as opções de agora (RN-GRADE-018). O texto é refeito a cada opção, sem pedir nada à API. */
export function sqlDialogView(request: SqlDialogRequest, phase: SqlDialogPhase, options: SqlOptions): SqlDialogView {
  const { item } = request;
  const plan = planOf(phase);
  const table = plan?.table ?? (request.records === null ? null : { schema: request.records.schema, name: request.records.name });
  const unknownInsert = item === "insert" && plan !== null && plan.table === null;
  // As linhas do subtítulo: as do texto, quando as que faltavam chegaram (RN-GRADE-023); senão, as do pedido.
  const rowCount = phase.kind === "rows" ? phase.rows.length : request.rows.length;
  const subtitle = [generateSqlCopy.items[item], ...(table === null || unknownInsert ? [] : [shownTable(table)]), ...(item === "create" ? [] : [dialogCopy.rows(rowCount)])].join(dialogCopy.separator);
  const shown: SqlOptionsShown = item === "create" ? { qualified: false, compact: false, excludeGenerated: false } : { qualified: !unknownInsert, compact: true, excludeGenerated: item === "insert" && !unknownInsert };
  const base = { subtitle, shown, targetFields: unknownInsert, warnings: [] as string[], canOutput: false, generated: null };

  switch (phase.kind) {
    case "checking":
      return { ...base, body: { kind: "status", text: dialogCopy.checking, cancel: false } };
    case "loading":
      return { ...base, body: { kind: "status", text: phase.text, cancel: true } };
    case "fetching":
      return { ...base, body: { kind: "status", text: dialogCopy.fetching, cancel: true } };
    case "catalog":
      return { ...base, body: { kind: "status", text: dialogCopy.readingCatalog, cancel: false } };
    case "changed":
      return { ...base, body: { kind: "refused", text: dialogCopy.changed } };
    case "failed":
      return { ...base, body: { kind: "failed", title: phase.title, message: phase.message } };
    case "refused":
      return { ...base, body: { kind: "refused", text: phase.reason } };
    case "ddl":
      return utf8Bytes(phase.text) > sqlTextLimit ? { ...base, body: { kind: "refused", text: dialogCopy.tooLarge } } : { ...base, warnings: readOnlyWarning(request), body: { kind: "text", text: phase.text }, canOutput: true };
    case "rows": {
      if (item === "create") return { ...base, body: { kind: "refused", text: dialogCopy.changed } };
      const refusal = optionRefusal(item, phase.plan, options);
      if (refusal !== null) return { ...base, body: { kind: "refused", text: refusal } };
      const generated = generateSql(item, phase.plan, phase.rows, options, sqlTextLimit);
      if (generated.tooLarge === true || utf8Bytes(generated.text) > sqlTextLimit) return { ...base, body: { kind: "refused", text: dialogCopy.tooLarge } };
      return { ...base, warnings: rowWarnings({ ...request, newRows: phase.newRows ?? request.newRows }, phase.rows, generated), body: { kind: "text", text: generated.text }, canOutput: true, generated };
    }
  }
}

/** "A conexão é somente leitura: o SQL que grava será recusado nela.", no INSERT, no UPDATE, no DELETE e no CREATE (RN-PROT-002). */
function readOnlyWarning(request: SqlDialogRequest): string[] {
  const writes = request.item === "insert" || request.item === "update" || request.item === "delete" || request.item === "create";
  return request.readOnlyConnection && writes ? [generateSqlCopy.warnings.readOnly] : [];
}

/** As frases que valem acima do editor (RN-GRADE-018): as linhas de fora, as novas não salvas, as com alteração pendente e a conexão somente leitura. */
function rowWarnings(request: SqlDialogRequest, rows: readonly SqlRow[], generated: GeneratedSql): string[] {
  const warnings = generateSqlCopy.warnings;
  const pending = rows.filter((row) => row.changed.length > 0).length;
  return [
    ...(generated.skipped > 0 ? [warnings.skipped(generated.skipped, generated.rows)] : []),
    ...(request.newRows > 0 ? [warnings.newRows] : []),
    ...(pending > 0 ? [warnings.pending(pending)] : []),
    ...readOnlyWarning(request),
  ];
}
