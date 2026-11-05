import { describe, expect, it } from "vitest";

import { queryValue, type VariableQueryColumn, type VariableQueryResult } from "./query-value";
import { annotationType } from "./run";
import { displayValue, type Value } from "./values";

// A forma do valor de uma variável de consulta (RN-VAR-011): o que a rota da consulta devolveu vira um valor da linguagem.
const number = (name: string, type = "int4"): VariableQueryColumn => ({ name, type, kind: "number" });
const text = (name: string): VariableQueryColumn => ({ name, type: "text", kind: "text" });
const result = (columns: VariableQueryColumn[], rows: (string | null)[][]): VariableQueryResult => ({ columns, rows, elapsedMs: 1 });
const listOf = (base: "number" | "string") => annotationType({ base, list: true, nullable: false, start: 0, end: 0 } as never);
const single = (base: "number" | "string") => annotationType({ base, list: false, nullable: false, start: 0, end: 0 } as never);

const shown = (value: Value) => displayValue(value);
const message = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as { message: string }).message;
  }
  throw new Error("esperava um erro");
};

describe("a forma do valor, sem anotação", () => {
  it("1 coluna e 1 linha é a célula", () => {
    expect(queryValue("total", result([number("count", "int8")], [["3"]]), null, 1)).toMatchObject({ kind: "number", value: 3 });
  });

  it("1 coluna e nenhuma linha é null", () => {
    expect(queryValue("total", result([number("count")], []), null, 1).kind).toBe("null");
  });

  it("1 coluna e várias linhas é a lista dos valores", () => {
    expect(shown(queryValue("ids", result([number("id")], [["1"], ["2"]]), null, 1))).toBe("[1, 2]");
  });

  it("várias colunas e 1 linha é o objeto, com os nomes das colunas como o banco os deu", () => {
    const value = queryValue("p", result([number("ID"), text("nome")], [["7", "Ana"]]), null, 2);
    expect(shown(value)).toBe("{ ID: 7, nome: 'Ana' }");
  });

  it("várias colunas e várias linhas é a lista dos objetos; o nulo da célula é null", () => {
    const value = queryValue("p", result([number("id"), text("nome")], [["1", "Ana"], ["2", null]]), null, 1);
    expect(shown(value)).toBe("[{ id: 1, nome: 'Ana' }, { id: 2, nome: null }]");
  });
});

describe("a forma do valor, com anotação", () => {
  it("a anotação de lista é sempre a lista, também com uma linha ou nenhuma", () => {
    expect(shown(queryValue("ids", result([number("id")], [["1"]]), listOf("number"), 1))).toBe("[1]");
    expect(shown(queryValue("ids", result([number("id")], []), listOf("number"), 1))).toBe("[]");
  });

  it("a anotação de um valor só recusa mais de uma linha", () => {
    expect(message(() => queryValue("ids", result([number("id")], [["1"], ["2"], ["3"]]), single("number"), 1))).toBe(
      "A consulta de ids devolveu 3 linhas, e ids é number: anote number[] para uma lista.",
    );
  });
});

describe("os valores das células, pelo kind da coluna", () => {
  it("o número guarda o texto exato que veio", () => {
    const value = queryValue("v", result([number("v", "numeric")], [["12345678901234567890.5"]]), null, 1);
    expect(value).toMatchObject({ kind: "number" });
  });

  it("o NaN e o Infinity de uma coluna de ponto flutuante são erro", () => {
    expect(message(() => queryValue("m", result([number("media", "float8")], [["NaN"]]), null, 1))).toBe("O valor NaN da coluna media não é um número do JavaScript.");
  });

  it("o booleano do PostgreSQL e o 0/1 do Informix", () => {
    expect(queryValue("b", result([{ name: "b", type: "bool", kind: "boolean" }], [["true"]]), null, 1)).toMatchObject({ kind: "boolean", value: true });
    expect(queryValue("b", result([{ name: "b", type: "BOOLEAN", kind: "boolean" }], [["0"]]), null, 3)).toMatchObject({ kind: "boolean", value: false });
  });

  it("a coluna de data é uma data de dia; a de instante, com a hora", () => {
    expect(queryValue("d", result([{ name: "d", type: "date", kind: "datetime" }], [["2026-11-05"]]), null, 1)).toMatchObject({ kind: "date", precision: "day" });
    expect(queryValue("t", result([{ name: "t", type: "timestamp", kind: "datetime" }], [["2026-11-05 10:20:30.123456"]]), null, 1)).toMatchObject({ kind: "date", precision: "instant" });
  });

  it("a hora sem data vira texto", () => {
    expect(queryValue("h", result([{ name: "h", type: "time", kind: "datetime" }], [["10:20:30"]]), null, 1)).toMatchObject({ kind: "string", value: "10:20:30" });
  });

  it("a coluna binária é erro", () => {
    expect(message(() => queryValue("f", result([{ name: "foto", type: "bytea", kind: "binary" }], [["0x00"]]), null, 1))).toBe("A coluna foto é binária, e variável não guarda binário.");
  });
});

describe("os nomes dos campos", () => {
  it("duas colunas de mesmo nome são erro", () => {
    expect(message(() => queryValue("p", result([number("id"), number("id")], [["1", "2"]]), null, 1))).toBe("A consulta de p tem duas colunas chamadas id: dê um apelido a uma delas.");
  });

  it("a coluna com um nome vedado é erro", () => {
    expect(message(() => queryValue("p", result([number("id"), text("__proto__")], [["1", "x"]]), null, 1))).toBe("A coluna __proto__ não pode ser campo de uma variável: dê outro apelido a ela.");
  });
});
