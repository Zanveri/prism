import { describe, expect, it } from "vitest";

import { csvBom, csvExportOf, csvFieldOf, csvFileName, exportNotice, toCsv } from "./csv";

describe("csvFieldOf: um campo do CSV (RN-TABELA-006)", () => {
  it("texto comum sai como está, com acento e emoji", () => {
    expect(csvFieldOf("apontamento")).toBe("apontamento");
    expect(csvFieldOf("Extrusão A — 🙂")).toBe("Extrusão A — 🙂");
    expect(csvFieldOf("12480.000")).toBe("12480.000");
  });

  it("o nulo é um campo vazio", () => {
    expect(csvFieldOf(null)).toBe("");
    expect(csvFieldOf("")).toBe("");
  });

  it("o separador `;`, a aspa e a quebra de linha põem o campo entre aspas; a aspa de dentro é dobrada", () => {
    expect(csvFieldOf("a;b")).toBe('"a;b"');
    expect(csvFieldOf('ele disse "oi"')).toBe('"ele disse ""oi"""');
    expect(csvFieldOf("linha1\nlinha2")).toBe('"linha1\nlinha2"');
    expect(csvFieldOf("linha1\r\nlinha2")).toBe('"linha1\r\nlinha2"');
    expect(csvFieldOf("só\rCR")).toBe('"só\rCR"');
  });

  it("a vírgula e o apóstrofo comuns não pedem aspas (o separador é `;`)", () => {
    expect(csvFieldOf("1,5")).toBe("1,5");
    expect(csvFieldOf("O'Brien")).toBe("O'Brien");
  });

  it.each(["=", "+", "-", "@"])("o valor que começa por %s leva um apóstrofo na frente: a planilha não o executa", (start) => {
    expect(csvFieldOf(`${start}1+1`)).toBe(`'${start}1+1`);
    expect(csvFieldOf(`${start}cmd|' /C calc'!A0`)).toBe(`'${start}cmd|' /C calc'!A0`);
  });

  it("o apóstrofo e as aspas se combinam: `=1;2` vira `\"'=1;2\"`", () => {
    expect(csvFieldOf("=1;2")).toBe(`"'=1;2"`);
    expect(csvFieldOf('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
  });

  it("só o começo conta: um `=`, `+`, `-` ou `@` no meio não muda nada", () => {
    expect(csvFieldOf("a=b")).toBe("a=b");
    expect(csvFieldOf("a-b")).toBe("a-b");
    expect(csvFieldOf("nome@dominio")).toBe("nome@dominio");
    expect(csvFieldOf("1+1")).toBe("1+1");
  });

  it("o primeiro caractere DEPOIS de espaços, tabulação ou retorno de carro é o que conta: `\\t=1+1` não sai cru (a planilha ignora o branco do começo)", () => {
    expect(csvFieldOf(" =1")).toBe("' =1");
    expect(csvFieldOf("\t=1+1")).toBe("'\t=1+1");
    expect(csvFieldOf("  \t @x")).toBe("'  \t @x");
    expect(csvFieldOf("\t+cmd")).toBe("'\t+cmd");
    expect(csvFieldOf(" -SOMA(A1)")).toBe("' -SOMA(A1)");
    // O retorno de carro leva o campo para entre aspas, e o apóstrofo fica dentro delas.
    expect(csvFieldOf("\r=1")).toBe(`"'\r=1"`);
  });

  it("o branco do começo seguido de outra coisa não muda nada", () => {
    expect(csvFieldOf(" a=1")).toBe(" a=1");
    expect(csvFieldOf("\tx")).toBe("\tx");
    expect(csvFieldOf("  ")).toBe("  ");
  });

  it.each(["-12.5", "-1,5", "-1", "-0,5", "-.5", "-,5", "-1e5", "-1.5E+10", "-1,5e-3", "-007"])("o número simples %s, negativo, sai como está: a coluna segue somando", (value) => {
    expect(csvFieldOf(value)).toBe(value);
  });

  it("o que parece número mas não é segue guardado com o apóstrofo: conta, texto, sinal duplo, ponto sem dígitos", () => {
    for (const value of ["-1+1", "-1 2", "-1,5,2", "-1.2.3", "--5", "-", "-A1", "-1.", "-1e", "-1e+", "-1,5;", "+5", "+1,5", " -5", "-5 "]) {
      expect(csvFieldOf(value).replace(/^"/, "").startsWith("'"), JSON.stringify(value)).toBe(true);
    }
  });

  it("o número simples sem sinal nunca precisou de apóstrofo", () => {
    expect(csvFieldOf("12.5")).toBe("12.5");
    expect(csvFieldOf("1,5")).toBe("1,5");
  });
});

describe("toCsv: o arquivo das linhas carregadas (RN-TABELA-006)", () => {
  const columns = ["id", "nome", "obs"];
  const rows = [
    ["1", "Ana", null],
    ["2", "O'Brien; filho", 'disse "oi"'],
  ];

  it("começa pelo BOM do UTF-8, e o separador é `;`", () => {
    const csv = toCsv(columns, rows);

    expect(csv.startsWith(csvBom)).toBe(true);
    expect(csvBom).toBe("\uFEFF");
    expect(csv.slice(1).split("\r\n")[0]).toBe("id;nome;obs");
  });

  it("a primeira linha são os nomes das colunas, depois uma linha por registro, cada uma terminada por CRLF", () => {
    expect(toCsv(columns, rows)).toBe('\uFEFFid;nome;obs\r\n1;Ana;\r\n2;"O\'Brien; filho";"disse ""oi"""\r\n');
  });

  it("sem linhas, só o cabeçalho", () => {
    expect(toCsv(columns, [])).toBe("\uFEFFid;nome;obs\r\n");
  });

  it("o nome de coluna hostil também leva o apóstrofo e as aspas", () => {
    expect(toCsv(["=cmd", "a;b"], [["1", "2"]])).toBe("\uFEFF'=cmd;\"a;b\"\r\n1;2\r\n");
  });

  it("o arquivo codificado em UTF-8 começa pelos três bytes do BOM e guarda o acento", () => {
    const bytes = new TextEncoder().encode(toCsv(["nome"], [["ação"]]));

    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)).toContain("ação");
  });
});

describe("csvFileName: o nome que o diálogo de salvar propõe", () => {
  it("esquema e tabela, com `.csv`", () => {
    expect(csvFileName("producao", "apontamento")).toBe("producao.apontamento.csv");
  });

  it("o que o Windows não aceita num nome de arquivo vira `_`", () => {
    expect(csvFileName("a/b", 'c:d*e?"f<g>h|i')).toBe("a_b.c_d_e__f_g_h_i.csv");
    expect(csvFileName("s", "t\\u")).toBe("s.t_u.csv");
  });

  it("caractere de controle e de direção de texto SAI do nome (não vira `_`): a quebra de linha, o NUL, o sino, o U+202E que inverte o que se lê", () => {
    const rlo = String.fromCharCode(0x202e);
    const lro = String.fromCharCode(0x202d);
    const isolate = String.fromCharCode(0x2066);
    const lrm = String.fromCharCode(0x200e);
    const alm = String.fromCharCode(0x061c);

    expect(csvFileName("s", "linha1\nlinha2")).toBe("s.linha1linha2.csv");
    expect(csvFileName("s", `a${String.fromCharCode(0)}b${String.fromCharCode(7)}c${String.fromCharCode(127)}d`)).toBe("s.abcd.csv");
    expect(csvFileName("s", `fatura${rlo}vsc.exe`)).toBe("s.faturavsc.exe.csv");
    expect(csvFileName("s", `${lro}x${isolate}y${lrm}z${alm}w`)).toBe("s.xyzw.csv");
    expect(csvFileName(`a${rlo}`, "t")).toBe("a.t.csv");
  });

  it("o espaço de largura zero (U+200B) e os separadores de linha e de parágrafo (U+2028 e U+2029) também saem do nome", () => {
    const zeroWidthSpace = String.fromCharCode(0x200b);
    const lineSeparator = String.fromCharCode(0x2028);
    const paragraphSeparator = String.fromCharCode(0x2029);

    expect(csvFileName("s", `a${zeroWidthSpace}b${lineSeparator}c${paragraphSeparator}d`)).toBe("s.abcd.csv");
    // O nome de dispositivo "disfarçado" por um caractere invisível é o dispositivo, depois de limpo.
    expect(csvFileName(`con${zeroWidthSpace}`, "t")).toBe("_con.t.csv");
    expect(csvFileName(`${zeroWidthSpace}${lineSeparator}`, paragraphSeparator)).toBe("registros.csv");
  });

  it("a marca de ordem de bytes (U+FEFF), o juntador de palavras (U+2060) e o hífen opcional (U+00AD) também saem: não se veem e fazem dois nomes iguais serem arquivos diferentes", () => {
    const byteOrderMark = String.fromCharCode(0xfeff);
    const wordJoiner = String.fromCharCode(0x2060);
    const softHyphen = String.fromCharCode(0x00ad);

    expect(csvFileName("s", `a${byteOrderMark}b${wordJoiner}c${softHyphen}d`)).toBe("s.abcd.csv");
    expect(csvFileName(`${byteOrderMark}loja`, `pe${softHyphen}didos${wordJoiner}`)).toBe("loja.pedidos.csv");
    // O dispositivo "disfarçado" por um deles é o dispositivo, depois de limpo; e o nome feito só deles cai no padrão.
    for (const hidden of [byteOrderMark, wordJoiner, softHyphen]) expect(csvFileName(`nu${hidden}l`, "t")).toBe("_nul.t.csv");
    expect(csvFileName(byteOrderMark, `${wordJoiner}${softHyphen}`)).toBe("registros.csv");
    // O hífen de verdade e o espaço comum ficam.
    expect(csvFileName("s", "meio-dia e meia")).toBe("s.meio-dia e meia.csv");
  });

  it("o nome reservado do Windows (con, prn, aux, nul, com0 a com9, lpt0 a lpt9, conin$ e conout$), com qualquer caixa e com extensão, ganha um prefixo", () => {
    for (const reserved of ["con", "CON", "Prn", "aux", "NUL", "com1", "COM9", "lpt1", "LPT9", "com0", "COM0", "lpt0", "Lpt0", "conin$", "CONIN$", "conout$", "ConOut$"]) {
      expect(csvFileName(reserved, "t"), reserved).toBe(`_${reserved}.t.csv`);
    }
  });

  it("o nome de dispositivo seguido de espaço, antes do primeiro ponto, continua sendo o dispositivo para o Windows: `con .t.csv` não abre", () => {
    expect(csvFileName("con ", "t")).toBe("_con .t.csv");
    expect(csvFileName("NUL   ", "t")).toBe("_NUL   .t.csv");
    expect(csvFileName("lpt0 ", "t")).toBe("_lpt0 .t.csv");
    // Seguido de ponto, o que vem antes do primeiro ponto já é o nome puro.
    expect(csvFileName("con.", "t")).toBe("_con..t.csv");
    expect(csvFileName("aux .", "t")).toBe("_aux ..t.csv");
  });

  it("só vale o que vem antes do primeiro ponto: a tabela com esse nome, e os nomes parecidos, não ganham prefixo", () => {
    expect(csvFileName("s", "con")).toBe("s.con.csv");
    expect(csvFileName("s", "con ")).toBe("s.con.csv");
    expect(csvFileName("console", "t")).toBe("console.t.csv");
    expect(csvFileName("con x", "t")).toBe("con x.t.csv");
    expect(csvFileName("com10", "t")).toBe("com10.t.csv");
    expect(csvFileName("lpt", "t")).toBe("lpt.t.csv");
    expect(csvFileName("conin", "t")).toBe("conin.t.csv");
    expect(csvFileName("conout", "t")).toBe("conout.t.csv");
  });

  it("não termina em ponto nem em espaço antes da extensão, e não passa de um tamanho razoável", () => {
    expect(csvFileName("s", "t. ")).toBe("s.t.csv");
    expect(csvFileName("s", "x".repeat(500)).length).toBeLessThanOrEqual(130);
    expect(csvFileName("s", "x".repeat(500)).endsWith(".csv")).toBe(true);
  });

  it("um nome que sobra vazio cai num nome padrão", () => {
    expect(csvFileName("", "")).toBe("registros.csv");
    expect(csvFileName("...", "   ")).toBe("registros.csv");
  });
});

describe("exportNotice: o aviso de quando a exportação começa (RN-TABELA-006)", () => {
  it("diz o que se sabe, que são N linhas indo para o arquivo, e não que foram gravadas: a pessoa ainda vai confirmar o diálogo de salvar", () => {
    expect(exportNotice({ count: 650, hasMore: false, cut: 0 })).toEqual({ tone: "success", text: "Exportando 650 linhas…" });
    expect(exportNotice({ count: 1, hasMore: false, cut: 0 }).text).toBe("Exportando 1 linha…");
    expect(exportNotice({ count: 650, hasMore: false, cut: 0 }).text).not.toMatch(/exportadas?\b/);
  });

  it("havendo mais a ler, diz que as não carregadas não entram, e é um aviso de atenção", () => {
    expect(exportNotice({ count: 200, hasMore: true, cut: 0 })).toEqual({ tone: "warning", text: "Exportando 200 linhas… As linhas que ainda não foram carregadas não entram no arquivo." });
  });

  it("o valor que não pôde vir inteiro sai cortado, e o aviso diz quantos (RN-SQL-017)", () => {
    const one = exportNotice({ count: 3, hasMore: false, cut: 1 });
    const two = exportNotice({ count: 3, hasMore: false, cut: 2 });

    expect(one.tone).toBe("warning");
    expect(one.text).toBe("Exportando 3 linhas… 1 valor não pôde vir inteiro e sai cortado no arquivo.");
    expect(two.text).toBe("Exportando 3 linhas… 2 valores não puderam vir inteiros e saem cortados no arquivo.");
  });
});

describe("csvExportOf: o que 'Exportar CSV' entrega das linhas carregadas (RN-TABELA-006)", () => {
  const columns = [
    { name: "id", type: "bigint", kind: "number" as const },
    { name: "descrição", type: "varchar(60)", kind: "text" as const },
  ];
  const result = { columns, rows: [["1", "Extrusão A"], ["2", null], ["3", "=1+1"]], hasMore: false, truncated: new Map<number, ReadonlySet<number>>() };

  it("o arquivo tem os nomes das colunas e as linhas carregadas, e o nome é esquema.tabela.csv", () => {
    const { fileName, text } = csvExportOf(result, "producao", "apontamento");

    expect(fileName).toBe("producao.apontamento.csv");
    expect(text).toBe(`${csvBom}id;descrição\r\n1;Extrusão A\r\n2;\r\n3;'=1+1\r\n`);
  });

  it("lido tudo: o aviso diz quantas linhas saíram, e é um sucesso", () => {
    expect(csvExportOf(result, "producao", "apontamento").notice).toEqual({ tone: "success", text: "Exportando 3 linhas…" });
  });

  it("com mais linhas a ler, só as carregadas entram, e o aviso diz que as outras não entram", () => {
    const { text, notice } = csvExportOf({ ...result, hasMore: true }, "producao", "apontamento");

    expect(text.split("\r\n")).toHaveLength(5);
    expect(notice.tone).toBe("warning");
    expect(notice.text).toContain("Exportando 3 linhas…");
    expect(notice.text).toContain("As linhas que ainda não foram carregadas não entram no arquivo.");
  });

  it("o valor que continua cortado (a API não tinha o completo) sai cortado, e o aviso diz quantos", () => {
    const { notice } = csvExportOf({ ...result, truncated: new Map([[2, new Set([1])]]) }, "producao", "apontamento");

    expect(notice.tone).toBe("warning");
    expect(notice.text).toContain("1 valor não pôde vir inteiro e sai cortado no arquivo.");
  });

  it("sem nenhuma linha carregada, só o cabeçalho", () => {
    const { text, notice } = csvExportOf({ ...result, rows: [] }, "producao", "apontamento");

    expect(text).toBe(`${csvBom}id;descrição\r\n`);
    expect(notice.text).toBe("Exportando 0 linhas…");
  });
});
