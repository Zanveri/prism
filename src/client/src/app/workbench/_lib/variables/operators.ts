import type { ChainOperator } from "./ast";
import { compareFields } from "./dates";
import { expectExact } from "./functions";
import type { Meter } from "./meter";
import {
  booleanValue,
  displayValue,
  numberValue,
  refuse,
  stringValue,
  strictEquals,
  textOf,
  typeLabel,
  typeOfValue,
  type DateValue,
  type NumberValue,
  type StringValue,
  type Value,
} from "./values";
import { limits, phrase } from "./variables.copy";

/*
 * Os operadores (RN-VAR-008): os do JavaScript, com os resultados dele, menos onde ele converteria um tipo em silêncio: aqui isso é erro, com a frase. Funções puras
 * sobre valores; quem percorre a árvore e conta os passos é o avaliador.
 */

const typeWord = (value: Value) => typeLabel(typeOfValue(value));

/** O `+` : soma dois números ou junta dois textos; com um texto e um número, um booleano ou uma data, junta o texto ao texto do outro (RN-VAR-008). */
function add(left: Value, right: Value, meter: Meter): Value {
  if (left.kind === "number" && right.kind === "number") return numberValue(expectExact(left) + expectExact(right));

  const leftText = left.kind === "string";
  const rightText = right.kind === "string";
  if (leftText || rightText) {
    const other = leftText ? right : left;
    if (other.kind === "null") throw refuse(phrase.nullInText());
    if (other.kind !== "string" && other.kind !== "number" && other.kind !== "boolean" && other.kind !== "date") throw refuse(phrase.plusOperands(displayValue(other, 40)));
    const a = leftText ? (left as StringValue).value : textOf(left);
    const b = rightText ? (right as StringValue).value : textOf(right);
    // O tamanho final se confere antes de montar.
    if (a.length + b.length > limits.textLength) throw refuse(phrase.textTooLong());
    meter.weigh(a.length + b.length);
    return stringValue(a + b);
  }
  const offender = left.kind === "number" ? right : left;
  throw refuse(phrase.plusOperands(displayValue(offender, 40)));
}

/** Os operadores aritméticos que só valem para números. */
function arithmetic(op: "-" | "*" | "/" | "%", left: Value, right: Value): Value {
  if (left.kind !== "number") throw refuse(phrase.numbersOnly(op, displayValue(left, 40), typeWord(left)));
  if (right.kind !== "number") throw refuse(phrase.numbersOnly(op, displayValue(right, 40), typeWord(right)));
  const a = expectExact(left);
  const b = expectExact(right);
  switch (op) {
    case "-":
      return numberValue(a - b);
    case "*":
      return numberValue(a * b);
    case "/":
      return numberValue(a / b);
    default:
      return numberValue(a % b);
  }
}

/** `< <= > >=`: números com números, textos com textos e datas com datas. */
function relational(op: "<" | "<=" | ">" | ">=", left: Value, right: Value, meter: Meter): Value {
  let order: number;
  if (left.kind === "number" && right.kind === "number") {
    const a = expectExact(left);
    const b = expectExact(right);
    order = a < b ? -1 : a > b ? 1 : 0;
  } else if (left.kind === "string" && right.kind === "string") {
    meter.weigh(Math.min(left.value.length, right.value.length));
    order = left.value < right.value ? -1 : left.value > right.value ? 1 : 0;
  }
  else if (left.kind === "date" && right.kind === "date") order = compareFields((left as DateValue).fields, (right as DateValue).fields);
  else throw refuse(phrase.compareKinds(op));

  switch (op) {
    case "<":
      return booleanValue(order < 0);
    case "<=":
      return booleanValue(order <= 0);
    case ">":
      return booleanValue(order > 0);
    default:
      return booleanValue(order >= 0);
  }
}

/** `===` e `!==`: como no JavaScript para os números, os textos, os booleanos e o `null`; duas datas são iguais quando são o mesmo instante; listas e objetos não se comparam. */
function equality(op: "===" | "!==", left: Value, right: Value, meter: Meter): Value {
  const compound = (value: Value) => value.kind === "list" || value.kind === "object";
  if ((compound(left) && right.kind !== "null") || (compound(right) && left.kind !== "null")) throw refuse(phrase.equalityKinds(op));
  if (left.kind === "number" && right.kind === "number") {
    expectExact(left);
    expectExact(right);
  }
  if (left.kind === "string" && right.kind === "string") meter.weigh(Math.min(left.value.length, right.value.length));
  const equal = strictEquals(left, right);
  return booleanValue(op === "===" ? equal : !equal);
}

/** O operador de dois lados que não decide pelo valor do primeiro: `+ - * / % < <= > >= === !==`. Os `&& || ??` são do avaliador, que não avalia o lado que não precisa. */
export function binary(op: Exclude<ChainOperator, "&&" | "||" | "??">, left: Value, right: Value, meter: Meter): Value {
  switch (op) {
    case "+":
      return add(left, right, meter);
    case "-":
    case "*":
    case "/":
    case "%":
      return arithmetic(op, left, right);
    case "<":
    case "<=":
    case ">":
    case ">=":
      return relational(op, left, right, meter);
    default:
      return equality(op, left, right, meter);
  }
}

/** `**`: associa à direita, só para números. */
export function power(base: Value, exponent: Value): Value {
  if (base.kind !== "number") throw refuse(phrase.numbersOnly("**", displayValue(base, 40), typeWord(base)));
  if (exponent.kind !== "number") throw refuse(phrase.numbersOnly("**", displayValue(exponent, 40), typeWord(exponent)));
  return numberValue(expectExact(base) ** expectExact(exponent));
}

/** O `-` e o `+` unários: só para números. O `-` direto num literal mantém o texto exato (quem avalia trata antes de chegar aqui). */
export function unaryArithmetic(op: "-" | "+", operand: Value): Value {
  if (operand.kind !== "number") throw refuse(phrase.numbersOnly(op, displayValue(operand, 40), typeWord(operand)));
  const value = expectExact(operand);
  return numberValue(op === "-" ? -value : +value);
}

/** O número escrito com o sinal na frente: o texto exato guarda o sinal (`-9007199254740993`). */
export function signedLiteral(op: "-" | "+", operand: NumberValue): NumberValue {
  const text = operand.exact ?? String(operand.value);
  if (op === "+") return operand;
  const exact = text.startsWith("-") ? text.slice(1) : `-${text}`;
  return numberValue(-operand.value, exact === String(-operand.value) ? undefined : exact);
}
