import type { Column, ForeignKey, ReferencingForeignKey } from "./database-sessions.schema";
import { structureColumns, structureForeignKeys } from "./table-structure";

/**
 * A geometria do diagrama (RN-TABELA-004), toda em funções puras: o desenho é uma lista de caixas e de
 * linhas com coordenadas prontas, e o componente só as pinta em SVG. As medidas são as do canvas
 * (`DiagramaER`): caixa de 264 px, linha de 24 px, título na primeira linha, 11 px de respiro e 1 de borda.
 */

export type TableRef = { schema: string; name: string };

/** Esquema e nome entre colchetes, em JSON: nome com ponto, barra ou espaço não colide com outro. */
export const tableKey = (ref: TableRef): string => JSON.stringify([ref.schema, ref.name]);

export type Point = { x: number; y: number };

export const boxWidth = 264;
export const rowHeight = 24;
/** O respiro de cima e de baixo da caixa: 11 px de espaço e 1 de borda. */
const boxPadding = 12;
const margin = 48;
/** O vão entre a coluna do centro e a das vizinhas, onde correm as linhas. */
const columnGap = 128;
const stackGap = 32;
/** O espaço de que a volta de uma chave estrangeira para a própria tabela precisa, quando não há vizinha à direita. */
const loopRoom = 64;
/** Mais do que isto e o desenho vira uma parede: as outras ficam de fora, e a tela diz quantas. */
export const maxNeighbors = 12;

export type DiagramColumn = { name: string; type: string; primaryKey: boolean; foreignKey: boolean };

export type DiagramBox = {
  key: string;
  ref: TableRef;
  /** Rótulo exibido no cabeçalho quando difere de `ref.name` (por exemplo `esquema.tabela` no diagrama do banco). */
  title?: string;
  /** Tabela referenciada fora do esquema/banco atual (stub sem colunas). */
  external?: boolean;
  center: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  /** `null` quando as colunas não chegaram: a caixa mostra só o título. */
  columns: DiagramColumn[] | null;
};

export type DiagramEdge = {
  key: string;
  /** O nome da chave estrangeira. */
  name: string;
  /** `nome: colunas → tabela (colunas)`, para a dica da linha. */
  label: string;
  from: Point;
  to: Point;
  /** O caminho de `from` a `to`: só segmentos horizontais e verticais, com o primeiro e o último na horizontal. */
  points: Point[];
  /** Chave da caixa de origem (`tableKey`), para destaque e exportação Mermaid. */
  fromTable?: string;
  /** Chave da caixa de destino (`tableKey`), para destaque e exportação Mermaid. */
  toTable?: string;
  fromColumn?: string;
  toColumn?: string;
};

export type DiagramLayout = { boxes: DiagramBox[]; edges: DiagramEdge[]; width: number; height: number };

/**
 * Medidas tipográficas do diagrama derivadas do tamanho da fonte do usuário (`preferences.editor.fontSize`, padrão 13 px).
 * Mantém a geometria padrão exata (264 px de largura, 24 px de linha, 29 caracteres) quando `fontSize === 13`.
 */
export function diagramMetrics(fontSize = 13): { fontSize: number; titleFontSize: number; markFontSize: number; rowHeight: number; boxWidth: number; rowChars: number } {
  const clamped = Math.min(20, Math.max(11, Math.round(fontSize)));
  const charWidth = clamped * 0.6;
  const computedRowChars = Math.max(20, Math.floor((boxWidth - 32) / charWidth));
  return {
    fontSize: clamped,
    titleFontSize: clamped,
    markFontSize: Math.max(10, clamped - 2),
    rowHeight,
    boxWidth,
    rowChars: clamped === 13 ? rowChars : computedRowChars,
  };
}

/**
 * As tabelas que as chaves estrangeiras da tabela apontam, na ordem em que a API as deu, sem repetir e
 * sem a própria tabela. Passando de `maxNeighbors`, `omitted` diz quantas ficaram de fora.
 */
