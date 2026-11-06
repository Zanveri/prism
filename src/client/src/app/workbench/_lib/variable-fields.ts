import type { Engine } from "@/components/ui/engine-tag";

import { variableFieldsCopy as copy } from "./variable-fields.copy";
import { columnAnnotationType, type ColumnRead, type ColumnTypes } from "./variables/column-types";
import { parseDateText } from "./variables/dates";
import { locate, VariableError } from "./variables/errors";
import { canonicalNumberText } from "./variables/numbers";
import type { Node } from "./variables/ast";
import { Random } from "./variables/random";
import { annotationType, ScriptRun, type TabValues } from "./variables/run";
import { objectMembers, resolveAnnotation } from "./variables/named-types";
import type { RunValueEntry } from "./scripts.schema";
import { readScript, staticDiagnostics, type ModelItem, type ScriptModel } from "./variables/script";
import { booleanValue, dateValue, displayValue, listValue, nullValue, numberValue, objectValue, quoted, sqlValue, stringValue, typeLabel, withoutNull, type Type, type Value } from "./variables/values";
import type { TypeAnnotation } from "./variables/ast";

/*
 * Os campos da pergunta dos valores (RN-VAR-021) e do "Executar com valores…" (RN-VAR-027), na parte pura: um campo por declaração, pelo tipo dela, com a ajuda do
 * comentário, e a leitura do que a pessoa escreveu num valor da linguagem. Quem confere o valor contra a anotação e o guarda é o `ScriptRun` (`assign`, a origem
 * "pergunta"), no Worker.
 */

/**
 * O campo pelo tipo (RN-VAR-027): `date` é o `Date` sem precisão, em que a hora é opcional (sem ela, a data é de dia). `object` é o da interface, do `type` de objeto e
 * da lista deles (`Cliente`, `{ de: number }`, `Cliente[]`): um campo só, em que se escreve o valor como no script, `{ id: 7, nome: 'Ana' }` (RN-VAR-004).
 */
export type FieldKind = "number" | "string" | "boolean" | "day" | "instant" | "date" | "sql" | "object";

export type VariableField = {
  /** O índice da declaração no script; o campo de um membro tem o da declaração dele. */
  index: number;
  /** O campo na tela: o índice da declaração e, no membro, a posição dele em cada nível (`3.0.2`). Serve de id e de chave dos erros e da escolha. */
  key: string;
  /** O nome da variável; no membro, o caminho inteiro (`c.endereco.cidade`), que é como as frases o citam. */
  name: string;
  /** Os nomes dos membros da declaração até este (`["endereco", "cidade"]`); vazio no campo da declaração. */
  path: readonly string[];
  /** O membro opcional (`uf?: string`): vazio, ele não vai, e fica `null` (RN-VAR-038). */
  optional: boolean;
  /**
   * RN-VAR-041: os campos dos membros do objeto, na ordem do tipo, quando ele não é lista nem `| null` (`Cliente`, `{ de: number }`): o diálogo pergunta campo a
   * campo, e o membro que é objeto tem os dele. Nulo nos outros, e no objeto `| null` e na lista de objetos, que se escrevem como no script.
   */
  members: readonly VariableField[] | null;
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

/**
 * O que o campo tem: o texto (o número, o texto, a data `aaaa-mm-dd`), a hora (`hh:mm[:ss]`), os itens da lista, a caixa do booleano e a do `NULL`. No campo com
 * membros, `members` tem o de cada um, pelo nome; sem ele, o `text` é o objeto escrito como no script (o lembrado, o da vez anterior), e `expanded` o reparte.
 */
export type FieldInput = { text: string; time: string; items: string[]; checked: boolean; isNull: boolean; members?: ReadonlyMap<string, FieldInput> };

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
  /** RN-VAR-029: os valores da aba de execução ("Mudar os valores…"), no lugar dos lembrados no cofre. */
  prefill?: Readonly<Record<string, RunValueEntry>>;
  /** RN-VAR-027: o diálogo oferece "Executar numa aba nova" (aberto pela aba de execução, ou pelo navegador quando já há uma daquele script). */
  offerNewTab?: boolean;
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
    case "object":
      return "object";
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
    const declared = declaredOf(model, annotation, columns);
    if ("error" in declared) {
      errors.push({ ...locate(model.source, annotation.start), message: declared.error, offset: annotation.start });
      continue;
    }
    fields.push(fieldOf(model, item, parsed.name, annotation, declared, { kind: "none" }, false));
  }
  return { fields, errors };
}

