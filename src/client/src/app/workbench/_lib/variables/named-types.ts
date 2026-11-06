import type { ColumnRef, Node, TypeAnnotation, TypeDeclaration, TypeMember } from "./ast";
import { columnAnnotationType, type ColumnTypes } from "./column-types";
import { VariableError } from "./errors";
import type { ScriptModel } from "./script";
import { booleanType, displayValue, fits, listValue, nullable, nullValue, numberType, objectValue, quoted, sqlType, stringType, typeLabel, typeOfValue, withoutNull, type Type, type Value } from "./values";
import { limits, phrase } from "./variables.copy";

/*
 * Os tipos com nome do script (RN-VAR-002 a 004): `interface Cliente { … }` e `type Filtro = { … }`, com a semântica do TypeScript. Não têm código, métodos nem
 * `new` (RN-VAR-014): são só a forma, conferida contra os valores, que continuam os registros congelados de `values.ts`. Um tipo pode ser usado antes de ser
 * declarado no texto, como no TypeScript, e por isso se resolve aqui, contra o script inteiro, e não quando o texto é lido. O tipo que se refere a si mesmo, direta
 * ou indiretamente (também por uma lista), é recusado: o valor é sempre uma árvore, e o diálogo que pergunta os campos não pode descer sem fim.
 */

/** Um tipo com nome: a primeira declaração dele no script. */
export type TypeInfo = { name: string; itemIndex: number; line: number; declaration: TypeDeclaration };

type Reference = { name: string; start: number };

/** Os nomes de tipo que um tipo escrito cita, na ordem do texto (os dos campos do objeto escrito também). */
function referencesOf(annotation: TypeAnnotation, found: Reference[] = []): Reference[] {
  if (annotation.named !== undefined) found.push(annotation.named);
  for (const member of annotation.members ?? []) referencesOf(member.type, found);
  return found;
}

