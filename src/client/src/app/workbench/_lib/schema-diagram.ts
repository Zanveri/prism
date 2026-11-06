import type { SchemaDiagram, SchemaDiagramColumn, SchemaDiagramForeignKey } from "./database-sessions.schema";
import { boxWidth, rowHeight, tableKey, type DiagramBox, type DiagramColumn, type DiagramEdge, type DiagramLayout, type Point, type TableRef } from "./table-diagram";

const boxPadding = 12;
const margin = 64;
const minBoxWidth = boxWidth;
const maxBoxWidth = 480;
const baseColumnGap = 180;
const corridorPadding = 40;
const minTrackSpacing = 16;
const stackGap = 56;
const componentGap = 180;
const loopRoom = 88;
const maxLayers = 8;
const maxTablesPerColumn = 7;
const targetCanvasRowWidth = 2400;

export type ColumnsMode = "all" | "keys";

export type GraphDiagramOptions = {
  /** `"all"` mostra todas as colunas; `"keys"` mantém apenas chaves primárias, estrangeiras e colunas referenciadas. */
  columnsMode?: ColumnsMode;
  /** Quando verdadeiro, todas as caixas exibem `esquema.tabela` no cabeçalho (padrão quando há mais de um esquema com tabelas). */
  qualifyNames?: boolean;
};

type TableEntry = {
  key: string;
  ref: TableRef;
  title?: string;
  external: boolean;
  columns: DiagramColumn[] | null;
  width: number;
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
    nullable: column.isNullable,
  }));
  if (mode === "keys") {
    return mapped.filter((column) => column.primaryKey || column.foreignKey || refCols.has(column.name));
  }
  return mapped;
}

