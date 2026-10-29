import { describe, expect, it } from "vitest";
import { emptyModel } from "./build-model";
import { fileNameOf, modelFromFile, needsScopeQuestion } from "./build-files";
import { readCanvasModel } from "./fixtures";

const dbmlComProjectPostgres = `Project estoque {
  database_type: 'PostgreSQL'
}

Table public.item {
  id bigint [pk, increment]
  sku varchar(40) [not null, unique]
}`;

describe("build-files", () => {
  it("needsScopeQuestion é verdadeiro só com base e scope nulo", () => {
    const withBaseNullScope = {
      ...readCanvasModel(),
      ddl: { ...readCanvasModel().ddl, scope: null },
    };
    const withBaseSetScope = {
      ...readCanvasModel(),
      ddl: { ...readCanvasModel().ddl, scope: "changes" as const },
    };
    const withoutBase = emptyModel("postgresql", "public");

    expect(needsScopeQuestion(withBaseNullScope)).toBe(true);
    expect(needsScopeQuestion(withBaseSetScope)).toBe(false);
    expect(needsScopeQuestion(withoutBase)).toBe(false);
  });

  it("fileNameOf monta o nome com a extensão pedida", () => {
    expect(fileNameOf("manutencao", "dbml")).toBe("manutencao.dbml");
    expect(fileNameOf("manutencao", "sql")).toBe("manutencao.sql");
    expect(fileNameOf("manutencao", "png")).toBe("manutencao.png");
  });

  it("modelFromFile('estoque.dbml', dbmlComProjectPostgres, null) cria com engine postgresql e nome estoque", () => {
    const res = modelFromFile("estoque.dbml", dbmlComProjectPostgres, null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.name).toBe("estoque");
    expect(res.model.engine).toBe("postgresql");
    expect(res.model.base).toBeNull();
    expect(res.model.tables).toHaveLength(1);
    expect(res.model.tables[0]?.name).toBe("item");
  });

  it("modelFromFile com .sql sem destino devolve needsEngine", () => {
    const sql = "CREATE TABLE public.item (id bigint PRIMARY KEY);";
    const res = modelFromFile("estoque.sql", sql, null);
    expect(res).toEqual({ ok: false, needsEngine: true });

    const withEngine = modelFromFile("estoque.sql", sql, "postgresql");
    expect(withEngine.ok).toBe(true);
    if (withEngine.ok) {
      expect(withEngine.name).toBe("estoque");
      expect(withEngine.model.engine).toBe("postgresql");
      expect(withEngine.model.tables).toHaveLength(1);
    }
  });
});
