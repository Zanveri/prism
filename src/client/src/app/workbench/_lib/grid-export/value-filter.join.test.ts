import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { isInsideComment, statementCount } from "../sql-statements";
import { filterParts } from "../table-sql";
import { chars, column, hostileValues, randomText, seededRandom } from "./test-fixtures";
import { customCondition, customFilterOptions, distinctValues, joinFilter, valuesCondition } from "./value-filter";

// RN-GRADE-013: o "Personalizado", o "Filtrar por valor…" e a junção da condição ao campo de filtro.
const engines: Engine[] = [1, 2, 3];

describe("customFilterOptions e customCondition: o “Personalizado”", () => {
  it("as quatro comparações, com o lugar do valor no rótulo; maior e menor não valem para o lógico no Informix", () => {
    expect(customFilterOptions(1, column("code")).map((option) => [option.id, option.label, option.reason])).toEqual([
      ["eq", `"code" = …`, null],
      ["ne", `"code" <> …`, null],
      ["gt", `"code" > …`, null],
      ["lt", `"code" < …`, null],
    ]);
    expect(customFilterOptions(3, column("ativo", "boolean")).map((option) => option.reason)).toEqual([null, null, "o Informix não ordena valores lógicos", "o Informix não ordena valores lógicos"]);
    // A coluna binária também tem o personalizado: o valor que a pessoa escreve vira literal.
    expect(customFilterOptions(1, column("foto", "binary")).every((option) => option.reason === null)).toBe(true);
  });

  it("o valor escrito vira literal do banco (RN-TABELA-007), e nunca SQL", () => {
    expect(customCondition(1, column("code"), "eq", "11.901")).toEqual({ condition: `"code" = '11.901'` });
    expect(customCondition(1, column("qtd", "number"), "gt", "10")).toEqual({ condition: `"qtd" > 10` });
    expect(customCondition(1, column("qtd", "number"), "lt", "1 OR 1=1")).toEqual({ condition: `"qtd" < '1 OR 1=1'` });
    expect(customCondition(1, column("nome"), "ne", "x'; DROP TABLE t; --")).toEqual({ condition: `"nome" <> 'x''; DROP TABLE t; --'` });
    expect(customCondition(3, column("ativo", "boolean"), "eq", "true")).toEqual({ condition: `"ativo" = 't'` });
  });

  it("o valor que não vira literal é recusado com o motivo", () => {
    expect(customCondition(1, column("nome"), "eq", "a\tb")).toEqual({ problem: "controls" });
    expect(customCondition(3, column("ativo", "boolean"), "eq", "sim")).toEqual({ problem: "informix" });
  });

  it("cada condição é um comando só, nos três bancos, qualquer que seja o valor", () => {
    for (const engine of engines) {
      for (const value of [...hostileValues, "'; DROP TABLE x; --", "*/", "{", "$$"]) {
        const result = customCondition(engine, column('c"; --'), "eq", value);
        if ("condition" in result) expect(statementCount(`SELECT * FROM t WHERE ${result.condition}`, engine), JSON.stringify(value)).toBe(1);
      }
    }
  });
});

describe("distinctValues e valuesCondition: o “Filtrar por valor…”", () => {
  const rows = [["a"], ["b"], ["a"], [null], ["c"], ["b"], ["a"], [null]];

  it("os valores distintos das linhas carregadas, com a contagem, do mais frequente ao menos (empate: o que aparece primeiro)", () => {
    expect(distinctValues(1, column("c"), rows, 0, new Map())).toEqual([
      { value: "a", count: 3, usable: true },
      { value: "b", count: 2, usable: true },
      { value: null, count: 2, usable: true },
      { value: "c", count: 1, usable: true },
    ]);
  });

  it("a célula cortada conta à parte e não entra no filtro; o valor com controle também não", () => {
    const values = distinctValues(1, column("c"), [["abc"], ["abc"], ["a\nb"]], 0, new Map([[1, new Set([0])]]));

    expect(values).toEqual([
      { value: "abc", count: 1, usable: true },
      { value: "abc", count: 1, usable: false },
      { value: "a\nb", count: 1, usable: false },
    ]);
  });

  it("um valor: `=`; vários: `IN (…)`; o nulo: `IS NULL`, junto por OR; nada marcado: nada", () => {
    expect(valuesCondition(1, column("code"), ["11.901"])).toBe(`"code" = '11.901'`);
    expect(valuesCondition(1, column("code"), ["a", "b", "O'Brien"])).toBe(`"code" IN ('a', 'b', 'O''Brien')`);
    expect(valuesCondition(1, column("qtd", "number"), ["1", "2"])).toBe(`"qtd" IN (1, 2)`);
    expect(valuesCondition(1, column("code"), [null])).toBe(`"code" IS NULL`);
    expect(valuesCondition(1, column("code"), ["a", null])).toBe(`"code" = 'a' OR "code" IS NULL`);
    expect(valuesCondition(1, column("code"), ["a", "b", null])).toBe(`"code" IN ('a', 'b') OR "code" IS NULL`);
    expect(valuesCondition(1, column("code"), [])).toBeNull();
  });

  it("a condição dos valores é um comando só, também junta ao que estava no campo", () => {
    const fits = (value: string) => Array.from(value).every((char) => (char.codePointAt(0) ?? 0) >= 0x20 && char !== chars(0x7f));
    for (const engine of engines) {
      const condition = valuesCondition(engine, column('n"; --'), [...hostileValues.filter(fits), "'; DROP TABLE x; --", null]) ?? "";
      const joined = joinFilter(engine, "x > 1 ORDER BY 1", condition);
      expect("text" in joined && statementCount(`SELECT * FROM t WHERE ${joined.text}`, engine), String(engine)).toBe(1);
    }
  });
});

