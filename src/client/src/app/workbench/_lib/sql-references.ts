import type { Engine } from "@/components/ui";

import { isReservedWord } from "./sql-completion";
import { sqlTokens, statementAt, unclosedConstruct, type SqlToken } from "./sql-statements";
import { isDot, isName, nameOf, type LinkCatalog } from "./table-links";

/**
 * RN-CONFIG-004 e RN-SQL-025: a leitura do comando em que o cursor está para o autocompletar das colunas de `tabela.` e da junção. Tudo puro: as tabelas e os
 * apelidos do `FROM`/`JOIN`/`UPDATE`/`INTO` (sem as subconsultas e os apelidos delas) e o contexto do cursor (depois de `nome.`, de `JOIN`, de `ON`). Usa o leitor
 * do projeto (`sqlTokens`), então texto entre aspas simples, `$tag$ … $tag$` e comentário nunca são nome.
 */

/** Uma tabela (ou visão) escrita no comando, como o banco lê os nomes dela. */
export type Reference = {
  /** O esquema, quando foi escrito (`esquema.tabela`). */
  schema: string | null;
  name: string;
  /** O apelido (`pedidos p`, `pedidos AS p`), como o banco o lê. */
  alias: string | null;
  /** O apelido como está escrito no comando, que vale no SQL (com as aspas, se tiver). */
  aliasText: string | null;
  /** A palavra que a introduziu. */
  via: "from" | "join" | "update" | "into";
  /** Onde ela acaba, no índice dos itens do nível do cursor: o `ON` de um `JOIN` é o item que vem logo depois. */
  next: number;
};

/** O que o cursor está pedindo. */
export type CursorContext =
  /** Depois de `nome.` (e das letras depois do ponto): `qualifier` são as partes do nome, de uma a três. */
  | { kind: "member"; qualifier: string[]; from: number; quoted: boolean }
  /** Depois de `JOIN` (menos o `CROSS` e o `NATURAL`). */
  | { kind: "join"; from: number; quoted: boolean }
  /** Depois de `JOIN tabela [AS] [apelido] ON`: `table` é a tabela que o `JOIN` traz. */
  | { kind: "on"; table: Reference; from: number; quoted: boolean }
  | { kind: "none" };

export type Analysis = {
  references: Reference[];
  /** Os nomes que um apelido novo não pode repetir, em minúsculas: os apelidos (inclusive os das subconsultas) e os nomes das tabelas sem apelido. */
  used: Set<string>;
  /** Algum apelido no comando: as tabelas novas ganham um, e as condições usam os apelidos. */
  usesAliases: boolean;
  /** Onde o comando começa no documento: o `from` do contexto é um deslocamento do documento (o que o CodeMirror pede), e o `start` das tabelas é do texto do comando. */
  offset: number;
  context: CursorContext;
};

const none: CursorContext = { kind: "none" };

/** O que o comando só tem em tamanho de verdade: acima disto o autocompletar da junção e das colunas se cala (o mesmo teto do autocompletar das variáveis). */
export const maxAnalyzedLength = 200_000;

/** Palavras que vêm depois de uma tabela e não são o apelido dela, além das reservadas (`isReservedWord`). */
const afterTable = new Set(["natural", "straight_join", "tablesample", "window", "qualify", "returning", "using", "for", "partition"]);

/** Um pedaço do nível do cursor: um pedaço do texto, ou um grupo entre parênteses inteiro (uma subconsulta, uma lista, uma chamada) como um item só. */
type Item = SqlToken & { group?: true };

const isGroup = (item: Item | undefined) => item?.group === true;

const comma = (item: Item | undefined) => item !== undefined && !item.word && !isGroup(item) && item.text === ",";
const wordIs = (item: Item | undefined, ...words: string[]) => item !== undefined && item.word && words.includes(item.text);

