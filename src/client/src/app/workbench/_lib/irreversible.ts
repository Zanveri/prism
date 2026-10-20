import type { Engine } from "@/components/ui/engine-tag";

import { sqlTokens, type SqlToken } from "./sql-statements";

/**
 * Por que um comando é irreversível (RN-PROT-001): `drop` (de qualquer objeto), `alterDrop` (o `DROP` de dentro de um `ALTER`, como `ALTER TABLE ... DROP
 * COLUMN`), `truncate`, e `delete` e `update` sem `WHERE` no nível de fora. `target` é o objeto como foi escrito (`producao.apontamento`), quando a tela o acha.
 */
export type Irreversible = { kind: "drop" | "alterDrop" | "truncate" | "delete" | "update"; target: string | null };

/** As palavras que podem vir entre o comando e o nome do objeto, e que não são o nome: o tipo do objeto e os modificadores. */
const objectWords = new Set([
  "table", "view", "index", "sequence", "schema", "function", "procedure", "routine", "trigger", "type", "domain", "database", "user", "role", "synonym",
  "alias", "extension", "tablespace", "module", "nickname", "variable", "package", "server", "publication", "subscription", "policy", "rule", "aggregate",
  "operator", "collation", "statistics", "language", "cast", "event", "materialized", "foreign", "data", "wrapper", "temporary", "temp", "unique", "if",
  "exists", "concurrently", "only", "from", "column", "constraint",
]);

/** O que pode começar um comando dentro de outro, num bloco com `;` no corpo (o `BEGIN ... END` do Db2, o `BEGIN ATOMIC`): a primeira palavra depois deles. */
const blockStarts = new Set([";", "begin", "atomic"]);

/** O comando principal que o `EXPLAIN ANALYZE` executa. */
const explained = new Set(["select", "insert", "update", "delete", "merge", "values", "with", "table", "execute", "create", "declare"]);

/** O nome (com o esquema, quando há: `esquema.tabela`, também entre aspas) que começa em `from`, como foi escrito, ou nulo. */
function nameAt(sql: string, list: readonly SqlToken[], from: number): string | null {
  let at = from;
  while (at < list.length && list[at].word && objectWords.has(list[at].text)) at++;
  const first = list[at];
  if (first === undefined || !(first.word || first.text === "'")) return null;

  let last = first;
  for (let next = at + 1; list[next]?.text === "." && list[next + 1] !== undefined && (list[next + 1].word || list[next + 1].text === "'"); next += 2) last = list[next + 1];
  return sql.slice(first.start, last.end);
}

/** A profundidade de parênteses antes de cada pedaço: o que está no nível de fora de um comando é o que está na profundidade dele. */
function depthsOf(list: readonly SqlToken[]): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const token of list) {
    if (token.text === ")" && depth > 0) depth--;
    depths.push(depth);
    if (token.text === "(") depth++;
  }
  return depths;
}

/** Até onde vai o comando que começa em `head`: o `)` que fecha o parêntese em que ele está, o `;` no nível dele, ou o fim. */
function endOf(list: readonly SqlToken[], depths: readonly number[], head: number): number {
  for (let at = head + 1; at < list.length; at++) if (depths[at] < depths[head] || (depths[at] === depths[head] && list[at].text === ";")) return at;
  return list.length;
}

/** Se há `word` no nível de fora do comando que começa em `head`. */
function hasAtTop(list: readonly SqlToken[], depths: readonly number[], head: number, word: string): boolean {
  const end = endOf(list, depths, head);
  for (let at = head + 1; at < end; at++) if (depths[at] === depths[head] && list[at].word && list[at].text === word) return true;
  return false;
}

/** Se há `word` em qualquer ponto do comando que começa em `head`. */
function hasAnywhere(list: readonly SqlToken[], depths: readonly number[], head: number, word: string): boolean {
  const end = endOf(list, depths, head);
  for (let at = head + 1; at < end; at++) if (list[at].word && list[at].text === word) return true;
  return false;
}

/**
 * Se o comando é irreversível, e por quê (RN-PROT-001): `DROP` de qualquer objeto, também o de dentro de um `ALTER`; `TRUNCATE`; e `DELETE` e `UPDATE`
 * sem `WHERE` no nível de fora (o `WHERE` de uma subconsulta não conta), também depois de um `WITH`, dentro das consultas dele e no `FINAL TABLE (UPDATE
 * ...)` do Db2. O texto é lido pelo leitor do projeto (`sqlTokens`, RN-SQL-002): texto entre aspas, nomes entre aspas, comentários (também o `{ ... }` do
 * Informix e o aninhado do PostgreSQL e do Db2) e `$tag$ ... $tag$` não contam.
 *
 * Na dúvida, pergunta: a palavra que pode começar um comando (a primeira, a de dentro de parênteses, a de depois do `)` de um `WITH`, a de depois de um `;`
 * ou de um `BEGIN` de um bloco) conta, também quando é uma coluna sem aspas chamada `update`. Não contam: o `CREATE` (criar uma rotina ou um gatilho não
 * executa o corpo dele), o `EXPLAIN` sem `ANALYZE` (ele só planeja), o `UPDATE STATISTICS` do Informix, o `ON CONFLICT DO UPDATE`, o `FOR UPDATE` e o
 * `THEN UPDATE` do `MERGE`, que não começam um comando. O primeiro motivo que achar é o que volta; nulo quando não há nenhum.
 */
export function irreversibleOf(sql: string, engine?: Engine): Irreversible | null {
  const list = sqlTokens(sql, engine);
  const depths = depthsOf(list);
  const firstWord = list.findIndex((token) => token.word);
  if (firstWord < 0 || list[firstWord].text === "create") return null;

  // O `EXPLAIN` só executa o comando com `ANALYZE`; então o comando explicado é o que vale.
  let explainHead = -1;
  if (list[firstWord].text === "explain") {
    const inner = list.findIndex((token, index) => index > firstWord && token.word && depths[index] === depths[firstWord] && explained.has(token.text));
    const analyze = list.slice(firstWord + 1, inner < 0 ? list.length : inner).some((token) => token.text === "analyze" || token.text === "analyse");
    if (!analyze || inner < 0) return null;
    explainHead = inner;
  }

  for (let index = firstWord; index < list.length; index++) {
    const token = list[index];
    if (!token.word) continue;

    const previous = list[index - 1]?.text;
    const opens = index === firstWord || index === explainHead || (previous !== undefined && blockStarts.has(previous));
    const dml = (token.text === "delete" || token.text === "update") && (opens || previous === "(" || previous === ")");
    if (!opens && !dml) continue;

    switch (token.text) {
      case "drop":
        return { kind: "drop", target: nameAt(sql, list, index + 1) };
      case "truncate":
        return { kind: "truncate", target: nameAt(sql, list, index + 1) };
      case "alter":
        if (hasAnywhere(list, depths, index, "drop")) return { kind: "alterDrop", target: nameAt(sql, list, index + 1) };
        break;
      case "delete":
        if (!hasAtTop(list, depths, index, "where")) return { kind: "delete", target: nameAt(sql, list, index + 1) };
        break;
      case "update":
        if (list[index + 1]?.text !== "statistics" && !hasAtTop(list, depths, index, "where")) return { kind: "update", target: nameAt(sql, list, index + 1) };
        break;
    }
  }
  return null;
}
