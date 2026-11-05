import type { Engine } from "@/components/ui/engine-tag";

import type { ScriptItem } from "../sql-statements";
import { childrenOf, type Declaration, type Node, type ParsedItem, type TypeAnnotation, type TypeDeclaration } from "./ast";
import { diagnosticOf, makeLocator, VariableError, type Diagnostic } from "./errors";
import { findAtReferences, type AtScan } from "./at-names";
import { scanMarkers } from "./markers";
import { annotationProblem, typeDiagnostics, type TypeInfo } from "./named-types";
import { parseItem } from "./parser";
import { splitScript } from "./script-items";
import { limits, phrase } from "./variables.copy";

/*
 * O script lido (RN-VAR-001, 002, 003 e 012): os itens na ordem do texto, as declarações lidas, os nomes e o `@nome` de cada comando. E a conferência de antes de
 * executar, que não fala com o banco: a gramática, os nomes, o `const` reatribuído, o `@nome` usado antes da declaração e o marcador já escrito no texto. A conferência
 * dos valores que se sabem sem executar nada está em `run.ts` (`checkScript`).
 */

export type ModelItem = ScriptItem & {
  index: number;
  line: number;
  /** A declaração ou a reatribuição lida; nulo no comando, no tipo com nome e no item que não leu. */
  parsed: ParsedItem | null;
  /** A `interface` ou o `type Nome =` lido (o item `type`); nulo nos outros. Não tem valor: nada dele se avalia nem vai ao banco. */
  typeDeclaration: TypeDeclaration | null;
  /** Por que não leu. */
  error: VariableError | null;
  /** Os `@nome` do comando (as posições são do texto do item). */
  atScan: AtScan | null;
};

export type DeclarationInfo = { name: string; itemIndex: number; line: number; mutable: boolean; annotation: TypeAnnotation | null };

export type ScriptModel = {
  source: string;
  engine: Engine | undefined;
  items: readonly ModelItem[];
  /** A primeira declaração de cada nome. */
  declarations: ReadonlyMap<string, DeclarationInfo>;
  declaredNames: ReadonlySet<string>;
  /** A primeira `interface` ou `type` de cada nome de tipo, um espaço de nomes à parte do das variáveis (RN-VAR-002); os tipos se resolvem em `named-types.ts`. */
  types: ReadonlyMap<string, TypeInfo>;
};

/** Um erro do script com o item a que ele pertence (RN-VAR-020: as conferências valem só para o comando e para as atribuições de que ele depende). */
export type ItemDiagnostic = Diagnostic & { itemIndex: number };

export type ReadOptions = { blankLines?: boolean };

/** Lê o script: divide em itens (RN-VAR-019), lê cada declaração e acha os `@nome` dos comandos. */
export function readScript(source: string, engine?: Engine, options: ReadOptions = {}): ScriptModel {
  const locate = makeLocator(source);
  const raw = splitScript(source, engine, options);

  const items: ModelItem[] = raw.map((item, index) => ({ ...item, index, line: locate(item.start).line, parsed: null, typeDeclaration: null, error: null, atScan: null }));

  const declarations = new Map<string, DeclarationInfo>();
  const types = new Map<string, TypeInfo>();
  for (const item of items) {
    if (item.kind === "statement") continue;
    try {
      const { item: parsed } = parseItem(source, item.start, engine);
      if (parsed.kind !== "declaration" && parsed.kind !== "reassignment") {
        item.typeDeclaration = parsed;
        if (!types.has(parsed.name)) types.set(parsed.name, { name: parsed.name, itemIndex: item.index, line: locate(parsed.nameStart).line, declaration: parsed });
        continue;
      }
      item.parsed = parsed;
      if (parsed.kind === "declaration" && !declarations.has(parsed.name))
        declarations.set(parsed.name, { name: parsed.name, itemIndex: item.index, line: locate(parsed.nameStart).line, mutable: parsed.mutable, annotation: parsed.annotation });
    } catch (error) {
      if (!(error instanceof VariableError)) throw error;
      item.error = error;
    }
  }

  const declaredNames = new Set(declarations.keys());
  for (const item of items) if (item.kind === "statement") item.atScan = findAtReferences(item.text, engine, declaredNames);

  return { source, engine, items, declarations, declaredNames, types };
}

/** Os nomes de variáveis que a expressão usa, com a posição de cada uso. */
function visitNames(node: Node, visit: (name: string, start: number) => void): void {
  if (node.t === "name") visit(node.name, node.start);
  for (const child of childrenOf(node)) visitNames(child, visit);
}

/** Os nomes que um item usa, na ordem do texto: as variáveis da expressão de uma atribuição, ou os `@nome` de um comando (RN-VAR-020). */
export function variablesUsedBy(item: ModelItem): string[] {
  const used = new Set<string>();
  if (item.parsed !== null && item.parsed.value !== null) visitNames(item.parsed.value, (name) => used.add(name));
  if (item.atScan !== null) for (const reference of item.atScan.references) used.add(reference.name);
  return [...used];
}

/** O tipo que a anotação diz, ou nulo para o tipo de coluna (que chega depois). */
const declarationOf = (item: ModelItem): Declaration | null => (item.parsed?.kind === "declaration" ? item.parsed : null);

