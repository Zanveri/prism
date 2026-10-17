import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui/engine-tag";

import { csvFieldOf } from "../csv";
import { defaultOptions, type FormatOptions } from "../data-export/export-options";
import type { QueryColumn } from "../query.schema";
import { sqlLiteral } from "../table-sql";
import type { DocumentColumn, DocumentFormat, DocumentRow } from "./document";
import { writeDocument } from "./documents";
import { scriptLiteral } from "./script-literal";
import { column, sliceOf } from "./test-fixtures";
import { escapeHtml, escapeXmlAttribute, escapeXmlText, isHtmlChar, isXmlChar, stripUnaccepted } from "./text-escape";
import { csvField, type CsvQuoting } from "./to-csv";
import { toDelimited, type Delimiter } from "./to-delimited";
import { isoDateTime, jsonKeys, jsonValue } from "./to-json";
import { markdownCell } from "./to-markdown";
import { phpString, phpVariable } from "./to-source-code";
import { binaryLiteral } from "./to-sql";
import { sheetNameOf, spreadsheetNumber, withinCell, xlsxText } from "./to-xlsx";
import { upperInvariant, xmlName } from "./xml-name";

/**
 * RN-EXPORT-024: as fixtures de ouro que a tela e a API dividem, em `src/test-fixtures/export/` (fora das pastas das duas), lidas pelo caminho a partir da
 * raiz do repositório. Os casos são escritos à mão e conferidos por inteiro, aqui e no `ExportFixturesTests` da API: mudar uma regra é mudar a fixture, e os
 * dois lados falham até seguirem a regra nova. Desde a seção 37 a tela escreve os nove formatos de texto (o "Copiar como", RN-GRADE-016), e lê também as
 * que eram só da API (o TXT, o PHP, a data em ISO 8601, o "Em todos os textos" do CSV, o literal do binário, o `INSERT` de várias linhas, o nome do XML e o
 * DbUnit) e a do documento inteiro de cada formato (`document.json`). As que só a tela lê (as linhas da grade com a célula cortada, a gerada pelo banco e a
 * linha nova) estão em `copy-as.json`.
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

/** O valor de uma célula da fixture como a grade o escreve: o binário (`{ bytes: "HEX" }`) como `0x` e os dígitos, o resto como `text`. */
function cellOf(value: unknown): string | null {
  if (typeof value === "object" && value !== null && "bytes" in value) return `0x${String(value.bytes)}`;
  return text(value);
}

/**
 * As opções do formato como a tela as guarda, a partir das da rota (as que a tela manda, `requestOptions`): os números viram o texto do campo, o esquema
 * nulo vira vazio, e o que a fixture não diz é o padrão.
 */
function optionsOf(format: DocumentFormat, request: Record<string, unknown>): FormatOptions {
  const options = defaultOptions({ schema: "", table: "" });
  const given = Object.fromEntries(Object.entries(request).map(([key, value]) => [key, typeof value === "number" ? String(value) : (value ?? "")]));
  return { ...options, [format]: { ...options[format], ...given } };
}

/** O documento da fixture escrito pela tela: as linhas com o número da posição, sem célula cortada nem gerada. */
function documentOf(format: DocumentFormat, test: Case, columns: readonly DocumentColumn[], request: Record<string, unknown>, rows: DocumentRow[]) {
  return writeDocument(format, { engine: engines[(test.engine as string | undefined) ?? "postgresql"], sourceName: text(test.sourceName ?? "pedido") ?? "pedido", columns, options: optionsOf(format, request) }, rows);
}

