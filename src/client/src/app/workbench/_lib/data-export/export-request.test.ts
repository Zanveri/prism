import { describe, expect, it } from "vitest";

import { defaultFilePattern, expandFilePattern, filePatternProblem, outputNames } from "./export-file-name";
import { defaultOptions } from "./export-options";
import { exportRequest, maxRequestBytes, requestBytes, type ExportDraft } from "./export-request";
import { originName, progressName, sourceTitle, targetDefaults, toastSubject, type ExportOrigin } from "./export-source";

const table: ExportOrigin = { kind: "table", view: false, schema: "estoque", name: "pedido" };
const records: ExportOrigin = { kind: "records", schema: "estoque", name: "pedido", sql: 'SELECT * FROM "estoque"."pedido"\nWHERE id > 1', filter: "id > 1" };
const result: ExportOrigin = { kind: "result", tabTitle: "consulta-1.sql", scriptNumber: null, sql: "select * from pedido", filter: "id > 1", table: null };

const draft = (change: Partial<ExportDraft> = {}): ExportDraft => ({
  connectionId: "c1",
  origin: table,
  engine: 1,
  columns: [
    { position: 0, name: "id" },
    { position: 1, name: "cliente" },
  ],
  count: true,
  format: "csv",
  options: defaultOptions({ schema: "estoque", table: "pedido" }),
  bom: true,
  zip: false,
  entryName: null,
  clipboard: false,
  windowId: 2,
  ...change,
});

describe("o pedido de POST api/user/transfers/exports (RN-EXPORT-016)", () => {
  it("a tabela pelo navegador: a origem `table`, as colunas pela posição e nome, as opções do formato e a saída", () => {
    expect(exportRequest(draft({ database: "vendas" }))).toEqual({
      source: { kind: "table", connectionID: "c1", database: "vendas", schema: "estoque", table: "pedido" },
      columns: [
        { position: 0, name: "id" },
        { position: 1, name: "cliente" },
      ],
      count: true,
      format: "csv",
      options: { delimiter: ";", header: true, quoting: "auto", formulaGuard: true, lineBreak: "crlf", nullText: "", binary: "hex" },
      output: { bom: true, zip: false, clipboard: false },
      windowID: 2,
    });
  });

  it("os Registros e o resultado são `query`: o comando que a grade mostra; o nome da tabela nos Registros; o filtro do resultado", () => {
    expect(exportRequest(draft({ origin: records })).source).toEqual({ kind: "query", connectionID: "c1", sql: 'SELECT * FROM "estoque"."pedido"\nWHERE id > 1', name: "pedido" });
    expect(exportRequest(draft({ origin: result })).source).toEqual({ kind: "query", connectionID: "c1", sql: "select * from pedido", filter: "id > 1" });
    expect(exportRequest(draft({ origin: { ...result, filter: null } })).source).toEqual({ kind: "query", connectionID: "c1", sql: "select * from pedido" });
  });

  it("os números saem como número; no Informix, sempre 1 linha por comando; a tabela de destino vazia vai nula (a da origem)", () => {
    const options = defaultOptions({ schema: "", table: "" });
    options.txt.minWidth = "5";
    options.sql.rowsPerStatement = "50";
    expect(exportRequest(draft({ format: "txt", options })).options).toMatchObject({ minWidth: 5, maxWidth: 0 });
    expect(exportRequest(draft({ format: "sql", options })).options).toEqual({ schema: null, table: null, omitSchema: false, rowsPerStatement: 50, binary: "literal" });
    expect(exportRequest(draft({ format: "sql", options, engine: 3 })).options).toMatchObject({ rowsPerStatement: 1 });
    expect(exportRequest(draft({ format: "dbUnit", options })).options).toEqual({ table: null, upperCase: true, nulls: "omit", binary: "hex" });
  });

  it("com a área de transferência, nunca BOM nem .zip; no XLSX, nenhum dos três; o .zip leva o nome do arquivo de dentro", () => {
    expect(exportRequest(draft({ clipboard: true, zip: true, bom: true })).output).toEqual({ bom: false, zip: false, clipboard: true });
    expect(exportRequest(draft({ format: "xlsx", clipboard: true, zip: true, bom: true })).output).toEqual({ bom: false, zip: false, clipboard: false });
    expect(exportRequest(draft({ zip: true, entryName: "pedido.csv" })).output).toEqual({ bom: true, zip: true, entryName: "pedido.csv", clipboard: false });
  });

  it("o tamanho do corpo é contado em UTF-8, contra os 16 MiB", () => {
    expect(maxRequestBytes).toBe(16 * 1024 * 1024);
    const small = requestBytes(exportRequest(draft()));
    expect(requestBytes(exportRequest(draft({ origin: { ...result, sql: "é".repeat(10) } })))).toBeGreaterThan(small - 100);
    expect(requestBytes(exportRequest(draft({ origin: { ...result, sql: "é".repeat(5_000_000) } })))).toBeGreaterThan(maxRequestBytes);
  });
});

