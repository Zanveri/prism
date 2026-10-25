import type { Engine } from "@/components/ui/engine-tag";

import { scriptLiteral } from "../grid-export/script-literal";
import type { BoundCommand, BoundParameter } from "./bind";
import { phrase } from "./variables.copy";

/*
 * O "SQL enviado" (RN-VAR-018): o texto do comando com os valores no lugar, como literais do banco (os da RN-EXPORT-011, os mesmos do "Gerar SQL" e da exportação:
 * `scriptLiteral`), para ler e para copiar e executar noutro lugar. É só para ver: o que foi ao banco foram os parâmetros. O valor que não tem literal (o texto com um
 * caractere de controle que o literal não escreve) fica com o marcador, e uma linha de comentário no alto diz quais.
 */

export type SentParameterRow = { marker: string; variable: string; type: BoundParameter["type"]; value: string };

export type SentSql = {
  /** O texto com os literais, sem a linha de comentário. */
  text: string;
  /** A linha de comentário do alto, quando algum valor ficou sem literal. */
  header: string | null;
  /** Os parâmetros que ficaram com o marcador (a posição de cada um, de 0 em diante). */
  unresolved: number[];
  /** O quadro dos parâmetros: o marcador, a variável, o tipo e o valor. */
  rows: SentParameterRow[];
  /** Uma linha por variável `sql` que entrou ("sql: @t (texto entrou no comando)"). */
  notes: string[];
  /** Onde, em `text`, entrou o texto de uma variável `sql`: o trecho destacado no fundo de atenção. */
  sqlRanges: { start: number; end: number; name: string }[];
};

/** O número como a API o aceita escreve-se como está: sem aspas, também com expoente. */
const plainNumber = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;

/** O literal de um parâmetro, ou nulo quando ele não tem (RN-EXPORT-011). O nulo é `NULL`. */
export function parameterLiteral(engine: Engine | undefined, parameter: BoundParameter): string | null {
  if (parameter.value === null) return "NULL";
  const dialect = engine ?? 1;
  switch (parameter.type) {
    case "number":
      return plainNumber.test(parameter.value) ? parameter.value : null;
    case "boolean":
      return scriptLiteral(dialect, parameter.value, "boolean");
    case "date":
    case "timestamp":
      return scriptLiteral(dialect, parameter.value, "datetime");
    default:
      return scriptLiteral(dialect, parameter.value, "text");
  }
}

const markerOf = (engine: Engine | undefined, position: number) => (engine === undefined || engine === 1 ? `$${position + 1}` : "?");

export function sentSql(command: BoundCommand, engine: Engine | undefined): SentSql {
  const pieces: string[] = [];
  const sqlRanges: SentSql["sqlRanges"] = [];
  const unresolved: number[] = [];
  const notes: string[] = [];
  let length = 0;
  let last = 0;

  const push = (text: string) => {
    pieces.push(text);
    length += text.length;
  };

  for (const replacement of command.replacements) {
    push(command.sql.slice(last, replacement.sentStart));
    last = replacement.sentEnd;

    if (replacement.kind === "sql") {
      const start = length;
      push(replacement.text ?? "");
      sqlRanges.push({ start, end: length, name: replacement.name });
      notes.push(phrase.sentSqlNote(replacement.name));
      continue;
    }

    const literals: string[] = [];
    for (let position = replacement.firstParameter; position < replacement.firstParameter + replacement.parameterCount; position++) {
      const literal = parameterLiteral(engine, command.params[position]);
      if (literal === null) unresolved.push(position);
      literals.push(literal ?? markerOf(engine, position));
    }
    push(literals.join(", "));
  }
  push(command.sql.slice(last));

  const rows = command.params.map((parameter, position) => ({ marker: markerOf(engine, position), variable: parameter.variable, type: parameter.type, value: parameter.value ?? "null" }));
  const header = unresolved.length === 0 ? null : phrase.sentWithoutLiteral(unresolved.map((position) => markerOf(engine, position)).join(", "));
  return { text: pieces.join(""), header, unresolved, rows, notes, sqlRanges };
}
