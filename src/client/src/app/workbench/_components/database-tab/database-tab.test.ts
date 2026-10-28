import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DatabaseDiagramBody, DatabasePropertiesBody, DatabaseSchemasBody, DatabaseViewTabs } from "./database-tab";

describe("DatabaseViewTabs", () => {
  it("marca a vista selecionada e exibe Esquemas, Diagrama e Propriedades", () => {
    const html = renderToStaticMarkup(
      createElement(DatabaseViewTabs, {
        tabId: "db-1",
        view: "diagram",
        onChange: vi.fn(),
      }),
    );

    expect(html).toContain("Esquemas");
    expect(html).toContain("Diagrama");
    expect(html).toContain("Propriedades");
    expect(html).toContain('id="database-view-db-1-diagram" aria-selected="true"');
  });
});

describe("DatabaseSchemasBody", () => {
  it("lista os esquemas do banco com contagens e ações de abrir esquema e diagrama", () => {
    const html = renderToStaticMarkup(
      createElement(DatabaseSchemasBody, {
        schemas: [
          { name: "public", isSystem: false, tables: 8, views: 2 },
          { name: "pg_catalog", isSystem: true, tables: 62, views: 14 },
        ],
        filter: "",
        onFilterChange: vi.fn(),
        includeSystemSchemas: false,
        onIncludeSystemSchemasChange: vi.fn(),
        fetching: false,
        onRefresh: vi.fn(),
        onOpenSchema: vi.fn(),
      }),
    );

    expect(html).toContain("public");
    expect(html).toContain("8");
    expect(html).toContain("Abrir esquema");
    expect(html).toContain("Ver diagrama");
  });
});

describe("DatabaseDiagramBody", () => {
  it("renderiza o diagrama do banco inteiro com múltiplos esquemas e barra de exportação", () => {
    const html = renderToStaticMarkup(
      createElement(DatabaseDiagramBody, {
        database: "erp",
        schemas: [
          {
            schema: "public",
            diagram: {
              tables: [
                {
                  name: "clientes",
                  columns: [{ name: "id", type: "integer", isNullable: false, isPrimaryKey: true }],
                },
              ],
              foreignKeys: [],
            },
          },
          {
            schema: "vendas",
            diagram: {
              tables: [
                {
                  name: "pedidos",
                  columns: [
                    { name: "id", type: "integer", isNullable: false, isPrimaryKey: true },
                    { name: "cliente_id", type: "integer", isNullable: false, isPrimaryKey: false },
                  ],
                },
              ],
              foreignKeys: [
                {
                  name: "fk_pedidos_cliente",
                  referencingTable: "pedidos",
                  columns: ["cliente_id"],
                  referencedSchema: "public",
                  referencedTable: "clientes",
                  referencedColumns: ["id"],
                },
              ],
            },
          },
        ],
        columnsMode: "all",
        onColumnsModeChange: vi.fn(),
        fetching: false,
        onRefresh: vi.fn(),
        onOpenTable: vi.fn(),
      }),
    );

    expect(html).toContain("2 tabelas, 1 chave estrangeira");
    expect(html).toContain("Exportar PNG");
    expect(html).toContain("Exportar Mermaid (.md)");
    expect(html).toContain("Copiar Mermaid");
    expect(html).toContain("Filtrar tabelas…");
  });

  it("mostra aviso quando não há tabelas nos esquemas selecionados do banco", () => {
    const html = renderToStaticMarkup(
      createElement(DatabaseDiagramBody, {
        database: "erp",
        schemas: [{ schema: "public", diagram: { tables: [], foreignKeys: [] } }],
        columnsMode: "all",
        onColumnsModeChange: vi.fn(),
        fetching: false,
        onRefresh: vi.fn(),
        onOpenTable: vi.fn(),
      }),
    );

    expect(html).toContain("Este banco não tem tabelas nos esquemas selecionados para mostrar no diagrama.");
  });
});

describe("DatabasePropertiesBody", () => {
  it("exibe as propriedades do banco e indica quando um campo não foi informado", () => {
    const html = renderToStaticMarkup(
      createElement(DatabasePropertiesBody, {
        properties: [
          { name: "Versão do servidor", value: "PostgreSQL 16.4" },
          { name: "Codificação", value: "UTF8" },
          { name: "Collation", value: "" },
          { name: "Usuário da sessão", value: "postgres" },
        ],
        fetching: false,
        onRefresh: vi.fn(),
      }),
    );

    expect(html).toContain("PostgreSQL 16.4");
    expect(html).toContain("UTF8");
    expect(html).toContain("Não informado pelo banco");
    expect(html).toContain("postgres");
  });
});
