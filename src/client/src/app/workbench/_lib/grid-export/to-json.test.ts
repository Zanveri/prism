import { describe, expect, it } from "vitest";

import { column, hostile, hostileValues, sliceOf } from "./test-fixtures";
import { jsonKeys, toJson } from "./to-json";

const jsonOf = (kind: "number" | "boolean" | "text" | "datetime" | "binary", value: string | null, truncated = false) =>
  toJson(sliceOf([column("v", kind)], [[value]], { truncated: truncated ? [[0, 0]] : [] })).replace(/^\[\n {2}\{\n {4}"v": /, "").replace(/\n {2}\}\n\]$/, "");

describe("toJson: uma lista de objetos, com recuo de 2 espaços", () => {
  it("recorte vazio é a lista vazia, com colunas ou sem elas", () => {
    expect(toJson(sliceOf([], []))).toBe("[]");
    expect(toJson(sliceOf([column("a")], []))).toBe("[]");
  });

  it("sem colunas, cada linha é um objeto vazio", () => {
    expect(toJson(sliceOf([], [[], []]))).toBe("[\n  {},\n  {}\n]");
  });

  it("uma célula só", () => {
    expect(toJson(sliceOf([column("a")], [["x"]]))).toBe('[\n  {\n    "a": "x"\n  }\n]');
  });

  it("é o que o JSON.stringify escreve com recuo 2, e volta igual por JSON.parse", () => {
    const slice = sliceOf(
      [column("id", "number"), column("nome"), column("ativo", "boolean"), column("preco", "number"), column("quando", "datetime")],
      [
        ["1", "Ana", "true", "12.5", "2024-01-02 03:04:05.000000"],
        ["2", null, "false", null, null],
      ],
    );
    const expected = [
      { id: 1, nome: "Ana", ativo: true, preco: 12.5, quando: "2024-01-02 03:04:05.000000" },
      { id: 2, nome: null, ativo: false, preco: null, quando: null },
    ];

    expect(toJson(slice)).toBe(JSON.stringify(expected, null, 2));
    expect(JSON.parse(toJson(slice))).toEqual(expected);
  });

  it("todo valor hostil (aspas, quebras de linha, tabulação, controle, par solto, marcação) volta igual por JSON.parse", () => {
    const rows = hostileValues.map((value) => [value, value]);
    const parsed = JSON.parse(toJson(sliceOf([column("a"), column("b")], rows))) as { a: string; b: string }[];

    parsed.forEach((object, index) => {
      // O par substituto solto vira \udXXX no JSON bem formado e volta como o mesmo par solto.
      expect(object.a, hostileValues[index]).toBe(hostileValues[index]);
      expect(object.b).toBe(hostileValues[index]);
    });
  });
});

