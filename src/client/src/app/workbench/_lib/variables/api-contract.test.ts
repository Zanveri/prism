import { describe, expect, test } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { requestBodyBytes, requestParams, type BoundParameter } from "./bind";
import { Random } from "./random";
import { checkScript, ScriptRun } from "./run";
import { readScript } from "./script";
import { testNow } from "./cases-runner";
import { scanMarkers } from "./markers";
import { limits } from "./variables.copy";

/*
 * O contrato da tela com a API (RN-VAR-017 e 032): o que `bindCommand` manda em `params` tem de passar pela conferência da API (`QueryParameterRules`), que recusa com
 * 422 `QUERY_INVALID` no campo. As regras abaixo são as da especificação (RN-VAR-032) escritas de novo, sem ler o código da API: a forma de cada tipo e o que só
 * o banco decide. O que a tela devolve ao pedido é o que a API aceita, nos três bancos, ou a tela recusa antes com a frase dela.
 */
process.env.TZ = "America/Sao_Paulo";

const engines: { name: string; engine: Engine }[] = [
  { name: "PostgreSQL", engine: 1 },
  { name: "Db2", engine: 2 },
  { name: "Informix", engine: 3 },
];

const numberForm = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/;
const timestampForm = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-](\d{2})(:(\d{2}))?)?$/;

const existingDate = (year: number, month: number, day: number) => {
  const probe = new Date(Date.UTC(2000, 0, 1));
  probe.setUTCFullYear(year, month - 1, day);
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
};

