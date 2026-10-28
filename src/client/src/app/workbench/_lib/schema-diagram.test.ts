import { describe, expect, it } from "vitest";

import type { SchemaDiagram } from "./database-sessions.schema";
import { connectedToTable, filterDiagramBoxes, layoutDatabaseDiagram, layoutSchemaDiagram } from "./schema-diagram";
import { rowHeight, tableKey, type DiagramBox, type DiagramLayout } from "./table-diagram";

const sampleSchema: SchemaDiagram = {
  tables: [
    {
      name: "pedidos",
      columns: [
        { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
        { name: "cliente_id", type: "bigint", isNullable: false, isPrimaryKey: false },
        { name: "vendedor_id", type: "bigint", isNullable: true, isPrimaryKey: false },
        { name: "criado_em", type: "timestamptz", isNullable: false, isPrimaryKey: false },
      ],
    },
    {
      name: "clientes",
      columns: [
        { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
        { name: "nome", type: "varchar(120)", isNullable: false, isPrimaryKey: false },
      ],
    },
    {
      name: "itens_pedido",
      columns: [
        { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
        { name: "pedido_id", type: "bigint", isNullable: false, isPrimaryKey: false },
        { name: "quantidade", type: "integer", isNullable: false, isPrimaryKey: false },
      ],
    },
    {
      name: "parametros",
      columns: [
        { name: "chave", type: "varchar(40)", isNullable: false, isPrimaryKey: true },
        { name: "valor", type: "text", isNullable: false, isPrimaryKey: false },
      ],
    },
  ],
  foreignKeys: [
    {
      name: "fk_pedido_cliente",
      referencingTable: "pedidos",
      columns: ["cliente_id"],
      referencedSchema: "loja",
      referencedTable: "clientes",
      referencedColumns: ["id"],
    },
    {
      name: "fk_pedido_vendedor_externo",
      referencingTable: "pedidos",
      columns: ["vendedor_id"],
      referencedSchema: "rh",
      referencedTable: "funcionarios",
      referencedColumns: ["id"],
    },
    {
      name: "fk_item_pedido",
      referencingTable: "itens_pedido",
      columns: ["pedido_id"],
      referencedSchema: "loja",
      referencedTable: "pedidos",
      referencedColumns: ["id"],
    },
  ],
};

const boxOf = (layout: DiagramLayout, schema: string, name: string): DiagramBox => {
  const box = layout.boxes.find((item) => item.key === tableKey({ schema, name }));
  if (box === undefined) throw new Error(`Sem caixa para ${schema}.${name}`);
  return box;
};

describe("layoutSchemaDiagram: diagrama completo de um esquema (RN-ESQUEMA-003)", () => {
  it("posiciona todas as tabelas do esquema e cria caixas externas qualificadas para tabelas de outros esquemas", () => {
    const layout = layoutSchemaDiagram("loja", sampleSchema);

    expect(layout.boxes).toHaveLength(5);
    const pedidos = boxOf(layout, "loja", "pedidos");
    const clientes = boxOf(layout, "loja", "clientes");
    const itens = boxOf(layout, "loja", "itens_pedido");
    const parametros = boxOf(layout, "loja", "parametros");
    const externo = boxOf(layout, "rh", "funcionarios");

    expect(pedidos.title).toBeUndefined();
    expect(clientes.external).toBeFalsy();
    expect(itens.external).toBeFalsy();
    expect(parametros.external).toBeFalsy();

    // A tabela de outro esquema aparece só com o nome qualificado (rh.funcionarios) e sem colunas.
    expect(externo.external).toBe(true);
    expect(externo.title).toBe("rh.funcionarios");
    expect(externo.columns).toBeNull();
    expect(externo.height).toBe(rowHeight + 24);
  });

  it("marca PK e FK nas colunas das tabelas de origem e mantém todas as caixas sem sobreposição", () => {
    const layout = layoutSchemaDiagram("loja", sampleSchema);
    const pedidos = boxOf(layout, "loja", "pedidos");

    expect(pedidos.columns?.map((col) => [col.name, col.primaryKey, col.foreignKey])).toEqual([
      ["id", true, false],
      ["cliente_id", false, true],
      ["vendedor_id", false, true],
      ["criado_em", false, false],
    ]);

    for (const [i, a] of layout.boxes.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.x + a.width).toBeLessThanOrEqual(layout.width);
      expect(a.y + a.height).toBeLessThanOrEqual(layout.height);
      for (const b of layout.boxes.slice(i + 1)) {
        const separated = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(separated, `${a.key} e ${b.key} se sobrepõem`).toBe(true);
      }
    }
  });

  it("gera caminhos estritamente ortogonais com saídas e chegadas horizontais e metadados de tabela/coluna", () => {
    const layout = layoutSchemaDiagram("loja", sampleSchema);

    expect(layout.edges).toHaveLength(3);
    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      expect(edge.points[0]).toEqual(edge.from);
      expect(edge.points.at(-1)).toEqual(edge.to);
      expect(edge.points[0].y).toBe(edge.points[1].y);
      expect(edge.points.at(-1)?.y).toBe(edge.points.at(-2)?.y);
      for (let index = 1; index < edge.points.length; index++) {
        const prev = edge.points[index - 1];
        const curr = edge.points[index];
        expect(prev.x === curr.x || prev.y === curr.y, edge.name).toBe(true);
      }
      expect(edge.fromTable).toBeDefined();
      expect(edge.toTable).toBeDefined();
    }
  });

  it("modo 'keys' mantém apenas colunas PK, FK ou alvo de chave estrangeira", () => {
    const layout = layoutSchemaDiagram("loja", sampleSchema, { columnsMode: "keys" });
    const pedidos = boxOf(layout, "loja", "pedidos");
    const parametros = boxOf(layout, "loja", "parametros");

    expect(pedidos.columns?.map((col) => col.name)).toEqual(["id", "cliente_id", "vendedor_id"]);
    expect(parametros.columns?.map((col) => col.name)).toEqual(["chave"]);
  });
});

describe("layoutDatabaseDiagram: diagrama de banco inteiro com múltiplos esquemas", () => {
  it("qualifica os títulos das tabelas com o esquema e resolve chaves entre esquemas do próprio banco", () => {
    const rhDiagram: SchemaDiagram = {
      tables: [
        {
          name: "funcionarios",
          columns: [
            { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
            { name: "matricula", type: "varchar(20)", isNullable: false, isPrimaryKey: false },
          ],
        },
      ],
      foreignKeys: [],
    };

    const layout = layoutDatabaseDiagram([
      { schema: "loja", diagram: sampleSchema },
      { schema: "rh", diagram: rhDiagram },
    ]);

    const funcionarios = boxOf(layout, "rh", "funcionarios");
    const pedidos = boxOf(layout, "loja", "pedidos");

    // Como o esquema `rh` faz parte do diagrama do banco, `rh.funcionarios` deixa de ser caixa externa sem colunas.
    expect(funcionarios.external).toBeFalsy();
    expect(funcionarios.columns).toHaveLength(2);
    expect(funcionarios.title).toBe("rh.funcionarios");
    expect(pedidos.title).toBe("loja.pedidos");
  });
});

describe("connectedToTable e filterDiagramBoxes: busca e destaque no diagrama", () => {
  it("destaca a tabela selecionada, as arestas incidentes e as tabelas vizinhas", () => {
    const layout = layoutSchemaDiagram("loja", sampleSchema);
    const pedidosKey = tableKey({ schema: "loja", name: "pedidos" });
    const highlighted = connectedToTable(layout, pedidosKey);

    expect(highlighted.tables.has(pedidosKey)).toBe(true);
    expect(highlighted.tables.has(tableKey({ schema: "loja", name: "clientes" }))).toBe(true);
    expect(highlighted.tables.has(tableKey({ schema: "loja", name: "itens_pedido" }))).toBe(true);
    expect(highlighted.tables.has(tableKey({ schema: "rh", name: "funcionarios" }))).toBe(true);
    expect(highlighted.tables.has(tableKey({ schema: "loja", name: "parametros" }))).toBe(false);
    expect(highlighted.edges.size).toBe(3);
  });

  it("filtra caixas pelo nome da tabela ou pelo título qualificado", () => {
    const layout = layoutSchemaDiagram("loja", sampleSchema);
    const matches = filterDiagramBoxes(layout.boxes, "rh.func");

    expect(matches.map((box) => box.key)).toEqual([tableKey({ schema: "rh", name: "funcionarios" })]);
  });
});
