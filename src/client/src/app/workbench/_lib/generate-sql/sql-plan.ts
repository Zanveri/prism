import type { QueryColumn } from "../query.schema";
import type { SqlTarget } from "../record-edits.schema";
import type { ObjectKind } from "../object-kind";
import { generateSqlCopy } from "./generate-sql.copy";
import { conditionColumns, insertColumns, setColumns, type RowSqlItem, type SqlColumn, type SqlItem, type SqlKey, type SqlOptions, type SqlPlan, type SqlRow, type SqlTable } from "./generate-sql";

/**
 * O que o "Gerar SQL" decide do resultado (RN-GRADE-006 e 020), sem React: o plano (a tabela, as colunas dela no resultado e a chave) a partir do alvo da
 * edição pedido com `purpose: "sql"`, os itens que valem e o motivo dos que não valem, e as colunas cujos valores cortados a tela busca antes (RN-SQL-017).
 * A tela decide pelos campos do alvo (`kind`, `keyColumns`, `table`, `baseColumn`), nunca pelo texto de um motivo (Ruling 135).
 */

const reasons = generateSqlCopy.reasons;

/** O que o `edit-target` do "Gerar SQL" respondeu: o alvo, ou o resultado inteiro só leitura por outro motivo (a união, o `DISTINCT`), com o motivo. */
export type PlanSource = { kind: "target"; target: SqlTarget } | { kind: "notEditable"; reason: string };

const generationOf = (generated: string | null): SqlColumn["generated"] => (generated === "always" || generated === "byDefault" ? generated : null);

/** A tabela que o Prism não conhece: todas as colunas do resultado, pelo nome que ele dá, sem saber quais o banco gera; só o INSERT vale. */
function unknownTable(engine: SqlPlan["engine"], columns: readonly QueryColumn[], reason: string, kind: SqlPlan["kind"] = "unknown"): SqlPlan {
  return { engine, table: null, kind, unknownReason: reason, columns: columns.map((column, at) => ({ at, name: column.name, type: column.type, kind: column.kind, generated: null })), key: { kind: "none" } };
}

/**
 * O plano do resultado (RN-GRADE-006 e 020).
 *
 * - O resultado é "de uma tabela só" quando o alvo tem uma tabela só, que não é `elsewhere`, qualquer que seja o `kind` e o `editable` dela (a visão, a conexão
 *   somente leitura e o resultado que não se edita por uma coluna ou pela chave contam), e não pelo `rowOperations`. Fora disso a tabela não é conhecida.
 * - As colunas são as do resultado que vêm da tabela (`table` 0), pelo nome delas na tabela (`baseColumn`; no `other`, sem ele, pelo nome do resultado), na
 *   ordem do resultado; a calculada no comando fica de fora, e a que aparece duas vezes entra uma vez, com a primeira.
 * - A chave está inteira quando cada nome de `keyColumns` é o de uma dessas colunas; falta uma parte quando algum não é; e não há chave com `keyColumns` vazia.
 *   A `key` do alvo (as posições da chave que a edição usa) não decide: ela vem vazia também quando a chave tem coluna que a edição não converte.
 */
export function sqlPlanOf(engine: SqlPlan["engine"], columns: readonly QueryColumn[], source: PlanSource): SqlPlan {
  if (source.kind === "notEditable") return unknownTable(engine, columns, source.reason);

  const { target } = source;
  if (target.tables.length !== 1) return unknownTable(engine, columns, reasons.join);
  const [only] = target.tables;
  if (only.kind === "elsewhere") return unknownTable(engine, columns, reasons.elsewhere(only.name), "elsewhere");

  const tableColumns: SqlColumn[] = [];
  const names = new Set<string>();
  columns.forEach((column, at) => {
    const origin = target.columns[at];
    if (origin?.table !== 0) return;
    const name = origin.baseColumn ?? column.name;
    if (names.has(name)) return;
    names.add(name);
    tableColumns.push({ at, name, type: column.type, kind: column.kind, generated: generationOf(origin.generated) });
  });

  let key: SqlKey = { kind: "none" };
  if (only.keyColumns.length > 0) {
    const positions = only.keyColumns.map((name) => tableColumns.findIndex((column) => column.name === name));
    key = positions.every((position) => position >= 0) ? { kind: "complete", columns: positions } : { kind: "partial", missing: only.keyColumns.filter((_, index) => positions[index] < 0) };
  }

  return { engine, table: { schema: only.schema, name: only.name }, kind: only.kind, unknownReason: null, columns: tableColumns, key };
}

