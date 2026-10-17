import { describe, expect, it, vi } from "vitest";

import { defaultOptions, type FormatOptions } from "../data-export/export-options";
import { writeDocument } from "../grid-export/documents";
import { copyAsNotice, copyDocument, copyProblems, cutCellsToFetch, duplicateColumnOf, needsTable, noColumnsMessage, pickColumns, previewLimits, previewOf, resolvedOptions, runCopyAs, sourceSize, targetOf, type CopySource, type FetchedValue } from "./copy-as";

const options = (change: Partial<{ [K in keyof FormatOptions]: Partial<FormatOptions[K]> }> = {}): FormatOptions => {
  const base = defaultOptions({ schema: "", table: "" });
  return Object.fromEntries(Object.entries(base).map(([key, value]) => [key, { ...value, ...(change[key as keyof FormatOptions] ?? {}) }])) as FormatOptions;
};

const source = (change: Partial<CopySource> = {}): CopySource => ({
  engine: 1,
  sourceName: "pedido",
  table: { schema: "estoque", name: "pedido" },
  columns: [
    { name: "id", type: "int4", kind: "number", generated: "always" },
    { name: "nome", type: "text", kind: "text", generated: null },
  ],
  rows: [
    { number: 1, values: ["1", "Ana"] },
    { number: 2, values: ["2", "Bia"] },
  ],
  ...change,
});

/** Uma junção com dois `id` (RN-GRADE-016): o de `pedido` e o de `cliente`, nenhum calculado pelo banco. */
const joined = source({
  table: { schema: "estoque", name: "pedido" },
  columns: [
    { name: "id", type: "int4", kind: "number", generated: null },
    { name: "id", type: "int4", kind: "number", generated: null },
    { name: "nome", type: "text", kind: "text", generated: null },
  ],
  rows: [{ number: 1, values: ["1", "10", "Ana"] }],
});
const duplicateRefusal = "O resultado tem duas colunas chamadas id: deixe uma de fora da seleção.";

const counts = { cutValues: 0, removedCharacters: 0, skippedRows: 0, notWhole: 0 };

