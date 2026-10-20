import {
  addDaysTo,
  addMonthsTo,
  dayNumber,
  daysInMonth,
  diffDays,
  existsAsDate,
  fieldsFromMilliseconds,
  localMilliseconds,
  outOfRange,
  parseDateText,
  type DateFields,
  type DatePrecision,
} from "./dates";
import { VariableError } from "./errors";
import type { Environment, Meter } from "./meter";
import { isIntegerText } from "./numbers";
import {
  booleanValue,
  dateValue,
  dateValueText,
  displayValue,
  kindLabel,
  listValue,
  nullValue,
  numberValue,
  refuse,
  strictEquals,
  stringValue,
  textOf,
  type DateValue,
  type ListValue,
  type NumberValue,
  type StringValue,
  type Value,
} from "./values";
import { limits, phrase } from "./variables.copy";

/*
 * As funções e os métodos que existem (RN-VAR-009 e 010): uma lista fechada, em `Map`s (a busca é por `Map.get`, nunca por `tabela[nome]`, RN-VAR-014). Cada função
 * diz os argumentos que aceita; a conferência de quantos e de que tipo é uma só, para todas, e a frase também. O que devolve `undefined` no JavaScript devolve `null`
 * aqui. Toda função que devolve texto ou lista calcula o tamanho final antes de montar e recusa o que passa do limite do tipo (RN-VAR-014).
 */

/** O que um argumento pode ser: `number` recusa o número inexato (RN-VAR-005); `numberAny` o aceita (índices e testes que só olham o texto). */
type ParamKind = "number" | "numberAny" | "integer" | "string" | "date" | "list" | "any" | "stringOrNumber";

type Param = { kind: ParamKind; optional?: boolean };

/** O que a chamada tem à mão: o ambiente, o medidor e o nome da função para as frases. */
export type CallContext = { env: Environment; meter: Meter; name: string };

type FunctionDef = {
  params: readonly Param[];
  /** Os argumentos a mais, todos deste tipo, de `min` a `max`. */
  rest?: { param: Param; min: number; max: number };
  /** Muda com a hora ou com a sorte: a conferência antes de executar não avalia (RN-VAR-012). */
  nondeterministic?: boolean;
  run: (args: readonly Value[], context: CallContext) => Value;
};

type MethodDef = Omit<FunctionDef, "run"> & { run: (receiver: never, args: readonly Value[], context: CallContext) => Value };

const kindNames: Record<ParamKind, string> = { number: "number", numberAny: "number", integer: "um número inteiro", string: "string", date: "Date", list: "lista", any: "um valor", stringOrNumber: "string ou number" };

const required = (...kinds: ParamKind[]): Param[] => kinds.map((kind) => ({ kind }));
const withOptional = (...kinds: ParamKind[]): Param[] => kinds.map((kind) => ({ kind, optional: true }));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// A conferência dos argumentos.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** O erro do número que o `double` não escreve inteiro (RN-VAR-005): o inteiro e o decimal têm frases diferentes. */
export function inexactError(value: NumberValue): VariableError {
  const text = value.exact ?? String(value.value);
  return refuse(isIntegerText(text) ? phrase.inexactInteger(text) : phrase.inexactDecimal(text));
}

export function expectExact(value: NumberValue): number {
  if (value.inexact === true) throw inexactError(value);
  return value.value;
}

function conforms(kind: ParamKind, value: Value): boolean {
  switch (kind) {
    case "number":
    case "numberAny":
      return value.kind === "number";
    case "integer":
      return value.kind === "number" && Number.isInteger(value.value);
    case "string":
      return value.kind === "string";
    case "date":
      return value.kind === "date";
    case "list":
      return value.kind === "list";
    case "stringOrNumber":
      return value.kind === "string" || value.kind === "number";
    default:
      return true;
  }
}

const countText = (min: number, max: number): string => (min === max ? `${min} ${min === 1 ? "argumento" : "argumentos"}` : max === Infinity ? `pelo menos ${min} ${min === 1 ? "argumento" : "argumentos"}` : `de ${min} a ${max} argumentos`);

