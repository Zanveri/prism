import { describe, expect, it, vi } from "vitest";

import { buildCopyText, cellsFloor, clipboardLimit, columnNamesText, copiedNotice, copyCeiling, copyField, loadedRowsMeter, rowNumbersOf, utf8Length, wellFormed, type CopyPlan } from "./grid-copy";

const pg = 1 as const;
const db2 = 2 as const;

/** O que copiar, de uma tabela de valores. */
const planOf = (rows: (string | null)[][], header: string[] | null = null): CopyPlan => ({ header, rows: rows.length, columns: rows[0]?.length ?? 0, valueAt: (row, column) => rows[row][column] });
const textOf = async (plan: CopyPlan) => {
  const outcome = await buildCopyText(plan, { pause: async () => {} });
  return outcome.kind === "text" ? outcome.text : outcome.kind;
};

describe("o texto do Copiar (RN-GRADE-002)", () => {
  it("uma célula só é o valor puro, sem aspas; o nulo é vazio", async () => {
    expect(await textOf(planOf([['a\t"b"']]))).toBe('a\t"b"');
    expect(await textOf(planOf([[null]]))).toBe("");
  });

  it("várias células: tabulação entre as colunas, LF entre as linhas, sem quebra depois da última", async () => {
    expect(await textOf(planOf([["1", "Ana"], ["2", null]]))).toBe("1\tAna\n2\t");
  });

  it("com mais de uma célula, o valor com tabulação, aspa, quebra de linha ou retorno de carro vai entre aspas, com a aspa dobrada; o nulo nunca", async () => {
    expect(await textOf(planOf([['a"b', "c\td", "e\nf", "g\rh", null, "simples"]]))).toBe('"a""b"\t"c\td"\t"e\nf"\t"g\rh"\t\tsimples');
  });

  it("com o cabeçalho, uma célula só são duas linhas: o nome e o valor, com as aspas da regra também no nome", async () => {
    expect(await textOf(planOf([["10"]], ["id"]))).toBe("id\n10");
    expect(await textOf(planOf([['x"y']], ['nome "completo"']))).toBe('"nome ""completo"""\n"x""y"');
  });

  it("não põe a proteção contra fórmula: o pedido é o valor puro (quem a quer usa o 'Copiar como CSV')", async () => {
    expect(await textOf(planOf([["=SOMA(A1)", "-12"]]))).toBe("=SOMA(A1)\t-12");
  });

  it("o Unicode fora do plano básico e as marcas de direção vão como estão; o par substituto solto vira U+FFFD", async () => {
    expect(await textOf(planOf([["😀‏"]]))).toBe("😀‏");
    expect(wellFormed("a\ud800b\udc00")).toBe("a�b�");
    expect(copyField("\ud83d", false)).toBe("�");
  });

  it("o tamanho é o do UTF-8, e o par substituto solto conta como o U+FFFD", () => {
    expect(utf8Length("aé€😀")).toBe(1 + 2 + 3 + 4);
    expect(utf8Length("\ud800")).toBe(3);
  });

  it("passa de 10 MiB: para na hora, sem texto; na medida exata, copia", async () => {
    const half = "x".repeat(clipboardLimit / 2);
    expect((await buildCopyText(planOf([[half], [half]]), { pause: async () => {} })).kind).toBe("tooLarge");
    expect((await buildCopyText(planOf([[half.slice(1)], [half]]), { pause: async () => {} })).kind).toBe("text");
  });

  it("a medida só soma, sem montar o texto, e diz o mesmo tamanho", async () => {
    const plan = planOf([["á", "b"], ["c", null]], ["x", "y"]);
    const built = await buildCopyText(plan, { pause: async () => {} });
    const measured = await buildCopyText(plan, { pause: async () => {}, measure: true });

    expect(built.kind === "text" && measured.kind === "text" ? [utf8Length(built.text), measured.bytes, measured.text] : null).toEqual([built.kind === "text" ? built.bytes : -1, built.kind === "text" ? built.bytes : -1, ""]);
  });

  it("o teto sem montar o texto nunca fica abaixo do tamanho de verdade (três bytes por unidade, as aspas, o separador)", async () => {
    const plan = planOf([['"""', "€😀", null, "a\tb"]], ["x"]);
    const built = await buildCopyText(plan, { pause: async () => {} });

    expect(built.kind === "text" ? copyCeiling(plan) >= built.bytes : false).toBe(true);
  });

  it("cem mil células são montadas em partes, que cedem a vez à tela; cancelado no meio, não sai texto", async () => {
    const plan: CopyPlan = { header: null, rows: 5_000, columns: 20, valueAt: (row, column) => `${row}-${column}` };
    const pause = vi.fn(async () => {});

    const outcome = await buildCopyText(plan, { pause });
    expect(outcome.kind).toBe("text");
    expect(pause).toHaveBeenCalledTimes(20);

    const controller = new AbortController();
    const cancelled = await buildCopyText(plan, { pause: async () => controller.abort(), signal: controller.signal });
    expect(cancelled).toEqual({ kind: "cancelled" });
  });

  it("os avisos: uma célula, com e sem cabeçalho; várias, pelas linhas", () => {
    expect(copiedNotice({ rows: 1, cells: 1, header: false })).toBe("Copiado.");
    expect(copiedNotice({ rows: 1, cells: 1, header: true })).toBe("Copiado, com o cabeçalho.");
    expect(copiedNotice({ rows: 1, cells: 3, header: false })).toBe("1 linha copiada.");
    expect(copiedNotice({ rows: 3, cells: 6, header: false })).toBe("3 linhas copiadas.");
    expect(copiedNotice({ rows: 3, cells: 6, header: true })).toBe("3 linhas copiadas, com o cabeçalho.");
  });
});

describe("os nomes das colunas e os números das linhas (RN-GRADE-015)", () => {
  it("os nomes como o banco pede: sem aspas o simples, entre aspas o que precisa delas, separados por tabulação", () => {
    expect(columnNamesText(["id", "Nome", "criado"], pg)).toBe('id\t"Nome"\tcriado');
    expect(columnNamesText(["ID", "nome"], db2)).toBe('ID\t"nome"');
    expect(columnNamesText(["order", "com espaço", "id", "id"], pg)).toBe('"order"\t"com espaço"\tid\tid');
  });

  it("os números como a grade os mostra, de 1 em diante, em ordem; as linhas novas não têm número", () => {
    expect(rowNumbersOf([0, 2, 4, 5, 6], 5)).toEqual([1, 3, 5]);
    expect(rowNumbersOf([5, 6], 5)).toEqual([]);
  });
});

describe("a conta do limite enquanto as linhas que faltam chegam (RN-GRADE-023)", () => {
  it("o piso é a soma dos valores em UTF-8 e um separador por célula; cada página soma as colunas copiadas, e passar do limite para", () => {
    expect(cellsFloor([["ab", null], ["ç", "1"]])).toBe(3 + 1 + 3 + 2);

    const meter = loadedRowsMeter([1], 4, 10);
    const rows = [["x", "aa"], ["y", "bbb"], ["z", "cccc"]];
    expect(meter({ rows: rows.slice(0, 1) }, 0)).toBe(true);
    expect(meter({ rows: rows.slice(0, 2) }, 1)).toBe(true);
    expect(meter({ rows }, 2)).toBe(false);
  });

  it("o padrão é o limite da área de transferência", () => {
    expect(loadedRowsMeter([0], clipboardLimit)({ rows: [] }, 0)).toBe(true);
    expect(loadedRowsMeter([0], clipboardLimit)({ rows: [["", "a"], ["x"]] }, 1)).toBe(false);
  });
});
