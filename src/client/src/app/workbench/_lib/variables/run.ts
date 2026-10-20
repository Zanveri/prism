import type { Engine } from "@/components/ui/engine-tag";

import { unclosedConstruct, visitCode } from "../sql-statements";
import { childrenOf, type Node, type ParsedItem, type TypeAnnotation } from "./ast";
import { bindCommand, type BoundCommand } from "./bind";
import { reportInternalError } from "./boundary";
import { makeLocator, VariableError } from "./errors";
import { Evaluator, isDeterministic } from "./evaluate";
import { Meter, RunMeter, type Clock, type Environment, type Now } from "./meter";
import { Random } from "./random";
import { staticDiagnostics, variablesUsedBy, type ItemDiagnostic, type ModelItem, type ScriptModel } from "./script";
import {
  displayValue,
  fits,
  nullable,
  numberType,
  booleanType,
  sqlType,
  sqlValue,
  stringType,
  typeLabel,
  typeOfValue,
  type Type,
  type Value,
} from "./values";
import { limits, phrase } from "./variables.copy";

/*
 * A execução do script (RN-VAR-012, 019, 020 e 023): cada item na vez dele, na ordem do texto. Uma declaração avaliada guarda o valor, o tipo, a origem, a hora, o
 * tempo, o texto que a deu e a ordem da avaliação (um contador da aba). O comando leva os valores da última atribuição acima dele no texto: o `ScriptRun` guarda os
 * valores no ponto em que está. A conferência de antes de executar (`checkScript`) é a mesma execução em seco: avalia o que não muda com a hora nem com a sorte e não
 * depende do banco, e deixa o resto para a execução de verdade.
 */

/** De onde veio o valor (RN-VAR-024). As quatro últimas são das próximas partes. */
export type Origin = "literal" | "expressão" | "random" | "consulta" | "pergunta" | "diálogo";

/** O que a aba guarda de cada variável (RN-VAR-023). `declared` é o tipo da declaração, contra o qual as reatribuições se conferem; `type` é o do valor de agora. */
export type StoredValue = {
  name: string;
  value: Value;
  type: Type;
  declared: Type;
  origin: Origin;
  /** A hora da avaliação, em milissegundos desde 1970. */
  at: number;
  /** O tempo da avaliação, em milissegundos. */
  ms: number;
  /** O texto da atribuição que deu o valor. */
  text: string;
  /** A ordem da avaliação: o contador da aba. */
  order: number;
  /**
   * As atribuições do mesmo nome que vieram antes desta e deram o valor que ela usou (a declaração e as reatribuições acima), na ordem do texto: a aba guarda um valor por
   * nome, o da última, e sem isto a declaração de `let n = ...; n = n + 1` nunca estaria em dia (RN-VAR-020 e 023). Falta quando é a primeira.
   */
  earlier?: readonly EvaluatedAssignment[];
};

/** O que se sabe de uma atribuição já avaliada: o texto dela e a ordem da avaliação. */
export type EvaluatedAssignment = { text: string; order: number };

export type TabValues = ReadonlyMap<string, StoredValue>;

export type RunConfig = { engine?: Engine; random: Random; clock: Clock; now: Now };

export type AssignmentResult = { ok: true; stored: StoredValue; steps: number } | { ok: false; error: ItemDiagnostic };
export type BindResult = { ok: true; command: BoundCommand } | { ok: false; error: ItemDiagnostic };

/** O tipo de uma anotação (RN-VAR-004). O tipo de coluna ainda não existe: a conferência já o recusou. */
export function annotationType(annotation: TypeAnnotation): Type {
  let type: Type;
  switch (annotation.base) {
    case "number":
      type = numberType;
      break;
    case "boolean":
      type = booleanType;
      break;
    case "sql":
      type = sqlType;
      break;
    case "Date":
      type = { tag: "date" };
      break;
    default:
      type = stringType;
  }
  if (annotation.list) type = { tag: "list", item: type };
  return annotation.nullable ? nullable(type) : type;
}

const literalNodes: ReadonlySet<Node["t"]> = new Set(["number", "string", "boolean", "null"]);

