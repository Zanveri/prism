import type { SchemaDiagram, SchemaDiagramColumn, SchemaDiagramForeignKey } from "./database-sessions.schema";
import { boxWidth, rowHeight, tableKey, type DiagramBox, type DiagramColumn, type DiagramEdge, type DiagramLayout, type Point, type TableRef } from "./table-diagram";

const boxPadding = 12;
const margin = 48;
const columnGap = 128;
const stackGap = 32;
const componentGap = 64;
const loopRoom = 64;
const maxLayers = 6;

export type ColumnsMode = "all" | "keys";

export type GraphDiagramOptions = {
  /** `"all"` mostra todas as colunas; `"keys"` mantém apenas chaves primárias, estrangeiras e colunas referenciadas. */
  columnsMode?: ColumnsMode;
  /** Quando verdadeiro, todas as caixas exibem `esquema.tabela` no cabeçalho (padrão no diagrama de banco). */
  qualifyNames?: boolean;
};

type TableEntry = {
  key: string;
  ref: TableRef;
  title?: string;
  external: boolean;
  columns: DiagramColumn[] | null;
  height: number;
};

type ScopedForeignKey = SchemaDiagramForeignKey & {
  referencingSchema: string;
};

const heightOf = (columns: DiagramColumn[] | null) => rowHeight * ((columns?.length ?? 0) + 1) + 2 * boxPadding;

const indexOfColumn = (columns: DiagramColumn[] | null, name: string | undefined) => (columns === null || name === undefined ? -1 : columns.findIndex((column) => column.name === name));

const rowCenter = (box: DiagramBox, index: number) => box.y + boxPadding + rowHeight * (index + 1) + rowHeight / 2;

