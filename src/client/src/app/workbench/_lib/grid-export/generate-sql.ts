import type { Engine } from "@/components/ui/engine-tag";

import type { QueryColumn } from "../query.schema";
import { quoteIdentifier } from "../table-sql";
import { gridExportCopy } from "./grid-export.copy";
import { rowNumberOf, truncatedIn, type GridSlice } from "./grid-slice";
import { scriptLiteral } from "./script-literal";

export type SqlKind = "insert" | "update" | "delete" | "select";

/**
 * A tabela de onde vêm as linhas (RN-GRADE-006). `keyColumns` são os nomes das colunas da chave primária, ou `null` quando não se conhece (uma lista
 * vazia vale o mesmo). A chave e as colunas do recorte se casam pelo nome; o recorte tem de trazer as LINHAS INTEIRAS da tabela, porque sem chave a
 * condição usa as colunas que ele tem.
 */
export type SqlTarget = { engine: Engine; schema: string; table: string; keyColumns: readonly string[] | null };

type Reason = "truncated" | "binary" | "literal";

/** O valor de uma célula já como texto de SQL: `NULL` ou o literal do banco. */
type Literal = { sql: string; isNull: boolean };

/** A ordem em que os motivos aparecem no comentário do fim. */
const reasonOrder: Reason[] = ["truncated", "binary", "literal"];

