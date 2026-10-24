import type { Engine } from "@/components/ui/engine-tag";

import { scriptItemAt, scriptItemCount } from "./variables/script-items";
import type { ScriptEntryKind } from "./script-run";
import { findAtReferences } from "./variables/at-names";
import { Random } from "./variables/random";
import { checkScript, dependencyPlan, lastAssignmentAbove, ScriptRun, type BindResult, type StoredValue, type TabValues } from "./variables/run";
import { readScript, variablesUsedBy, type ItemDiagnostic, type ModelItem, type ScriptModel } from "./variables/script";

/*
 * O que a execução com variáveis decide ANTES de falar com o Worker e com o banco (RN-VAR-019 e 020), em funções puras: quais itens do texto vão, quais
 * atribuições de fora deles precisam ser avaliadas antes, quais erros a conferência acha para eles, e com que valores cada comando é trocado pelos marcadores.
 * O executor da aba (`use-query-runner.ts`) chama estas funções e cuida do resto (o Worker, a pergunta da proteção, a API, as Estatísticas).
 */

/** O texto inteiro do editor e a preferência que decide onde a linha em branco separa os comandos (RN-SQL-018). */
export type ScriptDoc = { text: string; blankLines: boolean };

/** Um item que vai: o que ele é, o texto como está no editor e onde ele começa no editor. */
export type PlannedItem = { index: number; kind: ScriptEntryKind; text: string; offset: number };

export type Plan = {
  /** O texto lido até o fim do que vai. A seleção que começa no meio de um comando troca o item dele pelo trecho selecionado. */
  model: ScriptModel;
  items: PlannedItem[];
  /** As atribuições de fora do que vai que a aba ainda não tem em dia e que o que vai usa (RN-VAR-019, "A seleção"): são avaliadas antes, e não entram nas Estatísticas. */
  outer: number[];
  /** Os erros que a conferência (RN-VAR-012) acha para os itens que vão e para as atribuições de que eles dependem. */
  errors: ItemDiagnostic[];
};

export type PlanResult = { ok: true; plan: Plan } | { ok: false; reason: "nothing" } | { ok: false; reason: "tooMany"; count: number };

const kindOf = (item: ModelItem): ScriptEntryKind => (item.kind === "statement" ? "statement" : "declaration");

/** As atribuições de que os itens dependem, direta ou indiretamente, tenham elas valor em dia ou não. */
function dependenciesOf(model: ScriptModel, indexes: readonly number[]): Set<number> {
  const lastAbove = lastAssignmentAbove(model);
  const found = new Set<number>();
  const stack = [...indexes];
  while (stack.length > 0) {
    const at = stack.pop() as number;
    for (const used of variablesUsedBy(model.items[at])) {
      const dependency = lastAbove(used, at);
      if (dependency === null || found.has(dependency)) continue;
      found.add(dependency);
      stack.push(dependency);
    }
  }
  return found;
}

/** O item com o texto trocado por `text`, que começa em `start` no editor (o comando de que só uma parte foi selecionada). */
function trimmedItem(model: ScriptModel, item: ModelItem, start: number, text: string, engine: Engine | undefined): ModelItem {
  return { ...item, start, text, atScan: findAtReferences(text, engine, model.declaredNames) };
}

function finish(model: ScriptModel, items: ModelItem[], tab: TabValues): Plan {
  const byIndex = new Map(items.map((item) => [item.index, item] as const));
  const patched: ScriptModel = { ...model, items: model.items.map((item) => byIndex.get(item.index) ?? item) };

  const outer = dependencyPlan(patched, [...byIndex.keys()], tab).filter((index) => !byIndex.has(index));
  const relevant = new Set([...byIndex.keys(), ...dependenciesOf(patched, [...byIndex.keys()])]);
  const errors = checkScript(patched).filter((error) => relevant.has(error.itemIndex));
  return { model: patched, items: items.map((item) => ({ index: item.index, kind: kindOf(item), text: item.text, offset: item.start })), outer, errors };
}