describe("a origem da cópia", () => {
  it("pickColumns: só as colunas pedidas, na ordem pedida, com as marcas de corte e de gerado pelo banco junto", () => {
    const picked = pickColumns(source({ rows: [{ number: 3, values: ["1", "Ana"], cut: [1], generated: [0] }] }), [1]);

    expect(picked.columns.map((column) => column.name)).toEqual(["nome"]);
    expect(picked.rows).toEqual([{ number: 3, values: ["Ana"], cut: [0], generated: [] }]);
  });

  it("o tamanho e a tabela de destino da origem", () => {
    expect(sourceSize(source())).toEqual({ rows: 2, columns: 2 });
    expect(targetOf(source())).toEqual({ schema: "estoque", table: "pedido" });
    expect(targetOf(source({ table: null }))).toEqual({ schema: "", table: "" });
  });

  it("o SQL e o DbUnit precisam da tabela: a do campo, ou a da origem; vazio, a da origem vale", () => {
    expect(needsTable("sql", options(), source({ table: null }))).toBe(true);
    expect(needsTable("dbUnit", options(), source({ table: null }))).toBe(true);
    expect(needsTable("sql", options({ sql: { table: "t" } }), source({ table: null }))).toBe(false);
    expect(needsTable("json", options(), source({ table: null }))).toBe(false);
    expect(needsTable("sql", options(), source())).toBe(false);
    expect(resolvedOptions("sql", options({ sql: { schema: "s" } }), source()).sql).toMatchObject({ schema: "s", table: "pedido" });
    expect(resolvedOptions("dbUnit", options(), source()).dbUnit.table).toBe("pedido");
  });

  it("no SQL sem \"Incluir as colunas que o banco calcula\", a coluna que o banco calcula sempre fica de fora; ligada, entra", () => {
    expect(copyDocument("sql", options(), source())?.context.columns.map((column) => column.name)).toEqual(["nome"]);
    expect(copyDocument("sql", options({ sql: { includeGenerated: true } }), source())?.context.columns).toHaveLength(2);
    expect(copyDocument("json", options(), source())?.context.columns).toHaveLength(2);
    expect(copyDocument("sql", options(), pickColumns(source(), [0]))).toBeNull();
  });

  it("as recusas das opções: a tabela é obrigatória sem a da origem; no SQL, a coluna repetida é recusada como na exportação", () => {
    expect(copyProblems("sql", options(), source({ table: null }))).toEqual({ "options.table": "Informe a tabela de destino." });
    expect(copyProblems("sql", options(), source())).toEqual({});
    expect(copyProblems("txt", options({ txt: { minWidth: "0" } }), source())).toEqual({ "options.minWidth": "A largura mínima vai de 1 a 1.000." });
    expect(copyProblems("sql", options(), joined)).toEqual({ columns: duplicateRefusal });
    expect(copyProblems("sql", options(), { ...joined, table: null })).toEqual({ "options.table": "Informe a tabela de destino.", columns: duplicateRefusal });
    for (const format of ["csv", "txt", "html", "markdown", "json", "sourceCode", "dbUnit", "xml"] as const) expect(copyProblems(format, options(), joined)).toEqual({});
  });

  it("RN-GRADE-016: a coluna repetida é a das que vão no INSERT: a que o banco calcula e fica de fora não conta", () => {
    expect(duplicateColumnOf("sql", options(), joined)).toBe("id");
    expect(duplicateColumnOf("json", options(), joined)).toBeNull();
    const generatedTwice = source({ columns: [source().columns[0], source().columns[0], source().columns[1]], rows: [{ number: 1, values: ["1", "1", "Ana"] }] });
    expect(duplicateColumnOf("sql", options(), generatedTwice)).toBeNull();
    expect(duplicateColumnOf("sql", options({ sql: { includeGenerated: true } }), generatedTwice)).toBe("id");
    // O nome é comparado como está, como na exportação: `id` e `ID` são duas colunas.
    expect(duplicateColumnOf("sql", options(), source({ columns: [joined.columns[0], { ...joined.columns[0], name: "ID" }] }))).toBeNull();
  });

  it("RN-GRADE-016: a coluna repetida sai só dos nomes das colunas, sem ler as linhas, que o diálogo confere a cada mudança das opções", () => {
    const rows = new Proxy([], { get: () => expect.unreachable("as linhas não são lidas") });
    const generatedTwice = { ...source({ columns: [source().columns[0], source().columns[0], source().columns[1]] }), rows };
    expect(duplicateColumnOf("sql", options(), generatedTwice)).toBeNull();
    expect(duplicateColumnOf("sql", options({ sql: { includeGenerated: true } }), generatedTwice)).toBe("id");
    const joinedWithoutRows = { ...joined, rows };
    expect(duplicateColumnOf("sql", options(), joinedWithoutRows)).toBe("id");
  });
});

