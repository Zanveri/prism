import { describe, expect, it } from "vitest";

import { csvBom, toCsv } from "../csv";
import { column, hostile, hostileValues, sliceOf } from "./test-fixtures";
import { copyAsText, csvOptions, simpleCopyOptions, toDelimited, tsvOptions, type DelimitedOptions } from "./to-delimited";

const with_ = (changes: Partial<DelimitedOptions>): DelimitedOptions => ({ ...csvOptions, ...changes });

describe("toDelimited com as opções do CSV de hoje é, byte a byte, o `toCsv` (RN-TABELA-006)", () => {
  const numbers = ["-12.5", "-1,5", "-007", "-1+1", "+5", " -5", "12480.000", "-", "-1e5", "-1."];

  it("passa por todos os valores hostis, em linhas com nulo e em nomes de coluna hostis", () => {
    const columns = [column("id", "number"), column("=nome"), column("a;b"), column('x"y'), column("quebra\nde linha")];
    const rows = [...hostileValues, ...numbers].map((value, index) => [String(index), value, index % 2 === 0 ? null : value, value, ""]);

    expect(toDelimited(sliceOf(columns, rows), csvOptions)).toBe(
      toCsv(
        columns.map((c) => c.name),
        rows,
      ),
    );
  });

  it("recorte vazio: sem colunas e sem linhas, ou só as colunas", () => {
    expect(toDelimited(sliceOf([], []), csvOptions)).toBe(toCsv([], []));
    expect(toDelimited(sliceOf([column("a"), column("b")], []), csvOptions)).toBe(toCsv(["a", "b"], []));
    expect(toDelimited(sliceOf([column("a")], []), csvOptions)).toBe(`${csvBom}a\r\n`);
  });

  it("uma célula só", () => {
    expect(toDelimited(sliceOf([column("a")], [["x;y"]]), csvOptions)).toBe(`${csvBom}a\r\n"x;y"\r\n`);
  });

  it("o CSV é `;`, com BOM, CRLF, aspas só quando precisa, nulo vazio e a guarda contra fórmula ligada", () => {
    expect(csvOptions).toEqual({ delimiter: ";", header: true, rowNumber: false, quoting: "auto", nullText: "", formulaGuard: true, bom: true, lineBreak: "\r\n" });
  });
});

describe("toDelimited: o delimitador", () => {
  it.each(["\t", ";", ",", "|"] as const)("%j (tabulação, ponto e vírgula, vírgula ou barra vertical) separa as células, e o valor que o tem vai entre aspas no modo auto", (delimiter) => {
    const slice = sliceOf([column("a"), column("b")], [[`x${delimiter}y`, "z"]]);

    expect(toDelimited(slice, with_({ delimiter, bom: false, lineBreak: "\n" }))).toBe(`a${delimiter}b\n"x${delimiter}y"${delimiter}z\n`);
  });

  it("os outros delimitadores não pedem aspas", () => {
    const slice = sliceOf([column("a")], [["a;b,c|d"], ["e\tf"]]);

    expect(toDelimited(slice, with_({ delimiter: "\t", bom: false, lineBreak: "\n" }))).toBe('a\na;b,c|d\n"e\tf"\n');
    expect(toDelimited(slice, with_({ delimiter: "|", bom: false, lineBreak: "\n" }))).toBe('a\n"a;b,c|d"\ne\tf\n');
  });

  it("TSV: tabulação, com a mesma guarda e o mesmo BOM do CSV", () => {
    expect(tsvOptions).toEqual({ ...csvOptions, delimiter: "\t" });
    expect(toDelimited(sliceOf([column("a"), column("b")], [["=1+1", "x\ty"]]), tsvOptions)).toBe(`${csvBom}a\tb\r\n'=1+1\t"x\ty"\r\n`);
  });
});

