import { readFileSync } from "node:fs";

import type { Engine } from "@/components/ui/engine-tag";

import { dateText } from "./dates";
import { Random, type Seed } from "./random";
import { checkScript, evaluateScript, ScriptRun } from "./run";
import type { BoundCommand } from "./bind";
import { editorOffset } from "./positions";
import { sentSql } from "./sent-sql";
import { readScript } from "./script";
import { typeLabel, type Value } from "./values";
import { numberText } from "./values";

/*
 * O que os testes de tabela têm em comum (a seção "Testes e sondas" da especificação): o arquivo de casos, escrito à mão, e a leitura de cada caso. Cada caso tem `name`,
 * `engine` (ou nulo), `input`, `seed` (ou nulo) e o que se espera: `value` e `type`, ou `error` com `line`, `column` e `message`. Os arquivos nunca se regeram a partir do código.
 */

// As datas valem na hora local da máquina (RN-VAR-007): os casos fixam a de São Paulo, sem horário de verão desde 2019 e com ele em 2018 e 2019.
process.env.TZ = "America/Sao_Paulo";

export type CaseError = { line: number; column: number; message: string };

export type Case = {
  name: string;
  engine: Engine | null;
  input: string;
  seed: [number, number, number, number] | null;
  value?: unknown;
  type?: string;
  error?: CaseError;
  /** Para o texto grande que não cabe escrito à mão: cada `token` de `input` troca por `text` repetido `times` vezes. */
  expand?: { token: string; text: string; times: number } | { token: string; text: string; times: number }[];
  /** Os milissegundos que o relógio falso anda a cada leitura (os casos dos 250 ms e dos 5 s). */
  clockStep?: number;
  now?: string;
  [extra: string]: unknown;
};

/** O texto do caso com o `expand` feito. */
export function inputOf(c: Case): string {
  const steps = c.expand === undefined ? [] : Array.isArray(c.expand) ? c.expand : [c.expand];
  return steps.reduce((text, step) => text.replaceAll(step.token, step.text.repeat(step.times)), c.input);
}

/** Os casos de um arquivo `<grupo>.cases.json`. */
export function loadCases<T extends Case = Case>(group: string): T[] {
  const file = new URL(`./${group}.cases.json`, import.meta.url);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { cases: T[] };
  return parsed.cases;
}

/** O valor da linguagem como o arquivo de casos o escreve: o JSON do que a pessoa vê (a data é o texto dela, o número com texto exato é o número). */
export function plain(value: Value): unknown {
  switch (value.kind) {
    case "number":
      return value.value;
    case "string":
    case "boolean":
      return value.value;
    case "null":
      return null;
    case "date":
      return value.exact ?? dateText(value.fields, value.precision);
    case "sql":
      return value.text;
    case "list":
      return value.items.map(plain);
    case "object": {
      const result: Record<string, unknown> = {};
      for (const [key, field] of value.fields) Object.defineProperty(result, key, { value: plain(field), enumerable: true, writable: true, configurable: true });
      return result;
    }
  }
}

/** A data de "agora" dos testes: 2026-10-20 10:30:00, na hora local da máquina. */
export const testNow = (text = "2026-10-20T10:30:00") => new Date(text).getTime();

export type Outcome = { value: unknown; type: string; exact?: string } | { error: CaseError };

/** Lê, confere e avalia o script do caso; devolve o valor da última variável atribuída, ou o primeiro erro. */
export function evaluateCase(c: Case): Outcome {
  const model = readScript(inputOf(c), c.engine ?? undefined, { blankLines: true });
  let ticks = 0;
  const config = { engine: c.engine ?? undefined, random: new Random((c.seed ?? [1, 2, 3, 4]) as Seed), clock: () => (ticks += c.clockStep ?? 0), now: () => testNow(typeof c.now === "string" ? c.now : undefined) };
  const report = evaluateScript(model, config);

  const first = report.checkErrors[0];
  if (first !== undefined) return { error: { line: first.line, column: first.column, message: first.message } };

  let last: Extract<(typeof report.results)[number], { ok: true }> | null = null;
  for (const result of report.results) {
    if (!result.ok) return { error: { line: result.error.line, column: result.error.column, message: result.error.message } };
    last = result;
  }
  if (last === null) throw new Error(`O caso "${c.name}" não atribui nenhuma variável.`);
  const stored = last.stored;
  return { value: plain(stored.value), type: typeLabel(stored.type), ...(stored.value.kind === "number" && stored.value.exact !== undefined ? { exact: numberText(stored.value) } : {}) };
}

export type BindingCase = Case & { sent?: string; sentHeader?: string | null };

/** O resultado da troca: o texto com os marcadores e os parâmetros, e o "SQL enviado". */
export type BindOutcome = { value: { sql: string; params: unknown[] }; sent: string; header: string | null; rows: unknown[] } | { error: CaseError };

/** Lê e confere o script do caso, avalia as atribuições na ordem e troca o último comando (RN-VAR-017). */
export function bindCaseOutcome(c: Case): BindOutcome {
  const engine = c.engine ?? undefined;
  const model = readScript(inputOf(c), engine, { blankLines: true });
  const config = { engine, random: new Random((c.seed ?? [1, 2, 3, 4]) as Seed), clock: () => 0, now: () => testNow(typeof c.now === "string" ? c.now : undefined) };

  const first = checkScript(model, config.clock, config.now)[0];
  if (first !== undefined) return { error: { line: first.line, column: first.column, message: first.message } };

  const run = new ScriptRun(model, config);
  let last: BoundCommand | null = null;
  for (const item of model.items) {
    if (item.parsed !== null) {
      const result = run.evaluate(item.index);
      if (!result.ok) return { error: { line: result.error.line, column: result.error.column, message: result.error.message } };
    } else if (item.kind === "statement") {
      const result = run.bind(item.index);
      if (!result.ok) return { error: { line: result.error.line, column: result.error.column, message: result.error.message } };
      last = result.command;
    }
  }
  if (last === null) throw new Error(`O caso "${c.name}" não tem comando.`);

  const sent = sentSql(last, engine);
  return { value: { sql: last.sql, params: last.params.map((parameter) => [parameter.type, parameter.value, parameter.variable]) }, sent: sent.text, header: sent.header, rows: sent.rows };
}

export type PositionCase = Case & { sentSql: string; dbPosition: number };

/** Onde, no texto do editor, cai a posição do erro do banco (RN-SQL-009): o texto enviado, com os marcadores, e a posição no editor. */
export function positionOutcome(c: PositionCase): { sql: string; offset: number } {
  const engine = c.engine ?? undefined;
  const model = readScript(inputOf(c), engine, { blankLines: true });
  const run = new ScriptRun(model, { engine, random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => testNow() });

  let found: { sql: string; offset: number } | null = null;
  for (const item of model.items) {
    if (item.parsed !== null) {
      const result = run.evaluate(item.index);
      if (!result.ok) throw new Error(`${c.name}: ${result.error.message}`);
    } else if (item.kind === "statement") {
      const result = run.bind(item.index);
      if (!result.ok) throw new Error(`${c.name}: ${result.error.message}`);
      found = { sql: result.command.sql, offset: editorOffset(item.start, result.command, c.dbPosition) };
    }
  }
  if (found === null) throw new Error(`O caso "${c.name}" não tem comando.`);
  return found;
}
