import type { Engine } from "@/components/ui/engine-tag";

import { matchingParenthesis } from "../sql-statements";
import type { ChainLevel, ChainOperator, ColumnRef, Declaration, Node, ParsedItem, Reassignment, Spreadable, TypeAnnotation } from "./ast";
import { closedNames, directFunctions, environmentNames, namespaceMembers, reservedWords, unsupportedOperatorWords, unsupportedWords } from "./catalog";
import { locate, VariableError } from "./errors";
import { Lexer, type Token } from "./lexer";
import { forbiddenMembers } from "./values";
import { limits, phrase } from "./variables.copy";

/*
 * O analisador sintático da linguagem das variáveis (RN-VAR-002): a gramática da especificação, de cima para baixo, uma função por produção, sobre o `Lexer`.
 * Lê UM item (uma declaração ou uma reatribuição) a partir de uma posição do script e devolve a árvore e onde ele acaba (RN-VAR-001): o fim do item é onde a
 * gramática não continua, e por isso o leitor do SQL pergunta a ele onde cada declaração acaba. As chamadas se resolvem aqui, ao ler o texto (RN-VAR-002):
 * `f()` com `f` uma variável é um erro de leitura, e `Math.max` é um nó de chamada a uma função conhecida, e não um membro de um valor.
 */

/** Os operadores que existem em JavaScript e que a linguagem recusa com a frase (RN-VAR-002 e 012). */
const refusedOperators: ReadonlySet<string> = new Set(["=", "+=", "-=", "*=", "/=", "%=", "**=", "&&=", "||=", "??=", "&", "|", "^", "~", "<<", ">>", ">>>", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "++", "--", "=>", "...", ",", "@", "#"]);

const baseTypes: ReadonlySet<string> = new Set(["number", "string", "boolean", "Date", "sql"]);

/** A palavra de `Token` como a frase a cita. */
function describe(token: Token): string {
  if (token.type === "end") return "o fim";
  return token.text.length > 30 ? `${token.text.slice(0, 29)}…` : token.text;
}

/** O nome como a linguagem o compara: normalizado em NFC (RN-VAR-003). */
export const normalizeName = (name: string): string => name.normalize("NFC");

/**
 * Confere o nome que uma declaração dá (RN-VAR-003) e devolve a frase da recusa, ou nulo. Os nomes da lista fechada dizem que são do Prism; os outros, que não
 * podem ser nome.
 */
export function declaredNameRefusal(raw: string): string | null {
  const name = normalizeName(raw);
  if ([...name].length > limits.nameLength) return phrase.nameTooLong();
  if (closedNames.has(name)) return phrase.prismName(name);
  if (reservedWords.has(name) || environmentNames.has(name) || forbiddenMembers.has(name) || /^(select|values)$/i.test(name)) return phrase.reservedName(name);
  // `$a$` abriria um `$a$ ... $a$` no leitor do PostgreSQL, e `$1` é um marcador.
  if ((name.length >= 2 && name.startsWith("$") && name.endsWith("$")) || /^\$\d+$/.test(name)) return phrase.reservedName(name);
  return null;
}

type Shape = "declaration" | "reassignment";

const nameAtPattern = /^[\p{ID_Start}_$][\p{ID_Continue}$]*/u;

/**
 * O que o texto em `start` parece ser, só pela forma, sem ler o resto (RN-VAR-001): `let` ou `const` em minúsculas, um espaço, um nome e então `=`, `:` ou o fim da
 * declaração (`;`, a quebra de linha, o fim do texto ou um comentário); ou um nome seguido de `=` (e não de `==`). Nulo quando é SQL. `atItem` diz que o texto está
 * numa posição de item, onde `let` e um nome bastam.
 */