/** Os nomes que uma declaração de tipo cita: os do `extends`, os dos campos e o do lado direito do `type`. */
function declarationReferences(declaration: TypeDeclaration): Reference[] {
  const found: Reference[] = [...declaration.extends];
  for (const member of declaration.members) referencesOf(member.type, found);
  if (declaration.type !== null) referencesOf(declaration.type, found);
  return found;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// A conferência que se faz lendo o texto (RN-VAR-012).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

export type TypeProblem = { itemIndex: number; message: string; offset: number };

/** Os erros dos tipos com nome e os itens deles que têm erro, uma vez por leitura do script. */
const analyses = new WeakMap<ScriptModel, { problems: TypeProblem[]; broken: ReadonlySet<number> }>();

function analysisOf(model: ScriptModel) {
  let analysis = analyses.get(model);
  if (analysis === undefined) {
    const problems = checkTypes(model);
    analysis = { problems, broken: new Set(problems.map((problem) => problem.itemIndex)) };
    analyses.set(model, analysis);
  }
  return analysis;
}

/**
 * Os erros de cada `interface` e `type` que se sabem lendo o texto (RN-VAR-012): o nome repetido, o tipo citado que não existe, o tipo que se refere a si mesmo
 * (ou que passa de 64 níveis de nomes, RN-VAR-013) e o `extends` que não vale. Cada erro é do item do tipo.
 */
export function typeDiagnostics(model: ScriptModel): readonly TypeProblem[] {
  return analysisOf(model).problems;
}

function checkTypes(model: ScriptModel): TypeProblem[] {
  const found: TypeProblem[] = [];
  for (const item of model.items) {
    const declaration = item.typeDeclaration;
    if (declaration === null) continue;
    const report = (message: string, offset: number) => found.push({ itemIndex: item.index, message, offset });

    const first = model.types.get(declaration.name);
    if (first !== undefined && first.itemIndex !== item.index) {
      report(phrase.typeAlreadyDeclared(declaration.name, first.line), declaration.nameStart);
      continue;
    }
    const unknown = declarationReferences(declaration).filter((reference) => !model.types.has(reference.name));
    for (const reference of unknown) report(phrase.unknownType(reference.name), reference.start);
    if (unknown.length > 0) continue;

    const loop = loopFrom(model, declaration.name);
    if (loop !== null) {
      report(loop.deep ? phrase.typeTooDeep(declaration.name) : phrase.typeCycle(loop.path), declaration.nameStart);
      continue;
    }
    checkExtends(model, declaration, report);
  }
  return found;
}

/**
 * O caminho pelo qual o tipo `root` volta a si mesmo (`Cliente → Endereco → Cliente`), ou `deep` quando os nomes descem mais de 64 níveis antes de achar o fim: o
 * limite da RN-VAR-013 vale para os tipos, e deixa raso o que a resolução e o diálogo percorrem. Sem recursão, para a cadeia longa não estourar a pilha.
 */
function loopFrom(model: ScriptModel, root: string): { path: string[]; deep: boolean } | null {
  const seen = new Set<string>();
  const stack: string[][] = [[root]];
  while (stack.length > 0) {
    const path = stack.pop() as string[];
    if (path.length > limits.depth) return { path, deep: true };
    const info = model.types.get(path[path.length - 1]);
    if (info === undefined) continue;
    for (const reference of declarationReferences(info.declaration)) {
      if (reference.name === root) return { path: [...path, root], deep: false };
      if (seen.has(reference.name)) continue;
      seen.add(reference.name);
      stack.push([...path, reference.name]);
    }
  }
  return null;
}

/**
 * Os campos do tipo com nome `name` quando ele é um objeto (a interface, com os herdados primeiro, e o `type` de um objeto escrito ou de outro tipo com nome), ou
 * nulo quando ele não é (`type Ids = number[]`, `type C = Cliente | null`) ou não se resolve.
 */
function membersOfName(model: ScriptModel, name: string, seen = new Set<string>()): Map<string, TypeMember> | null {
  if (seen.has(name)) return null;
  seen.add(name);
  const declaration = model.types.get(name)?.declaration;
  if (declaration === undefined) return null;
  if (declaration.kind === "alias") {
    const alias = declaration.type as TypeAnnotation;
    if (alias.list || alias.nullable) return null;
    if (alias.base === "object") return new Map((alias.members ?? []).map((member) => [member.name, member] as const));
    return alias.base === "named" && alias.named !== undefined ? membersOfName(model, alias.named.name, seen) : null;
  }
  const members = new Map<string, TypeMember>();
  for (const base of declaration.extends) for (const [key, member] of membersOfName(model, base.name, seen) ?? []) members.set(key, member);
  for (const member of declaration.members) members.set(member.name, member);
  return members;
}

/** Se os dois tipos escritos são o mesmo: a mesma base, o mesmo nome ou a mesma coluna, a lista e o `| null`, e no objeto escrito os mesmos campos. */
function sameType(a: TypeAnnotation, b: TypeAnnotation): boolean {
  if (a.base !== b.base || a.list !== b.list || a.nullable !== b.nullable) return false;
  if (a.base === "named") return a.named?.name === b.named?.name;
  if (a.base === "column") return a.column?.text === b.column?.text;
  if (a.base !== "object") return true;
  const left = a.members ?? [];
  const right = new Map((b.members ?? []).map((member) => [member.name, member] as const));
  return left.length === right.size && left.every((member) => {
    const other = right.get(member.name);
    return other !== undefined && other.optional === member.optional && sameType(member.type, other.type);
  });
}

/**
 * O `extends` (RN-VAR-002): cada base é uma interface ou um `type` de objeto; o campo que vem de duas bases tem o mesmo tipo nas duas; e o campo que a interface
 * declara de novo tem o tipo do herdado, podendo só tirar o `| null` ou o `?` (o que o TypeScript aceita e a linguagem tem: ela não tem tipos literais nem uniões).
 */
function checkExtends(model: ScriptModel, declaration: TypeDeclaration, report: (message: string, offset: number) => void): void {
  if (declaration.kind !== "interface" || declaration.extends.length === 0) return;
  const inherited = new Map<string, { member: TypeMember; from: string }>();
  for (const base of declaration.extends) {
    const members = membersOfName(model, base.name);
    if (members === null) {
      report(phrase.extendsNotObject(base.name, model.types.get(base.name)?.declaration.type?.text ?? base.name), base.start);
      continue;
    }
    for (const member of members.values()) {
      const other = inherited.get(member.name);
      if (other === undefined) inherited.set(member.name, { member, from: base.name });
      else if (other.member.optional !== member.optional || !sameType(other.member.type, member.type)) report(phrase.extendsConflict(declaration.name, base.name, member.name), base.start);
    }
  }
  for (const member of declaration.members) {
    const base = inherited.get(member.name);
    if (base === undefined) continue;
    const narrows = (!member.optional || base.member.optional) && sameType({ ...member.type, nullable: member.type.nullable || base.member.type.nullable }, base.member.type);
    if (!narrows) report(phrase.extendsConflict(declaration.name, base.from, member.name), member.nameStart);
  }
}

/** O primeiro tipo com erro que `name` usa, ele mesmo ou um que ele cita, direta ou indiretamente. */
function brokenFrom(model: ScriptModel, name: string): TypeInfo | null {
  const { broken } = analysisOf(model);
  const seen = new Set<string>();
  const stack = [name];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (seen.has(current)) continue;
    seen.add(current);
    const info = model.types.get(current);
    if (info === undefined) continue;
    if (broken.has(info.itemIndex)) return info;
    for (const reference of declarationReferences(info.declaration).reverse()) stack.push(reference.name);
  }
  return null;
}

