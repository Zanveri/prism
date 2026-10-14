import { describe, expect, it } from "vitest";

import { stripTitles } from "./tab-titles";
import type { QueryTab } from "./workbench-model";

const table = (id: string, schema: string, name: string, extra: Partial<QueryTab> = {}): QueryTab => ({
  id,
  title: extra.database === undefined ? `${schema}.${name}` : `${extra.database}.${schema}.${name}`,
  connectionId: "c1",
  sessionId: null,
  sql: "",
  table: { schema, name, view: "data" },
  ...extra,
});
const query = (id: string, title: string): QueryTab => ({ id, title, connectionId: "c1", sessionId: null, sql: "" });

describe("o nome das abas na barra (RN-ABAS-008)", () => {
  it("com as tabelas de um esquema só, a aba mostra só o nome da tabela", () => {
    const titles = stripTitles([table("a", "usr_migration", "pallets"), table("b", "usr_migration", "items"), query("q", "consulta-1.sql")]);

    expect(titles.get("a")).toBe("pallets");
    expect(titles.get("b")).toBe("items");
    expect(titles.get("q")).toBe("consulta-1.sql");
  });

  it("com tabelas de mais de um esquema abertas, toda aba de tabela mostra o esquema", () => {
    const titles = stripTitles([table("a", "usr_migration", "pallets"), table("b", "usr_datalake", "items")]);

    expect(titles.get("a")).toBe("usr_migration.pallets");
    expect(titles.get("b")).toBe("usr_datalake.items");
  });

  it("o mesmo esquema noutra conexão conta como outro esquema", () => {
    const titles = stripTitles([table("a", "public", "pedidos"), table("b", "public", "clientes", { connectionId: "c2" })]);

    expect(titles.get("a")).toBe("public.pedidos");
  });

  it("com tabelas de mais de um banco abertas, a aba mostra o banco e o esquema", () => {
    const titles = stripTitles([table("a", "public", "pedidos", { database: "vendas" }), table("b", "public", "pedidos")]);

    expect(titles.get("a")).toBe("vendas.public.pedidos");
    expect(titles.get("b")).toBe("public.pedidos");
  });

  it("fechar a aba do outro esquema volta ao nome curto", () => {
    expect(stripTitles([table("a", "usr_migration", "pallets")]).get("a")).toBe("pallets");
  });
});
