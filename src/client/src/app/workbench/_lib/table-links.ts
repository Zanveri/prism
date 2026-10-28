import type { Engine } from "@/components/ui";

import type { ObjectNames } from "./database-sessions.schema";
import { levelPathOf, type CachedLevel } from "./navigator-search";
import { isReservedWord } from "./sql-completion";
import { sqlTokens, type SqlToken } from "./sql-statements";

/**
 * RN-LINK-001: com Ctrl (⌘ no macOS), o nome de uma tabela ou visão no editor vira link para a aba dela nos Registros. Aqui fica o que decide, sem tocar o
 * editor: o catálogo (o que a árvore já carregou do banco da aba, o mesmo do autocompletar, sem consulta nova), o esquema padrão da sessão em cada banco e
 * qual nome está sob o ponteiro, pelo leitor de SQL do projeto (`sqlTokens`), que já deixa de fora o texto entre aspas simples e o comentário.
 */

const postgres: Engine = 1;
const db2: Engine = 2;

/** As tabelas e as visões de cada esquema, com o nome como o catálogo o guarda, na ordem da árvore. */
export type LinkCatalog = ReadonlyMap<string, ReadonlySet<string>>;

/** O trecho do texto que vira link (o nome inteiro, com o esquema e as aspas) e a tabela que ele abre. */
export type TableLink = { from: number; to: number; schema: string; name: string };

/** O catálogo do banco da aba: os níveis de tabelas e visões que a árvore já carregou (`cachedLevels`) e, quando já buscada, a lista de nomes do banco (`objectNames`); rotinas não entram. */
export function linkCatalog(levels: readonly CachedLevel[], objectNames?: ObjectNames): LinkCatalog {
  const catalog = new Map<string, Set<string>>();
  for (const { key, nodes } of levels) {
    const path = levelPathOf(key);
    if (path?.type !== "objects" || (path.objects !== "tables" && path.objects !== "views")) continue;
    const names = catalog.get(path.schema) ?? new Set<string>();
    for (const node of nodes) names.add(node.label);
    catalog.set(path.schema, names);
  }
  if (objectNames !== undefined) {
    for (const schema of objectNames.schemas) {
      const names = catalog.get(schema.name) ?? new Set<string>();
      for (const table of schema.tables) names.add(table);
      for (const view of schema.views) names.add(view);
      if (names.size > 0) catalog.set(schema.name, names);
    }
  }
  return catalog;
}

/**
 * O esquema em que o banco procura um nome sem esquema: no PostgreSQL, o do usuário e depois o `public` (o `search_path` padrão, `"$user", public`); no Db2, o do
 * usuário em maiúsculas (o `CURRENT SCHEMA` padrão é o usuário da conexão); no Informix, qualquer dono (`null`): num banco sem modo ANSI o nome da tabela não
 * se repete entre donos, e o nome sem dono acha a tabela.
 */
export function defaultSchemasOf(engine: Engine | undefined, userName: string | undefined): string[] | null {
  if (engine === db2) return userName === undefined ? [] : [userName.toUpperCase()];
  if (engine === postgres || engine === undefined) return userName === undefined ? ["public"] : [userName, "public"];
  return null;
}

/** O banco só dobra o ASCII: o PostgreSQL e o Informix para minúsculas, o Db2 para maiúsculas. */
const fold = (text: string, upper: boolean) => (upper ? text.replace(/[a-z]+/g, (part) => part.toUpperCase()) : text.replace(/[A-Z]+/g, (part) => part.toLowerCase()));

const isQuotedName = (sql: string, token: SqlToken) => !token.word && sql.charCodeAt(token.start) === 34;
export const isName = (sql: string, token: SqlToken | undefined): token is SqlToken => token !== undefined && (token.word || isQuotedName(sql, token));
export const isDot = (token: SqlToken | undefined) => token !== undefined && !token.word && token.text === ".";

/** O nome como o banco o lê: entre aspas duplas, como está escrito (a aspa de dentro é dobrada); sem elas, dobrado. `null`: a palavra reservada sem aspas não é nome. */
export function nameOf(sql: string, token: SqlToken, engine: Engine | undefined): string | null {
  if (isQuotedName(sql, token)) return sql.slice(token.start + 1, token.end - 1).replaceAll('""', '"');
  const written = sql.slice(token.start, token.end);
  return isReservedWord(written) ? null : fold(written, engine === db2);
}

/** O pedaço que cobre `offset` (o caractere sob o ponteiro), por busca binária: os pedaços estão em ordem e não se sobrepõem. */
function tokenIndexAt(tokens: readonly SqlToken[], offset: number): number {
  let low = 0;
  let high = tokens.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (tokens[middle].end <= offset) low = middle + 1;
    else if (tokens[middle].start > offset) high = middle - 1;
    else return middle;
  }
  return -1;
}

/**
 * RN-LINK-001: a tabela ou visão cujo nome cobre o caractere em `offset`, se o catálogo a conhece. O nome é `tabela` ou `esquema.tabela` (as partes coladas
 * pelo ponto), com ou sem aspas em cada parte, pelas regras de nome do banco; com três partes ou mais não é link (pode ser `banco.esquema.tabela` ou
 * `tabela.coluna` de outro esquema). Sem o esquema, vale o padrão da sessão (`defaultSchemasOf`; `null` é qualquer esquema). Texto entre aspas simples,
 * `$tag$ ... $tag$` e comentário não são pedaços de nome, e nada neles vira link. `tokens` é o resultado de `sqlTokens` para este texto, quando quem chama já o
 * tem (o editor o guarda enquanto o texto não muda).
 */
export function tableLinkAt(sql: string, offset: number, engine: Engine | undefined, catalog: LinkCatalog, defaultSchemas: readonly string[] | null, tokens: readonly SqlToken[] = sqlTokens(sql, engine)): TableLink | null {
  let index = tokenIndexAt(tokens, offset);
  if (index < 0) return null;
  // O ponteiro no ponto entre o esquema e a tabela: o nome é o do lado esquerdo.
  if (isDot(tokens[index]) && isName(sql, tokens[index - 1]) && tokens[index - 1].end === tokens[index].start) index--;
  if (!isName(sql, tokens[index])) return null;

  // As partes coladas pelo ponto, para os dois lados.
  let first = index;
  while (isDot(tokens[first - 1]) && tokens[first - 1].end === tokens[first].start && isName(sql, tokens[first - 2]) && tokens[first - 2].end === tokens[first - 1].start) first -= 2;
  let last = index;
  while (isDot(tokens[last + 1]) && tokens[last + 1].start === tokens[last].end && isName(sql, tokens[last + 2]) && tokens[last + 2].start === tokens[last + 1].end) last += 2;

  const parts = [];
  for (let at = first; at <= last; at += 2) parts.push(nameOf(sql, tokens[at], engine));
  if (parts.length > 2 || parts.some((part) => part === null)) return null;

  const span = { from: tokens[first].start, to: tokens[last].end };
  if (parts.length === 2) {
    const [schema, name] = parts as [string, string];
    return catalog.get(schema)?.has(name) === true ? { ...span, schema, name } : null;
  }

  const name = parts[0] as string;
  const schemas = defaultSchemas ?? [...catalog.keys()];
  const schema = schemas.find((candidate) => catalog.get(candidate)?.has(name) === true);
  return schema === undefined ? null : { ...span, schema, name };
}