function simplify(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

function buildColumns(columns: SchemaDiagramColumn[], fkCols: ReadonlySet<string>, refCols: ReadonlySet<string>, mode: ColumnsMode): DiagramColumn[] {
  const mapped = columns.map((column) => ({
    name: column.name,
    type: column.type,
    primaryKey: column.isPrimaryKey,
    foreignKey: fkCols.has(column.name),
  }));
  if (mode === "keys") {
    return mapped.filter((column) => column.primaryKey || column.foreignKey || refCols.has(column.name));
  }
  return mapped;
}

/**
 * Monta o diagrama de um esquema inteiro (RN-ESQUEMA-003): todas as tabelas do esquema e as chaves estrangeiras entre elas,
 * mais caixas externas (só cabeçalho `esquema.tabela`) para tabelas referenciadas em outros esquemas.
 */
export function layoutSchemaDiagram(schema: string, diagram: SchemaDiagram, options: GraphDiagramOptions = {}): DiagramLayout {
  return layoutDatabaseDiagram([{ schema, diagram }], { qualifyNames: false, ...options });
}

/**
 * Monta o diagrama de um ou mais esquemas (diagrama do banco inteiro ou de um esquema):
 * separa componentes conexos em camadas da esquerda para a direita e organiza tabelas isoladas em grade abaixo.
 */
export function layoutDatabaseDiagram(schemas: readonly { schema: string; diagram: SchemaDiagram }[], options: GraphDiagramOptions = {}): DiagramLayout {
  const columnsMode = options.columnsMode ?? "all";
  const qualifyAll = options.qualifyNames ?? schemas.length > 1;
  const singleSchema = schemas.length === 1 ? schemas[0].schema : null;

  const foreignKeys: ScopedForeignKey[] = [];
  const fkColsByTable = new Map<string, Set<string>>();
  const refColsByTable = new Map<string, Set<string>>();

  for (const { schema, diagram } of schemas) {
    for (const fk of diagram.foreignKeys) {
      foreignKeys.push({ ...fk, referencingSchema: schema });
      const fromKey = tableKey({ schema, name: fk.referencingTable });
      const toKey = tableKey({ schema: fk.referencedSchema, name: fk.referencedTable });

      const fkSet = fkColsByTable.get(fromKey) ?? new Set<string>();
      for (const col of fk.columns) fkSet.add(col);
      fkColsByTable.set(fromKey, fkSet);

      const refSet = refColsByTable.get(toKey) ?? new Set<string>();
      for (const col of fk.referencedColumns) refSet.add(col);
      refColsByTable.set(toKey, refSet);
    }
  }

  const entries = new Map<string, TableEntry>();
  for (const { schema, diagram } of schemas) {
    for (const table of diagram.tables) {
      const ref: TableRef = { schema, name: table.name };
      const key = tableKey(ref);
      const cols = buildColumns(table.columns, fkColsByTable.get(key) ?? new Set(), refColsByTable.get(key) ?? new Set(), columnsMode);
      entries.set(key, {
        key,
        ref,
        title: qualifyAll ? `${schema}.${table.name}` : undefined,
        external: false,
        columns: cols,
        height: heightOf(cols),
      });
    }
  }

  for (const fk of foreignKeys) {
    const ref: TableRef = { schema: fk.referencedSchema, name: fk.referencedTable };
    const key = tableKey(ref);
    if (!entries.has(key)) {
      const isOtherSchema = singleSchema === null || fk.referencedSchema !== singleSchema;
      entries.set(key, {
        key,
        ref,
        title: qualifyAll || isOtherSchema ? `${fk.referencedSchema}.${fk.referencedTable}` : undefined,
        external: true,
        columns: null,
        height: heightOf(null),
      });
    }
  }

  if (entries.size === 0) {
    return { boxes: [], edges: [], width: 2 * margin, height: 2 * margin };
  }

  const undirected = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();
  for (const key of entries.keys()) {
    undirected.set(key, new Set());
    outgoing.set(key, new Set());
    incoming.set(key, new Set());
  }

  for (const fk of foreignKeys) {
    const u = tableKey({ schema: fk.referencingSchema, name: fk.referencingTable });
    const v = tableKey({ schema: fk.referencedSchema, name: fk.referencedTable });
    if (u === v || !entries.has(u) || !entries.has(v)) continue;
    undirected.get(u)?.add(v);
    undirected.get(v)?.add(u);
    outgoing.get(u)?.add(v);
    incoming.get(v)?.add(u);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  const isolated: string[] = [];

  for (const key of entries.keys()) {
    if (visited.has(key)) continue;
    const neighbors = undirected.get(key);
    if (!neighbors || neighbors.size === 0) {
      visited.add(key);
      isolated.push(key);
      continue;
    }
    const queue = [key];
    visited.add(key);
    const component: string[] = [];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      component.push(curr);
      for (const next of undirected.get(curr) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }

  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

  const boxes: DiagramBox[] = [];
  let currentY = margin;

  for (const component of components) {
    const ordered = [...component].sort((a, b) => {
      const scoreA = (outgoing.get(a)?.size ?? 0) - (incoming.get(a)?.size ?? 0);
      const scoreB = (outgoing.get(b)?.size ?? 0) - (incoming.get(b)?.size ?? 0);
      return scoreB - scoreA || a.localeCompare(b);
    });

    const rankOf = new Map(ordered.map((key, idx) => [key, idx]));
    const rawLayer = new Map<string, number>(ordered.map((key) => [key, 0]));

    for (const u of ordered) {
      const uLayer = rawLayer.get(u) ?? 0;
      for (const v of outgoing.get(u) ?? []) {
        if (!rankOf.has(v)) continue;
        if ((rankOf.get(u) ?? 0) < (rankOf.get(v) ?? 0)) {
          rawLayer.set(v, Math.max(rawLayer.get(v) ?? 0, Math.min(maxLayers - 1, uLayer + 1)));
        }
      }
    }

    const distinctLayers = [...new Set(rawLayer.values())].sort((a, b) => a - b);
    const layerBuckets: string[][] = distinctLayers.map(() => []);
    for (const key of ordered) {
      const layerIdx = distinctLayers.indexOf(rawLayer.get(key) ?? 0);
      layerBuckets[layerIdx].push(key);
    }

    // Ordena cada camada pela média das posições dos vizinhos na camada anterior para reduzir cruzamentos.
    for (let layerIdx = 1; layerIdx < layerBuckets.length; layerIdx++) {
      const prevLayer = layerBuckets[layerIdx - 1];
      const prevPos = new Map(prevLayer.map((key, idx) => [key, idx]));
      layerBuckets[layerIdx].sort((a, b) => {
        const bary = (nodeKey: string) => {
          const connected = [...(undirected.get(nodeKey) ?? [])].filter((n) => prevPos.has(n));
          if (connected.length === 0) return Number.MAX_SAFE_INTEGER;
          return connected.reduce((sum, n) => sum + (prevPos.get(n) ?? 0), 0) / connected.length;
        };
        return bary(a) - bary(b) || a.localeCompare(b);
      });
    }

    const layerHeights = layerBuckets.map((bucket) => bucket.reduce((sum, key) => sum + (entries.get(key)?.height ?? 0), 0) + stackGap * Math.max(0, bucket.length - 1));
    const componentHeight = Math.max(...layerHeights, 0);

    layerBuckets.forEach((bucket, colIdx) => {
      const colHeight = layerHeights[colIdx];
      const x = margin + colIdx * (boxWidth + columnGap);
      let y = currentY + Math.round((componentHeight - colHeight) / 2);

      for (const key of bucket) {
        const entry = entries.get(key)!;
        boxes.push({
          key: entry.key,
          ref: entry.ref,
          ...(entry.title === undefined ? {} : { title: entry.title }),
          ...(entry.external ? { external: true } : {}),
          center: false,
          x,
          y,
          width: boxWidth,
          height: entry.height,
          columns: entry.columns,
        });
        y += entry.height + stackGap;
      }
    });

    currentY += componentHeight + componentGap;
  }

  if (isolated.length > 0) {
    const gridCols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(isolated.length))));
    for (let index = 0; index < isolated.length; index += gridCols) {
      const rowSlice = isolated.slice(index, index + gridCols);
      const rowMaxHeight = Math.max(...rowSlice.map((key) => entries.get(key)?.height ?? 0));

      rowSlice.forEach((key, colIdx) => {
        const entry = entries.get(key)!;
        boxes.push({
          key: entry.key,
          ref: entry.ref,
          ...(entry.title === undefined ? {} : { title: entry.title }),
          ...(entry.external ? { external: true } : {}),
          center: false,
          x: margin + colIdx * (boxWidth + columnGap),
          y: currentY,
          width: boxWidth,
          height: entry.height,
          columns: entry.columns,
        });
      });

      currentY += rowMaxHeight + stackGap;
    }
  }

  const byKey = new Map(boxes.map((box) => [box.key, box]));

  type GraphRoute = {
    fk: ScopedForeignKey;
    order: number;
    source: DiagramBox;
    target: DiagramBox;
    fromSide: "left" | "right";
    toSide: "left" | "right";
    fromY: number;
    toY: number;
    corridorKey: string;
    corridorBaseX: number;
    corridorWidth: number;
    corridorDir: 1 | -1;
  };

  const routes: GraphRoute[] = [];
  foreignKeys.forEach((fk, order) => {
    const fromKey = tableKey({ schema: fk.referencingSchema, name: fk.referencingTable });
    const toKey = tableKey({ schema: fk.referencedSchema, name: fk.referencedTable });
    const source = byKey.get(fromKey);
    const target = byKey.get(toKey);
    if (!source || !target) return;

    const sameColumn = source.x === target.x;
    const goingRight = source.x < target.x;
    const fromSide: "left" | "right" = sameColumn || goingRight ? "right" : "left";
    const toSide: "left" | "right" = sameColumn ? "right" : goingRight ? "left" : "right";

    const fromY = rowCenter(source, indexOfColumn(source.columns, fk.columns[0]));
    const toY = rowCenter(target, indexOfColumn(target.columns, fk.referencedColumns[0]));

    const corridorBaseX = fromSide === "right" ? source.x + source.width : source.x;
    const corridorDir: 1 | -1 = fromSide === "right" ? 1 : -1;
    const hasRightColumn = boxes.some((box) => box.x > source.x);
    const corridorWidth = sameColumn && !hasRightColumn ? loopRoom : columnGap;

    routes.push({
      fk,
      order,
      source,
      target,
      fromSide,
      toSide,
      fromY,
      toY,
      corridorKey: `${corridorBaseX}:${corridorDir}`,
      corridorBaseX,
      corridorWidth,
      corridorDir,
    });
  });

  // Espalha portas que caem na mesma borda e na mesma linha.
  type PortRef = { route: GraphRoute; field: "fromY" | "toY"; y: number; opposite: number };
  const portGroups = new Map<string, PortRef[]>();
  for (const route of routes) {
    const fromPortKey = `${route.source.key}:${route.fromSide}:${route.fromY}`;
    const toPortKey = `${route.target.key}:${route.toSide}:${route.toY}`;
    portGroups.set(fromPortKey, [...(portGroups.get(fromPortKey) ?? []), { route, field: "fromY", y: route.fromY, opposite: route.toY }]);
    portGroups.set(toPortKey, [...(portGroups.get(toPortKey) ?? []), { route, field: "toY", y: route.toY, opposite: route.fromY }]);
  }

  for (const group of portGroups.values()) {
    if (group.length < 2) continue;
    const step = Math.min(6, (rowHeight - 6) / (group.length - 1));
    const sorted = [...group].sort((a, b) => a.opposite - b.opposite || a.route.order - b.route.order);
    sorted.forEach((port, idx) => {
      port.route[port.field] = port.y + Math.round((idx - (group.length - 1) / 2) * step);
    });
  }

  // Agrupa rotas por corredor vertical para que cada aresta tenha seu próprio X vertical.
  const corridors = new Map<string, GraphRoute[]>();
  for (const route of routes) {
    corridors.set(route.corridorKey, [...(corridors.get(route.corridorKey) ?? []), route]);
  }

  const edges: DiagramEdge[] = [];
  for (const corridorRoutes of corridors.values()) {
    const bent = corridorRoutes.filter((route) => route.fromY !== route.toY || route.source.x === route.target.x);
    const straight = corridorRoutes.filter((route) => route.fromY === route.toY && route.source.x !== route.target.x);

    for (const route of [...bent, ...straight]) {
      const from: Point = {
        x: route.fromSide === "right" ? route.source.x + route.source.width : route.source.x,
        y: route.fromY,
      };
      const to: Point = {
        x: route.toSide === "right" ? route.target.x + route.target.width : route.target.x,
        y: route.toY,
      };

      const laneIdx = bent.indexOf(route);
      const laneX =
        laneIdx < 0
          ? from.x
          : route.corridorBaseX + route.corridorDir * Math.round((route.corridorWidth * (laneIdx + 1)) / (bent.length + 1));

      const targetName =
        qualifyAll || route.fk.referencedSchema !== route.fk.referencingSchema
          ? `${route.fk.referencedSchema}.${route.fk.referencedTable}`
          : route.fk.referencedTable;

      edges.push({
        key: `${route.order}:${route.fk.referencingSchema}.${route.fk.referencingTable}:${route.fk.name}`,
        name: route.fk.name,
        label: `${route.fk.name}: ${route.fk.columns.join(", ")} → ${targetName} (${route.fk.referencedColumns.join(", ")})`,
        from,
        to,
        points: laneIdx < 0 ? [from, to] : simplify([from, { x: laneX, y: from.y }, { x: laneX, y: to.y }, to]),
        fromTable: route.source.key,
        toTable: route.target.key,
        fromColumn: route.fk.columns[0],
        toColumn: route.fk.referencedColumns[0],
      });
    }
  }

  edges.sort((a, b) => Number(a.key.split(":")[0]) - Number(b.key.split(":")[0]));

  const rightmost = Math.max(...boxes.map((box) => box.x + box.width), ...edges.flatMap((edge) => edge.points.map((point) => point.x)));
  const bottommost = Math.max(...boxes.map((box) => box.y + box.height), ...edges.flatMap((edge) => edge.points.map((point) => point.y)));

  return {
    boxes,
    edges,
    width: rightmost + margin,
    height: bottommost + margin,
  };
}

