import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { statementCount } from "../sql-statements";
import { sqlLiteral } from "../table-sql";
import { scriptLiteral } from "./script-literal";
import { chars, hostileValues, randomText, seededRandom } from "./test-fixtures";

const engines: Engine[] = [1, 2, 3];
const [LF, CR, TAB] = [chars(10), chars(13), chars(9)];

/**
 * Lê um literal como o servidor o leria, só para provar que o texto montado diz o valor de volta: `'...'` com a aspa dobrada; `E'...'` (PostgreSQL) com a
 * barra invertida como escape (`\\` é uma barra); no Db2, no Informix e no PostgreSQL sem `E` a barra é um caractere comum (RN-TABELA-007); `CHR(n)` é o
 * caractere de código n; `||` junta. Qualquer outra forma é um erro, para o teste não ler o que o servidor recusaria.
 */
function decode(engine: Engine, literal: string): string {
  let rest = literal;
  let value = "";

  for (;;) {
    const chr = /^CHR\((\d+)\)/.exec(rest);
    if (chr !== null) {
      value += String.fromCharCode(Number(chr[1]));
      rest = rest.slice(chr[0].length);
    } else {
      const prefixed = rest.startsWith("E'");
      const escapes = prefixed;
      let index = prefixed ? 2 : 1;
      if (rest[index - 1] !== "'") throw new Error(`literal não começa por aspa: ${literal}`);

      for (;;) {
        const char = rest[index];
        if (char === undefined) throw new Error(`literal aberto: ${literal}`);
        if (char === "'") {
          if (rest[index + 1] !== "'") break;
          value += "'";
          index += 2;
        } else if (char === "\\" && escapes) {
          if (rest[index + 1] !== "\\") throw new Error(`escape que o servidor leria de outro jeito: ${literal}`);
          value += "\\";
          index += 2;
        } else {
          value += char;
          index++;
        }
      }
      rest = rest.slice(index + 1);
    }

    if (rest === "") return value;
    if (!rest.startsWith(" || ")) throw new Error(`depois do literal veio ${rest}`);
    rest = rest.slice(4);
  }
}

/**
 * O literal depois de passar pelo editor da aba de consulta, onde o script gerado se abre (RN-GRADE-006): o CodeMirror guarda o texto com `\n` no lugar de
 * `\r\n` e de `\r`, e é o que se executa (`state.doc.toString()`). O editor é o de verdade, do pacote que o projeto usa.
 */
const throughEditor = (literal: string) => EditorState.create({ doc: `SELECT ${literal};` }).doc.toString().slice("SELECT ".length, -1);

/** O que `scriptLiteral` recusa por regra, nos três bancos: controle que não seja \n, \r nem \t. A barra invertida não (RN-TABELA-007). */
function refused(value: string): boolean {
  return [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code < 0x20 && code !== 9 && code !== 10 && code !== 13) || code === 0x7f;
  });
}

describe("scriptLiteral: sem quebra de linha, retorno de carro nem tabulação, é o sqlLiteral", () => {
  const values = ["", "abc", "O'Brien", "a\\b", "''", "é 🙂", "12", "-1.5e3", "007", "abc'; DROP TABLE x; --", `a${chars(0)}b`, `a${chars(27)}b`, `a${chars(127)}b`, "\u2028 \u0085"];

  it.each(engines)("banco %i: o mesmo texto, ou o mesmo null, que sqlLiteral, em cada tipo de coluna", (engine) => {
    for (const value of values) {
      for (const kind of ["text", "number", "boolean", "datetime", "binary"] as const) expect(scriptLiteral(engine, value, kind), `${JSON.stringify(value)} ${kind}`).toBe(sqlLiteral(engine, value, kind));
    }
  });
});

