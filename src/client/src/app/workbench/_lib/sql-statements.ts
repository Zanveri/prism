import type { Engine } from "@/components/ui/engine-tag";

/**
 * Um comando dentro do texto do editor: `text` é `sql.slice(start, end)`, sem os espaços em volta e
 * sem o `;`. O comentário que vem antes do comando, no mesmo trecho, vai com ele.
 */
export type SqlStatement = { text: string; start: number; end: number };

/**
 * O comando e até onde ele vai no texto: a posição logo depois do `;` dele, ou o fim do texto quando não há `;`. `cut` diz que ele terminou numa
 * linha em branco (RN-SQL-018), e não no `;` nem no fim do texto.
 */
type Scanned = SqlStatement & { boundary: number; cut: boolean };

/**
 * O que muda de um banco para o outro na hora de separar os comandos (RN-SQL-002): no PostgreSQL e no
 * Db2 o comentário de bloco aceita outro dentro dele; no Informix o primeiro fecho o encerra e
 * `{ ... }` também é comentário. Só o PostgreSQL tem o bloco `$tag$ ... $tag$` (nos outros `$` é um
 * caractere qualquer) e só nele o `--` acaba também no retorno de carro; no Db2 e no Informix, só na
 * quebra de linha. `body` é o que cada banco entende por bloco com `;` no corpo (RN-SQL-001). `beginBlock` diz que o `BEGIN` abre um bloco que vai
 * até o fim do texto (no Db2, `db2Body`): para a linha em branco (RN-SQL-018), também quando ele não é a primeira palavra do comando.
 */
type Dialect = { nestedComments: boolean; braceComments: boolean; dollarQuotes: boolean; carriageReturnEndsComment: boolean; body: () => Body; beginBlock: boolean };

const postgres: Dialect = { nestedComments: true, braceComments: false, dollarQuotes: true, carriageReturnEndsComment: true, body: standardBody, beginBlock: false };

/** Pelo número do banco na API: PostgreSQL 1, Db2 2, Informix 3. */
const dialects: Record<Engine, Dialect> = {
  1: postgres,
  2: { nestedComments: true, braceComments: false, dollarQuotes: false, carriageReturnEndsComment: false, body: db2Body, beginBlock: true },
  3: { nestedComments: false, braceComments: true, dollarQuotes: false, carriageReturnEndsComment: false, body: informixBody, beginBlock: false },
};

/** Sem o banco, vale o PostgreSQL. */
const dialectOf = (engine: Engine | undefined): Dialect => (engine === undefined ? postgres : dialects[engine]);

const isWhitespace = (code: number) => code === 32 || (code >= 9 && code <= 13) || code === 160 || code === 0xfeff;

