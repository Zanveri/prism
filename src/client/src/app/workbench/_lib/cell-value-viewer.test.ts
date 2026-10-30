import { describe, expect, it } from "vitest";

import {
  bytesToHexPrefixed,
  CELL_VALUE_FORMATS,
  cellFilePayload,
  cellFormatExtension,
  cellValueToBytes,
  decodeBsonBytes,
  detectCellValueFormat,
  formatBinaryHexDump,
  formatBinaryHexText,
  formatCellValue,
  formatHtmlValue,
  formatJsonValue,
  formatXmlValue,
  highlightCellValue,
  normalizeEditedCellValue,
  suggestedCellFileName,
} from "./cell-value-viewer";

/** Monta um documento BSON simples `{ [key]: value }` com uma chave string ou int32 para os testes. */
function sampleBsonHex(): string {
  // Documento BSON: { "processId": "2500", "ok": true, "count": 42 }
  const encoder = new TextEncoder();
  const key1 = encoder.encode("processId\0");
  const val1 = encoder.encode("2500\0");
  const key2 = encoder.encode("ok\0");
  const key3 = encoder.encode("count\0");

  const bodyLength =
    1 + key1.length + 4 + val1.length + // string "processId": "2500"
    1 + key2.length + 1 + // bool "ok": true
    1 + key3.length + 4; // int32 "count": 42
  const totalLength = 4 + bodyLength + 1;
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  view.setInt32(offset, totalLength, true);
  offset += 4;

  // 0x02: UTF-8 string
  bytes[offset++] = 0x02;
  bytes.set(key1, offset);
  offset += key1.length;
  view.setInt32(offset, val1.length, true);
  offset += 4;
  bytes.set(val1, offset);
  offset += val1.length;

  // 0x08: boolean
  bytes[offset++] = 0x08;
  bytes.set(key2, offset);
  offset += key2.length;
  bytes[offset++] = 0x01;

  // 0x10: int32
  bytes[offset++] = 0x10;
  bytes.set(key3, offset);
  offset += key3.length;
  view.setInt32(offset, 42, true);
  offset += 4;

  // Terminador 0x00
  bytes[offset] = 0x00;

  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
      .join("")
  );
}

describe("os 5 formatos do visualizador de valor, na mesma ordem do DBeaver", () => {
  it("lista Binary, HTML, JSON, Text e XML", () => {
    expect(CELL_VALUE_FORMATS).toEqual([
      { value: "binary", label: "Binary" },
      { value: "html", label: "HTML" },
      { value: "json", label: "JSON" },
      { value: "text", label: "Text" },
      { value: "xml", label: "XML" },
    ]);
  });
});

describe("o mapeamento dos tipos de dados conhecidos dos bancos para o formato inicial", () => {
  it("mapeia JSON, JSONB e BSON (PostgreSQL, Informix e Db2) para json", () => {
    expect(detectCellValueFormat({ name: "payload", type: "json", kind: "text" })).toBe("json");
    expect(detectCellValueFormat({ name: "payload", type: "jsonb", kind: "text" })).toBe("json");
    expect(detectCellValueFormat({ name: "doc", type: "JSON", kind: "text" })).toBe("json");
    expect(detectCellValueFormat({ name: "doc", type: "BSON", kind: "binary" })).toBe("json");
    expect(detectCellValueFormat({ name: "doc", type: "SYSIBM.BSON", kind: "binary" })).toBe("json");
  });

  it("mapeia XML para xml e HTML para html", () => {
    expect(detectCellValueFormat({ name: "nota", type: "xml", kind: "text" })).toBe("xml");
    expect(detectCellValueFormat({ name: "nota", type: "SYSIBM.XML", kind: "text" })).toBe("xml");
    expect(detectCellValueFormat({ name: "pagina", type: "html", kind: "text" })).toBe("html");
  });

  it("mapeia BYTEA, BLOB, BINARY, VARBINARY, BYTE e colunas binárias para binary", () => {
    expect(detectCellValueFormat({ name: "arquivo", type: "bytea", kind: "binary" })).toBe("binary");
    expect(detectCellValueFormat({ name: "arquivo", type: "BLOB", kind: "binary" })).toBe("binary");
    expect(detectCellValueFormat({ name: "hash", type: "CHAR (16) FOR BIT DATA", kind: "text" })).toBe("binary");
    expect(detectCellValueFormat({ name: "foto", type: "BYTE", kind: "binary" })).toBe("binary");
    expect(detectCellValueFormat({ name: "bin", type: "VARBINARY", kind: "binary" })).toBe("binary");
  });

  it("usa text como padrão para TEXT, VARCHAR, CLOB, LVARCHAR, números, datas e quando não há coluna", () => {
    expect(detectCellValueFormat({ name: "content", type: "text", kind: "text" })).toBe("text");
    expect(detectCellValueFormat({ name: "nome", type: "varchar", kind: "text" })).toBe("text");
    expect(detectCellValueFormat({ name: "corpo", type: "CLOB", kind: "text" })).toBe("text");
    expect(detectCellValueFormat({ name: "obs", type: "lvarchar", kind: "text" })).toBe("text");
    expect(detectCellValueFormat({ name: "id", type: "int4", kind: "number" })).toBe("text");
    expect(detectCellValueFormat({ name: "criado_em", type: "timestamptz", kind: "datetime" })).toBe("text");
    expect(detectCellValueFormat({ name: "ativo", type: "bool", kind: "boolean" })).toBe("text");
    expect(detectCellValueFormat(null)).toBe("text");
  });
});

