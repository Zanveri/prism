import type { Column, ForeignKey } from "./database-sessions.schema";
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
 * As tabelas que as chaves estrangeiras da tabela apontam (e só elas: a API não devolve as que apontam
 * para ela), na ordem em que a API as deu, sem repetir e sem a própria tabela. Passando de
 * `maxNeighbors`, `omitted` diz quantas ficaram de fora.
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

export type DiagramInput = {
  center: { ref: TableRef; columns: Column[] };
  foreignKeys: ForeignKey[];
  /** As tabelas de `referencedTables`, com as colunas (`null` se não chegaram). */
  neighbors: { ref: TableRef; columns: Column[] | null }[];
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
  foreignKey: ForeignKey;
  order: number;
  side: Side;
  self: boolean;
  target: DiagramBox;
  fromY: number;
  toY: number;
};

/** Tira os pontos repetidos em sequência, que um corredor sem desvio deixaria no caminho. */
function simplify(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

/**
 * Linhas que saem do mesmo ponto (a mesma coluna de origem) ou chegam ao mesmo ponto (duas chaves para a mesma
 * coluna, como origem e destino de uma transferência) ficariam uma sobre a outra. Cada grupo de pontos na mesma
 * altura e na mesma borda se abre em torno dela, a até 6 px entre linhas e sempre dentro da linha de 24 px. A ordem
 * dentro do grupo é a da altura do OUTRO extremo de cada linha (a que vai mais para cima ocupa o ponto de cima):
 * assim as linhas se abrem em leque, sem se cruzarem logo na saída, qualquer que seja a ordem em que a API as
 * devolveu. A volta de uma chave para a própria tabela tem os dois extremos na borda do centro, e os dois entram
 * na conta.
 */
function spreadPorts(routes: Route[]) {
  type Port = { route: Route; field: "fromY" | "toY"; y: number; opposite: number };

  const groups = new Map<string, Port[]>();
  for (const route of routes) {
    const ports: Port[] = [
      { route, field: "fromY", y: route.fromY, opposite: route.toY },
      { route, field: "toY", y: route.toY, opposite: route.fromY },
    ];

    for (const port of ports) {
      // Todo extremo que fica na borda do centro (a saída, e a chegada da volta) divide a mesma borda; o da vizinha, a borda dela.
      const onCenter = port.field === "fromY" || route.self;
      const key = onCenter ? `centro:${route.side}:${port.y}` : `${route.target.key}:${port.y}`;
      groups.set(key, [...(groups.get(key) ?? []), port]);
    }
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;

    const step = Math.min(6, (rowHeight - 6) / (group.length - 1));
    const sorted = [...group].sort((a, b) => a.opposite - b.opposite || a.route.order - b.route.order || Number(a.field === "toY") - Number(b.field === "toY"));
    sorted.forEach((port, index) => (port.route[port.field] = port.y + Math.round((index - (group.length - 1) / 2) * step)));
  }
}

/**
 * A ordem dos corredores de um lado, do mais perto do centro ao mais longe, a partir da ordem de preferência que
 * evita cruzamentos (`candidates`). Uma exigência vale mais que a preferência: se a saída de uma linha (na borda do
 * centro) está na MESMA altura da chegada de outra (na borda da vizinha), o trecho horizontal da saída corre sobre o
 * da chegada quando o corredor da primeira é o mais longe; a primeira tem de ficar mais perto do centro. A volta
 * de uma chave para a própria tabela tem as duas pontas na borda do centro, e vale como saída nas duas alturas.
 * Cada passo põe a primeira da preferência que nenhuma das que restam precisa preceder. Num ciclo (duas linhas que
 * trocam de altura: a saída de uma na altura da chegada da outra e o contrário) nenhuma ordem resolve: a primeira
 * da preferência tem a chegada afastada, de 1 em 1 px dentro da linha de 24 px, até sair da altura das saídas que a
 * exigiam. Por isso esta função muda `toY` de uma linha, e só nesse caso.
 */
function orderLanes(candidates: Route[]): Route[] {
  const centerHeights = (route: Route) => (route.self ? [route.fromY, route.toY] : [route.fromY]);
  const mustPrecede = (a: Route, b: Route) => a !== b && !b.self && centerHeights(a).includes(b.toY);

  const placed: Route[] = [];
  const remaining = [...candidates];
  while (remaining.length > 0) {
    let next = remaining.find((route) => !remaining.some((other) => mustPrecede(other, route)));
    if (next === undefined) {
      next = remaining[0];
      while (remaining.some((other) => mustPrecede(other, next!))) next.toY += 1;
    }
    placed.push(next);
    remaining.splice(remaining.indexOf(next), 1);
  }
  return placed;
}

/**
 * Posiciona a tabela no centro e as que ela referencia em volta (RN-TABELA-004): as vizinhas em duas
 * colunas, uma de cada lado, empilhadas e centradas na altura do desenho. Elas são ordenadas pela linha
 * da coluna de origem no centro e se alternam entre a direita e a esquerda, de modo que a primeira
 * (a coluna de cima) fica no alto da direita; assim as linhas quase não se cruzam. Cada chave
 * estrangeira é uma linha, do meio da coluna de origem (na borda do centro) ao meio da coluna
 * referenciada (na borda da vizinha), pelo primeiro par de colunas quando a chave é composta. Cada
 * linha do mesmo lado corre num corredor próprio do vão, para os trechos verticais não se
 * sobreporem, e a ordem dos corredores evita o cruzamento: as que sobem usam corredores cada vez mais
 * longe do centro conforme a origem desce, e as que descem, o contrário (a ordem da pilha é a das
 * origens, então as linhas de um lado não se cruzam). A chave estrangeira para a própria tabela dá
 * uma volta pelo lado direito.
 */
export function layoutDiagram({ center, foreignKeys, neighbors }: DiagramInput): DiagramLayout {
  const centerColumns = diagramColumns(center.columns, foreignKeys);
  const centerKey = tableKey(center.ref);

  const neighborColumns = new Map(neighbors.map((neighbor) => [tableKey(neighbor.ref), neighbor.columns === null ? null : diagramColumns(neighbor.columns, undefined)]));

  // A linha de origem mais alta de cada vizinha decide onde ela fica na pilha.
  const topRow = new Map<string, number>();
  for (const foreignKey of foreignKeys) {
    const key = tableKey({ schema: foreignKey.referencedSchema, name: foreignKey.referencedTable });
    const row = indexOfColumn(centerColumns, foreignKey.columns[0]);
    topRow.set(key, Math.min(topRow.get(key) ?? row, row));
  }
  const ordered = neighbors
    .map((neighbor, order) => ({ neighbor, order, row: topRow.get(tableKey(neighbor.ref)) ?? 0 }))
    .sort((a, b) => a.row - b.row || a.order - b.order)
    .map(({ neighbor }) => neighbor);

  const right = ordered.filter((_, index) => index % 2 === 0);
  const left = ordered.filter((_, index) => index % 2 === 1);

  const stackHeight = (refs: { ref: TableRef }[]) => refs.reduce((sum, { ref }) => sum + heightOf(neighborColumns.get(tableKey(ref)) ?? null), 0) + stackGap * Math.max(0, refs.length - 1);
  const centerHeight = heightOf(centerColumns);
  const inner = Math.max(centerHeight, stackHeight(left), stackHeight(right));

  const centerX = margin + (left.length > 0 ? boxWidth + columnGap : 0);
  const rightX = centerX + boxWidth + columnGap;

  const centerBox: DiagramBox = { key: centerKey, ref: center.ref, center: true, x: centerX, y: margin + Math.round((inner - centerHeight) / 2), width: boxWidth, height: centerHeight, columns: centerColumns };
  const boxes: DiagramBox[] = [centerBox];

  function stack(refs: { ref: TableRef }[], x: number) {
    let y = margin + Math.round((inner - stackHeight(refs)) / 2);
    for (const { ref } of refs) {
      const columns = neighborColumns.get(tableKey(ref)) ?? null;
      const height = heightOf(columns);
      boxes.push({ key: tableKey(ref), ref, center: false, x, y, width: boxWidth, height, columns });
      y += height + stackGap;
    }
  }
  stack(left, margin);
  stack(right, rightX);

  const byKey = new Map(boxes.map((box) => [box.key, box]));
  const sideOf = new Map<string, Side>([...left.map((neighbor): [string, Side] => [tableKey(neighbor.ref), "left"]), ...right.map((neighbor): [string, Side] => [tableKey(neighbor.ref), "right"])]);

  const routes: Route[] = [];
  foreignKeys.forEach((foreignKey, order) => {
    const key = tableKey({ schema: foreignKey.referencedSchema, name: foreignKey.referencedTable });
    const target = byKey.get(key);
    // A tabela que passou do teto não está no desenho: não há para onde ligar a linha.
    if (target === undefined) return;

    routes.push({
      foreignKey,
      order,
      side: sideOf.get(key) ?? "right",
      self: key === centerKey,
      target,
      fromY: rowCenter(centerBox, indexOfColumn(centerColumns, foreignKey.columns[0])),
      toY: rowCenter(target, indexOfColumn(target.columns, foreignKey.referencedColumns[0])),
    });
  });

  spreadPorts(routes);

  const edges: DiagramEdge[] = [];
  for (const side of ["right", "left"] as const) {
    const onSide = routes.filter((route) => route.side === side);
    const up = onSide.filter((route) => route.toY < route.fromY).sort((a, b) => a.fromY - b.fromY || a.order - b.order);
    const down = onSide.filter((route) => route.toY > route.fromY).sort((a, b) => b.fromY - a.fromY || a.order - b.order);
    // A linha reta (origem e destino na mesma altura) não tem trecho vertical e não ocupa corredor.
    const straight = onSide.filter((route) => route.toY === route.fromY);
    const lanes = orderLanes([...up, ...down]);

    const edgeX = side === "right" ? centerBox.x + boxWidth : centerBox.x;
    // O vão entre a borda do centro e a coluna da vizinha, ou, do lado direito sem vizinha, o espaço da volta da própria
    // tabela. Todas as linhas do lado, a volta inclusive, repartem este vão: cada uma tem o seu corredor.
    const gap = side === "right" && right.length === 0 ? loopRoom : columnGap;
    const laneX = (index: number) => edgeX + (side === "right" ? 1 : -1) * Math.round((gap * (index + 1)) / (lanes.length + 1));

    for (const route of [...lanes, ...straight]) {
      const from = { x: edgeX, y: route.fromY };
      // A volta chega à mesma borda de onde saiu; as outras, à borda da vizinha.
      const to = { x: route.self ? edgeX : side === "right" ? route.target.x : route.target.x + boxWidth, y: route.toY };
      const lane = lanes.indexOf(route);

      edges.push({
        key: `${route.order}:${route.foreignKey.name}`,
        name: route.foreignKey.name,
        label: labelOf(route.foreignKey, center.ref.schema),
        from,
        to,
        points: lane < 0 ? [from, to] : simplify([from, { x: laneX(lane), y: from.y }, { x: laneX(lane), y: to.y }, to]),
        fromTable: centerKey,
        toTable: route.target.key,
        fromColumn: route.foreignKey.columns[0],
        toColumn: route.foreignKey.referencedColumns[0],
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
