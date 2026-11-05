import type { Engine } from "@/components/ui/engine-tag";

import type { Column, ForeignKey } from "./database-sessions.schema";
import { isReservedWord } from "./sql-completion";
import { itemsOf, parenthesesOf, readReferences, type Item, type Reference } from "./sql-references";
import { sqlTokens, unclosedConstruct, type SqlToken } from "./sql-statements";
import { isDot, isName, nameOf } from "./table-links";
import { columnKindOf } from "./variables/column-types";
import type { ScriptModel } from "./variables/script";

/*
 * A inferência da chave estrangeira (RN-VAR-030), na parte pura: os lugares do SQL do script em que cada variável é comparada com uma coluna, a coluna a que eles
 * levam e o que o catálogo dela restringe. Lê os comandos e as consultas das variáveis com o leitor da tela (`sqlTokens`) e as tabelas de cada bloco com o leitor do
 * autocompletar (`readReferences`), em qualquer nível de subconsulta. Na dúvida, a variável fica livre: restringir um valor que a pessoa precisa seria pior que não
 * ajudar. Quem lê o catálogo (as colunas e as chaves, pela sessão da árvore) é o diálogo.
 */

/** O lugar que conta: a comparação e o `IN` (`compare`), o item do `INSERT … VALUES` (`insert`) e o `UPDATE … SET` (`set`). */
export type PlaceKind = "compare" | "insert" | "set";

/** A coluna de um lugar, como o banco lê os nomes; o esquema só quando foi escrito (a tabela sem ele é a do esquema padrão da sessão, RN-LINK-001). */
export type Place = { schema: string | null; table: string; column: string; kind: PlaceKind };

/** Os lugares de cada variável que aparece no SQL do script; nulo quando um comando em que ela aparece não pôde ser lido (então ela fica livre). */
export type Places = Map<string, Place[] | null>;

/** O texto de SQL de cada item: o comando, ou a consulta de uma variável. */
function sqlOf(item: ScriptModel["items"][number]): string | null {
  if (item.kind === "statement") return item.text;
  const value = item.parsed?.value;
  return value?.t === "query" ? value.sql : null;
}

/** Os lugares de cada variável em todos os comandos e consultas de variável do script. */
export function placesOf(model: ScriptModel, engine: Engine | undefined): Places {
  const places: Places = new Map();
  for (const item of model.items) {
    const sql = sqlOf(item);
    if (sql === null) continue;
    const read = placesInSql(sql, engine, model.declaredNames);
    for (const name of read.names) if (read.places === null) places.set(name, null);
    if (read.places === null) continue;
    for (const [name, place] of read.places) {
      const known = places.get(name);
      if (known === null) continue;
      places.set(name, [...(known ?? []), place]);
    }
  }
  return places;
}

const punct = (token: SqlToken | undefined, text: string) => token !== undefined && !token.word && token.text === text;
const word = (token: SqlToken | undefined, ...words: string[]) => token !== undefined && token.word && words.includes(token.text);
const adjacent = (a: SqlToken | undefined, b: SqlToken | undefined) => a !== undefined && b !== undefined && a.end === b.start;

/** Antes do lado da comparação: o começo, um `(`, uma `,`, ou uma palavra da linguagem (`WHERE`, `AND`, `ON`, `SET`…). Um operador, um ponto ou um `::` não. */
const opensOperand = (token: SqlToken | undefined) => token === undefined || punct(token, "(") || punct(token, ",") || (token.word && isReservedWord(token.text));
/** Depois do lado da comparação: o fim, um `)`, uma `,`, um `;` ou uma palavra da linguagem. */
const closesOperand = (token: SqlToken | undefined) => token === undefined || punct(token, ")") || punct(token, ",") || punct(token, ";") || (token.word && isReservedWord(token.text));