export function itemShape(source: string, start: number, atItem = false): Shape | null {
  const head = source.slice(start, start + 6);
  const keyword = head.startsWith("let") && !/^let[\p{ID_Continue}$]/u.test(head) ? 3 : head.startsWith("const") && !/^const[\p{ID_Continue}$]/u.test(head) ? 5 : 0;

  if (keyword > 0) {
    let at = start + keyword;
    if (source[at] !== " " && source[at] !== "\t") return nameThenEquals(source, start) ? "reassignment" : null;
    while (source[at] === " " || source[at] === "\t") at++;
    const match = nameAtPattern.exec(source.slice(at, at + 200));
    if (match === null) return null;
    at += match[0].length;
    while (source[at] === " " || source[at] === "\t") at++;
    const next = source[at];
    if (next === undefined || next === "=" || next === ":" || next === ";" || next === "\n" || next === "\r") return "declaration";
    if (next === "/" && (source[at + 1] === "/" || source[at + 1] === "*")) return "declaration";
    if (next === "-" && source[at + 1] === "-") return "declaration";
    // Numa posição de item (o começo do texto, depois do `;` ou da linha em branco) nenhum comando começa por `let` e um nome: é uma declaração com erro
    // ("Esperava = ou : depois de a."), e não SQL. No meio de um comando só `=`, `:` ou o fim da declaração a distinguem do SQL (RN-VAR-001).
    return atItem ? "declaration" : null;
  }
  return nameThenEquals(source, start) ? "reassignment" : null;
}

/** Se o texto em `start` é um nome seguido de `=` que não é `==` nem `=>`. */
function nameThenEquals(source: string, start: number): boolean {
  const match = nameAtPattern.exec(source.slice(start, start + 200));
  if (match === null) return false;
  let at = start + match[0].length;
  while (source[at] === " " || source[at] === "\t") at++;
  return source[at] === "=" && source[at + 1] !== "=" && source[at + 1] !== ">";
}

class Parser {
  readonly source: string;
  readonly engine: Engine | undefined;
  private readonly lexer: Lexer;
  tok: Token;
  /** O fim do pedaço de antes de `tok`. */
  private previousEnd: number;
  /** Quantos parênteses, colchetes e chaves estão abertos: dentro deles a quebra de linha não termina a declaração. */
  private depth: number;
  private nesting: number;
  /** O nome da declaração que se lê, para as frases dos limites. */
  name = "";
  private readonly itemStart: number;
  queryChars = 0;
  firstQuery: number | null = null;
  firstSample: number | null = null;

