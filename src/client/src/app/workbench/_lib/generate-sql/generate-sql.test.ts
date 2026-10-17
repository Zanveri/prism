import { describe, expect, it } from "vitest";

import { statementCount } from "../sql-statements";
import { comparable, conditionColumns, defaultSqlOptions, generateSql, insertColumns, rowList, setColumns, tableName, valueLiteral, type SqlColumn, type SqlPlan, type SqlRow } from "./generate-sql";

const column = (name: string, at: number, extra: Partial<SqlColumn> = {}): SqlColumn => ({ at, name, type: "text", kind: "text", generated: null, ...extra });

const plan = (extra: Partial<SqlPlan> = {}): SqlPlan => ({
  engine: 1,
  table: { schema: "estoque", name: "pedido" },
  kind: "table",
  unknownReason: null,
  columns: [column("id", 0, { type: "integer", kind: "number" }), column("cliente", 1)],
  key: { kind: "complete", columns: [0] },
  ...extra,
});

const row = (number: number, values: (string | null)[], extra: Partial<SqlRow> = {}): SqlRow => ({ number, values, read: values, changed: [], cut: [], generated: [], ...extra });

describe("o texto de cada item (RN-GRADE-019)", () => {
  it("os números das linhas de fora: três ou mais seguidas viram faixa, sem repetir, em ordem", () => {
    expect(rowList([3, 4, 20, 21, 22, 23, 40])).toBe("3, 4, 20-23, 40");
    expect(rowList([9, 7, 7, 8])).toBe("7-9");
    expect(rowList([1])).toBe("1");
  });

  it("o nome da tabela: com Nomes completos, esquema e tabela; sem eles, ou sem esquema, só a tabela", () => {
    expect(tableName({ schema: "estoque", name: "pedido" }, true)).toBe('"estoque"."pedido"');
    expect(tableName({ schema: "estoque", name: "pedido" }, false)).toBe('"pedido"');
    expect(tableName({ schema: "", name: "pe\"dido" }, true)).toBe('"pe""dido"');
  });

  it("o literal: o nulo é NULL; o binário é o do banco, e no Informix não há; o texto com controle não tem", () => {
    expect(valueLiteral(1, { kind: "text", type: "text" }, null)).toEqual({ sql: "NULL", isNull: true });
    expect(valueLiteral(1, { kind: "binary", type: "bytea" }, "0xcafe")).toEqual({ sql: "decode('CAFE', 'hex')", isNull: false });
    expect(valueLiteral(3, { kind: "binary", type: "BYTE" }, "0xcafe")).toBe("binary");
    expect(valueLiteral(2, { kind: "text", type: "VARCHAR" }, "a\u0001b")).toBe("literal");
    expect(valueLiteral(1, { kind: "number", type: "integer" }, "007")).toEqual({ sql: "007", isNull: false });
    expect(valueLiteral(1, { kind: "text", type: "text" }, "007")).toEqual({ sql: "'007'", isNull: false });
  });

  it("as colunas que o banco não compara com = ficam fora da condição sem chave, pelo tipo, sem o tamanho nem o [] da lista", () => {
    expect([..."json xml point line lseg box path polygon circle".split(" ").map((type) => comparable(1, { type })), comparable(1, { type: "point[]" }), comparable(1, { type: "jsonb" })]).toEqual([false, false, false, false, false, false, false, false, false, false, true]);
    expect(["BLOB(2M)", "CLOB", "DBCLOB(1K)", "XML", "LONG VARCHAR", "LONG VARGRAPHIC", "VARBINARY(10)"].map((type) => comparable(2, { type }))).toEqual([false, false, false, false, false, false, true]);
    expect(["BYTE", "TEXT", "BLOB", "CLOB", "LVARCHAR"].map((type) => comparable(3, { type }))).toEqual([false, false, false, false, true]);
  });

  it("as colunas do INSERT, do SET e da condição", () => {
    const generated = plan({ columns: [column("id", 0, { generated: "byDefault" }), column("nome", 1), column("total", 2, { generated: "always" })] });

    expect(insertColumns(generated, defaultSqlOptions)).toEqual([1]);
    expect(insertColumns(generated, { ...defaultSqlOptions, excludeGenerated: false })).toEqual([0, 1]);
    expect(setColumns(generated)).toEqual([1]);
    expect(setColumns({ ...generated, key: { kind: "none" } })).toEqual([0, 1]);
    expect(conditionColumns(generated)).toEqual([0]);
    expect(conditionColumns({ ...generated, key: { kind: "none" }, columns: [column("a", 0), column("j", 1, { type: "json" })] })).toEqual([0]);
  });

  it("com stopAfter, a geração para quando os comandos passam dele, e o texto que veio não vale; abaixo dele, o texto é o mesmo de sem", () => {
    const rows = Array.from({ length: 50 }, (_, index) => row(index + 1, [String(index + 1), "x".repeat(100)]));
    const whole = generateSql("insert", plan(), rows, defaultSqlOptions);

    for (const item of ["insert", "update", "delete", "selectEquals"] as const) expect(generateSql(item, plan(), rows, defaultSqlOptions, 1_000)).toEqual({ text: "", skipped: 0, rows: 50, tooLarge: true });
    expect(generateSql("insert", plan(), rows, defaultSqlOptions, whole.text.length)).toEqual(whole);
    expect(whole.tooLarge).toBeUndefined();
  });

  it("o texto não termina em quebra de linha, e cada comando é um comando só para o separador da aba de consulta", () => {
    const rows = [row(1, ["1", "Ana; DROP TABLE x"]), row(2, ["2", "-- comentário"])];

    for (const item of ["selectEquals", "selectIn", "insert", "update", "delete"] as const) {
      const { text } = generateSql(item, plan(), rows, defaultSqlOptions);
      expect(text.endsWith("\n")).toBe(false);
      expect(statementCount(text, 1)).toBe(item === "selectIn" ? 1 : 2);
    }
  });

  it("a linha nova já salva com uma célula 'gerado pelo banco' que o comando usa fica de fora; a que não usa, entra", () => {
    const rows = [row(4, ["10", null], { generated: [1] })];

    expect(generateSql("insert", plan(), rows, defaultSqlOptions).skipped).toBe(1);
    expect(generateSql("delete", plan(), rows, defaultSqlOptions)).toEqual({ text: 'DELETE FROM "estoque"."pedido"\nWHERE "id" = 10;', skipped: 0, rows: 1 });
  });

  it("a célula cortada com pendência vai com a pendência, que é inteira; a condição pela chave cortada deixa a linha de fora", () => {
    const pendingCut = row(1, ["1", "novo"], { read: ["1", "antigo cort"], changed: [1], cut: [1] });
    const keyCut = row(2, ["2", "x"], { cut: [0] });

    expect(generateSql("update", plan(), [pendingCut], { ...defaultSqlOptions, compact: true }).text).toBe(`UPDATE "estoque"."pedido" SET "cliente" = 'novo' WHERE "id" = 1;`);
    expect(generateSql("delete", plan(), [keyCut], defaultSqlOptions)).toEqual({ text: "-- Linhas da grade não geradas, com um valor que não pôde vir inteiro: 2.", skipped: 1, rows: 1 });
  });

  it("o SELECT IN sem chave junta por OR também as linhas com nulo, e repete uma vez a linha igual", () => {
    const noKey = plan({ key: { kind: "none" } });
    const rows = [row(1, ["1", null]), row(2, ["1", null]), row(3, ["2", "x"])];

    expect(generateSql("selectIn", noKey, rows, { ...defaultSqlOptions, compact: true }).text).toBe(
      `-- Sem chave primária nem chave única: a condição usa todas as colunas, e linhas iguais seriam afetadas juntas.\nSELECT "id", "cliente" FROM "estoque"."pedido" WHERE ("id" = 1 AND "cliente" IS NULL) OR ("id" = 2 AND "cliente" = 'x');`,
    );
  });

  it("as linhas de fora e as que entram: a contagem é das linhas que chegaram, e o comentário do começo sai só com algum comando", () => {
    const noKey = plan({ key: { kind: "none" } });
    const generated = generateSql("delete", noKey, [row(5, ["1", "a\u0000"])], defaultSqlOptions);

    expect(generated.skipped).toBe(1);
    expect(generated.rows).toBe(1);
    expect(generated.text.startsWith("-- Linhas da grade não geradas, com um valor que não cabe num literal")).toBe(true);
  });
});