describe("a visualização em JSON: forma crua e forma formatada, inclusive para BSON", () => {
  const rawJson = '{"processId": "25004569020168260100", "readingErrors": [], "groupedSuccess": {"a": 1}}';

  it("permite ver o JSON na forma crua (original/compacta) e na forma formatada (indentada)", () => {
    const rawView = formatJsonValue(rawJson, false);
    expect(rawView.valid).toBe(true);
    expect(rawView.text).toBe(rawJson);

    const prettyView = formatJsonValue(rawJson, true);
    expect(prettyView.valid).toBe(true);
    expect(prettyView.text).toBe(
      '{\n  "processId": "25004569020168260100",\n  "readingErrors": [],\n  "groupedSuccess": {\n    "a": 1\n  }\n}',
    );
  });

  it("quando o JSON veio salvo em múltiplas linhas no banco, a forma crua o compacta em uma linha só e a formatada o indenta", () => {
    const multiLineJson = '{\n  "id": 10,\n  "tags": [\n    "x",\n    "y"\n  ]\n}';
    expect(formatJsonValue(multiLineJson, false)).toEqual({
      valid: true,
      text: '{"id":10,"tags":["x","y"]}',
    });
    expect(formatJsonValue(multiLineJson, true)).toEqual({
      valid: true,
      text: multiLineJson,
    });
  });

  it("decodifica bytes BSON (0x...) para JSON tanto na forma crua quanto na formatada", () => {
    const bsonHex = sampleBsonHex();
    const rawBson = formatJsonValue(bsonHex, false);
    expect(rawBson).toEqual({
      valid: true,
      text: '{"processId":"2500","ok":true,"count":42}',
    });

    const prettyBson = formatJsonValue(bsonHex, true);
    expect(prettyBson).toEqual({
      valid: true,
      text: '{\n  "processId": "2500",\n  "ok": true,\n  "count": 42\n}',
    });
  });

  it("mantém o texto original sem quebrar quando o conteúdo da célula não é um JSON válido", () => {
    const invalid = "texto comum que não é json";
    expect(formatJsonValue(invalid, true)).toEqual({
      valid: false,
      text: invalid,
    });
    expect(formatJsonValue(invalid, false)).toEqual({
      valid: false,
      text: invalid,
    });
  });
});

describe("a visualização em XML e HTML: forma formatada e forma crua", () => {
  it("formata XML com indentação de 2 espaços e preserva a forma crua quando desativada", () => {
    const rawXml = '<?xml version="1.0"?><pedido><id>123</id><itens><item codigo="A1">Notebook</item></itens></pedido>';
    expect(formatXmlValue(rawXml, false)).toBe(rawXml);
    expect(formatXmlValue(rawXml, true)).toBe(
      [
        '<?xml version="1.0"?>',
        "<pedido>",
        "  <id>123</id>",
        "  <itens>",
        '    <item codigo="A1">Notebook</item>',
        "  </itens>",
        "</pedido>",
      ].join("\n"),
    );
  });

  it("formata HTML com indentação sem aninhar elementos vazios como <meta>, <br> e <img>", () => {
    const rawHtml = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Teste</title></head><body><div><p>Olá<br>Mundo</p></div></body></html>";
    expect(formatHtmlValue(rawHtml, false)).toBe(rawHtml);
    expect(formatHtmlValue(rawHtml, true)).toBe(
      [
        "<!DOCTYPE html>",
        "<html>",
        "  <head>",
        '    <meta charset="utf-8">',
        "    <title>Teste</title>",
        "  </head>",
        "  <body>",
        "    <div>",
        "      <p>",
        "        Olá",
        "        <br>",
        "        Mundo",
        "      </p>",
        "    </div>",
        "  </body>",
        "</html>",
      ].join("\n"),
    );
  });
});

