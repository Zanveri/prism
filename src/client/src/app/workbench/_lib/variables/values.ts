import { dateText, existsAsDate, type DateFields, type DatePrecision } from "./dates";
import { VariableError } from "./errors";
import { isExactNumber, isIntegerText } from "./numbers";
import { limits, phrase } from "./variables.copy";

/*
 * Os valores da linguagem (RN-VAR-004 e 014). Um valor é um REGISTRO DA LINGUAGEM, e nunca um objeto do JavaScript da tela: congelado, sem protótipo, com os
 * campos de um objeto num `Map` (um campo chamado `__proto__` ou `constructor` não chega a nada), e de sete espécies mais o `sql`. Nunca uma função, um `Symbol`,
 * um `undefined` nem um `Proxy`.
 */

/** O número do JavaScript. `exact` é o texto exato que veio do banco ou foi escrito no script (RN-VAR-005); `inexact` diz que o `double` não o escreve inteiro. */
export type NumberValue = Readonly<{ kind: "number"; value: number; exact?: string; inexact?: true }>;
export type StringValue = Readonly<{ kind: "string"; value: string }>;
export type BooleanValue = Readonly<{ kind: "boolean"; value: boolean }>;
export type NullValue = Readonly<{ kind: "null" }>;
/** A data (RN-VAR-007): os campos do calendário e a precisão; `exact` é o texto exato que veio do banco. */
export type DateValue = Readonly<{ kind: "date"; fields: Readonly<DateFields>; precision: DatePrecision; exact?: string }>;
export type ListValue = Readonly<{ kind: "list"; items: readonly Value[] }>;
export type ObjectValue = Readonly<{ kind: "object"; fields: ReadonlyMap<string, Value> }>;
/** O texto que entra cru no comando (RN-VAR-004 e 017). */
export type SqlValue = Readonly<{ kind: "sql"; text: string }>;
export type Value = NumberValue | StringValue | BooleanValue | NullValue | DateValue | ListValue | ObjectValue | SqlValue;

/** O erro de um valor que não pode existir, sem posição: quem avalia põe a do nó (`offset` -1, RN-VAR-012). */
export const noOffset = -1;
export const refuse = (message: string) => new VariableError(message, noOffset);

/** Um registro congelado e sem protótipo. */
function record<T extends object>(fields: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, fields));
}

/** O `Map` dos campos de um objeto, que não se muda: a chave vem do texto da pessoa e nunca é uma propriedade. */
class FieldMap extends Map<string, Value> {
  constructor(entries: readonly (readonly [string, Value])[]) {
    super();
    for (const [key, value] of entries) Map.prototype.set.call(this, key, value);
    Object.freeze(this);
  }
  override set(): never {
    throw new TypeError("O objeto é congelado.");
  }
  override delete(): never {
    throw new TypeError("O objeto é congelado.");
  }
  override clear(): never {
    throw new TypeError("O objeto é congelado.");
  }
}

export const nullValue: NullValue = record({ kind: "null" as const });
export const trueValue: BooleanValue = record({ kind: "boolean" as const, value: true });
export const falseValue: BooleanValue = record({ kind: "boolean" as const, value: false });
export const booleanValue = (value: boolean): BooleanValue => (value ? trueValue : falseValue);

/** Os nomes vedados como membro, como chave de objeto e como nome de coluna (RN-VAR-014): a regra positiva já os recusa; a lista existe para a frase e para os testes. */
export const forbiddenMembers: ReadonlySet<string> = new Set([
  "constructor", "prototype", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "caller", "callee", "arguments", "toString", "valueOf",
  "toLocaleString", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "call", "apply", "bind", "then",
]);

/** O número, com o texto exato quando há (RN-VAR-005). O `NaN` e o `Infinity` nunca viram valor. */
export function numberValue(value: number, exact?: string): NumberValue {
  if (!Number.isFinite(value)) throw refuse(phrase.notANumberResult());
  const normalized = Object.is(value, -0) ? 0 : value;
  if (exact === undefined) return record({ kind: "number" as const, value: normalized });
  return isExactNumber(exact, normalized)
    ? record({ kind: "number" as const, value: normalized, exact })
    : record({ kind: "number" as const, value: normalized, exact, inexact: true as const });
}

