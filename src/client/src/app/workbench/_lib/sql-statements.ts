import type { Engine } from "@/components/ui/engine-tag";

/**
 * Um comando dentro do texto do editor: `text` é `sql.slice(start, end)`, sem os espaços em volta e
 * sem o `;`. O comentário que vem antes do comando, no mesmo trecho, vai com ele.
 */
export type SqlStatement = { text: string; start: number; end: number };

/** O comando e até onde ele vai no texto: a posição logo depois do `;` dele, ou o fim do texto quando não há `;`. */
type Scanned = SqlStatement & { boundary: number };

/**
 * O que muda de um banco para o outro na hora de separar os comandos (RN-SQL-002): no PostgreSQL e no
 * Db2 o comentário de bloco aceita outro dentro dele; no Informix o primeiro fecho o encerra e
 * `{ ... }` também é comentário. Só o PostgreSQL tem o bloco `$tag$ ... $tag$` (nos outros `$` é um
 * caractere qualquer) e só nele o `--` acaba também no retorno de carro; no Db2 e no Informix, só na
 * quebra de linha. `body` é o que cada banco entende por bloco com `;` no corpo (RN-SQL-001).
 */
type Dialect = { nestedComments: boolean; braceComments: boolean; dollarQuotes: boolean; carriageReturnEndsComment: boolean; body: () => Body };

const postgres: Dialect = { nestedComments: true, braceComments: false, dollarQuotes: true, carriageReturnEndsComment: true, body: standardBody };

/** Pelo número do banco na API: PostgreSQL 1, Db2 2, Informix 3. */
const dialects: Record<Engine, Dialect> = {
  1: postgres,
  2: { nestedComments: true, braceComments: false, dollarQuotes: false, carriageReturnEndsComment: false, body: db2Body },
  3: { nestedComments: false, braceComments: true, dollarQuotes: false, carriageReturnEndsComment: false, body: informixBody },
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
 */
function scan(sql: string, dialect: Dialect): Scanned[] {
  const statements: Scanned[] = [];
  let segmentStart = 0;
  let hasCode = false;

  function close(semicolon: number, boundary: number) {
    let start = segmentStart;
    let end = semicolon;
    while (start < end && isWhitespace(sql.charCodeAt(start))) start++;
    while (end > start && isWhitespace(sql.charCodeAt(end - 1))) end--;
    if (hasCode) statements.push({ text: sql.slice(start, end), start, end, boundary });
    segmentStart = boundary;
    hasCode = false;
  }

  let position = 0;
  while (position < sql.length) {
    const code = sql.charCodeAt(position);

    if (code === 59) {
      close(position, position + 1);
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

/** Os comandos do texto, separados por `;` (RN-SQL-002), pelas regras do banco da aba. */
export function splitStatements(sql: string, engine?: Engine): SqlStatement[] {
  return scan(sql, dialectOf(engine)).map(toStatement);
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
 * regras do banco da aba, as mesmas que a API aplica (`SqlText.HasSeveralStatements`). Só aqui a regra
 * vale: `splitStatements` e `statementAt`, que acham o comando do cursor, seguem separando pelo `;`.
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

/**
 * O comando onde está o cursor (RN-SQL-001): o primeiro que termina no cursor ou depois dele,
 * contando o `;` como parte do comando (logo depois do `;`, ainda é o comando que ele fecha). Com
 * o cursor depois do último comando, é o último. `null` quando o texto não tem comando.
 */
export function statementAt(sql: string, offset: number, engine?: Engine): SqlStatement | null {
  const statements = scan(sql, dialectOf(engine));
  const found = statements.find((statement) => offset <= statement.boundary) ?? statements.at(-1);
  return found === undefined ? null : toStatement(found);
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