/**
 * Por que o item não vale neste resultado (RN-GRADE-006), ou `null`. É o que o plano já diz, sem as opções do diálogo: a tabela que o Prism não conhece (os
 * cinco que não são o INSERT), a chave que não está inteira, o resultado sem coluna que sirva de condição, o `UPDATE` sem coluna fora da chave, e o "CREATE"
 * de uma visão ou do que não é tabela. A frase já vem pronta para a dica do item e para o lugar do SQL.
 */
export function planRefusal(item: SqlItem, plan: SqlPlan): string | null {
  if (item === "insert") return null;
  if (plan.table === null) return reasons.oneTable(plan.unknownReason ?? "");
  if (item === "create") {
    if (plan.kind === "view") return reasons.unavailable(reasons.view(plan.table.name));
    return plan.kind === "table" || plan.kind === "unknown" ? null : reasons.unavailable(reasons.notATable(plan.table.name));
  }
  if (plan.key.kind === "partial") return reasons.unavailable(reasons.keyIncomplete(plan.table.name, plan.key.missing));
  if (conditionColumns(plan).length === 0) return reasons.unavailable(reasons.noCondition);
  if (item === "update" && setColumns(plan).length === 0) return reasons.unavailable(reasons.nothingToSet);
  return null;
}

/** O que a tela sabe para habilitar os itens do submenu, sem perguntar à API (RN-EDIT-010: habilitar não custa consulta). */
export type SqlMenuContext = {
  /** Quantas linhas a grade tem (as lidas e as novas). */
  gridRows: number;
  /** Das linhas da seleção, quantas estão no banco (as lidas, as marcadas para exclusão e as novas já salvas) e quantas são novas, ainda não salvas. */
  savedRows: number;
  newRows: number;
  /** A aba ocupada (um comando, o Salvar), ou a atualização automática lendo as linhas de novo (`"refresh"`, RN-GRADE-014). */
  busy: boolean | "refresh";
  /** O plano, depois que a tela perguntou; `null` antes: os itens ficam habilitados, e a primeira escolha pergunta. */
  plan: SqlPlan | null;
  /** Nos Registros, o que a árvore diz da tabela da aba (`object-kind.ts`): o "CREATE" de uma visão fica desabilitado desde o começo. */
  records: { name: string; kind: ObjectKind } | null;
};

/** O motivo de cada item desabilitado no submenu "Gerar SQL" (RN-GRADE-006), ou `null` no que vale. */
export function sqlMenuStates(context: SqlMenuContext): Record<SqlItem, string | null> {
  const states = {} as Record<SqlItem, string | null>;
  for (const item of ["selectEquals", "selectIn", "insert", "update", "delete", "create"] as const) states[item] = itemState(item, context);
  return states;
}

function itemState(item: SqlItem, { gridRows, savedRows, newRows, busy, plan, records }: SqlMenuContext): string | null {
  if (busy === "refresh") return reasons.unavailable(reasons.refreshing);
  if (busy) return reasons.unavailable(reasons.busy);
  if (item === "create") {
    if (plan !== null) return planRefusal(item, plan);
    return records?.kind === "view" ? reasons.unavailable(reasons.view(records.name)) : null;
  }
  if (gridRows === 0) return reasons.noRows;
  if (savedRows === 0) return newRows > 0 ? reasons.onlyNewRows : reasons.noRows;
  return plan === null ? null : planRefusal(item, plan);
}

