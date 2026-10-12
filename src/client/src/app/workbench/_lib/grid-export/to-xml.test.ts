import { describe, expect, it } from "vitest";

import { chars, column, hostile, hostileValues, sliceOf } from "./test-fixtures";
import { toXml } from "./to-xml";

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"' };

/** Lê as referências a caracteres do XML: as cinco nomeadas e as numéricas. Qualquer outro `&` é erro de escape. */
function decode(text: string): string {
  expect(text.replace(/&(?:amp|lt|gt|quot|#\d+);/g, ""), "sobrou um & sem escape").not.toContain("&");
  return text.replace(/&(amp|lt|gt|quot|#(\d+));/g, (_, name: string, code?: string) => (code === undefined ? entities[name] : String.fromCodePoint(Number(code))));
}

/** Lê de volta o que `toXml` escreve (a forma é fixa): para cada linha, as colunas como [nome, valor ou null]. */
function parse(xml: string): [string, string | null][][] {
  const rows = [...xml.matchAll(/<row(?:\/>|>([\s\S]*?)<\/row>)/g)];
  return rows.map(([, inner = ""]) =>
    [...inner.matchAll(/<column name="([^"<]*)"(?: null="true"\/>|\/>|>([^<]*)<\/column>)/g)].map(([whole, name, text]) => [decode(name), whole.includes('null="true"') ? null : decode(text ?? "")]),
  );
}

describe("toXml: a forma do documento", () => {
  it("começa pela declaração, tem um elemento por linha e um por coluna com o nome no atributo, e termina em quebra de linha", () => {
    const { text, removed } = toXml(sliceOf([column("id", "number"), column("nome")], [["1", "Ana"], ["2", null]]));

    expect(removed).toBe(0);
    expect(text).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<result>\n  <row>\n    <column name="id">1</column>\n    <column name="nome">Ana</column>\n  </row>\n  <row>\n    <column name="id">2</column>\n    <column name="nome" null="true"/>\n  </row>\n</result>\n',
    );
  });

  it("recorte vazio: a raiz sem filhos, com colunas ou sem elas", () => {
    expect(toXml(sliceOf([], [])).text).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<result/>\n');
    expect(toXml(sliceOf([column("a")], [])).text).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<result/>\n');
  });

  it("sem colunas, cada linha é um elemento vazio", () => {
    expect(toXml(sliceOf([], [[], []])).text).toBe('<?xml version="1.0" encoding="UTF-8"?>\n<result>\n  <row/>\n  <row/>\n</result>\n');
  });

  it("uma célula só", () => {
    expect(toXml(sliceOf([column("a")], [["x"]])).text).toContain('<column name="a">x</column>');
  });

  it("o nulo tem o atributo `null`, e o texto vazio é um elemento vazio sem ele: dá para distinguir", () => {
    const { text } = toXml(sliceOf([column("a"), column("b")], [[null, ""]]));

    expect(text).toContain('<column name="a" null="true"/>');
    expect(text).toContain('<column name="b"/>');
    expect(parse(text)).toEqual([[["a", null], ["b", ""]]]);
  });

  it("célula cortada, coluna binária, coluna booleana e nomes de coluna repetidos saem como na grade", () => {
    const { text } = toXml(sliceOf([column("x"), column("x", "boolean"), column("f", "binary")], [["cortado…", "true", "0x00ff"]], { truncated: [[0, 0]] }));

    expect(parse(text)).toEqual([[["x", "cortado…"], ["x", "true"], ["f", "0x00ff"]]]);
  });
});

describe("toXml: o escape", () => {
  it("& < > no texto; aspas duplas, & < > e os brancos no atributo (que o leitor normalizaria para espaço)", () => {
    const { text } = toXml(sliceOf([column('n"<&>\t\n\r')], [[`a&b<c>d"e'f]]>`]]));

    expect(text).toContain('<column name="n&quot;&lt;&amp;&gt;&#9;&#10;&#13;">a&amp;b&lt;c&gt;d"e\'f]]&gt;</column>');
  });

  it("o retorno de carro no texto vira &#13;: o leitor não o troca por \\n; a quebra de linha e a tabulação ficam", () => {
    const { text } = toXml(sliceOf([column("a")], [[hostile.crlf], [hostile.cr], [hostile.lf], [hostile.tab]]));

    expect(text).toContain("<column name=\"a\">linha1&#13;\nlinha2</column>");
    expect(text).not.toContain("\r");
    expect(parse(text).map((row) => row[0][1])).toEqual([hostile.crlf, hostile.cr, hostile.lf, hostile.tab]);
  });

  it("todo valor hostil volta igual depois de lido (menos o que o XML não aceita, que é tirado)", () => {
    const { text } = toXml(sliceOf([column("a")], hostileValues.map((value) => [value])));
    // `[...value]` separa por ponto de código: o par de verdade é um item de dois, e o solto é um item de um.
    const loneSurrogate = (char: string) => char.length === 1 && char >= "\ud800" && char <= "\udfff";
    const stripped = (value: string) => [...value].filter((char) => !loneSurrogate(char) && !((char.codePointAt(0) ?? 0) < 0x20 && !"\t\n\r".includes(char))).join("");

    expect(parse(text).map((row) => row[0][1])).toEqual(hostileValues.map(stripped));
  });

  it("nome de coluna hostil nunca vira nome de elemento: os elementos são só result, row e column", () => {
    const names = ["a b", "1x", "<x/>", "x:y", "é", "xml", "a>b", 'a"b', "", "__proto__"];
    const { text } = toXml(sliceOf(names.map((name) => column(name)), [names.map((_, index) => `v${index}`)]));

    const elements = [...text.matchAll(/<\/?([^\s/>!?]+)/g)].map((match) => match[1]);
    expect([...new Set(elements)].sort()).toEqual(["column", "result", "row"]);
    expect(parse(text)[0].map(([name]) => name)).toEqual(names);
  });

  it("acento, emoji e valor que parece fórmula passam sem mudança", () => {
    const { text } = toXml(sliceOf([column("a")], [[hostile.accents], [hostile.emoji], [hostile.formulaEquals]]));

    expect(parse(text).map((row) => row[0][1])).toEqual([hostile.accents, hostile.emoji, "=1+1"]);
  });
});

describe("toXml: o que o XML 1.0 não aceita é tirado, e a função diz quantos", () => {
  it("controle (menos tabulação, quebra de linha e retorno de carro), U+FFFE, U+FFFF e o par substituto solto saem; DEL, NEL e os de C1 ficam, porque o XML 1.0 os aceita", () => {
    const dirty = `a${chars(0, 1, 7, 8, 11, 12, 14, 27, 31)}b${chars(0xfffe, 0xffff)}c${chars(0xd800)}d${chars(0xdc00)}e${chars(127, 0x85, 0x9f)}f`;
    const { text, removed } = toXml(sliceOf([column("a")], [[dirty]]));

    expect(removed).toBe(9 + 2 + 2);
    expect(text).toContain(`<column name="a">abcde${chars(127, 0x85, 0x9f)}f</column>`);
  });

  it("o par substituto de verdade (emoji) fica; só o solto sai", () => {
    const { text, removed } = toXml(sliceOf([column("a")], [["🙂"]]));

    expect(removed).toBe(0);
    expect(text).toContain("🙂");
  });

  it("o nome da coluna também é limpo, e conta uma vez só (e não uma por linha)", () => {
    const { text, removed } = toXml(sliceOf([column(`n${chars(0)}x`)], [["1"], ["2"], ["3"]]));

    expect(removed).toBe(1);
    expect(parse(text).map((row) => row[0][0])).toEqual(["nx", "nx", "nx"]);
  });

  it("a soma é de todos os valores do recorte", () => {
    const { removed } = toXml(sliceOf([column("a"), column("b")], [[`x${chars(0)}`, `${chars(1)}${chars(2)}`], [null, `y${chars(0xd800)}`]]));

    expect(removed).toBe(4);
  });

  it("nenhum caractere fora do XML 1.0 sobra no documento, qualquer que seja o valor hostil", () => {
    const { text } = toXml(sliceOf([column("a")], hostileValues.map((value) => [value])));

    for (const char of text) {
      const code = char.codePointAt(0) ?? 0;
      const valid = code === 9 || code === 10 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
      expect(valid, `U+${code.toString(16)}`).toBe(true);
    }
  });
});
