import type { Engine } from "@/components/ui/engine-tag";

import { binaryDigitsOf, binaryLiteral, scriptLiteral } from "../grid-export/script-literal";
import type { QueryColumn } from "../query.schema";
import { quoteIdentifier } from "../table-sql";
import { generateSqlCopy } from "./generate-sql.copy";

/**
 * O texto de cada item do "Gerar SQL" (RN-GRADE-019), sem React: dado puro, do plano do resultado (a tabela, as colunas dela e a chave, `sql-plan.ts`), das
 * linhas escolhidas e das opções do diálogo. Os literais são os da exportação em SQL (`scriptLiteral` e `binaryLiteral`, RN-EXPORT-011), e os nomes vão sempre
 * entre aspas duplas (`quoteIdentifier`, RN-TABELA-002). O "CREATE" é o DDL aproximado da Estrutura (`approximateDdl`, `table-ddl.ts`), e não passa por aqui.
 */

/** Os seis itens do submenu "Gerar SQL", na ordem do print do dono (RN-GRADE-006). */
export const sqlItems = ["selectEquals", "selectIn", "insert", "update", "delete", "create"] as const;

export type SqlItem = (typeof sqlItems)[number];

/** Os itens que escrevem um comando por linha escolhida (ou um só, o `IN`), e não o DDL da tabela. */
export type RowSqlItem = Exclude<SqlItem, "create">;

/** Esquema e nome da tabela como o banco os guarda (sem aspas: o Prism as põe). No Informix, o esquema é o dono. */
export type SqlTable = { schema: string; name: string };

/**
 * Uma coluna da tabela que está no resultado (RN-GRADE-006): `at` é a posição dela no resultado (de onde a linha tira o valor) e `name` o nome dela na tabela
 * (o `baseColumn` do alvo, e não o apelido do resultado: `SELECT nome AS cliente` gera `"nome"`); na tabela que o Prism não conhece, todas as colunas do
 * resultado, pelo nome que ele dá. `type` é o tipo como o banco o diz (decide o literal do binário do Db2 e as colunas que o banco não compara com `=`), e
 * `generated` quem preenche o valor (`always`, `byDefault` ou nulo; nulo também quando não se sabe).
 */
export type SqlColumn = { at: number; name: string; type: string; kind: QueryColumn["kind"]; generated: "always" | "byDefault" | null };

/**
 * A chave do resultado (RN-GRADE-020): inteira (`columns` são as posições, em `SqlPlan.columns`, das colunas dela, na ordem da chave), com uma parte fora do
 * resultado (`missing`, os nomes que faltam), ou nenhuma (a tabela não tem chave; a visão).
 */
export type SqlKey = { kind: "complete"; columns: readonly number[] } | { kind: "partial"; missing: readonly string[] } | { kind: "none" };

/**
 * O que o "Gerar SQL" sabe do resultado (`sqlPlanOf`, em `sql-plan.ts`). `table` nula é a tabela que o Prism não conhece (a junção, a união e os outros da
 * RN-GRADE-006): só o INSERT vale, com a tabela que a pessoa escreve, e `unknownReason` diz por quê. `kind` é o do alvo (`view`, `other`…), ou `unknown` nos
 * Registros antes de o catálogo responder.
 */
export type SqlPlan = {
  engine: Engine;
  table: SqlTable | null;
  kind: "table" | "view" | "materializedView" | "foreign" | "other" | "elsewhere" | "unknown";
  unknownReason: string | null;
  columns: readonly SqlColumn[];
  key: SqlKey;
};

/**
 * Uma linha escolhida que está no banco (RN-GRADE-006): a lida, a marcada para exclusão (com os valores lidos) e a nova já salva na aba de consulta. A linha
 * nova ainda não salva não chega aqui. Tudo pela posição no resultado.
 */