/** O tipo de uma anotação: a de coluna pelo catálogo, e a do tipo com nome e do objeto escrito pelos tipos do script (RN-VAR-004). */
function declaredOf(model: ScriptModel, annotation: TypeAnnotation, columns: ColumnTypes | undefined): Type | { error: string } {
  if (annotation.base === "column") return columnAnnotationType(annotation, columns);
  if (annotation.base === "named" || annotation.base === "object") return resolveAnnotation(model, annotation, columns);
  return annotationType(annotation);
}

function fieldOf(model: ScriptModel, item: ModelItem, name: string, annotation: TypeAnnotation | null, declared: Type, fallback: FieldDefault, below: boolean): VariableField {
  const base = withoutNull(declared);
  const kind = kindOf(declared);
  // A lista de objetos e o objeto `| null` são um texto só: os itens se escrevem nele, entre [ ].
  const field: VariableField = {
    index: item.index,
    key: String(item.index),
    name,
    path: [],
    optional: false,
    members: null,
    typeText: annotation?.text ?? typeLabel(declared),
    declared,
    kind,
    list: base.tag === "list" && kind !== "object",
    nullable: declared.tag === "nullable",
    help: helpOf(model.source, item),
    column: annotation?.column?.text ?? null,
    fallback,
    below,
  };
  return { ...field, members: memberFields(model, field, annotation) };
}

/**
 * RN-VAR-041: os campos dos membros de um objeto que não é lista nem `| null`, na ordem do tipo resolvido (os herdados primeiro). O tipo como foi escrito e a coluna
 * (para a escolha pela chave, RN-VAR-030) vêm da anotação, quando há; o objeto sem anotação (o valor do script) tem só o tipo.
 */
function memberFields(model: ScriptModel, parent: VariableField, annotation: TypeAnnotation | null): VariableField[] | null {
  const declared = parent.declared;
  if (declared.tag !== "object") return null;
  const written = new Map((annotation === null || annotation.list || annotation.nullable ? null : objectMembers(model, annotation))?.map((member) => [member.name, member] as const) ?? []);
  return [...declared.fields].map(([name, type], position) => {
    const member = written.get(name);
    const optional = declared.optional?.has(name) ?? false;
    const kind = kindOf(type);
    const field: VariableField = {
      index: parent.index,
      key: `${parent.key}.${position}`,
      name: `${parent.name}.${name}`,
      path: [...parent.path, name],
      optional,
      members: null,
      typeText: member?.type.text ?? typeLabel(optional ? withoutNull(type) : type),
      declared: type,
      kind,
      list: withoutNull(type).tag === "list" && kind !== "object",
      nullable: type.tag === "nullable",
      help: null,
      column: member?.type.column?.text ?? null,
      fallback: { kind: "none" },
      below: parent.below,
    };
    return { ...field, members: memberFields(model, field, member?.type ?? null) };
  });
}

/** O campo e os dos membros dele, na ordem da tela. */
export const flatFields = (fields: readonly VariableField[]): VariableField[] => fields.flatMap((field) => [field, ...flatFields(field.members ?? [])]);

/** O valor de um membro dentro do valor da declaração (`c.endereco.cidade`); indefinido quando o caminho não chega lá. */
export function valueAt(value: Value | undefined, path: readonly string[]): Value | undefined {
  let current = value;
  for (const name of path) current = current?.kind === "object" ? current.fields.get(name) : undefined;
  return current;
}

/** O campo com membros repartido: cada membro com o valor dele no objeto (o escrito no `text`, o da vez anterior, o lembrado). Os outros campos ficam como estão. */
export function expanded(field: VariableField, input: FieldInput): FieldInput {
  if (field.members === null || input.members !== undefined) return input;
  const read = input.text.trim() === "" ? null : objectOf(field, input.text);
  return membersInput(field, read?.ok === true ? read.value : undefined);
}

function membersInput(field: VariableField, value: Value | undefined): FieldInput {
  const members = new Map((field.members ?? []).map((member) => {
    const inner = valueAt(value, [member.path[member.path.length - 1]]);
    return [member.path[member.path.length - 1], member.members === null ? inputOf(inner, member.kind) : membersInput(member, inner)] as const;
  }));
  return { ...emptyInput, members };
}

