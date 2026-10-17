import { describe, expect, it } from "vitest";

import { column, documentOf, hostileValues } from "./test-fixtures";
import { csvField, type CsvFieldOptions } from "./to-csv";

const field: CsvFieldOptions = { delimiter: ";", quoting: "auto", formulaGuard: true, nullText: "" };

describe("o campo do CSV da exportação (RN-EXPORT-007)", () => {
  it("só quando precisa: o separador, a aspa e as quebras levam aspas, com a aspa dobrada", () => {
    expect(csvField("Ana", "text", field)).toBe("Ana");
    expect(csvField("a;b", "text", field)).toBe('"a;b"');
    expect(csvField('diz "oi"', "text", field)).toBe('"diz ""oi"""');
    expect(csvField("a\nb", "text", field)).toBe('"a\nb"');
    expect(csvField("a\rb", "text", field)).toBe('"a\rb"');
    expect(csvField("a,b", "text", field)).toBe("a,b");
    expect(csvField("a,b", "text", { ...field, delimiter: "," })).toBe('"a,b"');
  });

  it("em todos os textos: todo valor que não é de coluna de número; o número só quando precisa", () => {
    const text = { ...field, quoting: "text" as const };
    expect(csvField("Ana", "text", text)).toBe('"Ana"');
    expect(csvField("true", "boolean", text)).toBe('"true"');
    expect(csvField("2024-01-15", "datetime", text)).toBe('"2024-01-15"');
    expect(csvField("12", "number", text)).toBe("12");
    expect(csvField("1;2", "number", text)).toBe('"1;2"');
  });

  it("em todos os valores: tudo entre aspas, menos o nulo", () => {
    const all = { ...field, quoting: "all" as const };
    expect(csvField("12", "number", all)).toBe('"12"');
    expect(csvField(null, "number", all)).toBe("");
  });

  it("o nulo é o texto dele, sem a proteção contra fórmula, entre aspas só quando precisa", () => {
    expect(csvField(null, "text", { ...field, nullText: "NULL" })).toBe("NULL");
    expect(csvField(null, "text", { ...field, nullText: "=nulo" })).toBe("=nulo");
    expect(csvField(null, "text", { ...field, nullText: "a;b" })).toBe('"a;b"');
  });

  it("a proteção contra fórmula: o apóstrofo antes de =, +, - e @, também depois de espaço, tabulação e retorno de carro; o número simples fica", () => {
    expect(csvField("=1+1", "text", field)).toBe("'=1+1");
    expect(csvField(" \t@SUM(A1)", "text", field)).toBe("' \t@SUM(A1)");
    expect(csvField("-12,50", "number", field)).toBe("-12,50");
    expect(csvField("-1+1", "text", field)).toBe("'-1+1");
    expect(csvField("=1;2", "text", field)).toBe("\"'=1;2\"");
    expect(csvField("=1+1", "text", { ...field, formulaGuard: false })).toBe("=1+1");
  });
});

describe("o documento CSV (RN-EXPORT-007)", () => {
  it("o cabeçalho com a mesma proteção e as mesmas aspas, e cada linha terminada na quebra escolhida, também a última; nunca o BOM", () => {
    const columns = [column("@id", "number"), column("nome")];
    expect(documentOf("csv", columns, [["1", "Ana"]]).text).toBe("'@id;nome\r\n1;Ana\r\n");
    expect(documentOf("csv", columns, [["1", "Ana"]], { quoting: "text", lineBreak: "lf", delimiter: "|" }).text).toBe("\"'@id\"|\"nome\"\n1|\"Ana\"\n");
  });

  it("sem linhas, só o cabeçalho; sem cabeçalho e sem linhas, vazio", () => {
    expect(documentOf("csv", [column("a")], []).text).toBe("a\r\n");
    expect(documentOf("csv", [column("a")], [], { header: false }).text).toBe("");
  });

  it("o binário em hexadecimal, ou o nulo do formato com \"Deixar vazio\"", () => {
    expect(documentOf("csv", [column("f", "binary")], [["0xCAFE"]], { header: false }).text).toBe("0xCAFE\r\n");
    expect(documentOf("csv", [column("f", "binary")], [["0xCAFE"]], { header: false, binary: "null", nullText: "-" }).text).toBe("-\r\n");
  });

  it("com qualquer valor hostil, cada registro vira uma linha do texto quando nenhum tem quebra, e o par solto sai como U+FFFD", () => {
    const flat = hostileValues.filter((value) => !/[\r\n]/.test(value));
    const { text } = documentOf("csv", [column("a")], flat.map((value) => [value]), { header: false, lineBreak: "lf" });

    expect(text.split("\n")).toHaveLength(flat.length + 1);
    expect(text).not.toMatch(/\p{Cs}/u);
  });
});
