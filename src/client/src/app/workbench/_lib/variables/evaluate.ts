import { childrenOf, type Node, type Spreadable } from "./ast";
import { VariableError } from "./errors";
import { callFunction, callMethod, functionNamed, newDate, type CallContext } from "./functions";
import type { Environment, Meter } from "./meter";
import { binary, power, signedLiteral, unaryArithmetic } from "./operators";
import {
  booleanValue,
  displayValue,
  isFalsy,
  listValue,
  noOffset,
  nullValue,
  numberValue,
  objectValue,
  refuse,
  stringValue,
  textOf,
  typeLabel,
  typeOfValue,
  unify,
  forbiddenMembers,
  nullType,
  type Type,
  type Value,
} from "./values";
import { limits, phrase } from "./variables.copy";

/*
 * O avaliador (RN-VAR-012 e 014): anda pela árvore que o leitor montou, uma espécie de nó por vez, com os valores da linguagem. Puro e síncrono: tudo o que muda com
 * a hora ou com a sorte entra por `Environment`, e os limites por `Meter`. O membro se lê por uma regra positiva (o campo de um objeto, pelo `Map` dele; o `length`
 * do texto e da lista; os métodos da tabela), e nada do texto vira nome de propriedade do JavaScript.
 */

/** O curto-circuito do `?.`: o resto da cadeia não se avalia e o resultado é `null`. */
const short = Symbol("short");
type Evaluated = Value | typeof short;

/** Os valores das variáveis no ponto da avaliação, pelo nome já normalizado. */
export type Scope = ReadonlyMap<string, Value>;

/** Se uma expressão muda com a hora ou com a sorte, ou depende de uma variável que não se sabe: a conferência antes de executar não a avalia (RN-VAR-012). */
export function isDeterministic(node: Node, known: (name: string) => boolean): boolean {
  if (node.t === "name") return known(node.name);
  if (node.t === "newDate" && node.args.length === 0) return false;
  if (node.t === "call" && (node.fn.namespace === "random" || (node.fn.namespace === "Math" && node.fn.name === "random") || (node.fn.namespace === "date" && node.fn.name === "today") || (node.fn.namespace === "Date" && node.fn.name === "now"))) return false;
  if (node.t === "query" || node.t === "sample") return false;
  return childrenOf(node).every((child) => isDeterministic(child, known));
}

/** Os nomes de variáveis que a expressão usa, na ordem do texto. */
export function namesUsed(node: Node, found: Set<string> = new Set()): Set<string> {
  if (node.t === "name") found.add(node.name);
  for (const child of childrenOf(node)) namesUsed(child, found);
  return found;
}

export class Evaluator {
  private readonly env: Environment;
  private readonly meter: Meter;
  private readonly scope: Scope;
  private readonly source: string;
  /** Avaliando o lado que não vai, só para saber o tipo dele (`probe`): lá dentro não se mede de novo. */
  private probing = false;

  constructor(env: Environment, meter: Meter, scope: Scope, source: string) {
    this.env = env;
    this.meter = meter;
    this.scope = scope;
    this.source = source;
  }

  /** O valor da expressão. Lança `VariableError` com a posição do nó que falhou. */
  evaluate(node: Node): Value {
    const value = this.visit(node);
    return value === short ? nullValue : value;
  }

  private visit(node: Node): Evaluated {
    try {
      this.meter.tick();
      return this.dispatch(node);
    } catch (error) {
      if (error instanceof VariableError && error.offset === noOffset) throw new VariableError(error.message, node.start);
      throw error;
    }
  }

  private value(node: Node): Value {
    const value = this.visit(node);
    return value === short ? nullValue : value;
  }

  /** O texto do nó como a pessoa o escreveu, curto, para as frases (`ids[5]`). */
  private label(node: Node): string {
    const text = this.source.slice(node.start, node.end).replace(/\s+/g, " ");
    return text.length > 40 ? `${text.slice(0, 39)}…` : text;
  }