/** A leitura de um texto de SQL: os lugares, ou nulo quando o leitor não o entende; e os `@nome` que ele cita. */
export function placesInSql(sql: string, engine: Engine | undefined, declared: ReadonlySet<string>): { places: [string, Place][] | null; names: Set<string> } {
  const tokens = sqlTokens(sql, engine);
  const names = new Set<string>();
  /** O nome da variável em `at` (`@` colado a uma palavra declarada), ou nulo. */
  const variableAt = (at: number): string | null => {
    const at0 = tokens[at];
    const name = tokens[at + 1];
    if (!punct(at0, "@") || name === undefined || !name.word || !adjacent(at0, name) || punct(tokens[at - 1], "@")) return null;
    const written = sql.slice(name.start, name.end);
    return declared.has(written) ? written : null;
  };
  for (let index = 0; index < tokens.length; index++) {
    const name = variableAt(index);
    if (name !== null) names.add(name);
  }
  if (names.size === 0) return { places: [], names };

  // O texto que não fecha e o parêntese sem par: o leitor não entende o bloco.
  let depth = 0;
  for (const token of tokens) {
    if (punct(token, "(")) depth++;
    else if (punct(token, ")") && --depth < 0) break;
  }
  if (depth !== 0 || unclosedConstruct(sql, engine) !== null) return { places: null, names };

  const closes = parenthesesOf(tokens);
  // O bloco de cada pedaço: o `(` da subconsulta mais de dentro que o contém (um grupo que começa por `SELECT` ou `WITH`), ou -1 para o comando.
  const blockOf: number[] = new Array<number>(tokens.length).fill(-1);
  const open: number[] = [];
  tokens.forEach((token, index) => {
    if (punct(token, ")")) open.pop();
    blockOf[index] = [...open].reverse().find((at) => word(tokens[at + 1], "select", "with")) ?? -1;
    if (punct(token, "(")) open.push(index);
  });

  const ctes = cteNames(sql, tokens, closes, engine);
  const scopes = new Map<number, Scope>();
  const scopeOf = (block: number): Scope => {
    let scope = scopes.get(block);
    if (scope === undefined) {
      const items = block === -1 ? itemsOf(tokens, closes, 0, tokens.length) : itemsOf(tokens, closes, block + 1, closes[block]);
      const { references, derived } = readReferences(sql, items, engine);
      scope = { references, tables: references.length + derived.length, derived: new Set(derived), sets: setRanges(items) };
      scopes.set(block, scope);
    }
    return scope;
  };

  const found: [string, Place][] = [];
  const columnOf = (parts: string[], block: number): Omit<Place, "kind"> | null => resolveColumn(parts, scopeOf(block), ctes);

  // As comparações de igualdade e de diferença: `=`, `<>` e `!=` (e não `<=`, `>=`, `==`).
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    let first = index;
    let last = index;
    if (punct(token, "=")) {
      const before = tokens[index - 1];
      if (adjacent(before, token) && (punct(before, "<") || punct(before, ">") || punct(before, "="))) continue;
      if (adjacent(token, tokens[index + 1]) && punct(tokens[index + 1], "=")) continue;
      if (adjacent(before, token) && punct(before, "!")) first = index - 1;
    } else if (punct(token, "<") && punct(tokens[index + 1], ">") && adjacent(token, tokens[index + 1])) last = index + 1;
    else continue;

    const block = blockOf[index];
    const kind: PlaceKind = scopeOf(block).sets.some(([from, to]) => token.start >= from && token.start < to) ? "set" : "compare";
    // `coluna = @v`
    const right = variableAt(last + 1);
    if (right !== null && closesOperand(tokens[last + 3])) {
      const left = chainBefore(sql, tokens, first - 1, engine);
      if (left !== null && opensOperand(tokens[left.start - 1])) {
        // No `SET`, a coluna sem qualificador é a da tabela do `UPDATE`, também com um `FROM` depois (o do PostgreSQL).
        const updated = kind === "set" && left.parts.length === 1 ? scopeOf(block).references.find((reference) => reference.via === "update") : undefined;
        const column = updated !== undefined ? { schema: updated.schema, table: updated.name, column: left.parts[0] } : columnOf(left.parts, block);
        if (column !== null) found.push([right, { ...column, kind }]);
      }
    }
    // `@v = coluna` (no `SET` a variável nunca está à esquerda)
    const leftVariable = variableAt(first - 2);
    if (kind === "compare" && leftVariable !== null && opensOperand(tokens[first - 3])) {
      const rightChain = chainAfter(sql, tokens, last + 1, engine);
      if (rightChain !== null && closesOperand(tokens[rightChain.end + 1])) {
        const column = columnOf(rightChain.parts, block);
        if (column !== null) found.push([leftVariable, { ...column, kind }]);
      }
    }
    index = last;
  }

  // `coluna [NOT] IN (@a, @b, …)`: cada item que é só uma variável.
  tokens.forEach((token, index) => {
    if (!word(token, "in") || !punct(tokens[index + 1], "(") || word(tokens[index + 2], "select", "with")) return;
    const end = word(tokens[index - 1], "not") ? index - 2 : index - 1;
    const chain = chainBefore(sql, tokens, end, engine);
    if (chain === null || !opensOperand(tokens[chain.start - 1])) return;
    const column = columnOf(chain.parts, blockOf[index]);
    if (column === null) return;
    for (const [from, to] of listItems(tokens, closes, index + 1)) {
      const name = to - from === 2 ? variableAt(from) : null;
      if (name !== null) found.push([name, { ...column, kind: "compare" }]);
    }
  });

  // `INSERT INTO tabela (c1, c2, …) VALUES (…), (…)`: o item de posição N que é só uma variável é a coluna cN.
  tokens.forEach((token, index) => {
    if (!word(token, "insert") || !word(tokens[index + 1], "into")) return;
    const table = chainAfter(sql, tokens, index + 2, engine);
    if (table === null || table.parts.length > 2 || !punct(tokens[table.end + 1], "(")) return;
    const columns = listItems(tokens, closes, table.end + 1).map(([from, to]) => (to - from === 1 && isName(sql, tokens[from]) ? nameOf(sql, tokens[from], engine) : null));
    let at = closes[table.end + 1] + 1;
    if (!word(tokens[at], "values")) return;
    const [schema, name] = table.parts.length === 2 ? table.parts : [null, table.parts[0]];
    for (at++; punct(tokens[at], "("); at = closes[at] + 2) {
      listItems(tokens, closes, at).forEach(([from, to], position) => {
        const variable = to - from === 2 ? variableAt(from) : null;
        const column = columns[position];
        if (variable !== null && column != null) found.push([variable, { schema, table: name, column, kind: "insert" }]);
      });
      if (!punct(tokens[closes[at] + 1], ",")) break;
    }
  });

  return { places: found, names };
}

