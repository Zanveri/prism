import { describe, expect, it } from "vitest";

import { databaseSessionSchema, referencingForeignKeysSchema } from "./database-sessions.schema";

describe("databaseSessionSchema", () => {
  it("a resposta completa passa", () => {
    const session = databaseSessionSchema.parse({ id: "s-1", connectionID: "00000000-0000-4000-8000-000000000001", engine: 1, database: "mes", serverVersion: "PostgreSQL 16.4" });

    expect(session).toMatchObject({ id: "s-1", database: "mes", engine: 1, serverVersion: "PostgreSQL 16.4" });
  });

  it("só o que a tela usa é exigido: a sessão já está aberta na API, e recusar a resposta deixaria cada tentativa abrir outra", () => {
    expect(databaseSessionSchema.parse({ id: "s-1", database: "mes" })).toEqual({ id: "s-1", database: "mes" });
  });

  it("o que a tela não usa não recusa a resposta, qualquer que seja o formato", () => {
    const session = databaseSessionSchema.parse({ id: "s-1", database: "mes", connectionID: 7, engine: "PostgreSql", serverVersion: null });

    expect(session.id).toBe("s-1");
    expect(session.connectionID).toBeUndefined();
    expect(session.engine).toBeUndefined();
    expect(session.serverVersion).toBeUndefined();
  });

  it("sem o id ou sem o banco, a resposta é recusada", () => {
    expect(databaseSessionSchema.safeParse({ database: "mes" }).success).toBe(false);
    expect(databaseSessionSchema.safeParse({ id: "", database: "mes" }).success).toBe(false);
    expect(databaseSessionSchema.safeParse({ id: "s-1" }).success).toBe(false);
  });
});

describe("referencingForeignKeysSchema (RN-CAT-004: GET …/referenced-by)", () => {
  const key = { name: "fk_itens_pedido", referencingSchema: "public", referencingTable: "itens_pedido", columns: ["empresa", "pedido_id"], referencedColumns: ["empresa", "id"], onDelete: "CASCADE", onUpdate: null };

  it("a resposta da API passa, com as colunas na ordem da chave", () => {
    expect(referencingForeignKeysSchema.parse([key])).toEqual([key]);
  });

  it("as duas regras são opcionais (o banco pode não informar), e uma lista vazia passa", () => {
    const bare = { name: key.name, referencingSchema: key.referencingSchema, referencingTable: key.referencingTable, columns: key.columns, referencedColumns: key.referencedColumns };

    expect(referencingForeignKeysSchema.parse([bare])).toEqual([bare]);
    expect(referencingForeignKeysSchema.parse([])).toEqual([]);
  });

  it("sem o nome, a tabela de origem ou as colunas, a resposta é recusada", () => {
    expect(referencingForeignKeysSchema.safeParse([{ ...key, name: undefined }]).success).toBe(false);
    expect(referencingForeignKeysSchema.safeParse([{ ...key, referencingTable: undefined }]).success).toBe(false);
    expect(referencingForeignKeysSchema.safeParse([{ ...key, columns: "pedido_id" }]).success).toBe(false);
  });
});
