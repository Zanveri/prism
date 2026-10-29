import type { CheckItem, CheckTree } from "@/app/connections/_lib/check-tree";
import type { Connection } from "@/app/connections/_lib/connections.schema";

import { sameName } from "./build-engines";
import type { BuildEngine, BuildModel } from "./build-model.schema";
import type { CatalogSelection } from "./catalog-import";

export function buildEngineOfConnection(engine: number): BuildEngine | null {
  if (engine === 1) return "postgresql";
  if (engine === 2) return "db2";
  if (engine === 3) return "informix";
  return null;
}

export function connectionEngineNumber(engine: BuildEngine): 1 | 2 | 3 {
  if (engine === "postgresql") return 1;
  if (engine === "db2") return 2;
  return 3;
}

export function supportedConnections(
  connections: readonly Connection[],
  targetEngine?: BuildEngine,
): Connection[] {
  return connections.filter((conn) => {
    const engine = buildEngineOfConnection(conn.engine);
    if (!engine) return false;
    return targetEngine ? engine === targetEngine : true;
  });
}

export function shouldCreateSchemaByDefault(
  engine: BuildEngine,
  defaultSchema: string,
  baseSchemas: readonly string[],
): boolean {
  if (engine === "informix") return false;
  const trimmed = defaultSchema.trim();
  if (!trimmed) return false;
  return !baseSchemas.some((s) =>
    sameName(engine, { name: s, exactName: false }, { name: trimmed, exactName: false }),
  );
}

/**
 * Monta os itens para `checkTree`: os esquemas como `kind: "folder"` e as tabelas como `kind: "connection"`.
 */
export function catalogTreeItems(
  schemas: readonly { schema: string; tables: readonly string[] }[],
): CheckItem[] {
  const items: CheckItem[] = [];
  for (const group of schemas) {
    items.push({
      key: group.schema,
      kind: "folder",
      parentKey: null,
      name: group.schema,
      selectable: true,
    });
    for (const table of group.tables) {
      items.push({
        key: `${group.schema}.${table}`,
        kind: "connection",
        parentKey: group.schema,
        name: table,
        selectable: true,
      });
    }
  }
  return items;
}

/**
 * Calcula a seleção de tabelas a ler, as contagens e as tabelas que já estão no modelo.
 */
export function selectionOf(
  tree: CheckTree,
  checked: ReadonlySet<string>,
  model: BuildModel | null,
): {
  selection: CatalogSelection;
  counts: { checked: number; total: number };
  alreadyInModel: string[];
} {
  const tableNodes = tree.nodes.filter((node) => node.kind === "connection");
  const alreadyInModel: string[] = [];
  const bySchema = new Map<string, string[]>();
  let checkedCount = 0;

  for (const node of tableNodes) {
    const schema = node.parentKey ?? "";
    const table = node.name;
    const inModel =
      model !== null &&
      model.tables.some(
        (t) =>
          sameName(
            model.engine,
            { name: t.schema, exactName: false },
            { name: schema, exactName: false },
          ) && sameName(model.engine, t, { name: table, exactName: false }),
      );

    if (inModel) {
      alreadyInModel.push(node.key);
    }

    if (checked.has(node.key)) {
      checkedCount += 1;
      if (!inModel) {
        const list = bySchema.get(schema);
        if (list) {
          list.push(table);
        } else {
          bySchema.set(schema, [table]);
        }
      }
    }
  }

  const selection: CatalogSelection = [];
  for (const [schema, tables] of bySchema.entries()) {
    if (tables.length > 0) {
      selection.push({ schema, tables });
    }
  }

  return {
    selection,
    counts: { checked: checkedCount, total: tableNodes.length },
    alreadyInModel,
  };
}
