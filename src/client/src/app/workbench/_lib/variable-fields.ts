import type { Engine } from "@/components/ui/engine-tag";

import { variableFieldsCopy as copy } from "./variable-fields.copy";
import { columnAnnotationType, type ColumnRead, type ColumnTypes } from "./variables/column-types";
import { parseDateText } from "./variables/dates";
import { locate } from "./variables/errors";
import { canonicalNumberText } from "./variables/numbers";
import type { Node } from "./variables/ast";
import { Random } from "./variables/random";
import { annotationType, ScriptRun, type TabValues } from "./variables/run";
import type { RunValueEntry } from "./scripts.schema";
import type { ModelItem, ScriptModel } from "./variables/script";
import { booleanValue, dateValue, displayValue, listValue, nullValue, numberValue, sqlValue, stringValue, typeLabel, withoutNull, type Type, type Value } from "./variables/values";

/*
 * Os campos da pergunta dos valores (RN-VAR-021) e do "Executar com valores…" (RN-VAR-027), na parte pura: um campo por declaração, pelo tipo dela, com a ajuda do
 * comentário, e a leitura do que a pessoa escreveu num valor da linguagem. Quem confere o valor contra a anotação e o guarda é o `ScriptRun` (`assign`, a origem
 * "pergunta"), no Worker.
 */

/** O campo pelo tipo (RN-VAR-027): `date` é o `Date` sem precisão, em que a hora é opcional (sem ela, a data é de dia). */
export type FieldKind = "number" | "string" | "boolean" | "day" | "instant" | "date" | "sql";

export type VariableField = {
  /** O índice da declaração no script. */
  index: number;
  name: string;
  /** O tipo como a pessoa o escreveu (`number`, `pedido.cliente_id`, `Date[] | null`). */
  typeText: string;
  declared: Type;
  kind: FieldKind;
  list: boolean;
  nullable: boolean;
  /** O comentário de linha da declaração, até 200 caracteres. */
  help: string | null;
  /** A coluna do tipo de coluna, pelo texto dela (`pedido.cliente_id`): a escolha pela chave estrangeira vem dela (RN-VAR-030 e 031). */
  column: string | null;
  /** O valor padrão (RN-VAR-027): o literal do script, que vem preenchido; a expressão, que vem como dica e se avalia na vez dela; nenhum, na declaração sem valor. */
  fallback: FieldDefault;
  /** A declaração sem valor depois do primeiro comando ("Mais abaixo no script", RN-VAR-027). */
  below: boolean;
};

export type FieldDefault = { kind: "literal"; input: FieldInput } | { kind: "expression"; text: string } | { kind: "none" };

/** O que o campo tem: o texto (o número, o texto, a data `aaaa-mm-dd`), a hora (`hh:mm[:ss]`), os itens da lista, a caixa do booleano e a do `NULL`. */
export type FieldInput = { text: string; time: string; items: string[]; checked: boolean; isNull: boolean };

export const emptyInput: FieldInput = { text: "", time: "", items: [], checked: false, isNull: false };

/**
 * A pergunta como o executor a entrega à tela: a dos valores que faltam (RN-VAR-021, `ask`) ou o diálogo do "Executar com valores…" (RN-VAR-027, `full`), com os
 * campos, os nomes das variáveis calculadas durante o script (que não são campos), o texto lido (para a escolha pela chave, RN-VAR-030) e os valores da aba.
 */
export type ValuesQuestion = {
  mode: "ask" | "full";
  model: ScriptModel;
  engine: Engine | undefined;
  fields: VariableField[];
  calculated: string[];
  tab: TabValues;
  reads?: ReadonlyMap<string, ColumnRead>;
};

/** Um erro do script na pergunta: a linha e a frase (o tipo de coluna que não se resolveu, RN-VAR-004). */
export type FieldError = { line: number; column: number; message: string; offset: number };

const helpLimit = 200;
const lineComment = /^\s*(?:--|\/\/)\s?(.*)$/;

/** A ajuda do campo (RN-VAR-027): o comentário de linha na mesma linha da declaração, depois dela, ou o que está sozinho na linha logo acima. */
export function helpOf(source: string, item: ModelItem): string | null {
  const start = item.parsed?.start ?? item.start;
  const end = item.parsed?.end ?? item.start + item.text.length;
  const lineEnd = source.indexOf("\n", end);
  const after = lineComment.exec(source.slice(end, lineEnd < 0 ? undefined : lineEnd).replace(/\r$/, ""));
  const lineStart = source.lastIndexOf("\n", start - 1);
  const aboveStart = lineStart < 0 ? -1 : source.lastIndexOf("\n", lineStart - 1);
  const above = lineStart < 0 ? null : lineComment.exec(source.slice(aboveStart + 1, lineStart).replace(/\r$/, ""));
  const text = (after?.[1] ?? above?.[1] ?? "").trim();
  return text === "" ? null : text.slice(0, helpLimit);
}