/** O campo com a mudança no membro do caminho `path` (o do campo mudado, a partir da declaração). */
export function changedInput(input: FieldInput, path: readonly string[], change: Partial<FieldInput>): FieldInput {
  if (path.length === 0) return { ...input, ...change };
  const [head, ...rest] = path;
  return { ...input, members: new Map(input.members ?? []).set(head, changedInput(input.members?.get(head) ?? emptyInput, rest, change)) };
}

/** O que o campo de um membro tem lá dentro (`emptyInput` quando nada). */
export function inputAt(input: FieldInput | undefined, path: readonly string[]): FieldInput {
  let current = input ?? emptyInput;
  for (const name of path) current = current.members?.get(name) ?? emptyInput;
  return current;
}

/** O membro opcional sem nada escrito não vai (RN-VAR-038: fica `null`); o booleano sempre tem valor. */
function isBlank(field: VariableField, input: FieldInput): boolean {
  if (input.isNull) return false;
  if (field.members !== null) return input.members === undefined ? input.text.trim() === "" : field.members.every((member) => isBlank(member, inputAt(input, [member.path[member.path.length - 1]])));
  return field.kind !== "boolean" && input.text.trim() === "" && input.time.trim() === "" && input.items.length === 0;
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
    case "object":
      return node.pairs.every((pair) => isLiteral(pair.value));
    case "newDate":
      return node.args.length === 1 && !node.args[0].spread && isLiteral(node.args[0].node);
    default:
      return false;
  }
}

/**
 * Se o primeiro item do texto, depois das `interface` e dos `type` (que não têm valor), é uma declaração (RN-VAR-026): só então há "Executar com valores…".
 */
export const declaresAtTop = (model: ScriptModel) => model.items.find((item) => item.kind !== "type")?.parsed?.kind === "declaration";

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
    const declared = annotation === null ? (dry.ok ? dry.stored.declared : null) : declaredOf(model, annotation, columns);
    if (declared === null || "error" in declared) {
      calculated.push(parsed.name);
      continue;
    }
    const fallback: FieldDefault = isLiteral(value) && dry.ok ? { kind: "literal", input: inputOf(dry.stored.value, kindOf(declared)) } : { kind: "expression", text: model.source.slice(value.start, value.end) };
    fields.push(fieldOf(model, item, parsed.name, annotation, declared, fallback, false));
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

const plainKey = /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u;

/**
 * O valor escrito como no script, para o campo de objeto (RN-VAR-004 e 027): `{ id: 7, nome: 'Ana', criado: new Date('2026-10-20') }`, inteiro, sem o corte de
 * `displayValue`. A volta é `objectOf`, que lê o texto com o leitor da linguagem.
 */
export function literalText(value: Value): string {
  switch (value.kind) {
    case "null":
      return "null";
    case "number":
      return value.exact ?? String(value.value);
    case "boolean":
      return value.value ? "true" : "false";
    case "string":
      return quoted(value.value);
    case "sql":
      return quoted(value.text);
    case "date": {
      const { text, time } = scalarInput(value);
      return `new Date(${quoted(value.precision === "day" ? text : `${text} ${time}`)})`;
    }
    case "list":
      return `[${value.items.map(literalText).join(", ")}]`;
    case "object":
      return value.fields.size === 0 ? "{}" : `{ ${[...value.fields].map(([key, field]) => `${plainKey.test(key) ? key : quoted(key)}: ${literalText(field)}`).join(", ")} }`;
  }
}

