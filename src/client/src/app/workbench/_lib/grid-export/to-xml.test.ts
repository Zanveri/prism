import { describe, expect, it } from "vitest";

import { chars, column, documentOf, hostile, hostileValues } from "./test-fixtures";
import { findAll, parseXml } from "./test-xml-tree";
import { isXmlNameChar, isXmlNameStart, xmlName } from "./xml-name";

const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';

/** A volta do `xmlName` (o `XmlConvert.DecodeName` do .NET): cada `_xHHHH_` e `_xHHHHHHHH_` volta a ser o caractere. */
const decodeName = (name: string) => name.replace(/_x([0-9A-F]{8}|[0-9A-F]{4})_/g, (_, hex: string) => (hex.length === 4 ? String.fromCharCode(parseInt(hex, 16)) : String.fromCodePoint(parseInt(hex, 16))));

/** O nome é um nome de elemento e de atributo do XML 1.0 (4ª edição, a do .NET), unidade por unidade. */
const isName = (name: string) => name !== "" && isXmlNameStart(name.charCodeAt(0)) && [...name.slice(1)].every((char) => [...char].length === 1 && char.length === 1 && isXmlNameChar(char.charCodeAt(0)));

/** O que um valor vira no XML: sem o que o XML 1.0 não aceita (o controle fora da tabulação e das quebras, o par solto, U+FFFE e U+FFFF). */
const kept = (value: string) => [...value].filter((char) => !(char.length === 1 && char >= "\ud800" && char <= "\udfff") && !((char.codePointAt(0) ?? 0) < 0x20 && !"\t\n\r".includes(char)) && char !== "\ufffe" && char !== "\uffff").join("");

describe("o XML do DBeaver (RN-EXPORT-012)", () => {
  it("a declaração, a raiz com o nome da origem, um DATA_RECORD por linha e um elemento por coluna, com recuo de 2 espaços e LF", () => {
    const { text, counts } = documentOf("xml", [column("id", "number"), column("cliente")], [["1", "Ana"], ["2", "Bia"]]);

    expect(counts.removedCharacters).toBe(0);
    expect(text).toBe(`${declaration}<pedido>\n  <DATA_RECORD>\n    <id>1</id>\n    <cliente>Ana</cliente>\n  </DATA_RECORD>\n  <DATA_RECORD>\n    <id>2</id>\n    <cliente>Bia</cliente>\n  </DATA_RECORD>\n</pedido>\n`);
  });

  it("sem linhas, a raiz vazia", () => {
    expect(documentOf("xml", [column("id")], []).text).toBe(`${declaration}<pedido/>\n`);
  });

  it("o nulo e o texto vazio são o elemento vazio, como no DBeaver", () => {
    expect(documentOf("xml", [column("a"), column("b")], [[null, ""]]).text).toContain("    <a/>\n    <b/>\n");
  });

  it("o texto escapa &, <, > e o retorno de carro; a aspa, a tabulação e a quebra de linha ficam", () => {
    const { text } = documentOf("xml", [column("a")], [[`a&b<c>d"e'f]]>\r\n\tg`]]);

    expect(text).toContain(`<a>a&amp;b&lt;c&gt;d"e'f]]&gt;&#13;\n\tg</a>`);
  });

  it("todo valor hostil volta igual depois de lido, menos o que o XML 1.0 não aceita, que é tirado e contado", () => {
    const { text, counts } = documentOf("xml", [column("a")], hostileValues.map((value) => [value]));
    const records = findAll(parseXml(text), "a");

    expect(records.map((node) => node.text)).toEqual(hostileValues.map(kept));
    expect(counts.removedCharacters).toBe(hostileValues.reduce((total, value) => total + [...value].length - [...kept(value)].length, 0));
  });

  it("o nome da coluna e o da origem viram nomes de elemento pela regra do .NET, e a volta é exata; o nome nunca é tirado nem contado", () => {
    const names = ["a b", "1x", "<x/>", "x:y", "é", "xml", "a>b", 'a"b', "__proto__", "_x0041_", "🙂", `n${chars(0)}x`];
    const { text, counts } = documentOf("xml", names.map((name) => column(name)), [names.map((_, index) => `v${index}`)], {}, { sourceName: "nota fiscal" });

    expect(counts.removedCharacters).toBe(0);
    expect(text).toContain("<nota_x0020_fiscal>");
    for (const name of names) {
      expect(isName(xmlName(name)), name).toBe(true);
      expect(decodeName(xmlName(name)), name).toBe(name);
    }
    // Com os nomes do ASCII, o documento é lido de ponta a ponta.
    const ascii = names.filter((name) => /^[\x20-\x7e]*$/.test(name));
    const document = documentOf("xml", ascii.map((name) => column(name)), [ascii.map((_, index) => `v${index}`)]).text;
    expect(findAll(parseXml(document), "DATA_RECORD")[0].children.map((child) => decodeName(child.name))).toEqual(ascii);
  });

  it("com o DOCTYPE, os elementos da raiz, do DATA_RECORD e de cada coluna, cada nome declarado uma vez", () => {
    const { text } = documentOf("xml", [column("id"), column("id"), column("pedido"), column("DATA_RECORD")], [["1", "2", "3", "4"]], { doctype: true });

    expect(text.startsWith(`${declaration}<!DOCTYPE pedido [\n  <!ELEMENT pedido (DATA_RECORD*)>\n  <!ELEMENT DATA_RECORD (id?,id?,pedido?,DATA_RECORD?)+>\n  <!ELEMENT id (#PCDATA)>\n]>\n<pedido>\n`)).toBe(true);
  });

  it("o binário em hexadecimal, ou o elemento vazio com \"Deixar vazio\"", () => {
    expect(documentOf("xml", [column("f", "binary")], [["0xBEEF"]]).text).toContain("<f>0xBEEF</f>");
    expect(documentOf("xml", [column("f", "binary")], [["0xBEEF"]], { binary: "null" }).text).toContain("<f/>");
  });

  it("nenhum caractere fora do XML 1.0 sobra no documento, qualquer que seja o valor hostil", () => {
    const { text } = documentOf("xml", [column("a")], hostileValues.map((value) => [value]));

    expect(() => parseXml(text)).not.toThrow();
  });
});