/** O erro do tipo de uma anotação que se sabe lendo o texto (RN-VAR-012): o tipo citado que não existe, ou que tem erro. Nulo quando a anotação vale. */
export function annotationProblem(model: ScriptModel, annotation: TypeAnnotation): { message: string; offset: number } | null {
  for (const reference of referencesOf(annotation)) {
    if (!model.types.has(reference.name)) return { message: phrase.unknownType(reference.name), offset: reference.start };
    const broken = brokenFrom(model, reference.name);
    if (broken !== null) return { message: phrase.typeHasError(broken.name, broken.line), offset: reference.start };
  }
  return null;
}

/** As anotações que um tipo escrito alcança, ele mesmo e as dos tipos com nome que ele cita (direta ou indiretamente), uma vez cada tipo com nome. */
function reachable(model: ScriptModel, annotation: TypeAnnotation): TypeAnnotation[] {
  const found: TypeAnnotation[] = [];
  const seen = new Set<string>();
  const stack = [annotation];
  while (stack.length > 0) {
    const current = stack.pop() as TypeAnnotation;
    found.push(current);
    for (const member of current.members ?? []) stack.push(member.type);
    const name = current.named?.name;
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const declaration = model.types.get(name)?.declaration;
    if (declaration === undefined) continue;
    for (const member of declaration.members) stack.push(member.type);
    if (declaration.type !== null) stack.push(declaration.type);
    for (const base of declaration.extends) stack.push({ base: "named", named: base, column: null, list: false, nullable: false, text: base.name, start: base.start, end: base.start });
  }
  return found;
}

/** As colunas que um tipo escrito cita, também nos campos dos tipos com nome (`id: estoque.cliente.id`): o executor lê o tipo delas no catálogo (RN-VAR-004). */
export function annotationColumns(model: ScriptModel, annotation: TypeAnnotation): ColumnRef[] {
  return reachable(model, annotation).flatMap((found) => (found.column === null ? [] : [found.column]));
}

/** Se o tipo só se sabe pelo catálogo (ele, ou um campo dele, é o de uma coluna): a conferência em seco não o avalia (RN-VAR-012). */
export const needsCatalog = (model: ScriptModel, annotation: TypeAnnotation): boolean => annotationColumns(model, annotation).length > 0;

/**
 * Os campos do objeto que a anotação nomeia (`Filtro`, com os herdados primeiro) ou escreve (`{ cidade: string }`), na ordem, cada um com o tipo como foi escrito; nulo
 * quando ela não é de objeto. A lista e o `| null` DA PRÓPRIA anotação não contam (`Cliente[]` devolve os campos de `Cliente`): quem pergunta confere antes.
 */
export function objectMembers(model: ScriptModel, annotation: TypeAnnotation): readonly TypeMember[] | null {
  if (annotation.base === "object") return annotation.members ?? [];
  if (annotation.base !== "named" || annotation.named === undefined) return null;
  const members = membersOfName(model, annotation.named.name);
  return members === null ? null : [...members.values()];
}

/**
 * Os campos do objeto no fim do caminho (`c.endereco` → os de `Endereco`), pelo tipo escrito, para o realce e o autocompletar do editor (RN-VAR-025 e 040); nulo
 * quando o caminho sai do objeto: o campo que o tipo não tem, a lista, o tipo de coluna. O `| null` não para o caminho: quem diz que o valor é `null` é a execução.
 */
