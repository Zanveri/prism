import { describe, expect, it } from "vitest";

import { databaseSessionSchema } from "./database-sessions.schema";

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