/** Letra, dígito, `_` ou qualquer caractere fora do ASCII: o que pode fazer parte de um nome. */
const isNameChar = (code: number) => (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code > 127;

const isDigit = (code: number) => code >= 48 && code <= 57;

/** A posição logo depois da próxima ocorrência de `closing`, ou o fim do texto quando o trecho não fecha. */
function after(sql: string, closing: string, from: number): number {
  const found = sql.indexOf(closing, from);
  return found < 0 ? sql.length : found + closing.length;
}

/** Texto entre aspas: a aspa dobrada (`''`, `""`) é uma aspa dentro do texto, e não o fim dele. */
function afterQuoted(sql: string, quote: string, from: number): number {
  let position = from;
  for (;;) {
    const found = sql.indexOf(quote, position);
    if (found < 0) return sql.length;
    if (sql[found + 1] !== quote) return found + 1;
    position = found + 2;
  }
}

/** A posição logo depois do fim da linha de um comentário `--`: a quebra de linha e, onde o banco também a aceita, o retorno de carro. */
function afterLine(sql: string, from: number, carriageReturn: boolean): number {
  if (!carriageReturn) return after(sql, "\n", from);

  // Um laço curto, e não `indexOf("\r")`: sem nenhum `\r` no texto, cada comentário o leria até o fim.
  for (let position = from; position < sql.length; position++) {
    const code = sql.charCodeAt(position);
    if (code === 10 || code === 13) return position + 1;
  }
  return sql.length;
}

/** Comentário de bloco que aceita outro dentro dele (PostgreSQL e Db2): só o fecho do primeiro o encerra. */
function afterNestedComment(sql: string, from: number): number {
  // Uma passada, com a profundidade num contador: `hasStatement` roda a cada tecla, e procurar o próximo `/*` a cada fecho custava
  // o texto inteiro vezes a profundidade.
  let depth = 1;
  let position = from;
  while (position < sql.length) {
    const code = sql.charCodeAt(position);
    const next = sql.charCodeAt(position + 1);

    if (code === 47 && next === 42) {
      depth++;
      position += 2;
    } else if (code === 42 && next === 47) {
      position += 2;
      if (--depth === 0) return position;
    } else position++;
  }
  return sql.length;
}

/**
 * A posição logo depois do comentário que começa em `at`, ou `null` quando ali não começa um:
 * `-- até o fim da linha`, o de bloco e, no Informix, `{ ... }`.
 */
function afterComment(sql: string, at: number, dialect: Dialect): number | null {
  const code = sql.charCodeAt(at);

  if (code === 45) return sql.charCodeAt(at + 1) === 45 ? afterLine(sql, at + 2, dialect.carriageReturnEndsComment) : null;
  if (code === 47) {
    if (sql.charCodeAt(at + 1) !== 42) return null;
    return dialect.nestedComments ? afterNestedComment(sql, at + 2) : after(sql, "*/", at + 2);
  }
  return code === 123 && dialect.braceComments ? after(sql, "}", at + 1) : null;
}

/**
 * O `$tag$` que abre um bloco do PostgreSQL em `at`, ou `null`. `$1` é parâmetro (a marca não
 * começa com dígito) e o `$` no meio de um nome (`a$b`) faz parte do nome.
 */
function dollarTag(sql: string, at: number): string | null {
  if (at > 0 && isNameChar(sql.charCodeAt(at - 1))) return null;

  let end = at + 1;
  if (isDigit(sql.charCodeAt(end))) return null;
  while (end < sql.length && isNameChar(sql.charCodeAt(end))) end++;

  return sql[end] === "$" ? sql.slice(at, end + 1) : null;
}

/**
 * Percorre o texto uma vez, pulando o que não separa: texto entre aspas simples, nome entre aspas
 * duplas, comentário e bloco `$tag$ ... $tag$` (RN-SQL-002). Os saltos usam `indexOf`, para um
 * texto de 1 MB separar em poucos milissegundos. Trecho que só tem espaços e comentários não é
 * comando: depois do último `;`, um comentário solto não vira o "comando do cursor".
 *
 * `cuts` são as linhas em branco que também separam (RN-SQL-018, de `blankLineCuts`), em ordem: o começo de cada uma. O comando de cima
 * acaba no fim da linha anterior (o `\n` logo antes do corte), que é também até onde vai o cursor dele.
 *
 * `inner` são os `;` que não separam, por estarem no corpo de um bloco (RN-SQL-001, de `innerSemicolons`): só o script os passa (RN-SQL-019).
 */
function scan(sql: string, dialect: Dialect, cuts: readonly number[] = [], inner: ReadonlySet<number> = noSemicolons): Scanned[] {
  const statements: Scanned[] = [];
  let segmentStart = 0;
  let hasCode = false;

  function close(semicolon: number, boundary: number, cut = false) {
    let start = segmentStart;
    let end = semicolon;
    while (start < end && isWhitespace(sql.charCodeAt(start))) start++;
    while (end > start && isWhitespace(sql.charCodeAt(end - 1))) end--;
    if (hasCode) statements.push({ text: sql.slice(start, end), start, end, boundary, cut });
    segmentStart = boundary;
    hasCode = false;
  }

  let position = 0;
  let cut = 0;
  while (position < sql.length) {
    // O corte cai sempre entre dois pedaços do texto, fora de aspas e de comentário: a leitura passa exatamente por ele (o `--` que acaba na
    // quebra de linha para logo antes da linha em branco).
    if (cut < cuts.length && position >= cuts[cut]) {
      close(cuts[cut] - 1, cuts[cut] - 1, true);
      cut++;
    }

    const code = sql.charCodeAt(position);

    if (code === 59) {
      if (inner.has(position)) hasCode = true;
      else close(position, position + 1);
      position++;
      continue;
    }

    // Só `-`, `/` e `{` podem abrir um comentário: o resto do texto não paga a pergunta.
    const comment = code === 45 || code === 47 || code === 123 ? afterComment(sql, position, dialect) : null;
    if (comment !== null) {
      position = comment;
      continue;
    }

    if (!isWhitespace(code)) hasCode = true;

    if (code === 39) position = afterQuoted(sql, "'", position + 1);
    else if (code === 34) position = afterQuoted(sql, '"', position + 1);
    else if (code === 36 && dialect.dollarQuotes) {
      const tag = dollarTag(sql, position);
      position = tag === null ? position + 1 : after(sql, tag, position + tag.length);
    } else position++;
  }
  close(sql.length, sql.length);

  return statements;
}

const toStatement = ({ text, start, end }: Scanned): SqlStatement => ({ text, start, end });

/**
 * Como achar os comandos do texto. `blankLines` é a preferência "A linha em branco separa os comandos" (RN-SQL-018), que vale só para o
 * comando do cursor; sem ela, só o `;` separa, como antes.
 */
export type StatementOptions = { blankLines?: boolean };

const noSemicolons: ReadonlySet<number> = new Set();

/** Os comandos do texto, separados por `;` (RN-SQL-002) e, com `blankLines`, pela linha em branco (RN-SQL-018), pelas regras do banco da aba. */
export function splitStatements(sql: string, engine?: Engine, { blankLines = false }: StatementOptions = {}): SqlStatement[] {
  const dialect = dialectOf(engine);
  return scan(sql, dialect, blankLines ? blankLineCuts(sql, dialect) : []).map(toStatement);
}

/**
 * Um pedaço do comando: a palavra (em minúsculas), o texto entre aspas, o nome entre aspas duplas ou `$tag$ ... $tag$` (sempre `'`) ou um caractere
 * qualquer. `start` e `end` dizem onde ele está no texto: `sql.slice(start, end)` é o pedaço como foi escrito.
 */
export type SqlToken = { text: string; word: boolean; start: number; end: number };

const piece = (text: string, start: number, end: number): SqlToken => ({ text, word: false, start, end });

/**
 * O texto em pedaços, sem espaços nem comentários, como a API o lê (`SqlText.Tokens`). O `statementCount` o usa uma vez por
 * execução: o caminho de cada tecla (`hasStatement`) não passa por aqui.
 */
function* tokens(sql: string, dialect: Dialect): Generator<SqlToken> {
  let position = 0;
  while (position < sql.length) {
    const start = position;
    const code = sql.charCodeAt(position);
    const comment = afterComment(sql, position, dialect);
    const tag = code === 36 && dialect.dollarQuotes ? dollarTag(sql, position) : null;

    if (comment !== null) position = comment;
    else if (isWhitespace(code)) position++;
    else if (code === 39 || code === 34) {
      position = afterQuoted(sql, sql[position], position + 1);
      yield piece("'", start, position);
    } else if (tag !== null) {
      position = after(sql, tag, position + tag.length);
      yield piece("'", start, position);
    } else if (isNameChar(code)) {
      // No PostgreSQL o `$` continua o nome (`a$b`), como em `dollarTag`.
      while (position < sql.length && (isNameChar(sql.charCodeAt(position)) || (dialect.dollarQuotes && sql.charCodeAt(position) === 36))) position++;
      // O banco só iguala maiúsculas e minúsculas do ASCII, e `toLowerCase` basta: nenhum caractere de fora do ASCII vira uma palavra da
      // regra (o İ do turco vira `i` mais um acento, `BEGİN` não é `begin`; o K de Kelvin, U+212A, vira `k`, e nenhuma delas tem `k`).
      // Se uma palavra com `k` entrar na regra, comparar só palavras inteiras de ASCII.
      yield { text: sql.slice(start, position).toLowerCase(), word: true, start, end: position };
    } else {
      position++;
      yield piece(sql[start], start, position);
    }
  }
}

/**
 * Os pedaços do texto, na ordem, pelas regras do banco (as mesmas de `statementCount`), para quem precisa achar uma palavra FORA de texto entre
 * aspas, de nome entre aspas duplas, de comentário e de `$tag$ ... $tag$`: a ordem no filtro dos registros (`table-sql.ts`). É o leitor único do
 * projeto: quem precisar de outra pergunta sobre o texto de um comando a faz sobre estes pedaços, e não com outro leitor.
 */
export function sqlTokens(sql: string, engine?: Engine): SqlToken[] {
  return [...tokens(sql, dialectOf(engine))];
}

/**
 * O corpo de um comando que pode ter `;` dentro (RN-SQL-001), um novo a cada comando. `next` recebe os pedaços do
 * comando, `;` inclusive; `open` diz se um `;` agora ainda é do corpo e não separa; `extra` são os comandos a mais que um
 * corpo ainda aberto no fim do texto tem (a rotina do Informix sem fim, em que todo `;` separa).
 */
type Body = { next: (token: SqlToken) => void; open: () => boolean; extra: () => number };

/** O que fica entre `CREATE` e o tipo do objeto não conta como palavra do começo do comando (`SqlText.HasSeveralStatements`). */
const beforeKind = new Set([";", "or", "replace", "dba"]);

const isRoutine = (kind: string | undefined) => kind === "procedure" || kind === "function";

/**
 * Db2: o texto que começa por `CREATE [OR REPLACE] PROCEDURE|FUNCTION|TRIGGER`, ou por `BEGIN`, é um comando só até o fim do
 * texto. O driver da IBM manda inteiro o que começa assim, e o banco recusa, sem executar nada, o que vier depois do fim do bloco.
 */
function db2Body(): Body {
  const words: string[] = [];
  let block = false;

  return {
    next({ text }) {
      if (block || words.length === 2 || beforeKind.has(text)) return;
      words.push(text);
      block = words[0] === "begin" || (words[0] === "create" && (isRoutine(words[1]) || words[1] === "trigger"));
    },
    open: () => block,
    extra: () => 0,
  };
}

/**
 * Informix: `CREATE [OR REPLACE] [DBA] PROCEDURE|FUNCTION` vai até o `END PROCEDURE` ou o `END FUNCTION`, e depois dele o `;` volta a
 * separar. Sem o fim (a rotina externa não tem corpo) todo `;` separa, e `extra` conta os que têm mais texto atrás. O gatilho do
 * Informix não tem `;` no corpo, e o `BEGIN` não abre bloco.
 */
function informixBody(): Body {
  const words: string[] = [];
  let routine = false;
  let previous = "";
  let afterSemicolon = false;
  let held = 0;

  return {
    next({ text }) {
      if (text === ";") {
        afterSemicolon = routine;
        return;
      }
      if (afterSemicolon) held++;
      afterSemicolon = false;

      if (routine && previous === "end" && isRoutine(text)) {
        routine = false;
        held = 0;
      } else if (words.length < 2 && !beforeKind.has(text)) {
        words.push(text);
        routine = words.length === 2 && words[0] === "create" && isRoutine(words[1]);
      }
      previous = text;
    },
    open: () => routine,
    extra: () => held,
  };
}

/**
 * PostgreSQL: o corpo no padrão SQL, `CREATE [OR REPLACE] FUNCTION|PROCEDURE ... BEGIN ATOMIC ... END`, pela regra do `psql`. Dentro
 * desse comando `BEGIN` soma um à profundidade, `CASE` soma um quando ela já passa de zero e `END` tira um; o `;` só separa com
 * profundidade zero. O `psql` olha só as quatro primeiras palavras do comando, não conta as que estão entre aspas e só mexe na
 * profundidade com os parênteses em zero: `begin` é palavra não reservada e serve de nome de parâmetro e de coluna (`f(begin int)`).
 * O `)` sem `(` antes não leva a conta abaixo de zero.
 */
function standardBody(): Body {
  const words: string[] = [];
  let routine = false;
  let depth = 0;
  let parentheses = 0;

  return {
    next({ text, word }) {
      if (!word) {
        if (text === "(") parentheses++;
        else if (text === ")" && parentheses > 0) parentheses--;
        return;
      }
      if (words.length < 4) {
        words.push(text);
        routine = words[0] === "create" && (isRoutine(words[1]) || (words[1] === "or" && words[2] === "replace" && isRoutine(words[3])));
      }

      if (!routine || parentheses > 0) return;
      if (text === "begin") depth++;
      else if (text === "case" && depth > 0) depth++;
      else if (text === "end" && depth > 0) depth--;
    },
    open: () => depth > 0,
    extra: () => 0,
  };
}

/**
 * Quantos comandos o texto tem. Uma execução leva um só (RN-SQL-001): com mais de um na seleção a
 * tela avisa e não envia; com nenhum, não há o que enviar. O que separa é o `;`, menos o que está num
 * bloco com `;` no corpo (procedimento, função, gatilho, bloco composto): ele é um comando só, pelas
 * regras do banco da aba, as mesmas que a API aplica (`SqlText.HasSeveralStatements`). A regra vale
 * aqui e nos comandos do script (`scriptStatements`, RN-SQL-019, pelo mesmo corpo): `splitStatements` e
 * `statementAt`, que acham o comando do cursor, seguem separando pelo `;` (a linha em branco, RN-SQL-018,
 * é que nunca separa dentro do bloco). A conta é sempre só pelo `;`: a linha em branco não divide a seleção.
 */
export function statementCount(sql: string, engine?: Engine): number {
  const dialect = dialectOf(engine);
  let count = 0;
  let started = false;
  let body = dialect.body();

  for (const token of tokens(sql, dialect)) {
    body.next(token);

    if (token.text !== ";") started = true;
    else if (!body.open()) {
      if (started) count++;
      started = false;
      body = dialect.body();
    }
  }
  return count + (started ? 1 : 0) + body.extra();
}

/*
 * A linha em branco que separa os comandos (RN-SQL-018), como o "Smart" do DBeaver, com mais cuidado: só a conexão que pede confirma o comando
 * irreversível (RN-PROT-001), e separar onde não devia executaria a metade de um comando (`DELETE FROM t`, a linha em branco e `WHERE id = 1`). Na dúvida
 * não separa: o banco recusa o texto inteiro, sem executar nada. Separa só quando o de baixo começa um comando e o de cima está fechado.
 */

/** As palavras que começam um comando depois da linha em branco. `SET` não está (`UPDATE t`, a linha em branco e `SET …` são um comando só), nem `BEGIN`, que abre bloco. */
const commandWords = new Set(["select", "insert", "update", "delete", "merge", "values", "create", "truncate", "grant", "revoke", "call", "execute", "exec", "explain", "analyze", "analyse", "vacuum", "show", "copy", "declare", "commit", "rollback", "savepoint"]);

/** Dentro de um `ALTER`, estas são cláusulas dele (`ALTER TABLE t … DROP COLUMN`, `ALTER EXTENSION e DROP TABLE t`, `ALTER DEFAULT PRIVILEGES … GRANT`), e não outro comando. */
const alterClauses = new Set(["alter", "drop", "grant", "revoke"]);

/**
 * O que vem depois de `ALTER` e `DROP` quando eles começam um comando: o tipo do objeto. O resto é cláusula de outro comando (o `DROP STORAGE`
 * do `TRUNCATE` no Db2 e no Informix, o `ALTER COLUMN` e o `DROP CONSTRAINT` do `ALTER TABLE`). `MATERIALIZED` e `FOREIGN` pedem a palavra seguinte.
 */
const objectKinds = new Set([
  "table", "view", "index", "sequence", "schema", "function", "procedure", "routine", "trigger", "type", "domain", "database", "user", "role", "synonym",
  "alias", "extension", "tablespace", "module", "nickname", "variable", "package", "server", "publication", "subscription", "policy", "rule", "aggregate",
  "operator", "collation", "statistics", "owned", "system", "language", "cast", "event",
]);

/** As palavras que pedem continuação no fim do comando de cima: com elas, o que vem depois da linha em branco ainda é dele. */
const continuationWords = new Set([
  "where", "and", "or", "not", "on", "join", "inner", "outer", "left", "right", "full", "cross", "natural", "lateral", "from", "select", "set", "by",
  "group", "order", "partition", "having", "union", "all", "intersect", "except", "minus", "then", "else", "when", "case", "as", "in", "into", "values",
  "like", "ilike", "similar", "between", "is", "distinct", "unique", "using", "with", "recursive", "table", "grant", "revoke", "to", "for", "of", "over",
  "escape", "any", "some", "exists", "limit", "offset", "returning", "window", "filter", "within", "collate", "at", "if", "do", "also", "instead",
  "explain", "vacuum", "call", "execute", "exec", "declare", "lock", "release",
]);

/** O fim que pede continuação, além do `(` (os parênteses abertos já mantêm o comando aberto): a vírgula e os operadores. */
const continuationMarks = new Set([",", "+", "-", "*", "/", "%", "=", "<", ">", "!", "|", "&", "^", "~", ".", ":", "@", "#", "["]);

/** Antes destas, `INSERT` é o nome de um evento ou de um privilégio (`AFTER INSERT`, `ON INSERT`, `GRANT SELECT, INSERT`), e não o começo de um comando. */
const insertEvents = new Set([",", "on", "of", "or", "before", "after", "grant", "revoke"]);

/** O que dá ao `INSERT` o corpo que ele espera (o `EXECUTE PROCEDURE` do Informix incluído). */
const insertBodies = new Set(["values", "select", "execute"]);

/** O comando principal depois das consultas do `WITH`, e o comando que o `EXPLAIN` explica. */
const withBodies = new Set(["select", "insert", "update", "delete", "merge", "values"]);
const explainBodies = new Set([...withBodies, "with", "execute", "create", "declare", "table"]);

/** Entre `CREATE` e o tipo do objeto que só o `;` termina (`CREATE OR REPLACE CONSTRAINT TRIGGER`, `CREATE EVENT TRIGGER`). */
const beforeTrigger = new Set(["or", "replace", "constraint", "event"]);

/**
 * O que vem depois de `CREATE` nos comandos que só o `;` termina. O gatilho: no Db2 ele é um bloco (`db2Body`), e no PostgreSQL e no Informix o
 * corpo vem depois do cabeçalho. O esquema: o `CREATE SCHEMA` traz os objetos dele (`CREATE TABLE`, `CREATE VIEW`, `CREATE INDEX`, `GRANT` e, no
 * Db2, `COMMENT ON`) sem `;` entre eles, nos três bancos, e separá-lo criaria o esquema sozinho e depois a tabela fora dele.
 */
const untilSemicolon = new Set(["trigger", "schema"]);

/** A posição, na lista, logo depois do `)` que fecha o `(` de `at`; o fim da lista quando ele não fecha. */
function afterParentheses(list: readonly SqlToken[], at: number): number {
  let depth = 0;
  for (let index = at; index < list.length; index++) {
    if (list[index].text === "(") depth++;
    else if (list[index].text === ")" && --depth === 0) return index + 1;
  }
  return list.length;
}

/**
 * Se o `WITH` em `index` abre consultas nomeadas: `WITH [RECURSIVE] nome [ ( … ) ] AS [ [NOT] MATERIALIZED ] (`. É o que separa o comando do
 * `WITH UR|CS|RS|RR` do Db2, do `WITH TIME ZONE`, do `WITH ORDINALITY`, do `WITH CHECK OPTION`, do `WITH NO DATA` e do `WITH (opções)`.
 */
function opensQueries(list: readonly SqlToken[], index: number): boolean {
  let at = index + 1;
  if (list[at]?.text === "recursive") at++;

  const name = list[at];
  if (name === undefined || !(name.word || name.text === "'")) return false;
  at++;
  if (list[at]?.text === "(") at = afterParentheses(list, at);
  if (list[at]?.text !== "as") return false;
  at++;
  if (list[at]?.text === "not") at++;
  if (list[at]?.text === "materialized") at++;
  return list[at]?.text === "(";
}

/** Se `ALTER` ou `DROP` (em `at - 1`) começam um comando: o tipo do objeto vem depois. */
function namesObject(list: readonly SqlToken[], at: number): boolean {
  const kind = list[at]?.text;
  const next = list[at + 1]?.text;
  if (kind === "materialized") return next === "view";
  if (kind === "foreign") return next === "table" || next === "data";
  return kind !== undefined && objectKinds.has(kind);
}

/** Se o pedaço em `index`, logo depois da linha em branco, começa um comando. `first` é a primeira palavra do comando de cima. */
function startsCommand(list: readonly SqlToken[], index: number, first: string | undefined): boolean {
  const { text, word } = list[index];
  if (!word || (first === "alter" && alterClauses.has(text))) return false;

  const next = list[index + 1]?.text;
  switch (text) {
    case "with":
      return opensQueries(list, index);
    case "alter":
    case "drop":
      return namesObject(list, index + 1);
    case "comment":
      return next === "on";
    case "lock":
      return next === "table";
    case "refresh":
      return next === "materialized" || next === "table";
    // O `DO` do PostgreSQL, com o corpo entre aspas ou `$$`; o `DO` do `ON CONFLICT DO` e da regra (`DO INSTEAD`) não é comando.
    case "do":
      return next === "'" || next === "language";
    default:
      return commandWords.has(text);
  }
}

/** O comando de cima, desde o último `;` ou a última linha em branco que separou, para dizer se ele já pode acabar (RN-SQL-018). Um novo a cada comando. */
type CommandAbove = { next: (token: SqlToken, index: number) => void; started: () => boolean; open: () => boolean; first: () => string | undefined };

function commandAbove(list: readonly SqlToken[]): CommandAbove {
  const words: string[] = [];
  let depth = 0;
  let last: SqlToken | undefined;
  let beforeLast: SqlToken | undefined;
  // O que ainda espera o resto: o INSERT antes do VALUES ou do SELECT, o WITH antes do comando principal, o EXPLAIN antes do comando. E o
  // CREATE TRIGGER e o CREATE SCHEMA, que só o `;` termina (`untilSemicolon`).
  let insert = false;
  let queries = false;
  let explain = false;
  let semicolonOnly = false;

  return {
    next(token, index) {
      const { text } = token;

      if (!token.word) {
        if (text === "(") depth++;
        else if (text === ")" && depth > 0) depth--;
      } else {
        if (words.length === 0) explain = text === "explain";
        else if (explain && depth === 0 && explainBodies.has(text)) explain = false;
        if (words.length < 5) {
          words.push(text);
          semicolonOnly ||= words[0] === "create" && untilSemicolon.has(words.slice(1).find((word) => !beforeTrigger.has(word)) ?? "");
        }

        if (text === "insert") insert ||= !insertEvents.has(last?.text ?? "");
        else if (insertBodies.has(text)) insert = false;

        if (text === "with" && depth === 0 && opensQueries(list, index)) queries = true;
        else if (queries && depth === 0 && withBodies.has(text)) queries = false;
      }

      beforeLast = last;
      last = token;
    },
    started: () => last !== undefined,
    open() {
      if (depth > 0 || insert || queries || explain || semicolonOnly) return true;
      if (last === undefined) return false;
      if (!last.word) return continuationMarks.has(last.text);

      const before = beforeLast?.text;
      switch (last.text) {
        // `SET EXPLAIN ON` do Informix, `SET x = on`, `ALTER SYSTEM SET x TO on`: aqui o ON é um valor.
        case "on":
          return !(before === "=" || before === "to" || words[0] === "set");
        // `INSERT INTO t DEFAULT VALUES` acabou.
        case "values":
          return before !== "default";
        // `ON COMMIT DELETE ROWS` do Db2 e do PostgreSQL: o DELETE de baixo é do comando de cima.
        case "commit":
          return before === "on";
        default:
          return continuationWords.has(last.text);
      }
    },
    first: () => words[0],
  };
}

/**
 * As linhas em branco entre dois pedaços do texto, ou `null` quando não há nenhuma: o começo da primeira, onde o comando de cima acaba, e o da
 * última que vem depois de um comentário (`loose`), que solta esse comentário do comando de baixo. Entre os dois pedaços só há espaços e comentários: a linha
 * que tem um comentário não é branca, e a quebra de linha que fecha um `--` começa a linha seguinte. Um comentário de bloco com linhas em branco
 * dentro não tem linha em branco nenhuma. A primeira linha do texto nunca conta: antes dela não há o que separar.
 */
function blankLinesBetween(sql: string, from: number, to: number, dialect: Dialect): { first: number; loose: number | null } | null {
  // O começo da linha em que a leitura está enquanto ela só tem espaços; -1 quando ela já tem outra coisa (o pedaço de cima, um comentário).
  let line = -1;
  let first: number | null = null;
  let loose: number | null = null;
  let commented = false;

  let position = from;
  while (position < to) {
    const code = sql.charCodeAt(position);
    if (code === 10) {
      if (line >= 0) {
        first ??= line;
        if (commented) loose = line;
      }
      line = ++position;
      continue;
    }

    const comment = code === 45 || code === 47 || code === 123 ? afterComment(sql, position, dialect) : null;
    if (comment === null) position++;
    else {
      commented = true;
      line = sql.charCodeAt(comment - 1) === 10 ? comment : -1;
      position = comment;
    }
  }
  return first === null ? null : { first, loose };
}

/**
 * Onde a linha em branco separa os comandos (RN-SQL-018), em ordem: o começo da primeira linha em branco entre o comando de cima e o de baixo, e
 * o da última antes do comando de baixo quando há comentário entre elas (o comentário logo acima do comando vai com ele; o que tem uma linha em
 * branco antes do comando, não). Nunca dentro de texto, de nome entre aspas, de comentário nem de `$tag$ ... $tag$` (os pedaços de `tokens` já
 * os pulam), nem dentro de um bloco com `;` no corpo: o corpo é o mesmo de `statementCount`, que só recomeça num `;` fora dele (no Db2, o bloco
 * vai até o fim do texto, e começa também no `BEGIN` que não é a primeira palavra do comando).
 */
function blankLineCuts(sql: string, dialect: Dialect): number[] {
  const list = [...tokens(sql, dialect)];
  const cuts: number[] = [];
  let body = dialect.body();
  let command = commandAbove(list);

  for (let index = 0; index < list.length; index++) {
    const token = list[index];
    const from = index === 0 ? 0 : list[index - 1].end;

    // Uma linha em branco precisa de duas quebras de linha: o espaço de um caractere entre dois pedaços, o caso comum, nem é lido.
    if (token.start - from > 1 && command.started() && !body.open() && !command.open()) {
      const blank = blankLinesBetween(sql, from, token.start, dialect);
      if (blank !== null && startsCommand(list, index, command.first())) {
        cuts.push(blank.first);
        body = dialect.body();
        command = commandAbove(list);
      }
    }

    if (!command.started() && !body.open() && token.text !== ";") {
      const loose = blankLinesBetween(sql, from, token.start, dialect)?.loose ?? null;
      if (loose !== null && loose > (cuts.at(-1) ?? 0)) cuts.push(loose);
    }

    // O `db2Body` só vê o bloco nas primeiras palavras do comando, e o `BEGIN` não começa comando: depois de uma linha em branco (`SELECT …`, a
    // linha em branco e `BEGIN … END`), de um rótulo (`nome: BEGIN`) ou do `ALTER MODULE … ADD PROCEDURE`, o primeiro `;` do bloco recomeçaria a
    // conta, e a linha em branco seguinte separaria o `DELETE` de dentro dele. O bloco vai até o fim do texto: dali em diante, nada separa.
    if (dialect.beginBlock && token.text === "begin") return cuts;

    body.next(token);
    if (token.text === ";") {
      if (!body.open()) body = dialect.body();
      command = commandAbove(list);
    } else command.next(token, index);
  }
  return cuts;
}

/** Se de `from` até `to` só há espaços e quebras de linha. */
function onlyWhitespace(sql: string, from: number, to: number): boolean {
  for (let position = from; position < to; position++) if (!isWhitespace(sql.charCodeAt(position))) return false;
  return true;
}

/** Se a linha em que está `offset` só tem espaços (RN-SQL-018). */
function isBlankLine(sql: string, offset: number): boolean {
  const start = offset === 0 ? 0 : sql.lastIndexOf("\n", offset - 1) + 1;
  const found = sql.indexOf("\n", offset);
  return onlyWhitespace(sql, start, found < 0 ? sql.length : found);
}

/**
 * Se o cursor está numa das linhas em branco onde a RN-SQL-018 separou: a linha dele só tem espaços, e entre ela e a de um corte (o começo de uma
 * linha em branco, de `blankLineCuts`) só há outras linhas em branco. A linha em branco depois de um `;` não separou nada.
 */
function onBlankLineCut(sql: string, offset: number, cuts: readonly number[]): boolean {
  if (cuts.length === 0 || !isBlankLine(sql, offset)) return false;

  const after = cuts.findIndex((cut) => cut > offset);
  const before = after < 0 ? cuts.at(-1) : cuts[after - 1];
  const next = after < 0 ? undefined : cuts[after];
  return (before !== undefined && onlyWhitespace(sql, before, offset)) || (next !== undefined && onlyWhitespace(sql, offset, next));
}

/**
 * O comando onde está o cursor (RN-SQL-001): o primeiro que termina no cursor ou depois dele,
 * contando o `;` como parte do comando (logo depois do `;`, ainda é o comando que ele fecha). Com
 * o cursor depois do último comando, é o último. `null` quando o texto não tem comando.
 *
 * Com `blankLines` (RN-SQL-018), a linha em branco também separa. O cursor numa das linhas em branco que terminaram o comando de cima fica com ele,
 * como no DBeaver (também com um comentário solto no meio). Na linha em branco sem comando nenhum acima (no começo do texto, ou só com comentários
 * acima), `null`, mesmo que haja um abaixo: "se não há nada acima, nada abaixo também". Nas outras linhas em branco fora de comando (depois de um
 * comando terminado no `;`) a resposta é a de antes, o comando seguinte: o `;` não muda de resposta com a preferência ligada.
 */
export function statementAt(sql: string, offset: number, engine?: Engine, { blankLines = false }: StatementOptions = {}): SqlStatement | null {
  const dialect = dialectOf(engine);
  const cuts = blankLines ? blankLineCuts(sql, dialect) : [];
  const statements = scan(sql, dialect, cuts);
  const found = statements.find((statement) => offset <= statement.boundary) ?? statements.at(-1);
  if (found === undefined) return null;

  if (blankLines && (offset < found.start || offset > found.end) && isBlankLine(sql, offset)) {
    const previous = statements.findLast((statement) => statement.end <= offset);
    if (previous === undefined) return null;
    // O de cima que terminou no `;` não é desta regra: vale a resposta de antes.
    if (previous.cut && onBlankLineCut(sql, offset, cuts)) return toStatement(previous);
  }
  return toStatement(found);
}

/**
 * Os `;` que ficam no corpo de um bloco e não separam (RN-SQL-001): o corpo é o mesmo de `statementCount` (`dialect.body()`), que recomeça no `;` que
 * fecha e em cada corte da linha em branco (RN-SQL-018: `blankLineCuts` nunca corta com o corpo aberto, e o comando de baixo começa um corpo novo, como
 * lá). Um corpo que chega aberto ao fim do texto prende os `;` dele, menos quando o banco diz que eles separam (`extra`: a rotina do Informix sem o
 * `END PROCEDURE`, em que todo `;` separa, a mesma conta de `statementCount`).
 */
function innerSemicolons(sql: string, dialect: Dialect, cuts: readonly number[]): Set<number> {
  const inner = new Set<number>();
  let held: number[] = [];
  let body = dialect.body();
  let cut = 0;

  for (const token of tokens(sql, dialect)) {
    if (cut < cuts.length && token.start >= cuts[cut]) {
      while (cut < cuts.length && token.start >= cuts[cut]) cut++;
      for (const position of held) inner.add(position);
      held = [];
      body = dialect.body();
    }

    body.next(token);
    if (token.text !== ";") continue;
    if (body.open()) held.push(token.start);
    else {
      for (const position of held) inner.add(position);
      held = [];
      body = dialect.body();
    }
  }
  if (body.extra() === 0) for (const position of held) inner.add(position);
  return inner;
}

/**
 * Os comandos do script (RN-SQL-019), na ordem: o texto inteiro do editor, ou a seleção, dividido pelas regras do Ctrl+Enter, com o mesmo leitor
 * (`scan`): o `;` (RN-SQL-002) e, com `blankLines`, a linha em branco (RN-SQL-018), que no script divide também a seleção. Ao contrário de
 * `splitStatements`, o bloco com `;` no corpo (rotina, gatilho, bloco composto; no Db2, até o fim do texto) é um comando só, pela conta de
 * `statementCount`: cada comando daqui conta 1 lá, e a API, que repete a conferência, o aceita. O pedaço só com espaços, `;` e comentários não é
 * comando. `start` e `end` são posições em `sql`.
 */
export function scriptStatements(sql: string, engine?: Engine, { blankLines = false }: StatementOptions = {}): SqlStatement[] {
  const dialect = dialectOf(engine);
  const cuts = blankLines ? blankLineCuts(sql, dialect) : [];
  return scan(sql, dialect, cuts, innerSemicolons(sql, dialect, cuts)).map(toStatement);
}

/**
 * Se o texto tem algum comando: algo além de espaços, `;` e comentários. É a pergunta do botão
 * "Executar", feita a cada tecla, e por isso para no primeiro caractere de comando que achar.
 */
export function hasStatement(sql: string, engine?: Engine): boolean {
  const dialect = dialectOf(engine);

  let position = 0;
  while (position < sql.length) {
    const code = sql.charCodeAt(position);
    const comment = afterComment(sql, position, dialect);

    if (comment !== null) position = comment;
    else if (code === 59 || isWhitespace(code)) position++;
    else return true;
  }
  return false;
}

/**
 * Se o caractere em `index` é de um comentário, pelas regras do banco (as mesmas de `splitStatements`): `-- até o fim da linha`, o de bloco
 * e, no Informix, `{ ... }`. Quem pergunta é o editor, para o que a gramática dele não lê: o `lang-sql` não conhece o `{ ... }` do Informix, e
 * a palavra-chave escrita ali parece código. A chave dentro de texto entre aspas, de nome entre aspas duplas, de `$tag$ ... $tag$` ou de outro
 * comentário não abre nada: o texto é lido desde o começo, como em `scan`, e pára no primeiro trecho que cobre `index`.
 */
export function isInsideComment(sql: string, index: number, engine?: Engine): boolean {
  const dialect = dialectOf(engine);

  let position = 0;
  while (position <= index && position < sql.length) {
    const code = sql.charCodeAt(position);

    const comment = code === 45 || code === 47 || code === 123 ? afterComment(sql, position, dialect) : null;
    if (comment !== null) {
      if (index < comment) return true;
      position = comment;
      continue;
    }

    let end = position + 1;
    if (code === 39) end = afterQuoted(sql, "'", position + 1);
    else if (code === 34) end = afterQuoted(sql, '"', position + 1);
    else if (code === 36 && dialect.dollarQuotes) {
      const tag = dollarTag(sql, position);
      if (tag !== null) end = after(sql, tag, position + tag.length);
    }

    if (index < end) return false;
    position = end;
  }
  return false;
}

/**
 * Onde, no texto do editor, está a `position` que o banco informou no erro (RN-SQL-009). O banco
 * conta em caracteres, de 1 em diante; o editor, em unidades UTF-16, de 0 em diante: cada emoji (ou
 * outro caractere fora do plano básico) antes do erro vale um para o banco e dois para o editor, e
 * sem esta conversa a marca cai um caractere antes por emoji. Uma posição depois do fim do texto
 * para no fim.
 */
export function utf16IndexOf(text: string, position: number): number {
  let index = 0;
  for (let characters = 1; characters < position && index < text.length; characters++) index += (text.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
  return index;
}