describe("o DbUnit (RN-EXPORT-012)", () => {
  it("o exemplo da regra: um elemento vazio por linha, com o nome da tabela e um atributo por coluna, em maiúsculas, com recuo de 4 espaços", () => {
    expect(documentOf("dbUnit", [column("id", "number"), column("cliente")], [["1", "Ana"]]).text).toBe(`${declaration}<dataset>\n    <PEDIDO ID="1" CLIENTE="Ana"/>\n</dataset>\n`);
  });

  it("sem linhas, <dataset/>", () => {
    expect(documentOf("dbUnit", [column("id")], []).text).toBe(`${declaration}<dataset/>\n`);
  });

  it("o nulo omite o atributo, ou é [NULL]; o texto vazio é o atributo vazio", () => {
    const columns = [column("a"), column("b")];
    expect(documentOf("dbUnit", columns, [[null, ""]]).text).toContain('    <PEDIDO B=""/>\n');
    expect(documentOf("dbUnit", columns, [[null, ""]], { nulls: "mark" }).text).toContain('    <PEDIDO A="[NULL]" B=""/>\n');
  });

  it("as maiúsculas vêm antes da regra do nome do XML, e o atributo repetido ganha _2", () => {
    const { text } = documentOf("dbUnit", [column("nota fiscal"), column("id"), column("ID")], [["1", "2", "3"]], { table: "itens do pedido" });

    expect(text).toContain('<ITENS_x0020_DO_x0020_PEDIDO NOTA_x0020_FISCAL="1" ID="2" ID_2="3"/>');
    expect(() => parseXml(text)).not.toThrow();
  });

  it("sem as maiúsculas, os nomes ficam como estão", () => {
    expect(documentOf("dbUnit", [column("Id")], [["1"]], { upperCase: false, table: "Pedido" }).text).toContain('<Pedido Id="1"/>');
  });

  it("o valor escapa a aspa, a tabulação e as quebras, e volta igual depois de lido; o que o XML 1.0 não aceita sai e conta", () => {
    const { text, counts } = documentOf("dbUnit", [column("a")], hostileValues.map((value) => [value]));
    const rows = findAll(parseXml(text), "PEDIDO");

    expect(rows.map((node) => node.attributes.A)).toEqual(hostileValues.map(kept));
    expect(counts.removedCharacters).toBeGreaterThan(0);
  });

  it("o binário em hexadecimal, ou o nulo do formato com \"Deixar vazio\"", () => {
    expect(documentOf("dbUnit", [column("f", "binary")], [["0xCAFE"]]).text).toContain('<PEDIDO F="0xCAFE"/>');
    expect(documentOf("dbUnit", [column("f", "binary")], [["0xCAFE"]], { binary: "null" }).text).toContain("<PEDIDO/>");
  });

  it("acento e emoji passam no valor", () => {
    expect(documentOf("dbUnit", [column("a")], [[hostile.accents]]).text).toContain(`A="${hostile.accents}"`);
  });
});