describe("a visualização em Binary (hex dump + ASCII igual ao DBeaver)", () => {
  it("converte uma célula de texto nos bytes UTF-8 correspondentes e gera as linhas de 16 bytes com offset, hex e ASCII", () => {
    const sample = '{"processId": "25004569020168260100"}';
    const bytes = cellValueToBytes(sample, false);
    const dump = formatBinaryHexDump(bytes);

    expect(dump.totalBytes).toBe(37);
    expect(dump.rows).toHaveLength(3);
    // Primeira linha (16 bytes): {"processId": "2
    expect(dump.rows[0]).toEqual({
      offset: "00000000",
      hex: ["7B", "22", "70", "72", "6F", "63", "65", "73", "73", "49", "64", "22", "3A", "20", "22", "32"],
      hexLine: "7B 22 70 72 6F 63 65 73 73 49 64 22 3A 20 22 32",
      ascii: '{"processId": "2',
    });
    // Segunda linha (16 bytes): 5004569020168260
    expect(dump.rows[1].offset).toBe("00000010");
    expect(dump.rows[1].ascii).toBe("5004569020168260");
    // Terceira linha (5 bytes): 100"}
    expect(dump.rows[2].offset).toBe("00000020");
    expect(dump.rows[2].ascii).toBe('100"}');
  });

  it("decodifica o formato hexadecimal 0x... das colunas binárias em bytes reais e substitui bytes de controle por ponto no ASCII", () => {
    const bytes = cellValueToBytes("0x48656C6C6F000A7F41", true);
    const dump = formatBinaryHexDump(bytes);

    expect(Array.from(bytes)).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x0a, 0x7f, 0x41]);
    expect(dump.rows[0].ascii).toBe("Hello...A");
    expect(formatBinaryHexText(bytes)).toContain("00000000  48 65 6C 6C 6F 00 0A 7F 41                       Hello...A");
  });

  it("quando uma coluna binária (0x...) é vista no formato Text, decodifica os bytes UTF-8 para leitura", () => {
    const rendered = formatCellValue("0x4F6CC3A120507269736D", {
      format: "text",
      formatted: false,
      isBinaryColumn: true,
    });
    expect(rendered.text).toBe("Olá Prism");
  });

  it("decodifica BSON diretamente em objeto quando os bytes são válidos", () => {
    const bytes = cellValueToBytes(sampleBsonHex(), true);
    expect(decodeBsonBytes(bytes)).toEqual({
      processId: "2500",
      ok: true,
      count: 42,
    });
  });
});

describe("salvar arquivo e abrir em editor externo a partir do visualizador de valor", () => {
  it("sugere a extensão e o nome de arquivo pelo nome da coluna e pelo formato ativo", () => {
    expect(cellFormatExtension("json")).toBe("json");
    expect(cellFormatExtension("xml")).toBe("xml");
    expect(cellFormatExtension("html")).toBe("html");
    expect(cellFormatExtension("binary")).toBe("bin");
    expect(cellFormatExtension("text")).toBe("txt");

    expect(suggestedCellFileName("content", "json")).toBe("content.json");
    expect(suggestedCellFileName("xml_nota", "xml")).toBe("xml_nota.xml");
    expect(suggestedCellFileName("arquivo/anexo", "binary")).toBe("arquivo_anexo.bin");
  });

  it("gera o conteúdo binário (Uint8Array) no modo Binary e o texto formatado ou cru nos demais modos", () => {
    const binPayload = cellFilePayload("0x89504E47", "binary", false, true);
    expect(binPayload.filename).toBe("valor.bin");
    expect(binPayload.mime).toBe("application/octet-stream");
    expect(binPayload.content).toBeInstanceOf(Uint8Array);
    expect(Array.from(binPayload.content as Uint8Array)).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const jsonPayload = cellFilePayload('{"a":1}', "json", true, false, "content");
    expect(jsonPayload.filename).toBe("content.json");
    expect(jsonPayload.mime).toBe("application/json;charset=utf-8");
    expect(jsonPayload.content).toBe('{\n  "a": 1\n}');
  });
});