const halfPair = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** O texto (RN-VAR-006): até 1.000.000 de unidades UTF-16, sem U+0000 e sem metade de um par UTF-16. */
export function stringValue(value: string): StringValue {
  if (value.length > limits.textLength) throw refuse(phrase.textTooLong());
  if (value.includes("\u0000")) throw refuse(phrase.textHasNul());
  const half = halfPair.exec(value);
  if (half !== null) throw refuse(phrase.textHasHalfPair(half[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")));
  return record({ kind: "string" as const, value });
}

export function dateValue(fields: DateFields, precision: DatePrecision, exact?: string): DateValue {
  if (!existsAsDate(fields)) throw refuse(phrase.dateOutOfRange());
  const copy = Object.freeze({ year: fields.year, month: fields.month, day: fields.day, hour: fields.hour, minute: fields.minute, second: fields.second, millisecond: fields.millisecond });
  return exact === undefined ? record({ kind: "date" as const, fields: copy, precision }) : record({ kind: "date" as const, fields: copy, precision, exact });
}

export function listValue(items: readonly Value[]): ListValue {
  if (items.length > limits.listItems) throw refuse(phrase.listTooLong());
  return record({ kind: "list" as const, items: Object.freeze(items.slice()) });
}

export function objectValue(entries: readonly (readonly [string, Value])[]): ObjectValue {
  if (entries.length > limits.objectFields) throw refuse(phrase.objectTooBig());
  for (const [key] of entries) if (forbiddenMembers.has(key)) throw refuse(phrase.keyForbidden(key));
  return record({ kind: "object" as const, fields: new FieldMap(entries) });
}

export function sqlValue(text: string): SqlValue {
  if (text.length > limits.sqlLength) throw refuse(phrase.sqlTooLong());
  if (text.includes("\u0000")) throw refuse(phrase.sqlHasNul());
  return record({ kind: "sql" as const, text });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Os tipos (RN-VAR-004).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * O tipo de uma variável ou de um valor. `nullable` é o `T | null`; `never` é o tipo da lista vazia (cabe em qualquer lista). A `Date` carrega a precisão do valor de
 * que veio (`Date (dia)`), e a anotada não (`Date` serve às duas).
 */
export type Type =
  | { tag: "number" | "string" | "boolean" | "sql" | "null" | "never" }
  | { tag: "date"; precision?: DatePrecision }
  | { tag: "list"; item: Type }
  | { tag: "object"; fields: ReadonlyMap<string, Type> }
  | { tag: "nullable"; of: Type };

export const numberType: Type = { tag: "number" };
export const stringType: Type = { tag: "string" };
export const booleanType: Type = { tag: "boolean" };
export const sqlType: Type = { tag: "sql" };
export const nullType: Type = { tag: "null" };
export const neverType: Type = { tag: "never" };

export const nullable = (of: Type): Type => (of.tag === "nullable" || of.tag === "null" ? of : { tag: "nullable", of });
export const withoutNull = (type: Type): Type => (type.tag === "nullable" ? type.of : type);

export function typeOfValue(value: Value): Type {
  switch (value.kind) {
    case "date":
      return { tag: "date", precision: value.precision };
    case "list": {
      let item: Type = neverType;
      for (const element of value.items) {
        const joined = unify(item, typeOfValue(element));
        if (joined === null) return { tag: "list", item: typeOfValue(element) };
        item = joined;
      }
      return { tag: "list", item };
    }
    case "object":
      return { tag: "object", fields: new Map([...value.fields].map(([key, field]) => [key, typeOfValue(field)])) };
    default:
      return { tag: value.kind };
  }
}

/** O tipo que serve aos dois (a lista `[1, null]` é `(number | null)[]`), ou `null` quando eles não se misturam (`[1, 'a']`). */
export function unify(left: Type, right: Type): Type | null {
  if (left.tag === "never") return right;
  if (right.tag === "never") return left;
  if (left.tag === "null") return nullable(right);
  if (right.tag === "null") return nullable(left);
  if (left.tag === "nullable" || right.tag === "nullable") {
    const joined = unify(withoutNull(left), withoutNull(right));
    return joined === null ? null : nullable(joined);
  }
  if (left.tag !== right.tag) return null;
  if (left.tag === "date" && right.tag === "date") return left.precision === right.precision ? left : { tag: "date" };
  if (left.tag === "list" && right.tag === "list") {
    const item = unify(left.item, right.item);
    return item === null ? null : { tag: "list", item };
  }
  if (left.tag === "object" && right.tag === "object") {
    if (left.fields.size !== right.fields.size) return null;
    const fields = new Map<string, Type>();
    for (const [key, type] of left.fields) {
      const other = right.fields.get(key);
      const joined = other === undefined ? null : unify(type, other);
      if (joined === null) return null;
      fields.set(key, joined);
    }
    return { tag: "object", fields };
  }
  return left;
}

/** Se um valor de tipo `value` cabe numa variável de tipo `target` (RN-VAR-004): o `null` só cabe no `| null` ou no tipo `null`. */
export function fits(value: Type, target: Type): boolean {
  if (value.tag === "never") return true;
  if (target.tag === "nullable") return value.tag === "null" || fits(value.tag === "nullable" ? value.of : value, target.of);
  if (value.tag === "nullable") return false;
  if (target.tag === "null") return value.tag === "null";
  if (value.tag !== target.tag) return false;
  if (value.tag === "list" && target.tag === "list") return fits(value.item, target.item);
  if (value.tag === "object" && target.tag === "object") {
    for (const [key, type] of target.fields) {
      const other = value.fields.get(key);
      if (other === undefined || !fits(other, type)) return false;
    }
    return true;
  }
  return true;
}

/** O nome do tipo como a tela o escreve: `number`, `string[]`, `Date (dia)`, `sql`, `objeto`, com o `| null` (RN-VAR-024). */
export function typeLabel(type: Type): string {
  switch (type.tag) {
    case "nullable":
      return `${typeLabel(type.of)} | null`;
    case "list": {
      const item = typeLabel(type.item);
      return type.item.tag === "nullable" ? `(${item})[]` : `${item}[]`;
    }
    case "date":
      return type.precision === undefined ? "Date" : type.precision === "day" ? "Date (dia)" : "Date (instante)";
    case "object":
      return "objeto";
    case "never":
      return "never";
    default:
      return type.tag;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// O texto de um valor e como ele se mostra.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** O texto de um número: o exato quando há, ou o do JavaScript (`String(1e21)` é `1e+21`, RN-VAR-005). */
export const numberText = (value: NumberValue): string => value.exact ?? String(value.value);

/** O texto de uma data: o exato que veio do banco, ou `aaaa-mm-dd` e `aaaa-mm-dd hh:mm:ss[.fff]` (RN-VAR-007). */
export const dateValueText = (value: DateValue): string => value.exact ?? dateText(value.fields, value.precision);

/**
 * O texto de um valor para o `String()`, o modelo e o `+` com um texto (RN-VAR-005 a 008): a função da linguagem, e nunca o `toString` de um objeto do JavaScript. A
 * lista tem os itens separados por vírgula; o `null` de dentro dela é vazio, como no `join` do JavaScript; o objeto não vira texto.
 */
export function textOf(value: Value): string {
  switch (value.kind) {
    case "number":
      return numberText(value);
    case "string":
      return value.value;
    case "boolean":
      return value.value ? "true" : "false";
    case "null":
      return "null";
    case "date":
      return dateValueText(value);
    case "list": {
      const parts: string[] = [];
      let length = 0;
      for (const item of value.items) {
        const part = item.kind === "null" ? "" : textOf(item);
        length += part.length + 1;
        if (length > limits.textLength) throw refuse(phrase.textTooLong());
        parts.push(part);
      }
      return parts.join(",");
    }
    case "sql":
      return value.text;
    case "object":
      throw refuse(phrase.objectToText());
  }
}

const escapes: Record<string, string> = { "\\": "\\\\", "'": "\\'", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\b": "\\b", "\f": "\\f", "\v": "\\v" };

/** O texto entre aspas simples, com os escapes do JavaScript, como a pessoa o escreveria. */
export function quoted(text: string): string {
  let result = "'";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (escapes[character] !== undefined) result += escapes[character];
    else if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) result += `\\u${code.toString(16).padStart(4, "0")}`;
    else result += character;
  }
  return `${result}'`;
}

/** O valor como a tela o mostra de forma curta (o painel, a dica, o fim da linha, as frases dos erros): cortado em `max` caracteres, com `…` (RN-VAR-024). */
export function displayValue(value: Value, max = 200): string {
  const text = shownValue(value, max);
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function shownValue(value: Value, budget: number): string {
  switch (value.kind) {
    case "string":
      return quoted(value.value.length > budget ? value.value.slice(0, budget) : value.value);
    case "sql":
      return `sql ${quoted(value.text.length > budget ? value.text.slice(0, budget) : value.text)}`;
    case "list": {
      const parts: string[] = [];
      let used = 2;
      for (const item of value.items) {
        if (used > budget) {
          parts.push("…");
          break;
        }
        const part = shownValue(item, budget - used);
        parts.push(part);
        used += part.length + 2;
      }
      return `[${parts.join(", ")}]`;
    }
    case "object": {
      if (value.fields.size === 0) return "{}";
      const parts: string[] = [];
      let used = 4;
      for (const [key, field] of value.fields) {
        if (used > budget) {
          parts.push("…");
          break;
        }
        const part = `${key}: ${shownValue(field, budget - used)}`;
        parts.push(part);
        used += part.length + 2;
      }
      return `{ ${parts.join(", ")} }`;
    }
    default:
      return textOf(value);
  }
}

/** O valor no fim da linha da declaração (RN-VAR-025): `7`, `'Ana'`, `[1, 2, 3] · 3 itens`, `{ id: 7, nome: 'Ana' }`, `2026-10-20`, `null`, cortado em 60 caracteres. */
export function inlineValue(value: Value, max = 60): string {
  const base = displayValue(value, max);
  if (value.kind === "list") return `${base} · ${value.items.length} ${value.items.length === 1 ? "item" : "itens"}`;
  return base;
}

/** O nome da espécie de um valor, para as frases de erro ("p é number, e não tem campos."). */
export function kindLabel(value: Value): string {
  switch (value.kind) {
    case "date":
      return "Date";
    case "object":
      return "objeto";
    case "list":
      return "lista";
    default:
      return value.kind;
  }
}

/** Se a igualdade do `===` vale para estes dois (RN-VAR-008): listas e objetos não se comparam. */
export function strictEquals(left: Value, right: Value): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "number":
      return left.value === (right as NumberValue).value;
    case "string":
    case "boolean":
      return left.value === (right as StringValue | BooleanValue).value;
    case "null":
      return true;
    case "date": {
      const other = right as DateValue;
      return left.fields.year === other.fields.year && left.fields.month === other.fields.month && left.fields.day === other.fields.day && left.fields.hour === other.fields.hour &&
        left.fields.minute === other.fields.minute && left.fields.second === other.fields.second && left.fields.millisecond === other.fields.millisecond;
    }
    case "sql":
      return left.text === (right as SqlValue).text;
    default:
      return false;
  }
}

/** O valor "falso" do JavaScript (RN-VAR-008): `false`, `0`, `-0`, `''` e `null`; o resto é verdadeiro, também a lista vazia. */
export function isFalsy(value: Value): boolean {
  switch (value.kind) {
    case "null":
      return true;
    case "boolean":
      return !value.value;
    case "number":
      return value.value === 0;
    case "string":
      return value.value === "";
    default:
      return false;
  }
}

/** O texto exato de um inteiro, para quem só quer saber se o número tem a forma de inteiro. */
export const isIntegerNumber = (value: NumberValue): boolean => (value.exact !== undefined ? isIntegerText(value.exact) : Number.isInteger(value.value));
