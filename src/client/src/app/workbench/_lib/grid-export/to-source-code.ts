import { emptyCounts, type DocumentContext, type DocumentWriter } from "./document";
import { isBareJsonValue, isoDateTime, jsonKeys } from "./to-json";

/** O caractere de direção do texto (U+202A a U+202E, U+2066 a U+2069, U+200E, U+200F e U+061C), que faria um código ser lido numa ordem e executado noutra. */
export const isDirectionMark = (codePoint: number) => (codePoint >= 0x202a && codePoint <= 0x202e) || (codePoint >= 0x2066 && codePoint <= 0x2069) || codePoint === 0x200e || codePoint === 0x200f || codePoint === 0x061c;

/** O caractere de controle do `char.IsControl` do .NET: o C0, o DEL e o C1. */
const isControl = (codePoint: number) => codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);

const hexByte = (value: number) => `\\x${value.toString(16).toUpperCase().padStart(2, "0")}`;

/** Os bytes do ponto de código em UTF-8, cada um como `\xHH` (U+202E é `\xE2\x80\xAE`). */
const utf8Escape = (codePoint: number) => Array.from(new TextEncoder().encode(String.fromCodePoint(codePoint)), hexByte).join("");

const doubleEscapes: Record<string, string> = { "\\": "\\\\", '"': '\\"', $: "\\$", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v": "\\v", "\f": "\\f" };

/**
 * O texto como literal do PHP (RN-EXPORT-010; o `ExportText.PhpString` da API, conferido pela fixture `php-string.json`). Nas aspas duplas: a barra
 * invertida, a aspa e o cifrão (`\$`) escapados; a quebra de linha, o retorno de carro, a tabulação, a tabulação vertical e o avanço de página como `\n`,
 * `\r`, `\t`, `\v` e `\f`; os outros controles e o caractere de direção como `\xHH`, um por byte do UTF-8. Nas aspas simples, que não têm escape para eles:
 * só a barra invertida e o apóstrofo escapados, e o caractere de direção é tirado e contado em `removed`.
 */
export function phpString(text: string, singleQuotes: boolean): { literal: string; removed: number } {
  let removed = 0;
  let body = "";
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (singleQuotes) {
      if (isDirectionMark(codePoint)) removed++;
      else body += char === "\\" || char === "'" ? `\\${char}` : char;
      continue;
    }
    const escape = doubleEscapes[char];
    if (escape !== undefined) body += escape;
    else if (isDirectionMark(codePoint) || isControl(codePoint)) body += utf8Escape(codePoint);
    else body += char;
  }
  const quote = singleQuotes ? "'" : '"';
  return { literal: `${quote}${body}${quote}`, removed };
}

/**
 * O nome da variável do PHP a partir do nome da origem (o `ExportText.PhpVariable` da API, conferido pela fixture `php-variable.json`), sem o `$`: sem os
 * caracteres de direção (contados em `removed`), com o que o PHP não aceita num nome (o que não é letra ou dígito do ASCII, `_` ou um caractere fora do
 * ASCII) trocado por `_`, e com um `_` na frente quando começa por dígito; vazio, `resultado`.
 */
export function phpVariable(name: string): { variable: string; removed: number } {
  let removed = 0;
  let variable = "";
  for (const char of name) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (isDirectionMark(codePoint)) removed++;
    else variable += /^[A-Za-z0-9_]$/.test(char) || codePoint >= 0x80 ? char : "_";
  }
  if (variable === "") return { variable: "resultado", removed };
  return { variable: /^[0-9]/.test(variable) ? `_${variable}` : variable, removed };
}

/**
 * RN-EXPORT-010, "Código fonte": um array do PHP, como o DBeaver (o `SourceCodeExportWriter` da API). `<?php`, `$pedido = array(`, um `array(` por linha
 * com `"id" => 1,` por coluna, `),` no fim de cada linha, `);` e `?>`, com tabulação de recuo e LF. No "PHP 5.4 ou mais novo", `[` e `]`. Sem linhas,
 * `$pedido = array();`. O número e o booleano seguem as regras do JSON (o cortado é texto), o nulo é `null`, e o texto é o literal do PHP nas aspas
 * escolhidas. As chaves são os nomes das colunas, com o mesmo escape, e o nome repetido ganha `_2`. O caractere de direção que não tem escape (nas aspas
 * simples e no nome da variável) é tirado e contado; o das chaves conta uma vez, e não por linha.
 */
export function sourceCodeWriter({ columns, sourceName, options }: DocumentContext): DocumentWriter {
  const o = options.sourceCode;
  const counts = emptyCounts();
  const single = o.quote === "single";
  const literal = (text: string) => {
    const written = phpString(text, single);
    counts.removedCharacters += written.removed;
    return written.literal;
  };
  const named = phpVariable(sourceName);
  counts.removedCharacters += named.removed;
  const keys = jsonKeys(columns.map((column) => column.name)).map(literal);
  const open = o.php === "short" ? "[" : "array(";
  const close = o.php === "short" ? "]" : ")";
  let rows = 0;

  const valueOf = (value: string | null, index: number, cut: boolean) => {
    if (value === null) return "null";
    const kind = columns[index].kind;
    if (isBareJsonValue(kind, value, cut)) return value;
    return literal(o.isoDates && kind === "datetime" ? isoDateTime(value) : value);
  };

  return {
    counts,
    begin: () => "<?php\n",
    write: (row) => {
      const cut = row.cut ?? [];
      const head = rows++ === 0 ? `$${named.variable} = ${open}\n` : "";
      return `${head}\t${open}\n${row.values.map((value, index) => `\t\t${keys[index]} => ${valueOf(value, index, cut.includes(index))},\n`).join("")}\t${close},\n`;
    },
    end: () => `${rows === 0 ? `$${named.variable} = ${open}${close};\n` : `${close};\n`}?>\n`,
  };
}