describe("scriptLiteral: PostgreSQL e Db2 levam a quebra de linha e a tabulação dentro das aspas, e o retorno de carro por CHR(13)", () => {
  it.each([1, 2] as const)("banco %i: a quebra de linha e a tabulação vão como estão, entre as aspas", (engine) => {
    expect(scriptLiteral(engine, `a${LF}b`, "text")).toBe(`'a${LF}b'`);
    expect(scriptLiteral(engine, `a${TAB}b`, "text")).toBe(`'a${TAB}b'`);
    expect(scriptLiteral(engine, `${LF}`, "text")).toBe(`'${LF}'`);
    expect(scriptLiteral(engine, `${LF}${LF}`, "text")).toBe(`'${LF}${LF}'`);
    expect(scriptLiteral(engine, `${LF}abc${LF}`, "text")).toBe(`'${LF}abc${LF}'`);
    expect(scriptLiteral(engine, `${TAB}${LF}${TAB}`, "text")).toBe(`'${TAB}${LF}${TAB}'`);
  });

  it.each([1, 2] as const)("banco %i: o retorno de carro sai como ' || CHR(13) || ' (o editor da aba de consulta troca \\r e \\r\\n por \\n), sem pedaço vazio solto", (engine) => {
    expect(scriptLiteral(engine, `a${CR}b`, "text")).toBe("'a' || CHR(13) || 'b'");
    expect(scriptLiteral(engine, `a${CR}${LF}b`, "text")).toBe(`'a' || CHR(13) || '${LF}b'`);
    expect(scriptLiteral(engine, `a${LF}${CR}b${TAB}`, "text")).toBe(`'a${LF}' || CHR(13) || 'b${TAB}'`);
    expect(scriptLiteral(engine, `${CR}a`, "text")).toBe("CHR(13) || 'a'");
    expect(scriptLiteral(engine, `a${CR}`, "text")).toBe("'a' || CHR(13)");
    expect(scriptLiteral(engine, `a${CR}${CR}b`, "text")).toBe("'a' || CHR(13) || CHR(13) || 'b'");
    expect(scriptLiteral(engine, CR, "text")).toBe("CHR(13)");
    expect(scriptLiteral(engine, `${CR}${LF}`, "text")).toBe(`CHR(13) || '${LF}'`);
    expect(scriptLiteral(engine, `${LF}${CR}`, "text")).toBe(`'${LF}' || CHR(13)`);
  });

  it.each([1, 2] as const)("banco %i: o script gerado não tem retorno de carro algum, e passa pelo editor da aba de consulta (CodeMirror) sem mudar", (engine) => {
    for (const value of [`a${CR}b`, `a${CR}${LF}b`, `fim${CR}`, `${CR}${CR}`, `x${CR}${LF}${CR}${LF}y`, `${LF}${CR}${TAB}`, `O'${CR}\\${LF}'`]) {
      const literal = scriptLiteral(engine, value, "text") ?? "";
      const script = `SELECT ${literal};`;

      expect(literal, JSON.stringify(value)).not.toContain(CR);
      expect(EditorState.create({ doc: script }).doc.toString(), JSON.stringify(value)).toBe(script);
      expect(decode(engine, throughEditor(literal)), JSON.stringify(value)).toBe(value);
    }
  });

  it.each([1, 2] as const)("banco %i: a aspa dobrada do sqlLiteral continua valendo", (engine) => {
    expect(scriptLiteral(engine, `O'Brien${LF}x'`, "text")).toBe(`'O''Brien${LF}x'''`);
  });

  it("PostgreSQL: com barra invertida o literal é E'...' com a barra dobrada, também com a quebra de linha, nas partes antes e depois dela", () => {
    expect(scriptLiteral(1, `a\\b${LF}c`, "text")).toBe(`E'a\\\\b${LF}c'`);
    expect(scriptLiteral(1, `a${LF}b\\c`, "text")).toBe(`E'a${LF}b\\\\c'`);
    expect(scriptLiteral(1, `a${LF}b${TAB}c\\d${CR}e`, "text")).toBe(`E'a${LF}b${TAB}c\\\\d' || CHR(13) || 'e'`);
    expect(scriptLiteral(1, `a${CR}b\\${LF}`, "text")).toBe(`'a' || CHR(13) || E'b\\\\${LF}'`);
    expect(scriptLiteral(1, `\\${LF}`, "text")).toBe(`E'\\\\${LF}'`);
  });

  it("Db2: a barra invertida vai como está, em qualquer parte, e o literal não ganha o E do PostgreSQL (RN-TABELA-007)", () => {
    expect(scriptLiteral(2, `a\\b${LF}c`, "text")).toBe(`'a\\b${LF}c'`);
    expect(scriptLiteral(2, `a${LF}b\\c`, "text")).toBe(`'a${LF}b\\c'`);
    expect(scriptLiteral(2, `\\${LF}`, "text")).toBe(`'\\${LF}'`);
    expect(scriptLiteral(2, `O'Brien\\${LF}`, "text")).toBe(`'O''Brien\\${LF}'`);
  });
});