/** O campo preenchido com um valor (o da vez anterior nesta aba, RN-VAR-021); sem ele, vazio. */
export function inputOf(value: Value | undefined, kind?: FieldKind): FieldInput {
  if (value === undefined) return emptyInput;
  if (value.kind === "null") return { ...emptyInput, isNull: true };
  if (kind === "object" || value.kind === "object" || (value.kind === "list" && value.items.some((item) => item.kind === "object"))) return { ...emptyInput, text: literalText(value) };
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
export function valueOf(field: VariableField, input: FieldInput): { ok: true; value: Value } | { ok: false; message: string; at?: string } {
  if (field.nullable && input.isNull) return { ok: true, value: nullValue };
  if (field.members !== null && input.members !== undefined) return composedOf(field.members, input.members);
  if (field.kind === "object") return objectOf(field, input.text);
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
 * RN-VAR-041: o objeto dos campos dos membros, na ordem do tipo; o opcional vazio fica de fora (e a conferência da forma o põe `null`). A frase vai no membro que não
 * serve (`at`, a chave do campo dele), com o caminho inteiro: "Escreva um valor para c.endereco.cidade.".
 */
function composedOf(members: readonly VariableField[], inputs: ReadonlyMap<string, FieldInput>): { ok: true; value: Value } | { ok: false; message: string; at: string } {
  const entries: [string, Value][] = [];
  for (const member of members) {
    const name = member.path[member.path.length - 1];
    const input = inputs.get(name) ?? emptyInput;
    if (member.optional && isBlank(member, input)) continue;
    const read = valueOf(member, input);
    if (!read.ok) return { ok: false, message: read.message, at: read.at ?? member.key };
    entries.push([name, read.value]);
  }
  // O `extends` de duas interfaces grandes passa dos 100 campos de um objeto: a recusa da linguagem vira a frase do primeiro membro, e o diálogo não cai.
  try {
    return { ok: true, value: objectValue(entries) };
  } catch (error) {
    if (!(error instanceof VariableError)) throw error;
    return { ok: false, message: error.message, at: members[0].key };
  }
}

/**
 * O valor do campo de objeto (RN-VAR-004 e 027): o texto se lê como o valor de uma declaração, com o leitor da linguagem, e só vale o escrito, como no script: o
 * número, o texto, o booleano, o `null`, o `new Date('…')`, a lista e o objeto deles. A forma (o campo que falta, o campo a mais, o tipo de cada um) quem confere é o
 * `ScriptRun`, na pergunta, com a frase da linguagem: "c não tem o campo nome, que Cliente pede.".
 */
function objectOf(field: VariableField, text: string): { ok: true; value: Value } | { ok: false; message: string } {
  if (text.trim() === "") return { ok: false, message: copy.required(field.name) };
  const prefix = "let v = ";
  const model = readScript(`${prefix}${text}`);
  const item = model.items[0];
  const value = item?.parsed?.kind === "declaration" ? item.parsed.value : null;
  if (model.items.length !== 1 || item.error !== null || value === null) return { ok: false, message: item?.error?.message ?? copy.objectHint(typeLabel(field.declared)) };
  const problem = staticDiagnostics(model)[0];
  if (problem !== undefined) return { ok: false, message: problem.message };
  if (!isLiteral(value)) return { ok: false, message: copy.objectOnlyLiterals };
  const run = new ScriptRun(model, { random: new Random([1, 2, 3, 4]), clock: () => performance.now(), now: () => Date.now() }, new Map());
  const read = run.evaluate(0);
  return read.ok ? { ok: true, value: read.stored.value } : { ok: false, message: read.error.message };
}

/**
 * Os valores dos campos, pelo índice da declaração, ou a frase de cada campo que não serve (RN-VAR-027: a conferência antes de executar). Com `touched`, o campo com
 * valor padrão que a pessoa não mexeu não vai: o literal fica o do script, e a expressão se avalia na vez dela. A frase vai pela chave do campo (`key`), a do membro
 * no campo de objeto repartido.
 */
export function answersOf(fields: readonly VariableField[], inputs: ReadonlyMap<number, FieldInput>, touched?: ReadonlySet<number>): { answers: Map<number, Value>; problems: Map<string, string> } {
  const answers = new Map<number, Value>();
  const problems = new Map<string, string>();
  for (const field of fields) {
    if (touched !== undefined && field.fallback.kind !== "none" && !touched.has(field.index)) continue;
    const read = valueOf(field, inputs.get(field.index) ?? emptyInput);
    if (read.ok) answers.set(field.index, read.value);
    else problems.set(read.at ?? field.key, read.message);
  }
  return { answers, problems };
}

/** RN-VAR-028: o valor de um campo como entrada dos valores lembrados: o tipo e o texto, o `null` ou a lista. */
export function entryOf(value: Value): RunValueEntry {
  switch (value.kind) {
    case "null":
      return { type: "null", value: null };
    case "object":
      return { type: "object", value: literalText(value) };
    case "list":
      return value.items.some((item) => item.kind === "object") ? { type: "object", value: literalText(value) } : { type: "list", items: value.items.map(entryOf) };
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

/** O rótulo do campo: "cliente_id · number"; o do membro, dentro do grupo do objeto, só com o nome dele: "uf? · string". */
export const fieldLabel = (field: VariableField) => `${field.path.length === 0 ? field.name : `${field.path[field.path.length - 1]}${field.optional ? "?" : ""}`} · ${field.typeText}`;

/** O tipo mostrado, como o painel (RN-VAR-024). */
export const fieldType = (field: VariableField) => typeLabel(field.declared);