export function membersAt(model: ScriptModel, annotation: TypeAnnotation, path: readonly string[]): readonly TypeMember[] | null {
  let current = annotation;
  for (const name of path) {
    const member = current.list ? undefined : objectMembers(model, current)?.find((candidate) => candidate.name === name);
    if (member === undefined) return null;
    current = member.type;
  }
  return current.list ? null : objectMembers(model, current);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// O tipo (RN-VAR-004).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

const isPlainName = /^[\p{ID_Start}_$][\p{ID_Continue}$]*$/u;

/** O objeto escrito no tipo como a tela o mostra: `{ cidade: string; uf?: string }`, cortado em 60 caracteres. */
function literalLabel(fields: ReadonlyMap<string, Type>, optional: ReadonlySet<string>): string {
  const parts: string[] = [];
  let length = 4;
  for (const [key, type] of fields) {
    if (length > 60) {
      parts.push("…");
      break;
    }
    const part = `${isPlainName.test(key) ? key : quoted(key)}${optional.has(key) ? "?" : ""}: ${typeLabel(optional.has(key) ? withoutNull(type) : type)}`;
    parts.push(part);
    length += part.length + 2;
  }
  return parts.length === 0 ? "{}" : `{ ${parts.join("; ")} }`;
}

/** Monta os tipos das anotações de um script, com o tipo de cada coluna lido no catálogo (`columns`; sem ele, o tipo de coluna é a frase de que não foi lido). */
export class TypeResolver {
  private readonly model: ScriptModel;
  private readonly columns: ColumnTypes | undefined;
  private readonly built = new Map<string, Type>();

  constructor(model: ScriptModel, columns?: ColumnTypes) {
    this.model = model;
    this.columns = columns;
  }

  /** O tipo da anotação (RN-VAR-004). Lança a frase, na posição do que falhou. */
  annotation(annotation: TypeAnnotation): Type {
    const problem = annotationProblem(this.model, annotation);
    if (problem !== null) throw new VariableError(problem.message, problem.offset);
    return this.build(annotation);
  }

  private build(annotation: TypeAnnotation): Type {
    if (annotation.base === "column") {
      const type = columnAnnotationType(annotation, this.columns);
      if ("error" in type) throw new VariableError(type.error, annotation.start);
      return type;
    }
    let type: Type;
    if (annotation.base === "named") type = this.named((annotation.named as Reference).name);
    else if (annotation.base === "object") type = this.object(annotation.members ?? [], null);
    else type = annotation.base === "number" ? numberType : annotation.base === "boolean" ? booleanType : annotation.base === "sql" ? sqlType : annotation.base === "Date" ? { tag: "date" } : stringType;
    if (annotation.list) type = { tag: "list", item: type };
    return annotation.nullable ? nullable(type) : type;
  }

  /** O tipo com nome, uma vez por resolvedor. A conferência já recusou o que não se resolve, e os níveis são no máximo 64 (`loopFrom`). */
  private named(name: string): Type {
    const known = this.built.get(name);
    if (known !== undefined) return known;
    const declaration = (this.model.types.get(name) as TypeInfo).declaration;
    let type: Type;
    if (declaration.kind === "alias") {
      const alias = declaration.type as TypeAnnotation;
      // O `type` de um objeto escrito é aquele objeto com o nome do `type`; o de outro tipo é o outro tipo (`type Id = number` é `number`).
      if (alias.base === "object" && !alias.list) {
        const object = this.object(alias.members ?? [], name);
        type = alias.nullable ? nullable(object) : object;
      } else type = this.build(alias);
    } else {
      const fields = new Map<string, Type>();
      const optional = new Set<string>();
      for (const base of declaration.extends) {
        const inherited = this.named(base.name);
        if (inherited.tag !== "object") continue;
        for (const [key, field] of inherited.fields) fields.set(key, field);
        for (const key of inherited.optional ?? []) optional.add(key);
      }
      this.addMembers(declaration.members, fields, optional);
      type = { tag: "object", fields, name, ...(optional.size > 0 ? { optional } : {}) };
    }
    this.built.set(name, type);
    return type;
  }

  private addMembers(members: readonly TypeMember[], fields: Map<string, Type>, optional: Set<string>): void {
    for (const member of members) {
      const type = this.build(member.type);
      fields.set(member.name, member.optional ? nullable(type) : type);
      if (member.optional) optional.add(member.name);
      else optional.delete(member.name);
    }
  }

  private object(members: readonly TypeMember[], name: string | null): Type {
    const fields = new Map<string, Type>();
    const optional = new Set<string>();
    this.addMembers(members, fields, optional);
    return { tag: "object", fields, name: name ?? literalLabel(fields, optional), ...(optional.size > 0 ? { optional } : {}) };
  }
}

/**
 * O tipo de uma anotação, com os tipos com nome do script e o tipo de cada coluna lido no catálogo (RN-VAR-004), ou a frase quando ele não se resolve: o mesmo
 * formato de `columnAnnotationType`, para quem monta os campos do diálogo (RN-VAR-021 e 027). O objeto vem com `fields`, `optional` e `name` (`values.ts`).
 */
export function resolveAnnotation(model: ScriptModel, annotation: TypeAnnotation, columns?: ColumnTypes): Type | { error: string } {
  try {
    return new TypeResolver(model, columns).annotation(annotation);
  } catch (error) {
    if (error instanceof VariableError) return { error: error.message };
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// O valor na forma do tipo (RN-VAR-004 e 011).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------

/** Se o tipo tem um objeto anotado em algum lugar (ele, um item da lista, um campo): só então o valor precisa ser posto na forma (`conform`). */
export function hasShape(type: Type): boolean {
  switch (type.tag) {
    case "nullable":
      return hasShape(type.of);
    case "list":
      return hasShape(type.item);
    case "object":
      return type.name !== undefined;
    default:
      return false;
  }
}

/** De onde veio o valor que se põe na forma. `literal` é o valor escrito na declaração (o objeto e a lista escritos são conferidos campo a campo). */
export type ConformSource = { literal: Node | null; query: boolean; at: number };

/**
 * O valor na forma do tipo anotado, com a semântica do TypeScript (RN-VAR-004 e 011). Lança a frase, com a posição. O valor cabe quando tem cada campo obrigatório
 * com um valor que cabe no tipo dele (recursivo, nas listas também); o opcional pode faltar ou ser `null`, e o que falta fica `null`. O valor guardado tem os campos
 * do tipo, e só eles:
 * - o objeto escrito com um campo a mais é erro, como o "excess property check" do TypeScript ("O campo x não existe em Cliente.");
 * - a linha de uma consulta e o objeto de outra variável podem ter campos a mais, que ficam fora do valor (ler `c.extra` é o erro de campo de `Cliente`);
 * - a coluna de uma consulta casa com o campo pelo nome exato e, sem ele, pelo nome sem diferenciar maiúsculas quando só uma casa (o Db2 devolve `ID`, `NOME`): o
 *   campo fica com o nome do tipo; e a célula nula só cabe no campo `| null` ou opcional ("A coluna nome de alvo veio nula, e Cliente.nome é string.").
 */
export function conform(value: Value, type: Type, name: string, source: ConformSource): Value {
  return shape(value, type, name, source.literal, source.query, source.at, name);
}

const acceptsNull = (type: Type): boolean => type.tag === "nullable" || type.tag === "null";

function shape(value: Value, type: Type, path: string, node: Node | null, query: boolean, at: number, root: string): Value {
  const where = node?.start ?? at;
  if (type.tag === "nullable") return value.kind === "null" ? value : shape(value, type.of, path, node, query, at, root);

  if (type.tag === "list" && hasShape(type.item)) {
    if (value.kind !== "list") throw new VariableError(phrase.notFit(path, typeLabel(type), displayValue(value)), where);
    return listValue(value.items.map((item, index) => {
      const written = node?.t === "list" ? node.items[index] : undefined;
      return shape(item, type.item, `${path}[${index}]`, written === undefined || written.spread ? null : written.node, query, where, root);
    }));
  }

  if (type.tag === "object" && type.name !== undefined) {
    if (value.kind !== "object") throw new VariableError(phrase.notFit(path, typeLabel(type), displayValue(value)), where);
    const pairs = node?.t === "object" ? node.pairs : null;
    for (const pair of pairs ?? []) if (!type.fields.has(pair.key)) throw new VariableError(phrase.excessField(pair.key, typeLabel(type)), pair.keyStart);

    const entries: (readonly [string, Value])[] = [];
    const missing: string[] = [];
    for (const [field, fieldType] of type.fields) {
      let key = field;
      let found = value.fields.get(field);
      if (found === undefined && query) {
        const matches = [...value.fields.keys()].filter((candidate) => candidate.toLowerCase() === field.toLowerCase());
        if (matches.length === 1) {
          key = matches[0];
          found = value.fields.get(key);
        }
      }
      if (found === undefined) {
        if (type.optional?.has(field) === true) entries.push([field, nullValue]);
        else missing.push(field);
        continue;
      }
      if (query && found.kind === "null" && !acceptsNull(fieldType)) throw new VariableError(phrase.queryNullColumn(key, root, typeLabel(type), field, typeLabel(fieldType)), where);
      // O par escrito por último é o que vale, como no objeto do JavaScript.
      let written: Node | null = null;
      for (const pair of pairs ?? []) if (pair.key === field) written = pair.value;
      entries.push([field, shape(found, fieldType, `${path}.${field}`, written, false, where, root)]);
    }
    if (missing.length > 0) throw new VariableError(phrase.missingFields(path, missing, typeLabel(type)), where);
    return objectValue(entries);
  }

  if (!fits(typeOfValue(value), type)) throw new VariableError(phrase.notFit(path, typeLabel(type), displayValue(value)), where);
  return value;
}
