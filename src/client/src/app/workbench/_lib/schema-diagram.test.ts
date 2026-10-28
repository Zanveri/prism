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

  it("não repete o prefixo do esquema quando apenas um esquema do banco possui tabelas", () => {
    const layout = layoutDatabaseDiagram([
      { schema: "usr_migration_stock_manager", diagram: sampleSchema },
      { schema: "informix", diagram: { tables: [], foreignKeys: [] } },
      { schema: "sysadmin", diagram: { tables: [], foreignKeys: [] } },
    ]);

    const pedidos = boxOf(layout, "usr_migration_stock_manager", "pedidos");
    expect(pedidos.title).toBeUndefined();
  });

  it("mantém espaçamento amplo entre caixas e entre trilhas verticais em esquemas grandes (70 tabelas, 92 FKs)", () => {
    const tables: SchemaDiagram["tables"] = [];
    const foreignKeys: SchemaDiagram["foreignKeys"] = [];

    for (let i = 0; i < 70; i++) {
      tables.push({
        name: `tabela_estoque_modulo_${String(i).padStart(2, "0")}_detalhe`,
        columns: [
          { name: "id", type: "bigint", isNullable: false, isPrimaryKey: true },
          { name: "ref_a_id", type: "bigint", isNullable: true, isPrimaryKey: false },
          { name: "ref_b_id", type: "bigint", isNullable: true, isPrimaryKey: false },
          { name: "descricao_item", type: "varchar(120)", isNullable: false, isPrimaryKey: false },
        ],
      });
    }

    // 10 tabelas-mestre (0..9), 20 tabelas intermediárias (10..29) e 40 tabelas de movimento (30..69) totalizando 92 FKs.
    let fkCount = 0;
    for (let i = 10; i < 30 && fkCount < 92; i++) {
      foreignKeys.push({
        name: `fk_${fkCount++}`,
        referencingTable: tables[i].name,
        columns: ["ref_a_id"],
        referencedSchema: "usr_migration_stock_manager",
        referencedTable: tables[i % 10].name,
        referencedColumns: ["id"],
      });
    }
    for (let i = 30; i < 70 && fkCount < 92; i++) {
      foreignKeys.push({
        name: `fk_${fkCount++}`,
        referencingTable: tables[i].name,
        columns: ["ref_a_id"],
        referencedSchema: "usr_migration_stock_manager",
        referencedTable: tables[10 + (i % 20)].name,
        referencedColumns: ["id"],
      });
      if (fkCount < 92) {
        foreignKeys.push({
          name: `fk_${fkCount++}`,
          referencingTable: tables[i].name,
          columns: ["ref_b_id"],
          referencedSchema: "usr_migration_stock_manager",
          referencedTable: tables[(i + 3) % 10].name,
          referencedColumns: ["id"],
        });
      }
    }

    const layout = layoutDatabaseDiagram([
      { schema: "usr_migration_stock_manager", diagram: { tables, foreignKeys } },
      { schema: "empty_schema", diagram: { tables: [], foreignKeys: [] } },
    ]);

    expect(layout.boxes).toHaveLength(70);
    expect(layout.edges).toHaveLength(92);

    // Nenhuma caixa se sobrepõe: caixas na mesma faixa vertical mantêm >= 56px de distância vertical,
    // e caixas na mesma faixa horizontal mantêm >= 180px de distância horizontal.
    for (const [i, a] of layout.boxes.entries()) {
      expect(a.width).toBeGreaterThan(264);
      for (const b of layout.boxes.slice(i + 1)) {
        const overlapsHorizontally = !(a.x + a.width <= b.x || b.x + b.width <= a.x);
        const overlapsVertically = !(a.y + a.height <= b.y || b.y + b.height <= a.y);
        expect(overlapsHorizontally && overlapsVertically).toBe(false);
        if (overlapsHorizontally) {
          const verticalGap = a.y < b.y ? b.y - (a.y + a.height) : a.y - (b.y + b.height);
          expect(verticalGap).toBeGreaterThanOrEqual(56);
        }
        if (overlapsVertically) {
          const horizontalGap = a.x < b.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
          expect(horizontalGap).toBeGreaterThanOrEqual(180);
        }
      }
    }

    // Nenhum segmento vertical de aresta encosta nas bordas laterais das caixas (mínimo 36px de respiro).
    for (const edge of layout.edges) {
      for (let i = 1; i < edge.points.length; i++) {
        const p1 = edge.points[i - 1];
        const p2 = edge.points[i];
        if (p1.x === p2.x && p1.y !== p2.y) {
          const segMinY = Math.min(p1.y, p2.y);
          const segMaxY = Math.max(p1.y, p2.y);
          for (const box of layout.boxes) {
            const overlapsY = !(segMaxY < box.y || segMinY > box.y + box.height);
            if (overlapsY) {
              const distLeft = box.x - p1.x;
              const distRight = p1.x - (box.x + box.width);
              expect(Math.max(distLeft, distRight)).toBeGreaterThanOrEqual(36);
            }
          }
        }
      }
    }
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
