import { describe, expect, test } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import "./cases-runner";
import { editorOffset } from "./positions";
import { Random, type Seed } from "./random";
import { checkScript, evaluateScript, ScriptRun } from "./run";
import { readScript } from "./script";
import { scanMarkers } from "./markers";
import { fromWire, toWire } from "./wire";
import { plain, testNow } from "./cases-runner";
import { typeLabel } from "./values";

/*
 * Os testes de propriedade da linguagem das variáveis: 10.000 textos e árvores por execução, de uma semente que cada execução sorteia (a de `PRISM_PROPERTY_SEED`,
 * se estiver no ambiente) e que as mensagens de falha trazem, para repetir o caso. As propriedades: nada que se escreve derruba a leitura nem a avaliação, todo erro
 * aponta para dentro do texto, o resultado de uma árvore é o que o gerador calculou à parte, o ambiente fica como estava, o `random.int` fica no intervalo, os
 * marcadores contam como foram montados e os valores atravessam o Worker sem mudar.
 */

const cases = 10_000;
const timeout = 120_000;
const baseSeed = Number(process.env.PRISM_PROPERTY_SEED ?? "") || (Date.now() & 0x7fffffff) || 1;

/** O gerador dos testes (mulberry32): é outro que o da linguagem, para a propriedade não depender do que ela testa. */
function generator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T;
  return { next, int, pick, chance: (p: number) => next() < p };
}
type Gen = ReturnType<typeof generator>;

const engines: (Engine | undefined)[] = [undefined, 1, 2, 3];

/** O que um ataque ou um erro de leitura poderia mudar no ambiente. */
function fingerprint(): string {
  const describeProperties = (target: object) =>
    Object.getOwnPropertyNames(target)
      .sort()
      .map((name) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        return `${name}:${descriptor && "value" in descriptor ? typeof descriptor.value : "accessor"}:${descriptor?.writable}:${descriptor?.configurable}`;
      })
      .join("|");
  return [describeProperties(Object.prototype), describeProperties(Array.prototype), Object.getOwnPropertyNames(globalThis).sort().join("|")].join("\n");
}

const config = (engine: Engine | undefined, seed: Seed) => {
  let ticks = 0;
  // O relógio anda 1 ms a cada leitura: o texto sorteado nunca passa dos 250 ms por falta de sorte da máquina.
  return { engine, random: new Random(seed), clock: () => (ticks += 1), now: () => testNow() };
};

// O vocabulário do texto sorteado: pedaços da gramática, das funções e do SQL, e caracteres que quebram a leitura.
const pieces = [
  "const ", "let ", "x", "y", "z", "n", " = ", ": number", ": string", ": Date", ": sql", ": number[]", ": number | null", "=", "(", ")", "[", "]", "{", "}", ",", ".", "?.", "...", "?", ":",
  "1", "2", "10", "0.1", "1_000", "1e3", "1e400", "0x1F", "9007199254740993", "'a'", '"b"', "`t${x}`", "`", "'", '"', "${", "}", "\\", "\n", "\n\n", " ", "  ", ";", "// c\n", "/* c */", "/*",
  "+", "-", "*", "/", "%", "**", "&&", "||", "??", "!", "===", "!==", "<", ">=", "true", "false", "null", "undefined", "NaN", "Infinity",
  "Math.max(", "Math.floor(", "random.int(", "random.uuid()", "random.of(", "date.today()", "date(", "new Date(", "Date.now()", "Number(", "String(", ".toFixed(", ".length", ".map(", ".join(",
  "=>", "function", "eval(", "constructor", "__proto__", "prototype", "globalThis", "this", "import(", "while", "for", "class", "async", "await", "yield", "var ",
  "select ", "from t where a = ", "@x", "@y", "@z", "@ids", "$1", "?", "E'a\\'b'", "$$", "$t$", "--", "\u0000", " ", "é", "ç", "​", "😀", "\ud800",
];

