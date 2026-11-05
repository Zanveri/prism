import type { Engine } from "@/components/ui/engine-tag";

import { variableFieldsCopy as copy } from "./variable-fields.copy";
import { columnAnnotationType, type ColumnRead, type ColumnTypes } from "./variables/column-types";
import { parseDateText } from "./variables/dates";
import { locate } from "./variables/errors";
import { canonicalNumberText } from "./variables/numbers";
import { annotationType, type TabValues } from "./variables/run";
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
};

/** O que o campo tem: o texto (o número, o texto, a data `aaaa-mm-dd`), a hora (`hh:mm[:ss]`), os itens da lista, a caixa do booleano e a do `NULL`. */
export type FieldInput = { text: string; time: string; items: string[]; checked: boolean; isNull: boolean };

export const emptyInput: FieldInput = { text: "", time: "", items: [], checked: false, isNull: false };

/** RN-VAR-021: a pergunta dos valores que faltam, como o executor a entrega à tela: os campos, o texto lido (para a escolha pela chave, RN-VAR-030) e os valores da aba. */
export type ValuesQuestion = { model: ScriptModel; engine: Engine | undefined; fields: VariableField[]; tab: TabValues; reads?: ReadonlyMap<string, ColumnRead> };

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
    const base = withoutNull(declared);
    fields.push({
      index,
      name: parsed.name,
      typeText: annotation.text,
      declared,
      kind: kindOf(declared),
      list: base.tag === "list",
      nullable: declared.tag === "nullable",
      help: helpOf(model.source, item),
      column: annotation.column?.text ?? null,
    });
  }
  return { fields, errors };
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

/** Os valores de todos os campos, pelo índice da declaração, ou a frase de cada campo que não serve (RN-VAR-027: a conferência antes de executar). */
export function answersOf(fields: readonly VariableField[], inputs: ReadonlyMap<number, FieldInput>): { answers: Map<number, Value>; problems: Map<number, string> } {
  const answers = new Map<number, Value>();
  const problems = new Map<number, string>();
  for (const field of fields) {
    const read = valueOf(field, inputs.get(field.index) ?? emptyInput);
    if (read.ok) answers.set(field.index, read.value);
    else problems.set(field.index, read.message);
  }
  return { answers, problems };
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