describe("toJson: o número sai literal quando o texto é um número na gramática do JSON", () => {
  // O que vai para o arquivo é o PRÓPRIO texto, sem passar por `Number`: quem perde precisão, se perder, é o programa que lê.
  it.each([
    "42",
    "-3.5",
    "0",
    "-0",
    "-0.0",
    "12.50",
    "100.00",
    "1e5",
    "1.5E+10",
    "0E+0",
    "0.30000000000000004",
    "9007199254740991",
    "-9007199254740991",
    "123456789012345.67",
    // Além do que o `Number` do JavaScript guarda: os dígitos seguem como vieram.
    "9007199254740992",
    "9007199254740993",
    "-9007199254740993",
    "123456789012345678",
    "1.0000000000000001",
    "1e400",
    "1e-400",
    "123456789012345678901234567890.123456789012345678",
    "0.000000000000000000000000000001",
  ])("%j sai como número, com os dígitos que a API mandou", (text) => {
    expect(jsonOf("number", text)).toBe(text);
  });

  it.each([
    "007",
    "-007",
    "01",
    "+5",
    ".5",
    "-.5",
    "5.",
    "1.e5",
    "1e",
    "1e+",
    "--1",
    "-",
    "1,5",
    "1 000",
    "1_000",
    "0.0.1",
    "NaN",
    "Infinity",
    "-Infinity",
    "$1,234.56",
    "0x10",
    "",
    " 1",
    "1 ",
    "1\n",
    "\n1",
    "1\t",
    // Dígitos que não são os ASCII: a gramática do JSON só conhece de 0 a 9.
    "\u0663",
    "\uff11",
  ])("%j fica texto: não é número na gramática do JSON", (text) => {
    expect(jsonOf("number", text)).toBe(JSON.stringify(text));
  });

  it("o decimal de 30 dígitos e o inteiro além do intervalo seguro estão no arquivo como vieram, e o arquivo inteiro continua JSON válido", () => {
    const decimal = "123456789012345678901234567890.123456789012345678";
    const big = "9007199254740993";
    const text = toJson(sliceOf([column("d", "number"), column("i", "number"), column("s", "number")], [[decimal, big, "12.50"]]));

    expect(text).toContain(`"d": ${decimal},\n`);
    expect(text).toContain(`"i": ${big},\n`);
    expect(text).toContain('"s": 12.50\n');
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("os valores dentro do que o JavaScript guarda voltam, por JSON.parse, como o número", () => {
    const parsed = JSON.parse(toJson(sliceOf([column("v", "number")], [["12.50"], ["-0"], ["1e3"], ["9007199254740991"]]))) as { v: number }[];

    expect(parsed.map((object) => object.v)).toEqual([12.5, -0, 1000, 9007199254740991]);
    expect(Object.is(parsed[1].v, -0)).toBe(true);
  });

  it("uma coluna com os literais de cima e os recusados, misturados, e valores hostis em volta: a saída inteira é JSON válido, e só os recusados são texto", () => {
    const accepted = ["42", "-0", "12.50", "1e400", "9007199254740993", "123456789012345678901234567890.5"];
    const refused = ["007", "+5", ".5", "5.", "NaN", "Infinity", "1 ", "", "\n1", ...hostileValues];
    const rows = [...accepted, ...refused].map((value) => [value, value]);
    const text = toJson(sliceOf([column("n", "number"), column("t")], rows));
    const parsed = JSON.parse(text) as { n: number | string; t: string }[];

    expect(parsed).toHaveLength(rows.length);
    parsed.forEach((object, index) => {
      const value = rows[index][0];
      expect(object.t).toBe(value);
      expect(typeof object.n, value).toBe(index < accepted.length ? "number" : "string");
      if (index >= accepted.length) expect(object.n).toBe(value);
    });
    for (const value of accepted) expect(text, value).toContain(`"n": ${value},\n`);
  });

  it("só a coluna `number` vira número: o mesmo texto numa coluna de texto ou de data fica texto", () => {
    expect(jsonOf("text", "42")).toBe('"42"');
    expect(jsonOf("datetime", "42")).toBe('"42"');
    expect(jsonOf("binary", "0x2a")).toBe('"0x2a"');
  });

  it("célula cortada nunca vira número nem booleano, ainda que o texto pareça", () => {
    expect(jsonOf("number", "42", true)).toBe('"42"');
    expect(jsonOf("boolean", "true", true)).toBe('"true"');
  });
});

describe("toJson: o booleano e o nulo", () => {
  it("true e false, exatamente como a API manda, na coluna booleana", () => {
    expect(jsonOf("boolean", "true")).toBe("true");
    expect(jsonOf("boolean", "false")).toBe("false");
  });

  it.each(["t", "f", "TRUE", "False", "1", "0", "sim", "true ", ""])("%j numa coluna booleana fica texto", (text) => {
    expect(jsonOf("boolean", text)).toBe(JSON.stringify(text));
  });

  it("numa coluna de texto, `true` é texto", () => {
    expect(jsonOf("text", "true")).toBe('"true"');
  });

  it.each(["text", "number", "boolean", "datetime", "binary"] as const)("o nulo de uma coluna %s é null, que não é o texto vazio", (kind) => {
    expect(jsonOf(kind, null)).toBe("null");
    expect(jsonOf(kind, "")).toBe('""');
  });
});

describe("jsonKeys: o nome repetido ganha sufixo", () => {
  it("o primeiro fica com o nome; os repetidos ganham _2, _3… (o primeiro número livre)", () => {
    expect(jsonKeys(["id", "id", "nome", "id"])).toEqual(["id", "id_2", "nome", "id_3"]);
  });

  it("uma coluna que já se chama `id_2` não colide com o sufixo: quem chega depois com o nome tomado também ganha sufixo", () => {
    expect(jsonKeys(["id", "id", "id_2", "id"])).toEqual(["id", "id_2", "id_2_2", "id_3"]);
  });

  it("os nomes são únicos em qualquer entrada", () => {
    const keys = jsonKeys(["a", "a", "a", "a_2", "a_2", "a_3", "", "", "b_2", "b", "b"]);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("no JSON, as colunas repetidas viram chaves distintas e nada se perde", () => {
    const parsed = JSON.parse(toJson(sliceOf([column("x"), column("x")], [["1", "2"]]))) as Record<string, string>[];

    expect(parsed).toEqual([{ x: "1", x_2: "2" }]);
  });
});

describe("toJson: nome de coluna hostil", () => {
  it("aspas, barra, quebra de linha, controle e o nome do protótipo viram chave de verdade, na ordem das colunas", () => {
    const names = ['a"b', "c\\d", "e\nf", "g\th", "__proto__", "constructor", "toString", "10", "2", "zz", ""];
    const text = toJson(sliceOf(names.map((name) => column(name)), [names.map((_, index) => `v${index}`)]));
    const parsed = JSON.parse(text) as Record<string, string>[];

    expect(Object.getOwnPropertyNames(parsed[0]).sort()).toEqual([...names].sort());
    expect(Object.getPrototypeOf(parsed[0])).toBe(Object.prototype);
    names.forEach((name, index) => expect(Object.getOwnPropertyDescriptor(parsed[0], name)?.value).toBe(`v${index}`));
    // A ordem do texto é a das colunas (um objeto do JavaScript poria "2" e "10" na frente).
    const positions = names.map((name) => text.indexOf(`${JSON.stringify(name)}: `));
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
  });

  it("acento e emoji passam sem escape", () => {
    expect(toJson(sliceOf([column("ação")], [[hostile.emoji]]))).toBe(`[\n  {\n    "ação": "${hostile.emoji}"\n  }\n]`);
  });
});