  private dispatch(node: Node): Evaluated {
    switch (node.t) {
      case "number": {
        if (!Number.isFinite(node.value)) throw refuse(phrase.badNumber(node.text));
        return numberValue(node.value, node.text === String(node.value) ? undefined : node.text);
      }
      case "string":
        return stringValue(node.value);
      case "boolean":
        return booleanValue(node.value);
      case "null":
        return nullValue;
      case "template":
        return this.template(node);
      case "name":
        return this.name(node);
      case "list":
        return this.list(node.items);
      case "object":
        return this.object(node);
      case "newDate":
        return newDate(this.arguments(node.args), this.env);
      case "unary":
        return this.unary(node);
      case "chain":
        return this.chain(node);
      case "power":
        return power(this.value(node.base), this.value(node.exponent));
      case "conditional":
        return this.conditional(node);
      case "member":
        return this.member(node);
      case "index":
        return this.index(node);
      case "call":
        return this.call(node);
      case "method":
        return this.method(node);
      case "constant":
        return numberValue(node.name === "PI" ? Math.PI : Math.E);
      case "query":
        throw refuse(phrase.provisionalQuery());
      case "sample":
        throw refuse(phrase.provisionalSample());
    }
  }

  private name(node: Extract<Node, { t: "name" }>): Value {
    const value = this.scope.get(node.name);
    if (value === undefined) throw refuse(phrase.notDeclared(node.name));
    if (value.kind === "sql") throw refuse(phrase.sqlVariableInExpression(node.name));
    return value;
  }

  private template(node: Extract<Node, { t: "template" }>): Value {
    let text = node.quasis[0];
    node.exprs.forEach((expression, index) => {
      const value = this.value(expression);
      if (value.kind === "null") throw new VariableError(phrase.nullInText(), expression.start);
      const part = textOf(value);
      const next = node.quasis[index + 1];
      if (text.length + part.length + next.length > limits.textLength) throw new VariableError(phrase.textTooLong(), expression.start);
      text += part + next;
    });
    return stringValue(text);
  }

  private arguments(args: readonly Spreadable[]): Value[] {
    const values: Value[] = [];
    for (const arg of args) {
      const value = this.value(arg.node);
      if (!arg.spread) values.push(value);
      else {
        if (value.kind !== "list") throw new VariableError(phrase.spreadNotList(displayValue(value, 40)), arg.node.start);
        this.meter.weigh(value.items.length);
        if (values.length + value.items.length > limits.listItems) throw new VariableError(phrase.listTooLong(), arg.node.start);
        values.push(...value.items);
      }
    }
    return values;
  }

  /** A lista: os itens têm o mesmo tipo (ou o `null`), e a lista de lista não existe (RN-VAR-004). */
  private list(items: readonly Spreadable[]): Value {
    const values = this.arguments(items);
    return listValue(values);
  }

  private object(node: Extract<Node, { t: "object" }>): Value {
    const fields = new Map<string, Value>();
    for (const pair of node.pairs) fields.set(pair.key, this.value(pair.value));
    return objectValue([...fields]);
  }

  private unary(node: Extract<Node, { t: "unary" }>): Value {
    if (node.op === "!") return booleanValue(isFalsy(this.value(node.operand)));
    // O `-` ou o `+` direto num literal mantém o texto exato.
    if (node.operand.t === "number") {
      const literal = this.value(node.operand);
      return literal.kind === "number" ? signedLiteral(node.op, literal) : literal;
    }
    return unaryArithmetic(node.op, this.value(node.operand));
  }

  private chain(node: Extract<Node, { t: "chain" }>): Value {
    let value = this.value(node.first);

    for (const part of node.rest) {
      switch (part.op) {
        case "&&":
        case "||": {
          // Os dois lados têm de ter o mesmo tipo, ou um deles `null`, também o que não vai (RN-VAR-008).
          const stops = part.op === "&&" ? isFalsy(value) : !isFalsy(value);
          const left = typeOfValue(value);
          const rightType = stops ? this.probe(part.operand) : null;
          if (rightType !== null && unify(left, rightType) === null) throw new VariableError(phrase.logicalTypes(typeLabel(left), typeLabel(rightType)), part.start);
          if (stops) return value;
          value = this.value(part.operand);
          if (unify(left, typeOfValue(value)) === null) throw new VariableError(phrase.logicalTypes(typeLabel(left), typeLabel(typeOfValue(value))), part.start);
          break;
        }
        case "??":
          if (value.kind !== "null") return value;
          value = this.value(part.operand);
          break;
        default: {
          const right = this.value(part.operand);
          try {
            value = binary(part.op, value, right, this.meter);
          } catch (error) {
            if (error instanceof VariableError && error.offset === noOffset) throw new VariableError(error.message, part.start);
            throw error;
          }
        }
      }
    }
    return value;
  }

  /**
   * O tipo do lado que não vai, quando ele se sabe sem efeito nenhum: sem `random`, sem a hora e só com variáveis que têm valor (RN-VAR-008). Avalia-o à parte, e
   * qualquer erro dele é dele: o lado que não vai não falha o que vai.
   */
  private probe(node: Node): Type | null {
    if (this.probing || !isDeterministic(node, (name) => this.scope.has(name))) return null;
    this.probing = true;
    try {
      const value = this.visit(node);
      return value === short ? null : typeOfValue(value);
    } catch (error) {
      if (error instanceof VariableError) return null;
      throw error;
    } finally {
      this.probing = false;
    }
  }

