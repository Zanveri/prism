import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { csvFieldOf } from "../csv";
import type { QueryColumn } from "../query.schema";
import { sqlLiteral } from "../table-sql";
import { scriptLiteral } from "./script-literal";
import { column, sliceOf } from "./test-fixtures";
import { escapeHtml, escapeXmlAttribute, escapeXmlText, isHtmlChar, isXmlChar, stripUnaccepted } from "./text-escape";
import { toDelimited, type Delimiter } from "./to-delimited";
import { jsonKeys, jsonValue } from "./to-json";
import { markdownCell } from "./to-markdown";
import { sheetNameOf, spreadsheetNumber, withinCell, xlsxText } from "./to-xlsx";

/**
 * RN-EXPORT-024: as fixtures de ouro que a tela e a API dividem, em `src/test-fixtures/export/` (fora das pastas das duas), lidas pelo caminho a partir da
 * raiz do repositório. Os casos são escritos à mão e conferidos por inteiro, aqui e no `ExportFixturesTests` da API: mudar uma regra é mudar a fixture, e os
 * dois lados falham até seguirem a regra nova. As fixtures que só a API lê (o TXT, o PHP, a data em ISO 8601, o "Em todos os textos" do CSV, o literal do
 * binário, o `INSERT` de várias linhas, o nome do XML e o DbUnit) ficam para quando a tela escrever essas regras.
 */
const repositoryRoot = new URL("../../../../../../../", import.meta.url);
const fixtures = new URL("src/test-fixtures/export/", repositoryRoot);

/** Texto, nulo, ou os pontos de código (o par substituto solto, que o JSON não guarda de um jeito que os dois lados leiam). */
type FixtureText = string | null | { codePoints: number[] };

type Case = { name: string } & Record<string, unknown>;

function casesOf(file: string): Case[] {
  const fixture = JSON.parse(readFileSync(new URL(file, fixtures), "utf8")) as { cases: Case[] };
  return fixture.cases;
}

/** Monta o texto da fixture ponto de código por ponto de código: o par solto vira um `char` só, como no C#. */
function text(value: unknown): string | null {
  const written = value as FixtureText;
  if (written === null || typeof written === "string") return written;
  return written.codePoints.map((code) => (code >= 0xd800 && code <= 0xdfff ? String.fromCharCode(code) : String.fromCodePoint(code))).join("");
}

const required = (value: unknown) => {
  const result = text(value);
  if (result === null) throw new TypeError("A fixture tem nulo onde se espera texto.");
  return result;
};

/** Os pontos de código, para a diferença de um caractere invisível aparecer na falha. */
const show = (value: string | null) => (value === null ? "null" : `${JSON.stringify(value)} [${Array.from(value, (char) => (char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")).join(" ")}]`);

/** Confere cada caso e junta as diferenças numa lista só, com o nome de cada um: a fixture inteira é a regra. */
function assertAll(file: string, check: (test: Case) => { actual: string | null; expected: string | null }) {
  const cases = casesOf(file);
  const failures = cases.flatMap((test) => {
    const { actual, expected } = check(test);
    return actual === expected ? [] : [`${test.name}: esperado ${show(expected)}, veio ${show(actual)}`];
  });

  expect(cases.length).toBeGreaterThan(0);
  expect(failures).toEqual([]);
}

const engines: Record<string, Engine> = { postgresql: 1, db2: 2, informix: 3 };