describe("scriptLiteral: o Informix parte o texto nas quebras e as une por || com CHR", () => {
  it("quebra de linha, retorno de carro e tabulação viram CHR(10), CHR(13) e CHR(9)", () => {
    expect(scriptLiteral(3, `a${LF}b`, "text")).toBe("'a' || CHR(10) || 'b'");
    expect(scriptLiteral(3, `a${CR}b`, "text")).toBe("'a' || CHR(13) || 'b'");
    expect(scriptLiteral(3, `a${TAB}b`, "text")).toBe("'a' || CHR(9) || 'b'");
    expect(scriptLiteral(3, `a${CR}${LF}b`, "text")).toBe("'a' || CHR(13) || CHR(10) || 'b'");
    expect(scriptLiteral(3, `um${LF}dois${LF}${LF}três`, "text")).toBe("'um' || CHR(10) || 'dois' || CHR(10) || CHR(10) || 'três'");
  });

  it("no começo, no fim ou sozinha, a quebra não deixa texto vazio (`''` poderia valer nulo na concatenação)", () => {
    expect(scriptLiteral(3, `${LF}a`, "text")).toBe("CHR(10) || 'a'");
    expect(scriptLiteral(3, `a${LF}`, "text")).toBe("'a' || CHR(10)");
    expect(scriptLiteral(3, `${LF}`, "text")).toBe("CHR(10)");
    expect(scriptLiteral(3, `${TAB}${LF}${CR}`, "text")).toBe("CHR(9) || CHR(10) || CHR(13)");
    expect(scriptLiteral(3, `${LF}a${LF}`, "text")).toBe("CHR(10) || 'a' || CHR(10)");
  });

  it("a aspa dobrada do sqlLiteral vale em cada parte, e a barra invertida vai como está (RN-TABELA-007)", () => {
    expect(scriptLiteral(3, `O'Brien${LF}x`, "text")).toBe("'O''Brien' || CHR(10) || 'x'");
    expect(scriptLiteral(3, `a\\b${LF}c\\`, "text")).toBe("'a\\b' || CHR(10) || 'c\\'");
  });

  it("nenhuma parte é vazia, nenhum caractere de quebra sobra dentro das aspas, e as partes são as que o sqlLiteral daria", () => {
    for (const value of [`a${LF}b`, `${LF}${LF}`, `x${CR}${LF}y${TAB}`, `'${LF}'`, `\\${LF}\\`]) {
      const literal = scriptLiteral(3, value, "text") ?? "";

      expect(literal, JSON.stringify(value)).not.toMatch(/\n|\r|\t/);
      expect(literal).not.toMatch(/(^|\|\| )''( \|\||$)/);
    }
    expect(scriptLiteral(3, `ab${LF}cd`, "text")).toBe(`${sqlLiteral(3, "ab", "text")} || CHR(10) || ${sqlLiteral(3, "cd", "text")}`);
  });
});