describe("filterParts: a condição e o que vem depois dela, no texto do campo", () => {
  it("a condição vai até o último pedaço de código antes da ordem; o resto (a ordem, o `;`, o comentário do fim) vem aparado", () => {
    expect(filterParts("a = 1 ORDER BY b")).toEqual({ condition: "a = 1", tail: "ORDER BY b" });
    expect(filterParts("a = 1 /* x */ ORDER BY b;")).toEqual({ condition: "a = 1", tail: "/* x */ ORDER BY b;" });
    expect(filterParts("a = 1 -- nota")).toEqual({ condition: "a = 1", tail: "-- nota" });
    expect(filterParts("ORDER BY b")).toEqual({ condition: "", tail: "ORDER BY b" });
    expect(filterParts("")).toEqual({ condition: "", tail: "" });
  });
});

describe("joinFilter: a condição do Filtrar entra no campo, com a ordem e o comentário do fim no lugar", () => {
  it("campo vazio: só a condição; com condição: `(existente) AND (nova)`", () => {
    expect(joinFilter(1, "", `"a" = 1`)).toEqual({ text: `"a" = 1` });
    expect(joinFilter(1, "  ", `"a" = 1`)).toEqual({ text: `"a" = 1` });
    expect(joinFilter(1, "b > 2", `"a" = 1`)).toEqual({ text: `(b > 2) AND ("a" = 1)` });
  });

  it("a ordem do campo fica depois da condição, como estava (RN-TABELA-010)", () => {
    expect(joinFilter(1, `ORDER BY "id" DESC`, `"a" = 1`)).toEqual({ text: `"a" = 1 ORDER BY "id" DESC` });
    expect(joinFilter(1, `b > 2 order by id`, `"a" = 1`)).toEqual({ text: `(b > 2) AND ("a" = 1) order by id` });
    // A ordem de uma subconsulta não é a de fora.
    expect(joinFilter(1, `id IN (SELECT id FROM t ORDER BY 1)`, `"a" = 1`)).toEqual({ text: `(id IN (SELECT id FROM t ORDER BY 1)) AND ("a" = 1)` });
  });

  it("o comentário e o `;` do fim ficam no fim, e a condição nova não cai dentro deles", () => {
    expect(joinFilter(1, "b > 2 -- só ativos", `"a" = 1`)).toEqual({ text: `(b > 2) AND ("a" = 1) -- só ativos` });
    expect(joinFilter(1, "b > 2 /* nota */ ORDER BY id", `"a" = 1`)).toEqual({ text: `(b > 2) AND ("a" = 1) /* nota */ ORDER BY id` });
    expect(joinFilter(1, "b > 2;", `"a" = 1`)).toEqual({ text: `(b > 2) AND ("a" = 1) ;` });
    expect(joinFilter(3, "b > 2 { nota }", `"a" = 1`)).toEqual({ text: `(b > 2) AND ("a" = 1) { nota }` });
  });

  it("o campo fica numa linha só: nenhuma quebra de linha entra", () => {
    for (const field of ["b -- x", "b /* x */", "b /* x */ ORDER BY c", "-- só comentário", "b = '--'"]) {
      const joined = joinFilter(1, field, `"a" = 1`);
      expect("text" in joined && joined.text.includes("\n"), field).toBe(false);
    }
  });

  it("não junta com aspas, comentário de bloco, `{` ou `$tag$` abertos (a condição cairia dentro deles)", () => {
    expect(joinFilter(1, "b = 'abc", `"a" = 1`)).toEqual({ problem: "open" });
    expect(joinFilter(1, "b = 'ab''", `"a" = 1`)).toEqual({ problem: "open" });
    expect(joinFilter(1, `"b`, `"a" = 1`)).toEqual({ problem: "open" });
    expect(joinFilter(1, "b = 1 /* nota", `"a" = 1`)).toEqual({ problem: "open" });
    expect(joinFilter(3, "b = 1 { nota", `"a" = 1`)).toEqual({ problem: "open" });
    expect(joinFilter(1, "b = $x$abc", `"a" = 1`)).toEqual({ problem: "open" });
    // No Db2 o `$` é um caractere qualquer, e o `{` não abre comentário fora do Informix.
    expect(joinFilter(2, "b = $x$abc", `"a" = 1`)).toEqual({ text: `(b = $x$abc) AND ("a" = 1)` });
  });

  it("não junta com mais de um comando no campo", () => {
    expect(joinFilter(1, "b = 1; DROP TABLE t", `"a" = 1`)).toEqual({ problem: "several" });
  });

  it("o que junta é um comando só e não termina dentro de comentário, nos três bancos (sorteio de semente fixa)", () => {
    for (const engine of engines) {
      const random = seededRandom(31 + engine);
      let joinedCount = 0;
      for (let round = 0; round < 800; round++) {
        const field = randomText(random);
        const joined = joinFilter(engine, field, `"a" = 1`);
        if (!("text" in joined)) continue;
        joinedCount++;
        expect(statementCount(`SELECT * FROM t\nWHERE ${joined.text}`, engine), `${engine} ${JSON.stringify(field)}`).toBeLessThanOrEqual(1);
        // A condição nova (a última que entrou) não cai dentro de texto nem de comentário do que estava no campo.
        const at = joined.text.lastIndexOf(`"a" = 1`);
        expect(at >= 0 && !isInsideComment(joined.text, at, engine), `${engine} ${JSON.stringify(field)}`).toBe(true);
      }
      expect(joinedCount).toBeGreaterThan(100);
    }
  });
});