type Scope = { references: Reference[]; tables: number; derived: ReadonlySet<string>; sets: [number, number][] };

/** As partes de um nome (`a`, `a.b`, `a.b.c`) que terminam no pedaço `end`, coladas pelo ponto; nulo quando não é um nome assim. */
function chainBefore(sql: string, tokens: readonly SqlToken[], end: number, engine: Engine | undefined): { parts: string[]; start: number } | null {
  const parts: string[] = [];
  let at = end;
  for (;;) {
    const token = tokens[at];
    if (!isName(sql, token)) return null;
    const name = nameOf(sql, token, engine);
    if (name === null) return null;
    parts.unshift(name);
    if (isDot(tokens[at - 1]) && adjacent(tokens[at - 1], token) && adjacent(tokens[at - 2], tokens[at - 1])) at -= 2;
    else break;
  }
  return parts.length > 3 ? null : { parts, start: at };
}

/** As partes de um nome que começam no pedaço `start`. */
function chainAfter(sql: string, tokens: readonly SqlToken[], start: number, engine: Engine | undefined): { parts: string[]; end: number } | null {
  const parts: string[] = [];
  let at = start;
  for (;;) {
    const token = tokens[at];
    if (!isName(sql, token)) return null;
    const name = nameOf(sql, token, engine);
    if (name === null) return null;
    parts.push(name);
    if (isDot(tokens[at + 1]) && adjacent(token, tokens[at + 1]) && adjacent(tokens[at + 1], tokens[at + 2])) at += 2;
    else break;
  }
  return parts.length > 3 ? null : { parts, end: at };
}

/** Os itens de um grupo entre parênteses (o `(` em `open`), separados pelas vírgulas dele: `[primeiro, depois do último)` de cada um, nos índices dos pedaços. */
function listItems(tokens: readonly SqlToken[], closes: readonly number[], open: number): [number, number][] {
  const items: [number, number][] = [];
  const close = closes[open];
  let from = open + 1;
  for (let at = open + 1; at < close; at++) {
    if (punct(tokens[at], "(")) at = closes[at];
    else if (punct(tokens[at], ",")) {
      items.push([from, at]);
      from = at + 1;
    }
  }
  items.push([from, close]);
  return items;
}

