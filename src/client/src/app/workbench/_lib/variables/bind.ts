import type { Engine } from "@/components/ui/engine-tag";

import { statementCount } from "../sql-statements";
import { findAtReferences, type AtReference } from "./at-names";
import { dateText, offsetText } from "./dates";
import { VariableError } from "./errors";
import { scanMarkers } from "./markers";
import { significantDigits } from "./numbers";
import { dateValueText, numberText, typeLabel, typeOfValue, type Type, type Value } from "./values";
import { limits, phrase } from "./variables.copy";

/*
 * A troca pelos marcadores (RN-VAR-017): a tela troca cada `@nome` pelo marcador do banco e manda os valores ao lado, com o tipo. O valor vai SEMPRE como parâmetro,
 * e nunca colado no texto; só o `sql` entra no texto, como está. A lista vira uma lista de marcadores. A API não reescreve nada: o texto que ela recebe é o que vai ao banco.
 */

/** O tipo de um parâmetro no pedido à API (RN-VAR-032). */
export type ParameterType = "text" | "number" | "boolean" | "date" | "timestamp";

/** Um parâmetro: o valor vai como texto (ou nulo, com o tipo que o Db2 e o Informix usam). `variable` e `item` dizem de onde ele veio (`@ids[2]`). */
export type BoundParameter = { type: ParameterType; value: string | null; variable: string; item: number | null };

/** Onde um `@nome` estava e onde ficou o que o trocou: `start`/`end` no texto do comando, `sentStart`/`sentEnd` no texto enviado (RN-SQL-009). */
export type Replacement = {
  name: string;
  kind: "parameter" | "list" | "sql";
  start: number;
  end: number;
  sentStart: number;
  sentEnd: number;
  /** Os parâmetros que ele gerou: o primeiro e quantos. */
  firstParameter: number;
  parameterCount: number;
  /** O texto de um `sql`, que entrou no comando. */
  text?: string;
};

/** O comando pronto para ir ao banco (RN-VAR-017 e 032): o texto com os marcadores e os parâmetros na ordem deles. */
export type BoundCommand = { sql: string; params: BoundParameter[]; replacements: Replacement[] };

/** O texto em UTF-8, em bytes, sem montar um buffer. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

/** Os bytes que um texto ocupa escrito em JSON: o caractere de controle vira `\u00XX`, a aspa e a barra ganham uma barra. */
function jsonBytes(text: string): number {
  let bytes = 2;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20) bytes += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
    else if (code === 34 || code === 92) bytes += 2;
    else if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

/** Os bytes do pedido à API com o comando e os parâmetros (RN-VAR-032): o texto e cada `{ type, value }` escritos em JSON, mais a folga do resto do corpo. */
export function requestBodyBytes(sql: string, params: readonly BoundParameter[]): number {
  let body = jsonBytes(sql) + 200;
  for (const parameter of params) body += 40 + (parameter.value === null ? 4 : jsonBytes(parameter.value));
  return body;
}

/** Os parâmetros como a API os lê (RN-VAR-032): só `type` e `value`. Uma terceira chave (`variable`, `item`) é 422 `QUERY_INVALID`, e fica na tela, para o "SQL enviado". */
export const requestParams = (params: readonly BoundParameter[]): { type: ParameterType; value: string | null }[] => params.map(({ type, value }) => ({ type, value }));

/** O texto do número como a API o aceita (`^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$`): sem zeros à esquerda. */
function numberParameterText(value: Value & { kind: "number" }): string {
  return numberText(value).replace(/^(-?)0+(?=\d)/, "$1");
}

/** O tipo do parâmetro nulo: o do tipo da variável, que o Db2 e o Informix usam (o `null` de `VARCHAR`, de `BIGINT`…). */
function nullParameterType(type: Type | undefined): ParameterType {
  let base = type;
  while (base?.tag === "nullable") base = base.of;
  if (base?.tag === "list") base = base.item;
  while (base?.tag === "nullable") base = base.of;
  switch (base?.tag) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return base.precision === "day" ? "date" : "timestamp";
    default:
      return "text";
  }
}