/** Se a expressão é só literais (os de lista e objeto também, e o `-` num número). */
function isLiteral(node: Node): boolean {
  if (literalNodes.has(node.t)) return true;
  if (node.t === "unary") return node.op !== "!" && node.operand.t === "number";
  if (node.t === "list" || node.t === "object") return childrenOf(node).every(isLiteral);
  return false;
}

const usesRandom = (node: Node): boolean => (node.t === "call" && (node.fn.namespace === "random" || (node.fn.namespace === "Math" && node.fn.name === "random"))) || childrenOf(node).some(usesRandom);

/** A origem do valor de uma atribuição (RN-VAR-024). */
export function originOf(node: Node): Origin {
  if (isLiteral(node)) return "literal";
  return usesRandom(node) ? "random" : "expressão";
}

/** O tipo mostrado de uma variável: o da declaração, com a precisão do valor quando é uma data. */
function shownType(declared: Type, value: Value): Type {
  if (declared.tag === "date" && value.kind === "date") return { tag: "date", precision: value.precision };
  return declared;
}

const unclosedPhrases = { text: "um texto", quoted: "um nome entre aspas", comment: "um comentário", dollar: "um $tag$" } as const;

export class ScriptRun {
  readonly model: ScriptModel;
  private readonly config: RunConfig;
  private readonly env: Environment;
  private readonly runMeter: RunMeter;
  private readonly values = new Map<string, Value>();
  private readonly stored = new Map<string, StoredValue>();
  private readonly declaredTypes = new Map<string, Type>();
  /** A posição de cada atribuição entre as do mesmo nome (`assignmentRanks`), calculada na primeira reatribuição. */
  private ranks: Map<number, number> | null = null;
  /** O tamanho de cada valor guardado e a soma deles, para o limite da aba conferir sem percorrer tudo a cada avaliação (RN-VAR-013). */
  private readonly sizes = new Map<string, number>();
  private tabBytes = 0;
  private readonly locate: (offset: number) => { line: number; column: number };
  private evaluations: number;

  /** `tab` são os valores que a aba já tem (para o Ctrl+Enter, RN-VAR-020) e `counter` o contador de avaliações dela. */
  constructor(model: ScriptModel, config: RunConfig, tab: TabValues = new Map(), counter = 0) {
    this.model = model;
    this.config = config;
    this.env = { random: config.random, clock: config.clock, now: config.now, engine: config.engine ?? model.engine };
    this.runMeter = new RunMeter(config.clock);
    this.locate = makeLocator(model.source);
    this.evaluations = counter;
    for (const [name, entry] of tab) {
      this.values.set(name, entry.value);
      this.stored.set(name, entry);
      this.declaredTypes.set(name, entry.declared);
      this.remember(name, valueBytes(entry.value));
    }
  }

  /** O contador de avaliações depois do que já correu. */
  get counter(): number {
    return this.evaluations;
  }

  /** Os valores da aba depois do que já correu. */
  get tab(): TabValues {
    return new Map(this.stored);
  }

  /** O valor de uma variável neste ponto. */
  valueOf(name: string): Value | undefined {
    return this.values.get(name);
  }

  private diagnostic(item: ModelItem, message: string, offset: number): ItemDiagnostic {
    const at = offset < 0 ? item.start : offset;
    return { message, offset: at, ...this.locate(at), itemIndex: item.index };
  }