describe("a prévia do Copiar avançado (RN-GRADE-003)", () => {
  it("é o começo do texto que sairia, até 100 linhas, com as larguras do TXT de verdade", () => {
    const rows = Array.from({ length: 300 }, (_, index) => ({ number: index + 1, values: [String(index), index === 150 ? "um valor mais largo" : "x"] }));
    const big = source({ rows, columns: [source().columns[0], source().columns[1]] });
    const full = writeDocument("txt", { engine: 1, sourceName: "pedido", columns: big.columns, options: options() }, rows).text;
    const preview = previewOf("txt", options(), big);

    expect(preview.text.split("\n")).toHaveLength(previewLimits.lines);
    expect(full.startsWith(preview.text)).toBe(true);
    expect(preview.cut).toBe(false);
  });

  it("com poucas linhas, o texto inteiro; com célula cortada, a prévia diz que a cópia leva os completos", () => {
    const small = source({ rows: [{ number: 1, values: ["1", "Ana…"], cut: [1] }] });
    const preview = previewOf("json", options(), small);

    expect(preview.text).toBe(writeDocument("json", { engine: 1, sourceName: "pedido", columns: small.columns, options: options() }, small.rows).text);
    expect(preview.cut).toBe(true);
  });

  it("no SQL com a coluna repetida, a prévia não mostra o INSERT que a cópia recusa: vem vazia, com a recusa; nos outros formatos, o texto", () => {
    expect(previewOf("sql", options(), joined)).toEqual({ text: "", cut: false, refusal: duplicateRefusal });
    const json = previewOf("json", options(), joined);
    expect(json.refusal).toBeNull();
    expect(json.text).toContain("Ana");
  });

  it("um valor enorme é cortado em 64 KB, sem partir um par substituto", () => {
    const value = `${"a".repeat(previewLimits.units - 13)}🙂${"b".repeat(100)}`;
    const preview = previewOf("csv", options({ csv: { header: false } }), source({ rows: [{ number: 1, values: ["1", value] }] }));

    expect(preview.text.length).toBeLessThanOrEqual(previewLimits.units);
    expect(preview.text).not.toMatch(/\p{Cs}/u);
  });
});

describe("o aviso depois de copiar (RN-GRADE-016)", () => {
  it("o número de linhas e o formato, no tom de sucesso", () => {
    expect(copyAsNotice("json", 3, counts)).toEqual({ tone: "success", text: "3 linhas copiadas em JSON." });
    expect(copyAsNotice("xml", 1, counts)).toEqual({ tone: "success", text: "1 linha copiada em XML." });
    expect(copyAsNotice("sourceCode", 12345, counts).text).toBe("12.345 linhas copiadas em Código fonte.");
  });

  it("o resumo do que não saiu inteiro depois do ponto, no tom de atenção", () => {
    expect(copyAsNotice("txt", 5, { ...counts, cutValues: 4 })).toEqual({ tone: "warning", text: "5 linhas copiadas em TXT. 4 valores cortados na largura máxima do TXT." });
    expect(copyAsNotice("xml", 5, { ...counts, removedCharacters: 1 }).text).toBe("5 linhas copiadas em XML. 1 caractere que o formato não aceita foi tirado.");
    expect(copyAsNotice("sql", 5, { ...counts, skippedRows: 3 }).text).toBe("5 linhas copiadas em SQL. 3 linhas não copiadas, comentadas no SQL: o comentário de cada uma diz por quê.");
    expect(copyAsNotice("sql", 5, { ...counts, skippedRows: 1 }).text).toBe("5 linhas copiadas em SQL. 1 linha não copiada, comentada no SQL: o comentário diz por quê.");
    expect(copyAsNotice("csv", 5, { ...counts, notWhole: 2 }).text).toBe("5 linhas copiadas em CSV. 2 valores não puderam vir inteiros e foram cortados.");
  });
});