export type SqlRow = {
  /** O número da linha na grade, de 1 em diante: o dos comentários do fim. */
  number: number;
  /** O texto que a grade mostra de cada coluna: a pendência, quando há; na linha marcada para exclusão, o lido. */
  values: readonly (string | null)[];
  /** O texto lido do banco de cada coluna: a condição pela chave usa o lido, que é o que acha a linha no banco. Sem pendência, o mesmo de `values`. */
  read: readonly (string | null)[];
  /** As colunas com alteração pendente. */
  changed: readonly number[];
  /** As colunas cujo valor LIDO chegou cortado (RN-SQL-011) e não veio inteiro pela rota das células (RN-SQL-017). A pendência é sempre inteira. */
  cut: readonly number[];
  /** As colunas "gerado pelo banco — execute de novo para ver" da linha nova já salva (RN-EDIT-009): sem valor. */
  generated: readonly number[];
};

/** As opções do diálogo (RN-GRADE-018). `target` é a tabela de destino do INSERT da tabela que o Prism não conhece, nos dois campos do diálogo. */
export type SqlOptions = { qualified: boolean; compact: boolean; excludeGenerated: boolean; target?: SqlTable };

export const defaultSqlOptions: SqlOptions = { qualified: true, compact: false, excludeGenerated: true };

/**
 * O texto gerado, e quantas linhas ficaram de fora (os comentários do fim dizem quais) de quantas chegaram. `tooLarge`: os comandos passaram de `stopAfter`
 * caracteres, e a geração parou ali; o texto que veio não vale.
 */
export type GeneratedSql = { text: string; skipped: number; rows: number; tooLarge?: true };

/** Por que uma linha ficou de fora, na ordem dos comentários do fim. */
type Reason = "truncated" | "binary" | "literal" | "generated";

const reasonOrder: readonly Reason[] = ["truncated", "binary", "literal", "generated"];

type Literal = { sql: string; isNull: boolean };

const copy = generateSqlCopy.sql;

const comment = (text: string) => `-- ${text}`;

/** O nome da tabela no comando: `"esquema"."tabela"` com "Nomes completos" e esquema; senão, só `"tabela"`. */
export function tableName(table: SqlTable, qualified: boolean): string {
  return qualified && table.schema !== "" ? `${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}` : quoteIdentifier(table.name);
}

/** Os números das linhas num comentário: `3, 4, 20-23, 40` (três ou mais seguidas viram faixa). */
export function rowList(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let start = 0; start < sorted.length; ) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end++;
    parts.push(end - start >= 2 ? `${sorted[start]}-${sorted[end]}` : sorted.slice(start, end + 1).join(", "));
    start = end + 1;
  }
  return parts.join(", ");
}

/**
 * O valor de uma célula como literal do banco (RN-EXPORT-011), ou o motivo de não haver: o nulo é `NULL`; o binário, o literal do banco (`binaryLiteral`; no
 * Informix não há); o resto, o `scriptLiteral` com o tipo da coluna (o texto com controle que não é quebra de linha, retorno de carro nem tabulação, e no
 * Informix a data e hora com mais de cinco casas e o lógico que não é `true` nem `false`, não têm).
 */
export function valueLiteral(engine: Engine, column: Pick<SqlColumn, "kind" | "type">, value: string | null): Literal | "binary" | "literal" {
  if (value === null) return { sql: "NULL", isNull: true };
  if (column.kind === "binary") {
    const digits = binaryDigitsOf(value);
    if (digits !== null) {
      const literal = binaryLiteral(engine, digits, column.type);
      return literal === null ? "binary" : { sql: literal, isNull: false };
    }
  }
  const literal = scriptLiteral(engine, value, column.kind);
  return literal === null ? "literal" : { sql: literal, isNull: false };
}

