import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";
import { withoutCursor } from "@/lib/testing/text";

import { linksOf } from "./sql-join";
import {
  analyzeStatementForJoinModal,
  buildSelectedJoins,
  childNodesOf,
  findJoinNode,
  formatJoinInsertion,
  setJoinNodeChildren,
  toggleJoinNode,
  type JoinTreeRoot,
} from "./sql-join-modal";

const postgres: Engine = 1;

describe("analyzeStatementForJoinModal", () => {
  it("extrai a tabela do FROM mesmo com o cursor colado no nome da tabela", () => {
    const { doc, at } = withoutCursor("select *\n  from orders|");
    const plan = analyzeStatementForJoinModal(doc, at, postgres, false);

    expect(plan).not.toBeNull();
    expect(plan?.references.map((ref) => [ref.schema, ref.name])).toEqual([[null, "orders"]]);
    expect(plan?.insert.mode).toBe("append-clause");
    expect(plan?.insert.from).toBe(doc.length);
  });

  it("reconhece quando o cursor já está logo depois de INNER JOIN", () => {
    const { doc, at } = withoutCursor("select *\n  from orders\n inner join |");
    const plan = analyzeStatementForJoinModal(doc, at, postgres, false);

    expect(plan?.references.map((ref) => ref.name)).toEqual(["orders"]);
    expect(plan?.insert.mode).toBe("after-join");
    expect(plan?.insert.from).toBe(at);
    expect(plan?.insert.indent).toBe(" ");
  });

  it("insere os JOINs antes da cláusula WHERE quando ela já existe no comando", () => {
    const { doc, at } = withoutCursor("select *\n  from orders|\n where orders.id = 1");
    const plan = analyzeStatementForJoinModal(doc, at, postgres, false);

    expect(plan?.insert.mode).toBe("append-clause");
    expect(doc.slice(0, plan?.insert.from)).toBe("select *\n  from orders");
  });

  it("extrai a tabela e insere os JOINs dentro do subselect quando o cursor está dentro de (select ...)", () => {
    const { doc, at } = withoutCursor("select *\n  from orders\n inner join (select * from integrations|)");
    const plan = analyzeStatementForJoinModal(doc, at, postgres, false);

    expect(plan).not.toBeNull();
    expect(plan?.references.map((ref) => [ref.schema, ref.name])).toEqual([[null, "integrations"]]);
    expect(plan?.insert.mode).toBe("append-clause");
    expect(doc.slice(0, plan?.insert.from)).toBe("select *\n  from orders\n inner join (select * from integrations");
    expect(doc.slice(plan?.insert.from)).toBe(")");
  });
});

describe("árvore recursiva de sugestões do modal (toggleJoinNode, setJoinNodeChildren, buildSelectedJoins)", () => {
  const schema = "usr_migration_stock_manager";

  function initialRoots(qualified = false, usesAlias = false): JoinTreeRoot[] {
    const links = linksOf(
      [],
      [
        {
          name: "fk_orders_packings_order",
          referencingSchema: schema,
          referencingTable: "orders_packings",
          columns: ["order_id"],
          referencedColumns: ["id"],
        },
      ],
    );
    return [
      {
        key: `${schema}.orders`,
        schema,
        name: "orders",
        qualifier: usesAlias ? "o" : "orders",
        qualified,
        nodes: childNodesOf("root:0", schema, "orders", 1, links),
      },
    ];
  }

  it("permite marcar tabelas filhas recursivamente e gera os JOINs respeitando uppercaseKeywords e o esquema", () => {
    let roots = initialRoots(false, false);
    const firstId = roots[0].nodes[0].id;

    // Marca `orders_packings` (nível 1)
    roots = toggleJoinNode(roots, firstId, true);
    expect(findJoinNode(roots, firstId)?.checked).toBe(true);

    // Quando as FKs de `orders_packings` chegam, abre abaixo dela as possíveis ligações (sem repetir a FK de volta para `orders`)
    const packingLinks = linksOf(
      [
        {
          name: "fk_orders_packings_order",
          columns: ["order_id"],
          referencedSchema: schema,
          referencedTable: "orders",
          referencedColumns: ["id"],
        },
      ],
      [
        {
          name: "fk_packings_items_packing",
          referencingSchema: schema,
          referencingTable: "packings_items",
          columns: ["packing_id"],
          referencedColumns: ["id"],
        },
      ],
    );
    roots = setJoinNodeChildren(roots, firstId, packingLinks);

    const children = findJoinNode(roots, firstId)?.children ?? [];
    expect(children).toHaveLength(1);
    expect(children[0].targetName).toBe("packings_items");
    expect(children[0].depth).toBe(2);

    // Marca a filha de segundo nível `packings_items`
    roots = toggleJoinNode(roots, children[0].id, true);

    const joins = buildSelectedJoins(roots, {
      used: new Set(["orders"]),
      usesAliases: false,
      engine: postgres,
      defaultSchemas: ["public"],
      uppercaseKeywords: false,
    });

    expect(joins.map((j) => j.clause)).toEqual([
      "inner join orders_packings on orders_packings.order_id = orders.id",
      "inner join packings_items on packings_items.packing_id = orders_packings.id",
    ]);

    const { doc, at } = withoutCursor("select *\n  from orders|");
    const plan = analyzeStatementForJoinModal(doc, at, postgres, false)!;
    const inserted = formatJoinInsertion(joins, plan.insert);
    expect(doc.slice(0, plan.insert.from) + inserted + doc.slice(plan.insert.to)).toBe(
      "select *\n  from orders\ninner join orders_packings on orders_packings.order_id = orders.id\ninner join packings_items on packings_items.packing_id = orders_packings.id",
    );
  });

  it("desmarcar uma tabela pai desmarca também todas as tabelas filhas abaixo dela", () => {
    let roots = initialRoots(false, false);
    const firstId = roots[0].nodes[0].id;
    roots = toggleJoinNode(roots, firstId, true);
    roots = setJoinNodeChildren(
      roots,
      firstId,
      linksOf([], [{ name: "fk_items", referencingSchema: schema, referencingTable: "packings_items", columns: ["packing_id"], referencedColumns: ["id"] }]),
    );
    const secondId = findJoinNode(roots, firstId)!.children[0].id;
    roots = toggleJoinNode(roots, secondId, true);

    expect(findJoinNode(roots, secondId)?.checked).toBe(true);

    roots = toggleJoinNode(roots, firstId, false);
    expect(findJoinNode(roots, firstId)?.checked).toBe(false);
    expect(findJoinNode(roots, secondId)?.checked).toBe(false);
    expect(
      buildSelectedJoins(roots, {
        used: new Set(["orders"]),
        usesAliases: false,
        engine: postgres,
        defaultSchemas: ["public"],
        uppercaseKeywords: true,
      }),
    ).toEqual([]);
  });

  it("inclui esquema e apelidos quando a tabela do FROM foi qualificada e usa apelido, com uppercaseKeywords ativo", () => {
    let roots = initialRoots(true, true);
    const firstId = roots[0].nodes[0].id;
    roots = toggleJoinNode(roots, firstId, true);

    const joins = buildSelectedJoins(roots, {
      used: new Set(["o"]),
      usesAliases: true,
      engine: postgres,
      defaultSchemas: ["public"],
      uppercaseKeywords: true,
    });

    expect(joins.map((j) => j.clause)).toEqual([
      "INNER JOIN usr_migration_stock_manager.orders_packings op ON op.order_id = o.id",
    ]);
  });
});
