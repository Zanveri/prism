import { describe, expect, it } from "vitest";

import { chars, column, hostile, hostileValues, sliceOf } from "./test-fixtures";
import { readZip } from "./test-zip-reader";
import { findAll, parseXml, type XmlNode } from "./test-xml-tree";
import { isXmlChar } from "./text-escape";
import { columnLetters, sheetNameOf, spreadsheetNumber, toXlsx, xlsxLimits, xlsxText, xlsxWorkbook } from "./to-xlsx";
import type { GridSlice } from "./grid-slice";

const decoder = new TextDecoder();
const partsOf = (slice: GridSlice, options?: { sheetName?: string }) => Object.fromEntries(readZip(toXlsx(slice, options)).map((file) => [file.name, decoder.decode(file.data)]));
const sheetOf = (slice: GridSlice, options?: { sheetName?: string }) => parseXml(partsOf(slice, options)["xl/worksheets/sheet1.xml"]);

/** Desfaz o escape `_xHHHH_` do formato (ST_Xstring): o que o Excel faz ao ler o texto de uma célula. */
const unescapeXlsx = (text: string) => text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

type Cell = { type: string | undefined; style: string | undefined; value: string };

/** As células da planilha por referência: o tipo, o estilo e o valor (o `<v>` do número, ou o texto do `<is><t>` já sem o escape). */
function cellsOf(sheet: XmlNode): Record<string, Cell> {
  return Object.fromEntries(
    findAll(sheet, "c").map((cell) => {
      const text = findAll(cell, "t")[0];
      const value = findAll(cell, "v")[0];
      return [cell.attributes.r, { type: cell.attributes.t, style: cell.attributes.s, value: text !== undefined ? unescapeXlsx(text.text) : (value?.text ?? "") }];
    }),
  );
}

const people = sliceOf([column("id", "number"), column("nome"), column("obs")], [["1", "Ana", null], ["2", "Bia", "x"]]);