function kindOf(type: Type): FieldKind {
  const base = withoutNull(type);
  const item = base.tag === "list" ? withoutNull(base.item) : base;
  switch (item.tag) {
    case "number":
    case "string":
    case "boolean":
    case "sql":
      return item.tag;
    case "date":
      return item.precision ?? "date";
    default:
      return "string";
  }
}

/** Os campos das declarações `indices`, na ordem do texto; os tipos de coluna que não se resolveram são erros do script. */
export function fieldsOf(model: ScriptModel, indices: readonly number[], columns: ColumnTypes | undefined): { fields: VariableField[]; errors: FieldError[] } {
  const fields: VariableField[] = [];
  const errors: FieldError[] = [];
  for (const index of [...indices].sort((a, b) => a - b)) {
    const item = model.items[index];
    const parsed = item.parsed;
    if (parsed?.kind !== "declaration" || parsed.annotation === null) continue;
    const annotation = parsed.annotation;
    const declared = annotation.base === "column" ? columnAnnotationType(annotation, columns) : annotationType(annotation);
    if ("error" in declared) {
      errors.push({ ...locate(model.source, annotation.start), message: declared.error, offset: annotation.start });
      continue;
    }
    fields.push(fieldOf(model, item, parsed.name, annotation.text, declared, annotation.column?.text ?? null, { kind: "none" }, false));
  }
  return { fields, errors };
}

function fieldOf(model: ScriptModel, item: ModelItem, name: string, typeText: string, declared: Type, column: string | null, fallback: FieldDefault, below: boolean): VariableField {
  const base = withoutNull(declared);
  return { index: item.index, name, typeText, declared, kind: kindOf(declared), list: base.tag === "list", nullable: declared.tag === "nullable", help: helpOf(model.source, item), column, fallback, below };
}

/** O literal do script (RN-VAR-027): o número, o texto, o booleano, o `null` e a lista deles; o que vem preenchido no campo. */
function isLiteral(node: Node): boolean {
  switch (node.t) {
    case "number":
    case "string":
    case "boolean":
    case "null":
      return true;
    case "unary":
      return node.op === "-" && node.operand.t === "number";
    case "template":
      return node.exprs.length === 0;
    case "list":
      return node.items.every((item) => !item.spread && isLiteral(item.node));
    default:
      return false;
  }
}

/** Se o primeiro item do texto é uma declaração (RN-VAR-026): só então há "Executar com valores…". */
export const declaresAtTop = (model: ScriptModel) => model.items[0]?.parsed?.kind === "declaration";

/**
 * RN-VAR-027: os campos do "Executar com valores…": um por declaração do topo do script (antes do primeiro comando), na ordem do texto, e depois os das declarações
 * sem valor mais abaixo. A consulta, o `random.of` e o que depende do banco (`dependent`) não são campos: são calculados durante o script. O tipo da declaração sem
 * anotação é o do valor dela, numa avaliação em seco aqui (o valor some; o que vale é o da execução); a que não se avalia sem os campos também é calculada.
 */
export function fullFieldsOf(model: ScriptModel, engine: Engine | undefined, columns: ColumnTypes | undefined, dependent: ReadonlySet<number>): { fields: VariableField[]; errors: FieldError[]; calculated: string[] } {
  const firstCommand = model.items.findIndex((item) => item.kind === "statement");
  const run = new ScriptRun(model, { engine, random: new Random([1, 2, 3, 4]), clock: () => performance.now(), now: () => Date.now(), ...(columns === undefined ? {} : { columns }) }, new Map());
  const fields: VariableField[] = [];
  const errors: FieldError[] = [];
  const calculated: string[] = [];
  for (const item of model.items) {
    const parsed = item.parsed;
    const below = firstCommand >= 0 && item.index > firstCommand;
    if (parsed?.kind !== "declaration") continue;
    if (parsed.value === null) {
      const asked = fieldsOf(model, [item.index], columns);
      fields.push(...asked.fields.map((field) => ({ ...field, below })));
      errors.push(...asked.errors);
      continue;
    }
    if (below) continue;
    const value = parsed.value;
    if (value.t === "query" || value.t === "sample" || dependent.has(item.index)) {
      calculated.push(parsed.name);
      continue;
    }
    // ponytail: a avaliação em seco roda aqui, fora do Worker, com o medidor de sempre (os passos e os 250 ms), como a conferência de antes de executar.
    const dry = run.evaluate(item.index);
    const annotation = parsed.annotation;
    const declared = annotation === null ? (dry.ok ? dry.stored.declared : null) : annotation.base === "column" ? columnAnnotationType(annotation, columns) : annotationType(annotation);
    if (declared === null || "error" in declared) {
      calculated.push(parsed.name);
      continue;
    }
    const fallback: FieldDefault = isLiteral(value) && dry.ok ? { kind: "literal", input: inputOf(dry.stored.value) } : { kind: "expression", text: model.source.slice(value.start, value.end) };
    fields.push(fieldOf(model, item, parsed.name, annotation?.text ?? typeLabel(declared), declared, annotation?.column?.text ?? null, fallback, false));
  }
  return { fields, errors, calculated };
}