describe("toDelimited: as aspas", () => {
  const slice = sliceOf([column("a"), column("b")], [["texto", 'diz "oi"'], ["linha1\nlinha2", null]]);

  it("auto: só quando o valor tem o delimitador, aspa ou quebra de linha (\\n, \\r\\n ou \\r), e a aspa de dentro é dobrada", () => {
    expect(toDelimited(slice, with_({ bom: false, lineBreak: "\n" }))).toBe('a;b\ntexto;"diz ""oi"""\n"linha1\nlinha2";\n');
    expect(toDelimited(sliceOf([column("a")], [[hostile.crlf], [hostile.cr]]), with_({ bom: false, lineBreak: "\n" }))).toBe(`a\n"${hostile.crlf}"\n"${hostile.cr}"\n`);
  });

  it("always: todo valor e todo nome de coluna vão entre aspas; o nulo continua sem aspas, para não virar texto vazio", () => {
    expect(toDelimited(slice, with_({ quoting: "always", bom: false, lineBreak: "\n" }))).toBe('"a";"b"\n"texto";"diz ""oi"""\n"linha1\nlinha2";\n');
  });

  it("never: nada vai entre aspas, nem o que quebraria o arquivo (a escolha é de quem a faz)", () => {
    expect(toDelimited(slice, with_({ quoting: "never", bom: false, lineBreak: "\n" }))).toBe('a;b\ntexto;diz "oi"\nlinha1\nlinha2;\n');
  });
});

describe("toDelimited: o nulo", () => {
  const slice = sliceOf([column("a"), column("b")], [[null, ""]]);

  it("vazio por padrão, e diferente do texto vazio só no modo always", () => {
    expect(toDelimited(slice, with_({ bom: false, lineBreak: "\n" }))).toBe("a;b\n;\n");
    expect(toDelimited(slice, with_({ quoting: "always", bom: false, lineBreak: "\n" }))).toBe('"a";"b"\n;""\n');
  });

  it("o texto escolhido sai como está, sem a guarda contra fórmula: `-` é um marcador de nulo legítimo", () => {
    expect(toDelimited(slice, with_({ nullText: "NULL", bom: false, lineBreak: "\n" }))).toBe("a;b\nNULL;\n");
    expect(toDelimited(slice, with_({ nullText: "-", bom: false, lineBreak: "\n" }))).toBe("a;b\n-;\n");
  });

  it("o texto do nulo que tem o delimitador vai entre aspas, para o arquivo continuar legível (salvo no modo never)", () => {
    expect(toDelimited(slice, with_({ nullText: "n;a", bom: false, lineBreak: "\n" }))).toBe('a;b\n"n;a";\n');
    expect(toDelimited(slice, with_({ nullText: "n;a", quoting: "never", bom: false, lineBreak: "\n" }))).toBe("a;b\nn;a;\n");
  });
});

describe("toDelimited: a guarda contra fórmula (RN-TABELA-006)", () => {
  it.each([hostile.formulaEquals, hostile.formulaPlus, hostile.formulaMinus, hostile.formulaAt, hostile.formulaCommand, hostile.formulaAfterSpace])("%j leva o apóstrofo quando a guarda está ligada, e sai cru quando não", (value) => {
    const slice = sliceOf([column("a")], [[value]]);
    const raw = toDelimited(slice, with_({ formulaGuard: false, quoting: "never", bom: false, lineBreak: "\n" }));
    const guarded = toDelimited(slice, with_({ formulaGuard: true, quoting: "never", bom: false, lineBreak: "\n" }));

    expect(raw).toBe(`a\n${value}\n`);
    expect(guarded).toBe(`a\n'${value}\n`);
  });

  it("o número simples, inclusive o negativo, sai como está mesmo com a guarda ligada", () => {
    expect(toDelimited(sliceOf([column("n", "number")], [["-12.5"], ["-1,5"], ["12"]]), with_({ bom: false, lineBreak: "\n" }))).toBe("n\n-12.5\n-1,5\n12\n");
  });

  it("vale também para o nome da coluna, e o apóstrofo e as aspas se combinam", () => {
    expect(toDelimited(sliceOf([column("=cmd"), column("a")], [["=1;2", "x"]]), with_({ bom: false, lineBreak: "\n" }))).toBe("'=cmd;a\n\"'=1;2\";x\n");
  });

  it("não vale para o número da linha nem para o rótulo dele", () => {
    expect(toDelimited(sliceOf([column("a")], [["x"]], { rowNumbers: [-3] }), with_({ rowNumber: true, bom: false, lineBreak: "\n" }))).toBe("#;a\n-3;x\n");
  });
});