export function referencedTables(center: TableRef, foreignKeys: ForeignKey[]): { tables: TableRef[]; omitted: number } {
  const seen = new Set([tableKey(center)]);
  const tables: TableRef[] = [];

  for (const foreignKey of foreignKeys) {
    const ref = { schema: foreignKey.referencedSchema, name: foreignKey.referencedTable };
    if (seen.has(tableKey(ref))) continue;
    seen.add(tableKey(ref));
    tables.push(ref);
  }
  return { tables: tables.slice(0, maxNeighbors), omitted: Math.max(0, tables.length - maxNeighbors) };
}

/**
 * As tabelas que têm chaves estrangeiras apontando para a tabela do centro (`referencedBy`), na ordem
 * em que a API as deu, sem repetir e sem a própria tabela. Passando de `maxNeighbors`, `omitted` diz
 * quantas ficaram de fora.
 */
export function referencingTables(center: TableRef, referencedBy: ReferencingForeignKey[]): { tables: TableRef[]; omitted: number } {
  const seen = new Set([tableKey(center)]);
  const tables: TableRef[] = [];

  for (const foreignKey of referencedBy) {
    const ref = { schema: foreignKey.referencingSchema, name: foreignKey.referencingTable };
    if (seen.has(tableKey(ref))) continue;
    seen.add(tableKey(ref));
    tables.push(ref);
  }
  return { tables: tables.slice(0, maxNeighbors), omitted: Math.max(0, tables.length - maxNeighbors) };
}

export type DiagramInput = {
  center: { ref: TableRef; columns: Column[] };
  foreignKeys: ForeignKey[];
  /** As tabelas de `referencedTables`, com as colunas (`null` se não chegaram), posicionadas à direita. */
  neighbors: { ref: TableRef; columns: Column[] | null }[];
  /** As chaves estrangeiras de outras tabelas que apontam para a tabela do centro (`referencedBy`). */
  referencedBy?: ReferencingForeignKey[];
  /** As tabelas de `referencingTables`, com as colunas (`null` se não chegaram), posicionadas à esquerda. */
  incomingNeighbors?: { ref: TableRef; columns: Column[] | null }[];
};

/** As colunas na ordem da posição e com as marcas de chave: as mesmas regras da Estrutura (`structureColumns`), uma só vez. */
function diagramColumns(columns: Column[], foreignKeys: ForeignKey[] | undefined): DiagramColumn[] {
  return structureColumns(columns, foreignKeys).map(({ name, type, keys }) => ({ name, type, primaryKey: keys.includes("PK"), foreignKey: keys.includes("FK") }));
}

const heightOf = (columns: DiagramColumn[] | null) => rowHeight * ((columns?.length ?? 0) + 1) + 2 * boxPadding;

/** O índice da coluna na caixa, ou -1 (o título) quando a caixa não a tem. */
const indexOfColumn = (columns: DiagramColumn[] | null, name: string | undefined) => (columns === null || name === undefined ? -1 : columns.findIndex((column) => column.name === name));

/** O meio da linha de uma coluna; `-1` é o título, a primeira linha da caixa. */
const rowCenter = (box: DiagramBox, index: number) => box.y + boxPadding + rowHeight * (index + 1) + rowHeight / 2;

type Side = "left" | "right";

type Route = {
  name: string;
  label: string;
  order: number;
  side: Side;
  self: boolean;
  direction: "outgoing" | "incoming";
  neighbor: DiagramBox;
  centerY: number;
  neighborY: number;
  fromTable: string;
  toTable: string;
  fromColumn?: string;
  toColumn?: string;
};