/** Por que a API recusaria o parâmetro (ou `null` quando aceita), pelas regras da RN-VAR-032. */
function apiRefusal(engine: Engine, parameter: BoundParameter): string | null {
  const { type, value } = parameter;
  if (value === null) return null;
  switch (type) {
    case "number": {
      if (value.length > 100 || !numberForm.test(value)) return `number fora da forma: ${value.slice(0, 40)}`;
      if (engine !== 1 && !/[eE]/.test(value)) {
        const [integer, fraction = ""] = value.replace("-", "").split(".");
        const digits = integer.replace(/^0+/, "").length + fraction.length;
        if (digits > 31) return `${digits} dígitos`;
      }
      if (engine !== 1 && /[eE]/.test(value) && !Number.isFinite(Number(value))) return "double estoura";
      return null;
    }
    case "boolean":
      return value === "true" || value === "false" ? null : "boolean";
    case "date": {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      return match !== null && existingDate(Number(match[1]), Number(match[2]), Number(match[3])) ? null : `date: ${value}`;
    }
    case "timestamp": {
      const match = timestampForm.exec(value);
      if (match === null) return `timestamp fora da forma: ${value}`;
      if (!existingDate(Number(match[1]), Number(match[2]), Number(match[3])) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return `timestamp não existe: ${value}`;
      if (match[8] !== undefined) {
        if (engine !== 1) return "fuso fora do PostgreSQL";
        if (Number(match[9]) > 15 || (match[11] !== undefined && Number(match[11]) > 59)) return `fuso fora da faixa: ${value}`;
      }
      return null;
    }
    case "text": {
      if (value.length > 1_000_000 || value.includes("\0")) return "text";
      return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(value) ? "meio par UTF-16" : null;
    }
  }
}

/** O comando `sql` com as declarações de `script` avaliadas; devolve os parâmetros, ou a frase da tela quando ela mesma recusa. */
function bound(script: string, sql: string, engine: Engine): { params: BoundParameter[]; text: string } | { refused: string } {
  const model = readScript(`${script}\n${sql}`, engine, { blankLines: true });
  const config = { engine, random: new Random([1, 2, 3, 4]), clock: () => 0, now: () => testNow() };
  const first = checkScript(model, config.clock, config.now)[0];
  if (first !== undefined) return { refused: first.message };
  const run = new ScriptRun(model, config);
  let last: { params: BoundParameter[]; text: string } | null = null;
  for (const item of model.items) {
    if (item.parsed !== null) {
      const result = run.evaluate(item.index);
      if (!result.ok) return { refused: result.error.message };
    } else if (item.kind === "statement") {
      const result = run.bind(item.index);
      if (!result.ok) return { refused: result.error.message };
      last = { params: result.command.params, text: result.command.sql };
    }
  }
  if (last === null) throw new Error("sem comando");
  return last;
}

const digits = (count: number, from = 1) => Array.from({ length: count }, (_, index) => String((index + from) % 10 || 1)).join("");

// Cada linha: o script (as declarações) e o comando. O resultado de cada uma, em cada banco, ou é aceito pela API, ou é a recusa da tela.
const scripts: { name: string; script: string; sql?: string }[] = [
  { name: "inteiro", script: "let x = 42" },
  { name: "inteiro negativo", script: "let x = -42" },
  { name: "zero negativo", script: "let x = -0" },
  { name: "zeros à esquerda", script: "let x = 007" },
  { name: "decimal", script: "let x = 12.50" },
  { name: "começa pelo ponto", script: "let x = .5" },
  { name: "termina no ponto", script: "let x = 5." },
  { name: "separador de milhares", script: "let x = 1_000_000" },
  { name: "expoente", script: "let x = 1e3" },
  { name: "expoente maiúsculo e mais", script: "let x = 1E+3" },
  { name: "expoente negativo", script: "let x = 1e-7" },
  { name: "ponto antes do expoente", script: "let x = 5.e3" },
  { name: "expoente que o double não tem", script: "let x = 1e400" },
  { name: "grande, do double", script: "let x = 1.5e300" },
  { name: "conta que dá 1e21", script: "let x = 10 ** 21" },
  { name: "conta que dá 1e-7", script: "let x = 1 / 10000000" },
  { name: "inteiro fora do double", script: "let x = 9007199254740993" },
  { name: "o menor bigint", script: "let x = -9223372036854775808" },
  { name: "além do bigint", script: "let x = 9223372036854775808" },
  { name: "31 dígitos", script: `let x = ${digits(31)}` },
  { name: "32 dígitos", script: `let x = ${digits(32)}` },
  { name: "decimal de 31 dígitos", script: `let x = ${digits(20)}.${digits(11)}` },
  { name: "decimal de 32 dígitos", script: `let x = ${digits(20)}.${digits(12)}` },
  { name: "99 dígitos", script: `let x = ${digits(99)}` },
  { name: "100 dígitos", script: `let x = ${digits(100)}` },
  { name: "101 dígitos", script: `let x = ${digits(101)}` },
  { name: "decimal de 150 casas", script: `let x = 0.${digits(150)}` },
  { name: "hexadecimal", script: "let x = 0x10" },
  { name: "texto", script: "let x = 'a\\'b\\\\c\\nd'" },
  { name: "texto vazio", script: "let x = ''" },
  { name: "acentos e emoji", script: "let x = 'ação 😀'" },
  { name: "boolean", script: "let x = true" },
  { name: "null do tipo número", script: "let x: number | null = null" },
  { name: "null do tipo data", script: "let x: Date | null = null" },
  { name: "data de dia", script: "let x = date.of(2026, 10, 20)" },
  { name: "data do ano 1", script: "let x = date.of(1, 1, 1)" },
  { name: "data do ano 9999", script: "let x = date.of(9999, 12, 31)" },
  { name: "instante", script: "let x = new Date('2026-10-20T10:30:15')" },
  { name: "instante com milissegundos", script: "let x = new Date('2026-10-20T10:30:15.123')" },
  { name: "instante com um dígito", script: "let x = new Date('2026-10-20T10:30:15.5')" },
  { name: "instante em 1850 (o fuso de Greenwich do século XIX)", script: "let x = new Date('1850-06-01T10:30:00')" },
  { name: "instante em 1900", script: "let x = new Date('1900-01-01T00:00:00')" },
  { name: "instante no ano 1", script: "let x = new Date('0001-01-01T00:00:00')" },
  { name: "instante no horário de verão", script: "let x = new Date('2018-12-01T10:00:00')" },
  { name: "agora", script: "let x = new Date()" },
  { name: "hoje", script: "let x = date.today()" },
  { name: "texto cortado no meio do par UTF-16", script: "let x = '😀'.slice(0, 1)" },
  { name: "texto com a metade de um par pelo escape", script: "let x = '\\uD83D'" },
  { name: "texto com U+0000", script: "let x = '\\u0000'" },
  { name: "texto com controle e bidi", script: "let x = 'a\\u0001\\u202Eb'" },
  { name: "lista de números", script: "let x = [1, 2.5, 3]", sql: "SELECT * FROM t WHERE a IN (@x)" },
  { name: "lista de textos", script: "let x = ['a', 'b']", sql: "SELECT * FROM t WHERE a IN (@x)" },
  { name: "lista com null", script: "let x: number[] = [1, null]", sql: "SELECT * FROM t WHERE a IN (@x)" },
  { name: "lista de datas", script: "let x = [date.of(2026, 1, 1), new Date('2026-01-01T10:00:00')]", sql: "SELECT * FROM t WHERE a IN (@x)" },
  { name: "objeto, o campo", script: "let x = { a: 1, b: 'z' }", sql: "SELECT * FROM t WHERE a = @x.a AND b = @x.b" },
];

describe("o que a tela manda nos params passa pela conferência da API", () => {
  test("o pedido leva só type e value em cada parâmetro", () => {
    const result = bound("let x = 1\nlet y = 'a'", "SELECT @x, @y", 1);
    if ("refused" in result) throw new Error(result.refused);
    expect(result.params.map((parameter) => Object.keys(parameter))).toEqual([["type", "value", "variable", "item"], ["type", "value", "variable", "item"]]);
    expect(requestParams(result.params).map((parameter) => Object.keys(parameter))).toEqual([["type", "value"], ["type", "value"]]);
    expect(JSON.parse(JSON.stringify(requestParams(result.params)))).toEqual([{ type: "number", value: "1" }, { type: "text", value: "a" }]);
  });

  test("o corpo das rotas transfers (16 MiB) é menor que o das consultas (30.000.000), e a tela guarda os dois", () => {
    expect(requestBodyBytes("SELECT 1", [])).toBeLessThan(limits.transferBodyBytes);
    expect(limits.transferBodyBytes).toBeLessThan(limits.requestBodyBytes);
  });

  test("a tabela não passa em branco: a tela monta a maior parte dos casos", () => {
    const built = scripts.filter(({ script, sql }) => !("refused" in bound(script, sql ?? "SELECT * FROM t WHERE a = @x", 1)));
    expect(built.length).toBeGreaterThanOrEqual(scripts.length - 12);
  });

  test("os limites da tela são os da API (10.000 parâmetros, 4 MiB, 100 caracteres, 31 dígitos, 1.000.000 de caracteres)", () => {
    expect(limits.parameters).toBe(10_000);
    expect(limits.parameterBytes).toBe(4 * 1024 * 1024);
    expect(limits.numberCharacters).toBe(100);
    expect(limits.decimalDigits).toBe(31);
    expect(limits.textLength).toBe(1_000_000);
  });

  for (const { name, engine } of engines) {
    describe(name, () => {
      test.each(scripts)("$name", ({ script, sql }) => {
        const result = bound(script, sql ?? "SELECT * FROM t WHERE a = @x", engine);
        if ("refused" in result) return;
        const refusals = result.params.map((parameter) => apiRefusal(engine, parameter)).filter((refusal) => refusal !== null);
        expect(refusals).toEqual([]);
        // Os marcadores do texto que vai são os dos parâmetros, na ordem: o `QUERY_PARAMETERS_MISMATCH` da API não vem de um comando que a tela montou.
        const scan = scanMarkers(result.text, engine);
        expect(scan.count).toBe(result.params.length);
        if (engine === 1) expect(scan.numbers).toEqual(result.params.map((_, index) => index + 1));
      });
    });
  }
});
