import type { Engine } from "@/components/ui/engine-tag";

import type { QueryColumn } from "../query.schema";
import { fitsFilter, sqlLiteral } from "../table-sql";

/** Os três caracteres que o campo de filtro (de uma linha só) não comporta e um script comporta: a quebra de linha, o retorno de carro e a tabulação. */
const lineBreak = /[\n\r\t]/;

/** O que vem antes da primeira aspa do literal (o `E` do PostgreSQL com barra invertida, ou nada) e o que está entre a primeira e a última aspa. */
const prefixOf = (literal: string) => literal.slice(0, literal.indexOf("'"));
const bodyOf = (literal: string) => literal.slice(literal.indexOf("'") + 1, -1);

/**
 * Um texto sem retorno de carro como literal do PostgreSQL ou do Db2, com a quebra de linha e a tabulação dentro das aspas. Cada pedaço entre elas passa pelo
 * `sqlLiteral` (como texto) e o resultado é um literal só: o prefixo de um pedaço (o `E` de quem tem barra invertida) vale para todos, porque os pedaços sem
 * prefixo não têm o que ele mude.
 */
function quotedWithBreaks(engine: Engine, text: string): string | null {
  if (!/[\n\t]/.test(text)) return sqlLiteral(engine, text, "text");

  const pieces: ({ literal: string } | { control: string })[] = [];
  for (const [index, part] of text.split(/([\n\t])/).entries()) {
    if (index % 2 === 1) pieces.push({ control: part });
    else if (part !== "") {
      const literal = sqlLiteral(engine, part, "text");
      if (literal === null) return null;
      pieces.push({ literal });
    }
  }

  const prefix = pieces.map((piece) => ("literal" in piece ? prefixOf(piece.literal) : "")).find((found) => found !== "") ?? "";
  return `${prefix}'${pieces.map((piece) => ("control" in piece ? piece.control : bodyOf(piece.literal))).join("")}'`;
}

/**
 * O texto com retorno de carro no PostgreSQL (RN-EXPORT-011): um literal só, `E'...'`, com o retorno de carro como `\r`, a barra invertida e a aspa dobradas,
 * e a quebra de linha e a tabulação como estão. Continua um literal sem tipo, que vale numa coluna `json`, `xml` ou de lista (a expressão
 * `'a' || CHR(13) || 'b'` é `text`, que essas colunas não aceitam sem conversão). Outro caractere de controle deixa o valor sem literal.
 */
function postgresEscapeLiteral(value: string): string | null {
  if (!fitsFilter(value.replace(/[\n\r\t]/g, ""))) return null;
  return `E'${value.replaceAll("\\", "\\\\").replaceAll("'", "''").replaceAll("\r", "\\r")}'`;
}

/**
 * O valor de uma célula como literal de um SCRIPT gerado (RN-GRADE-006), ou `null` quando ele não vira literal. É o `sqlLiteral` (feito para o campo de
 * filtro, de uma linha só) em tudo o que ele resolve: a aspa dobrada, a barra invertida de cada banco (o `E'...'` do PostgreSQL; como está no Db2 e no
 * Informix), o número sem aspas e o `null` de qualquer caractere de controle. Só a quebra de linha, o retorno de carro e a tabulação, que ele recusa por
 * causa da linha única, ganham tratamento aqui:
 *
 * - PostgreSQL e Db2 aceitam a quebra de linha e a tabulação dentro do texto entre aspas simples, e elas vão como estão (o editor da aba de consulta as mantém).
 *   O retorno de carro NÃO vai cru: o script abre numa aba de consulta, cujo editor (CodeMirror) troca `\r\n` e `\r` por `\n`, e o que se executa é o texto do
 *   editor. No PostgreSQL ele vai como `\r` num `E'...'` (`postgresEscapeLiteral`), um literal só; no Db2, como `' || CHR(13) || '`. Os dois atravessam o
 *   editor. Nunca sobra um pedaço vazio entre as partes.
 * - O Informix não aceita nenhum dos três dentro das aspas na configuração padrão do servidor: o valor sai como partes entre aspas unidas por `||`, com
 *   `CHR(10)`, `CHR(13)` e `CHR(9)` no lugar dos caracteres. Nunca sobra um `''` entre elas (uma parte vazia poderia valer nulo na concatenação).
 *
 * Cada parte de texto passa pelo `sqlLiteral`, como texto (um pedaço `12` de `12<quebra>34` não pode virar número). Qualquer OUTRO caractere de controle, o nulo
 * inclusive, deixa o valor sem literal, em qualquer parte. Sem nenhum dos três caracteres, o resultado é o do `sqlLiteral`.
 */
export function scriptLiteral(engine: Engine, value: string, kind: QueryColumn["kind"]): string | null {
  if (!lineBreak.test(value)) return sqlLiteral(engine, value, kind);
  if (engine === 1 && value.includes("\r")) return postgresEscapeLiteral(value);

  // Informix é o banco 3 (PostgreSQL 1, Db2 2). `split` com grupo devolve texto, caractere, texto, caractere… : os de índice ímpar são os caracteres.
  const informix = engine === 3;
  const parts: string[] = [];
  for (const [index, part] of value.split(informix ? /([\n\r\t])/ : /(\r)/).entries()) {
    if (index % 2 === 1) parts.push(`CHR(${part.charCodeAt(0)})`);
    else if (part !== "") {
      const literal = informix ? sqlLiteral(engine, part, "text") : quotedWithBreaks(engine, part);
      if (literal === null) return null;
      parts.push(literal);
    }
  }
  return parts.join(" || ");
}