/** Os trechos do `SET` de um `UPDATE` no nível do bloco: do `SET` até o `WHERE`, o `FROM` ou o `RETURNING` do mesmo nível. */
function setRanges(items: readonly Item[]): [number, number][] {
  if (!items.some((item) => word(item, "update"))) return [];
  const ranges: [number, number][] = [];
  items.forEach((item, index) => {
    if (!word(item, "set")) return;
    const stop = items.slice(index + 1).find((next) => word(next, "where", "from", "returning"));
    ranges.push([item.start, stop?.start ?? Number.MAX_SAFE_INTEGER]);
  });
  return ranges;
}

/** Os nomes do `WITH`: `WITH [RECURSIVE] nome [(colunas)] AS [[NOT] MATERIALIZED] (…), nome AS (…)`. */
function cteNames(sql: string, tokens: readonly SqlToken[], closes: readonly number[], engine: Engine | undefined): Set<string> {
  const names = new Set<string>();
  tokens.forEach((token, index) => {
    if (!word(token, "with")) return;
    let at = index + 1;
    if (word(tokens[at], "recursive")) at++;
    for (;;) {
      if (!isName(sql, tokens[at])) return;
      const name = nameOf(sql, tokens[at], engine);
      if (name === null) return;
      at++;
      if (punct(tokens[at], "(")) at = closes[at] + 1;
      if (!word(tokens[at], "as")) return;
      names.add(name);
      at++;
      if (word(tokens[at], "not")) at++;
      if (word(tokens[at], "materialized")) at++;
      if (!punct(tokens[at], "(")) return;
      at = closes[at] + 1;
      if (!punct(tokens[at], ",")) return;
      at++;
    }
  });
  return names;
}

/**
 * A tabela da coluna escrita (`coluna`, `apelido.coluna`, `tabela.coluna`, `esquema.tabela.coluna`) entre as tabelas do bloco: o qualificador primeiro como apelido,
 * depois como nome de tabela; sem ele, só quando o bloco tem uma tabela só. O apelido de uma tabela derivada, de um `WITH` ou de uma função não conta, nem a coluna de
 * um bloco de fora.
 */
function resolveColumn(parts: readonly string[], scope: Scope, ctes: ReadonlySet<string>): Omit<Place, "kind"> | null {
  const real = (reference: Reference | undefined) => (reference === undefined || (reference.schema === null && ctes.has(reference.name)) ? null : reference);
  const column = parts[parts.length - 1];
  let table: Reference | null;
  if (parts.length === 1) table = scope.tables === 1 ? real(scope.references[0]) : null;
  else if (parts.length === 2) {
    const [qualifier] = parts;
    if (scope.derived.has(qualifier)) return null;
    const aliased = scope.references.find((reference) => reference.alias === qualifier);
    table = aliased !== undefined ? real(aliased) : real(scope.references.find((reference) => reference.alias === null && reference.name === qualifier));
  } else table = real(scope.references.find((reference) => reference.alias === null && reference.schema === parts[0] && reference.name === parts[1]));
  return table === null ? null : { schema: table.schema, table: table.name, column };
}

/** A tabela como o catálogo a guarda, ou nulo quando ela não está nele. */
export type ResolveTable = (schema: string | null, table: string) => { schema: string; table: string } | null;

export type ColumnTarget = { schema: string; table: string; column: string };

/** O máximo de tabelas diferentes que a inferência consulta no catálogo; acima dele, desiste (RN-VAR-030). */
export const maxInferenceTables = 20;

/**
 * A coluna a que os lugares de uma variável levam: todos têm de dar a mesma tabela e a mesma coluna, resolvidas pelo catálogo. `compared`: todos são comparações (a
 * regra da chave primária só vale nelas). Nulo quando desiste.
 */
export function targetOf(places: readonly Place[] | null | undefined, resolve: ResolveTable): { target: ColumnTarget; compared: boolean } | null {
  if (places === null || places === undefined || places.length === 0) return null;
  let target: ColumnTarget | null = null;
  for (const place of places) {
    const table = resolve(place.schema, place.table);
    if (table === null) return null;
    const next = { ...table, column: place.column };
    if (target !== null && (target.schema !== next.schema || target.table !== next.table || target.column !== next.column)) return null;
    target = next;
  }
  return target === null ? null : { target, compared: places.every((place) => place.kind === "compare") };
}