/** Confere quantos e quais argumentos a função aceita (RN-VAR-009): "<função> espera <n> argumentos, e recebeu <m>." e "<função> espera <tipo> no argumento <p>, e recebeu <valor>.". */
function checkArguments(def: Pick<FunctionDef, "params" | "rest">, name: string, args: readonly Value[]): void {
  const min = def.params.filter((param) => param.optional !== true).length + (def.rest?.min ?? 0);
  const max = def.params.length + (def.rest?.max ?? 0);
  if (args.length < min || args.length > max) throw refuse(phrase.argCount(name, countText(min, def.rest === undefined ? max : max), args.length));

  args.forEach((arg, index) => {
    const param = index < def.params.length ? def.params[index] : def.rest?.param;
    if (param === undefined) return;
    if (!conforms(param.kind, arg)) throw refuse(phrase.argType(name, kindNames[param.kind], index + 1, displayValue(arg, 60)));
    if ((param.kind === "number" || param.kind === "integer" || param.kind === "stringOrNumber") && arg.kind === "number" && arg.inexact === true) throw inexactError(arg);
  });
}

const textLimit = limits.textLength;

function checkedText(value: string): StringValue {
  return stringValue(value);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// As funções dos espaços de nomes e as soltas.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

const numberResult = (value: number): Value => numberValue(value);

/** `Math.abs` e os outros de um número só. */
function mathUnary(operation: (x: number) => number): FunctionDef {
  return { params: required("number"), run: ([x]) => numberResult(operation((x as NumberValue).value)) };
}

const noRandom = { nondeterministic: true } as const;

/** O texto de uma data com o ano de quatro dígitos, para as frases (`2026-04-31`). */
const calendarText = (year: number, month: number, day: number) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const fieldsOf = (value: Value): DateFields => (value as DateValue).fields;
const precisionOf = (value: Value): DatePrecision => (value as DateValue).precision;

/** Uma data a partir de campos que podem sair da faixa. */
function dateOrRange(fields: DateFields | null, precision: DatePrecision): Value {
  if (fields === null) throw outOfRange(-1);
  return dateValue(fields, precision);
}

/** O número exato de um argumento inteiro de data (`n` de `date.addDays`). */
function integerArgument(name: string, value: Value): number {
  if (value.kind !== "number" || !Number.isInteger(value.value)) throw refuse(phrase.dateAddInteger(name));
  return expectExact(value);
}

const randomIntBounds = (name: string, min: Value, max: Value): [number, number] => {
  const low = (min as NumberValue).value;
  const high = (max as NumberValue).value;
  if (!Number.isInteger(low) || !Number.isInteger(high)) throw refuse(phrase.randomIntegers(name));
  if (low > high) throw refuse(phrase.randomMinMax(String(low), String(high)));
  if (high - low > Number.MAX_SAFE_INTEGER) throw refuse(phrase.randomIntRange());
  return [low, high];
};

const defaultLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function localNow(env: Environment): DateFields {
  const fields = fieldsFromMilliseconds(env.now());
  if (fields === null) throw outOfRange(-1);
  return fields;
}

/** Os valores de `new Date(…)` (RN-VAR-007): sem argumento é o agora; com um número, os milissegundos; com um texto, uma das formas aceitas. */
export function newDate(args: readonly Value[], env: Environment): Value {
  if (args.length === 0) return dateValue(localNow(env), "instant");
  if (args.length > 1) throw refuse(phrase.dateMonthFrom1());

  const [arg] = args;
  if (arg.kind === "number") {
    const fields = fieldsFromMilliseconds(expectExact(arg));
    if (fields === null) throw outOfRange(-1);
    return dateValue(fields, "instant");
  }
  if (arg.kind !== "string") throw refuse(phrase.argType("new Date", "number ou string", 1, displayValue(arg, 60)));

  const parsed = parseDateText(arg.value);
  if (parsed === null) throw refuse(phrase.dateForm(arg.value));
  if ("invalid" in parsed) throw refuse(phrase.dateDoesNotExist(parsed.invalid.slice(0, 10)));
  return dateValue(parsed.fields, parsed.precision);
}

export const functions: ReadonlyMap<string, FunctionDef> = new Map<string, FunctionDef>([
  ["Math.abs", mathUnary(Math.abs)],
  ["Math.ceil", mathUnary(Math.ceil)],
  ["Math.floor", mathUnary(Math.floor)],
  ["Math.round", mathUnary(Math.round)],
  ["Math.trunc", mathUnary(Math.trunc)],
  ["Math.sign", mathUnary(Math.sign)],
  ["Math.sqrt", mathUnary(Math.sqrt)],
  ["Math.pow", { params: required("number", "number"), run: ([x, y]) => numberResult((x as NumberValue).value ** (y as NumberValue).value) }],
  [
    "Math.min",
    {
      params: [],
      rest: { param: { kind: "number" }, min: 1, max: limits.listItems },
      run: (args) => numberResult(Math.min(...args.map((arg) => (arg as NumberValue).value))),
    },
  ],
  [
    "Math.max",
    {
      params: [],
      rest: { param: { kind: "number" }, min: 1, max: limits.listItems },
      run: (args) => numberResult(Math.max(...args.map((arg) => (arg as NumberValue).value))),
    },
  ],
  ["Math.random", { params: [], ...noRandom, run: (_, { env }) => numberResult(env.random.float()) }],
  [
    "Number",
    {
      params: required("stringOrNumber"),
      run: ([x]) => {
        if (x.kind === "number") return x;
        const text = (x as StringValue).value.trim();
        if (!/^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) throw refuse(phrase.numberNotParsed((x as StringValue).value));
        const canonical = text.replace(/^\+/, "").replace(/^(-?)\./, "$10.").replace(/([eE])\+/, "$1");
        return numberValue(Number(canonical), canonical);
      },
    },
  ],
  ["Number.isInteger", { params: required("numberAny"), run: ([x]) => booleanValue((x as NumberValue).exact !== undefined ? isIntegerText((x as NumberValue).exact as string) : Number.isInteger((x as NumberValue).value)) }],
  ["String", { params: required("any"), run: ([x], { meter }) => (meter.weigh(x.kind === "list" ? x.items.length : 0), checkedText(textOf(x))) }],
  ["Date.now", { params: [], ...noRandom, run: (_, { env }) => numberResult(env.now()) }],

  ["date.today", { params: [], ...noRandom, run: (_, { env }) => dateValue({ ...localNow(env), hour: 0, minute: 0, second: 0, millisecond: 0 }, "day") }],
  [
    "date.of",
    {
      params: [...required("integer", "integer", "integer"), ...withOptional("integer", "integer", "integer", "integer")],
      run: (args) => {
        const [year, month, day, hour, minute, second, millisecond] = args.map((arg) => (arg as NumberValue).value);
        const fields = { year, month, day, hour: hour ?? 0, minute: minute ?? 0, second: second ?? 0, millisecond: millisecond ?? 0 };
        if (!existsAsDate(fields)) throw refuse(phrase.dateOfInvalid(calendarText(year, month, day)));
        return dateValue(fields, args.length > 3 ? "instant" : "day");
      },
    },
  ],
  ["date.addDays", { params: required("date", "any"), run: ([d, n]) => dateOrRange(addDaysTo(fieldsOf(d), integerArgument("date.addDays", n)), precisionOf(d)) }],
  ["date.addMonths", { params: required("date", "any"), run: ([d, n]) => dateOrRange(addMonthsTo(fieldsOf(d), integerArgument("date.addMonths", n)), precisionOf(d)) }],
  ["date.addYears", { params: required("date", "any"), run: ([d, n]) => dateOrRange(addMonthsTo(fieldsOf(d), integerArgument("date.addYears", n) * 12), precisionOf(d)) }],
  ["date.diffDays", { params: required("date", "date"), run: ([from, to]) => numberResult(diffDays(fieldsOf(from), fieldsOf(to))) }],
  ["date.startOfMonth", { params: required("date"), run: ([d]) => dateValue({ ...fieldsOf(d), day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 }, "day") }],
  [
    "date.endOfMonth",
    {
      params: required("date"),
      run: ([d]) => {
        const fields = fieldsOf(d);
        return dateValue({ ...fields, day: daysInMonth(fields.year, fields.month), hour: 0, minute: 0, second: 0, millisecond: 0 }, "day");
      },
    },
  ],
  ["date.format", { params: required("date"), run: ([d]) => stringValue(dateValueText(d as DateValue)) }],

  [
    "random.int",
    {
      params: required("number", "number"),
      ...noRandom,
      run: ([min, max], { env }) => {
        const [low, high] = randomIntBounds("random.int", min, max);
        return numberResult(env.random.int(low, high));
      },
    },
  ],
  [
    "random.decimal",
    {
      params: [...required("number", "number"), ...withOptional("integer")],
      ...noRandom,
      run: ([min, max, places], { env }) => {
        const low = (min as NumberValue).value;
        const high = (max as NumberValue).value;
        const digits = places === undefined ? 2 : (places as NumberValue).value;
        if (digits < 0 || digits > 10) throw refuse(phrase.randomDecimalPlaces());
        if (low > high) throw refuse(phrase.randomDecimalMinMax(String(low), String(high)));

        const scale = 10 ** digits;
        // Arredondados para dentro; o ruído do ponto flutuante (0.1 × 100) não deve empurrar o limite para fora.
        const inward = (value: number, round: (x: number) => number) => {
          const scaled = value * scale;
          const nearest = Math.round(scaled);
          return Math.abs(scaled - nearest) <= 1e-9 * Math.max(1, Math.abs(scaled)) ? nearest : round(scaled);
        };
        const first = inward(low, Math.ceil);
        const last = inward(high, Math.floor);
        if (first > last) throw refuse(phrase.randomDecimalMinMax(String(low), String(high)));
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > Number.MAX_SAFE_INTEGER) throw refuse(phrase.randomDecimalRange());
        return numberResult(env.random.int(first, last) / scale);
      },
    },
  ],
  ["random.bool", { params: [], ...noRandom, run: (_, { env }) => booleanValue(env.random.bool()) }],
  ["random.uuid", { params: [], ...noRandom, run: (_, { env }) => stringValue(env.random.uuid()) }],
  [
    "random.string",
    {
      params: [...required("integer"), ...withOptional("string")],
      ...noRandom,
      run: ([size, letters], { env, meter }) => {
        const length = (size as NumberValue).value;
        if (length < 0 || length > 10_000) throw refuse(phrase.randomStringLength());
        const alphabet = [...(letters === undefined ? defaultLetters : (letters as StringValue).value)];
        if (alphabet.length < 1 || alphabet.length > 256) throw refuse(phrase.randomStringLetters());
        meter.weigh(length);
        let result = "";
        for (let index = 0; index < length; index++) result += alphabet[env.random.int(0, alphabet.length - 1)];
        return stringValue(result);
      },
    },
  ],
  [
    "random.pick",
    {
      params: required("list"),
      ...noRandom,
      run: ([list], { env }) => {
        const items = (list as ListValue).items;
        if (items.length === 0) throw refuse(phrase.randomPickEmpty());
        return items[env.random.int(0, items.length - 1)];
      },
    },
  ],
  [
    "random.date",
    {
      params: required("date", "date"),
      ...noRandom,
      run: ([from, to], { env }) => {
        const start = fieldsOf(from);
        const end = fieldsOf(to);
        const day = precisionOf(from) === "day" && precisionOf(to) === "day";
        const startDay = dayNumber(start.year, start.month, start.day);
        const endDay = dayNumber(end.year, end.month, end.day);
        if (day) {
          if (startDay > endDay) throw refuse(phrase.randomDateOrder());
          const picked = addDaysTo({ ...start, hour: 0, minute: 0, second: 0, millisecond: 0 }, env.random.int(0, endDay - startDay));
          return dateOrRange(picked, "day");
        }
        // De instante: o `random.int` sobre os milissegundos do calendário entre as duas (sem o fuso).
        const msOfDay = (fields: DateFields) => ((fields.hour * 60 + fields.minute) * 60 + fields.second) * 1000 + fields.millisecond;
        const total = (endDay - startDay) * 86_400_000 + msOfDay(end) - msOfDay(start);
        if (total < 0) throw refuse(phrase.randomDateOrder());
        const offset = env.random.int(0, total);
        const absolute = msOfDay(start) + offset;
        const moved = addDaysTo({ ...start, hour: 0, minute: 0, second: 0, millisecond: 0 }, Math.floor(absolute / 86_400_000));
        if (moved === null) throw outOfRange(-1);
        const rest = absolute % 86_400_000;
        const fields = { ...moved, hour: Math.floor(rest / 3_600_000), minute: Math.floor(rest / 60_000) % 60, second: Math.floor(rest / 1000) % 60, millisecond: rest % 1000 };
        return dateValue(fields, "instant");
      },
    },
  ],
]);