describe("as células cortadas que a cópia busca (RN-SQL-017): só as que o documento escreve com o valor", () => {
  const binary = source({
    columns: [
      { name: "id", type: "int4", kind: "number", generated: "always" },
      { name: "nome", type: "text", kind: "text", generated: null },
      { name: "img", type: "bytea", kind: "binary", generated: null },
    ],
    rows: [{ number: 1, values: ["1", "An…", "0xcafe"], cut: [0, 1, 2] }],
  });
  const cells = (format: Parameters<typeof cutCellsToFetch>[0], change: Parameters<typeof options>[0] = {}, from = binary) => {
    const document = copyDocument(format, options(change), from);
    return document === null ? null : cutCellsToFetch(format, document);
  };

  it("nos formatos de dados, todas as cortadas, menos o binário com \"Deixar vazio\", que sai nulo", () => {
    expect(cells("csv")).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(cells("csv", { csv: { binary: "null" } })).toEqual([
      [0, 0],
      [0, 1],
    ]);
    expect(cells("json", { json: { binary: "null" } })).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("no SQL, fora as colunas que o banco calcula e ficam fora do INSERT, e fora o binário com \"NULL\" e o do Informix, que não tem literal", () => {
    // A coluna da origem: o `id`, que o banco calcula, fica fora, e as posições continuam as da origem.
    expect(cells("sql")).toEqual([
      [0, 1],
      [0, 2],
    ]);
    expect(cells("sql", { sql: { includeGenerated: true } })).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    expect(cells("sql", { sql: { binary: "null" } })).toEqual([[0, 1]]);
    expect(cells("sql", {}, { ...binary, engine: 3 })).toEqual([[0, 1]]);
  });
});

describe("runCopyAs: a cópia, com a busca dos completos, o limite e a área de transferência", () => {
  type Complete = (from: CopySource, cells: readonly (readonly [number, number])[], keepGoing: (batch: readonly FetchedValue[]) => boolean) => Promise<{ source: CopySource; stopped: boolean } | null>;
  const deps = () => ({ complete: vi.fn<Complete>(async (from) => ({ source: from, stopped: false })), write: vi.fn<(text: string) => Promise<boolean>>(async () => true), pause: async () => {} });

  it("sem célula cortada: escreve o texto da exportação e o põe na área de transferência, sem pedir nada", async () => {
    const d = deps();
    const outcome = await runCopyAs({ format: "csv", options: options({ csv: { lineBreak: "lf" } }), source: source() }, d);

    expect(outcome).toEqual({ kind: "copied", text: "id;nome\n1;Ana\n2;Bia\n", notice: { tone: "success", text: "2 linhas copiadas em CSV." } });
    expect(d.complete).not.toHaveBeenCalled();
    expect(d.write).toHaveBeenCalledWith("id;nome\n1;Ana\n2;Bia\n");
  });

  it("com célula cortada: busca os completos e copia o texto com eles; o que não veio sai cortado e conta", async () => {
    const d = deps();
    d.complete.mockImplementation(async (from) => ({ source: { ...from, rows: [{ number: 1, values: ["1", "Ana Lima"] }, { number: 2, values: ["2", "Bi…"], cut: [1] }] }, stopped: false }));
    const cut = source({ rows: [{ number: 1, values: ["1", "An…"], cut: [1] }, { number: 2, values: ["2", "Bi…"], cut: [1] }] });
    const outcome = await runCopyAs({ format: "csv", options: options({ csv: { lineBreak: "lf", header: false } }), source: cut }, d);

    expect(outcome).toEqual({ kind: "copied", text: "1;Ana Lima\n2;Bi…\n", notice: { tone: "warning", text: "2 linhas copiadas em CSV. 1 valor não pôde vir inteiro e foi cortado." } });
    expect(d.complete).toHaveBeenCalledTimes(1);
    expect(d.complete.mock.calls[0][1]).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });

  it("o que já passa do limite com o que a grade tem não busca nada", async () => {
    const d = deps();
    const cut = source({ rows: [{ number: 1, values: ["1", "x".repeat(100)], cut: [1] }] });

    expect(await runCopyAs({ format: "csv", options: options(), source: cut }, { ...d, limitBytes: 50 })).toEqual({ kind: "tooLarge", message: expect.stringContaining("10 MiB") });
    expect(d.complete).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
  });

  it("o que passa do limite com os valores completos é recusado, e a área de transferência fica como estava", async () => {
    const d = deps();
    d.complete.mockImplementation(async (from) => ({ source: { ...from, rows: [{ number: 1, values: ["1", "x".repeat(100)] }] }, stopped: false }));
    const cut = source({ rows: [{ number: 1, values: ["1", "x…"], cut: [1] }] });

    expect((await runCopyAs({ format: "csv", options: options(), source: cut }, { ...d, limitBytes: 50 })).kind).toBe("tooLarge");
    expect(d.write).not.toHaveBeenCalled();
  });

  it("a busca cancelada desiste sem copiar", async () => {
    const d = deps();
    d.complete.mockImplementation(async () => null);
    const cut = source({ rows: [{ number: 1, values: ["1", "x…"], cut: [1] }] });

    expect(await runCopyAs({ format: "json", options: options(), source: cut }, d)).toEqual({ kind: "cancelled" });
    expect(d.write).not.toHaveBeenCalled();
  });

  it("as fases: escrevendo, buscando e escrevendo de novo", async () => {
    const phases: string[] = [];
    const cut = source({ rows: [{ number: 1, values: ["1", "x…"], cut: [1] }] });
    await runCopyAs({ format: "json", options: options(), source: cut }, { ...deps(), onPhase: (phase) => phases.push(phase) });

    expect(phases).toEqual(["writing", "fetching", "writing"]);
  });

  it("a área de transferência que recusa, ou lança, é \"Não foi possível copiar.\"", async () => {
    expect(await runCopyAs({ format: "csv", options: options(), source: source() }, { ...deps(), write: async () => false })).toEqual({ kind: "failed", message: "Não foi possível copiar." });
    expect(await runCopyAs({ format: "csv", options: options(), source: source() }, { ...deps(), write: async () => Promise.reject(new Error("negado")) })).toEqual({ kind: "failed", message: "Não foi possível copiar." });
    // Sem `navigator.clipboard`, a escrita lança na hora, antes de haver promessa: também é a recusa, e não uma exceção que sai da cópia.
    const throws = () => {
      throw new TypeError("navigator.clipboard is undefined");
    };
    expect(await runCopyAs({ format: "csv", options: options(), source: source() }, { ...deps(), write: throws })).toEqual({ kind: "failed", message: "Não foi possível copiar." });
  });

  it("o binário cortado com \"Deixar vazio\" não é buscado e sai nulo; no SQL, com \"NULL\", ele é o nulo e não comenta a linha", async () => {
    const images = source({
      columns: [
        { name: "id", type: "int4", kind: "number", generated: null },
        { name: "img", type: "bytea", kind: "binary", generated: null },
      ],
      rows: [{ number: 1, values: ["1", "0xcafe"], cut: [1] }],
    });
    const csv = deps();
    const copied = await runCopyAs({ format: "csv", options: options({ csv: { binary: "null" } }), source: images }, csv);
    expect(copied).toMatchObject({ kind: "copied", text: "id;img\r\n1;\r\n" });
    expect(csv.complete).not.toHaveBeenCalled();

    const sql = deps();
    const inserted = await runCopyAs({ format: "sql", options: options({ sql: { binary: "null", rowsPerStatement: "1" } }), source: images }, sql);
    expect(inserted).toMatchObject({ kind: "copied", text: 'INSERT INTO "pedido" ("id", "img") VALUES (1, NULL);\n' });
    expect(sql.complete).not.toHaveBeenCalled();
  });

  it("no SQL do Informix, o binário cortado não é buscado: a linha é comentada pelo motivo do Informix, como seria com o valor inteiro", async () => {
    const informix = source({
      engine: 3,
      columns: [
        { name: "id", type: "INTEGER", kind: "number", generated: null },
        { name: "img", type: "BYTE", kind: "binary", generated: null },
      ],
      rows: [{ number: 6, values: ["6", "0xcafe"], cut: [1] }],
    });
    const d = deps();
    const cut = await runCopyAs({ format: "sql", options: options(), source: informix }, d);
    const whole = await runCopyAs({ format: "sql", options: options(), source: { ...informix, rows: [{ number: 6, values: ["6", "0xcafebabe"] }] } }, deps());

    expect(d.complete).not.toHaveBeenCalled();
    expect(cut.kind === "copied" && cut.text).toBe(whole.kind === "copied" && whole.text);
    expect(cut.kind === "copied" && cut.text).toContain("-- Linha 6 não exportada:");
  });

  it("a busca para quando o texto passa do limite (RN-SQL-017): o lote que chegou é escrito e medido, e a cópia é recusada sem ir à área de transferência", async () => {
    const rows = Array.from({ length: 4 }, (_, index) => ({ number: index + 1, values: [String(index + 1), "x…"], cut: [1] }));
    const answers: boolean[] = [];
    const d = deps();
    d.complete.mockImplementation(async (from, cells, keepGoing) => {
      // Dois lotes de uma célula cada, como a rota das células os daria; o último não passa por `keepGoing`.
      answers.push(keepGoing([{ row: cells[0][0], column: cells[0][1], value: "x".repeat(30) }]));
      answers.push(keepGoing([{ row: cells[1][0], column: cells[1][1], value: "x".repeat(30) }]));
      return answers.includes(false) ? { source: from, stopped: true } : { source: from, stopped: false };
    });

    expect(await runCopyAs({ format: "csv", options: options({ csv: { lineBreak: "lf" } }), source: source({ rows }) }, { ...d, limitBytes: 70 })).toEqual({ kind: "tooLarge", message: expect.stringContaining("10 MiB") });
    expect(answers).toEqual([true, false]);
    expect(d.write).not.toHaveBeenCalled();
  });

  it("o que mede a busca é o texto do formato: o valor grande que o TXT corta na largura máxima não para a busca", async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({ number: index + 1, values: [String(index + 1), "x…"], cut: [1] }));
    const answers: boolean[] = [];
    const d = deps();
    d.complete.mockImplementation(async (from, cells, keepGoing) => {
      answers.push(keepGoing(cells.slice(0, 2).map(([row, column]) => ({ row, column, value: "x".repeat(10_000) }))));
      return { source: { ...from, rows: from.rows.map((row) => ({ ...row, values: [row.values[0], "x".repeat(10_000)], cut: [] })) }, stopped: false };
    });

    const outcome = await runCopyAs({ format: "txt", options: options({ txt: { maxWidth: "5" } }), source: source({ rows }) }, { ...d, limitBytes: 1_000 });
    expect(answers).toEqual([true]);
    expect(outcome.kind).toBe("copied");
  });

  it("o SQL e o DbUnit sem tabela pedem o diálogo, e o SQL só com colunas que o banco calcula é recusado", async () => {
    expect(await runCopyAs({ format: "sql", options: options(), source: source({ table: null }) }, deps())).toEqual({ kind: "needsTable" });
    expect(await runCopyAs({ format: "sql", options: options(), source: pickColumns(source(), [0]) }, deps())).toEqual({ kind: "noColumns", message: noColumnsMessage });
  });

  it("RN-GRADE-016: o SQL com duas colunas de mesmo nome é recusado antes de tudo, sem pedir a tabela, sem buscar e sem tocar a área de transferência", async () => {
    const d = deps();
    const cut = { ...joined, rows: [{ number: 1, values: ["1", "10", "An…"], cut: [2] }] };
    expect(await runCopyAs({ format: "sql", options: options(), source: cut }, d)).toEqual({ kind: "duplicateColumn", message: duplicateRefusal });
    expect(await runCopyAs({ format: "sql", options: options(), source: { ...cut, table: null } }, d)).toEqual({ kind: "duplicateColumn", message: duplicateRefusal });
    expect(d.complete).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
    // Os outros formatos copiam como antes, com o nome repetido.
    const csv = await runCopyAs({ format: "csv", options: options(), source: joined }, deps());
    expect(csv).toMatchObject({ kind: "copied", text: expect.stringContaining("id;id;nome") });
  });

  it("o SQL com a tabela da origem, as linhas numeradas pela grade e o resumo das comentadas", async () => {
    const rows = [{ number: 4, values: ["4", "Ana"] }, { number: null, values: [null, "Nova"] }];
    const outcome = await runCopyAs({ format: "sql", options: options({ sql: { schema: "estoque", table: "pedido", rowsPerStatement: "1" } }), source: source({ rows }) }, deps());

    expect(outcome).toEqual({
      kind: "copied",
      text: `INSERT INTO "estoque"."pedido" ("nome") VALUES ('Ana');\n-- Linha nova não exportada: ela ainda não está no banco.\n`,
      notice: { tone: "warning", text: "2 linhas copiadas em SQL. 1 linha não copiada, comentada no SQL: o comentário diz por quê." },
    });
  });
});