describe("a normalização do valor editado no F7 antes de salvar (UPDATE / INSERT)", () => {
  it("compacta o JSON formatado (prettified) em uma linha única sem indentação nem quebras de linha ao aplicar a edição", () => {
    const prettifiedDraft = '{\n  "processId": "2500",\n  "ativo": true,\n  "itens": [\n    1,\n    2\n  ]\n}';
    expect(
      normalizeEditedCellValue(prettifiedDraft, {
        format: "json",
        isBinaryColumn: false,
      }),
    ).toBe('{"processId":"2500","ativo":true,"itens":[1,2]}');
  });

  it("remove a indentação entre tags no XML e no HTML formatados ao aplicar a edição", () => {
    const prettyXml = '<pedido>\n  <id>123</id>\n  <status>ok</status>\n</pedido>';
    expect(
      normalizeEditedCellValue(prettyXml, {
        format: "xml",
        isBinaryColumn: false,
      }),
    ).toBe("<pedido><id>123</id><status>ok</status></pedido>");
  });

  it("converte edições em colunas binárias (BLOB, BYTEA, BYTE) para hexadecimal 0x...", () => {
    expect(bytesToHexPrefixed(new Uint8Array([0x4f, 0x69]))).toBe("0x4F69");
    expect(
      normalizeEditedCellValue("0x4f69", {
        format: "binary",
        isBinaryColumn: true,
      }),
    ).toBe("0x4F69");
    expect(
      normalizeEditedCellValue("Oi", {
        format: "text",
        isBinaryColumn: true,
      }),
    ).toBe("0x4F69");
  });
});

describe("o realce de sintaxe (syntax highlighting) para JSON, XML e HTML no leitor de célula", () => {
  it("destaca chaves, textos, números, booleanos e null no JSON preservando o texto exato", () => {
    const sample = '{\n  "id": 6295,\n  "direction": "ENVIADO",\n  "isTransfer": true,\n  "specialStock": null\n}';
    const tokens = highlightCellValue(sample, "json");

    expect(tokens.map((t) => t.text).join("")).toBe(sample);
    expect(tokens.filter((t) => t.kind === "variable").map((t) => t.text)).toEqual([
      '"id"',
      '"direction"',
      '"isTransfer"',
      '"specialStock"',
    ]);
    expect(tokens.filter((t) => t.kind === "string").map((t) => t.text)).toEqual(['"ENVIADO"']);
    expect(tokens.filter((t) => t.kind === "number").map((t) => t.text)).toEqual(["6295"]);
    expect(tokens.filter((t) => t.kind === "keyword").map((t) => t.text)).toEqual(["true", "null"]);
  });

  it("destaca declaração, comentários, tags, atributos e valores no XML e no HTML", () => {
    const xml = '<?xml version="1.0"?><!-- nota --><pedido codigo="A1"><item>Notebook</item></pedido>';
    const xmlTokens = highlightCellValue(xml, "xml");

    expect(xmlTokens.map((t) => t.text).join("")).toBe(xml);
    expect(xmlTokens.some((t) => t.kind === "comment" && t.text === "<!-- nota -->")).toBe(true);
    expect(xmlTokens.some((t) => t.kind === "variable" && t.text === "version")).toBe(true);
    expect(xmlTokens.some((t) => t.kind === "variable" && t.text === "codigo")).toBe(true);
    expect(xmlTokens.some((t) => t.kind === "string" && t.text === '"A1"')).toBe(true);
    expect(xmlTokens.some((t) => t.kind === "keyword" && t.text.includes("pedido"))).toBe(true);

    const html = '<!DOCTYPE html><div class="card" data-id=\'10\'>Olá</div>';
    const htmlTokens = highlightCellValue(html, "html");

    expect(htmlTokens.map((t) => t.text).join("")).toBe(html);
    expect(htmlTokens.some((t) => t.kind === "keyword" && t.text.includes("<!DOCTYPE"))).toBe(true);
    expect(htmlTokens.some((t) => t.kind === "variable" && t.text === "class")).toBe(true);
    expect(htmlTokens.some((t) => t.kind === "variable" && t.text === "data-id")).toBe(true);
    expect(htmlTokens.some((t) => t.kind === "string" && t.text === '"card"')).toBe(true);
    expect(htmlTokens.some((t) => t.kind === "string" && t.text === "'10'")).toBe(true);
  });

  it("detecta automaticamente JSON, XML e HTML em colunas de texto (como CLOB ou VARCHAR) quando o valor tem essa estrutura", () => {
    const clob = { name: "content", type: "CLOB", kind: "text" as const };

    expect(detectCellValueFormat(clob, '{"id": 1}')).toBe("json");
    expect(detectCellValueFormat(clob, '<?xml version="1.0"?><root/>')).toBe("xml");
    expect(detectCellValueFormat(clob, "<!DOCTYPE html><html><body>Oi</body></html>")).toBe("html");
    expect(detectCellValueFormat(clob, "apenas um texto comum")).toBe("text");
  });
});

