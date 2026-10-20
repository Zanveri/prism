import { canonicalNumberText } from "./numbers";
import { VariableError } from "./errors";
import { limits, phrase } from "./variables.copy";

/*
 * O analisador léxico da linguagem das variáveis (RN-VAR-002 e 003). Lê o texto do script a partir de uma posição, um pedaço por vez, e para onde a declaração
 * acaba (RN-VAR-001): a quebra de linha, fora de parênteses, colchetes e chaves, quando a próxima linha não começa por um operador que continua a expressão. Por
 * isso ele não lê a linha de baixo (que é SQL, e pode ter um texto que não fecha) antes de saber se ela continua a declaração.
 */

export type Token = {
  type: "number" | "string" | "template" | "name" | "punct" | "end";
  /** O nome, o operador ou o texto escrito do número; no fim, vazio. */
  text: string;
  start: number;
  end: number;
  /** Há uma quebra de linha entre o pedaço de antes e este. */
  newline: boolean;
  /** O texto de um `string`; o de cada pedaço fixo de um `template`. */
  cooked?: string;
  quasis?: string[];
  /** Onde, no texto, está cada `${ ... }` de um `template`: o que vai entre o `${` e o `}`. */
  holes?: { from: number; to: number }[];
};

const punctuators = [
  ">>>=", "...", "===", "!==", "**=", "&&=", "||=", "??=", ">>>", "<<=", ">>=", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "**", "++", "+=", "-=", "*=", "/=", "%=", "&=", "|=",
  "^=", "<<", ">>", "(", ")", "[", "]", "{", "}", ",", ";", ":", "?", ".", "=", "<", ">", "+", "-", "*", "/", "%", "!", "&", "|", "^", "~",
];

/** Os operadores que, no começo da linha de baixo, continuam a expressão da declaração (RN-VAR-001). */
const continuing: ReadonlySet<string> = new Set(["+", "-", "*", "/", "%", "**", "&&", "||", "??", "===", "!==", "<", "<=", ">", ">=", "?", ":", ".", "?."]);

const isLineBreak = (code: number) => code === 10 || code === 13 || code === 0x2028 || code === 0x2029;
const isDigit = (code: number) => code >= 48 && code <= 57;
/** Os operadores por primeiro caractere (o mais comprido antes), para não varrer a lista inteira a cada pedaço. */
const punctuatorsStartingWith: Record<number, string[] | undefined> = Object.create(null) as Record<number, string[] | undefined>;
for (const candidate of punctuators) (punctuatorsStartingWith[candidate.charCodeAt(0)] ??= []).push(candidate);

/** Letra, `_` ou `$` do ASCII: o começo de um nome (o resto do Unicode passa pela expressão regular). */
const isAsciiNameStart = (code: number) => (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code === 36;
const isHex = (code: number) => isDigit(code) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);

