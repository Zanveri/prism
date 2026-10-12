import { describe, expect, it } from "vitest";

import { queryPageSchema, queryResultSchema, queryTotalSchema, sqlErrorDetails } from "./query.schema";

const columns = [
  { name: "id", type: "int8", kind: "number" },
  { name: "tag", type: "text", kind: "text" },
];

describe("queryResultSchema (seção 6: página de resultado)", () => {
  it("página com linhas", () => {
    const parsed = queryResultSchema.parse({ columns, rows: [["1", "EXT-04"], ["2", "INJ-02"]], hasMore: true, elapsedMs: 42, truncatedCells: [[1, 1]], rowsAffected: null });

    expect(parsed).toEqual({ kind: "rows", columns, rows: [["1", "EXT-04"], ["2", "INJ-02"]], hasMore: true, elapsedMs: 42, truncatedCells: [[1, 1]], totalRows: null });
  });

  it("totalRows presente: o comando gravou, foi até o fim e esse é o total que devolveu (RN-SQL-013)", () => {
    const parsed = queryResultSchema.parse({ columns, rows: [["1", "a"], ["2", "b"]], hasMore: false, elapsedMs: 30, truncatedCells: [], rowsAffected: null, totalRows: 1200 });

    expect(parsed).toMatchObject({ kind: "rows", totalRows: 1200, hasMore: false });
  });

  it("totalRows nulo ou ausente: comando de leitura, com o cursor aberto na API", () => {
    expect(queryResultSchema.parse({ columns, rows: [["1", "a"]], hasMore: true, elapsedMs: 1, totalRows: null })).toMatchObject({ kind: "rows", totalRows: null, hasMore: true });
    expect(queryResultSchema.parse({ columns, rows: [["1", "a"]], hasMore: true, elapsedMs: 1 })).toMatchObject({ kind: "rows", totalRows: null, hasMore: true });
  });

  it("totalRows que não é número inteiro recusa a resposta", () => {
    expect(queryResultSchema.safeParse({ columns, rows: [["1", "a"]], hasMore: false, elapsedMs: 1, totalRows: "1200" }).success).toBe(false);
  });

  it("resposta só com rowsAffected", () => {
    expect(queryResultSchema.parse({ rowsAffected: 3, elapsedMs: 12 })).toEqual({ kind: "affected", rowsAffected: 3, elapsedMs: 12 });
    // A forma inteira, com o que não se aplica nulo, é a mesma resposta.
    expect(queryResultSchema.parse({ columns: null, rows: null, hasMore: false, elapsedMs: 12, truncatedCells: null, rowsAffected: 3 })).toEqual({ kind: "affected", rowsAffected: 3, elapsedMs: 12 });
  });

  it("célula nula", () => {
    const parsed = queryResultSchema.parse({ columns, rows: [["1", null]], hasMore: false, elapsedMs: 1, truncatedCells: [], rowsAffected: null });

    expect(parsed).toMatchObject({ kind: "rows", rows: [["1", null]] });
  });

  it("truncatedCells ausente vira lista vazia", () => {
    expect(queryResultSchema.parse({ columns, rows: [["1", "a"]], hasMore: false, elapsedMs: 1 })).toMatchObject({ kind: "rows", truncatedCells: [] });
    expect(queryResultSchema.parse({ columns, rows: [["1", "a"]], hasMore: false, elapsedMs: 1, truncatedCells: null })).toMatchObject({ kind: "rows", truncatedCells: [] });
  });

  it("resposta com linha de tamanho diferente do número de colunas é recusada", () => {
    expect(queryResultSchema.safeParse({ columns, rows: [["1", "a"], ["2"]], hasMore: false, elapsedMs: 1 }).success).toBe(false);
    expect(queryResultSchema.safeParse({ columns, rows: [["1", "a", "b"]], hasMore: false, elapsedMs: 1 }).success).toBe(false);
  });

  it("resposta sem colunas e sem rowsAffected, ou com colunas e sem linhas, é recusada", () => {
    expect(queryResultSchema.safeParse({ elapsedMs: 1 }).success).toBe(false);
    expect(queryResultSchema.safeParse({ columns, rows: null, elapsedMs: 1 }).success).toBe(false);
  });

  it("célula que não é texto nem nula é recusada: a API formata tudo (RN-SQL-011)", () => {
    expect(queryResultSchema.safeParse({ columns, rows: [[1, "a"]], hasMore: false, elapsedMs: 1 }).success).toBe(false);
  });

  it("`kind` que a tela não conhece vira texto: só serve para alinhar a coluna", () => {
    const parsed = queryResultSchema.parse({ columns: [{ name: "g", type: "geometry", kind: "spatial" }], rows: [["POINT(1 2)"]], hasMore: false, elapsedMs: 1 });

    expect(parsed).toMatchObject({ kind: "rows", columns: [{ name: "g", type: "geometry", kind: "text" }] });
  });

  it("resultado sem coluna nenhuma e sem linha nenhuma passa", () => {
    expect(queryResultSchema.parse({ columns: [], rows: [], hasMore: false, elapsedMs: 0 })).toMatchObject({ kind: "rows", columns: [], rows: [] });
  });
});

describe("queryPageSchema (queries/next)", () => {
  it("aceita uma página com linhas", () => {
    expect(queryPageSchema.parse({ columns, rows: [["3", "c"]], hasMore: false, elapsedMs: 5 })).toMatchObject({ kind: "rows", rows: [["3", "c"]], hasMore: false });
  });

  it("recusa a resposta de comando sem linhas: \"carregar mais\" só devolve página", () => {
    expect(queryPageSchema.safeParse({ rowsAffected: 3, elapsedMs: 12 }).success).toBe(false);
  });
});

describe("queryTotalSchema (queries/count)", () => {
  it("aceita o total e recusa o que não é número inteiro", () => {
    expect(queryTotalSchema.parse({ total: 1000 })).toEqual({ total: 1000 });
    expect(queryTotalSchema.safeParse({ total: "1000" }).success).toBe(false);
  });
});

describe("sqlErrorDetails (RN-SQL-009: os campos extras do 422 SQL_EXECUTION_FAILED)", () => {
  it("lê o SQLSTATE e a posição", () => {
    expect(sqlErrorDetails({ sqlState: "42601", position: 15, status: 422 })).toEqual({ sqlState: "42601", position: 15 });
  });

  it("a posição pode faltar, e o que vier fora do formato vira nulo em vez de derrubar o erro", () => {
    expect(sqlErrorDetails({ sqlState: "42P01" })).toEqual({ sqlState: "42P01", position: null });
    expect(sqlErrorDetails({ sqlState: 42601, position: "15" })).toEqual({ sqlState: null, position: null });
    expect(sqlErrorDetails({ position: 0 })).toEqual({ sqlState: null, position: null });
    expect(sqlErrorDetails({})).toEqual({ sqlState: null, position: null });
  });
});