/** As tabelas diferentes que os lugares citam, para o limite de 20. */
export function tablesOf(places: Places): Set<string> {
  const tables = new Set<string>();
  for (const list of places.values()) for (const place of list ?? []) tables.add(JSON.stringify([place.schema, place.table]));
  return tables;
}

/** O que a variável aceita, pelo tipo dela: um número, um texto, uma data ou um booleano; nulo quando não se sabe. */
export type VariableKind = "number" | "string" | "date" | "boolean" | null;

/**
 * A restrição de uma variável (RN-VAR-030 e 031): os valores de qual coluna o diálogo oferece. `strict` falso na restrição pela chave primária da própria coluna, em
 * que o valor que não existe é só um aviso.
 */
export type Restriction = ColumnTarget & { strict: boolean };

/**
 * O que a coluna dá, pelo catálogo da tabela dela (as colunas e as chaves estrangeiras): a coluna que é, sozinha, uma chave estrangeira dá os valores da coluna
 * referenciada; nas comparações (`compared`), a que é, sozinha, a chave primária dá os dela mesma; no tipo de coluna (`columnType`), a que não é chave estrangeira
 * dá os dela mesma. Desiste na chave de várias colunas, no tipo que não casa com o da variável e na coluna binária.
 */
export function restrictionOf(target: ColumnTarget, how: { compared: boolean; columnType: boolean; variable: VariableKind }, columns: readonly Column[], foreignKeys: readonly ForeignKey[], engine: Engine | undefined): Restriction | null {
  const column = columns.find((candidate) => candidate.name === target.column);
  if (column === undefined) return null;
  const kind = columnKindOf(column.type, engine);
  if (kind === "binary" || kind === "list") return null;
  const accepts = kind === "day" || kind === "instant" ? "date" : kind;
  if (how.variable !== null && how.variable !== accepts) return null;

  const keys = foreignKeys.filter((key) => key.columns.includes(target.column));
  if (keys.some((key) => key.columns.length > 1)) return null;
  const [key] = keys;
  if (key !== undefined) {
    const referenced = key.referencedColumns[0];
    return referenced === undefined ? null : { schema: key.referencedSchema, table: key.referencedTable, column: referenced, strict: true };
  }
  const primary = columns.filter((candidate) => candidate.isPrimaryKey);
  if (how.compared && primary.length === 1 && primary[0].name === target.column) return { ...target, strict: false };
  return how.columnType ? { ...target, strict: true } : null;
}

const descriptionNames = new Set(["nome", "name", "descricao", "description", "desc", "titulo", "title", "label", "rotulo", "razao_social", "fantasia", "apelido", "sigla"]);
const descriptionEnds = ["_nome", "_name", "_descricao", "_desc"];
/** As colunas de texto que a rota dos valores aceita como descrição: sem os objetos grandes (`CLOB`, o `TEXT` do Informix), que ela recusa (RN-VAR-035). */
const textType = /^(character varying|varchar|varchar2|character|char|bpchar|nchar|nvarchar|national|lvarchar|text|citext|graphic|vargraphic|name)\b/;

/**
 * A coluna de descrição da tabela referenciada (RN-VAR-031): a primeira coluna de texto, na ordem do catálogo, fora da chave, cujo nome, sem diferenciar maiúsculas
 * nem acentos, é um dos de `descriptionNames` ou termina num dos de `descriptionEnds`. Nula quando não há: um texto qualquer ao lado não ajudaria a escolher.
 */
export function descriptionColumnOf(columns: readonly Column[], key: string, engine: Engine | undefined): string | null {
  for (const column of [...columns].sort((a, b) => a.position - b.position)) {
    if (column.name === key || column.isPrimaryKey) continue;
    const type = column.type.trim().toLowerCase();
    if (!textType.test(type) || (engine === 3 && /^text\b/.test(type))) continue;
    const folded = column.name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    if (descriptionNames.has(folded) || descriptionEnds.some((end) => folded.endsWith(end))) return column.name;
  }
  return null;
}
