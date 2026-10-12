import { describe, expect, it } from "vitest";

import { csvFileName } from "../csv";
import { exportFileName, exportFormatOf, exportFormats, type ExportContext, type ExportFormat } from "./formats";
import { generateInsertInto, qualifiedTable } from "./generate-sql";
import { gridExportCopy } from "./grid-export.copy";
import { chars, column, hostileValues, sliceOf } from "./test-fixtures";
import { csvOptions, toDelimited, tsvOptions } from "./to-delimited";
import { toHtml } from "./to-html";
import { toJson } from "./to-json";
import { toMarkdown } from "./to-markdown";
import { toXlsx } from "./to-xlsx";
import { toXml } from "./to-xml";

const slice = sliceOf([column("id", "number"), column("nome")], [["1", "Ana"], ["2", `Bia${chars(1)}`], ["3", null]]);
const context: ExportContext = { sheetName: "Pedidos", sql: { engine: 1, table: qualifiedTable("public", "orders") } };
const format = (id: ExportFormat["id"]) => exportFormatOf(id);

describe("o registro dos formatos de exportação (RN-GRADE-007)", () => {
  it("são oito, na ordem do diálogo, cada um com identificador, nome, extensão, tipo MIME e se é binário", () => {
    expect(exportFormats.map(({ id, label, extension, mimeType, binary }) => [id, label, extension, mimeType, binary])).toEqual([
      ["csv", "CSV", "csv", "text/csv;charset=utf-8", false],
      ["tsv", "TSV", "tsv", "text/tab-separated-values;charset=utf-8", false],
      ["json", "JSON", "json", "application/json", false],
      ["xlsx", "Excel (XLSX)", "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", true],
      ["html", "HTML", "html", "text/html;charset=utf-8", false],
      ["markdown", "Markdown", "md", "text/markdown;charset=utf-8", false],
      ["xml", "XML", "xml", "application/xml", false],
      ["insert", "Comandos INSERT", "sql", "application/sql", false],
    ]);
  });

  it("o nome que a tela mostra vem do arquivo de textos, e `exportFormatOf` acha cada um pelo identificador", () => {
    for (const item of exportFormats) {
      expect(item.label).toBe(gridExportCopy.formats[item.id]);
      expect(exportFormatOf(item.id)).toBe(item);
    }
  });

  it("só o XLSX é binário, e o conteúdo é bytes nele e texto nos demais", () => {
    for (const item of exportFormats) {
      const { content } = item.build(slice, context);

      expect(item.binary, item.id).toBe(item.id === "xlsx");
      expect(content instanceof Uint8Array, item.id).toBe(item.binary);
      expect(typeof content === "string", item.id).toBe(!item.binary);
    }
  });

  it("cada formato monta o que a função dele monta (com as opções do CSV e do TSV da RN-TABELA-006)", () => {
    expect(format("csv").build(slice, context).content).toBe(toDelimited(slice, csvOptions));
    expect(format("tsv").build(slice, context).content).toBe(toDelimited(slice, tsvOptions));
    expect(format("json").build(slice, context).content).toBe(toJson(slice));
    expect(format("html").build(slice, context).content).toBe(toHtml(slice).text);
    expect(format("markdown").build(slice, context).content).toBe(toMarkdown(slice));
    expect(format("xml").build(slice, context).content).toBe(toXml(slice).text);
    expect(format("insert").build(slice, context).content).toBe(generateInsertInto(slice, 1, qualifiedTable("public", "orders")));
    expect([...(format("xlsx").build(slice, context).content as Uint8Array)]).toEqual([...toXlsx(slice, { sheetName: "Pedidos" })]);
  });

  it("o CSV começa pelo BOM e usa `;`; o TSV usa tabulação", () => {
    expect((format("csv").build(slice, context).content as string).startsWith("﻿id;nome\r\n")).toBe(true);
    expect((format("tsv").build(slice, context).content as string).startsWith("﻿id\tnome\r\n")).toBe(true);
  });

  it("`removed` diz quantos caracteres o formato não aceitou: o que o XML e o HTML tiraram, e zero nos outros", () => {
    const removed = Object.fromEntries(exportFormats.map((item) => [item.id, item.build(slice, context).removed]));

    expect(removed).toEqual({ csv: 0, tsv: 0, json: 0, xlsx: 0, html: 1, markdown: 0, xml: 1, insert: 0 });
  });

  it("o XLSX conta no `removed` o texto que cortou no limite da célula do Excel", () => {
    const long = sliceOf([column("a")], [["x".repeat(32_770)]]);
    const built = format("xlsx").build(long, context);

    expect(built.removed).toBe(3);
    expect([...(built.content as Uint8Array)]).toEqual([...toXlsx(long, { sheetName: "Pedidos" })]);
  });

  it("sem o nome da planilha, o XLSX usa o padrão", () => {
    expect([...(format("xlsx").build(slice, {}).content as Uint8Array)]).toEqual([...toXlsx(slice)]);
  });

  it("o INSERT precisa do banco e da tabela: sem eles lança, em vez de gerar um comando sem tabela", () => {
    expect(() => format("insert").build(slice, {})).toThrow(TypeError);
    expect(() => format("insert").build(slice, { sheetName: "x" })).toThrow(TypeError);
  });

  it("o INSERT da aba de consulta usa o texto da tabela como o usuário escreveu", () => {
    expect(format("insert").build(slice, { sql: { engine: 3, table: "meu.esquema" } }).content).toContain('INSERT INTO meu.esquema ("id", "nome") VALUES');
  });

  it("recorte vazio, e recorte hostil, saem em todos os formatos sem lançar", () => {
    const hostile = sliceOf([column("a"), column("b\n"), column("c", "number")], hostileValues.map((value) => [value, value, null]));

    for (const item of exportFormats) {
      expect(() => item.build(sliceOf([], []), context), item.id).not.toThrow();
      expect(() => item.build(sliceOf([column("a")], []), context), item.id).not.toThrow();
      expect(() => item.build(hostile, context), item.id).not.toThrow();
    }
  });

  it("o texto de todos os formatos de texto codifica em UTF-8 sem perda (acento e emoji voltam iguais)", () => {
    const emoji = sliceOf([column("ação")], [["🙂 é ç"]]);

    for (const item of exportFormats.filter((candidate) => !candidate.binary && candidate.id !== "insert")) {
      const { content } = item.build(emoji, context);
      const decoded = new TextDecoder("utf-8", { ignoreBOM: true }).decode(new TextEncoder().encode(content as string));

      expect(decoded, item.id).toBe(content);
      expect(decoded, item.id).toContain("🙂 é ç");
    }
  });
});