/** Os erros que se sabem só lendo o texto, sem executar nada nem falar com o banco (RN-VAR-012). */
export function staticDiagnostics(model: ScriptModel): ItemDiagnostic[] {
  const { source, items, declarations } = model;
  const locate = makeLocator(source);
  const found: ItemDiagnostic[] = [];
  const report = (item: ModelItem, message: string, offset: number) => found.push({ message, offset, ...locate(offset), itemIndex: item.index });

  // Os tipos com nome (RN-VAR-002): os erros de cada um são do item dele, e a declaração que usa um tipo com erro também tem o dela (`checkAnnotation`).
  for (const problem of typeDiagnostics(model)) found.push({ message: problem.message, offset: problem.offset, ...locate(problem.offset), itemIndex: problem.itemIndex });

  // Os nomes cujo valor vem de uma consulta ou do `random.of`, direta ou indiretamente (RN-VAR-004): o `sql` não pode depender deles.
  const fromDatabase = new Set<string>();
  let assignments = 0;
  for (const item of items) {
    if (item.error !== null) {
      found.push({ ...diagnosticOf(source, item.error), itemIndex: item.index });
      continue;
    }
    if (item.typeDeclaration !== null) continue;

    const parsed = item.parsed;
    if (parsed !== null) {
      if (++assignments === limits.declarationsPerScript + 1) report(item, phrase.tooManyDeclarations(), item.start);

      const declaration = declarationOf(item);
      if (declaration !== null) {
        const first = declarations.get(declaration.name);
        if (first !== undefined && first.itemIndex !== item.index) report(item, phrase.alreadyDeclared(declaration.name, first.line), declaration.nameStart);
        checkAnnotation(model, declaration, (message, offset) => report(item, message, offset));
        if (declaration.annotation?.base === "sql" && declaration.value !== null && dependsOnDatabase(declaration.value, fromDatabase)) report(item, phrase.sqlFromQuery(), declaration.value.start);
        if (declaration.value === null) {
          if (!declaration.mutable) report(item, phrase.constNeedsValue(declaration.name), declaration.nameStart);
          else if (declaration.annotation === null) report(item, phrase.letNeedsType(declaration.name), declaration.nameStart);
        }
      } else if (parsed.kind === "reassignment") {
        const first = declarations.get(parsed.name);
        if (first === undefined) report(item, phrase.notDeclaredAssign(parsed.name, source.slice(parsed.value.start, parsed.value.end)), parsed.nameStart);
        else if (first.itemIndex > item.index) report(item, phrase.usedBeforeDeclared(parsed.name, first.line), parsed.nameStart);
        else if (!first.mutable) report(item, phrase.constReassigned(parsed.name, first.line), parsed.nameStart);
      }

      if (parsed.value !== null) {
        if (dependsOnDatabase(parsed.value, fromDatabase)) fromDatabase.add(parsed.name);
        visitNames(parsed.value, (name, start) => {
          const info = declarations.get(name);
          if (info === undefined) report(item, phrase.notDeclared(name), start);
          else if (info.itemIndex >= item.index) report(item, phrase.usedBeforeDeclared(name, info.line), start);
        });
      }
      continue;
    }

    // O comando: o `@nome` usado antes da declaração é um erro, e não SQL (RN-VAR-015); e o marcador já escrito num comando com variáveis (RN-VAR-017).
    const scan = item.atScan;
    if (scan === null || scan.references.length === 0) continue;
    for (const reference of scan.references) {
      const info = declarations.get(reference.name);
      if (info !== undefined && info.itemIndex > item.index) report(item, phrase.usedBeforeDeclared(reference.name, info.line), item.start + reference.start);
    }
    const markers = scanMarkers(item.text, model.engine);
    if (markers.count > 0) report(item, phrase.markerAlreadyThere(markers.first ?? "?"), item.start);
  }
  return found.sort((a, b) => a.offset - b.offset);
}

/** Se o valor é uma consulta ou um `random.of`, ou usa uma variável que vem de um deles. */
function dependsOnDatabase(node: Node, fromDatabase: ReadonlySet<string>): boolean {
  if (node.t === "query" || node.t === "sample") return true;
  if (node.t === "name") return fromDatabase.has(node.name);
  return childrenOf(node).some((child) => dependsOnDatabase(child, fromDatabase));
}

/** A anotação que não vale (RN-VAR-004): o `sql` fora do lugar, e o tipo com nome que não existe ou tem erro. O tipo de coluna se confere na execução, pelo catálogo. */
function checkAnnotation(model: ScriptModel, declaration: Declaration, report: (message: string, offset: number) => void): void {
  const annotation = declaration.annotation;
  if (annotation === null) return;
  const problem = annotationProblem(model, annotation);
  if (problem !== null) report(problem.message, problem.offset);
  if (annotation.base === "sql") {
    if (declaration.mutable) report(phrase.sqlMustBeConst(declaration.name), declaration.nameStart);
    if (annotation.list || annotation.nullable) report(phrase.sqlNoListOrNull(), annotation.start);
  }
}