/** O pedaço de abrir parêntese, e o que fecha cada um (`tokens.length` quando o grupo não fecha). */
function parenthesesOf(tokens: readonly SqlToken[]): number[] {
  const closes: number[] = new Array<number>(tokens.length).fill(-1);
  const open: number[] = [];
  tokens.forEach((token, index) => {
    if (token.word) return;
    if (token.text === "(") open.push(index);
    else if (token.text === ")" && open.length > 0) closes[open.pop() as number] = index;
  });
  for (const index of open) closes[index] = tokens.length;
  return closes;
}

/** Os itens do nível `[first, last)`: os grupos entre parênteses viram um item cada, e o que está dentro deles não conta. */
function itemsOf(tokens: readonly SqlToken[], closes: readonly number[], first: number, last: number): Item[] {
  const items: Item[] = [];
  for (let index = first; index < last; index++) {
    const token = tokens[index];
    if (!token.word && token.text === "(") {
      const close = closes[index];
      items.push({ text: "()", word: false, start: token.start, end: tokens[Math.min(close, tokens.length - 1)].end, group: true });
      index = close;
    } else items.push(token);
  }
  return items;
}

/** Lê as tabelas de um nível. As subconsultas da lista (`FROM (SELECT …) s`) e as chamadas (`FROM f(x) g`) não são tabela, mas o apelido delas conta como usado. */
function readReferences(sql: string, items: readonly Item[], engine: Engine | undefined): { references: Reference[]; derived: string[] } {
  const references: Reference[] = [];
  const derived: string[] = [];

  /** O apelido que começa em `at` (com ou sem `AS`): o próximo índice e o apelido, ou o mesmo índice quando não há. */
  function aliasAt(at: number): { next: number; alias: { folded: string; text: string } | null } {
    let cursor = at;
    if (wordIs(items[cursor], "as")) cursor++;
    const item = items[cursor];
    if (item === undefined || isGroup(item) || !isName(sql, item)) return { next: at, alias: null };
    const folded = nameOf(sql, item, engine);
    if (folded === null || (item.word && afterTable.has(item.text))) return { next: at, alias: null };
    return { next: cursor, alias: { folded, text: sql.slice(item.start, item.end) } };
  }

  /** Depois do apelido, a lista de colunas (`AS s(a, b)`) não é nada. */
  const skipColumnList = (at: number) => (isGroup(items[at]) ? at + 1 : at);

  /** As tabelas que começam em `at`, para `via`; devolve o índice onde a leitura parou. */
  function readList(at: number, via: Reference["via"], listed: boolean): number {
    let cursor = at;
    for (;;) {
      while (wordIs(items[cursor], "only", "lateral")) cursor++;
      const item = items[cursor];
      if (item === undefined) return cursor;

      if (isGroup(item)) {
        const alias = aliasAt(cursor + 1);
        if (alias.alias !== null) derived.push(alias.alias.folded);
        cursor = skipColumnList(alias.alias === null ? cursor + 1 : alias.next + 1);
      } else if (isName(sql, item) && nameOf(sql, item, engine) !== null) {
        const parts = [item];
        let last = cursor;
        while (isDot(items[last + 1]) && items[last + 1].start === items[last].end && isName(sql, items[last + 2]) && items[last + 2].start === items[last + 1].end) {
          last += 2;
          parts.push(items[last]);
        }
        const names = parts.map((part) => nameOf(sql, part, engine));
        const target = last + 1;

        // `FROM f(x) g`: a chamada de uma função não é tabela (no `INSERT INTO t (a, b)` o grupo é a lista de colunas).
        if ((via === "from" || via === "join") && isGroup(items[target])) {
          const alias = aliasAt(target + 1);
          if (alias.alias !== null) derived.push(alias.alias.folded);
          cursor = skipColumnList(alias.alias === null ? target + 1 : alias.next + 1);
        } else if (names.length >= 1 && names.length <= 3 && names.every((name) => name !== null)) {
          const alias = aliasAt(target);
          const tail = names.slice(-2) as string[];
          const after = alias.alias === null ? target : alias.next + 1;
          references.push({ schema: tail.length === 2 ? tail[0] : null, name: tail[tail.length - 1], alias: alias.alias?.folded ?? null, aliasText: alias.alias?.text ?? null, via, next: after });
          cursor = after;
        } else return target;
      } else return cursor;

      if (listed && comma(items[cursor])) cursor++;
      else return cursor;
    }
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item.word) continue;
    // `a IS DISTINCT FROM b` não traz tabela.
    if (item.text === "from" && !wordIs(items[index - 1], "distinct")) index = readList(index + 1, "from", true) - 1;
    else if (item.text === "join") index = readList(index + 1, "join", false) - 1;
    else if (item.text === "update") index = readList(index + 1, "update", true) - 1;
    else if (item.text === "into") index = readList(index + 1, "into", false) - 1;
  }

  return { references, derived };
}