  constructor(source: string, from: number, limit: number, engine: Engine | undefined, depth: number, nesting: number, itemStart: number, name: string) {
    this.source = source;
    this.engine = engine;
    this.lexer = new Lexer(source, from, limit);
    this.depth = depth;
    this.nesting = nesting;
    this.itemStart = itemStart;
    this.name = name;
    this.previousEnd = from;
    this.tok = this.lexer.next(true);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  // O fluxo de pedaços.
  // -------------------------------------------------------------------------------------------------------------------------------------------------------

  /** Passa ao próximo pedaço. `lenient` é logo depois de um operador que espera o resto: a quebra de linha não termina nada. */
  advance(lenient = false): void {
    this.previousEnd = this.tok.end;
    this.tok = this.lexer.next(lenient || this.depth > 0);
    if (this.tok.end - this.itemStart - this.queryChars > limits.declarationBytes * 3) throw new VariableError(phrase.declarationTooBig(this.name), this.itemStart);
  }

  private atEnd(): boolean {
    return this.tok.type === "end";
  }

  private is(text: string): boolean {
    return this.tok.type === "punct" && this.tok.text === text;
  }

  private isName(text?: string): boolean {
    return this.tok.type === "name" && (text === undefined || this.tok.text === text);
  }

  private lineOf(offset: number): number {
    return locate(this.source, offset).line;
  }

  /** Entra num nível (RN-VAR-013): parênteses, listas, objetos, modelos, chamadas e as recursões da gramática. */
  private nest<T>(read: () => T): T {
    if (++this.nesting > limits.depth) throw new VariableError(phrase.tooDeep(this.name), this.tok.start);
    try {
      return read();
    } finally {
      this.nesting--;
    }
  }

  /** O pedaço que não podia estar aqui, com a frase do que ele é: um operador que não existe, uma palavra que não existe ou o que a gramática esperava. */
  private unexpected(expected: string): VariableError {
    const token = this.tok;
    if (token.type === "punct") {
      if (token.text === "==" || token.text === "!=") return new VariableError(phrase.looseEquality(), token.start);
      if (token.text === "=>") return new VariableError(phrase.notInLanguage("=>"), token.start);
      if (token.text === "/" ) return new VariableError(phrase.regularExpression(), token.start);
      if (refusedOperators.has(token.text)) return new VariableError(phrase.operatorNotInLanguage(token.text), token.start);
    }
    if (token.type === "name") {
      if (unsupportedOperatorWords.has(token.text)) return new VariableError(phrase.operatorNotInLanguage(token.text), token.start);
      if (unsupportedWords.has(token.text)) return new VariableError(phrase.notInLanguage(token.text), token.start);
    }
    return new VariableError(expected, token.type === "end" ? this.previousEnd : token.start);
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  // O item.
  // -------------------------------------------------------------------------------------------------------------------------------------------------------

  /** Valida o nome dado pela declaração. */
  private declaredName(token: Token): string {
    const refusal = declaredNameRefusal(token.text);
    if (refusal !== null) throw new VariableError(refusal, token.start);
    return normalizeName(token.text);
  }

  parseItem(): ParsedItem {
    const first = this.tok;
    if (first.type !== "name") throw this.unexpected(phrase.expectedName());

    if (first.text === "let" || first.text === "const") return this.parseDeclaration(first.text === "let");
    return this.parseReassignment();
  }

  private parseDeclaration(mutable: boolean): Declaration {
    const keyword = this.tok;
    this.advance();
    if (this.tok.type !== "name") throw new VariableError(phrase.expectedName(), this.atEnd() ? this.previousEnd : this.tok.start);

    const nameToken = this.tok;
    const name = this.declaredName(nameToken);
    this.name = name;
    this.advance();

    let annotation: TypeAnnotation | null = null;
    if (this.is(":")) {
      this.advance(true);
      annotation = this.parseType();
    }

    let value: Node | null = null;
    if (this.is("=")) {
      this.advance(true);
      value = this.parseValue();
    } else if (!this.atEnd() && !this.is(";")) {
      if (this.is(",")) throw new VariableError(phrase.oneVariablePerLet(), this.tok.start);
      throw this.unexpected(annotation === null ? phrase.expectedEqualsOrColon(name) : phrase.expectedEnd(name, describe(this.tok)));
    }

    this.finish(name);
    return { kind: "declaration", mutable, name, nameStart: nameToken.start, annotation, value, start: keyword.start, end: this.previousEnd };
  }

  private parseReassignment(): Reassignment {
    const nameToken = this.tok;
    const name = normalizeName(nameToken.text);
    this.name = name;
    this.advance();
    if (!this.is("=")) throw this.unexpected(phrase.expectedEqualsOrColon(name));
    this.advance(true);
    const value = this.parseValue();
    this.finish(name);
    return { kind: "reassignment", name, nameStart: nameToken.start, value, start: nameToken.start, end: this.previousEnd };
  }

  /** O fim do item: o `;` (que vai com ele) ou a quebra de linha (RN-VAR-001); qualquer outra coisa na mesma linha é um erro. */
  private finish(name: string): void {
    if (this.is(";")) {
      this.advance();
      // O que sobra na linha depois do `;` não é da declaração (um comentário vai com ela, em `declarationEnd`).
      return;
    }
    if (this.atEnd()) return;
    if (this.is(",")) throw new VariableError(phrase.oneVariablePerLet(), this.tok.start);
    throw this.unexpected(phrase.expectedEnd(name, describe(this.tok)));
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  // O tipo.
  // -------------------------------------------------------------------------------------------------------------------------------------------------------

  private parseColumn(): ColumnRef {
    const start = this.tok.start;
    const parts: string[] = [];
    for (;;) {
      const token = this.tok;
      if (token.type === "name") parts.push(normalizeName(token.text));
      else if (token.type === "string" && token.text.startsWith('"')) parts.push(`"${token.cooked ?? ""}"`);
      else throw this.unexpected(phrase.expectedColumn());
      this.advance();
      if (!this.is(".") || parts.length === 3) break;
      this.advance(true);
    }
    if (parts.length < 2) throw new VariableError(phrase.expectedColumn(), start);
    const end = this.previousEnd;
    const [schema, table, column] = parts.length === 3 ? parts : [null, parts[0], parts[1]];
    return { schema, table, column, text: parts.join("."), start, end };
  }

  private parseType(): TypeAnnotation {
    const first = this.tok;
    if (first.type === "punct" && first.text === "{") throw new VariableError(phrase.objectNotAnnotated(), first.start);
    // Depois do `:` a gramática espera um tipo: o que vier no lugar dele (um `=`, o fim) é "Esperava o tipo", e não o erro do operador (RN-VAR-012).
    if (first.type !== "name" && !(first.type === "string" && first.text.startsWith('"'))) throw new VariableError(phrase.expectedType(), first.type === "end" ? this.previousEnd : first.start);

    let base: TypeAnnotation["base"];
    let column: ColumnRef | null = null;
    const next = this.source[first.end];

    if (first.type === "name" && baseTypes.has(first.text) && next !== ".") {
      base = first.text as TypeAnnotation["base"];
      this.advance();
    } else if (first.type === "string" || next === ".") {
      column = this.parseColumn();
      base = "column";
    } else {
      // Um nome sem ponto que não é um tipo (`any`, `object`, `pedido`): o tipo não existe.
      throw new VariableError(phrase.unknownType(first.text), first.start);
    }

    let list = false;
    if (this.is("[")) {
      this.advance(true);
      if (!this.is("]")) throw new VariableError(phrase.unknownType(this.source.slice(first.start, this.tok.end)), first.start);
      this.advance();
      list = true;
      if (this.is("[")) throw new VariableError(phrase.listOfList(), this.tok.start);
    }

    let nullable = false;
    if (this.is("|")) {
      this.advance(true);
      if (!this.isName("null")) throw new VariableError(phrase.unknownType(this.source.slice(first.start, this.tok.end)), first.start);
      nullable = true;
      this.advance();
    }

    const end = this.previousEnd;
    return { base, column, list, nullable, text: this.source.slice(first.start, end).trim(), start: first.start, end };
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  // As expressões.
  // -------------------------------------------------------------------------------------------------------------------------------------------------------

  private parseValue(): Node {
    if (this.atEnd() || this.is(";")) throw new VariableError(phrase.expectedValue(), this.previousEnd);
    const node = this.parseExpression();

    // A consulta e o `random.of` só podem ser o valor inteiro da declaração (RN-VAR-002).
    if (node.t !== "query" && this.firstQuery !== null) throw new VariableError(phrase.queryOnlyWhole(), this.firstQuery);
    if (node.t !== "sample" && this.firstSample !== null) throw new VariableError(phrase.sampleOnlyWhole(), this.firstSample);
    return node;
  }

  parseExpression(): Node {
    return this.nest(() => this.parseConditional());
  }

  private parseConditional(): Node {
    const test = this.parseShortCircuit();
    if (!this.is("?")) return test;

    const start = test.start;
    this.advance(true);
    const then = this.parseExpression();
    if (!this.is(":")) throw this.unexpected(phrase.expectedTernaryColon());
    this.advance(true);
    const otherwise = this.parseExpression();
    return { t: "conditional", test, then, otherwise, start, end: otherwise.end };
  }

  /** `ou`, ou a coalescência: o `??` não se mistura com `&&` nem com `||` sem parênteses (RN-VAR-002). */
  private parseShortCircuit(): Node {
    const begin = this.tok.start;
    const first = this.parseOr();
    if (!this.is("??")) return first;

    // Um `a || b` sem parênteses começa onde o pedaço começou; com parênteses, depois deles.
    if (first.t === "chain" && (first.level === "or" || first.level === "and") && first.start === begin) throw new VariableError(phrase.mixedNullish(), this.tok.start);

    const rest: { op: ChainOperator; operand: Node; start: number }[] = [];
    while (this.is("??")) {
      const start = this.tok.start;
      this.advance(true);
      rest.push({ op: "??", operand: this.parseEquality(), start });
    }
    if (this.is("||") || this.is("&&")) throw new VariableError(phrase.mixedNullish(), this.tok.start);
    return { t: "chain", level: "nullish", first, rest, start: first.start, end: rest[rest.length - 1].operand.end };
  }

  private chain(level: ChainLevel, operators: readonly ChainOperator[], operand: () => Node): Node {
    const first = operand();
    let rest: { op: ChainOperator; operand: Node; start: number }[] | null = null;
    while (this.tok.type === "punct" && (operators as readonly string[]).includes(this.tok.text)) {
      const op = this.tok.text as ChainOperator;
      const start = this.tok.start;
      this.advance(true);
      (rest ??= []).push({ op, operand: operand(), start });
    }
    return rest === null ? first : { t: "chain", level, first, rest, start: first.start, end: rest[rest.length - 1].operand.end };
  }

  private parseOr(): Node {
    return this.chain("or", ["||"], () => this.parseAnd());
  }

  private parseAnd(): Node {
    return this.chain("and", ["&&"], () => this.parseEquality());
  }

  private parseEquality(): Node {
    return this.chain("equality", ["===", "!=="], () => this.parseRelational());
  }

  private parseRelational(): Node {
    return this.chain("relational", ["<", "<=", ">", ">="], () => this.parseAdditive());
  }

  private parseAdditive(): Node {
    return this.chain("additive", ["+", "-"], () => this.parseMultiplicative());
  }

  private parseMultiplicative(): Node {
    return this.chain("multiplicative", ["*", "/", "%"], () => this.parsePower());
  }

  /** `potência = pós-fixo "**" potência | unário`: o `**` associa à direita, e o unário antes dele é erro (`-x ** 2`). */
  private parsePower(): Node {
    if (this.is("!") || this.is("-") || this.is("+")) return this.parseUnary();

    const base = this.parsePostfix();
    if (!this.is("**")) return base;
    this.advance(true);
    const exponent = this.nest(() => this.parsePower());
    return { t: "power", base, exponent, start: base.start, end: exponent.end };
  }

  private parseUnary(): Node {
    const operator = this.tok;
    this.advance(true);
    const operand = this.nest(() => (this.is("!") || this.is("-") || this.is("+") ? this.parseUnary() : this.parsePostfix()));
    if (this.is("**")) throw new VariableError(phrase.unaryBeforePower(), this.tok.start);
    return { t: "unary", op: operator.text as "!" | "-" | "+", operand, start: operator.start, end: operand.end };
  }

  /** O argumento de uma chamada e o item de uma lista, com o `...` que espalha. */
  private parseSpreadable(): Spreadable {
    if (this.is("...")) {
      this.advance(true);
      return { spread: true, node: this.parseExpression() };
    }
    return { spread: false, node: this.parseExpression() };
  }

  /** Os itens entre `open` e `close` (a vírgula no fim vale), com `tok` no `open`: devolve com `tok` já depois do `close`. */
  private parseSequence(open: string, close: string, read: () => void): void {
    const opener = this.tok;
    this.depth++;
    this.nest(() => {
      this.advance(true);
      while (!this.is(close)) {
        read();
        if (this.is(",")) this.advance(true);
        else if (!this.is(close)) {
          const line = this.lineOf(opener.start);
          throw this.unexpected(open === "(" ? phrase.expectedClose(line) : open === "[" ? phrase.expectedCloseBracket(line) : phrase.expectedCloseBrace(line));
        }
      }
    });
    this.depth--;
    this.advance();
  }

  private parseArguments(): Spreadable[] {
    const args: Spreadable[] = [];
    this.parseSequence("(", ")", () => args.push(this.parseSpreadable()));
    return args;
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    const nestingBefore = this.nesting;

    try {
      for (;;) {
        if (this.tok.type === "template") throw new VariableError(phrase.taggedTemplate(), this.tok.start);

        if (this.is(".") || this.is("?.")) {
          const optional = this.is("?.");
          this.advance(true);
          if (optional && this.is("[")) {
            node = this.parseIndex(node, true);
            continue;
          }
          if (this.tok.type !== "name") throw this.unexpected(phrase.expectedMemberName());
          const name = this.tok.text;
          const nameStart = this.tok.start;
          if (forbiddenMembers.has(name)) throw new VariableError(phrase.memberForbidden(name), nameStart);
          this.advance();
          if (this.is("(")) {
            const args = this.parseArguments();
            node = { t: "method", receiver: node, name, nameStart, args, optional, start: node.start, end: this.previousEnd };
          } else node = { t: "member", object: node, name, nameStart, optional, start: node.start, end: nameStart + name.length };
        } else if (this.is("[")) node = this.parseIndex(node, false);
        else if (this.is("(")) throw new VariableError(phrase.notAFunction(node.t === "name" ? node.name : this.source.slice(node.start, node.end).slice(0, 30)), node.start);
        else return node;

        // Cada elo de uma cadeia (`a.b.c().d`) é um nível (RN-VAR-013): a árvore fica rasa onde o texto é longo.
        if (++this.nesting > limits.depth) throw new VariableError(phrase.tooDeep(this.name), this.tok.start);
      }
    } finally {
      this.nesting = nestingBefore;
    }
  }

  private parseIndex(object: Node, optional: boolean): Node {
    const opener = this.tok;
    this.depth++;
    this.advance(true);
    const index = this.parseExpression();
    if (!this.is("]")) throw this.unexpected(phrase.expectedCloseBracket(this.lineOf(opener.start)));
    this.depth--;
    const end = this.tok.end;
    this.advance();
    return { t: "index", object, index, optional, start: object.start, end };
  }

  // -------------------------------------------------------------------------------------------------------------------------------------------------------
  // O que não tem outro nó dentro.
  // -------------------------------------------------------------------------------------------------------------------------------------------------------

  private parsePrimary(): Node {
    const token = this.tok;

    switch (token.type) {
      case "number": {
        this.advance();
        return { t: "number", text: token.text, value: Number(token.text), start: token.start, end: token.end };
      }
      case "string": {
        this.advance();
        return { t: "string", value: token.cooked ?? "", start: token.start, end: token.end };
      }
      case "template":
        return this.parseTemplate(token);
      case "name":
        return this.parseNameLike(token);
      case "punct":
        if (token.text === "(") return this.parseParenthesis();
        if (token.text === "[") return this.parseList();
        if (token.text === "{") return this.parseObject();
        throw this.unexpected(phrase.expectedExpression(describe(token)));
      default:
        throw this.unexpected(phrase.expectedExpression(describe(token)));
    }
  }

  private parseTemplate(token: Token): Node {
    this.advance();
    const exprs: Node[] = [];
    for (const hole of token.holes ?? []) {
      const child = new Parser(this.source, hole.from, hole.to, this.engine, 1, this.nesting + 1, this.itemStart, this.name);
      if (child.nesting > limits.depth) throw new VariableError(phrase.tooDeep(this.name), hole.from);
      if (child.atEnd()) throw new VariableError(phrase.expectedExpression("}"), hole.from);
      exprs.push(child.parseExpression());
      if (!child.atEnd()) throw child.unexpected(phrase.expectedCloseBrace(this.lineOf(hole.from - 2)));
      this.firstQuery ??= child.firstQuery;
      this.firstSample ??= child.firstSample;
      this.queryChars += child.queryChars;
    }
    return { t: "template", quasis: token.quasis ?? [""], exprs, start: token.start, end: token.end };
  }

  private parseParenthesis(): Node {
    const opener = this.tok;
    const word = this.lexer.wordAfter(opener.end);

    if (word === "select" || word === "with" || word === "values") {
      const close = matchingParenthesis(this.source, opener.start, this.engine);
      if (close === null || close >= this.lexer.limit) throw new VariableError(phrase.queryNotClosed(this.lineOf(opener.start)), opener.start);
      this.firstQuery ??= opener.start;
      this.queryChars += close + 1 - opener.start;
      this.lexer.position = close + 1;
      this.tok = { type: "punct", text: ")", start: close, end: close + 1, newline: false };
      const node: Node = { t: "query", sql: this.source.slice(opener.start + 1, close), sqlStart: opener.start + 1, start: opener.start, end: close + 1 };
      this.advance();
      return node;
    }

    this.depth++;
    const inner = this.nest(() => {
      this.advance(true);
      const node = this.parseExpression();
      if (this.is(",")) throw new VariableError(phrase.operatorNotInLanguage(","), this.tok.start);
      if (!this.is(")")) throw this.unexpected(phrase.expectedClose(this.lineOf(opener.start)));
      return node;
    });
    this.depth--;
    this.advance();
    return inner;
  }

  private parseList(): Node {
    const opener = this.tok;
    const items: Spreadable[] = [];
    this.parseSequence("[", "]", () => {
      items.push(this.parseSpreadable());
      if (items.length > limits.listItems) throw new VariableError(phrase.listTooLong(), opener.start);
    });
    return { t: "list", items, start: opener.start, end: this.previousEnd };
  }

  private parseObject(): Node {
    const opener = this.tok;
    const pairs: { key: string; keyStart: number; value: Node }[] = [];
    this.parseSequence("{", "}", () => {
      const keyToken = this.tok;
      let key: string;
      if (keyToken.type === "name") key = keyToken.text;
      else if (keyToken.type === "string") key = keyToken.cooked ?? "";
      else if (keyToken.type === "punct" && keyToken.text === "[") throw new VariableError(phrase.noVarOrFunctionHere("A chave calculada"), keyToken.start);
      else throw this.unexpected(phrase.expectedFieldName());
      if (forbiddenMembers.has(key)) throw new VariableError(phrase.keyForbidden(key), keyToken.start);

      this.advance();
      if (!this.is(":")) throw this.unexpected(this.is(",") || this.is("}") ? phrase.noVarOrFunctionHere(`A forma curta { ${key} }`) : phrase.expectedColonInObject());
      this.advance(true);
      pairs.push({ key, keyStart: keyToken.start, value: this.parseExpression() });
      if (pairs.length > limits.objectFields + 1) throw new VariableError(phrase.objectTooBig(), opener.start);
    });
    return { t: "object", pairs, start: opener.start, end: this.previousEnd };
  }

  /** Um nome: `true`, `false`, `null`, `new Date(…)`, os espaços de nomes da lista fechada, uma palavra que não existe ou o nome de uma variável. */
  private parseNameLike(token: Token): Node {
    const text = token.text;

    if (text === "true" || text === "false") {
      this.advance();
      return { t: "boolean", value: text === "true", start: token.start, end: token.end };
    }
    if (text === "null") {
      this.advance();
      return { t: "null", start: token.start, end: token.end };
    }
    if (text === "new") return this.parseNew(token);
    if (unsupportedOperatorWords.has(text)) throw new VariableError(phrase.operatorNotInLanguage(text), token.start);
    if (unsupportedWords.has(text)) throw new VariableError(phrase.notInLanguage(text), token.start);
    if (closedNames.has(text)) return this.parseClosedName(token);

    this.advance();
    if (this.is("=>")) throw new VariableError(phrase.notInLanguage("=>"), this.tok.start);
    return { t: "name", name: normalizeName(text), start: token.start, end: token.end };
  }

  private parseNew(token: Token): Node {
    this.advance();
    if (!this.isName("Date")) throw new VariableError(phrase.newOnlyDate(), this.atEnd() ? this.previousEnd : this.tok.start);
    this.advance();
    if (!this.is("(")) throw new VariableError(phrase.expectedOpenParenAfterNewDate(), this.atEnd() ? this.previousEnd : this.tok.start);
    const args = this.parseArguments();
    return { t: "newDate", args, start: token.start, end: this.previousEnd };
  }

  /** `Math`, `random`, `date`, `Date`, `Number` e `String`: nomes da lista fechada, que não são valores (RN-VAR-009 e 014). */
  private parseClosedName(token: Token): Node {
    const space = token.text;
    this.advance();

    if (!this.is(".")) {
      if (directFunctions.has(space) && this.is("(")) {
        const args = this.parseArguments();
        return { t: "call", fn: { namespace: null, name: space }, args, start: token.start, end: this.previousEnd };
      }
      if (directFunctions.has(space)) throw new VariableError(phrase.functionIsNotAValue(space), token.start);
      throw new VariableError(phrase.namespaceIsNotAValue(space), token.start);
    }

    this.advance(true);
    if (this.tok.type !== "name") throw this.unexpected(phrase.expectedMemberName());
    const member = this.tok;
    if (forbiddenMembers.has(member.text)) throw new VariableError(phrase.memberForbidden(member.text), member.start);

    const members = namespaceMembers.get(space);
    if (members === undefined) throw new VariableError(phrase.memberNotInType(member.text, space), member.start);

    if (space === "random" && member.text === "of") return this.parseSample(token);

    if (members.constants.has(member.text)) {
      this.advance();
      return { t: "constant", namespace: space, name: member.text, start: token.start, end: member.end };
    }
    if (!members.functions.has(member.text)) throw new VariableError(phrase.memberNotInType(member.text, space), member.start);

    this.advance();
    if (this.is("(")) {
      const args = this.parseArguments();
      return { t: "call", fn: { namespace: space, name: member.text }, args, start: token.start, end: this.previousEnd };
    }
    // `Math.max.call`, `.apply` e `.bind` são nomes vedados; o resto é a função usada como valor.
    if (this.is(".")) {
      const after = this.lexer.wordAfter(this.tok.end);
      if (after !== null && forbiddenMembers.has(after)) throw new VariableError(phrase.memberForbidden(after), this.tok.end);
    }
    throw new VariableError(phrase.functionIsNotAValue(`${space}.${member.text}`), token.start);
  }

  /** `random.of(coluna)` e `random.of(coluna, quantos)` (RN-VAR-010): a coluna não é uma expressão. */
  private parseSample(start: Token): Node {
    this.advance();
    if (!this.is("(")) throw this.unexpected(phrase.sampleNeedsColumn());
    const opener = this.tok;
    this.depth++;
    this.advance(true);
    const column = this.parseColumn();
    let count: Node | null = null;
    if (this.is(",")) {
      this.advance(true);
      count = this.parseExpression();
      if (this.is(",")) this.advance(true);
    }
    if (!this.is(")")) throw this.unexpected(phrase.expectedClose(this.lineOf(opener.start)));
    this.depth--;
    this.firstSample ??= start.start;
    const end = this.tok.end;
    this.advance();
    return { t: "sample", column, count, start: start.start, end };
  }
}

export type ParseResult = { item: ParsedItem; end: number };

/**
 * Lê o item (declaração ou reatribuição) que começa em `from` no script `source`, depois dos espaços e dos comentários, e devolve a árvore e onde ele acaba: depois
 * do `;` e dos comentários que sobram na mesma linha (RN-VAR-001). Lança `VariableError` com a frase e a posição; as posições são as do script inteiro.
 */
export function parseItem(source: string, from: number, engine?: Engine): ParseResult {
  const parser = new Parser(source, from, source.length, engine, 0, 0, from, "");
  const item = parser.parseItem();

  const bytes = new TextEncoder().encode(source.slice(item.start, item.end)).length - parser.queryChars;
  if (bytes > limits.declarationBytes) throw new VariableError(phrase.declarationTooBig(item.kind === "declaration" || item.kind === "reassignment" ? item.name : ""), item.start);
  return { item, end: declarationEnd(source, item.end) };
}

/** Se depois da posição `at` só há espaços e comentários até o fim da linha, a posição do fim do último comentário; senão, `at`. */
export function declarationEnd(source: string, at: number): number {
  let position = at;
  let end = at;
  for (;;) {
    while (source[position] === " " || source[position] === "\t") position++;
    if ((source[position] === "/" && source[position + 1] === "/") || (source[position] === "-" && source[position + 1] === "-")) {
      while (position < source.length && source[position] !== "\n" && source[position] !== "\r") position++;
      return position;
    }
    if (source[position] === "/" && source[position + 1] === "*") {
      const close = source.indexOf("*/", position + 2);
      if (close < 0) return end;
      position = close + 2;
      end = position;
      continue;
    }
    return end;
  }
}