/** Calcula a largura ideal da caixa para acomodar o título e as colunas sem estourar a borda. */
function estimateBoxWidth(displayTitle: string, columns: DiagramColumn[] | null): number {
  const titleChars = displayTitle.length;
  let maxRowChars = titleChars;
  for (const col of columns ?? []) {
    const marksChars = (col.primaryKey ? 3 : 0) + (col.foreignKey ? 3 : 0);
    const rowChars = col.name.length + 1 + col.type.length + marksChars;
    if (rowChars > maxRowChars) maxRowChars = rowChars;
  }
  const estimated = Math.ceil((maxRowChars * 8.4 + 44) / 8) * 8;
  return Math.max(minBoxWidth, Math.min(maxBoxWidth, estimated));
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
 * separa componentes conexos em camadas da esquerda para a direita, dimensiona corredores conforme a densidade
 * de linhas verticais sem sobreposição e organiza tabelas isoladas em grade abaixo.
 */
export function layoutDatabaseDiagram(schemas: readonly { schema: string; diagram: SchemaDiagram }[], options: GraphDiagramOptions = {}): DiagramLayout {
  const columnsMode = options.columnsMode ?? "all";
  const nonEmptySchemas = schemas.filter((item) => item.diagram.tables.length > 0);
  const qualifyAll = options.qualifyNames ?? nonEmptySchemas.length > 1;
  const singleSchema = nonEmptySchemas.length === 1 ? nonEmptySchemas[0].schema : schemas.length === 1 ? schemas[0].schema : null;

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
      const title = qualifyAll ? `${schema}.${table.name}` : undefined;
      entries.set(key, {
        key,
        ref,
        title,
        external: false,
        columns: cols,
        width: estimateBoxWidth(title ?? table.name, cols),
        height: heightOf(cols),
      });
    }
  }

  for (const fk of foreignKeys) {
    const ref: TableRef = { schema: fk.referencedSchema, name: fk.referencedTable };
    const key = tableKey(ref);
    if (!entries.has(key)) {
      const isOtherSchema = singleSchema === null || fk.referencedSchema !== singleSchema;
      const title = qualifyAll || isOtherSchema ? `${fk.referencedSchema}.${fk.referencedTable}` : undefined;
      entries.set(key, {
        key,
        ref,
        title,
        external: true,
        columns: null,
        width: estimateBoxWidth(title ?? fk.referencedTable, null),
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

  const indexedFks = foreignKeys.map((fk, order) => ({
    fk,
    order,
    fromKey: tableKey({ schema: fk.referencingSchema, name: fk.referencingTable }),
    toKey: tableKey({ schema: fk.referencedSchema, name: fk.referencedTable }),
  }));

  type BuiltComponent = {
    boxes: DiagramBox[];
    edges: DiagramEdge[];
    width: number;
    height: number;
  };

  const builtComponents: BuiltComponent[] = [];

  for (const component of components) {
    const compSet = new Set(component);
    const ordered = [...component].sort((a, b) => {
      const inA = [...(incoming.get(a) ?? [])].filter((k) => compSet.has(k)).length;
      const inB = [...(incoming.get(b) ?? [])].filter((k) => compSet.has(k)).length;
      if (inA !== inB) return inA - inB;
      const outA = [...(outgoing.get(a) ?? [])].filter((k) => compSet.has(k)).length;
      const outB = [...(outgoing.get(b) ?? [])].filter((k) => compSet.has(k)).length;
      return outB - outA || a.localeCompare(b);
    });

    const rankOf = new Map(ordered.map((key, idx) => [key, idx]));
    const rawLayer = new Map<string, number>(ordered.map((key) => [key, 0]));

    // 1. Empurra camadas para a frente (origem -> destino).
    for (const u of ordered) {
      const uLayer = rawLayer.get(u) ?? 0;
      for (const v of outgoing.get(u) ?? []) {
        if (!rankOf.has(v)) continue;
        if ((rankOf.get(u) ?? 0) < (rankOf.get(v) ?? 0)) {
          rawLayer.set(v, Math.max(rawLayer.get(v) ?? 0, Math.min(maxLayers - 1, uLayer + 1)));
        }
      }
    }

    // 2. Puxa tabelas para perto de seus alvos para evitar arestas longas cruzando colunas intermediárias.
    for (let i = ordered.length - 1; i >= 0; i--) {
      const u = ordered[i];
      const uRank = rankOf.get(u) ?? 0;
      const forwardTargets = [...(outgoing.get(u) ?? [])].filter((v) => compSet.has(v) && (rankOf.get(v) ?? 0) > uRank);
      if (forwardTargets.length === 0) continue;
      const minTargetLayer = Math.min(...forwardTargets.map((v) => rawLayer.get(v) ?? 0));
      const backwardSources = [...(incoming.get(u) ?? [])].filter((w) => compSet.has(w) && (rankOf.get(w) ?? 0) < uRank);
      const minAllowedLayer = backwardSources.length === 0 ? 0 : Math.max(...backwardSources.map((w) => (rawLayer.get(w) ?? 0) + 1));
      const desiredLayer = Math.max(minAllowedLayer, minTargetLayer - 1);
      if (desiredLayer > (rawLayer.get(u) ?? 0)) {
        rawLayer.set(u, desiredLayer);
      }
    }

    const distinctLayers = [...new Set(rawLayer.values())].sort((a, b) => a - b);
    const layerBuckets: string[][] = distinctLayers.map(() => []);
    for (const key of ordered) {
      const layerIdx = distinctLayers.indexOf(rawLayer.get(key) ?? 0);
      layerBuckets[layerIdx].push(key);
    }

    // 3. Se a penúltima camada concentrou muitas folhas (inDegree === 0) apontando exclusivamente para a última camada,
    // move metade dessas folhas para uma coluna à direita da última camada (espelhamento equilibrado).
    if (layerBuckets.length >= 2) {
      const lastIdx = layerBuckets.length - 1;
      const prevIdx = lastIdx - 1;
      if (layerBuckets[prevIdx].length > maxTablesPerColumn) {
        const lastSet = new Set(layerBuckets[lastIdx]);
        const pureLeavesForLast = layerBuckets[prevIdx].filter((key) => {
          const inDeg = [...(incoming.get(key) ?? [])].filter((k) => compSet.has(k)).length;
          const outTargets = [...(outgoing.get(key) ?? [])].filter((k) => compSet.has(k));
          return inDeg === 0 && outTargets.length > 0 && outTargets.every((t) => lastSet.has(t));
        });
        if (pureLeavesForLast.length >= 4) {
          const moveToRight = new Set(pureLeavesForLast.filter((_, idx) => idx % 2 === 1));
          layerBuckets[prevIdx] = layerBuckets[prevIdx].filter((key) => !moveToRight.has(key));
          layerBuckets.push(pureLeavesForLast.filter((key) => moveToRight.has(key)));
        }
      }
    }

    // 4. Ordenação bidirecional por baricentro (4 passagens) para alinhar verticalmente tabelas conectadas.
    const sortBucketByNeighborPositions = (bucket: string[], neighborPos: ReadonlyMap<string, number>) => {
      bucket.sort((a, b) => {
        const bary = (nodeKey: string) => {
          const connected = [...(undirected.get(nodeKey) ?? [])].filter((n) => neighborPos.has(n));
          if (connected.length === 0) return Number.MAX_SAFE_INTEGER;
          return connected.reduce((sum, n) => sum + (neighborPos.get(n) ?? 0), 0) / connected.length;
        };
        return bary(a) - bary(b) || a.localeCompare(b);
      });
    };

    for (let pass = 0; pass < 4; pass++) {
      for (let layerIdx = 1; layerIdx < layerBuckets.length; layerIdx++) {
        const prevPos = new Map(layerBuckets[layerIdx - 1].map((key, idx) => [key, idx]));
        sortBucketByNeighborPositions(layerBuckets[layerIdx], prevPos);
      }
      for (let layerIdx = layerBuckets.length - 2; layerIdx >= 0; layerIdx--) {
        const nextPos = new Map(layerBuckets[layerIdx + 1].map((key, idx) => [key, idx]));
        sortBucketByNeighborPositions(layerBuckets[layerIdx], nextPos);
      }
    }

    const colWidths = layerBuckets.map((bucket) => Math.max(minBoxWidth, ...bucket.map((key) => entries.get(key)?.width ?? minBoxWidth)));
    const layerHeights = layerBuckets.map((bucket) => bucket.reduce((sum, key) => sum + (entries.get(key)?.height ?? 0), 0) + stackGap * Math.max(0, bucket.length - 1));
    const componentHeight = Math.max(...layerHeights, 0);

    const colIndexByKey = new Map<string, number>();
    const tempBoxes = new Map<string, DiagramBox>();
    const boxesByCol: DiagramBox[][] = layerBuckets.map(() => []);

    layerBuckets.forEach((bucket, colIdx) => {
      const colHeight = layerHeights[colIdx];
      const width = colWidths[colIdx];
      let y = Math.round((componentHeight - colHeight) / 2);

      for (const key of bucket) {
        const entry = entries.get(key)!;
        colIndexByKey.set(key, colIdx);
        const box: DiagramBox = {
          key: entry.key,
          ref: entry.ref,
          ...(entry.title === undefined ? {} : { title: entry.title }),
          ...(entry.external ? { external: true } : {}),
          center: false,
          x: 0,
          y,
          width,
          height: entry.height,
          columns: entry.columns,
        };
        tempBoxes.set(key, box);
        boxesByCol[colIdx].push(box);
        y += entry.height + stackGap;
      }
    });

    type ComponentRoute = {
      fk: ScopedForeignKey;
      order: number;
      source: DiagramBox;
      target: DiagramBox;
      sourceCol: number;
      targetCol: number;
      fromSide: "left" | "right";
      toSide: "left" | "right";
      fromY: number;
      toY: number;
      sourceGap: number;
      targetGap: number;
      mode: "straight" | "single-source" | "single-target" | "bypass";
      bypassY?: number;
      track1?: number;
      track2?: number;
    };

    const compFks = indexedFks.filter((item) => compSet.has(item.fromKey) && compSet.has(item.toKey));
    const routes: ComponentRoute[] = [];

    for (const { fk, order, fromKey, toKey } of compFks) {
      const source = tempBoxes.get(fromKey);
      const target = tempBoxes.get(toKey);
      if (!source || !target) continue;

      const sourceCol = colIndexByKey.get(fromKey) ?? 0;
      const targetCol = colIndexByKey.get(toKey) ?? 0;
      const sameColumn = sourceCol === targetCol;
      const goingRight = sourceCol < targetCol;
      const fromSide: "left" | "right" = sameColumn || goingRight ? "right" : "left";
      const toSide: "left" | "right" = sameColumn ? "right" : goingRight ? "left" : "right";

      const fromY = rowCenter(source, indexOfColumn(source.columns, fk.columns[0]));
      const toY = rowCenter(target, indexOfColumn(target.columns, fk.referencedColumns[0]));
      const sourceGap = sameColumn ? sourceCol : goingRight ? sourceCol : sourceCol - 1;
      const targetGap = sameColumn ? sourceCol : goingRight ? targetCol - 1 : targetCol;

      routes.push({
        fk,
        order,
        source,
        target,
        sourceCol,
        targetCol,
        fromSide,
        toSide,
        fromY,
        toY,
        sourceGap,
        targetGap,
        mode: "single-source",
      });
    }

    // Espalha portas que caem na mesma borda e na mesma linha antes de calcular as trilhas verticais.
    type PortRef = { route: ComponentRoute; field: "fromY" | "toY"; y: number; opposite: number };
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

    // Verifica se arestas que saltam colunas intermediárias atingem alguma caixa e escolhe rota livre.
    let bypassCounter = 0;
    for (const route of routes) {
      const minCol = Math.min(route.sourceCol, route.targetCol);
      const maxCol = Math.max(route.sourceCol, route.targetCol);
      const intermediateBoxes: DiagramBox[] = [];
      for (let col = minCol + 1; col < maxCol; col++) {
        intermediateBoxes.push(...boxesByCol[col]);
      }

      const hitsIntermediate = (y: number) => intermediateBoxes.some((box) => y >= box.y - 10 && y <= box.y + box.height + 10);

      if (route.sourceCol !== route.targetCol && route.fromY === route.toY && !hitsIntermediate(route.fromY)) {
        route.mode = "straight";
        continue;
      }

      if (intermediateBoxes.length === 0 || !hitsIntermediate(route.toY)) {
        route.mode = "single-source";
      } else if (!hitsIntermediate(route.fromY)) {
        route.mode = "single-target";
      } else {
        // Procura o vão horizontal mais próximo entre caixas das colunas intermediárias.
        const candidates: number[] = [];
        for (let col = minCol + 1; col < maxCol; col++) {
          const colBoxes = boxesByCol[col];
          for (let i = 0; i < colBoxes.length - 1; i++) {
            const gapMid = Math.round((colBoxes[i].y + colBoxes[i].height + colBoxes[i + 1].y) / 2);
            candidates.push(gapMid);
          }
          if (colBoxes.length > 0) {
            candidates.push(colBoxes[0].y - 24);
            candidates.push(colBoxes.at(-1)!.y + colBoxes.at(-1)!.height + 24);
          }
        }
        const clearCandidates = candidates.filter((y) => !hitsIntermediate(y));
        const offset = ((bypassCounter++ % 5) - 2) * 4;
        const bestY =
          clearCandidates.length > 0
            ? clearCandidates.sort((a, b) => Math.abs(a - route.fromY) + Math.abs(a - route.toY) - (Math.abs(b - route.fromY) + Math.abs(b - route.toY)))[0] + offset
            : Math.max(0, componentHeight + 24 + bypassCounter * 8);

        route.mode = "bypass";
        route.bypassY = bestY;
      }
    }

    // Aloca trilhas verticais por corredor usando coloração de intervalos [minY, maxY].
    type VerticalRequest = {
      route: ComponentRoute;
      which: "track1" | "track2";
      gapIdx: number;
      fromY: number;
      toY: number;
    };

    const requestsByGap: VerticalRequest[][] = Array.from({ length: layerBuckets.length }, () => []);
    for (const route of routes) {
      if (route.mode === "straight") continue;
      if (route.mode === "single-source") {
        requestsByGap[route.sourceGap].push({ route, which: "track1", gapIdx: route.sourceGap, fromY: route.fromY, toY: route.toY });
      } else if (route.mode === "single-target") {
        requestsByGap[route.targetGap].push({ route, which: "track1", gapIdx: route.targetGap, fromY: route.fromY, toY: route.toY });
      } else if (route.mode === "bypass" && route.bypassY !== undefined) {
        requestsByGap[route.sourceGap].push({ route, which: "track1", gapIdx: route.sourceGap, fromY: route.fromY, toY: route.bypassY });
        if (route.targetGap !== route.sourceGap) {
          requestsByGap[route.targetGap].push({ route, which: "track2", gapIdx: route.targetGap, fromY: route.bypassY, toY: route.toY });
        }
      }
    }

    const tracksPerGap: { intervals: { minY: number; maxY: number }[] }[][] = Array.from({ length: layerBuckets.length }, () => []);

    for (let gapIdx = 0; gapIdx < layerBuckets.length; gapIdx++) {
      const reqs = requestsByGap[gapIdx];
      const upReqs = reqs.filter((r) => r.toY < r.fromY).sort((a, b) => a.fromY - b.fromY || a.route.order - b.route.order);
      const downReqs = reqs.filter((r) => r.toY >= r.fromY).sort((a, b) => b.fromY - a.fromY || a.route.order - b.route.order);
      const orderedReqs = [...upReqs, ...downReqs];

      const tracks = tracksPerGap[gapIdx];
      for (const req of orderedReqs) {
        const minY = Math.min(req.fromY, req.toY);
        const maxY = Math.max(req.fromY, req.toY);
        let assigned = -1;
        for (let t = 0; t < tracks.length; t++) {
          const overlaps = tracks[t].intervals.some((iv) => !(iv.maxY + 14 < minY || maxY + 14 < iv.minY));
          if (!overlaps) {
            assigned = t;
            tracks[t].intervals.push({ minY, maxY });
            break;
          }
        }
        if (assigned < 0) {
          assigned = tracks.length;
          tracks.push({ intervals: [{ minY, maxY }] });
        }
        req.route[req.which] = assigned;
      }
    }

    const gapWidths = tracksPerGap.map((tracks, gapIdx) => {
      const isOuterRightLoop = gapIdx === layerBuckets.length - 1;
      if (isOuterRightLoop) {
        return tracks.length === 0 ? 0 : Math.max(loopRoom, corridorPadding + tracks.length * minTrackSpacing);
      }
      return Math.max(baseColumnGap, 2 * corridorPadding + Math.max(0, tracks.length - 1) * minTrackSpacing);
    });

    const colX: number[] = [];
    let runningX = 0;
    for (let colIdx = 0; colIdx < layerBuckets.length; colIdx++) {
      colX.push(runningX);
      runningX += colWidths[colIdx] + (gapWidths[colIdx] ?? 0);
    }

    const compBoxes: DiagramBox[] = [];
    for (const [key, box] of tempBoxes.entries()) {
      const colIdx = colIndexByKey.get(key) ?? 0;
      box.x = colX[colIdx];
      compBoxes.push(box);
    }

    const trackXFor = (gapIdx: number, trackIdx: number | undefined, fallbackX: number): number => {
      const trackCount = tracksPerGap[gapIdx]?.length ?? 0;
      if (trackIdx === undefined || trackCount === 0) return fallbackX;
      const gapLeftX = colX[gapIdx] + colWidths[gapIdx];
      const gapWidth = gapWidths[gapIdx] ?? baseColumnGap;
      if (gapIdx === layerBuckets.length - 1) {
        return gapLeftX + Math.round(corridorPadding / 2 + (trackIdx + 1) * minTrackSpacing);
      }
      if (trackCount === 1) {
        return Math.round(gapLeftX + gapWidth / 2);
      }
      const usable = gapWidth - 2 * corridorPadding;
      return Math.round(gapLeftX + corridorPadding + (trackIdx * usable) / (trackCount - 1));
    };

    const compEdges: DiagramEdge[] = [];
    for (const route of routes) {
      const from: Point = {
        x: route.fromSide === "right" ? route.source.x + route.source.width : route.source.x,
        y: route.fromY,
      };
      const to: Point = {
        x: route.toSide === "right" ? route.target.x + route.target.width : route.target.x,
        y: route.toY,
      };

      let points: Point[];
      if (route.mode === "straight") {
        points = [from, to];
      } else if (route.mode === "single-source") {
        const laneX = trackXFor(route.sourceGap, route.track1, from.x);
        points = simplify([from, { x: laneX, y: from.y }, { x: laneX, y: to.y }, to]);
      } else if (route.mode === "single-target") {
        const laneX = trackXFor(route.targetGap, route.track1, to.x);
        points = simplify([from, { x: laneX, y: from.y }, { x: laneX, y: to.y }, to]);
      } else {
        const laneX1 = trackXFor(route.sourceGap, route.track1, from.x);
        const laneX2 = route.targetGap === route.sourceGap ? laneX1 : trackXFor(route.targetGap, route.track2, to.x);
        const bypassY = route.bypassY ?? to.y;
        points = simplify([from, { x: laneX1, y: from.y }, { x: laneX1, y: bypassY }, { x: laneX2, y: bypassY }, { x: laneX2, y: to.y }, to]);
      }

      const targetName =
        qualifyAll || route.fk.referencedSchema !== route.fk.referencingSchema
          ? `${route.fk.referencedSchema}.${route.fk.referencedTable}`
          : route.fk.referencedTable;

      const fromCol = route.fk.columns[0];
      const sourceCol = route.source.columns?.find((col) => col.name === fromCol);
      const pkCount = route.source.columns?.filter((col) => col.primaryKey).length ?? 0;
      const isOneToOne = Boolean(sourceCol?.primaryKey && pkCount === 1);

      compEdges.push({
        key: `${route.order}:${route.fk.referencingSchema}.${route.fk.referencingTable}:${route.fk.name}`,
        name: route.fk.name,
        label: `${route.fk.name}: ${route.fk.columns.join(", ")} → ${targetName} (${route.fk.referencedColumns.join(", ")})`,
        from,
        to,
        points,
        fromTable: route.source.key,
        toTable: route.target.key,
        fromColumn: fromCol,
        toColumn: route.fk.referencedColumns[0],
        cardinality: isOneToOne ? "1:1" : "1:N",
        optional: Boolean(sourceCol?.nullable),
        self: route.source.key === route.target.key,
      });
    }

    // Normaliza coordenadas locais do componente (caso algum bypassY tenha ficado acima de 0).
    const minY = Math.min(...compBoxes.map((b) => b.y), ...compEdges.flatMap((e) => e.points.map((p) => p.y)));
    const shiftY = minY < 0 ? -minY : 0;
    if (shiftY > 0) {
      for (const box of compBoxes) box.y += shiftY;
      for (const edge of compEdges) {
        edge.from = { x: edge.from.x, y: edge.from.y + shiftY };
        edge.to = { x: edge.to.x, y: edge.to.y + shiftY };
        edge.points = edge.points.map((p) => ({ x: p.x, y: p.y + shiftY }));
      }
    }

    const compWidth = Math.max(...compBoxes.map((b) => b.x + b.width), ...compEdges.flatMap((e) => e.points.map((p) => p.x)));
    const compHeight = Math.max(...compBoxes.map((b) => b.y + b.height), ...compEdges.flatMap((e) => e.points.map((p) => p.y)));

    builtComponents.push({
      boxes: compBoxes,
      edges: compEdges,
      width: compWidth,
      height: compHeight,
    });
  }

  // Posiciona os componentes conexos em faixas horizontais (lado a lado quando cabem na largura-alvo).
  const allBoxes: DiagramBox[] = [];
  const allEdges: DiagramEdge[] = [];
  const maxRowWidth = Math.max(targetCanvasRowWidth, ...builtComponents.map((c) => c.width));
  let cursorX = margin;
  let cursorY = margin;
  let rowHeightMax = 0;

  for (const comp of builtComponents) {
    if (cursorX > margin && cursorX + comp.width > margin + maxRowWidth) {
      cursorX = margin;
      cursorY += rowHeightMax + componentGap;
      rowHeightMax = 0;
    }

    for (const box of comp.boxes) {
      allBoxes.push({
        ...box,
        x: box.x + cursorX,
        y: box.y + cursorY,
      });
    }
    for (const edge of comp.edges) {
      allEdges.push({
        ...edge,
        from: { x: edge.from.x + cursorX, y: edge.from.y + cursorY },
        to: { x: edge.to.x + cursorX, y: edge.to.y + cursorY },
        points: edge.points.map((p) => ({ x: p.x + cursorX, y: p.y + cursorY })),
      });
    }

    cursorX += comp.width + componentGap;
    if (comp.height > rowHeightMax) rowHeightMax = comp.height;
  }

  let currentY = builtComponents.length > 0 ? cursorY + rowHeightMax + componentGap : margin;

  if (isolated.length > 0) {
    const gridCols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(isolated.length))));
    const isolatedColWidths = Array.from({ length: gridCols }, (_, colIdx) => {
      const colKeys = isolated.filter((_, idx) => idx % gridCols === colIdx);
      return Math.max(minBoxWidth, ...colKeys.map((key) => entries.get(key)?.width ?? minBoxWidth));
    });

    for (let index = 0; index < isolated.length; index += gridCols) {
      const rowSlice = isolated.slice(index, index + gridCols);
      const rowMaxHeight = Math.max(...rowSlice.map((key) => entries.get(key)?.height ?? 0));
      let runningX = margin;

      rowSlice.forEach((key, colIdx) => {
        const entry = entries.get(key)!;
        const width = isolatedColWidths[colIdx];
        allBoxes.push({
          key: entry.key,
          ref: entry.ref,
          ...(entry.title === undefined ? {} : { title: entry.title }),
          ...(entry.external ? { external: true } : {}),
          center: false,
          x: runningX,
          y: currentY,
          width,
          height: entry.height,
          columns: entry.columns,
        });
        runningX += width + baseColumnGap;
      });

      currentY += rowMaxHeight + stackGap;
    }
  }

  allEdges.sort((a, b) => Number(a.key.split(":")[0]) - Number(b.key.split(":")[0]));

  const rightmost = Math.max(...allBoxes.map((box) => box.x + box.width), ...allEdges.flatMap((edge) => edge.points.map((point) => point.x)));
  const bottommost = Math.max(...allBoxes.map((box) => box.y + box.height), ...allEdges.flatMap((edge) => edge.points.map((point) => point.y)));

  return {
    boxes: allBoxes,
    edges: allEdges,
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