  /** O que o tipo de uma coluna ou do `sql` faz com o valor (RN-VAR-004). Lança a frase. */
  private coerce(item: ModelItem, parsed: ParsedItem, raw: Value): { value: Value; declared: Type } {
    const name = parsed.name;
    const valueStart = parsed.value?.start ?? parsed.start;

    if (parsed.kind === "reassignment") {
      const declared = this.declaredTypes.get(name);
      const first = this.model.declarations.get(name);
      if (declared === undefined) throw new VariableError(phrase.notDeclared(name), parsed.nameStart);
      if (first !== undefined && !first.mutable) throw new VariableError(phrase.constReassigned(name, first.line), parsed.nameStart);
      if (declared.tag === "sql") throw new VariableError(phrase.sqlMustBeConst(name), parsed.nameStart);
      if (!fits(typeOfValue(raw), declared)) throw new VariableError(declared.tag === "null" ? phrase.nullOnlyNullable(name) : phrase.notFit(name, typeLabel(declared), displayValue(raw)), valueStart);
      return { value: raw, declared };
    }

    const annotation = parsed.annotation;
    if (annotation === null) {
      const inferred = typeOfValue(raw);
      if (inferred.tag === "list" && inferred.item.tag === "never") throw new VariableError(phrase.emptyListNeedsType(name), valueStart);
      return { value: raw, declared: inferred };
    }

    if (annotation.base === "column") throw new VariableError(phrase.provisionalColumnType(), annotation.start);
    const declared = annotationType(annotation);

    if (annotation.base === "sql") {
      if (parsed.mutable) throw new VariableError(phrase.sqlMustBeConst(name), parsed.nameStart);
      if (annotation.list || annotation.nullable) throw new VariableError(phrase.sqlNoListOrNull(), annotation.start);
      if (raw.kind !== "string") throw new VariableError(phrase.sqlNeedsText(displayValue(raw)), valueStart);
      this.checkSqlText(name, raw.value, valueStart);
      return { value: sqlValue(raw.value), declared };
    }

    if (!fits(typeOfValue(raw), declared)) throw new VariableError(phrase.notFit(name, typeLabel(declared), displayValue(raw)), valueStart);
    return { value: raw, declared };
  }

  /** O texto do `sql`, lido sozinho, não pode terminar dentro de um texto, de um nome entre aspas, de um comentário nem de um `$tag$`, e tem os parênteses equilibrados (RN-VAR-004). */
  private checkSqlText(name: string, text: string, at: number): void {
    const engine = this.env.engine;
    const unclosed = unclosedConstruct(text, engine);
    if (unclosed !== null) throw new VariableError(phrase.sqlEndsInside(name, unclosedPhrases[unclosed]), at);

    let depth = 0;
    let balanced = true;
    visitCode(text, engine, (_, code) => {
      if (code === 40) depth++;
      else if (code === 41 && --depth < 0) balanced = false;
    });
    if (!balanced || depth !== 0) throw new VariableError(phrase.sqlUnbalanced(name), at);
  }

  /** Avalia a declaração ou a reatribuição do item (RN-VAR-012). Atualiza os valores do ponto e a aba. */
  evaluate(index: number): AssignmentResult {
    const item = this.model.items[index];
    const parsed = item.parsed;
    if (parsed === null) return { ok: false, error: this.diagnostic(item, item.error?.message ?? phrase.expectedName(), item.error?.offset ?? item.start) };

    const name = parsed.name;
    const meter = new Meter(this.runMeter, name);
    const started = this.config.clock();
    try {
      meter.checkStart();
      if (parsed.value === null) throw new VariableError(phrase.provisionalNoValue(name), parsed.nameStart);
      const raw = new Evaluator(this.env, meter, this.values, this.model.source).evaluate(parsed.value);
      const { value, declared } = this.coerce(item, parsed, raw);

      const earlier = this.earlierOf(index, name);
      const stored: StoredValue = {
        name,
        value,
        type: shownType(declared, value),
        declared,
        origin: originOf(parsed.value),
        at: this.env.now(),
        ms: this.config.clock() - started,
        text: item.text,
        order: ++this.evaluations,
        ...(earlier.length > 0 ? { earlier } : {}),
      };
      const bytes = valueBytes(value);
      this.checkTabSize(name, bytes, parsed.nameStart);
      this.remember(name, bytes);
      this.values.set(name, value);
      this.stored.set(name, stored);
      this.declaredTypes.set(name, declared);
      return { ok: true, stored, steps: meter.steps };
    } catch (error) {
      return { ok: false, error: this.failure(item, name, error) };
    }
  }

  /** As atribuições do mesmo nome acima deste item que a aba tem avaliadas, para o valor novo guardar de onde veio (`StoredValue.earlier`). */
  private earlierOf(index: number, name: string): EvaluatedAssignment[] {
    const previous = this.stored.get(name);
    if (previous === undefined) return [];
    this.ranks ??= assignmentRanks(this.model);
    return [...(previous.earlier ?? []), { text: previous.text, order: previous.order }].slice(0, this.ranks.get(index) ?? 0);
  }