/** O valor simples como parâmetro (RN-VAR-017). No PostgreSQL o instante leva o deslocamento da máquina naquela data (`-03`). */
function toParameter(value: Value, variable: string, item: number | null, engine: Engine | undefined, declared: Type | undefined): BoundParameter {
  switch (value.kind) {
    case "number": {
      const text = numberParameterText(value);
      // O `DECIMAL` do Db2 e o do Informix guardam até 31 dígitos pelo driver (a S-VAR-1 provou que com 32 o servidor recusa); o número escrito com expoente vai como `DOUBLE`.
      if ((engine === 2 || engine === 3) && !/[eE]/.test(text)) {
        const digits = significantDigits(text);
        if (digits > limits.decimalDigits) throw new VariableError(phrase.numberTooManyDigits(digits, engine === 2 ? "Db2" : "Informix", limits.decimalDigits), -1);
      }
      // A API confere o `number` até 100 caracteres (RN-VAR-032), e o PostgreSQL leva o texto como veio.
      if (text.length > limits.numberCharacters) throw new VariableError(phrase.numberTooLong(text.length), -1);
      return { type: "number", value: text, variable, item };
    }
    case "string":
      return { type: "text", value: value.value, variable, item };
    case "boolean":
      return { type: "boolean", value: value.value ? "true" : "false", variable, item };
    case "null":
      return { type: nullParameterType(declared), value: null, variable, item };
    case "date": {
      if (value.precision === "day") return { type: "date", value: dateValueText(value), variable, item };
      const text = value.exact ?? `${dateText(value.fields, "instant")}${engine === 1 || engine === undefined ? offsetText(value.fields) : ""}`;
      return { type: "timestamp", value: text, variable, item };
    }
    default:
      throw new VariableError(phrase.valueNotInText(variable, typeLabel(typeOfValue(value))), -1);
  }
}

/** A palavra (só letras) que termina em `end`, sem os espaços de antes dela, em minúsculas. */
function wordBefore(sql: string, end: number): string {
  let at = end;
  while (at > 0 && /\s/.test(sql[at - 1])) at--;
  const stop = at;
  while (at > 0 && /[A-Za-z]/.test(sql[at - 1])) at--;
  return sql.slice(at, stop).toLowerCase();
}

/** O caractere que vem antes de `at` sem os espaços, e a posição dele. */
function previousSignificant(sql: string, at: number): { character: string; position: number } {
  let position = at - 1;
  while (position >= 0 && /\s/.test(sql[position])) position--;
  return { character: position < 0 ? "" : sql[position], position };
}

function nextSignificant(sql: string, at: number): string {
  let position = at;
  while (position < sql.length && /\s/.test(sql[position])) position++;
  return position >= sql.length ? "" : sql[position];
}

type Resolved =
  | { kind: "sql"; ref: AtReference; text: string; end: number }
  | { kind: "values"; ref: AtReference; values: readonly Value[]; list: boolean; end: number; label: string; declared: Type | undefined };

/** O que o `@nome` vira, pelo valor da variável (RN-VAR-016 e 017): o texto do `sql`, o campo de um objeto, o valor ou a lista de valores. Lança a frase do erro do comando. */
function resolve(ref: AtReference, value: Value, declared: Type | undefined): Resolved {
  const fail = (message: string) => new VariableError(message, ref.start);

  if (value.kind === "sql") return { kind: "sql", ref, text: value.text, end: ref.end };

  let target: Value = value;
  let end = ref.end;
  let label = `@${ref.name}`;
  let targetType = declared;

  if (value.kind === "object") {
    if (ref.field === null) throw fail(phrase.objectWithoutField(ref.name, value.fields.keys().next().value ?? "campo"));
    const field = value.fields.get(ref.field.name);
    if (field === undefined) throw fail(phrase.objectNoField(ref.name, ref.field.name, [...value.fields.keys()]));
    target = field;
    end = ref.field.end;
    label = `@${ref.name}.${ref.field.name}`;
    targetType = declared?.tag === "object" ? declared.fields.get(ref.field.name) : undefined;
  } else if (ref.field !== null) {
    throw fail(value.kind === "null" ? phrase.fieldOfNullPlain(ref.name, ref.field.name) : phrase.fieldOfNonObject(ref.name, typeLabel(typeOfValue(value))));
  }

  if (target.kind === "list") {
    if (target.items.some((item) => item.kind === "object")) throw fail(phrase.listOfObjects(ref.name));
    return { kind: "values", ref, values: target.items, list: true, end, label, declared: targetType };
  }
  if (target.kind === "object") throw fail(phrase.objectWithoutField(ref.name, target.fields.keys().next().value ?? "campo"));
  if (target.kind === "sql") throw fail(phrase.valueNotInText(label, "sql"));
  return { kind: "values", ref, values: [target], list: false, end, label, declared: targetType };
}

/**
 * Troca os `@nome` do comando `text` pelos marcadores do banco (RN-VAR-017). `declared` são os nomes declarados no script e `scope` os valores no ponto do comando; os
 * tipos declarados dão o tipo do parâmetro nulo. Sem nenhuma variável, o comando vai como está, sem parâmetros. Lança `VariableError` (a posição é a do `@nome`, no texto
 * do comando) quando o comando não pode ser montado: a lista fora de parênteses, a lista vazia, o `null` sozinho num `IN`, o objeto sem campo, o número com dígitos
 * demais, o marcador já escrito, o `sql` que faz dois comandos, e os limites dos parâmetros.
 */