describe("toDelimited: cabeçalho, número da linha, BOM e quebra de linha", () => {
  const slice = sliceOf([column("a"), column("b")], [["1", "2"], ["3", "4"]], { rowNumbers: [5, 9] });

  it("sem cabeçalho, só as linhas", () => {
    expect(toDelimited(slice, with_({ header: false, bom: false, lineBreak: "\n" }))).toBe("1;2\n3;4\n");
  });

  it("o número da linha é o da grade (não a posição no recorte), com o rótulo `#` quando há cabeçalho", () => {
    expect(toDelimited(slice, with_({ rowNumber: true, bom: false, lineBreak: "\n" }))).toBe("#;a;b\n5;1;2\n9;3;4\n");
    expect(toDelimited(slice, with_({ rowNumber: true, header: false, bom: false, lineBreak: "\n" }))).toBe("5;1;2\n9;3;4\n");
  });

  it("faltando o número de uma linha, vale a posição dela no recorte", () => {
    expect(toDelimited({ ...slice, rowNumbers: [7] }, with_({ rowNumber: true, header: false, bom: false, lineBreak: "\n" }))).toBe("7;1;2\n2;3;4\n");
  });

  it("o BOM é o primeiro caractere, e só quando pedido", () => {
    expect(toDelimited(slice, with_({ bom: true })).startsWith(csvBom)).toBe(true);
    expect(toDelimited(slice, with_({ bom: false })).startsWith(csvBom)).toBe(false);
    expect([...new TextEncoder().encode(toDelimited(slice, with_({ bom: true }))).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("a quebra de linha é a escolhida, e termina cada linha, a última também", () => {
    expect(toDelimited(slice, with_({ bom: false, lineBreak: "\n" }))).toBe("a;b\n1;2\n3;4\n");
    expect(toDelimited(slice, with_({ bom: false, lineBreak: "\r\n" }))).toBe("a;b\r\n1;2\r\n3;4\r\n");
  });
});

describe("toDelimited: o que a grade tem de diferente", () => {
  it("célula cortada, coluna binária e nomes repetidos saem como vieram: o texto é o da grade", () => {
    const slice = sliceOf([column("x"), column("x"), column("foto", "binary")], [["cortado…", "ok", "0x00ff00"]], { truncated: [[0, 0]] });

    expect(toDelimited(slice, with_({ bom: false, lineBreak: "\n" }))).toBe("x;x;foto\ncortado…;ok;0x00ff00\n");
  });

  it("acento, emoji, caractere de controle e par solto passam sem mudança (o arquivo é UTF-8 de quem o grava)", () => {
    for (const value of [hostile.accents, hostile.emoji, hostile.controls, hostile.loneSurrogate]) {
      expect(toDelimited(sliceOf([column("a")], [[value]]), with_({ bom: false, lineBreak: "\n" }))).toBe(`a\n${value}\n`);
    }
  });
});

describe("copyAsText: o copiar simples (RN-GRADE-002)", () => {
  it("as opções são as da tabulação, sem cabeçalho, aspas no modo auto, nulo vazio, sem guarda e sem BOM", () => {
    expect(simpleCopyOptions).toEqual({ delimiter: "\t", header: false, rowNumber: false, quoting: "auto", nullText: "", formulaGuard: false, bom: false, lineBreak: "\n" });
  });

  it("uma célula só sai como o valor puro, sem aspas, qualquer que seja o valor", () => {
    for (const value of hostileValues) expect(copyAsText(sliceOf([column("a")], [[value]]))).toBe(value);
  });

  it("uma célula nula sai vazia", () => {
    expect(copyAsText(sliceOf([column("a")], [[null]]))).toBe("");
  });

  it("várias células: tabulação entre as colunas, quebra de linha entre as linhas e nenhuma quebra no fim; o nulo vai vazio", () => {
    expect(copyAsText(sliceOf([column("a"), column("b")], [["1", null], ["3", "4"]]))).toBe("1\t\n3\t4");
  });

  it("o valor que uma planilha leria errado vai entre aspas, e o que parece fórmula sai como é (sem guarda)", () => {
    expect(copyAsText(sliceOf([column("a"), column("b")], [["=1+1", "x\ty"], [hostile.lf, hostile.quote]]))).toBe('=1+1\t"x\ty"\n"linha1\nlinha2"\t"ele disse ""oi"""');
  });

  it("com cabeçalho, os nomes das colunas vêm primeiro, até numa célula só", () => {
    expect(copyAsText(sliceOf([column("a"), column("b")], [["1", "2"]]), true)).toBe("a\tb\n1\t2");
    expect(copyAsText(sliceOf([column("a")], [["1"]]), true)).toBe("a\n1");
  });

  it("recorte vazio: nada", () => {
    expect(copyAsText(sliceOf([], []))).toBe("");
    expect(copyAsText(sliceOf([column("a")], []))).toBe("");
  });
});