  /** `? :`: as duas saídas têm de ter o mesmo tipo, ou uma delas `null` (RN-VAR-008). */
  private conditional(node: Extract<Node, { t: "conditional" }>): Evaluated {
    const takeThen = !isFalsy(this.value(node.test));
    const result = this.visit(takeThen ? node.then : node.otherwise);
    const other = this.probe(takeThen ? node.otherwise : node.then);
    if (other !== null) {
      const taken = result === short ? nullType : typeOfValue(result);
      if (unify(taken, other) === null) {
        const [thenType, elseType] = takeThen ? [taken, other] : [other, taken];
        throw refuse(phrase.ternaryTypes(typeLabel(thenType), typeLabel(elseType)));
      }
    }
    return result;
  }

  private member(node: Extract<Node, { t: "member" }>): Evaluated {
    const object = this.visit(node.object);
    if (object === short) return short;

    if (object.kind === "null") {
      if (node.optional) return short;
      throw new VariableError(phrase.readFieldOfNull(node.name), node.nameStart);
    }
    if (object.kind === "object") {
      const field = object.fields.get(node.name);
      if (field === undefined) throw new VariableError(phrase.objectNoField(this.label(node.object), node.name, [...object.fields.keys()]), node.nameStart);
      return field;
    }
    if (node.name === "length" && (object.kind === "string" || object.kind === "list")) return numberValue(object.kind === "string" ? object.value.length : object.items.length);
    throw new VariableError(phrase.memberNotInType(node.name, typeLabel(typeOfValue(object))), node.nameStart);
  }

  private index(node: Extract<Node, { t: "index" }>): Evaluated {
    const object = this.visit(node.object);
    if (object === short) return short;
    const key = this.value(node.index);

    if (object.kind === "null") {
      if (node.optional) return short;
      throw refuse(phrase.readFieldOfNull(key.kind === "string" ? key.value : displayValue(key, 20)));
    }
    if (object.kind === "object") {
      if (key.kind !== "string") throw refuse(phrase.indexKind());
      if (forbiddenMembers.has(key.value)) throw refuse(phrase.memberForbidden(key.value));
      const field = object.fields.get(key.value);
      if (field === undefined) throw refuse(phrase.objectNoField(this.label(node.object), key.value, [...object.fields.keys()]));
      return field;
    }
    if (object.kind === "list" || object.kind === "string") {
      if (key.kind !== "number") throw refuse(phrase.indexKind());
      const at = key.value;
      const label = `${this.label(node.object)}[${this.label(node.index)}]`;
      if (!Number.isInteger(at)) throw refuse(phrase.indexNotInteger());
      if (at < 0) throw refuse(phrase.negativeIndex(this.label(node.object)));
      if (object.kind === "list") {
        if (at >= object.items.length) throw refuse(phrase.indexOutOfList(label, object.items.length));
        return object.items[at];
      }
      if (at >= object.value.length) throw refuse(phrase.indexOutOfText(label, object.value.length));
      return stringValue(object.value[at]);
    }
    throw refuse(phrase.notIndexable(typeLabel(typeOfValue(object))));
  }

  private context(name: string): CallContext {
    return { env: this.env, meter: this.meter, name };
  }

  private call(node: Extract<Node, { t: "call" }>): Value {
    const name = node.fn.namespace === null ? node.fn.name : `${node.fn.namespace}.${node.fn.name}`;
    const def = functionNamed(node.fn.namespace, node.fn.name);
    if (def === undefined) throw refuse(phrase.unknownMember(node.fn.name, node.fn.namespace ?? "Prism"));
    return callFunction(def, name, this.arguments(node.args), this.context(name));
  }

  private method(node: Extract<Node, { t: "method" }>): Evaluated {
    const receiver = this.visit(node.receiver);
    if (receiver === short) return short;
    if (receiver.kind === "null") {
      if (node.optional) return short;
      throw new VariableError(phrase.readFieldOfNull(node.name), node.nameStart);
    }

    const args = this.arguments(node.args);
    const result = callMethod(receiver, node.name, args, this.context(node.name));
    if (result === null) throw new VariableError(phrase.memberNotInType(node.name, typeLabel(typeOfValue(receiver))), node.nameStart);
    return result;
  }
}