const rowsOf = (rows: unknown[][]): DocumentRow[] => rows.map((row, index) => ({ number: index + 1, values: row.map(cellOf) }));
const textColumns = (names: string[]): DocumentColumn[] => names.map((name) => ({ name, type: "text", kind: "text" }));

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
      // O campo do CSV da exportação, que o "Copiar como CSV" escreve, é o mesmo nas aspas que os dois têm.
      const exported = csvField(value, test.kind as QueryColumn["kind"], { ...options, quoting: options.quoting });
      return { actual: exported === actual ? actual : `toDelimited ${actual} e csvField ${exported}`, expected: text(test.expected) };
    });
  });

  it("o \"Em todos os textos\" do CSV é o da fixture", () => {
    assertAll("csv-field-text.json", (test) => {
      const options = test.options as { delimiter: Delimiter; quoting: CsvQuoting; formulaGuard: boolean; nullText: string };
      return { actual: csvField(text(test.value), test.kind as QueryColumn["kind"], options), expected: text(test.expected) };
    });
  });

  it("a data e hora em ISO 8601 é a da fixture", () => {
    assertAll("iso-datetime.json", (test) => ({ actual: isoDateTime(required(test.value)), expected: text(test.expected) }));
  });

  it("o literal do PHP e os caracteres tirados são os da fixture", () => {
    assertAll("php-string.json", (test) => {
      const { literal, removed } = phpString(required(test.value), test.quote === "single");
      return { actual: `${literal}|${removed}`, expected: `${text(test.expected)}|${String(test.removed)}` };
    });
  });

  it("o nome da variável do PHP é o da fixture", () => {
    assertAll("php-variable.json", (test) => {
      const { variable, removed } = phpVariable(required(test.value));
      return { actual: `${variable}|${removed}`, expected: `${text(test.expected)}|${String(test.removed)}` };
    });
  });

  it("a tabela de texto de um lote é a da fixture", () => {
    assertAll("txt-table.json", (test) => {
      const { text: written, counts } = documentOf("txt", test, textColumns(test.columns as string[]), test.options as Record<string, unknown>, rowsOf(test.rows as unknown[][]));
      return { actual: `${written}|${counts.cutValues}`, expected: `${text(test.expected)}|${String(test.cutValues)}` };
    });
  });

  it("o literal do binário é o da fixture", () => {
    assertAll("sql-binary.json", (test) => ({ actual: binaryLiteral(engines[test.engine as string], test.bytes as string, test.type as string), expected: text(test.expected) }));
  });

  it("o SQL de várias linhas por comando e as linhas puladas são os da fixture", () => {
    assertAll("sql-insert.json", (test) => {
      const { text: written, counts } = documentOf("sql", test, test.columns as DocumentColumn[], test.options as Record<string, unknown>, rowsOf(test.rows as unknown[][]));
      return { actual: `${written}|${counts.skippedRows}`, expected: `${text(test.expected)}|${String(test.skippedRows)}` };
    });
  });

  it("o nome do XML, com as maiúsculas sem cultura antes quando pedidas, é o da fixture", () => {
    assertAll("xml-name.json", (test) => {
      const value = required(test.value);
      return { actual: xmlName(test.upperCase === true ? upperInvariant(value) : value), expected: text(test.expected) };
    });
  });

  it("o DbUnit e os caracteres tirados são os da fixture", () => {
    assertAll("dbunit-dataset.json", (test) => {
      const request = { table: test.table, upperCase: test.upperCase, nulls: test.nulls };
      const { text: written, counts } = documentOf("dbUnit", test, textColumns(test.columns as string[]), request, rowsOf(test.rows as unknown[][]));
      return { actual: `${written}|${counts.removedCharacters}`, expected: `${text(test.expected)}|${String(test.removed)}` };
    });
  });

  it("o documento inteiro de cada formato e o resumo são os da fixture (RN-GRADE-016)", () => {
    assertAll("document.json", (test) => {
      const summary = test.summary as { cutValues: number; removedCharacters: number; skippedRows: number };
      const { text: written, counts } = documentOf(test.format as DocumentFormat, test, test.columns as DocumentColumn[], test.options as Record<string, unknown>, rowsOf(test.rows as unknown[][]));
      return {
        actual: `${written}|${counts.cutValues}|${counts.removedCharacters}|${counts.skippedRows}|${counts.notWhole}`,
        expected: `${text(test.expected)}|${summary.cutValues}|${summary.removedCharacters}|${summary.skippedRows}|0`,
      };
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

  it("o que só a tela escreve, das linhas da grade, é o da fixture: o número da grade, a linha nova, a célula gerada e o valor que não veio inteiro (RN-GRADE-016)", () => {
    assertAll("copy-as.json", (test) => {
      const summary = test.summary as { cutValues: number; removedCharacters: number; skippedRows: number; notWhole: number };
      const rows = (test.rows as { number: number | null; values: unknown[]; cut?: number[]; generated?: number[] }[]).map((row) => ({ ...row, values: row.values.map(cellOf) }));
      const { text: written, counts } = documentOf(test.format as DocumentFormat, test, test.columns as DocumentColumn[], test.options as Record<string, unknown>, rows);
      return {
        actual: `${written}|${counts.cutValues}|${counts.removedCharacters}|${counts.skippedRows}|${counts.notWhole}`,
        expected: `${text(test.expected)}|${summary.cutValues}|${summary.removedCharacters}|${summary.skippedRows}|${summary.notWhole}`,
      };
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
