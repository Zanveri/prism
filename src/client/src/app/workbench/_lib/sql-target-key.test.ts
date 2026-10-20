import { describe, expect, it } from "vitest";

import { sqlTargetKey } from "./sql-target-key";

const columns = [
  { name: "id", type: "int4" },
  { name: "status", type: "text" },
];

describe("sqlTargetKey: a identidade do resultado para o alvo do SQL (RN-GRADE-020 e RN-TABELA-007)", () => {
  const same = sqlTargetKey("c1", undefined, { sql: "select id, status from pedido" }, columns);

  it("o mesmo comando, a mesma conexão, o mesmo banco e as mesmas colunas dão a mesma chave", () => {
    expect(sqlTargetKey("c1", undefined, { sql: "select id, status from pedido" }, [...columns.map((column) => ({ ...column }))])).toBe(same);
  });

  it("outro texto de comando, outra conexão, outro banco, outro filtro ou outras colunas (nome, tipo ou ordem) dão outra", () => {
    expect(sqlTargetKey("c1", undefined, { sql: "select id, status from pedido " }, columns)).not.toBe(same);
    expect(sqlTargetKey("c2", undefined, { sql: "select id, status from pedido" }, columns)).not.toBe(same);
    expect(sqlTargetKey("c1", "outro", { sql: "select id, status from pedido" }, columns)).not.toBe(same);
    expect(sqlTargetKey("c1", undefined, { sql: "select id, status from pedido", filter: "id > 1" }, columns)).not.toBe(same);
    expect(sqlTargetKey("c1", undefined, { sql: "select id, status from pedido" }, [columns[0], { name: "status", type: "varchar" }])).not.toBe(same);
    expect(sqlTargetKey("c1", undefined, { sql: "select id, status from pedido" }, [columns[1], columns[0]])).not.toBe(same);
  });

  it("o banco da conexão e a conexão sem banco escolhido não se confundem com nome nenhum", () => {
    expect(sqlTargetKey("c1", "", { sql: "x" }, [])).not.toBe(sqlTargetKey("c1", undefined, { sql: "x" }, []));
  });
});