/** O tipo da coluna sem o tamanho e sem o `[]` da lista, em minúsculas: `character varying(40)` é `character varying`, `point[]` é `point`. */
const baseType = (type: string) => type.trim().replace(/\(.*$/, "").replace(/\[\]$/, "").replace(/^_/, "").trim().toLowerCase();

/** RN-GRADE-019: os tipos que cada banco não compara com `=` (ou compara pela área ou pelo comprimento), que ficam fora da condição sem chave. */
const notComparable: Record<Engine, ReadonlySet<string>> = {
  1: new Set(["json", "xml", "point", "line", "lseg", "box", "path", "polygon", "circle"]),
  2: new Set(["blob", "clob", "dbclob", "xml", "long varchar", "long vargraphic"]),
  3: new Set(["byte", "text", "blob", "clob"]),
};

/** A coluna serve à condição sem chave: o banco a compara com `=`. */
export function comparable(engine: Engine, column: Pick<SqlColumn, "type">): boolean {
  return !notComparable[engine].has(baseType(column.type));
}

/** As colunas que entram no `INSERT` (RN-GRADE-018): todas, menos as que o banco gera "sempre" e, com "Excluir as colunas que o banco gera", as "por padrão". */
export function insertColumns(plan: SqlPlan, options: SqlOptions): number[] {
  return plan.columns.flatMap((column, index) => (column.generated === "always" || (options.excludeGenerated && column.generated === "byDefault") ? [] : [index]));
}

/** As colunas da condição: as da chave inteira, ou, sem chave, as que o banco compara com `=`. */
export function conditionColumns(plan: SqlPlan): number[] {
  if (plan.key.kind === "complete") return [...plan.key.columns];
  return plan.columns.flatMap((column, index) => (comparable(plan.engine, column) ? [index] : []));
}

/** As colunas do `SET` do `UPDATE`: as que não são da chave (sem chave, todas), menos as que o banco gera "sempre", que não aceitam valor. */
export function setColumns(plan: SqlPlan): number[] {
  const key = plan.key.kind === "complete" ? new Set(plan.key.columns) : new Set<number>();
  return plan.columns.flatMap((column, index) => (key.has(index) || column.generated === "always" ? [] : [index]));
}

/** Como o texto de uma linha lê uma coluna: o valor que a grade mostra, ou o lido do banco (a condição). */
type Reading = "shown" | "read";

/** O literal de uma coluna da linha, ou o motivo de a linha ficar de fora. */
function cellOf(plan: SqlPlan, row: SqlRow, index: number, reading: Reading): Literal | Reason {
  const column = plan.columns[index];
  if (row.generated.includes(column.at)) return "generated";
  const shownPending = reading === "shown" && row.changed.includes(column.at);
  if (!shownPending && row.cut.includes(column.at)) return "truncated";
  return valueLiteral(plan.engine, column, reading === "shown" ? row.values[column.at] : row.read[column.at]);
}

/** O que uma linha precisa: as colunas e como cada uma é lida. */
type Needs = readonly (readonly [number, Reading])[];

/** Os literais da linha, pela posição em `plan.columns` e pela leitura, ou o primeiro motivo de ela ficar de fora (da esquerda para a direita). */
function literalsOf(plan: SqlPlan, row: SqlRow, needs: Needs): { values: Map<string, Literal> } | { reason: Reason } {
  const values = new Map<string, Literal>();
  for (const [index, reading] of needs) {
    const cell = cellOf(plan, row, index, reading);
    if (typeof cell === "string") return { reason: cell };
    values.set(`${reading}:${index}`, cell);
  }
  return { values };
}

/** As frases de um comando: sem "SQL compacto", uma cláusula por linha; com ela, numa linha só. O `;` vai no fim. */
const statement = (clauses: readonly string[], compact: boolean) => `${clauses.join(compact ? " " : "\n")};`;

/** A condição de uma coluna: `"coluna" = literal`, ou `"coluna" IS NULL` (o nulo nunca casa com `=`). */
const equals = (name: string, literal: Literal) => (literal.isNull ? `${quoteIdentifier(name)} IS NULL` : `${quoteIdentifier(name)} = ${literal.sql}`);

/** Os comentários do fim, um por motivo, com os números das linhas na grade. */
function trailingComments(skipped: Record<Reason, number[]>): string[] {
  return reasonOrder.filter((reason) => skipped[reason].length > 0).map((reason) => comment(`${copy.skipped[reason]}: ${rowList(skipped[reason])}.`));
}

/**
 * Junta o texto: o comentário do começo (sem chave), os comandos (uma linha em branco entre eles sem "SQL compacto"; uma quebra só com ela) e os comentários do
 * fim. Sem nenhum comando, o texto é só o dos comentários do fim. Sem quebra de linha no fim.
 */
function assemble(statements: readonly string[], leading: readonly string[], trailing: readonly string[], compact: boolean): string {
  if (statements.length === 0) return trailing.join("\n");
  const body = [...leading, statements.join(compact ? "\n" : "\n\n")].join("\n");
  return trailing.length === 0 ? body : `${body}${compact ? "\n" : "\n\n"}${trailing.join("\n")}`;
}

/** O comentário do começo sem chave, nos itens com condição (RN-GRADE-019). */
const leadingOf = (plan: SqlPlan) => (plan.key.kind === "none" ? [comment(copy.noKey)] : []);

/**
 * Gera o texto de um item com as linhas escolhidas (RN-GRADE-019). Quem confere antes se o item vale (a tabela conhecida, a chave inteira, a coluna do `SET`,
 * a da condição, a tabela de destino) é `planRefusal`/`optionRefusal` (`sql-plan.ts`); aqui o plano já vale para o item. A linha que fica de fora não
 * interrompe as outras: no fim, um comentário por motivo diz quais, pelo número na grade.
 */
export function generateSql(item: RowSqlItem, plan: SqlPlan, rows: readonly SqlRow[], options: SqlOptions, stopAfter = Infinity): GeneratedSql {
  const table = plan.table ?? options.target ?? { schema: "", name: "" };
  // Na tabela que o Prism não conhece, o esquema e a tabela são os dos campos do diálogo, como foram escritos: "Nomes completos" não se aplica.
  const name = tableName(table, plan.table === null ? true : options.qualified);
  const skipped: Record<Reason, number[]> = { truncated: [], binary: [], literal: [], generated: [] };
  const statements: string[] = [];
  const { compact } = options;
  let left = 0;
  // RN-GRADE-018: o texto que passaria do limite não é gerado. Cada caractere ocupa ao menos um byte em UTF-8, então os comandos com mais caracteres que
  // `stopAfter` já passam de `stopAfter` bytes, e as linhas que faltam não mudam isso.
  let size = 0;
  const tooLarge: GeneratedSql = { text: "", skipped: 0, rows: rows.length, tooLarge: true };

  /** Cada linha que vale vira o que `write` devolve; a que não vale entra no comentário do motivo. Falso quando o texto passou de `stopAfter`. */
  const eachRow = (needs: Needs, write: (literal: (index: number, reading: Reading) => Literal, row: SqlRow) => string | null): boolean => {
    for (const row of rows) {
      const found = literalsOf(plan, row, needs);
      if ("reason" in found) {
        skipped[found.reason].push(row.number);
        left++;
        continue;
      }
      const text = write((index, reading) => found.values.get(`${reading}:${index}`) as Literal, row);
      if (text === null) continue;
      statements.push(text);
      size += text.length;
      if (size > stopAfter) return false;
    }
    return true;
  };

  const names = plan.columns.map((column) => column.name);
  const where = conditionColumns(plan);
  const conditionNeeds: Needs = where.map((index) => [index, "read"] as const);
  const condition = (literal: (index: number, reading: Reading) => Literal) => where.map((index) => equals(names[index], literal(index, "read"))).join(" AND ");
  const selectList = names.map(quoteIdentifier).join(", ");

  switch (item) {
    case "selectEquals":
      if (!eachRow(conditionNeeds, (literal) => statement([`SELECT ${selectList}`, `FROM ${name}`, `WHERE ${condition(literal)}`], compact))) return tooLarge;
      return { text: assemble(statements, leadingOf(plan), trailingComments(skipped), compact), skipped: left, rows: rows.length };

    case "delete":
      if (!eachRow(conditionNeeds, (literal) => statement([`DELETE FROM ${name}`, `WHERE ${condition(literal)}`], compact))) return tooLarge;
      return { text: assemble(statements, leadingOf(plan), trailingComments(skipped), compact), skipped: left, rows: rows.length };

    case "insert": {
      const columns = insertColumns(plan, options);
      const list = columns.map((index) => quoteIdentifier(names[index])).join(", ");
      const written = eachRow(
        columns.map((index) => [index, "shown"] as const),
        (literal) => statement([`INSERT INTO ${name} (${list})`, `VALUES (${columns.map((index) => literal(index, "shown").sql).join(", ")})`], compact),
      );
      if (!written) return tooLarge;
      return { text: assemble(statements, [], trailingComments(skipped), compact), skipped: left, rows: rows.length };
    }

    case "update": {
      const set = setColumns(plan);
      const key = plan.key.kind === "complete" ? plan.key.columns : [];
      // A chave com alteração pendente entra no `SET` com o valor da grade, e a condição segue com a chave lida: é o que o "Salvar" faria (RN-GRADE-019).
      const needs: Needs = [...set.map((index) => [index, "shown"] as const), ...key.map((index) => [index, "shown"] as const), ...conditionNeeds];
      const written = eachRow(needs, (literal, row) => {
        const columns = plan.columns.flatMap((column, index) => (set.includes(index) || (key.includes(index) && row.changed.includes(column.at)) ? [index] : []));
        const assignments = columns.map((index) => `${quoteIdentifier(names[index])} = ${literal(index, "shown").sql}`).join(", ");
        return statement([`UPDATE ${name}`, `SET ${assignments}`, `WHERE ${condition(literal)}`], compact);
      });
      if (!written) return tooLarge;
      return { text: assemble(statements, leadingOf(plan), trailingComments(skipped), compact), skipped: left, rows: rows.length };
    }

    case "selectIn":
      return selectIn(plan, rows, name, options, skipped);
  }
}

/**
 * "SELECT .. WHERE .. IN" (RN-GRADE-019): um comando só, com a chave de todas as linhas, cada uma uma vez. A chave de uma coluna vai num `IN (1, 2, 3)`; a de
 * várias, no PostgreSQL, numa lista de linhas no `IN`; no Db2 e no Informix, e sem chave nos três, num `OR` de `AND`s, uma linha da grade por linha do texto. O
 * `IN` nunca leva `NULL`: a chave é de colunas não nulas. A linha que fica de fora só não entra na lista; sem nenhuma, o texto é só o comentário.
 */
function selectIn(plan: SqlPlan, rows: readonly SqlRow[], name: string, options: SqlOptions, skipped: Record<Reason, number[]>): GeneratedSql {
  const { compact } = options;
  const names = plan.columns.map((column) => column.name);
  const where = conditionColumns(plan);
  const tuples: Literal[][] = [];
  const seen = new Set<string>();
  let left = 0;

  for (const row of rows) {
    const found = literalsOf(
      plan,
      row,
      where.map((index) => [index, "read"] as const),
    );
    if ("reason" in found) {
      skipped[found.reason].push(row.number);
      left++;
      continue;
    }
    const tuple = where.map((index) => found.values.get(`read:${index}`) as Literal);
    const identity = JSON.stringify(tuple.map((literal) => (literal.isNull ? null : literal.sql)));
    if (seen.has(identity)) continue;
    seen.add(identity);
    tuples.push(tuple);
  }

  const trailing = trailingComments(skipped);
  if (tuples.length === 0) return { text: trailing.join("\n"), skipped: left, rows: rows.length };

  const head = [`SELECT ${names.map(quoteIdentifier).join(", ")}`, `FROM ${name}`];
  let condition: string;
  if (plan.key.kind === "complete" && where.length === 1) {
    condition = `WHERE ${quoteIdentifier(names[where[0]])} IN (${tuples.map(([literal]) => literal.sql).join(", ")})`;
  } else if (plan.key.kind === "complete" && plan.engine === 1) {
    const list = tuples.map((tuple) => `(${tuple.map((literal) => literal.sql).join(", ")})`);
    const columns = `(${where.map((index) => quoteIdentifier(names[index])).join(", ")})`;
    condition = compact ? `WHERE ${columns} IN (${list.join(", ")})` : `WHERE ${columns} IN (\n${list.map((entry) => `  ${entry}`).join(",\n")}\n)`;
  } else {
    const terms = tuples.map((tuple) => `(${tuple.map((literal, position) => equals(names[where[position]], literal)).join(" AND ")})`);
    condition = `WHERE ${terms.join(compact ? " OR " : "\n   OR ")}`;
  }

  return { text: assemble([statement([...head, condition], compact)], leadingOf(plan), trailing, compact), skipped: left, rows: rows.length };
}