describe("as fixtures de ouro da exportação (RN-EXPORT-024)", () => {
  it("o campo do CSV é o da fixture: o toDelimited com as opções, e o csvFieldOf com as do Exportar CSV", () => {
    assertAll("csv-field.json", (test) => {
      const options = test.options as { delimiter: Delimiter; quoting: "auto" | "all"; formulaGuard: boolean; nullText: string };
      const quoting = options.quoting === "all" ? "always" : "auto";
      const value = text(test.value);
      const slice = sliceOf([column("c", test.kind as QueryColumn["kind"])], [[value]]);
      const line = toDelimited(slice, { delimiter: options.delimiter, header: false, rowNumber: false, quoting, nullText: options.nullText, formulaGuard: options.formulaGuard, bom: false, lineBreak: "\n" });
      const field = line.slice(0, -1);

      // O "Exportar CSV" dos Registros é o caso dos padrões: o mesmo campo pelo outro caminho da tela.
      const defaults = options.delimiter === ";" && quoting === "auto" && options.formulaGuard && options.nullText === "";
      const actual = defaults && csvFieldOf(value) !== field ? `toDelimited ${field} e csvFieldOf ${csvFieldOf(value)}` : field;
      return { actual, expected: text(test.expected) };
    });
  });

  it("o texto do HTML e os caracteres tirados são os da fixture", () => {
    assertAll("html-text.json", (test) => {
      const clean = stripUnaccepted(required(test.value), isHtmlChar);
      return { actual: `${escapeHtml(clean.text)}|${clean.removed}`, expected: `${text(test.expected)}|${String(test.removed)}` };
    });
  });

  it("a célula do Markdown é a da fixture", () => {
    assertAll("markdown-cell.json", (test) => ({ actual: markdownCell(required(test.value)), expected: text(test.expected) }));
  });

  it("o valor do JSON é o da fixture", () => {
    assertAll("json-value.json", (test) => ({ actual: jsonValue(test.kind as string, text(test.value), false), expected: text(test.expected) }));
  });

  it("as chaves do JSON são as da fixture", () => {
    assertAll("json-keys.json", (test) => ({ actual: jsonKeys(test.names as string[]).join("|"), expected: (test.expected as string[]).join("|") }));
  });

  it("o literal do SQL, de uma linha e de script, é o da fixture", () => {
    assertAll("sql-literal.json", (test) => {
      const literal = test.function === "sqlLiteral" ? sqlLiteral : test.function === "scriptLiteral" ? scriptLiteral : null;
      if (literal === null) throw new TypeError(`A função ${String(test.function)} não existe.`);
      return { actual: literal(engines[test.engine as string], required(test.value), test.kind as QueryColumn["kind"]), expected: text(test.expected) };
    });
  });

  it("o texto e o atributo do XML e os caracteres tirados são os da fixture", () => {
    assertAll("xml-text.json", (test) => {
      const clean = stripUnaccepted(required(test.value), isXmlChar);
      const escaped = test.kind === "attribute" ? escapeXmlAttribute(clean.text) : escapeXmlText(clean.text);
      return { actual: `${escaped}|${clean.removed}`, expected: `${text(test.expected)}|${String(test.removed)}` };
    });
  });

  it("o texto da planilha é o da fixture", () => {
    assertAll("xlsx-text.json", (test) => ({ actual: xlsxText(required(test.value)), expected: text(test.expected) }));
  });

  it("o número da planilha é o da fixture", () => {
    assertAll("xlsx-number.json", (test) => ({ actual: spreadsheetNumber(required(test.value)), expected: text(test.expected) }));
  });

  it("o nome da planilha é o da fixture", () => {
    assertAll("xlsx-sheet-name.json", (test) => ({ actual: sheetNameOf(required(test.value)), expected: text(test.expected) }));
  });

  it("o corte no limite da célula é o da fixture", () => {
    assertAll("xlsx-cell.json", (test) => {
      const fill = "a".repeat(test.fill as number);
      const value = fill + required(test.tail);
      const kept = withinCell(value);
      // Os 32 mil "a" iguais não dizem nada na falha: ela mostra só o que vem depois deles.
      return { actual: `${kept.startsWith(fill) ? kept.slice(fill.length) : kept}|${String(kept.length < value.length)}`, expected: `${required(test.expectedTail)}|${String(test.cut)}` };
    });
  });
});
