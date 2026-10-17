import { describe, expect, it } from "vitest";

import type { QueryColumn } from "../query.schema";
import { chars, documentOf } from "./test-fixtures";
import { binaryLiteral, db2HexPieceDigits } from "./to-sql";

const col = (name: string, kind: QueryColumn["kind"] = "text", type: string = kind): QueryColumn => ({ name, type, kind });
const sql = { schema: "estoque", table: "pedido" };
const head = 'INSERT INTO "estoque"."pedido" ("id", "nome") VALUES';

describe("o SQL (RN-EXPORT-011)", () => {
  it("várias linhas por comando: o INSERT numa linha, cada linha na seguinte com dois espaços, até o ;", () => {
    const rows = [["1", "Ana"], ["2", "Bia"], ["3", "Caio"]];
    expect(documentOf("sql", [col("id", "number"), col("nome")], rows, { ...sql, rowsPerStatement: "2" }).text).toBe(`${head}\n  (1, 'Ana'),\n  (2, 'Bia');\n${head}\n  (3, 'Caio');\n`);
  });

  it("uma linha por comando: cada INSERT numa linha só; no Informix, sempre uma", () => {
    const rows = [["1", "Ana"], ["2", "Bia"]];
    const one = `${head} (1, 'Ana');\n${head} (2, 'Bia');\n`;
    expect(documentOf("sql", [col("id", "number"), col("nome")], rows, { ...sql, rowsPerStatement: "1" }).text).toBe(one);
    expect(documentOf("sql", [col("id", "number"), col("nome")], rows, { ...sql, rowsPerStatement: "10" }, { engine: 3 }).text).toBe(one);
  });

  it("sem esquema, ou com \"Omitir o esquema\", só a tabela; sem linhas, vazio", () => {
    expect(documentOf("sql", [col("id", "number")], [["1"]], { schema: "", table: "pedido", rowsPerStatement: "1" }).text).toBe('INSERT INTO "pedido" ("id") VALUES (1);\n');
    expect(documentOf("sql", [col("id", "number")], [["1"]], { ...sql, omitSchema: true, rowsPerStatement: "1" }).text).toBe('INSERT INTO "pedido" ("id") VALUES (1);\n');
    expect(documentOf("sql", [col("id", "number")], [], sql).text).toBe("");
  });

  it("a linha sem literal fecha o comando e vira o comentário de frase fixa, com o número da grade; as seguintes começam outro", () => {
    const { text, counts } = documentOf("sql", [col("id", "number"), col("nome")], [{ number: 4, values: ["4", "Ana"] }, { number: 9, values: ["9", `B${chars(1)}`] }, { number: 10, values: ["10", "Caio"] }], sql);

    expect(text).toBe(`${head}\n  (4, 'Ana');\n-- Linha 9 não exportada: um valor tem caractere de controle que não vira literal.\n${head}\n  (10, 'Caio');\n`);
    expect(counts.skippedRows).toBe(1);
  });

  it("a linha nova ainda não salva, a célula gerada pelo banco e o valor que não veio inteiro viram comentário, e nenhum dado entra nele", () => {
    const hostile = "x\n-- DROP TABLE t;\n";
    const { text, counts } = documentOf(
      "sql",
      [col("id", "number"), col("nome")],
      [
        { number: null, values: ["1", hostile] },
        { number: 2, values: [null, hostile], generated: [0] },
        { number: 3, values: ["3", hostile], cut: [1] },
      ],
      sql,
    );

    expect(text).toBe(
      "-- Linha nova não exportada: ela ainda não está no banco.\n-- Linha 2 não exportada: um valor que o banco gerou não aparece na grade.\n-- Linha 3 não exportada: um valor não pôde vir inteiro.\n",
    );
    expect(counts.skippedRows).toBe(3);
    expect(counts.notWhole).toBe(0);
  });

  it("o binário: o literal do banco, do 0x da grade; ou NULL; e no Informix, a linha vira comentário", () => {
    const columns = [col("f", "binary", "bytea")];
    expect(documentOf("sql", columns, [["0xdead"]], { ...sql, rowsPerStatement: "1" }).text).toBe(`INSERT INTO "estoque"."pedido" ("f") VALUES (decode('DEAD', 'hex'));\n`);
    expect(documentOf("sql", columns, [["0xDEAD"]], { ...sql, rowsPerStatement: "1", binary: "null" }).text).toBe(`INSERT INTO "estoque"."pedido" ("f") VALUES (NULL);\n`);
    expect(documentOf("sql", columns, [["0xDEAD"]], { ...sql, rowsPerStatement: "1" }, { engine: 3 }).text).toBe("-- Linha 1 não exportada: o Informix não tem literal para binário.\n");
  });

  it("binaryLiteral: o binário do Db2 pelo tipo da coluna, em pedaços de 16.336 bytes unidos por ||, e o vazio", () => {
    const hex = "AB".repeat(db2HexPieceDigits / 2 + 1);
    expect(binaryLiteral(2, hex, "BLOB")).toBe(`BLOB(X'${"AB".repeat(db2HexPieceDigits / 2)}') || BLOB(X'AB')`);
    expect(binaryLiteral(2, hex, "VARBINARY")).toBe(`BX'${"AB".repeat(db2HexPieceDigits / 2)}' || BX'AB'`);
    expect(binaryLiteral(2, hex, "VARCHAR () FOR BIT DATA")).toBe(`X'${"AB".repeat(db2HexPieceDigits / 2)}' || X'AB'`);
    expect(binaryLiteral(2, "", " blob ")).toBe("BLOB(X'')");
    expect(binaryLiteral(1, "", "bytea")).toBe("decode('', 'hex')");
    expect(binaryLiteral(3, "AB", "BYTE")).toBeNull();
  });

  it("os nomes entre aspas, com a aspa dobrada, e o retorno de carro do PostgreSQL num E'…'", () => {
    const { text } = documentOf("sql", [col('a"b')], [[`x${chars(13)}y`]], { schema: "s", table: 't"x', rowsPerStatement: "1" });

    expect(text).toBe(`INSERT INTO "s"."t""x" ("a""b") VALUES (E'x\\ry');\n`);
  });
});
