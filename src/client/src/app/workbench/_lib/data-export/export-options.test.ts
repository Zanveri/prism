import { describe, expect, it } from "vitest";

import { dataFormats, defaultBom, defaultOptions, extensionOf, formatSentence, formattingProblems, isTextFormat, type FormatOptions } from "./export-options";

const options = (change: (base: FormatOptions) => void = () => {}): FormatOptions => {
  const base = defaultOptions({ schema: "estoque", table: "pedido" });
  change(base);
  return base;
};
const context = { engine: 1 as const, tableRequired: false, columns: ["id", "cliente"] };

describe("os formatos e os padrões (RN-EXPORT-004 e 006 a 014)", () => {
  it("dez formatos, na ordem da lista: CSV, Código fonte, DbUnit, HTML, JSON, Markdown, SQL, TXT, XLSX e XML", () => {
    expect(dataFormats).toEqual(["csv", "sourceCode", "dbUnit", "html", "json", "markdown", "sql", "txt", "xlsx", "xml"]);
  });

  it("os padrões do Prism: CSV com ponto e vírgula, cabeçalho, aspas só quando precisa, proteção contra fórmula, CRLF e o nulo vazio", () => {
    expect(options().csv).toEqual({ delimiter: ";", header: true, quoting: "auto", formulaGuard: true, lineBreak: "crlf", nullText: "", binary: "hex" });
    expect(options().txt).toMatchObject({ minWidth: "3", maxWidth: "0", showNull: false, header: true, headerLine: true, edgeDelimiters: true });
    expect(options().sql).toEqual({ schema: "estoque", table: "pedido", omitSchema: false, rowsPerStatement: "10", includeGenerated: false, binary: "literal" });
    expect(options().dbUnit).toEqual({ table: "pedido", upperCase: true, nulls: "omit", binary: "hex" });
    expect(options().json).toEqual({ wrap: true, isoDates: true, binary: "hex" });
  });

  it("o BOM vem ligado no CSV e no TXT, e desligado nos outros", () => {
    expect(Object.entries(defaultBom()).filter(([, on]) => on).map(([format]) => format)).toEqual(["csv", "txt"]);
  });

  it("a extensão: .tsv com a tabulação, .php no Código fonte, .xml no XML e no DbUnit, .md no Markdown", () => {
    expect(extensionOf("csv", options())).toBe("csv");
    expect(extensionOf("csv", options((o) => (o.csv.delimiter = "\t")))).toBe("tsv");
    expect(dataFormats.map((format) => extensionOf(format, options()))).toEqual(["csv", "php", "xml", "html", "json", "md", "sql", "txt", "xlsx", "xml"]);
    expect(isTextFormat("xlsx")).toBe(false);
    expect(isTextFormat("csv")).toBe(true);
  });
});