/** O texto de um valor no campo: o número e o texto como estão, a data `aaaa-mm-dd` e a hora `hh:mm:ss`. */
function scalarInput(value: Value): Pick<FieldInput, "text" | "time" | "checked"> {
  switch (value.kind) {
    case "number":
      return { text: value.exact ?? String(value.value), time: "", checked: false };
    case "string":
      return { text: value.value, time: "", checked: false };
    case "sql":
      return { text: value.text, time: "", checked: false };
    case "boolean":
      return { text: "", time: "", checked: value.value };
    case "date": {
      const f = value.fields;
      const two = (n: number) => String(n).padStart(2, "0");
      return { text: `${String(f.year).padStart(4, "0")}-${two(f.month)}-${two(f.day)}`, time: value.precision === "instant" ? `${two(f.hour)}:${two(f.minute)}:${two(f.second)}` : "", checked: false };
    }
    default:
      return { text: "", time: "", checked: false };
  }
}

/** O campo preenchido com um valor (o da vez anterior nesta aba, RN-VAR-021); sem ele, vazio. */
export function inputOf(value: Value | undefined): FieldInput {
  if (value === undefined) return emptyInput;
  if (value.kind === "null") return { ...emptyInput, isNull: true };
  if (value.kind === "list") return { ...emptyInput, items: value.items.map((item) => scalarInput(item).text) };
  return { ...emptyInput, ...scalarInput(value) };
}

const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** O número escrito, com o texto exato como o do script (RN-VAR-005). */
function numberOf(text: string): Value {
  const canonical = canonicalNumberText(text);
  const value = Number(canonical);
  return numberValue(value, canonical === String(value) ? undefined : canonical);
}

/** Um valor simples do campo, pelo tipo; a frase quando o texto não serve. `required` é o nome da variável, para o campo vazio. */
function scalarOf(field: VariableField, text: string, time: string, checked: boolean, required: string | null): { ok: true; value: Value } | { ok: false; message: string } {
  if (field.kind === "boolean") return { ok: true, value: booleanValue(checked) };
  const trimmed = text.trim();
  if (trimmed === "") {
    if (field.kind === "day" || field.kind === "instant" || field.kind === "date") return { ok: false, message: copy.chooseDate };
    return { ok: false, message: required === null ? copy.emptyItem : copy.required(required) };
  }
  switch (field.kind) {
    case "number":
      return numberPattern.test(trimmed) && Number.isFinite(Number(trimmed)) ? { ok: true, value: numberOf(trimmed) } : { ok: false, message: copy.notNumber };
    case "string":
      return { ok: true, value: stringValue(text) };
    case "sql":
      return { ok: true, value: sqlValue(text) };
    default: {
      const withTime = field.kind === "instant" || (field.kind === "date" && time.trim() !== "");
      if (field.kind === "instant" && time.trim() === "") return { ok: false, message: copy.chooseTime };
      const parsed = parseDateText(withTime ? `${trimmed} ${time.trim().length === 5 ? `${time.trim()}:00` : time.trim()}` : trimmed);
      if (parsed === null || "invalid" in parsed) return { ok: false, message: copy.chooseDate };
      return { ok: true, value: dateValue(parsed.fields, parsed.precision) };
    }
  }
}

/**
 * O valor do campo (RN-VAR-027): o `NULL` marcado, a lista (cada item pelo tipo dela) ou o valor simples. A frase vai no campo: "Escreva um valor para cliente_id.",
 * "Escreva um número, como 42 ou 3.5.", "Escolha uma data.". O tipo errado que passa daqui (o `| null` dos itens) a avaliação recusa, com a frase da linguagem.
 */
export function valueOf(field: VariableField, input: FieldInput): { ok: true; value: Value } | { ok: false; message: string } {
  if (field.nullable && input.isNull) return { ok: true, value: nullValue };
  if (!field.list) return scalarOf(field, input.text, input.time, input.checked, field.name);
  const items: Value[] = [];
  for (const item of input.items) {
    const read = scalarOf(field, item, "", false, null);
    if (!read.ok) return { ok: false, message: copy.badItem(displayValue(stringValue(item)), read.message) };
    items.push(read.value);
  }
  return { ok: true, value: listValue(items) };
}