/** A palavra (ou o nome entre aspas começado e ainda aberto) em que o cursor está: de onde ela começa e se tem aspas. `null`: o cursor está num texto, num comentário ou num `$tag$`. */
function partialAt(before: string, engine: Engine | undefined): { from: number; quoted: boolean } | null {
  const open = unclosedConstruct(before, engine);
  if (open === "text" || open === "comment" || open === "dollar") return null;
  if (open === "quoted") {
    const last = sqlTokens(before, engine).at(-1);
    return last === undefined ? null : { from: last.start, quoted: true };
  }
  return { from: before.length - (/[\p{L}\p{N}_$]*$/u.exec(before)?.[0].length ?? 0), quoted: false };
}

/**
 * Lê o comando em que o cursor (`position`) está: as tabelas do nível do cursor (a subconsulta em que ele está, ou o comando) e o que ele está pedindo. `null`
 * quando o cursor não tem comando, está depois de um `;` (num comando que ainda não existe) ou o comando é grande demais.
 */
export function analyzeAt(sql: string, position: number, engine: Engine | undefined, blankLines = false): Analysis | null {
  const statement = statementAt(sql, position, engine, { blankLines });
  if (statement === null || position < statement.start) return null;

  const text = sql.slice(statement.start, Math.max(statement.end, position));
  if (text.length > maxAnalyzedLength) return null;

  const cursor = position - statement.start;
  const partial = partialAt(text.slice(0, cursor), engine);
  if (partial === null) return null;

  // A palavra do cursor sai do texto (e a aspa que fecha, se a pessoa já a tem): o que ela escreve não é tabela nem fecha o texto.
  const closing = partial.quoted && text[cursor] === '"' ? 1 : 0;
  const blank = text.slice(0, partial.from) + " ".repeat(cursor + closing - partial.from) + text.slice(cursor + closing);
  const tokens = sqlTokens(blank, engine);
  const closes = parenthesesOf(tokens);
  const before = tokens.filter((token) => token.end <= partial.from).length;

  // O `;` antes do cursor, fora dos parênteses: ali começa outro comando.
  let terminators = 0;
  const enclosing: number[] = [];
  for (let index = 0; index < before; index++) {
    const token = tokens[index];
    if (token.word) continue;
    if (token.text === "(") enclosing.push(index);
    else if (token.text === ")") enclosing.pop();
    else if (token.text === ";" && enclosing.length === 0) terminators++;
  }
  if (terminators > 0) return null;

  // O nível do cursor é a subconsulta mais de dentro que o contém (um grupo que começa por `SELECT` ou `WITH`); sem ela, o comando todo.
  const scope = [...enclosing].reverse().find((open) => wordIs(tokens[open + 1], "select", "with"));
  const items = scope === undefined ? itemsOf(tokens, closes, 0, tokens.length) : itemsOf(tokens, closes, scope + 1, closes[scope]);
  const { references, derived } = readReferences(blank, items, engine);

  const used = new Set<string>([...derived, ...references.map((reference) => reference.alias ?? reference.name)].map((name) => name.toLowerCase()));
  const usesAliases = derived.length > 0 || references.some((reference) => reference.alias !== null);

  const context = contextAt(blank, tokens, items, references, before, partial, engine);
  return { references, used, usesAliases, offset: statement.start, context: context.kind === "none" ? context : { ...context, from: context.from + statement.start } };
}