export function bindCommand(text: string, engine: Engine | undefined, declared: ReadonlySet<string>, scope: ReadonlyMap<string, Value>, types: ReadonlyMap<string, Type> = new Map()): BoundCommand {
  const { references } = findAtReferences(text, engine, declared);
  if (references.length === 0) return { sql: text, params: [], replacements: [] };

  const written = scanMarkers(text, engine);
  if (written.count > 0) throw new VariableError(phrase.markerAlreadyThere(written.first ?? "?"), references[0].start);

  // Primeiro o que cada `@nome` vira; depois a conta dos parâmetros; só então o texto, para não montar o que passa dos limites.
  const resolved: Resolved[] = references.map((ref) => {
    const value = scope.get(ref.name);
    if (value === undefined) throw new VariableError(phrase.noValue(ref.name), ref.start);
    return resolve(ref, value, types.get(ref.name));
  });

  let total = 0;
  for (const item of resolved) if (item.kind === "values") total += item.values.length;
  if (total > limits.parameters) throw new VariableError(phrase.tooManyParameters(total), references[0].start);

  const postgres = engine === undefined || engine === 1;
  const params: BoundParameter[] = [];
  const replacements: Replacement[] = [];
  const pieces: string[] = [];
  let sentLength = 0;
  let last = 0;
  let bytes = 0;

  for (const item of resolved) {
    const { ref } = item;
    const between = text.slice(last, ref.start);
    pieces.push(between);
    sentLength += between.length;
    const sentStart = sentLength;
    last = item.end;

    if (item.kind === "sql") {
      pieces.push(item.text);
      sentLength += item.text.length;
      replacements.push({ name: ref.name, kind: "sql", start: ref.start, end: ref.end, sentStart, sentEnd: sentLength, firstParameter: params.length, parameterCount: 0, text: item.text });
      continue;
    }

    const { values, list } = item;
    const before = previousSignificant(text, ref.start);
    const after = nextSignificant(text, item.end);
    const insideParentheses = (before.character === "(" || before.character === ",") && (after === ")" || after === ",");

    if (list) {
      if (!insideParentheses) throw new VariableError(phrase.listOutsideParentheses(ref.name), ref.start);
      // `= ANY(@ids)` e `ARRAY(@ids)`: o PostgreSQL espera uma lista do banco, e a nossa vira vários valores.
      if (before.character === "(" && ["any", "all", "some", "array"].includes(wordBefore(text, before.position))) throw new VariableError(phrase.listAfterAny(ref.name), ref.start);
      if (values.length === 0) throw new VariableError(phrase.emptyList(ref.name), ref.start);
    }
    // O `null` sozinho num `IN (@x)` ou `NOT IN (@x)` nunca acha nada.
    if (values.length === 1 && values[0].kind === "null" && before.character === "(" && after === ")" && wordBefore(text, before.position) === "in")
      throw new VariableError(phrase.nullInList(ref.name), ref.start);

    const first = params.length;
    const markers: string[] = [];
    values.forEach((value, position) => {
      let parameter: BoundParameter;
      try {
        parameter = toParameter(value, list ? `${item.label}[${position}]` : item.label, list ? position : null, engine, item.declared);
      } catch (error) {
        // O erro de um valor que o banco não guarda é do `@nome` que o trouxe.
        if (error instanceof VariableError && error.offset < 0) throw new VariableError(error.message, ref.start);
        throw error;
      }
      if (parameter.value !== null) bytes += utf8Length(parameter.value);
      if (bytes > limits.parameterBytes) throw new VariableError(phrase.parametersTooBig(), ref.start);
      params.push(parameter);
      markers.push(postgres ? `$${params.length}` : "?");
    });

    const marker = markers.join(", ");
    pieces.push(marker);
    sentLength += marker.length;
    replacements.push({ name: ref.name, kind: list ? "list" : "parameter", start: ref.start, end: item.end, sentStart, sentEnd: sentLength, firstParameter: first, parameterCount: values.length });
  }
  pieces.push(text.slice(last));
  const sql = pieces.join("");

  checkSqlValues(text, sql, engine, replacements, references[0].start);

  // O corpo do pedido à API tem um limite (RN-VAR-032): a tela confere antes de mandar e não manda o que passa.
  if (requestBodyBytes(sql, params) > limits.requestBodyBytes) throw new VariableError(phrase.requestTooBig(), references[0].start);

  return { sql, params, replacements };
}

/** O que o texto de um `sql` pode ter feito com o comando (RN-VAR-017): ter virado vários comandos, ou ter trazido um marcador que o Prism não sabe numerar. */
function checkSqlValues(original: string, sent: string, engine: Engine | undefined, replacements: readonly Replacement[], at: number): void {
  const inserted = replacements.filter((replacement) => replacement.kind === "sql");
  if (inserted.length === 0) return;

  for (const replacement of inserted)
    if (scanMarkers(replacement.text ?? "", engine).count > 0) throw new VariableError(phrase.sqlHasMarker(replacement.name), at);

  const before = statementCount(original, engine);
  const after = statementCount(sent, engine);
  if (after !== before) throw new VariableError(phrase.sqlMadeSeveral(inserted[0].name, after), at);
}