/** Os caracteres de formato e de direção do texto, que mudariam o que se vê sem mudar o nome (RN-VAR-003). */
const isFormatCharacter = (code: number) => (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff;

const nameStart = /[\p{ID_Start}_$]/u;
const nameContinue = /[\p{ID_Continue}$]/u;

const codePointText = (code: number) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

export class Lexer {
  readonly source: string;
  /** Até onde o analisador lê: o fim do texto, ou o fim de um `${ ... }` de um modelo. */
  readonly limit: number;
  position: number;
  /** O nome da declaração e o nível em que o analisador está, para recusar o modelo dentro de modelo fundo demais antes de a leitura ficar funda (RN-VAR-013). */
  declarationName = "";
  nesting = 0;

  constructor(source: string, from: number, limit = source.length) {
    this.source = source;
    this.position = from;
    this.limit = limit;
  }

  /**
   * Pula os espaços e os comentários (`--` e `//` até o fim da linha, e `/* ... *\/`), e diz se passou por uma quebra de linha. O `--` é sempre comentário:
   * `x--1` é `x` seguido de um comentário (RN-VAR-001).
   */
  private skipTrivia(): boolean {
    const { source, limit } = this;
    let crossed = false;
    while (this.position < limit) {
      const code = source.charCodeAt(this.position);
      if (isLineBreak(code)) {
        crossed = true;
        this.position++;
      } else if (code === 32 || code === 9 || code === 11 || code === 12 || code === 160 || (code > 127 && /\s/.test(source[this.position]) && !isFormatCharacter(code))) this.position++;
      else if ((code === 45 && source.charCodeAt(this.position + 1) === 45) || (code === 47 && source.charCodeAt(this.position + 1) === 47)) {
        while (this.position < limit && !isLineBreak(source.charCodeAt(this.position))) this.position++;
      } else if (code === 47 && source.charCodeAt(this.position + 1) === 42) {
        const close = source.indexOf("*/", this.position + 2);
        if (close < 0 || close + 2 > limit) throw new VariableError(phrase.commentNotClosed(), this.position);
        for (let index = this.position; index < close; index++) if (isLineBreak(source.charCodeAt(index))) crossed = true;
        this.position = close + 2;
      } else break;
    }
    return crossed;
  }

  /** A palavra (só letras do ASCII, em minúsculas) que vem depois dos espaços e dos comentários a partir de `at`, ou nulo: o que decide se um parêntese abre uma consulta (RN-VAR-011). */
  wordAfter(at: number): string | null {
    const saved = this.position;
    this.position = at;
    try {
      this.skipTrivia();
      const match = /^[A-Za-z]+(?![\p{ID_Continue}$])/u.exec(this.source.slice(this.position, this.position + 12));
      return match === null ? null : match[0].toLowerCase();
    } catch {
      return null;
    } finally {
      this.position = saved;
    }
  }

  /** O operador que começa em `at`, o mais comprido (com o `?.` que não é seguido de dígito). */
  private punctuatorAt(at: number): string | null {
    const { source } = this;
    if (source.charCodeAt(at) === 63 && source.charCodeAt(at + 1) === 46 && !isDigit(source.charCodeAt(at + 2))) return "?.";
    for (const candidate of punctuatorsStartingWith[source.charCodeAt(at)] ?? []) if (source.startsWith(candidate, at)) return candidate;
    return null;
  }

  /** Se, depois dos espaços e dos comentários, o texto de `at` começa por um operador que continua a expressão da linha de cima (RN-VAR-001). */
  private continuesAt(at: number): boolean {
    const saved = this.position;
    this.position = at;
    try {
      this.skipTrivia();
      if (this.position >= this.limit) return false;
      const operator = this.punctuatorAt(this.position);
      return operator !== null && continuing.has(operator);
    } catch {
      // Um comentário de bloco que não fecha: a linha de baixo é SQL, e a declaração acabou.
      return false;
    } finally {
      this.position = saved;
    }
  }

  /**
   * O próximo pedaço. Com `lenient` desligado, uma quebra de linha antes dele termina a declaração se o pedaço não começa por um operador que continua a expressão:
   * devolve o `end` sem ler a linha de baixo. Com ele ligado (dentro de parênteses, colchetes e chaves, e logo depois de um operador que espera o resto) a quebra de
   * linha não conta.
   */
  next(lenient: boolean): Token {
    const before = this.position;
    const newline = this.skipTrivia();
    if (this.position >= this.limit) return { type: "end", text: "", start: this.position, end: this.position, newline };
    if (!lenient && newline && !this.continuesAt(before)) return { type: "end", text: "", start: before, end: before, newline: true };

    const { source } = this;
    const start = this.position;
    const code = source.charCodeAt(start);

    if (isDigit(code) || (code === 46 && isDigit(source.charCodeAt(start + 1)))) return this.number(start, newline);
    if (code === 39 || code === 34) return this.string(start, code, newline);
    if (code === 96) return this.template(start, newline);

    if (code === 92) throw new VariableError(source.charCodeAt(start + 1) === 117 ? phrase.unicodeEscapeInName() : phrase.unexpectedCharacter("\\"), start);
    if (isFormatCharacter(code)) throw new VariableError(phrase.formatCharacterInName(codePointText(code)), start);

    // O ASCII, que é quase todo o texto, decide sem a expressão regular: letra, `_` e `$` começam um nome.
    const ascii = code < 128;
    if (ascii ? isAsciiNameStart(code) : nameStart.test(String.fromCodePoint(source.codePointAt(start) ?? 0))) return this.name(start, newline);
    const character = ascii ? source[start] as string : String.fromCodePoint(source.codePointAt(start) ?? 0);

    const operator = this.punctuatorAt(start);
    if (operator === null) throw new VariableError(phrase.unexpectedCharacter(character), start);
    this.position = start + operator.length;
    return { type: "punct", text: operator, start, end: this.position, newline };
  }

  private name(start: number, newline: boolean): Token {
    const { source, limit } = this;
    let position = start;
    while (position < limit) {
      const point = source.codePointAt(position) ?? 0;
      if (isFormatCharacter(point)) throw new VariableError(phrase.formatCharacterInName(codePointText(point)), position);
      if (point === 92) throw new VariableError(source.charCodeAt(position + 1) === 117 ? phrase.unicodeEscapeInName() : phrase.unexpectedCharacter("\\"), position);
      const character = String.fromCodePoint(point);
      if (!nameContinue.test(character) && character !== "_") break;
      position += character.length;
    }
    this.position = position;
    return { type: "name", text: source.slice(start, position), start, end: position, newline };
  }

  /** Os dígitos de `at` em diante, com o `_` entre dois dígitos; devolve onde acabam. */
  private digits(at: number, start: number): number {
    const { source } = this;
    let position = at;
    while (position < this.limit) {
      const code = source.charCodeAt(position);
      if (isDigit(code)) position++;
      else if (code === 95) {
        if (!isDigit(source.charCodeAt(position - 1)) || !isDigit(source.charCodeAt(position + 1))) {
          let end = position;
          while (end < this.limit && (isDigit(source.charCodeAt(end)) || source.charCodeAt(end) === 95)) end++;
          throw new VariableError(phrase.badUnderscore(source.slice(start, end)), start);
        }
        position++;
      } else break;
    }
    return position;
  }

  /** `dígitos [ "." dígitos ] [ expoente ]` ou `"." dígitos [ expoente ]` (RN-VAR-002); o resto que parece número é recusado com a frase. */
  private number(start: number, newline: boolean): Token {
    const { source } = this;
    let position = start;

    if (source.charCodeAt(position) !== 46) {
      // `010` não existe (o JavaScript antigo o lê como octal); `0x1F`, `0o7` e `0b1` também não.
      const second = source.charCodeAt(position + 1);
      if (source.charCodeAt(position) === 48) {
        if (isDigit(second)) {
          let end = position;
          while (isDigit(source.charCodeAt(end))) end++;
          throw new VariableError(phrase.leadingZero(source.slice(start, end)), start);
        }
        if (second === 120 || second === 88 || second === 111 || second === 79 || second === 98 || second === 66) throw new VariableError(phrase.numberForm(source.slice(start, position + 2 + this.wordLength(position + 2))), start);
      }
      position = this.digits(position, start);
    }
    if (source.charCodeAt(position) === 46 && isDigit(source.charCodeAt(position + 1))) position = this.digits(position + 1, start);

    const exponent = source.charCodeAt(position);
    if (exponent === 101 || exponent === 69) {
      let at = position + 1;
      if (source.charCodeAt(at) === 43 || source.charCodeAt(at) === 45) at++;
      if (!isDigit(source.charCodeAt(at))) throw new VariableError(phrase.badNumber(source.slice(start, at)), start);
      position = this.digits(at, start);
    }

    // Um nome colado ao número (`10n`, `10px`) não é um número.
    const next = source.codePointAt(position);
    if (position < this.limit && next !== undefined && (nameStart.test(String.fromCodePoint(next)) || isDigit(next))) {
      const word = this.wordLength(position);
      const text = source.slice(start, position + word);
      const bigint = source.charCodeAt(position) === 110 && word === 1 && /^\d[\d_]*$/.test(source.slice(start, position));
      throw new VariableError(bigint ? phrase.bigint(text) : phrase.badNumber(text), start);
    }

    this.position = position;
    return { type: "number", text: canonicalNumberText(source.slice(start, position)), start, end: position, newline };
  }

  /** Quantos caracteres tem a palavra que começa em `at`. */
  private wordLength(at: number): number {
    let position = at;
    while (position < this.limit && /[\p{ID_Continue}$]/u.test(this.source[position])) position++;
    return position - at;
  }

  /** O escape que começa na barra em `at`: devolve o texto que ele escreve e onde acaba. `template` deixa a quebra de linha crua passar. */
  private escape(at: number): { text: string; end: number } {
    const { source } = this;
    const code = source.charCodeAt(at + 1);
    const simple: Record<number, string> = { 110: "\n", 114: "\r", 116: "\t", 98: "\b", 102: "\f", 118: "\v" };

    if (at + 1 >= this.limit) throw new VariableError(phrase.textNotClosed(), at);
    if (code in simple) return { text: simple[code], end: at + 2 };
    if (code === 48) {
      if (isDigit(source.charCodeAt(at + 2))) throw new VariableError(phrase.octalEscape(source.slice(at, at + 3)), at);
      return { text: "\0", end: at + 2 };
    }
    if (isDigit(code)) throw new VariableError(phrase.octalEscape(source.slice(at, at + 2)), at);
    if (code === 120) {
      if (!isHex(source.charCodeAt(at + 2)) || !isHex(source.charCodeAt(at + 3))) throw new VariableError(phrase.badEscape(source.slice(at, at + 4)), at);
      return { text: String.fromCharCode(Number.parseInt(source.slice(at + 2, at + 4), 16)), end: at + 4 };
    }
    if (code === 117) {
      if (source.charCodeAt(at + 2) === 123) {
        const close = source.indexOf("}", at + 3);
        const digits = close < 0 ? "" : source.slice(at + 3, close);
        if (!/^[0-9a-fA-F]{1,8}$/.test(digits) || Number.parseInt(digits, 16) > 0x10ffff) throw new VariableError(phrase.badEscape(source.slice(at, close < 0 ? at + 4 : close + 1)), at);
        return { text: String.fromCodePoint(Number.parseInt(digits, 16)), end: close + 1 };
      }
      const digits = source.slice(at + 2, at + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(digits)) throw new VariableError(phrase.badEscape(source.slice(at, at + 6)), at);
      return { text: String.fromCharCode(Number.parseInt(digits, 16)), end: at + 6 };
    }
    if (isLineBreak(code)) {
      // A quebra de linha precedida de `\` some.
      return { text: "", end: code === 13 && source.charCodeAt(at + 2) === 10 ? at + 3 : at + 2 };
    }
    const point = source.codePointAt(at + 1) ?? 0;
    return { text: String.fromCodePoint(point), end: at + 1 + String.fromCodePoint(point).length };
  }

  private string(start: number, quote: number, newline: boolean): Token {
    const { source, limit } = this;
    const parts: string[] = [];
    let position = start + 1;
    let from = position;

    for (;;) {
      if (position >= limit) throw new VariableError(phrase.textNotClosed(), start);
      const code = source.charCodeAt(position);
      if (code === quote) break;
      if (isLineBreak(code) && code !== 0x2028 && code !== 0x2029) throw new VariableError(phrase.textNotClosed(), start);
      if (code === 92) {
        parts.push(source.slice(from, position));
        const escaped = this.escape(position);
        parts.push(escaped.text);
        position = escaped.end;
        from = position;
      } else position++;
    }
    parts.push(source.slice(from, position));
    this.position = position + 1;
    return { type: "string", text: source.slice(start, this.position), cooked: parts.join(""), start, end: this.position, newline };
  }

  /** A posição do `}` que fecha o `${` aberto antes de `at`, pulando textos, modelos, comentários e chaves de dentro dele. */
  private closeHole(at: number): number {
    const { source, limit } = this;
    let position = at;
    let braces = 0;
    while (position < limit) {
      const code = source.charCodeAt(position);
      if (code === 39 || code === 34) {
        const inner = new Lexer(source, position, limit);
        inner.string(position, code, false);
        position = inner.position;
      } else if (code === 96) {
        const inner = new Lexer(source, position, limit);
        inner.declarationName = this.declarationName;
        inner.nesting = this.nesting + 1;
        if (inner.nesting > limits.depth) throw new VariableError(phrase.tooDeep(this.declarationName), position);
        inner.template(position, false);
        position = inner.position;
      } else if ((code === 45 && source.charCodeAt(position + 1) === 45) || (code === 47 && source.charCodeAt(position + 1) === 47)) {
        while (position < limit && !isLineBreak(source.charCodeAt(position))) position++;
      } else if (code === 47 && source.charCodeAt(position + 1) === 42) {
        const close = source.indexOf("*/", position + 2);
        if (close < 0 || close + 2 > limit) throw new VariableError(phrase.commentNotClosed(), position);
        position = close + 2;
      } else if (code === 123) {
        braces++;
        position++;
      } else if (code === 125) {
        if (braces === 0) return position;
        braces--;
        position++;
      } else position++;
    }
    throw new VariableError(phrase.templateNotClosed(), at);
  }

  private template(start: number, newline: boolean): Token {
    const { source, limit } = this;
    const quasis: string[] = [];
    const holes: { from: number; to: number }[] = [];
    let current = "";
    let position = start + 1;
    let from = position;

    for (;;) {
      if (position >= limit) throw new VariableError(phrase.templateNotClosed(), start);
      const code = source.charCodeAt(position);
      if (code === 96) break;
      if (code === 92) {
        current += source.slice(from, position);
        const escaped = this.escape(position);
        current += escaped.text;
        position = escaped.end;
        from = position;
      } else if (code === 36 && source.charCodeAt(position + 1) === 123) {
        current += source.slice(from, position);
        quasis.push(current.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
        current = "";
        const close = this.closeHole(position + 2);
        holes.push({ from: position + 2, to: close });
        position = close + 1;
        from = position;
      } else position++;
    }
    current += source.slice(from, position);
    quasis.push(current.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
    this.position = position + 1;
    return { type: "template", text: source.slice(start, this.position), quasis, holes, start, end: this.position, newline };
  }
}