describe("as recusas da Formatação, no campo, pelo caminho da API", () => {
  it("o nulo como texto: até 100 caracteres, sem caractere de controle (CSV e Markdown)", () => {
    expect(formattingProblems("csv", options((o) => (o.csv.nullText = "a\tb")), context)).toEqual({ "options.nullText": "O texto do nulo não pode ter caractere de controle." });
    expect(formattingProblems("markdown", options((o) => (o.markdown.nullText = "x".repeat(101))), context)).toEqual({ "options.nullText": "O texto do nulo pode ter até 100 caracteres." });
    expect(formattingProblems("csv", options((o) => (o.csv.nullText = "NULL")), context)).toEqual({});
  });

  it("TXT: a mínima de 1 a 1.000, a máxima de 0 a 100.000 e nunca menor que a mínima (0 é sem limite)", () => {
    expect(formattingProblems("txt", options((o) => (o.txt.minWidth = "0")), context)).toEqual({ "options.minWidth": "A largura mínima vai de 1 a 1.000." });
    expect(formattingProblems("txt", options((o) => (o.txt.maxWidth = "abc")), context)).toEqual({ "options.maxWidth": "A largura máxima vai de 0 a 100.000." });
    expect(formattingProblems("txt", options((o) => ((o.txt.minWidth = "10"), (o.txt.maxWidth = "5"))), context)).toEqual({ "options.maxWidth": "A largura máxima não pode ser menor que a mínima." });
    expect(formattingProblems("txt", options((o) => ((o.txt.minWidth = "10"), (o.txt.maxWidth = "0"))), context)).toEqual({});
  });

  it("SQL: a tabela é obrigatória no resultado de uma consulta; os nomes até 128, sem controle; as linhas por comando de 1 a 1.000, menos no Informix", () => {
    expect(formattingProblems("sql", options((o) => (o.sql.table = "")), { ...context, tableRequired: true })).toEqual({ "options.table": "Informe a tabela de destino." });
    expect(formattingProblems("sql", options((o) => (o.sql.table = "")), context)).toEqual({});
    expect(formattingProblems("sql", options((o) => (o.sql.schema = "a\nb")), context)).toEqual({ "options.schema": "O nome não pode ter caractere de controle." });
    expect(formattingProblems("sql", options((o) => (o.sql.table = "x".repeat(129))), context)).toEqual({ "options.table": "O nome pode ter até 128 caracteres." });
    expect(formattingProblems("sql", options((o) => (o.sql.rowsPerStatement = "1001")), context)).toEqual({ "options.rowsPerStatement": "Use de 1 a 1.000 linhas por comando." });
    expect(formattingProblems("sql", options((o) => (o.sql.rowsPerStatement = "1001")), { ...context, engine: 3 })).toEqual({});
  });

  it("SQL: duas colunas com o mesmo nome fariam um INSERT que o banco recusa", () => {
    expect(formattingProblems("sql", options(), { ...context, columns: ["id", "nome", "id"] })).toEqual({ columns: "O resultado tem duas colunas chamadas id: deixe uma de fora na Extração." });
  });

  it("DbUnit: a tabela obrigatória no resultado, como a do SQL", () => {
    expect(formattingProblems("dbUnit", options((o) => (o.dbUnit.table = "")), { ...context, tableRequired: true })).toEqual({ "options.table": "Informe a tabela de destino." });
  });

  it("XLSX: no máximo 16.384 colunas, e a frase diz quantas deixar de fora", () => {
    const columns = Array.from({ length: 16_600 }, (_, index) => `c${index}`);
    expect(formattingProblems("xlsx", options(), { ...context, columns })).toEqual({ columns: "Uma planilha do Excel tem no máximo 16.384 colunas: deixe 216 de fora na Extração, ou escolha outro formato." });
  });
});

describe("a frase do formato na Confirmação (RN-EXPORT-015)", () => {
  it("CSV com os padrões", () => {
    expect(formatSentence("csv", options(), 1)).toBe("CSV · ponto e vírgula · cabeçalho · aspas só quando precisa · proteção contra fórmula · CRLF");
  });

  it("o que muda o arquivo entra: o nulo, o binário vazio, as opções de cada formato", () => {
    expect(formatSentence("csv", options((o) => ((o.csv.nullText = "NULL"), (o.csv.binary = "null"))), 1)).toBe('CSV · ponto e vírgula · cabeçalho · aspas só quando precisa · proteção contra fórmula · CRLF · nulo como "NULL" · binário vazio');
    expect(formatSentence("sql", options(), 1)).toBe("SQL · em estoque.pedido · 10 linhas por comando · binário como literal");
    expect(formatSentence("sql", options(), 3)).toBe("SQL · em estoque.pedido · 1 linha por comando · binário como literal");
    expect(formatSentence("json", options(), 1)).toBe("JSON · com o nome da origem · datas em ISO 8601");
    expect(formatSentence("xlsx", options(), 1)).toBe("XLSX");
  });
});
