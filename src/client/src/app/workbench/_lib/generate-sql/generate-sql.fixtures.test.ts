import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { binaryLiteral } from "../grid-export/script-literal";
import type { QueryColumn } from "../query.schema";
import { generateSql, type RowSqlItem, type SqlColumn, type SqlKey, type SqlOptions, type SqlPlan, type SqlRow } from "./generate-sql";

/**
 * RN-EXPORT-024: as fixtures de ouro do "Gerar SQL" (`generate-sql.json`, só da tela: a API não gera estes comandos) e a do literal do binário
 * (`sql-binary.json`, que a API também lê), em `src/test-fixtures/export/`, pelo caminho a partir da raiz do repositório. Os casos são escritos à mão e
 * conferidos por inteiro: mudar uma regra é mudar a fixture, nunca regerá-la a partir do código.
 */
const repositoryRoot = new URL("../../../../../../../", import.meta.url);
const fixtures = new URL("src/test-fixtures/export/", repositoryRoot);

type FixtureText = string | null | { codePoints: number[] };

/** Monta o texto da fixture ponto de código por ponto de código: o par solto vira um `char` só. */
function text(value: FixtureText): string | null {
  if (value === null || typeof value === "string") return value;
  return value.codePoints.map((code) => (code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code))).join("");
}

const engines: Record<string, Engine> = { postgresql: 1, db2: 2, informix: 3 };

type FixtureRow = { number: number; values: FixtureText[]; read?: FixtureText[]; changed?: number[]; cut?: number[]; generated?: number[] };

type GenerateCase = {
  name: string;
  item: RowSqlItem;
  engine: string;
  table: { schema: string; name: string } | null;
  columns: { name: string; type: string; kind: QueryColumn["kind"]; generated: SqlColumn["generated"] }[];
  key: string[];
  options: SqlOptions;
  rows: FixtureRow[];
  expected: FixtureText[];
  skipped: number;
};

function casesOf<T>(file: string): T[] {
  return (JSON.parse(readFileSync(new URL(file, fixtures), "utf8")) as { cases: T[] }).cases;
}

/** O plano do caso: as colunas na ordem do resultado (a posição é a do resultado) e a chave pelos nomes. */
function planOf(test: GenerateCase): SqlPlan {
  const columns: SqlColumn[] = test.columns.map((column, at) => ({ at, ...column }));
  const key: SqlKey = test.key.length === 0 ? { kind: "none" } : { kind: "complete", columns: test.key.map((name) => columns.findIndex((column) => column.name === name)) };
  return { engine: engines[test.engine], table: test.table, kind: test.table === null ? "unknown" : "table", unknownReason: test.table === null ? "num resultado de junção só se alteram células" : null, columns, key };
}

function rowOf(row: FixtureRow): SqlRow {
  const values = row.values.map(text);
  return { number: row.number, values, read: row.read === undefined ? values : row.read.map(text), changed: row.changed ?? [], cut: row.cut ?? [], generated: row.generated ?? [] };
}

/** Os pontos de código, para a diferença de um caractere invisível aparecer na falha. */
const show = (value: string | null) => (value === null ? "null" : `${JSON.stringify(value)} [${Array.from(value, (char) => (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")).join(" ")}]`);

describe("as fixtures de ouro do Gerar SQL (RN-GRADE-019 e RN-EXPORT-024)", () => {
  it("cada item escreve o texto da fixture, com as linhas que ficaram de fora", () => {
    const cases = casesOf<GenerateCase>("generate-sql.json");
    const failures = cases.flatMap((test) => {
      const generated = generateSql(test.item, planOf(test), test.rows.map(rowOf), test.options);
      const expected = test.expected.map(text).join("\n");
      const problems: string[] = [];
      if (generated.text !== expected) problems.push(`${test.name}:\nesperado ${show(expected)}\nveio     ${show(generated.text)}`);
      if (generated.skipped !== test.skipped) problems.push(`${test.name}: esperadas ${test.skipped} linhas de fora, vieram ${generated.skipped}`);
      if (generated.rows !== test.rows.length) problems.push(`${test.name}: ${generated.rows} linhas contadas`);
      return problems;
    });

    expect(cases.length).toBeGreaterThan(20);
    expect(failures).toEqual([]);
  });

  it("os casos cobrem os cinco itens, os três bancos, o compacto e o não compacto, com e sem chave, e as linhas de fora", () => {
    const cases = casesOf<GenerateCase>("generate-sql.json");

    expect(new Set(cases.map((test) => test.item))).toEqual(new Set(["selectEquals", "selectIn", "insert", "update", "delete"]));
    expect(new Set(cases.map((test) => test.engine))).toEqual(new Set(["postgresql", "db2", "informix"]));
    expect(new Set(cases.map((test) => test.options.compact))).toEqual(new Set([true, false]));
    expect(new Set(cases.map((test) => test.options.qualified))).toEqual(new Set([true, false]));
    expect(cases.some((test) => test.key.length === 0 && test.table !== null)).toBe(true);
    expect(cases.some((test) => test.table === null)).toBe(true);
    expect(cases.some((test) => test.skipped > 0)).toBe(true);
  });

  it("o literal do binário é o da fixture que a API também lê (sql-binary.json)", () => {
    const cases = casesOf<{ name: string; engine: string; type: string; bytes: string; expected: string | null }>("sql-binary.json");
    const failures = cases.flatMap((test) => {
      const actual = binaryLiteral(engines[test.engine], test.bytes, test.type);
      return actual === test.expected ? [] : [`${test.name}: esperado ${show(test.expected)}, veio ${show(actual)}`];
    });

    expect(cases.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
});