function randomText(random: Gen): string {
  const length = random.int(1, 14);
  let text = "";
  for (let index = 0; index < length; index++) text += random.chance(0.06) ? String.fromCharCode(random.int(0, 0x2fff)) : random.pick(pieces);
  return text;
}

describe("propriedades da linguagem das variáveis", () => {
  test(`texto sorteado: ler, conferir e avaliar nunca falham por fora e todo erro aponta para dentro do texto (semente ${baseSeed})`, () => {
    const random = generator(baseSeed);
    const before = fingerprint();

    for (let round = 0; round < cases; round++) {
      const text = randomText(random);
      const engine = random.pick(engines);
      const context = `semente ${baseSeed}, caso ${round}, motor ${engine ?? "-"}: ${JSON.stringify(text)}`;
      try {
        const model = readScript(text, engine, { blankLines: random.chance(0.5) });
        const report = evaluateScript(model, config(engine, [1, 2, 3, round + 4]));
        const errors = [
          ...report.checkErrors,
          ...report.results.flatMap((result) => (result.ok ? [] : [result.error])),
        ];
        for (const error of errors) {
          expect(error.offset, context).toBeGreaterThanOrEqual(0);
          expect(error.offset, context).toBeLessThanOrEqual(text.length);
          expect(error.line, context).toBeGreaterThanOrEqual(1);
          expect(error.column, context).toBeGreaterThanOrEqual(1);
          expect(error.message, context).not.toBe("");
        }
        // Os itens cobrem o texto sem se sobrepor, na ordem.
        let end = 0;
        for (const item of model.items) {
          expect(item.start, context).toBeGreaterThanOrEqual(end);
          expect(item.end, context).toBeGreaterThanOrEqual(item.start);
          end = item.end;
        }
        expect(end, context).toBeLessThanOrEqual(text.length);
      } catch (error) {
        throw new Error(`Falhou por fora, ${context}`, { cause: error });
      }
    }
    expect(fingerprint()).toBe(before);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  }, timeout);

  test(`a conferência sozinha concorda com a avaliação: um script sem erro na conferência não falha por tipo ou por nome na avaliação (semente ${baseSeed})`, () => {
    const random = generator(baseSeed + 1);
    for (let round = 0; round < cases; round++) {
      const text = `${random.pick(["const", "let"])} x = ${random.pick(["1", "'a'", "[1, 2]", "{ a: 1 }", "null", "true"])}\n${random.pick(["const", "let"])} y = ${random.pick(["x", "x + x", "x.length", "x[0]", "x.a", "!x", "x ?? 1"])}`;
      const model = readScript(text, undefined, { blankLines: true });
      const check = checkScript(model, () => 0, () => testNow());
      const report = evaluateScript(model, config(undefined, [1, 2, 3, 4]));
      // O que a conferência acha, a avaliação nem tenta: com erro na conferência não há resultado.
      if (check.length > 0) expect(report.results, `${text}`).toEqual([]);
    }
  }, timeout);

  // As árvores: o gerador sabe o valor de cada nó, e o texto (com espaços e parênteses a mais) tem de dar o mesmo valor.
  type Tree =
    | { type: "number"; text: string; value: number }
    | { type: "boolean"; text: string; value: boolean }
    | { type: "string"; text: string; value: string };

  const wrap = (random: Gen, tree: Tree): Tree => (random.chance(0.3) ? { ...tree, text: `(${random.pick(["", " "])}${tree.text}${random.pick(["", " "])})` } : tree);
  const space = (random: Gen) => random.pick(["", " ", "  ", "\n  "]);

  function numberTree(random: Gen, depth: number): Extract<Tree, { type: "number" }> {
    if (depth <= 0 || random.chance(0.25)) {
      const value = random.int(0, 999);
      return { type: "number", text: String(value), value };
    }
    switch (random.int(0, 4)) {
      case 0: {
        const a = numberTree(random, depth - 1);
        const b = numberTree(random, depth - 1);
        return wrap(random, { type: "number", text: `(${a.text})${space(random)}+${space(random)}(${b.text})`, value: a.value + b.value }) as Extract<Tree, { type: "number" }>;
      }
      case 1: {
        const a = numberTree(random, depth - 1);
        const b = numberTree(random, depth - 1);
        return wrap(random, { type: "number", text: `(${a.text})-(${b.text})`, value: a.value - b.value }) as Extract<Tree, { type: "number" }>;
      }
      case 2: {
        const a = numberTree(random, depth - 1);
        const b = numberTree(random, depth - 1);
        return wrap(random, { type: "number", text: `(${a.text}) * (${b.text})`, value: a.value * b.value }) as Extract<Tree, { type: "number" }>;
      }
      case 3: {
        const test = booleanTree(random, depth - 1);
        const a = numberTree(random, depth - 1);
        const b = numberTree(random, depth - 1);
        return wrap(random, { type: "number", text: `(${test.text}) ? (${a.text}) : (${b.text})`, value: test.value ? a.value : b.value }) as Extract<Tree, { type: "number" }>;
      }
      default: {
        const a = numberTree(random, depth - 1);
        const b = numberTree(random, depth - 1);
        return wrap(random, { type: "number", text: `Math.max(${a.text}, ${b.text})`, value: Math.max(a.value, b.value) }) as Extract<Tree, { type: "number" }>;
      }
    }
  }

  function booleanTree(random: Gen, depth: number): Extract<Tree, { type: "boolean" }> {
    if (depth <= 0 || random.chance(0.2)) {
      const value = random.chance(0.5);
      return { type: "boolean", text: String(value), value };
    }
    switch (random.int(0, 4)) {
      case 0: {
        const a = booleanTree(random, depth - 1);
        return wrap(random, { type: "boolean", text: `!(${a.text})`, value: !a.value }) as Extract<Tree, { type: "boolean" }>;
      }
      case 1: {
        const a = booleanTree(random, depth - 1);
        const b = booleanTree(random, depth - 1);
        return wrap(random, { type: "boolean", text: `(${a.text}) && (${b.text})`, value: a.value && b.value }) as Extract<Tree, { type: "boolean" }>;
      }
      case 2: {
        const a = booleanTree(random, depth - 1);
        const b = booleanTree(random, depth - 1);
        return wrap(random, { type: "boolean", text: `(${a.text}) || (${b.text})`, value: a.value || b.value }) as Extract<Tree, { type: "boolean" }>;
      }
      case 3: {
        const a = numberTree(random, depth - 1);
        const b = numberTree(random, depth - 1);
        const op = random.pick(["===", "!==", "<", "<=", ">", ">="] as const);
        const value = { "===": a.value === b.value, "!==": a.value !== b.value, "<": a.value < b.value, "<=": a.value <= b.value, ">": a.value > b.value, ">=": a.value >= b.value }[op];
        return wrap(random, { type: "boolean", text: `(${a.text}) ${op} (${b.text})`, value }) as Extract<Tree, { type: "boolean" }>;
      }
      default: {
        const a = stringTree(random, depth - 1);
        const b = stringTree(random, depth - 1);
        return wrap(random, { type: "boolean", text: `(${a.text}) === (${b.text})`, value: a.value === b.value }) as Extract<Tree, { type: "boolean" }>;
      }
    }
  }

  function stringTree(random: Gen, depth: number): Extract<Tree, { type: "string" }> {
    if (depth <= 0 || random.chance(0.25)) {
      const value = random.pick(["", "a", "ab c", "ção", "x y", "😀"]);
      return { type: "string", text: random.chance(0.5) ? `'${value}'` : `"${value}"`, value };
    }
    switch (random.int(0, 2)) {
      case 0: {
        const a = stringTree(random, depth - 1);
        const b = stringTree(random, depth - 1);
        return wrap(random, { type: "string", text: `(${a.text}) + (${b.text})`, value: a.value + b.value }) as Extract<Tree, { type: "string" }>;
      }
      case 1: {
        const a = numberTree(random, depth - 1);
        const b = stringTree(random, depth - 1);
        return wrap(random, { type: "string", text: `\`n=\${${a.text}} s=\${${b.text}}\``, value: `n=${String(a.value)} s=${b.value}` }) as Extract<Tree, { type: "string" }>;
      }
      default: {
        const a = stringTree(random, depth - 1);
        return wrap(random, { type: "string", text: `(${a.text}).toUpperCase()`, value: a.value.toUpperCase() }) as Extract<Tree, { type: "string" }>;
      }
    }
  }

  test(`árvore sorteada: o texto dá o valor que o gerador calculou, com espaços e parênteses a mais (semente ${baseSeed})`, () => {
    const random = generator(baseSeed + 2);
    for (let round = 0; round < cases; round++) {
      const tree: Tree = random.pick([() => numberTree(random, 4), () => booleanTree(random, 4), () => stringTree(random, 4)])();
      const keyword = random.pick(["const", "let"]);
      const annotation = random.chance(0.4) ? `: ${tree.type === "boolean" ? "boolean" : tree.type}` : "";
      const text = `${keyword} v${annotation} = ${tree.text}`;
      const model = readScript(text, undefined);
      const report = evaluateScript(model, config(undefined, [9, 8, 7, 6]));
      const context = `semente ${baseSeed}, caso ${round}: ${JSON.stringify(text)}`;
      expect(report.checkErrors, context).toEqual([]);
      const result = report.results[0];
      expect(result?.ok, context).toBe(true);
      if (result?.ok !== true) continue;
      const got = plain(result.stored.value);
      // O número com texto exato volta como o número; o zero negativo é o zero.
      expect(got === 0 ? 0 : got, context).toEqual(tree.value === 0 ? 0 : tree.value);
      expect(typeLabel(result.stored.type), context).toBe(tree.type);

      // O valor atravessa o Worker sem mudar (RN-VAR-013).
      const back = fromWire(JSON.parse(JSON.stringify(toWire(result.stored.value))) as unknown);
      expect(plain(back), context).toEqual(got);
    }
  }, timeout);

  test(`random.int fica no intervalo e a mesma semente dá a mesma sequência (semente ${baseSeed})`, () => {
    const random = generator(baseSeed + 3);
    for (let round = 0; round < cases; round++) {
      const seed: Seed = [random.int(1, 0x7fffffff), random.int(0, 0x7fffffff), random.int(0, 0x7fffffff), random.int(0, 0x7fffffff)];
      const min = random.int(-1000, 1000);
      const max = min + random.pick([0, 1, 2, 9, 1000, 2 ** 31, 2 ** 32, 2 ** 32 + 1, 2 ** 40]);
      const first = new Random(seed);
      const second = new Random(seed);
      for (let draw = 0; draw < 4; draw++) {
        const value = first.int(min, max);
        expect(value, `semente ${baseSeed}, caso ${round}`).toBeGreaterThanOrEqual(min);
        expect(value, `semente ${baseSeed}, caso ${round}`).toBeLessThanOrEqual(max);
        expect(Number.isInteger(value)).toBe(true);
        expect(second.int(min, max)).toBe(value);
      }
      const unit = first.float();
      expect(unit).toBeGreaterThanOrEqual(0);
      expect(unit).toBeLessThan(1);
    }
  }, timeout);

  test(`marcadores montados: a conta da tela é a de quem montou o texto (semente ${baseSeed})`, () => {
    const random = generator(baseSeed + 4);
    // Cada pedaço traz quantos marcadores tem de verdade, por motor.
    const neutral = ["select ", "a", " from t ", "where ", "x = ", "'it''s ?'", '"c?"', "-- um ?\n", "/* $1 ? */", " ", "\n", "1", "'$1'", "$$ ? $1 $$", "a$1"];
    for (let round = 0; round < cases; round++) {
      const engine = random.pick([1, 2, 3] as const);
      let text = "";
      let expected = 0;
      const numbers: number[] = [];
      const length = random.int(1, 12);
      for (let index = 0; index < length; index++) {
        if (random.chance(0.3)) {
          if (engine === 1) {
            const number = random.int(1, 99);
            text += ` $${number} `;
            numbers.push(number);
          } else text += " ? ";
          expected++;
        } else {
          const piece = random.pick(neutral);
          // `$$ … $$` só é texto fechado no PostgreSQL; nos outros dois motores o `$` não fecha nada. Os pedaços vão separados por espaço, para um não mudar o outro.
          if (piece.startsWith("$$") && engine !== 1) continue;
          text += ` ${piece} `;
        }
      }
      const scan = scanMarkers(text, engine);
      expect(scan.count, `semente ${baseSeed}, caso ${round}, motor ${engine}: ${JSON.stringify(text)}`).toBe(expected);
      if (engine === 1) expect(scan.numbers, `semente ${baseSeed}, caso ${round}: ${JSON.stringify(text)}`).toEqual(numbers);
    }
  }, timeout);

  test(`troca pelos marcadores: um parâmetro por valor, o texto enviado cabe nos limites e o erro volta ao @nome (semente ${baseSeed})`, () => {
    const random = generator(baseSeed + 5);
    for (let round = 0; round < cases; round++) {
      const engine = random.pick([1, 2, 3] as const);
      const values = random.int(1, 4);
      const declarations: string[] = [];
      let command = "select ";
      const counts: number[] = [];
      for (let index = 0; index < values; index++) {
        const name = `v${index}`;
        const list = random.chance(0.4);
        const size = list ? random.int(1, 5) : 1;
        const literal = (() => {
          // Uma lista só tem itens do mesmo tipo.
          const kind = random.pick(["1", "'t'"]);
          return Array.from({ length: size }, () => (kind === "1" ? String(random.int(0, 99)) : `'${random.pick(["a", "b c", "ç"])}'`));
        })();
        declarations.push(list ? `const ${name} = [${literal.join(", ")}]` : `const ${name} = ${literal[0] ?? "1"}`);
        command += list ? `x${index} in (@${name}) and ` : `x${index} = @${name} and `;
        counts.push(size);
      }
      command += "1 = 1";
      const text = `${declarations.join("\n")}\n\n${command};`;
      const model = readScript(text, engine, { blankLines: true });
      const context = `semente ${baseSeed}, caso ${round}, motor ${engine}: ${JSON.stringify(text)}`;
      const run = new ScriptRun(model, config(engine, [5, 6, 7, 8]));
      for (const item of model.items) if (item.parsed !== null) expect(run.evaluate(item.index).ok, context).toBe(true);
      const statement = model.items.find((item) => item.kind === "statement");
      expect(statement, context).toBeDefined();
      if (statement === undefined) continue;
      const bound = run.bind(statement.index);
      expect(bound.ok, context).toBe(true);
      if (!bound.ok) continue;

      const total = counts.reduce((sum, count) => sum + count, 0);
      expect(bound.command.params, context).toHaveLength(total);
      expect(scanMarkers(bound.command.sql, engine).count, context).toBe(total);
      expect(bound.command.sql, context).not.toContain("@v");
      // Nada do valor entra no texto: só os marcadores.
      expect(bound.command.sql, context).not.toMatch(/'[a-zç]/);

      // A posição do erro do banco: cada marcador volta ao `@nome` de que veio.
      for (const replacement of bound.command.replacements) {
        const at = editorOffset(statement.start, bound.command, replacement.sentStart + 1);
        expect(at, context).toBe(statement.start + replacement.start);
      }
    }
  }, timeout);
});