describe("scriptLiteral: o resto continua recusado", () => {
  const others = [chars(0), chars(1), chars(7), chars(8), chars(11), chars(12), chars(27), chars(31), chars(127)];

  it.each(engines)("banco %i: outro caractere de controle (o nulo inclusive) deixa o valor sem literal, ainda que haja quebra de linha antes, depois ou entre as partes", (engine) => {
    for (const other of others) {
      for (const value of [`a${other}b`, `a${LF}b${other}c`, `${other}${LF}`, `${LF}${other}`, `a${CR}${LF}${other}${TAB}`, `x${TAB}${other}`]) expect(scriptLiteral(engine, value, "text"), JSON.stringify(value)).toBeNull();
    }
  });

  it.each(engines)("banco %i: o NEL (U+0085, de C1) e o separador de linha do Unicode (U+2028) não são controles do ASCII: o valor gera literal", (engine) => {
    expect(scriptLiteral(engine, `a\u0085${LF}b\u2028c`, "text")).not.toBeNull();
  });
});

describe("scriptLiteral: o tipo da coluna não faz do texto com quebra um número", () => {
  it.each(engines)("banco %i: `1<quebra>2` numa coluna numérica é texto entre aspas, e não a concatenação de dois números", (engine) => {
    const literal = scriptLiteral(engine, `1${LF}2`, "number") ?? "";

    expect(decode(engine, literal)).toBe(`1${LF}2`);
    expect(literal).toContain("'");
  });

  it.each(engines)("banco %i: o número simples segue sem aspas", (engine) => {
    expect(scriptLiteral(engine, "12", "number")).toBe("12");
  });
});

describe("scriptLiteral: o literal diz o valor, e um valor é um comando só", () => {
  it.each(engines)("banco %i: os valores hostis e os de várias linhas voltam iguais pela leitura do literal, ou são recusados pela regra", (engine) => {
    const values = [...hostileValues, `${LF}`, `${CR}${LF}`, `${TAB}${TAB}`, `a${LF}b${LF}`, `'${LF}'`, `\\${LF}\\`, `'; DROP TABLE x; --${LF}'; DELETE FROM t; --`, `${LF}-- comentário${LF}`, `{${LF}}`, `/*${LF}*/`, `$$${LF}$$`];
    let decoded = 0;

    for (const value of values) {
      const literal = scriptLiteral(engine, value, "text");
      if (refused(value)) {
        expect(literal, JSON.stringify(value)).toBeNull();
        continue;
      }
      expect(literal, JSON.stringify(value)).not.toBeNull();
      expect(decode(engine, literal ?? ""), JSON.stringify(value)).toBe(value);
      expect(decode(engine, throughEditor(literal ?? "")), `${JSON.stringify(value)} pelo editor`).toBe(value);
      expect(statementCount(`SELECT ${literal};`, engine), JSON.stringify(value)).toBe(1);
      decoded++;
    }
    expect(decoded).toBeGreaterThan(15);
  });

  it.each(engines)("banco %i: o sorteio de semente fixa nunca quebra a leitura do literal nem a contagem de comandos", (engine) => {
    const random = seededRandom(1_000 + engine);
    let decoded = 0;

    for (let round = 0; round < 800; round++) {
      const value = randomText(random, 10);
      const literal = scriptLiteral(engine, value, "text");
      if (refused(value)) {
        expect(literal, JSON.stringify(value)).toBeNull();
        continue;
      }

      expect(decode(engine, literal ?? ""), JSON.stringify(value)).toBe(value);
      expect(decode(engine, throughEditor(literal ?? "")), `${JSON.stringify(value)} pelo editor`).toBe(value);
      expect(statementCount(`SELECT ${literal};`, engine), JSON.stringify({ value, literal })).toBe(1);
      expect(statementCount(`SELECT 1 WHERE a = ${literal} AND b = ${literal};`, engine), JSON.stringify({ value, literal })).toBe(1);
      decoded++;
    }
    expect(decoded).toBeGreaterThan(400);
  });
});