/** O nome da tabela no comando: esquema e tabela entre aspas pela regra única (`quoteIdentifier`); sem esquema, só a tabela. */
export function qualifiedTable(schema: string, table: string): string {
  return schema === "" ? quoteIdentifier(table) : `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

const comment = (text: string) => `-- ${text}`;

/**
 * O valor de uma célula como SQL, ou o motivo de não haver: cortada (RN-SQL-011), binária com valor (o literal binário muda de banco para banco, e
 * o valor chega cortado em 32 bytes) ou que o `scriptLiteral` recusa (controle que não seja quebra de linha, retorno de carro nem tabulação). O texto
 * com quebra de linha tem literal (`script-literal.ts`), e o com barra invertida também, nos três bancos (RN-TABELA-007). O nulo é sempre `NULL`.
 */
function literalOf(engine: Engine, kind: QueryColumn["kind"], value: string | null, cut: boolean): Literal | Reason {
  if (value === null) return { sql: "NULL", isNull: true };
  if (cut) return "truncated";
  if (kind === "binary") return "binary";

  const literal = scriptLiteral(engine, value, kind);
  return literal === null ? "literal" : { sql: literal, isNull: false };
}

/** Os números das linhas num comentário: `3, 4, 20-23, 40` (três ou mais seguidas viram faixa). */
function rowList(numbers: readonly number[]): string {
  const parts: string[] = [];

  for (let start = 0; start < numbers.length; ) {
    let end = start;
    while (end + 1 < numbers.length && numbers[end + 1] === numbers[end] + 1) end++;

    parts.push(end - start >= 2 ? `${numbers[start]}-${numbers[end]}` : numbers.slice(start, end + 1).join(", "));
    start = end + 1;
  }
  return parts.join(", ");
}

/**
 * Gera um comando por linha do recorte. `needed` são as colunas cujo valor o comando usa: se uma delas não vira literal a linha não é gerada, e no
 * fim um comentário diz, por motivo, quais linhas (pelo número na grade) ficaram de fora. Os comentários são frases fixas e números: nome de coluna
 * ou valor do banco num comentário `--` poderia encerrá-lo com uma quebra de linha e soltar código. Sem quebra de linha no fim da saída.
 */
function emit(slice: GridSlice, engine: Engine, needed: readonly number[], statement: (literal: (column: number) => Literal) => string, leading: readonly string[]): string {
  const cut = truncatedIn(slice);
  const skipped: Record<Reason, number[]> = { truncated: [], binary: [], literal: [] };
  const lines: string[] = [];

  slice.rows.forEach((row, rowIndex) => {
    const literals: Literal[] = [];
    const reasons = new Set<Reason>();

    for (const index of needed) {
      const literal = literalOf(engine, slice.columns[index].kind, row[index], cut(rowIndex, index));
      if (typeof literal === "string") reasons.add(literal);
      else literals[index] = literal;
    }

    if (reasons.size === 0) lines.push(statement((index) => literals[index]));
    else for (const reason of reasons) skipped[reason].push(rowNumberOf(slice, rowIndex));
  });

  const trailing = reasonOrder.filter((reason) => skipped[reason].length > 0).map((reason) => comment(`${gridExportCopy.sql.skipped[reason]}: ${rowList(skipped[reason])}.`));
  return [...leading.map(comment), ...lines, ...trailing].join("\n");
}

/** `INSERT INTO tabela (colunas) VALUES (valores);`, um por linha. A `table` entra no comando como está. */
function insertStatements(slice: GridSlice, engine: Engine, table: string): string {
  if (slice.rows.length === 0 || slice.columns.length === 0) return "";

  const all = slice.columns.map((_, index) => index);
  const names = slice.columns.map((column) => quoteIdentifier(column.name)).join(", ");

  return emit(slice, engine, all, (literal) => `INSERT INTO ${table} (${names}) VALUES (${all.map((index) => literal(index).sql).join(", ")});`, []);
}

/**
 * Os comandos `INSERT` da aba de consulta (RN-GRADE-006), em que a tabela não é conhecida: o nome é o texto que o usuário escreveu, só sem os
 * espaços das pontas, e entra no comando como ele escreveu (sem aspas, sem escape). Por isso um nome com `;` ou comentário muda o comando: quem
 * pede o nome confere com `statementCount`. Sem nome, só um comentário que o pede.
 */
export function generateInsertInto(slice: GridSlice, engine: Engine, table: string): string {
  const name = table.trim();
  return name === "" ? comment(gridExportCopy.sql.tableNameMissing) : insertStatements(slice, engine, name);
}

/**
 * Os comandos das linhas do recorte (RN-GRADE-006), um por linha, cada um terminado em `;`:
 * `INSERT` com as colunas do recorte; `UPDATE` com `SET` das colunas que não são da chave e `WHERE` pela chave; `DELETE` e `SELECT *` com `WHERE` pela
 * chave. Sem chave conhecida a condição usa TODAS as colunas do recorte (`IS NULL` para o nulo), o `SET` do `UPDATE` também, e a saída começa por
 * um comentário que diz isso. Chave conhecida que não está entre as colunas do recorte não gera `UPDATE`, `DELETE` nem `SELECT` (identificar a linha
 * por outras colunas afetaria mais do que o escolhido): a saída é um comentário que diz. O mesmo vale para o `UPDATE` em que todas as colunas são da chave.
 * Nomes por `quoteIdentifier`, valores por `scriptLiteral` com o tipo da coluna: o texto de várias linhas é literal (entre aspas no PostgreSQL e no Db2, em
 * partes unidas por `||` e `CHR` no Informix), e a linha só fica de fora por outro controle, por valor cortado ou binário.
 */
export function generateSql(kind: SqlKind, slice: GridSlice, target: SqlTarget): string {
  const { engine } = target;
  const table = qualifiedTable(target.schema, target.table);
  if (kind === "insert") return insertStatements(slice, engine, table);
  if (slice.rows.length === 0 || slice.columns.length === 0) return "";

  const all = slice.columns.map((_, index) => index);
  const names = slice.columns.map((column) => quoteIdentifier(column.name));
  const keyIndexes = target.keyColumns === null || target.keyColumns.length === 0 ? null : target.keyColumns.map((name) => slice.columns.findIndex((column) => column.name === name));
  if (keyIndexes?.includes(-1)) return comment(gridExportCopy.sql.keyNotInSlice);

  const where = keyIndexes ?? all;
  const leading = keyIndexes === null ? [gridExportCopy.sql.noKey] : [];
  const condition = (literal: (column: number) => Literal) =>
    where
      .map((index) => {
        const { sql, isNull } = literal(index);
        return isNull ? `${names[index]} IS NULL` : `${names[index]} = ${sql}`;
      })
      .join(" AND ");

  if (kind === "delete") return emit(slice, engine, where, (literal) => `DELETE FROM ${table} WHERE ${condition(literal)};`, leading);
  if (kind === "select") return emit(slice, engine, where, (literal) => `SELECT * FROM ${table} WHERE ${condition(literal)};`, leading);

  const set = keyIndexes === null ? all : all.filter((index) => !keyIndexes.includes(index));
  if (set.length === 0) return comment(gridExportCopy.sql.nothingToSet);

  return emit(slice, engine, [...new Set([...set, ...where])], (literal) => `UPDATE ${table} SET ${set.map((index) => `${names[index]} = ${literal(index).sql}`).join(", ")} WHERE ${condition(literal)};`, leading);
}