describe("exportFileName: o nome que o diálogo de salvar propõe", () => {
  it("é o nome seguro do CSV de hoje com a extensão pedida: `producao.apontamento` com `csv` é o `csvFileName`", () => {
    expect(exportFileName("producao.apontamento", "csv")).toBe(csvFileName("producao", "apontamento"));
    expect(exportFileName("producao.apontamento", "json")).toBe("producao.apontamento.json");
    expect(exportFileName("producao.apontamento", "xlsx")).toBe("producao.apontamento.xlsx");
  });

  it("as regras do CSV valem em qualquer extensão: o que o Windows não aceita vira `_`, e controle e marca de direção saem", () => {
    expect(exportFileName("a/b:c*d?e", "html")).toBe("a_b_c_d_e.html");
    expect(exportFileName(`fatura${chars(0x202e)}vsc${chars(10)}.exe`, "md")).toBe("faturavsc.exe.md");
    expect(exportFileName(`a${chars(0xfeff, 0x200b)}b`, "xml")).toBe("ab.xml");
  });

  it("o nome de dispositivo do Windows ganha um `_` na frente, com a extensão que for", () => {
    for (const device of ["con", "NUL", "com1", "lpt9", "aux", "prn"]) expect(exportFileName(device, "json")).toBe(`_${device}.json`);
    expect(exportFileName("con.pedidos", "sql")).toBe("_con.pedidos.sql");
    expect(exportFileName("console", "sql")).toBe("console.sql");
  });

  it("não termina em ponto nem em espaço antes da extensão, e não passa de um tamanho razoável", () => {
    expect(exportFileName("pedidos. ", "csv")).toBe("pedidos.csv");
    expect(exportFileName("x".repeat(500), "xlsx").length).toBeLessThanOrEqual(130);
    expect(exportFileName("x".repeat(500), "xlsx").endsWith(".xlsx")).toBe(true);
  });

  it("um nome que sobra vazio cai no nome padrão, com a extensão pedida", () => {
    expect(exportFileName("", "json")).toBe("registros.json");
    expect(exportFileName("...", "tsv")).toBe("registros.tsv");
    expect(exportFileName(`${chars(0x202e)}`, "md")).toBe("registros.md");
  });

  it("um ponto na frente da extensão não duplica o ponto", () => {
    expect(exportFileName("a", ".json")).toBe("a.json");
  });

  it("o nome proposto para cada formato do registro termina na extensão dele e não tem o que o sistema de arquivos recusa", () => {
    for (const item of exportFormats) {
      const name = exportFileName('s"c<h>|e?m*a/\\.t:abela', item.extension);

      expect(name.endsWith(`.${item.extension}`), name).toBe(true);
      expect(name).not.toMatch(/[\\/:*?"<>|]/);
    }
  });
});