/** Os nomes das funções que mudam com a hora ou com a sorte, como `Math.random`, `random.int` e `date.today` (RN-VAR-012). */
export const nondeterministicNames: ReadonlySet<string> = new Set([...functions].filter(([, def]) => def.nondeterministic === true).map(([name]) => name));

/** A função de uma chamada resolvida ao ler o texto: `Math.max`, `Number`, `random.int`… Nulo quando não existe (o leitor já recusou o nome). */
export function functionNamed(namespace: string | null, name: string): FunctionDef | undefined {
  return functions.get(namespace === null ? name : `${namespace}.${name}`);
}

/** Chama a função: confere os argumentos e roda. */
export function callFunction(def: FunctionDef, name: string, args: readonly Value[], context: CallContext): Value {
  checkArguments(def, name, args);
  return def.run(args, context);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Os métodos de cada espécie.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** O índice de um `at` e de um `slice`, como o JavaScript os lê: o número inteiro, e o negativo conta do fim. */
function relativeIndex(value: Value | undefined, length: number, fallback: number): number {
  if (value === undefined) return fallback;
  const raw = Math.trunc((value as NumberValue).value);
  return raw < 0 ? Math.max(0, length + raw) : Math.min(raw, length);
}

/** O tamanho do texto que um `toUpperCase` ou um `toLowerCase` daria, sem montar o texto quando ele cabe (o resultado pode ter mais unidades, RN-VAR-009). */
function convertedLength(text: string, convert: (character: string) => string, factor: number): number {
  if (text.length * factor <= textLimit) return text.length * factor;
  let length = 0;
  for (const character of text) {
    length += convert(character).length;
    if (length > textLimit) return length;
  }
  return length;
}

/** Quantas vezes `part` aparece em `text`, parando em `stop` (a conta de um `split` e de um `replaceAll` antes de montar). */
function occurrences(text: string, part: string, stop: number): number {
  let count = 0;
  for (let at = text.indexOf(part); at >= 0 && count <= stop; at = text.indexOf(part, at + part.length)) count++;
  return count;
}

const stringMethods: ReadonlyMap<string, MethodDef> = new Map<string, MethodDef>([
  [
    "toUpperCase",
    {
      params: [],
      run: ((text: StringValue, _: readonly Value[], { meter }: CallContext) => {
        meter.weigh(text.value.length);
        if (convertedLength(text.value, (c) => c.toUpperCase(), 3) > textLimit) throw refuse(phrase.textTooLong());
        return checkedText(text.value.toUpperCase());
      }) as MethodDef["run"],
    },
  ],
  [
    "toLowerCase",
    {
      params: [],
      run: ((text: StringValue, _: readonly Value[], { meter }: CallContext) => {
        meter.weigh(text.value.length);
        if (convertedLength(text.value, (c) => c.toLowerCase(), 2) > textLimit) throw refuse(phrase.textTooLong());
        return checkedText(text.value.toLowerCase());
      }) as MethodDef["run"],
    },
  ],
  ["trim", { params: [], run: ((text: StringValue) => checkedText(text.value.trim())) as MethodDef["run"] }],
  ["trimStart", { params: [], run: ((text: StringValue) => checkedText(text.value.trimStart())) as MethodDef["run"] }],
  ["trimEnd", { params: [], run: ((text: StringValue) => checkedText(text.value.trimEnd())) as MethodDef["run"] }],
  [
    "slice",
    {
      params: [...required("numberAny"), ...withOptional("numberAny")],
      run: ((text: StringValue, [from, to]: readonly Value[]) => {
        const length = text.value.length;
        return checkedText(text.value.slice(relativeIndex(from, length, 0), relativeIndex(to, length, length)));
      }) as MethodDef["run"],
    },
  ],
  ["includes", { params: required("string"), run: ((text: StringValue, [part]: readonly Value[], { meter }: CallContext) => (meter.weigh(text.value.length), booleanValue(text.value.includes((part as StringValue).value)))) as MethodDef["run"] }],
  ["startsWith", { params: required("string"), run: ((text: StringValue, [part]: readonly Value[]) => booleanValue(text.value.startsWith((part as StringValue).value))) as MethodDef["run"] }],
  ["endsWith", { params: required("string"), run: ((text: StringValue, [part]: readonly Value[]) => booleanValue(text.value.endsWith((part as StringValue).value))) as MethodDef["run"] }],
  ["indexOf", { params: required("string"), run: ((text: StringValue, [part]: readonly Value[], { meter }: CallContext) => (meter.weigh(text.value.length), numberResult(text.value.indexOf((part as StringValue).value)))) as MethodDef["run"] }],
  [
    "padStart",
    {
      params: [...required("integer"), ...withOptional("string")],
      run: ((text: StringValue, [size, pad]: readonly Value[], { meter }: CallContext) => {
        const length = (size as NumberValue).value;
        if (length > textLimit) throw refuse(phrase.textTooLong());
        meter.weigh(length);
        return checkedText(text.value.padStart(length, pad === undefined ? " " : (pad as StringValue).value));
      }) as MethodDef["run"],
    },
  ],
  [
    "padEnd",
    {
      params: [...required("integer"), ...withOptional("string")],
      run: ((text: StringValue, [size, pad]: readonly Value[], { meter }: CallContext) => {
        const length = (size as NumberValue).value;
        if (length > textLimit) throw refuse(phrase.textTooLong());
        meter.weigh(length);
        return checkedText(text.value.padEnd(length, pad === undefined ? " " : (pad as StringValue).value));
      }) as MethodDef["run"],
    },
  ],
  [
    "split",
    {
      params: required("string"),
      run: ((text: StringValue, [separator]: readonly Value[], { meter }: CallContext) => {
        const part = (separator as StringValue).value;
        meter.weigh(text.value.length);
        // Só texto, nunca expressão regular. O separador vazio separa por caractere (e não por unidade UTF-16, que partiria o par de um emoji).
        const pieces = part === "" ? [...text.value] : [];
        if (part !== "") {
          if (occurrences(text.value, part, limits.listItems) >= limits.listItems) throw refuse(phrase.splitTooMany());
          pieces.push(...text.value.split(part));
        }
        if (pieces.length > limits.listItems) throw refuse(phrase.splitTooMany());
        return listValue(pieces.map(stringValue));
      }) as MethodDef["run"],
    },
  ],
  [
    "replaceAll",
    {
      params: required("string", "string"),
      run: ((text: StringValue, [from, to]: readonly Value[], { meter }: CallContext) => {
        const search = (from as StringValue).value;
        const replacement = (to as StringValue).value;
        if (search === "") throw refuse(phrase.replaceAllEmpty());
        meter.weigh(text.value.length);
        const count = occurrences(text.value, search, textLimit);
        if (text.value.length + count * (replacement.length - search.length) > textLimit) throw refuse(phrase.textTooLong());
        // O `$&` e os outros padrões do `para` não valem: ele entra como está.
        return checkedText(text.value.split(search).join(replacement));
      }) as MethodDef["run"],
    },
  ],
  [
    "at",
    {
      params: required("numberAny"),
      run: ((text: StringValue, [index]: readonly Value[]) => {
        const at = Math.trunc((index as NumberValue).value);
        const found = text.value.at(at);
        return found === undefined ? nullValue : stringValue(found);
      }) as MethodDef["run"],
    },
  ],
]);

const listMethods: ReadonlyMap<string, MethodDef> = new Map<string, MethodDef>([
  [
    "at",
    {
      params: required("numberAny"),
      run: ((list: ListValue, [index]: readonly Value[]) => list.items.at(Math.trunc((index as NumberValue).value)) ?? nullValue) as MethodDef["run"],
    },
  ],
  [
    "includes",
    {
      params: required("any"),
      run: ((list: ListValue, [wanted]: readonly Value[], { meter }: CallContext) => {
        meter.weigh(list.items.length);
        return booleanValue(list.items.some((item) => comparable(item, wanted) && strictEquals(item, wanted)));
      }) as MethodDef["run"],
    },
  ],
  [
    "indexOf",
    {
      params: required("any"),
      run: ((list: ListValue, [wanted]: readonly Value[], { meter }: CallContext) => {
        meter.weigh(list.items.length);
        return numberResult(list.items.findIndex((item) => comparable(item, wanted) && strictEquals(item, wanted)));
      }) as MethodDef["run"],
    },
  ],
  [
    "join",
    {
      params: withOptional("string"),
      run: ((list: ListValue, [separator]: readonly Value[], { meter }: CallContext) => {
        const glue = separator === undefined ? "," : (separator as StringValue).value;
        meter.weigh(list.items.length);
        const parts: string[] = [];
        let length = glue.length * Math.max(0, list.items.length - 1);
        for (const item of list.items) {
          if (item.kind === "list" || item.kind === "object") throw refuse(phrase.objectToText());
          const part = item.kind === "null" ? "" : textOf(item);
          length += part.length;
          if (length > textLimit) throw refuse(phrase.textTooLong());
          parts.push(part);
        }
        return checkedText(parts.join(glue));
      }) as MethodDef["run"],
    },
  ],
  [
    "slice",
    {
      params: [...required("numberAny"), ...withOptional("numberAny")],
      run: ((list: ListValue, [from, to]: readonly Value[]) => {
        const length = list.items.length;
        return listValue(list.items.slice(relativeIndex(from, length, 0), relativeIndex(to, length, length)));
      }) as MethodDef["run"],
    },
  ],
  [
    "concat",
    {
      params: [],
      rest: { param: { kind: "list" }, min: 0, max: limits.listItems },
      run: ((list: ListValue, others: readonly Value[], { meter }: CallContext) => {
        let total = list.items.length;
        for (const other of others) total += (other as ListValue).items.length;
        if (total > limits.listItems) throw refuse(phrase.listTooLong());
        meter.weigh(total);
        return listValue(list.items.concat(...others.map((other) => (other as ListValue).items)));
      }) as MethodDef["run"],
    },
  ],
]);

/** Se o `===` pode comparar os dois itens sem erro (listas e objetos não se comparam, RN-VAR-008): o `includes` e o `indexOf` pulam o que não se compara. */
const comparable = (left: Value, right: Value): boolean => left.kind !== "list" && left.kind !== "object" && right.kind !== "list" && right.kind !== "object";

const numberMethods: ReadonlyMap<string, MethodDef> = new Map<string, MethodDef>([
  [
    "toFixed",
    {
      params: withOptional("integer"),
      run: ((value: NumberValue, [places]: readonly Value[]) => {
        const digits = places === undefined ? 0 : (places as NumberValue).value;
        if (digits < 0 || digits > 20) throw refuse(phrase.fixedDigits());
        return stringValue(expectExact(value).toFixed(digits));
      }) as MethodDef["run"],
    },
  ],
]);

/** O dia da semana do calendário local, de 0 (domingo) a 6, como o `getDay` do JavaScript. 0001-01-01 foi uma segunda-feira. */
const weekday = ({ year, month, day }: DateFields) => (dayNumber(year, month, day) + 1) % 7;

const dateMethods: ReadonlyMap<string, MethodDef> = new Map<string, MethodDef>(
  (
    [
      ["getFullYear", (f: DateFields) => f.year],
      ["getMonth", (f: DateFields) => f.month - 1],
      ["getDate", (f: DateFields) => f.day],
      ["getDay", weekday],
      ["getHours", (f: DateFields) => f.hour],
      ["getMinutes", (f: DateFields) => f.minute],
      ["getSeconds", (f: DateFields) => f.second],
      ["getMilliseconds", (f: DateFields) => f.millisecond],
      ["getTime", (f: DateFields) => localMilliseconds(f)],
    ] as const
  ).map(([name, read]): [string, MethodDef] => [name, { params: [], run: ((date: DateValue) => numberResult(read(date.fields))) as MethodDef["run"] }]),
);
(dateMethods as Map<string, MethodDef>).set("toISOString", {
  params: [],
  run: ((date: DateValue) => {
    const moment = new Date(localMilliseconds(date.fields));
    return stringValue(moment.toISOString());
  }) as MethodDef["run"],
});

/** A tabela de métodos de cada espécie de valor (RN-VAR-009). */
export function methodsOf(value: Value): ReadonlyMap<string, MethodDef> | undefined {
  switch (value.kind) {
    case "string":
      return stringMethods;
    case "list":
      return listMethods;
    case "number":
      return numberMethods;
    case "date":
      return dateMethods;
    default:
      return undefined;
  }
}

/** Chama o método `name` do valor: confere os argumentos e roda. Nulo quando a espécie não tem o método. */
export function callMethod(receiver: Value, name: string, args: readonly Value[], context: CallContext): Value | null {
  const def = methodsOf(receiver)?.get(name);
  if (def === undefined) return null;
  checkArguments(def, `${kindLabel(receiver) === "lista" ? "lista" : kindLabel(receiver)}.${name}`, args);
  return def.run(receiver as never, args, context);
}

/** Os nomes dos métodos de todas as espécies, para o autocompletar e os testes. */
export const methodNames: ReadonlyMap<string, readonly string[]> = new Map([
  ["string", [...stringMethods.keys()]],
  ["list", [...listMethods.keys()]],
  ["number", [...numberMethods.keys()]],
  ["date", [...dateMethods.keys()]],
]);