/**
 * Devolve o conjunto de caixas (a selecionada e suas vizinhas diretas) e de arestas incidentes
 * quando o usuário seleciona uma tabela no diagrama para inspecionar suas ligações.
 */
export function connectedToTable(layout: DiagramLayout, selectedTableKey: string | null): { tables: ReadonlySet<string>; edges: ReadonlySet<string> } {
  if (selectedTableKey === null || !layout.boxes.some((box) => box.key === selectedTableKey)) {
    return { tables: new Set(), edges: new Set() };
  }

  const tables = new Set<string>([selectedTableKey]);
  const edges = new Set<string>();

  for (const edge of layout.edges) {
    if (edge.fromTable === selectedTableKey || edge.toTable === selectedTableKey) {
      edges.add(edge.key);
      if (edge.fromTable !== undefined) tables.add(edge.fromTable);
      if (edge.toTable !== undefined) tables.add(edge.toTable);
    }
  }

  return { tables, edges };
}

/** Filtra caixas do diagrama pelo nome da tabela ou pelo título qualificado (`esquema.tabela`). */
export function filterDiagramBoxes(boxes: readonly DiagramBox[], query: string): DiagramBox[] {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return [...boxes];
  return boxes.filter((box) => {
    const full = `${box.ref.schema}.${box.ref.name}`.toLowerCase();
    const title = (box.title ?? box.ref.name).toLowerCase();
    return box.ref.name.toLowerCase().includes(normalized) || title.includes(normalized) || full.includes(normalized);
  });
}

/** Filtra um `DiagramLayout` mantendo as caixas que casam com a busca e as arestas entre elas. */
export function filterDiagramLayout(layout: DiagramLayout, query: string): DiagramLayout {
  if (query.trim().length === 0) return layout;
  const boxes = filterDiagramBoxes(layout.boxes, query);
  const kept = new Set(boxes.map((box) => box.key));
  const edges = layout.edges.filter((edge) => edge.fromTable !== undefined && edge.toTable !== undefined && kept.has(edge.fromTable) && kept.has(edge.toTable));
  return { ...layout, boxes, edges };
}
