import { describe, expect, it } from "vitest";

import type { ColumnRef } from "./ast";
import { catalogName, columnKindOf, readColumns, type ColumnCatalog } from "./column-types";
import { nullable, numberType, stringType } from "./values";

// O tipo de uma coluna (RN-VAR-004): o quadro dos tipos de cada banco e a leitura no catálogo, com a tabela sem esquema no esquema padrão da sessão.

describe("o quadro dos tipos", () => {
  it.each([
    ["integer", 1, "number"],
    ["numeric(10,2)", 1, "number"],
    ["double precision", 1, "number"],
    ["money", 1, "string"],
    ["boolean", 1, "boolean"],
    ["date", 1, "day"],
    ["timestamp with time zone", 1, "instant"],
    ["character varying(40)", 1, "string"],
    ["uuid", 1, "string"],
    ["time without time zone", 1, "string"],
    ["bytea", 1, "binary"],
    ["integer[]", 1, "list"],
    ["DECFLOAT", 2, "number"],
    ["TIMESTAMP", 2, "instant"],
    ["CLOB", 2, "string"],
    ["BLOB", 2, "binary"],
    ["VARBINARY", 2, "binary"],
    ["SERIAL8", 3, "number"],
    ["MONEY(16,2)", 3, "number"],
    ["SMALLFLOAT", 3, "number"],
    ["DATETIME YEAR TO DAY", 3, "day"],
    ["DATETIME YEAR TO SECOND", 3, "instant"],
    ["DATETIME HOUR TO MINUTE", 3, "string"],
    ["BYTE", 3, "binary"],
    ["LVARCHAR(2000)", 3, "string"],
  ] as const)("%s no banco %i é %s", (type, engine, kind) => {
    expect(columnKindOf(type, engine)).toBe(kind);
  });
});

describe("o nome como o catálogo guarda", () => {
  it("sem aspas, a caixa do banco; entre aspas, como está", () => {
    expect(catalogName("Pedido", 1)).toBe("pedido");
    expect(catalogName("Pedido", 2)).toBe("PEDIDO");
    expect(catalogName("Pedido", 3)).toBe("pedido");
    expect(catalogName('"Pedido"', 2)).toBe("Pedido");
  });
});

const ref = (text: string): ColumnRef => {
  const parts = text.split(".");
  const [schema, table, column] = parts.length === 3 ? parts : [null, ...parts];
  return { schema, table: table as string, column: column as string, text, start: 0, end: text.length };
};

function fakeCatalog(schemas: Record<string, Record<string, { name: string; type: string; isNullable?: boolean }[]>>) {
  const calls: string[] = [];
  const catalog: ColumnCatalog = {
    tables: () => {
      calls.push("tables");
      return Promise.resolve(new Map(Object.entries(schemas).map(([schema, tables]) => [schema, new Set(Object.keys(tables))])));
    },
    columns: (schema, table) => {
      calls.push(`${schema}.${table}`);
      const columns = schemas[schema]?.[table] ?? [];
      return Promise.resolve(columns.map((column) => ({ isNullable: false, isPrimaryKey: false, ...column })));
    },
  };
  return { catalog, calls };
}

describe("a leitura no catálogo", () => {
  const schemas = {
    public: { pedido: [{ name: "cliente_id", type: "integer", isNullable: true }, { name: "nota", type: "text" }, { name: "foto", type: "bytea" }, { name: "tags", type: "text[]" }] },
    estoque: { pedido: [{ name: "cliente_id", type: "bigint" }] },
  };

  it("a tabela sem esquema vem do esquema padrão, e cada tabela se lê uma vez", async () => {
    const { catalog, calls } = fakeCatalog(schemas);
    const reads = await readColumns([ref("pedido.cliente_id"), ref("pedido.nota")], 1, ["ana", "public"], catalog);
    expect(reads.get("pedido.cliente_id")).toMatchObject({ ok: true, type: nullable(numberType), schema: "public", table: "pedido" });
    expect(reads.get("pedido.nota")).toMatchObject({ ok: true, type: stringType });
    expect(calls).toEqual(["tables", "public.pedido"]);
  });

  it("com o esquema escrito, não lista as tabelas", async () => {
    const { catalog, calls } = fakeCatalog(schemas);
    const reads = await readColumns([ref("estoque.pedido.cliente_id")], 1, ["public"], catalog);
    expect(reads.get("estoque.pedido.cliente_id")).toMatchObject({ ok: true, type: numberType, schema: "estoque" });
    expect(calls).toEqual(["estoque.pedido"]);
  });

  it("a coluna que não existe, a binária e a lista do banco são frases", async () => {
    const { catalog } = fakeCatalog(schemas);
    const reads = await readColumns([ref("pedido.cliente_idx"), ref("pedido.foto"), ref("pedido.tags"), ref("cliente.id")], 1, ["public"], catalog);
    expect(reads.get("pedido.cliente_idx")).toEqual({ ok: false, message: "A coluna pedido.cliente_idx não existe." });
    expect(reads.get("pedido.foto")).toEqual({ ok: false, message: "A coluna foto é binária, e variável não guarda binário." });
    expect(reads.get("pedido.tags")).toEqual({ ok: false, message: "A coluna tags é uma lista do banco, e o tipo de coluna não guarda lista." });
    expect(reads.get("cliente.id")).toEqual({ ok: false, message: "A coluna cliente.id não existe." });
  });

  it("a falha do catálogo é a frase de cada coluna", async () => {
    const catalog: ColumnCatalog = { tables: () => Promise.resolve({ error: "A sessão caiu." }), columns: () => Promise.resolve({ error: "não chega aqui" }) };
    const reads = await readColumns([ref("pedido.cliente_id")], 1, null, catalog);
    expect(reads.get("pedido.cliente_id")).toEqual({ ok: false, message: "A sessão caiu." });
  });
});
