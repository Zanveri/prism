import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DatabaseObject, SchemaDiagram } from "../../_lib/database-sessions.schema";
import { SchemaDiagramBody, SchemaObjectsBody, SchemaViewTabs, schemaViewOf } from "./schema-tab";

const noop = () => {};

describe("a aba de esquema (RN-ESQUEMA-001 a 003)", () => {
  it("schemaViewOf mantém a vista válida ou cai em tables", () => {
    expect(schemaViewOf("tables")).toBe("tables");
    expect(schemaViewOf("diagram")).toBe("diagram");
    expect(schemaViewOf("unknown" as never)).toBe("tables");
  });

  it("desenha o seletor de vistas do esquema (Tabelas, Visões, Rotinas e Diagrama)", () => {
    const markup = renderToStaticMarkup(
      createElement(SchemaViewTabs, {
        tabId: "tab-1",
        view: "diagram",
        onChange: noop,
      }),
    );

    expect(markup).toContain('aria-label="Vistas do esquema"');
    expect(markup).toContain(">Tabelas<");
    expect(markup).toContain(">Visões<");
    expect(markup).toContain(">Rotinas<");
    expect(markup).toContain(">Diagrama<");
    expect(markup).toMatch(/id="schema-view-tab-1-diagram"[^>]*aria-selected="true"/);
  });

  it("lista as tabelas do esquema com estimativa de linhas, descrição e botões para abrir tabela ou diagrama", () => {
    const objects: DatabaseObject[] = [
      { name: "pedido", kind: "table", estimatedRows: 1250, comment: "Pedidos de venda" },
      { name: "cliente", kind: "table", estimatedRows: 80, comment: null },
    ];
    const markup = renderToStaticMarkup(
      createElement(SchemaObjectsBody, {
        kind: "tables",
        objects,
        filter: "",
        onFilterChange: noop,
        fetching: false,
        onRefresh: noop,
        onOpenTable: noop,
      }),
    );

    expect(markup).toContain(">pedido<");
    expect(markup).toContain(">Pedidos de venda<");
    expect(markup).toContain(">cliente<");
    expect(markup).toContain(">Abrir tabela<");
    expect(markup).toContain(">Ver diagrama<");
  });

  it("desenha o diagrama completo do esquema com filtro de tabelas, seletor de colunas e botões de exportação", () => {
    const diagram: SchemaDiagram = {
      tables: [
        {
          name: "pedido",
          columns: [
            { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
            { name: "cliente_id", type: "bigint", isNullable: false, isPrimaryKey: false },
          ],
        },
        {
          name: "cliente",
          columns: [{ name: "id", type: "bigint", isNullable: false, isPrimaryKey: true }],
        },
      ],
      foreignKeys: [
        {
          name: "fk_pedido_cliente",
          referencingTable: "pedido",
          columns: ["cliente_id"],
          referencedSchema: "public",
          referencedTable: "cliente",
          referencedColumns: ["id"],
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(SchemaDiagramBody, {
        schema: "public",
        diagram,
        columnsMode: "all",
        onColumnsModeChange: noop,
        fetching: false,
        onRefresh: noop,
        onOpenTable: noop,
      }),
    );

    expect(markup).toContain('aria-label="Diagrama do esquema"');
    expect(markup).toContain('placeholder="Filtrar tabelas…"');
    expect(markup).toContain(">Mostrar só chaves<");
    expect(markup).toContain(">Exportar PNG<");
    expect(markup).toContain(">Exportar Mermaid (.md)<");
    expect(markup).toContain("<title>fk_pedido_cliente: cliente_id → cliente (id)</title>");
  });
});