/**
 * O Alt+X (RN-VAR-019): os itens do que vai, a seleção (`from` a `to`) ou o texto inteiro, lidos com o texto de cima (as declarações de fora da seleção valem). A
 * seleção que começa no meio de um comando manda só o trecho dela, como o "Executar script" sempre fez.
 */
export function planScript(doc: ScriptDoc, engine: Engine | undefined, from: number, to: number, tab: TabValues): PlanResult {
  const model = readScript(doc.text.slice(0, to), engine, { blankLines: doc.blankLines });
  const items: ModelItem[] = [];
  for (const item of model.items) {
    if (item.end <= from) continue;
    if (item.start >= from || item.kind !== "statement") {
      items.push(item);
      continue;
    }
    const slice = model.source.slice(from, item.end);
    const text = slice.trim();
    if (text === "") continue;
    items.push(trimmedItem(model, item, from + (slice.length - slice.trimStart().length), text, engine));
  }
  if (items.length === 0) return { ok: false, reason: "nothing" };
  return { ok: true, plan: finish(model, items, tab) };
}

/**
 * O Ctrl+Enter (RN-VAR-020): o item onde está o cursor (`from` igual a `to`), ou o da seleção. Com o cursor numa linha em branco logo depois de uma declaração, é
 * a declaração. A seleção com mais de um item (a conta é pelo `;` e pelas declarações) é o aviso de hoje (`tooMany`).
 */
export function planItem(doc: ScriptDoc, engine: Engine | undefined, from: number, to: number, tab: TabValues): PlanResult {
  const model = readScript(doc.text, engine, { blankLines: doc.blankLines });

  if (from === to) {
    // A escolha do item é a do Ctrl+Enter de sempre (RN-SQL-001 e 018): a linha em branco depois do último comando, ou entre dois, fica com o comando de cima.
    const found = scriptItemAt(doc.text, from, engine, { blankLines: doc.blankLines });
    const at = found === null ? null : (model.items.find((item) => item.start === found.start) ?? null);
    if (at === null) return { ok: false, reason: "nothing" };
    return { ok: true, plan: finish(model, [at], tab) };
  }

  const slice = doc.text.slice(from, to);
  const text = slice.trim();
  if (text === "") return { ok: false, reason: "nothing" };
  const count = scriptItemCount(text, engine);
  if (count > 1) return { ok: false, reason: "tooMany", count };
  const start = from + (slice.length - slice.trimStart().length);
  const item = model.items.find((candidate) => candidate.start <= start && start < candidate.end) ?? model.items.find((candidate) => candidate.start >= start);
  if (item === undefined) return { ok: false, reason: "nothing" };
  const same = item.start === start && item.text === text;
  return { ok: true, plan: finish(model, [same || item.kind !== "statement" ? item : trimmedItem(model, item, start, text, engine)], tab) };
}

/**
 * Os valores que valem para o item `index` (RN-VAR-012): para cada variável, o da última atribuição dela acima do item, a que esta execução avaliou
 * (`results`) ou, quando ela não foi avaliada agora (a que a aba já tinha em dia), a da aba.
 */
export function scopeBefore(model: ScriptModel, index: number, results: ReadonlyMap<number, StoredValue>, tab: TabValues): TabValues {
  const lastAbove = lastAssignmentAbove(model);
  const scope = new Map<string, StoredValue>();
  for (const name of model.declaredNames) {
    const at = lastAbove(name, index);
    if (at === null) continue;
    const value = results.get(at) ?? tab.get(name);
    if (value !== undefined) scope.set(name, value);
  }
  return scope;
}

/** Troca os `@nome` do item pelos marcadores, com os valores deste ponto (RN-VAR-017). */
export function bindItem(model: ScriptModel, index: number, scope: TabValues, engine: Engine | undefined): BindResult {
  const run = new ScriptRun(model, { engine, random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => Date.now() }, scope);
  return run.bind(index);
}

/** Se o texto do item tem algum `@nome` que o script declara: o comando que a execução troca pelos marcadores. */
export function usesVariables(item: Pick<ModelItem, "atScan">): boolean {
  return item.atScan !== null && item.atScan.references.length > 0;
}