describe("toXlsx: a pasta de trabalho", () => {
  it("é um ZIP sem compressão com as seis partes mínimas, todas XML bem formado", () => {
    const files = readZip(toXlsx(people));

    expect(files.map((file) => file.name)).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    for (const file of files) expect(() => parseXml(decoder.decode(file.data)), file.name).not.toThrow();
    expect(files.every((file) => file.method === 0)).toBe(true);
  });

  it("os tipos de conteúdo cobrem o livro, a planilha e os estilos; as relações ligam a raiz ao livro e o livro à planilha e aos estilos", () => {
    const parts = partsOf(people);
    const types = parseXml(parts["[Content_Types].xml"]);
    const overrides = Object.fromEntries(findAll(types, "Override").map((node) => [node.attributes.PartName, node.attributes.ContentType]));
    const root = findAll(parseXml(parts["_rels/.rels"]), "Relationship")[0];
    const relations = Object.fromEntries(findAll(parseXml(parts["xl/_rels/workbook.xml.rels"]), "Relationship").map((node) => [node.attributes.Id, node.attributes]));

    expect(types.attributes.xmlns).toBe("http://schemas.openxmlformats.org/package/2006/content-types");
    expect(findAll(types, "Default").map((node) => [node.attributes.Extension, node.attributes.ContentType])).toEqual([
      ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
      ["xml", "application/xml"],
    ]);
    expect(overrides).toEqual({
      "/xl/workbook.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
      "/xl/worksheets/sheet1.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
      "/xl/styles.xml": "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
    });
    expect(root.attributes).toEqual({ Id: "rId1", Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", Target: "xl/workbook.xml" });
    expect(relations.rId1).toMatchObject({ Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet", Target: "worksheets/sheet1.xml" });
    expect(relations.rId2).toMatchObject({ Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles", Target: "styles.xml" });
  });

  it("o livro tem uma planilha só, ligada pela relação rId1, e o nome padrão é o do título dos documentos", () => {
    const workbook = parseXml(partsOf(people)["xl/workbook.xml"]);
    const sheets = findAll(workbook, "sheet");

    expect(workbook.attributes.xmlns).toBe("http://schemas.openxmlformats.org/spreadsheetml/2006/main");
    expect(sheets).toHaveLength(1);
    expect(sheets[0].attributes).toEqual({ name: "Resultado", sheetId: "1", "r:id": "rId1" });
  });

  it("os estilos: o 0 é o padrão e o 1 é o negrito do cabeçalho (fonte 1, applyFont), com os dois preenchimentos e o estilo de célula que o Excel exige", () => {
    const styles = parseXml(partsOf(people)["xl/styles.xml"]);
    const fonts = findAll(findAll(styles, "fonts")[0], "font");
    const xfs = findAll(findAll(styles, "cellXfs")[0], "xf");

    expect(fonts).toHaveLength(2);
    expect(findAll(fonts[0], "b")).toHaveLength(0);
    expect(findAll(fonts[1], "b")).toHaveLength(1);
    expect(findAll(findAll(styles, "fills")[0], "patternFill").map((fill) => fill.attributes.patternType)).toEqual(["none", "gray125"]);
    expect(findAll(styles, "fonts")[0].attributes.count).toBe("2");
    expect(findAll(styles, "cellXfs")[0].attributes.count).toBe("2");
    expect(xfs[1].attributes).toMatchObject({ fontId: "1", applyFont: "1" });
    expect(findAll(styles, "cellStyleXfs")).toHaveLength(1);
    expect(findAll(styles, "cellStyle")[0].attributes).toMatchObject({ name: "Normal", builtinId: "0" });
  });

  it("os mesmos dados dão os mesmos bytes", () => {
    expect([...toXlsx(people)]).toEqual([...toXlsx(people)]);
  });
});

describe("toXlsx: a planilha", () => {
  it("cabeçalho em negrito e congelado, número como número, texto como texto embutido e nulo como célula ausente", () => {
    const sheet = sheetOf(people);

    expect(cellsOf(sheet)).toEqual({
      A1: { type: "inlineStr", style: "1", value: "id" },
      B1: { type: "inlineStr", style: "1", value: "nome" },
      C1: { type: "inlineStr", style: "1", value: "obs" },
      A2: { type: undefined, style: undefined, value: "1" },
      B2: { type: "inlineStr", style: undefined, value: "Ana" },
      A3: { type: undefined, style: undefined, value: "2" },
      B3: { type: "inlineStr", style: undefined, value: "Bia" },
      C3: { type: "inlineStr", style: undefined, value: "x" },
    });
    expect(findAll(sheet, "dimension")[0].attributes.ref).toBe("A1:C3");
    expect(findAll(sheet, "pane")[0].attributes).toEqual({ ySplit: "1", topLeftCell: "A2", activePane: "bottomLeft", state: "frozen" });
    expect(findAll(sheet, "row").map((row) => row.attributes.r)).toEqual(["1", "2", "3"]);
  });

  it("os elementos da planilha estão na ordem que o esquema exige (dimensão, vistas, formato, dados)", () => {
    expect(sheetOf(people).children.map((child) => child.name)).toEqual(["dimension", "sheetViews", "sheetFormatPr", "sheetData"]);
  });

  it("recorte vazio: sem colunas e sem linhas, ou só as colunas", () => {
    const empty = sheetOf(sliceOf([], []));

    expect(findAll(empty, "c")).toHaveLength(0);
    expect(findAll(empty, "pane")).toHaveLength(0);
    expect(findAll(empty, "dimension")[0].attributes.ref).toBe("A1");

    const headerOnly = sheetOf(sliceOf([column("a"), column("b")], []));
    expect(Object.keys(cellsOf(headerOnly))).toEqual(["A1", "B1"]);
    expect(findAll(headerOnly, "dimension")[0].attributes.ref).toBe("A1:B1");
  });

  it("uma célula só", () => {
    expect(cellsOf(sheetOf(sliceOf([column("a")], [["x"]])))).toEqual({ A1: { type: "inlineStr", style: "1", value: "a" }, A2: { type: "inlineStr", style: undefined, value: "x" } });
  });

  it("data, booleano, binário e célula cortada são texto, e os nomes de coluna repetidos ficam como estão", () => {
    const slice = sliceOf([column("x", "datetime"), column("x", "boolean"), column("f", "binary"), column("n", "number")], [["2024-01-02 03:04:05.000000", "true", "0x00ff", "42"]], { truncated: [[0, 3]] });
    const cells = cellsOf(sheetOf(slice));

    expect([cells.A1.value, cells.B1.value]).toEqual(["x", "x"]);
    expect(cells.A2).toEqual({ type: "inlineStr", style: undefined, value: "2024-01-02 03:04:05.000000" });
    expect(cells.B2).toEqual({ type: "inlineStr", style: undefined, value: "true" });
    expect(cells.C2).toEqual({ type: "inlineStr", style: undefined, value: "0x00ff" });
    // O número cortado nunca é o número (a API não corta número; se vier cortado, o valor não é o do banco).
    expect(cells.D2).toEqual({ type: "inlineStr", style: undefined, value: "42" });
  });

  it("NUNCA fórmula: o texto que parece fórmula chega como texto, e a planilha não tem nenhum <f>", () => {
    const values = [hostile.formulaEquals, hostile.formulaPlus, hostile.formulaMinus, hostile.formulaAt, hostile.formulaCommand, hostile.formulaAfterSpace, "=SUM(A1:A2)", "==1", "=HYPERLINK(\"http://x\")"];
    const sheet = sheetOf(sliceOf([column("a")], values.map((value) => [value])));
    const cells = cellsOf(sheet);

    values.forEach((value, index) => expect(cells[`A${index + 2}`], value).toEqual({ type: "inlineStr", style: undefined, value }));
    expect(findAll(sheet, "f")).toHaveLength(0);
    expect(partsOf(sliceOf([column("a")], [["=1+1"]]))["xl/worksheets/sheet1.xml"]).not.toMatch(/<f[ >/]/);
  });

  it("um nome de coluna que parece fórmula também é texto", () => {
    const cells = cellsOf(sheetOf(sliceOf([column("=cmd|' /C calc'!A0")], [])));

    expect(cells.A1).toEqual({ type: "inlineStr", style: "1", value: "=cmd|' /C calc'!A0" });
  });
});

describe("spreadsheetNumber: número só quando o Excel o guarda sem perder precisão", () => {
  it.each([
    ["42", "42"],
    ["-3.5", "-3.5"],
    ["0", "0"],
    ["12.50", "12.5"],
    ["1e5", "100000"],
    ["1.5E+3", "1500"],
    ["123456789012345", "123456789012345"],
    ["-123456789012345", "-123456789012345"],
    ["0.123456789012345", "0.123456789012345"],
    ["1000000000000000", "1000000000000000"],
    ["1234567890123450", "1234567890123450"],
    ["0.000000000000001", "1e-15"],
    // O maior que o Excel guarda é 9,99999999999999E+307.
    ["9.99999999999999e307", "9.99999999999999e+307"],
    ["-9.99999999999999e307", "-9.99999999999999e+307"],
    ["2e307", "2e+307"],
  ])("%j é número (%s)", (text, written) => {
    expect(spreadsheetNumber(text)).toBe(written);
  });

  it.each([
    "1234567890123456",
    "0.1234567890123456",
    "9007199254740993",
    "12345678901234.567",
    "1e400",
    "1e-400",
    "1e-310",
    "1e308",
    "-1e308",
    "9.999999999999991e307",
    "007",
    "+5",
    ".5",
    "5.",
    "NaN",
    "Infinity",
    "-Infinity",
    "1,5",
    "$1.00",
    "",
    "-",
    "1e",
    "0x10",
    " 1",
    "1 ",
  ])("%j fica texto", (text) => {
    expect(spreadsheetNumber(text)).toBeNull();
  });

  it("o menos zero é zero, que o Excel guarda", () => {
    expect(spreadsheetNumber("-0")).toBe("0");
  });

  it("o inteiro de 15 dígitos vira número na planilha e o de 16 vira texto", () => {
    const cells = cellsOf(sheetOf(sliceOf([column("a", "number")], [["999999999999999"], ["1234567890123456"]])));

    expect(cells.A2).toEqual({ type: undefined, style: undefined, value: "999999999999999" });
    expect(cells.A3).toEqual({ type: "inlineStr", style: undefined, value: "1234567890123456" });
  });
});

describe("xlsxText: o escape do texto da célula (ST_Xstring)", () => {
  it("& < > no XML; a tabulação e a quebra de linha ficam; a aspa não precisa", () => {
    expect(xlsxText(`a&b<c>d"e'f\tg\nh`)).toBe(`a&amp;b&lt;c&gt;d"e'f\tg\nh`);
  });

  it("controle, retorno de carro, U+FFFE, U+FFFF e o par solto viram _xHHHH_ (4 dígitos, maiúsculos)", () => {
    expect(xlsxText(chars(0, 1, 8, 11, 12, 13, 31))).toBe("_x0000__x0001__x0008__x000B__x000C__x000D__x001F_");
    // O par solto é um `char` de cada vez: juntos (U+D800 U+DC00) seriam um caractere de verdade, o U+10000.
    expect(xlsxText(`${chars(0xfffe, 0xffff, 0xd800)}a${chars(0xdc00)}`)).toBe("_xFFFE__xFFFF__xD800_a_xDC00_");
    expect(xlsxText(chars(0xd800, 0xdc00))).toBe(chars(0xd800, 0xdc00));
  });

  it("o DEL, o C1 e o par substituto de verdade (emoji) passam: o XML 1.0 os aceita", () => {
    expect(xlsxText(`${chars(127, 0x85, 0x9f)}🙂`)).toBe(`${chars(127, 0x85, 0x9f)}🙂`);
  });

  it("o texto que já parece um escape (`_x0041_`) tem o sublinhado escapado (_x005F_): o Excel não o lê como `A`", () => {
    expect(xlsxText("_x0041_")).toBe("_x005F_x0041_");
    expect(xlsxText("a_x000D_b_x00e9_c")).toBe("a_x005F_x000D_b_x005F_x00e9_c");
    // Sem o sublinhado do fim também: o escape que a própria função escreve logo depois (`_x000D_`) o fecharia (o Excel leria `A` e depois `x000D_`).
    expect(xlsxText("_x41_ _xZZZZ_ x0041_ _x0041")).toBe("_x41_ _xZZZZ_ x0041_ _x005F_x0041");
    // Dois padrões que se tocam no mesmo sublinhado: os dois sublinhados que abrem padrão são escapados, e a leitura de volta dá o texto original.
    expect(xlsxText("_x005F_x0041_")).toBe("_x005F_x005F_x005F_x0041_");
    expect(unescapeXlsx(xlsxText("_x005F_x0041_"))).toBe("_x005F_x0041_");
  });

  it("depois de desfeito o escape, volta exatamente o texto (inclusive os controles e os pares soltos), para todo valor hostil", () => {
    // Os quatro últimos: um `_xHHHH` SEM o sublinhado do fim, colado num caractere que a função escreve como `_xHHHH_` (CR, outro controle, U+FFFE, par solto).
    const lookalikes = [`linha_x0041${chars(13, 10)}fim`, `_x0041${chars(1)}`, `a_x00e9${chars(13)}`, `_x0041${chars(0xfffe)}`, `_x0041${chars(0xd800)}`, `_x0041${chars(0xffff)}_x0041${chars(13)}`];
    for (const value of [...hostileValues, "_x0041_", `${chars(0)}_x005F_x0041_`, `a${chars(13)}${chars(10)}b`, ...lookalikes]) {
      const parsed = parseXml(`<t>${xlsxText(value)}</t>`);
      expect(unescapeXlsx(parsed.text), JSON.stringify(value)).toBe(value);
    }
  });

  it("`_xHHHH` sem o sublinhado do fim, colado num caractere escapado, não vira um escape que o Excel leria: o sublinhado do começo é escapado", () => {
    expect(xlsxText(`linha_x0041${chars(13, 10)}fim`)).toBe("linha_x005F_x0041_x000D_\nfim");
    expect(xlsxText(`_x0041${chars(1)}`)).toBe("_x005F_x0041_x0001_");
    expect(xlsxText(`a_x00e9${chars(13)}`)).toBe("a_x005F_x00e9_x000D_");
    expect(xlsxText(`_x0041${chars(0xfffe)}`)).toBe("_x005F_x0041_xFFFE_");
  });

  it("na planilha, o texto hostil chega inteiro à célula, e o espaço das pontas é preservado (xml:space)", () => {
    const rows = [...hostileValues, "  espaços  ", "\tabc\n"].map((value) => [value]);
    const sheet = sheetOf(sliceOf([column("a")], rows));
    const cells = cellsOf(sheet);

    rows.forEach(([value], index) => expect(cells[`A${index + 2}`].value, JSON.stringify(value)).toBe(value));
    expect(findAll(sheet, "t").every((node) => node.attributes["xml:space"] === "preserve")).toBe(true);
  });

  it("o texto de mais de 32.767 caracteres (o limite da célula do Excel) é cortado nele, sem partir um emoji", () => {
    const cells = cellsOf(sheetOf(sliceOf([column("a")], [["x".repeat(40_000)], [`${"y".repeat(32_766)}🙂🙂`]])));

    expect(cells.A2.value).toHaveLength(32_767);
    expect(cells.A3.value).toBe("y".repeat(32_766));
  });
});

describe("xlsxWorkbook: o que o formato cortou conta em `removed`", () => {
  it("o texto além de 32.767 caracteres conta pelos pontos de código cortados (o emoji que não cabe inteiro sai por inteiro e conta um)", () => {
    expect(xlsxWorkbook(sliceOf([column("a")], [["x".repeat(40_000)]])).removed).toBe(7_233);
    expect(xlsxWorkbook(sliceOf([column("a")], [[`${"y".repeat(32_766)}🙂🙂`]])).removed).toBe(2);
    expect(xlsxWorkbook(sliceOf([column("a")], [["x".repeat(32_767)]])).removed).toBe(0);
  });

  it("vale também para o nome da coluna (o cabeçalho é uma célula), e soma o de todas as células", () => {
    expect(xlsxWorkbook(sliceOf([column("n".repeat(32_770))], [["x".repeat(32_768)], ["y".repeat(32_767)], [null]])).removed).toBe(3 + 1);
  });

  it("sem corte, zero; e o conteúdo é o que `toXlsx` dá", () => {
    const { content, removed } = xlsxWorkbook(people, { sheetName: "P" });

    expect(removed).toBe(0);
    expect([...content]).toEqual([...toXlsx(people, { sheetName: "P" })]);
  });
});

describe("sheetNameOf: o nome da planilha", () => {
  it.each([
    ["Resultado", "Resultado"],
    ["Vendas 2024", "Vendas 2024"],
    ["", "Resultado"],
    ["   ", "Resultado"],
    ["'", "Resultado"],
    ["[]:*?/\\", "_______"],
    ["a[b]c:d*e?f/g\\h", "a_b_c_d_e_f_g_h"],
    ["'abc'", "abc"],
    ["a'b", "a'b"],
    ["  espaço  ", "espaço"],
    [`a${chars(0)}b${chars(10)}c${chars(0xd800)}d`, "abcd"],
    // U+FFFE e U+FFFF não são caracteres do XML 1.0: um deles no nome faria o `xl/workbook.xml` mal formado, e o arquivo não abriria.
    [`n${chars(0xfffe)}`, "n"],
    [`a${chars(0xffff)}b${chars(0xfffe)}c`, "abc"],
    ["x".repeat(40), "x".repeat(31)],
    ["x".repeat(31), "x".repeat(31)],
    [`${"x".repeat(30)}🙂`, "x".repeat(30)],
    [`${"x".repeat(30)}'yy`, "x".repeat(30)],
    ["History", "History_"],
    ["history", "history_"],
    ["Histórico", "Histórico"],
  ])("%j vira %j", (name, expected) => {
    expect(sheetNameOf(name)).toBe(expected);
  });

  it("nunca passa de 31 unidades UTF-16, nunca é vazio e nunca tem os caracteres proibidos, para qualquer entrada", () => {
    for (const name of [...hostileValues, "🙂".repeat(40), "[".repeat(50), "'".repeat(50), "a".repeat(100), `n${chars(0xfffe)}`, `n${chars(0xffff)}`, `${chars(0xfffe, 0xffff)}x`]) {
      const result = sheetNameOf(name);

      expect(result.length, JSON.stringify(name)).toBeLessThanOrEqual(31);
      expect(result.length).toBeGreaterThan(0);
      expect(result).not.toMatch(/[[\]:*?/\\]/);
      expect(result.startsWith("'") || result.endsWith("'")).toBe(false);
      // Todo ponto de código do nome é um caractere do XML 1.0 (senão o `workbook.xml` fica mal formado).
      for (const char of result) expect(isXmlChar(char.codePointAt(0) ?? 0), `U+${char.codePointAt(0)?.toString(16)} em ${JSON.stringify(name)}`).toBe(true);
    }
  });

  it("com U+FFFE ou U+FFFF no nome da planilha, o `workbook.xml` só tem caracteres do XML 1.0 e o nome sai sem eles", () => {
    for (const sheetName of [`n${chars(0xfffe)}`, `n${chars(0xffff)}`, `${chars(0xfffe)}${chars(0xffff)}`]) {
      const workbook = partsOf(people, { sheetName })["xl/workbook.xml"];

      for (const char of workbook) expect(isXmlChar(char.codePointAt(0) ?? 0), `U+${char.codePointAt(0)?.toString(16)}`).toBe(true);
      expect(findAll(parseXml(workbook), "sheet")[0].attributes.name).toBe(sheetName.startsWith("n") ? "n" : "Resultado");
    }
  });

  it("o nome vai ao livro, escapado, e o `sheetName` da opção é o que sai", () => {
    expect(findAll(parseXml(partsOf(people, { sheetName: 'A&B "x" <y>' })["xl/workbook.xml"]), "sheet")[0].attributes.name).toBe('A&B "x" <y>');
    expect(findAll(parseXml(partsOf(people, { sheetName: "a/b" })["xl/workbook.xml"]), "sheet")[0].attributes.name).toBe("a_b");
    expect(findAll(parseXml(partsOf(people, { sheetName: "" })["xl/workbook.xml"]), "sheet")[0].attributes.name).toBe("Resultado");
  });
});

describe("columnLetters e os tetos do Excel", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [51, "AZ"],
    [52, "BA"],
    [701, "ZZ"],
    [702, "AAA"],
    [16383, "XFD"],
  ])("a coluna %i é %s", (index, letters) => {
    expect(columnLetters(index)).toBe(letters);
  });

  it("o teto é o do Excel: 16.384 colunas e 1.048.576 linhas, cabeçalho incluído; acima disso, RangeError", () => {
    expect(xlsxLimits).toEqual({ maxRows: 1_048_576, maxColumns: 16_384 });

    const widest = sliceOf(Array.from({ length: 16_384 }, (_, index) => column(`c${index}`)), []);
    expect(Object.keys(cellsOf(sheetOf(widest))).at(-1)).toBe("XFD1");
    expect(() => toXlsx(sliceOf(Array.from({ length: 16_385 }, (_, index) => column(`c${index}`)), []))).toThrow(RangeError);

    const tooLong = { ...sliceOf([column("a")], []), rows: { length: 1_048_576 } as unknown as string[][] };
    expect(() => toXlsx(tooLong)).toThrow(RangeError);
  });
});