function contextAt(sql: string, tokens: readonly SqlToken[], items: readonly Item[], references: readonly Reference[], before: number, partial: { from: number; quoted: boolean }, engine: Engine | undefined): CursorContext {
  const { from, quoted } = partial;

  // `nome.`: as partes do nome coladas pelo ponto, de trás para frente.
  const dot = tokens[before - 1];
  if (isDot(dot) && dot.end === from) {
    const qualifier: string[] = [];
    let index = before - 2;
    let next = dot.start;
    for (;;) {
      const part = tokens[index];
      if (!isName(sql, part) || part.end !== next) return none;
      const folded = nameOf(sql, part, engine);
      if (folded === null) return none;
      qualifier.unshift(folded);
      if (isDot(tokens[index - 1]) && tokens[index - 1].end === part.start && isName(sql, tokens[index - 2]) && tokens[index - 2].end === tokens[index - 1].start) {
        next = tokens[index - 1].start;
        index -= 2;
      } else break;
    }
    return qualifier.length > 3 ? none : { kind: "member", qualifier, from, quoted };
  }

  // Os itens do nível do cursor que vêm antes dele (um grupo aberto em que o cursor está não conta).
  const lead = items.filter((item) => item.end <= from);
  const last = lead[lead.length - 1];
  if (wordIs(last, "join") && !wordIs(lead[lead.length - 2], "cross", "natural")) return { kind: "join", from, quoted };
  if (wordIs(last, "on")) {
    const table = references.find((reference) => reference.via === "join" && reference.next === lead.length - 1);
    if (table !== undefined) return { kind: "on", table, from, quoted };
  }
  return none;
}

/** Uma tabela do comando que o catálogo conhece. */
export type ResolvedReference = { reference: Reference; schema: string; name: string };

/**
 * A tabela ou visão que um nome do comando é, pelo catálogo da árvore: com esquema (`esquema.tabela`), ou sem ele, pelo esquema padrão da sessão (`defaultSchemas`;
 * `null` é qualquer esquema, como o Informix), como em `tableLinkAt`. Nome que o catálogo não tem (uma expressão de tabela, uma tabela que a árvore ainda não abriu)
 * não resolve.
 */
export function resolveName(schema: string | null, name: string, catalog: LinkCatalog, defaultSchemas: readonly string[] | null): { schema: string; name: string } | null {
  if (schema !== null) return catalog.get(schema)?.has(name) === true ? { schema, name } : null;

  const found = (defaultSchemas ?? [...catalog.keys()]).find((candidate) => catalog.get(candidate)?.has(name) === true);
  return found === undefined ? null : { schema: found, name };
}

export function resolveReference(reference: Reference, catalog: LinkCatalog, defaultSchemas: readonly string[] | null): ResolvedReference | null {
  const resolved = resolveName(reference.schema, reference.name, catalog, defaultSchemas);
  return resolved === null ? null : { reference, ...resolved };
}

/**
 * A tabela que `nome.` (as partes de `qualifier`) é no comando: o apelido de uma tabela (`FROM pedidos p`, `p.`), o nome de uma tabela escrita sem apelido ou, no
 * catálogo, `tabela.` e `esquema.tabela.`. Um apelido vale mais que um nome de tabela do catálogo. `null` quando é outra coisa (um esquema, um apelido de subconsulta).
 */
export function resolveQualifier(qualifier: readonly string[], references: readonly Reference[], catalog: LinkCatalog, defaultSchemas: readonly string[] | null): { schema: string; name: string } | null {
  if (qualifier.length === 1) {
    const [name] = qualifier;
    const aliased = references.find((reference) => reference.alias === name);
    if (aliased !== undefined) return resolveName(aliased.schema, aliased.name, catalog, defaultSchemas);
    const written = references.find((reference) => reference.alias === null && reference.name === name);
    return resolveName(written?.schema ?? null, name, catalog, defaultSchemas);
  }
  return qualifier.length === 2 ? resolveName(qualifier[0], qualifier[1], catalog, defaultSchemas) : null;
}

/** A palavra reservada ou de cláusula não serve de apelido. */
export const isAliasWord = (word: string) => isReservedWord(word) || afterTable.has(word.toLowerCase());