/** Tira os pontos repetidos em sequência, que um corredor sem desvio deixaria no caminho. */
function simplify(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

/**
 * Linhas que saem do mesmo ponto (a mesma coluna de origem) ou chegam ao mesmo ponto (duas chaves para a mesma
 * coluna, como várias tabelas que referenciam `id` ou origem e destino de uma transferência) ficariam uma sobre a outra.
 * Cada grupo de pontos na mesma altura e na mesma borda se abre em torno dela, a até 6 px entre linhas e sempre dentro
 * da linha de 24 px. A ordem dentro do grupo é a da altura do OUTRO extremo de cada linha (a que vai mais para cima
 * ocupa o ponto de cima): assim as linhas se abrem em leque, sem se cruzarem logo na saída, qualquer que seja a ordem
 * em que a API as devolveu. A volta de uma chave para a própria tabela tem os dois extremos na borda do centro, e os
 * dois entram na conta.
 */
function spreadPorts(routes: Route[]) {
  type Port = { route: Route; field: "centerY" | "neighborY"; y: number; opposite: number };

  const groups = new Map<string, Port[]>();
  for (const route of routes) {
    const ports: Port[] = [
      { route, field: "centerY", y: route.centerY, opposite: route.neighborY },
      { route, field: "neighborY", y: route.neighborY, opposite: route.centerY },
    ];

    for (const port of ports) {
      // Todo extremo que fica na borda do centro (e a chegada da volta) divide a mesma borda do centro; o da vizinha, a borda dela.
      const onCenter = port.field === "centerY" || route.self;
      const key = onCenter ? `centro:${route.side}:${port.y}` : `${route.neighbor.key}:${port.y}`;
      groups.set(key, [...(groups.get(key) ?? []), port]);
    }
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const step = Math.min(6, (rowHeight - 6) / (group.length - 1));
    const sorted = [...group].sort((a, b) => a.opposite - b.opposite || a.route.order - b.route.order || Number(a.field === "neighborY") - Number(b.field === "neighborY"));
    sorted.forEach((port, index) => (port.route[port.field] = port.y + Math.round((index - (group.length - 1) / 2) * step)));
  }
}

/**
 * A ordem dos corredores de um lado, do mais perto do centro ao mais longe, a partir da ordem de preferência que
 * evita cruzamentos (`candidates`). Uma exigência vale mais que a preferência: se a ponta de uma linha na borda do
 * centro está na MESMA altura da ponta de outra na borda da vizinha, os dois trechos horizontais correriam na mesma
 * reta quando o corredor da primeira fosse mais longe do centro; a primeira tem de ficar mais perto do centro.
 * Num ciclo (duas linhas que trocam de altura) a primeira da preferência tem a ponta da vizinha afastada, de 1 em 1 px
 * dentro da linha de 24 px, até sair da altura das que a exigiam.
 */
function orderLanes(candidates: Route[]): Route[] {
  const centerHeights = (route: Route) => (route.self ? [route.centerY, route.neighborY] : [route.centerY]);
  const mustPrecede = (a: Route, b: Route) => a !== b && !b.self && centerHeights(a).includes(b.neighborY);

  const placed: Route[] = [];
  const remaining = [...candidates];
  while (remaining.length > 0) {
    let next = remaining.find((route) => !remaining.some((other) => mustPrecede(other, route)));
    if (next === undefined) {
      next = remaining[0];
      while (remaining.some((other) => mustPrecede(other, next!))) next.neighborY += 1;
    }
    placed.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return placed;
}

/**
 * Posiciona a tabela no centro, as tabelas que apontam para ela à esquerda (`incomingNeighbors` / `referencedBy`) e
 * as tabelas que ela referencia à direita (`neighbors` / `foreignKeys`). As vizinhas de cada lado são empilhadas e
 * centradas na altura do desenho, ordenadas pela linha da coluna correspondente no centro para evitar cruzamentos.
 * À esquerda, a seta sai da coluna FK da tabela vizinha (borda direita dela) e entra na coluna referenciada da tabela
 * central (borda esquerda do centro). À direita, a seta sai da coluna FK da tabela central (borda direita do centro)
 * e entra na coluna referenciada da tabela vizinha (borda esquerda dela). A chave estrangeira para a própria tabela
 * dá uma volta pelo lado direito.
 */
export function layoutDiagram({ center, foreignKeys, neighbors, referencedBy = [], incomingNeighbors = [] }: DiagramInput): DiagramLayout {
  const centerColumns = diagramColumns(center.columns, foreignKeys);
  const centerKey = tableKey(center.ref);

  const outgoingColumns = new Map(neighbors.map((neighbor) => [tableKey(neighbor.ref), neighbor.columns === null ? null : diagramColumns(neighbor.columns, undefined)]));

  const incomingFksByTable = new Map<string, ForeignKey[]>();
  for (const incomingFk of referencedBy) {
    const key = tableKey({ schema: incomingFk.referencingSchema, name: incomingFk.referencingTable });
    const list = incomingFksByTable.get(key) ?? [];
    list.push({
      name: incomingFk.name,
      columns: incomingFk.columns,
      referencedSchema: center.ref.schema,
      referencedTable: center.ref.name,
      referencedColumns: incomingFk.referencedColumns,
    });
    incomingFksByTable.set(key, list);
  }
  const incomingColumns = new Map(
    incomingNeighbors.map((neighbor) => {
      const key = tableKey(neighbor.ref);
      return [key, neighbor.columns === null ? null : diagramColumns(neighbor.columns, incomingFksByTable.get(key))];
    }),
  );

  // À direita: as vizinhas que o centro referencia, ordenadas pela linha da coluna de origem no centro.
  const topOutgoingRow = new Map<string, number>();
  for (const foreignKey of foreignKeys) {
    const key = tableKey({ schema: foreignKey.referencedSchema, name: foreignKey.referencedTable });
    const row = indexOfColumn(centerColumns, foreignKey.columns[0]);
    topOutgoingRow.set(key, Math.min(topOutgoingRow.get(key) ?? row, row));
  }
  const right = neighbors
    .map((neighbor, order) => ({ neighbor, order, row: topOutgoingRow.get(tableKey(neighbor.ref)) ?? 0 }))
    .sort((a, b) => a.row - b.row || a.order - b.order)
    .map(({ neighbor }) => neighbor);

  // À esquerda: as vizinhas que apontam para o centro, ordenadas pela linha da coluna referenciada no centro.
  const topIncomingRow = new Map<string, number>();
  for (const incomingFk of referencedBy) {
    const key = tableKey({ schema: incomingFk.referencingSchema, name: incomingFk.referencingTable });
    const row = indexOfColumn(centerColumns, incomingFk.referencedColumns[0]);
    topIncomingRow.set(key, Math.min(topIncomingRow.get(key) ?? row, row));
  }
  const left = incomingNeighbors
    .map((neighbor, order) => ({ neighbor, order, row: topIncomingRow.get(tableKey(neighbor.ref)) ?? 0 }))
    .sort((a, b) => a.row - b.row || a.order - b.order)
    .map(({ neighbor }) => neighbor);

  const stackHeight = (refs: { ref: TableRef }[], colsMap: Map<string, DiagramColumn[] | null>) =>
    refs.reduce((sum, { ref }) => sum + heightOf(colsMap.get(tableKey(ref)) ?? null), 0) + stackGap * Math.max(0, refs.length - 1);
  const centerHeight = heightOf(centerColumns);
  const inner = Math.max(centerHeight, stackHeight(left, incomingColumns), stackHeight(right, outgoingColumns));

  const centerX = margin + (left.length > 0 ? boxWidth + columnGap : 0);
  const rightX = centerX + boxWidth + columnGap;

  const centerBox: DiagramBox = {
    key: centerKey,
    ref: center.ref,
    center: true,
    x: centerX,
    y: margin + Math.round((inner - centerHeight) / 2),
    width: boxWidth,
    height: centerHeight,
    columns: centerColumns,
  };
  const boxes: DiagramBox[] = [centerBox];

  const rightByKey = new Map<string, DiagramBox>([[centerKey, centerBox]]);
  const leftByKey = new Map<string, DiagramBox>();

  const rightKeys = new Set(right.map(({ ref }) => tableKey(ref)));

  function stackLeft(refs: { ref: TableRef }[], x: number) {
    let y = margin + Math.round((inner - stackHeight(refs, incomingColumns)) / 2);
    for (const { ref } of refs) {
      const rawKey = tableKey(ref);
      const key = rightKeys.has(rawKey) ? `incoming:${rawKey}` : rawKey;
      const columns = incomingColumns.get(rawKey) ?? null;
      const height = heightOf(columns);
      const box: DiagramBox = {
        key,
        ref,
        title: ref.schema === center.ref.schema ? undefined : `${ref.schema}.${ref.name}`,
        center: false,
        x,
        y,
        width: boxWidth,
        height,
        columns,
      };
      boxes.push(box);
      leftByKey.set(rawKey, box);
      y += height + stackGap;
    }
  }

  function stackRight(refs: { ref: TableRef }[], x: number) {
    let y = margin + Math.round((inner - stackHeight(refs, outgoingColumns)) / 2);
    for (const { ref } of refs) {
      const key = tableKey(ref);
      const columns = outgoingColumns.get(key) ?? null;
      const height = heightOf(columns);
      const box: DiagramBox = {
        key,
        ref,
        title: ref.schema === center.ref.schema ? undefined : `${ref.schema}.${ref.name}`,
        center: false,
        x,
        y,
        width: boxWidth,
        height,
        columns,
      };
      boxes.push(box);
      rightByKey.set(key, box);
      y += height + stackGap;
    }
  }

  stackLeft(left, margin);
  stackRight(right, rightX);

  const routes: Route[] = [];
  foreignKeys.forEach((foreignKey, order) => {
    const key = tableKey({ schema: foreignKey.referencedSchema, name: foreignKey.referencedTable });
    const target = rightByKey.get(key);
    // A tabela que passou do teto não está no desenho: não há para onde ligar a linha.
    if (target === undefined) return;

    routes.push({
      name: foreignKey.name,
      label: labelOf(foreignKey, center.ref.schema),
      order,
      side: "right",
      self: key === centerKey,
      direction: "outgoing",
      neighbor: target,
      centerY: rowCenter(centerBox, indexOfColumn(centerColumns, foreignKey.columns[0])),
      neighborY: rowCenter(target, indexOfColumn(target.columns, foreignKey.referencedColumns[0])),
      fromTable: centerKey,
      toTable: target.key,
      fromColumn: foreignKey.columns[0],
      toColumn: foreignKey.referencedColumns[0],
    });
  });

  referencedBy.forEach((incomingFk, index) => {
    const key = tableKey({ schema: incomingFk.referencingSchema, name: incomingFk.referencingTable });
    // Chave para a própria tabela já entra em `foreignKeys` (volta pelo lado direito).
    if (key === centerKey) return;
    const source = leftByKey.get(key);
    if (source === undefined) return;

    routes.push({
      name: incomingFk.name,
      label: incomingLabelOf(incomingFk, center.ref),
      order: foreignKeys.length + index,
      side: "left",
      self: false,
      direction: "incoming",
      neighbor: source,
      centerY: rowCenter(centerBox, indexOfColumn(centerColumns, incomingFk.referencedColumns[0])),
      neighborY: rowCenter(source, indexOfColumn(source.columns, incomingFk.columns[0])),
      fromTable: source.key,
      toTable: centerKey,
      fromColumn: incomingFk.columns[0],
      toColumn: incomingFk.referencedColumns[0],
    });
  });

  spreadPorts(routes);

  const edges: DiagramEdge[] = [];
  for (const side of ["right", "left"] as const) {
    const onSide = routes.filter((route) => route.side === side);
    const up = onSide.filter((route) => route.neighborY < route.centerY).sort((a, b) => a.centerY - b.centerY || a.neighborY - b.neighborY || a.order - b.order);
    const down = onSide.filter((route) => route.neighborY > route.centerY).sort((a, b) => b.centerY - a.centerY || b.neighborY - a.neighborY || a.order - b.order);
    // A linha reta (origem e destino na mesma altura) não tem trecho vertical e não ocupa corredor.
    const straight = onSide.filter((route) => route.neighborY === route.centerY);
    const lanes = orderLanes([...up, ...down]);

    const edgeX = side === "right" ? centerBox.x + boxWidth : centerBox.x;
    // O vão entre a borda do centro e a coluna da vizinha, ou, do lado direito sem vizinha, o espaço da volta da própria
    // tabela. Todas as linhas do lado, a volta inclusive, repartem este vão: cada uma tem o seu corredor.
    const gap = side === "right" && right.length === 0 ? loopRoom : columnGap;
    const laneX = (index: number) => edgeX + (side === "right" ? 1 : -1) * Math.round((gap * (index + 1)) / (lanes.length + 1));

    for (const route of [...lanes, ...straight]) {
      const centerPoint = { x: edgeX, y: route.centerY };
      const neighborPoint = { x: route.self ? edgeX : side === "right" ? route.neighbor.x : route.neighbor.x + boxWidth, y: route.neighborY };
      const from = route.direction === "outgoing" ? centerPoint : neighborPoint;
      const to = route.direction === "outgoing" ? neighborPoint : centerPoint;
      const lane = lanes.indexOf(route);

      edges.push({
        key: `${route.order}:${route.name}`,
        name: route.name,
        label: route.label,
        from,
        to,
        points: lane < 0 ? [from, to] : simplify([from, { x: laneX(lane), y: from.y }, { x: laneX(lane), y: to.y }, to]),
        fromTable: route.fromTable,
        toTable: route.toTable,
        fromColumn: route.fromColumn,
        toColumn: route.toColumn,
      });
    }
  }
  edges.sort((a, b) => Number(a.key.split(":")[0]) - Number(b.key.split(":")[0]));

  const rightmost = Math.max(...boxes.map((box) => box.x + box.width), ...edges.flatMap((edge) => edge.points.map((point) => point.x)));
  return { boxes, edges, width: rightmost + margin, height: inner + 2 * margin };
}

/** `nome: colunas → tabela (colunas)`, o mesmo texto da seção de chaves estrangeiras da Estrutura. */
function labelOf(foreignKey: ForeignKey, schema: string): string {
  const [row] = structureForeignKeys([foreignKey], schema);
  return `${row.name}: ${row.columns} → ${row.references}`;
}

/** `nome: tabela_origem (colunas) → tabela_centro (colunas)`, para as chaves estrangeiras que apontam para a tabela do centro. */
function incomingLabelOf(foreignKey: ReferencingForeignKey, center: TableRef): string {
  const source = foreignKey.referencingSchema === center.schema ? foreignKey.referencingTable : `${foreignKey.referencingSchema}.${foreignKey.referencingTable}`;
  return `${foreignKey.name}: ${source} (${foreignKey.columns.join(", ")}) → ${center.name} (${foreignKey.referencedColumns.join(", ")})`;
}

/** As teclas que abrem a tabela de uma vizinha, como as de um botão: Enter e Espaço (RN-TABELA-004). */
export const opensNeighbor = (key: string) => key === "Enter" || key === " ";

/** Quantos caracteres cabem numa linha de coluna: a caixa a 13 px mono (7,8 px por caractere), menos o respiro de 16 px de cada lado. */
const rowChars = 29;

const ellipsize = (text: string, room: number) => (text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`);

/**
 * Ajusta o título da tabela ao espaço do cabeçalho da caixa. Quando o título vem qualificado
 * (`esquema.tabela`) e passa do limite, encurta primeiro o prefixo do esquema para preservar o nome da tabela.
 */
export function fitTitle(title: string, maxChars = rowChars - 1): { text: string; cut: boolean } {
  const budget = Math.max(8, maxChars);
  if (title.length <= budget) return { text: title, cut: false };

  const dot = title.indexOf(".");
  if (dot > 0) {
    const schema = title.slice(0, dot);
    const table = title.slice(dot + 1);
    if (table.length + 5 <= budget) {
      const schemaRoom = budget - table.length - 2;
      return { text: `${schema.slice(0, schemaRoom)}….${table}`, cut: true };
    }
    const prefix = schema.length > 5 ? `${schema.slice(0, 4)}….` : `${schema}.`;
    const tableRoom = Math.max(4, budget - prefix.length);
    return { text: `${prefix}${ellipsize(table, tableRoom)}`, cut: true };
  }

  return { text: ellipsize(title, budget), cut: true };
}

/**
 * O nome e o tipo de uma coluna ajustados à linha da caixa, que não quebra nem rola. A marca de chave
 * (`PK`, `FK`) leva o seu espaço; o que passar do orçamento de caracteres encurta com reticências, o
 * tipo primeiro (guarda ao menos o começo) e depois o nome. `cut` diz se algo foi cortado: a linha
 * então leva o texto inteiro na dica.
 */
export function fitText(name: string, type: string, mark: string | null, maxChars = rowChars): { name: string; type: string; cut: boolean } {
  const budget = maxChars - (mark === null ? 0 : mark.length + 1) - 1;
  if (name.length + type.length <= budget) return { name, type, cut: false };

  const typeRoom = Math.max(4, budget - name.length);
  const typeFitted = ellipsize(type, typeRoom);
  return { name: ellipsize(name, budget - typeFitted.length), type: typeFitted, cut: true };
}

/**
 * O que a área do diagrama faz da primeira vez que tem tamanho (RN-TABELA-004): voltar à rolagem lembrada e
 * ajustar o desenho à janela. Sem tamanho (a área de trabalho escondida por baixo de outra tela, a aba que não é a
 * ativa) não há o que medir nem onde rolar: espera aparecer, e então mede o próprio tamanho.
 */
export function settleActions(size: { width: number; height: number }, done: { fitted: boolean; restored: boolean; hasMemory: boolean }): { wait: boolean; restore: boolean; fit: boolean } {
  if (size.width <= 0 || size.height <= 0) return { wait: true, restore: false, fit: false };
  return { wait: false, restore: done.hasMemory && !done.restored, fit: !done.fitted };
}

export const minZoom = 0.25;
export const maxZoom = 2;
const zoomStep = 1.25;

export const clampZoom = (zoom: number) => Math.min(maxZoom, Math.max(minZoom, zoom));

/** Passos de 25% (multiplicativos), com duas casas: o zoom nunca vira um número comprido. */
const round = (zoom: number) => Math.round(zoom * 100) / 100;

export const zoomIn = (zoom: number) => clampZoom(round(zoom * zoomStep));
export const zoomOut = (zoom: number) => clampZoom(round(zoom / zoomStep));

/**
 * O maior zoom, até 100%, em que o desenho inteiro cabe na janela; uma janela sem tamanho (escondida) fica
 * em 100%. Arredonda para baixo: para cima, o desenho passaria um pixel e a janela ganharia barras de rolagem.
 */
export function fitZoom(content: { width: number; height: number }, viewport: { width: number; height: number }): number {
  if (viewport.width <= 0 || viewport.height <= 0 || content.width <= 0 || content.height <= 0) return 1;
  const fit = Math.min(1, viewport.width / content.width, viewport.height / content.height);
  return clampZoom(Math.floor(fit * 100 + 1e-9) / 100);
}

export const zoomLabel = (zoom: number) => `${Math.round(zoom * 100)}%`;