/**
 * As colunas do resultado (pela posição) cujo valor o item usa, para a tela buscar antes o valor completo das cortadas (RN-SQL-017): só as que ela vai usar,
 * em qualquer das opções do diálogo (o INSERT, com e sem as colunas que o banco gera "por padrão").
 */
export function neededColumns(item: RowSqlItem, plan: SqlPlan): number[] {
  const positions = (indexes: readonly number[]) => indexes.map((index) => plan.columns[index].at);
  const key = plan.key.kind === "complete" ? plan.key.columns : [];
  const used =
    item === "insert"
      ? positions(insertColumns(plan, { qualified: true, compact: false, excludeGenerated: false }))
      : item === "update"
        ? positions([...setColumns(plan), ...key, ...conditionColumns(plan)])
        : positions(conditionColumns(plan));
  return [...new Set(used)].sort((a, b) => a - b);
}

/**
 * As linhas com o valor completo das células cortadas no lugar (RN-SQL-017): `valueOf` responde pela linha e pela posição no resultado, com `undefined` para o
 * valor que não veio inteiro (o teto, a aba guardada do script, a sessão que mudou ou caiu), que continua em `cut` e deixa a linha de fora, com o comentário.
 * A célula com pendência mostra a pendência, que já é inteira: só o lido muda nela.
 */
export function completeRows(rows: readonly SqlRow[], valueOf: (row: SqlRow, column: number) => string | undefined): SqlRow[] {
  return rows.map((row) => {
    if (row.cut.length === 0) return row;
    const read = [...row.read];
    const values = [...row.values];
    const cut: number[] = [];
    for (const column of row.cut) {
      const value = valueOf(row, column);
      if (value === undefined) {
        cut.push(column);
        continue;
      }
      read[column] = value;
      if (!row.changed.includes(column)) values[column] = value;
    }
    return { ...row, read, values, cut };
  });
}

/** As células cortadas que o item usa, pela linha e pela posição no resultado: o que a tela pede à rota das células antes de gerar. */
export function cutCellsFor(item: RowSqlItem, plan: SqlPlan, rows: readonly SqlRow[]): { row: SqlRow; column: number }[] {
  const needed = new Set(neededColumns(item, plan));
  return rows.flatMap((row) => row.cut.filter((column) => needed.has(column)).map((column) => ({ row, column })));
}

/** O limite de cada nome da tabela de destino (RN-EXPORT-011 e RN-GRADE-018). */
export const targetNameLimit = 128;

const control = /[\p{Cc}]/u;

/** O que um campo da tabela de destino recusa (RN-GRADE-018), ou `null`: o nome passa de 128 caracteres, ou tem caractere de controle. A tabela vazia, o seu. */
export function targetNameProblem(name: string, required: boolean): string | null {
  const copy = generateSqlCopy.dialog;
  if (name === "") return required ? copy.tableMissing : null;
  if ([...name].length > targetNameLimit) return copy.nameTooLong;
  return control.test(name) ? copy.nameControl : null;
}

/**
 * Por que o texto não sai com estas opções (RN-GRADE-018), ou `null`: no INSERT da tabela que o Prism não conhece, a tabela de destino que falta ou que um
 * campo recusa, e as duas colunas do resultado com o mesmo nome (o INSERT seria recusado); no INSERT de uma tabela conhecida, nenhuma coluna para ele (todas
 * geradas pelo banco). É dito no lugar do SQL, e as saídas ficam desabilitadas.
 */
export function optionRefusal(item: RowSqlItem, plan: SqlPlan, options: SqlOptions): string | null {
  if (item !== "insert") return null;
  if (plan.table === null) {
    const target: SqlTable = options.target ?? { schema: "", name: "" };
    const problem = targetNameProblem(target.name, true) ?? targetNameProblem(target.schema, false);
    if (problem !== null) return problem;
    const seen = new Set<string>();
    for (const column of plan.columns) {
      if (seen.has(column.name)) return generateSqlCopy.dialog.duplicateColumn(column.name);
      seen.add(column.name);
    }
    return null;
  }
  return insertColumns(plan, options).length === 0 ? reasons.unavailable(reasons.nothingToInsert) : null;
}