  private failure(item: ModelItem, name: string, error: unknown): ItemDiagnostic {
    if (error instanceof VariableError) return this.diagnostic(item, error.message, error.offset);
    return this.diagnostic(item, reportInternalError(name, error), item.start);
  }

  /** A soma dos valores guardados da aba tem limite (RN-VAR-013): o texto em UTF-16, 2 bytes por unidade. */
  private checkTabSize(name: string, bytes: number, at: number): void {
    if (this.tabBytes - (this.sizes.get(name) ?? 0) + bytes > limits.tabValuesBytes) throw new VariableError(phrase.tabValuesTooBig(), at);
  }

  private remember(name: string, bytes: number): void {
    this.tabBytes += bytes - (this.sizes.get(name) ?? 0);
    this.sizes.set(name, bytes);
  }

  /** Esquece a variável: o valor dela não se sabe (a conferência em seco, quando a expressão muda com a hora ou depende do banco). */
  forget(name: string): void {
    this.values.delete(name);
    this.stored.delete(name);
    this.declaredTypes.delete(name);
    this.remember(name, 0);
    this.sizes.delete(name);
  }

  /** Troca os `@nome` do comando do item pelos marcadores, com os valores deste ponto (RN-VAR-017). */
  bind(index: number): BindResult {
    const item = this.model.items[index];
    try {
      const command = bindCommand(item.text, this.env.engine, this.model.declaredNames, this.values, this.declaredTypes);
      return { ok: true, command };
    } catch (error) {
      if (error instanceof VariableError) return { ok: false, error: this.diagnostic(item, error.message, error.offset < 0 ? item.start : item.start + error.offset) };
      return { ok: false, error: this.diagnostic(item, reportInternalError("o comando", error), item.start) };
    }
  }
}

/** O tamanho de um valor na memória da aba: o texto em UTF-16 (2 bytes por unidade) e 8 bytes por número e por data (RN-VAR-013). */
export function valueBytes(value: Value): number {
  switch (value.kind) {
    case "string":
      return value.value.length * 2;
    case "sql":
      return value.text.length * 2;
    case "list": {
      let total = 16;
      for (const item of value.items) total += valueBytes(item);
      return total;
    }
    case "object": {
      let total = 16;
      for (const [key, field] of value.fields) total += key.length * 2 + valueBytes(field);
      return total;
    }
    default:
      return 8;
  }
}

/**
 * A conferência de antes de executar (RN-VAR-012): os erros que se sabem sem executar nada — a gramática, os nomes, os tipos, o `const`, o `@nome` — e a execução em seco do
 * que não muda com a hora nem com a sorte e não depende do banco (o tipo errado de um valor que se sabe, a conta que não existe, o comando que não pode ser montado).
 */
export function checkScript(model: ScriptModel, clock: Clock = () => performance.now(), now: Now = () => Date.now()): ItemDiagnostic[] {
  const errors = staticDiagnostics(model);
  // O script que passou de 500 declarações já tem o erro dele: nada dele é avaliado, nem em seco (RN-VAR-013), e a conta não cresce com o texto colado.
  if (model.items.filter((item) => item.parsed !== null).length > limits.declarationsPerScript) return errors;
  const broken = new Set(errors.map((error) => error.itemIndex));
  const run = new ScriptRun(model, { engine: model.engine, random: new Random([1, 2, 3, 4]), clock, now });

  for (const item of model.items) {
    if (item.parsed !== null) {
      const parsed = item.parsed;
      if (broken.has(item.index)) {
        run.forget(parsed.name);
        continue;
      }
      if (parsed.value === null || !isDeterministic(parsed.value, (name) => run.valueOf(name) !== undefined)) {
        run.forget(parsed.name);
        continue;
      }
      const result = run.evaluate(item.index);
      if (!result.ok) {
        errors.push(result.error);
        run.forget(parsed.name);
      }
    } else if (item.kind === "statement" && item.atScan !== null && item.atScan.references.length > 0 && !broken.has(item.index)) {
      if (item.atScan.references.every((reference) => run.valueOf(reference.name) !== undefined)) {
        const result = run.bind(item.index);
        if (!result.ok) errors.push(result.error);
      }
    }
  }
  return errors.sort((a, b) => a.offset - b.offset);
}