/**
 * Os valores dos campos, pelo índice da declaração, ou a frase de cada campo que não serve (RN-VAR-027: a conferência antes de executar). Com `touched`, o campo com
 * valor padrão que a pessoa não mexeu não vai: o literal fica o do script, e a expressão se avalia na vez dela.
 */
export function answersOf(fields: readonly VariableField[], inputs: ReadonlyMap<number, FieldInput>, touched?: ReadonlySet<number>): { answers: Map<number, Value>; problems: Map<number, string> } {
  const answers = new Map<number, Value>();
  const problems = new Map<number, string>();
  for (const field of fields) {
    if (touched !== undefined && field.fallback.kind !== "none" && !touched.has(field.index)) continue;
    const read = valueOf(field, inputs.get(field.index) ?? emptyInput);
    if (read.ok) answers.set(field.index, read.value);
    else problems.set(field.index, read.message);
  }
  return { answers, problems };
}

/** RN-VAR-028: o valor de um campo como entrada dos valores lembrados: o tipo e o texto, o `null` ou a lista. */
export function entryOf(value: Value): RunValueEntry {
  switch (value.kind) {
    case "null":
      return { type: "null", value: null };
    case "list":
      return { type: "list", items: value.items.map(entryOf) };
    case "number":
      return { type: "number", value: value.exact ?? String(value.value) };
    case "boolean":
      return { type: "boolean", value: value.value ? "true" : "false" };
    case "sql":
      return { type: "sql", value: value.text };
    case "date": {
      const { text, time } = scalarInput(value);
      return value.precision === "day" ? { type: "date", value: text } : { type: "timestamp", value: `${text} ${time}` };
    }
    default:
      return { type: "text", value: value.kind === "string" ? value.value : "" };
  }
}

const isEntry = (data: unknown): data is { type: string; value?: unknown; items?: unknown } => typeof data === "object" && data !== null && typeof (data as { type?: unknown }).type === "string";

/** O campo preenchido com uma entrada lembrada (RN-VAR-028); nulo quando a entrada não tem a forma de uma. Quem confere se ela ainda serve é o `valueOf`. */
export function inputOfEntry(entry: unknown): FieldInput | null {
  if (!isEntry(entry)) return null;
  if (entry.type === "null") return { ...emptyInput, isNull: true };
  if (entry.type === "list") return Array.isArray(entry.items) && entry.items.every((item) => isEntry(item) && typeof item.value === "string") ? { ...emptyInput, items: entry.items.map((item: { value: string }) => item.value) } : null;
  if (typeof entry.value !== "string") return null;
  if (entry.type === "boolean") return { ...emptyInput, checked: entry.value === "true" };
  if (entry.type === "timestamp") return { ...emptyInput, text: entry.value.slice(0, 10), time: entry.value.slice(11) };
  return { ...emptyInput, text: entry.value };
}

/** O limite dos valores lembrados de um script (RN-VAR-028): os bytes de UTF-8 do JSON de `values`, como a API mede. */
export const rememberedLimit = 64 * 1024;

/** Os valores a lembrar, na ordem dos campos, e os nomes dos que não couberam no limite (RN-VAR-028). */
export function rememberedOf(fields: readonly VariableField[], answers: ReadonlyMap<number, Value>): { values: Record<string, RunValueEntry>; tooLarge: string[] } {
  const values: Record<string, RunValueEntry> = {};
  const tooLarge: string[] = [];
  for (const field of fields) {
    const value = answers.get(field.index);
    if (value === undefined) continue;
    const next = { ...values, [field.name]: entryOf(value) };
    if (new TextEncoder().encode(JSON.stringify(next)).length > rememberedLimit) tooLarge.push(field.name);
    else values[field.name] = next[field.name];
  }
  return { values, tooLarge };
}

/**
 * O que colar num campo de itens dá (RN-VAR-027): uma linha por item, por `\r\n`, `\n` ou `\r`; a linha vazia do fim sai; as vazias do meio saem nas listas de
 * número e de data, e são um item vazio nas de texto. O item de texto não é aparado.
 */
export function pastedItems(field: Pick<VariableField, "kind">, text: string): string[] {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return field.kind === "string" || field.kind === "sql" ? lines : lines.filter((line) => line.trim() !== "");
}

/** O rótulo do campo: "cliente_id · number". */
export const fieldLabel = (field: VariableField) => `${field.name} · ${field.typeText}`;

/** O tipo mostrado, como o painel (RN-VAR-024). */
export const fieldType = (field: VariableField) => typeLabel(field.declared);