describe("o nome do arquivo (RN-EXPORT-014)", () => {
  const now = new Date(2026, 9, 16, 14, 30, 5);

  it("o padrão vem com ${tabela}_${data}_${hora}, e as variáveis viram a origem, a conexão e o relógio da máquina", () => {
    expect(defaultFilePattern).toBe("${tabela}_${data}_${hora}");
    expect(expandFilePattern(defaultFilePattern, { tabela: "pedido", esquema: "estoque", conexao: "ERP" }, now)).toBe("pedido_2026-10-16_143005");
    expect(expandFilePattern("${conexao}-${esquema}.${tabela}", { tabela: "pedido", esquema: "estoque", conexao: "ERP" }, now)).toBe("ERP-estoque.pedido");
  });

  it("as recusas: vazio, mais de 200 caracteres, e a variável que não existe", () => {
    expect(filePatternProblem("  ")).toBe("Informe o nome do arquivo.");
    expect(filePatternProblem("x".repeat(201))).toBe("O nome do arquivo pode ter até 200 caracteres.");
    expect(filePatternProblem("${tabelas}_x")).toBe("A variável ${tabelas} não existe. Use ${tabela}, ${esquema}, ${conexao}, ${data} ou ${hora}.");
    expect(filePatternProblem(defaultFilePattern)).toBeNull();
  });

  it("o nome pronto passa pelas regras do Exportar CSV: a barra vira `_` (o padrão não cria pasta); com o .zip, o de dentro tem a extensão do formato", () => {
    expect(outputNames("relatórios/pedido", "csv", false)).toEqual({ fileName: "relatórios_pedido.csv", suggestedName: "relatórios_pedido", entryName: null });
    expect(outputNames("pedido_2026-10-16_143005", "csv", true)).toEqual({ fileName: "pedido_2026-10-16_143005.zip", suggestedName: "pedido_2026-10-16_143005", entryName: "pedido_2026-10-16_143005.csv" });
    expect(outputNames("", "json", false).fileName).toBe("registros.json");
  });

  it("o nome que vai ao processo principal cabe nos 200 e o de dentro do .zip nos 128 (unidades UTF-16), mesmo com emoji", () => {
    const emoji = String.fromCodePoint(0x1f600);
    const names = outputNames(emoji.repeat(150), "xlsx", true);
    expect(names.suggestedName.length).toBeLessThanOrEqual(200);
    expect(names.entryName?.length).toBeLessThanOrEqual(128);
    expect(names.entryName?.endsWith(".xlsx")).toBe(true);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(names.suggestedName)).toBe(false);
  });
});

describe("os textos de cada origem (RN-EXPORT-003, 006, 021 e 022)", () => {
  it("o subtítulo do diálogo", () => {
    expect(sourceTitle(table)).toBe("Tabela estoque.pedido");
    expect(sourceTitle({ ...table, view: true, name: "v_pedido" })).toBe("Visão estoque.v_pedido");
    expect(sourceTitle(records)).toBe("Tabela estoque.pedido, com o filtro e a ordem da aba");
    expect(sourceTitle({ ...records, filter: "" })).toBe("Tabela estoque.pedido");
    expect(sourceTitle(result)).toBe("Resultado de consulta-1.sql");
    expect(sourceTitle({ ...result, scriptNumber: 3 })).toBe("Resultado 3 de consulta-1.sql");
  });

  it("o nome da origem, o da barra e o sujeito dos avisos", () => {
    expect(originName(records)).toBe("pedido");
    expect(originName(result)).toBe("resultado");
    expect(progressName(table)).toBe("pedido");
    expect(progressName(result)).toBe("resultado de consulta-1.sql");
    expect(toastSubject({ ...table, view: true, name: "v_pedido" })).toEqual({ subject: "Visão v_pedido", feminine: true });
    expect(toastSubject(result)).toEqual({ subject: "Resultado de consulta-1.sql", feminine: false });
  });

  it("a tabela de destino do SQL e do DbUnit: a da origem; no resultado, a do alvo da edição ou vazia", () => {
    expect(targetDefaults(records)).toEqual({ schema: "estoque", table: "pedido" });
    expect(targetDefaults(result)).toEqual({ schema: "", table: "" });
    expect(targetDefaults({ ...result, table: { schema: "vendas", name: "item" } })).toEqual({ schema: "vendas", table: "item" });
  });
});