/** A posição de cada atribuição entre as do mesmo nome, na ordem do texto: a declaração é a 0, a primeira reatribuição a 1. */
function assignmentRanks(model: ScriptModel): Map<number, number> {
  const counts = new Map<string, number>();
  const ranks = new Map<number, number>();
  for (const item of model.items) {
    if (item.parsed === null) continue;
    const rank = counts.get(item.parsed.name) ?? 0;
    ranks.set(item.index, rank);
    counts.set(item.parsed.name, rank + 1);
  }
  return ranks;
}

/** As atribuições de cada nome, na ordem do texto, e a última de `name` acima de `before`. */
export function lastAssignmentAbove(model: ScriptModel): (name: string, before: number) => number | null {
  const assignmentsOf = new Map<string, number[]>();
  for (const item of model.items) {
    if (item.parsed === null) continue;
    const list = assignmentsOf.get(item.parsed.name);
    if (list === undefined) assignmentsOf.set(item.parsed.name, [item.index]);
    else list.push(item.index);
  }
  return (name, before) => {
    const list = assignmentsOf.get(name);
    if (list === undefined) return null;
    // A lista está em ordem do texto: a busca binária da última abaixo de `before` (o script de milhares de reatribuições do mesmo nome não vira uma conta quadrática).
    let low = 0;
    let high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle] < before) low = middle + 1;
      else high = middle;
    }
    return low === 0 ? null : list[low - 1];
  };
}

/**
 * Se o valor que a aba tem serve à atribuição `at` (RN-VAR-020 e 023): é o valor que a última avaliação do nome deu, ela e as atribuições do mesmo nome acima têm o texto de
 * quando foram avaliadas e foram avaliadas depois da última avaliação de cada atribuição de outro nome de que dependem (e essas, pela mesma regra). A aba só tem o valor da
 * última atribuição avaliada de cada nome: a de cima, que não é a última, não serve a quem a lê no meio do script.
 */
function currentChecker(model: ScriptModel, tab: TabValues): (at: number) => boolean {
  const lastAbove = lastAssignmentAbove(model);
  const ranks = assignmentRanks(model);
  const byName = new Map<string, number[]>();
  for (const item of model.items) {
    if (item.parsed === null) continue;
    const list = byName.get(item.parsed.name);
    if (list === undefined) byName.set(item.parsed.name, [item.index]);
    else list.push(item.index);
  }
  const cache = new Map<number, boolean>();
  /** A atribuição e as do mesmo nome acima dela têm o texto e as dependências de quando foram avaliadas. */
  const prefix = new Map<number, boolean>();

  const dependenciesOf = (at: number): number[] => {
    const found: number[] = [];
    for (const used of variablesUsedBy(model.items[at])) {
      const dependency = lastAbove(used, at);
      if (dependency !== null) found.push(dependency);
    }
    // A atribuição do mesmo nome logo acima dá o valor de que esta partiu, a use ela ou não.
    const rank = ranks.get(at) ?? 0;
    if (rank > 0) found.push((byName.get(model.items[at].parsed?.name ?? "") as number[])[rank - 1]);
    return found;
  };

  const check = (at: number): boolean => {
    const item = model.items[at];
    const parsed = item.parsed;
    if (parsed === null) return false;
    const entry = tab.get(parsed.name);
    if (entry === undefined) return false;

    const rank = ranks.get(at) ?? 0;
    const earlier = entry.earlier ?? [];
    const own = rank < earlier.length ? earlier[rank] : rank === earlier.length ? { text: entry.text, order: entry.order } : undefined;
    let valid = own !== undefined && own.text === item.text;
    if (valid && own !== undefined) {
      if (rank > 0) valid = prefix.get((byName.get(parsed.name) as number[])[rank - 1]) === true;
      for (const used of variablesUsedBy(item)) {
        if (!valid) break;
        const dependency = lastAbove(used, at);
        if (dependency === null || used === parsed.name) continue;
        const dependencyEntry = tab.get(used);
        valid = dependencyEntry !== undefined && cache.get(dependency) === true && dependencyEntry.order <= own.order;
      }
    }
    prefix.set(at, valid);
    return valid && rank === earlier.length;
  };

  return (root) => {
    const known = cache.get(root);
    if (known !== undefined) return known;

    // Sem recursão: a cadeia de milhares de declarações, cada uma usando a anterior, estouraria a pilha. Acha as atribuições de que `root` depende e que ainda não foram
    // conferidas e as confere das mais antigas para as mais novas (toda dependência está acima do item), de modo que cada uma já encontra as dela no cache.
    const pending = new Set<number>([root]);
    const stack = [root];
    while (stack.length > 0) {
      for (const dependency of dependenciesOf(stack.pop() as number)) {
        if (cache.has(dependency) || pending.has(dependency)) continue;
        pending.add(dependency);
        stack.push(dependency);
      }
    }
    for (const at of [...pending].sort((x, y) => x - y)) cache.set(at, check(at));
    return cache.get(root) as boolean;
  };
}

/**
 * As variáveis declaradas cujo valor na aba está desatualizado (RN-VAR-023 e 024): a declaração mudou depois de a variável ser avaliada, ou uma atribuição de que ela
 * depende foi avaliada de novo depois. A variável que ainda não tem valor não está aqui (ela é "sem valor"). A atribuição que vale para o valor é a de texto igual ao
 * que a aba guardou; sem nenhuma (o texto mudou), é desatualizado.
 */
export function staleNames(model: ScriptModel, tab: TabValues): Set<string> {
  const isCurrent = currentChecker(model, tab);
  const stale = new Set<string>();
  const byName = new Map<string, number[]>();
  for (const item of model.items) {
    if (item.parsed === null) continue;
    const list = byName.get(item.parsed.name);
    if (list === undefined) byName.set(item.parsed.name, [item.index]);
    else list.push(item.index);
  }
  for (const [name, entry] of tab) {
    const candidates = byName.get(name);
    if (candidates === undefined) continue;
    const matching = candidates.filter((at) => model.items[at].text === entry.text);
    if (matching.length === 0 || !matching.some(isCurrent)) stale.add(name);
  }
  return stale;
}

/**
 * Os itens (as atribuições) que a execução destes itens precisa avaliar antes (RN-VAR-020 e 023), com os valores que a aba já tem. Vários itens (o Alt+X) dividem a
 * mesma busca: a conta não cresce com o quadrado do script.
 */
export function dependencyPlan(model: ScriptModel, indexes: number | readonly number[], tab: TabValues): number[] {
  const roots = typeof indexes === "number" ? [indexes] : indexes;
  const lastAbove = lastAssignmentAbove(model);
  const isCurrent = currentChecker(model, tab);

  // Sem recursão, pelo mesmo motivo de `currentChecker`: a cadeia longa de declarações não estoura a pilha.
  const plan = new Set<number>();
  const stack = [...roots];
  while (stack.length > 0) {
    const at = stack.pop() as number;
    for (const used of variablesUsedBy(model.items[at])) {
      const dependency = lastAbove(used, at);
      if (dependency === null || plan.has(dependency) || isCurrent(dependency)) continue;
      plan.add(dependency);
      stack.push(dependency);
    }
  }
  for (const index of roots) if (model.items[index].parsed !== null) plan.add(index);
  return [...plan].sort((a, b) => a - b);
}

/** O resultado de avaliar um script inteiro (RN-VAR-019): cada atribuição na ordem, até o primeiro erro. */
export type EvaluationReport = { results: AssignmentResult[]; checkErrors: ItemDiagnostic[]; counter: number; tab: TabValues };

/**
 * A execução de um script só de declarações (o Alt+X sem comandos, e os testes): confere (RN-VAR-012) e, sem erro, avalia toda atribuição na ordem do texto, até o
 * primeiro erro. Com erro na conferência nada é avaliado.
 */
export function evaluateScript(model: ScriptModel, config: RunConfig, tab: TabValues = new Map(), counter = 0): EvaluationReport {
  const checkErrors = checkScript(model, config.clock, config.now);
  if (checkErrors.length > 0) return { results: [], checkErrors, counter, tab };

  const run = new ScriptRun(model, config, tab, counter);
  const results: AssignmentResult[] = [];
  for (const item of model.items) {
    if (item.parsed === null) continue;
    const result = run.evaluate(item.index);
    results.push(result);
    if (!result.ok) break;
  }
  return { results, checkErrors, counter: run.counter, tab: run.tab };
}
