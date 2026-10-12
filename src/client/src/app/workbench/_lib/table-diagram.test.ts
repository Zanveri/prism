import { describe, expect, it } from "vitest";

import type { Column, ForeignKey } from "./database-sessions.schema";
import { boxWidth, clampZoom, fitText, fitZoom, layoutDiagram, maxNeighbors, maxZoom, minZoom, opensNeighbor, referencedTables, rowHeight, settleActions, tableKey, zoomIn, zoomLabel, zoomOut, type DiagramBox, type DiagramEdge, type DiagramLayout, type Point } from "./table-diagram";

const column = (name: string, position: number, over: Partial<Column> = {}): Column => ({ name, type: "bigint", isNullable: false, isPrimaryKey: false, position, ...over });
const fk = (name: string, columns: string[], referencedTable: string, referencedColumns: string[] = ["id"], referencedSchema = "producao"): ForeignKey => ({ name, columns, referencedSchema, referencedTable, referencedColumns });

const centerRef = { schema: "producao", name: "apontamento" };
const center = { ref: centerRef, columns: [column("id", 1, { isPrimaryKey: true }), column("ordem_id", 2), column("maquina_id", 3), column("operador_id", 4), column("quantidade", 5, { type: "numeric(12,3)" })] };
const idOnly = [column("id", 1, { isPrimaryKey: true }), column("nome", 2, { type: "varchar(60)" })];

const neighbor = (name: string, columns: Column[] | null = idOnly, schema = "producao") => ({ ref: { schema, name }, columns });

const boxOf = (layout: DiagramLayout, name: string, schema = "producao"): DiagramBox => {
  const box = layout.boxes.find((candidate) => candidate.key === tableKey({ schema, name }));
  if (box === undefined) throw new Error(`Sem caixa para ${schema}.${name}`);
  return box;
};

/** O centro da linha de uma coluna, na medida do canvas: o título é a primeira linha de 24 px, depois 12 px de respiro em cima. */
const rowY = (box: DiagramBox, index: number) => box.y + 12 + rowHeight * (index + 1) + rowHeight / 2;

describe("referencedTables: quem entra em volta da tabela (RN-TABELA-004)", () => {
  it("as tabelas que as chaves estrangeiras apontam, sem repetir, na ordem em que a API as deu", () => {
    const tables = referencedTables(center.ref, [fk("a", ["ordem_id"], "ordem_producao"), fk("b", ["maquina_id"], "maquina"), fk("c", ["operador_id"], "ordem_producao")]);

    expect(tables.tables.map((table) => table.name)).toEqual(["ordem_producao", "maquina"]);
    expect(tables.omitted).toBe(0);
  });

  it("a própria tabela não é vizinha (chave estrangeira para si mesma)", () => {
    expect(referencedTables(center.ref, [fk("pai", ["ordem_id"], "apontamento")]).tables).toEqual([]);
  });

  it("o mesmo nome em outro esquema é outra tabela", () => {
    const tables = referencedTables(center.ref, [fk("a", ["ordem_id"], "maquina", ["id"], "producao"), fk("b", ["maquina_id"], "maquina", ["id"], "cadastro")]);

    expect(tables.tables).toEqual([
      { schema: "producao", name: "maquina" },
      { schema: "cadastro", name: "maquina" },
    ]);
  });

  it("passando de 12, ficam as 12 primeiras e a conta das que sobraram", () => {
    const many = Array.from({ length: 15 }, (_, index) => fk(`fk${index}`, ["ordem_id"], `t${index}`));
    const tables = referencedTables(center.ref, many);

    expect(tables.tables).toHaveLength(maxNeighbors);
    expect(tables.tables[0].name).toBe("t0");
    expect(tables.omitted).toBe(3);
  });
});

describe("layoutDiagram: as caixas (RN-TABELA-004)", () => {
  it("sem chave estrangeira, a tabela sozinha, com a margem em volta", () => {
    const layout = layoutDiagram({ center, foreignKeys: [], neighbors: [] });
    const box = boxOf(layout, "apontamento");

    expect(layout.boxes).toHaveLength(1);
    expect(layout.edges).toEqual([]);
    expect(box.center).toBe(true);
    expect(layout.width).toBe(box.x * 2 + boxWidth);
    expect(layout.height).toBe(box.y * 2 + box.height);
  });

  it("a altura da caixa é o título mais uma linha por coluna, com o respiro do canvas (24 + 24 px)", () => {
    const box = boxOf(layoutDiagram({ center, foreignKeys: [], neighbors: [] }), "apontamento");

    expect(box.height).toBe(rowHeight * (center.columns.length + 1) + 24);
    expect(box.width).toBe(264);
  });

  it("as colunas na ordem da posição, com a marca de chave primária e as de chave estrangeira da tabela", () => {
    const shuffled = { ...center, columns: [...center.columns].reverse() };
    const layout = layoutDiagram({ center: shuffled, foreignKeys: [fk("a", ["ordem_id"], "ordem_producao"), fk("b", ["maquina_id"], "maquina")], neighbors: [neighbor("ordem_producao"), neighbor("maquina")] });
    const columns = boxOf(layout, "apontamento").columns ?? [];

    expect(columns.map((item) => item.name)).toEqual(["id", "ordem_id", "maquina_id", "operador_id", "quantidade"]);
    expect(columns.map((item) => [item.primaryKey, item.foreignKey])).toEqual([
      [true, false],
      [false, true],
      [false, true],
      [false, false],
      [false, false],
    ]);
  });

  it("uma vizinha: a tabela à esquerda e ela à direita, na mesma coluna de caixas do centro até o fim", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "ordem_producao")], neighbors: [neighbor("ordem_producao")] });
    const middle = boxOf(layout, "apontamento");
    const other = boxOf(layout, "ordem_producao");

    expect(other.x).toBeGreaterThan(middle.x + middle.width);
    expect(layout.width).toBe(other.x + other.width + middle.x);
  });

  it("duas ou mais: repartidas entre a direita e a esquerda do centro", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "ordem_producao"), fk("b", ["maquina_id"], "maquina"), fk("c", ["operador_id"], "operador")], neighbors: [neighbor("ordem_producao"), neighbor("maquina"), neighbor("operador")] });
    const middle = boxOf(layout, "apontamento");
    const sides = ["ordem_producao", "maquina", "operador"].map((name) => (boxOf(layout, name).x > middle.x ? "right" : "left"));

    expect(sides.filter((side) => side === "right")).toHaveLength(2);
    expect(sides.filter((side) => side === "left")).toHaveLength(1);
    // O centro fica entre as duas colunas: nada começa antes da margem.
    expect(Math.min(...layout.boxes.map((box) => box.x))).toBe(48);
  });

  it("as vizinhas ficam na ordem da coluna de origem, de cima para baixo, para as linhas não se cruzarem", () => {
    // `operador_id` (linha 4) aponta para a tabela que vem primeiro na ordem alfabética; `ordem_id` (linha 2) para a última.
    const layout = layoutDiagram({
      center,
      foreignKeys: [fk("a", ["operador_id"], "a_operador"), fk("b", ["ordem_id"], "z_ordem"), fk("c", ["maquina_id"], "m_maquina"), fk("d", ["quantidade"], "n_outra")],
      neighbors: [neighbor("a_operador"), neighbor("z_ordem"), neighbor("m_maquina"), neighbor("n_outra")],
    });
    const right = layout.boxes.filter((box) => !box.center && box.x > boxOf(layout, "apontamento").x).sort((a, b) => a.y - b.y);
    const left = layout.boxes.filter((box) => !box.center && box.x < boxOf(layout, "apontamento").x).sort((a, b) => a.y - b.y);

    // Ordem pela linha de origem: ordem_id (2), maquina_id (3), operador_id (4), quantidade (5); lados alternados a partir da direita.
    expect(right.map((box) => box.ref.name)).toEqual(["z_ordem", "a_operador"]);
    expect(left.map((box) => box.ref.name)).toEqual(["m_maquina", "n_outra"]);
  });

  it("a pilha de cada lado fica centrada na altura do desenho, e nenhuma caixa sobrepõe outra", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "t1"), fk("b", ["maquina_id"], "t2"), fk("c", ["operador_id"], "t3"), fk("d", ["quantidade"], "t4"), fk("e", ["id"], "t5")], neighbors: ["t1", "t2", "t3", "t4", "t5"].map((name) => neighbor(name)) });

    for (const a of layout.boxes) {
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y + a.height).toBeLessThanOrEqual(layout.height);
      for (const b of layout.boxes) {
        if (a === b || a.x !== b.x) continue;
        expect(a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.ref.name} e ${b.ref.name} se sobrepõem`).toBe(true);
      }
    }
  });

  it("o mesmo nome em outro esquema é outra caixa", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "maquina", ["id"], "producao"), fk("b", ["maquina_id"], "maquina", ["id"], "cadastro")], neighbors: [neighbor("maquina"), neighbor("maquina", idOnly, "cadastro")] });

    expect(layout.boxes.filter((box) => box.ref.name === "maquina")).toHaveLength(2);
  });

  it("a vizinha cujas colunas não chegaram aparece só com o título, e a conta de altura segue valendo", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "ordem_producao")], neighbors: [neighbor("ordem_producao", null)] });
    const other = boxOf(layout, "ordem_producao");

    expect(other.columns).toBeNull();
    expect(other.height).toBe(rowHeight * 1 + 24);
  });
});

describe("layoutDiagram: as linhas, uma por chave estrangeira (RN-TABELA-004)", () => {
  it("sai da linha da coluna de origem, na borda do centro, e chega à linha da coluna referenciada, na borda da vizinha", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("fk_ordem", ["ordem_id"], "ordem_producao", ["id"])], neighbors: [neighbor("ordem_producao")] });
    const middle = boxOf(layout, "apontamento");
    const other = boxOf(layout, "ordem_producao");
    const [edge] = layout.edges;

    expect(layout.edges).toHaveLength(1);
    expect(edge.from).toEqual({ x: middle.x + middle.width, y: rowY(middle, 1) });
    expect(edge.to).toEqual({ x: other.x, y: rowY(other, 0) });
  });

  it("é ortogonal: só segmentos horizontais e verticais, o primeiro e o último horizontais (a seta entra de lado)", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["operador_id"], "t1", ["nome"]), fk("b", ["ordem_id"], "t2")], neighbors: [neighbor("t1"), neighbor("t2")] });

    for (const edge of layout.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      for (let index = 1; index < edge.points.length; index++) {
        const [a, b] = [edge.points[index - 1], edge.points[index]];
        expect(a.x === b.x || a.y === b.y, edge.name).toBe(true);
      }
      expect(edge.points[0].y).toBe(edge.points[1].y);
      expect(edge.points.at(-1)?.y).toBe(edge.points.at(-2)?.y);
      expect(edge.points[0]).toEqual(edge.from);
      expect(edge.points.at(-1)).toEqual(edge.to);
    }
  });

  it("para a vizinha da esquerda, sai da borda esquerda do centro e chega à borda direita dela", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "t1"), fk("b", ["maquina_id"], "t2")], neighbors: [neighbor("t1"), neighbor("t2")] });
    const middle = boxOf(layout, "apontamento");
    const toLeft = layout.edges.find((edge) => edge.to.x < middle.x);

    expect(toLeft).toBeDefined();
    expect(toLeft?.from.x).toBe(middle.x);
    expect(toLeft?.to.x).toBe(boxOf(layout, "t2").x + boxWidth);
  });

  it("duas chaves estrangeiras para a mesma tabela são duas linhas para uma caixa só, em corredores diferentes", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("origem", ["ordem_id"], "local"), fk("destino", ["maquina_id"], "local")], neighbors: [neighbor("local")] });

    expect(layout.boxes.filter((box) => box.ref.name === "local")).toHaveLength(1);
    expect(layout.edges).toHaveLength(2);
    const lanes = layout.edges.map((edge) => edge.points[1].x);
    expect(new Set(lanes).size).toBe(2);
  });

  it("a coluna referenciada que não está na vizinha aponta para o título dela, e a chave composta usa o primeiro par", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("composta", ["ordem_id", "maquina_id"], "t1", ["inexistente", "id"])], neighbors: [neighbor("t1")] });
    const other = boxOf(layout, "t1");

    expect(layout.edges[0].to.y).toBe(other.y + 12 + rowHeight / 2);
    expect(layout.edges[0].from.y).toBe(rowY(boxOf(layout, "apontamento"), 1));
  });

  it("chave estrangeira para a própria tabela: uma volta pelo lado direito, sem caixa nova", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("pai", ["operador_id"], "apontamento", ["id"])], neighbors: [] });
    const middle = boxOf(layout, "apontamento");
    const [edge] = layout.edges;

    expect(layout.boxes).toHaveLength(1);
    expect(edge.from).toEqual({ x: middle.x + middle.width, y: rowY(middle, 3) });
    expect(edge.to).toEqual({ x: middle.x + middle.width, y: rowY(middle, 0) });
    expect(edge.points[1].x).toBeGreaterThan(middle.x + middle.width);
    // A volta cabe no desenho: a largura inclui o laço e a margem.
    expect(layout.width).toBeGreaterThanOrEqual(edge.points[1].x);
  });

  it("a chave estrangeira cuja tabela passou do teto não tem linha: não há para onde ir", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "t1"), fk("b", ["maquina_id"], "t2")], neighbors: [neighbor("t1")] });

    expect(layout.edges.map((edge) => edge.name)).toEqual(["a"]);
  });

  it("a legenda da linha diz a chave, as colunas e a tabela referenciada (para a dica)", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("fk_ordem", ["ordem_id"], "ordem_producao", ["id"])], neighbors: [neighbor("ordem_producao")] });

    expect(layout.edges[0].label).toBe("fk_ordem: ordem_id → ordem_producao (id)");
  });
});

type Segment = { a: Point; b: Point };

const segmentsOf = (edge: DiagramEdge): Segment[] => edge.points.slice(1).map((point, index) => ({ a: edge.points[index], b: point }));
const isHorizontal = (segment: Segment) => segment.a.y === segment.b.y;
const between = (value: number, a: number, b: number) => value > Math.min(a, b) && value < Math.max(a, b);

/** Quantos pares de linhas se cruzam (um trecho horizontal de uma atravessa um vertical de outra) ou andam sobrepostas num mesmo corredor. */
function tangles(layout: DiagramLayout): number {
  let count = 0;
  for (const [first, edge] of layout.edges.entries()) {
    for (const other of layout.edges.slice(first + 1)) {
      for (const a of segmentsOf(edge)) {
        for (const b of segmentsOf(other)) {
          if (isHorizontal(a) !== isHorizontal(b)) {
            const [h, v] = isHorizontal(a) ? [a, b] : [b, a];
            if (between(v.a.x, h.a.x, h.b.x) && between(h.a.y, v.a.y, v.b.y)) count++;
          } else if (!isHorizontal(a) && a.a.x === b.a.x && between(a.a.y, b.a.y, b.b.y)) count++;
        }
      }
    }
  }
  return count;
}

/** O comprimento que dois trechos paralelos (os dois horizontais ou os dois verticais) têm em comum; 0 se não estão na mesma reta ou só se tocam. */
function sharedLength(a: Segment, b: Segment): number {
  if (isHorizontal(a) !== isHorizontal(b)) return 0;
  const [from, to, line] = isHorizontal(a) ? (["x", "x", "y"] as const) : (["y", "y", "x"] as const);
  if (a.a[line] !== b.a[line]) return 0;
  return Math.max(0, Math.min(Math.max(a.a[from], a.b[to]), Math.max(b.a[from], b.b[to])) - Math.max(Math.min(a.a[from], a.b[to]), Math.min(b.a[from], b.b[to])));
}

/** Quantos pares de linhas têm um trecho SOBRE o de outra: na mesma reta, com comprimento em comum (a que `tangles` não vê nos horizontais). */
function overlaps(layout: DiagramLayout): number {
  let count = 0;
  for (const [first, edge] of layout.edges.entries()) {
    for (const other of layout.edges.slice(first + 1)) {
      if (segmentsOf(edge).some((a) => segmentsOf(other).some((b) => sharedLength(a, b) > 0))) count++;
    }
  }
  return count;
}

/** Quantos pares de linhas se cruzam: um trecho horizontal de uma atravessa um vertical da outra. */
function crossings(layout: DiagramLayout): number {
  let count = 0;
  for (const [first, edge] of layout.edges.entries()) {
    for (const other of layout.edges.slice(first + 1)) {
      const crossed = segmentsOf(edge).some((a) =>
        segmentsOf(other).some((b) => {
          if (isHorizontal(a) === isHorizontal(b)) return false;
          const [h, v] = isHorizontal(a) ? [a, b] : [b, a];
          return between(v.a.x, h.a.x, h.b.x) && between(h.a.y, v.a.y, v.b.y);
        }),
      );
      if (crossed) count++;
    }
  }
  return count;
}

describe("layoutDiagram: as linhas não se cruzam nem se sobrepõem (RN-TABELA-004)", () => {
  /**
   * Uma tabela com `count` colunas de chave estrangeira, cada uma apontando para a sua tabela `ref_NN`. Com `self`, mais
   * uma coluna (`pai_id`) cuja chave volta para a própria tabela.
   */
  function hub(count: number, neighborCount = Math.min(count, maxNeighbors), self = false) {
    const hubColumns = [column("id", 1, { isPrimaryKey: true }), ...Array.from({ length: count }, (_, index) => column(`ref${index + 1}_id`, index + 2)), ...(self ? [column("pai_id", count + 2)] : [])];
    const foreignKeys = [...Array.from({ length: count }, (_, index) => fk(`fk${index + 1}`, [`ref${index + 1}_id`], `ref_${String(index + 1).padStart(2, "0")}`)), ...(self ? [fk("fk_self", ["pai_id"], "hub")] : [])];
    const neighbors = referencedTables({ schema: "producao", name: "hub" }, foreignKeys).tables.slice(0, neighborCount).map((ref) => ({ ref, columns: idOnly }));
    return layoutDiagram({ center: { ref: { schema: "producao", name: "hub" }, columns: hubColumns }, foreignKeys, neighbors });
  }

  it("uma tabela com 12 vizinhas: nenhuma linha atravessa outra", () => {
    const layout = hub(12);

    expect(layout.edges).toHaveLength(12);
    expect(tangles(layout)).toBe(0);
  });

  it("de 1 a 12 vizinhas, também (as que descem e as que sobem pedem corredores em ordens contrárias)", () => {
    for (let count = 1; count <= 12; count++) expect(tangles(hub(count)), `${count} vizinhas`).toBe(0);
  });

  it("a volta da chave para a própria tabela entra na grade de corredores das outras: de 0 a 12 vizinhas, nenhum trecho sobre o de outra linha", () => {
    for (let count = 0; count <= 12; count++) {
      const layout = hub(count, undefined, true);

      expect(layout.edges, `${count} vizinhas`).toHaveLength(count + 1);
      expect(overlaps(layout), `${count} vizinhas e a volta`).toBe(0);
    }
  });

  it("a reprodução mínima da revisão: uma chave para outra tabela e uma para a própria, numa tabela de 6 colunas, não dividem o corredor", () => {
    const six = { ref: centerRef, columns: ["id", "a", "b", "c", "d", "e"].map((name, index) => column(name, index + 1, { isPrimaryKey: index === 0 })) };
    const layout = layoutDiagram({ center: six, foreignKeys: [fk("fk0", ["c"], "ordem_producao", ["id"]), fk("fk_self", ["d"], "apontamento", ["id"])], neighbors: [neighbor("ordem_producao")] });
    const [outside, loop] = layout.edges;

    expect(overlaps(layout)).toBe(0);
    expect(outside.points[1].x).not.toBe(loop.points[1].x);
    // Os dois corredores ficam no vão entre o centro e a vizinha, e a volta chega de volta à borda de onde saiu.
    const middle = boxOf(layout, "apontamento");
    const other = boxOf(layout, "ordem_producao");
    for (const edge of [outside, loop]) {
      expect(edge.points[1].x).toBeGreaterThan(middle.x + middle.width);
      expect(edge.points[1].x).toBeLessThan(other.x);
    }
    expect(loop.to.x).toBe(middle.x + middle.width);
  });

  it("a tabela do canvas (três chaves, três vizinhas) sai sem cruzamento", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "ordem_producao"), fk("b", ["maquina_id"], "maquina"), fk("c", ["operador_id"], "operador")], neighbors: [neighbor("ordem_producao"), neighbor("maquina"), neighbor("operador")] });

    expect(tangles(layout)).toBe(0);
  });

  it("cada linha do mesmo lado tem corredor só dela", () => {
    const layout = hub(12);
    const middle = boxOf(layout, "hub");

    for (const side of ["right", "left"] as const) {
      const lanes = layout.edges.filter((edge) => (side === "right" ? edge.to.x > middle.x : edge.to.x < middle.x)).map((edge) => edge.points[1].x);
      expect(new Set(lanes).size, side).toBe(lanes.length);
    }
  });

  it("duas chaves para a mesma coluna da mesma tabela chegam em pontos diferentes da linha, sem sair dela", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("origem", ["ordem_id"], "local"), fk("destino", ["maquina_id"], "local")], neighbors: [neighbor("local")] });
    const target = boxOf(layout, "local");
    const ends = layout.edges.map((edge) => edge.to.y);

    expect(new Set(ends).size).toBe(2);
    for (const y of ends) expect(Math.abs(y - rowY(target, 0))).toBeLessThanOrEqual(rowHeight / 2 - 3);
    expect(tangles(layout)).toBe(0);
  });

  it("duas chaves que saem da mesma coluna também se abrem, em vez de uma ficar sobre a outra", () => {
    // Duas chaves da mesma coluna para a mesma tabela (colunas diferentes dela): saem do mesmo lado, da mesma linha.
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "t1", ["id"]), fk("b", ["ordem_id"], "t1", ["nome"])], neighbors: [neighbor("t1")] });
    const starts = layout.edges.map((edge) => edge.from.y);

    expect(new Set(starts).size).toBe(2);
    for (const y of starts) expect(Math.abs(y - rowY(boxOf(layout, "apontamento"), 1))).toBeLessThanOrEqual(rowHeight / 2 - 3);
    expect(tangles(layout)).toBe(0);
  });

  it("origem e destino na mesma altura: linha reta, sem trecho vertical", () => {
    // `id` é a linha 0 da vizinha e da tabela: as duas caixas são do mesmo tamanho e ficam alinhadas.
    const one = [column("id", 1, { isPrimaryKey: true })];
    const layout = layoutDiagram({ center: { ref: centerRef, columns: one }, foreignKeys: [fk("a", ["id"], "outra")], neighbors: [{ ref: { schema: "producao", name: "outra" }, columns: one }] });

    expect(layout.edges[0].from.y).toBe(layout.edges[0].to.y);
    expect(segmentsOf(layout.edges[0]).every(isHorizontal)).toBe(true);
  });
});

/** Sorteio de semente fixa (congruencial linear): os números são sempre os mesmos, e uma falha se refaz pela semente que o teste mostra. */
function lcg(seed: number) {
  let state = seed;
  return () => (state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296) / 4_294_967_296;
}

type Profile = { self: boolean; twins: boolean; pair?: boolean };
type Sketch = { layout: DiagramLayout; foreignKeys: ForeignKey[]; rows: { source: number; target: number; toSelf: boolean }[] };

/**
 * Uma tabela sorteada: de 3 a 12 colunas (`c0` é a chave primária), de 1 a 5 vizinhas (`n0`…) de 1 a 8 colunas (`k0`…), e até
 * 7 chaves estrangeiras de colunas sorteadas. `self`: a primeira chave, e uma em cada cinco das outras, volta para a própria
 * tabela. `twins`: poucas vizinhas e várias chaves, então várias apontam para a mesma tabela, às vezes da mesma coluna.
 * `pair`: só duas chaves, para a mesma tabela. `rows` guarda a linha de origem e a de destino de cada chave.
 */
function sketch(seed: number, { self, twins, pair = false }: Profile): Sketch {
  const rand = lcg(seed);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const centerColumns = Array.from({ length: int(3, 12) }, (_, index) => column(`c${index}`, index + 1, { isPrimaryKey: index === 0 }));
  const neighborCount = pair ? 1 : twins ? int(1, 2) : int(1, 5);
  const neighborColumns = Array.from({ length: neighborCount }, () => Array.from({ length: int(1, 8) }, (_, index) => column(`k${index}`, index + 1)));
  const count = pair ? 2 : twins ? int(2, 5) : int(0, 7);

  const foreignKeys: ForeignKey[] = [];
  const rows: Sketch["rows"] = [];
  for (let index = 0; index < count; index++) {
    const source = int(1, centerColumns.length - 1);
    if (self && (index === 0 || rand() < 0.2)) {
      const target = int(0, centerColumns.length - 1);
      foreignKeys.push(fk(`fk${index}`, [`c${source}`], centerRef.name, [`c${target}`]));
      rows.push({ source, target, toSelf: true });
    } else {
      const table = int(0, neighborCount - 1);
      const target = int(0, neighborColumns[table].length - 1);
      foreignKeys.push(fk(`fk${index}`, [`c${source}`], `n${table}`, [`k${target}`]));
      rows.push({ source, target, toSelf: false });
    }
  }

  const { tables } = referencedTables(centerRef, foreignKeys);
  const neighbors = tables.map((ref) => ({ ref, columns: neighborColumns[Number(ref.name.slice(1))] }));
  return { layout: layoutDiagram({ center: { ref: centerRef, columns: centerColumns }, foreignKeys, neighbors }), foreignKeys, rows };
}

describe("layoutDiagram: propriedades de tabelas sorteadas, com semente fixa (RN-TABELA-004)", () => {
  const samples = 1_000;
  // A tolerância das pontas: uma linha de 24 px com 3 px de folga em cada borda.
  const reach = rowHeight / 2 - 3;
  const profiles = [
    ["chaves para outras tabelas", { self: false, twins: false }],
    ["com uma chave para a própria tabela", { self: true, twins: false }],
    ["com chaves gêmeas (várias para a mesma tabela)", { self: false, twins: true }],
    ["gêmeas e para a própria tabela", { self: true, twins: true }],
  ] as const;

  it.each(profiles)("nenhum trecho de uma linha fica sobre o de outra: %s", (_title, profile) => {
    let withSeveralEdges = 0;

    for (let seed = 1; seed <= samples; seed++) {
      const { layout } = sketch(seed, profile);

      if (layout.edges.length >= 2) withSeveralEdges++;
      expect(overlaps(layout), `semente ${seed}`).toBe(0);
    }
    // O sorteio tem de exercitar a propriedade: a maioria das tabelas tem duas ou mais linhas.
    expect(withSeveralEdges).toBeGreaterThan(samples / 2);
  });

  it.each(profiles)("cada linha é ortogonal, sai da linha da coluna de origem e chega à da referenciada, dentro do desenho: %s", (_title, profile) => {
    for (let seed = 1; seed <= samples; seed++) {
      const { layout, foreignKeys, rows } = sketch(seed, profile);
      const middle = boxOf(layout, centerRef.name);

      expect(layout.edges, `semente ${seed}`).toHaveLength(foreignKeys.length);
      foreignKeys.forEach((foreignKey, index) => {
        const edge = layout.edges.find((candidate) => candidate.key.startsWith(`${index}:`));
        const label = `semente ${seed}, ${foreignKey.name}`;
        if (edge === undefined) throw new Error(`${label}: sem linha`);

        const { source, target, toSelf } = rows[index];
        const destination = boxOf(layout, foreignKey.referencedTable);
        const facing = edge.from.x === middle.x ? "left" : "right";

        // A saída é na borda do centro, a até 9 px do meio da linha de origem; a chegada, na borda da vizinha que olha para o centro.
        expect([middle.x, middle.x + middle.width], label).toContain(edge.from.x);
        expect(Math.abs(edge.from.y - rowY(middle, source)), label).toBeLessThanOrEqual(reach);
        expect(edge.to.x, label).toBe(toSelf ? edge.from.x : facing === "left" ? destination.x + destination.width : destination.x);
        expect(Math.abs(edge.to.y - rowY(destination, target)), label).toBeLessThanOrEqual(reach);

        // Só trechos horizontais e verticais, o primeiro e o último na horizontal, e nada sai do desenho.
        expect(edge.points[0], label).toEqual(edge.from);
        expect(edge.points.at(-1), label).toEqual(edge.to);
        expect(edge.points[0].y, label).toBe(edge.points[1].y);
        expect(edge.points.at(-1)?.y, label).toBe(edge.points.at(-2)?.y);
        edge.points.forEach((point, at) => {
          if (at > 0) expect(point.x === edge.points[at - 1].x || point.y === edge.points[at - 1].y, label).toBe(true);
          expect(point.x, label).toBeGreaterThanOrEqual(0);
          expect(point.x, label).toBeLessThanOrEqual(layout.width);
          expect(point.y, label).toBeGreaterThanOrEqual(0);
          expect(point.y, label).toBeLessThanOrEqual(layout.height);
        });
      });
    }
  });

  it("duas chaves gêmeas sozinhas: cruzam se, e só se, a ordem das origens e a dos destinos são estritamente opostas", () => {
    let opposite = 0;

    for (let seed = 1; seed <= samples; seed++) {
      const { layout, rows } = sketch(seed, { self: false, twins: true, pair: true });
      const inverted = (rows[0].source - rows[1].source) * (rows[0].target - rows[1].target) < 0;

      if (inverted) opposite++;
      expect(crossings(layout) > 0, `semente ${seed}: origens ${rows[0].source},${rows[1].source}; destinos ${rows[0].target},${rows[1].target}`).toBe(inverted);
    }
    // Os dois lados da equivalência acontecem no sorteio.
    expect(opposite).toBeGreaterThan(samples / 5);
    expect(opposite).toBeLessThan(samples);
  });

  it("a ordem em que a API devolve as chaves gêmeas não muda onde as linhas se cruzam", () => {
    const keys = [fk("a", ["ordem_id"], "local", ["nome"]), fk("b", ["operador_id"], "local", ["id"])];

    for (const foreignKeys of [keys, [...keys].reverse()]) {
      const layout = layoutDiagram({ center, foreignKeys, neighbors: [neighbor("local")] });

      // `ordem_id` está acima de `operador_id`, e `id` acima de `nome`: as ordens são opostas, e o cruzamento é o único.
      expect(crossings(layout)).toBe(1);
      expect(overlaps(layout)).toBe(0);
    }
  });
});

describe("layoutDiagram: o espaçamento das portas, a pilha e as marcas de chave", () => {
  /** `count` chaves, todas da coluna `ordem_id` do centro para a coluna `id` da vizinha: as pontas caem todas no mesmo ponto. */
  function fan(count: number) {
    const layout = layoutDiagram({ center, foreignKeys: Array.from({ length: count }, (_, index) => fk(`fk${index}`, ["ordem_id"], "t1", ["id"])), neighbors: [neighbor("t1")] });
    const middle = boxOf(layout, "apontamento");
    const other = boxOf(layout, "t1");
    return {
      layout,
      starts: layout.edges.map((edge) => edge.from.y - rowY(middle, 1)).sort((a, b) => a - b),
      ends: layout.edges.map((edge) => edge.to.y - rowY(other, 0)).sort((a, b) => a - b),
    };
  }

  it("duas linhas no mesmo ponto abrem 3 px para cada lado do meio da linha; três, de 6 em 6 px", () => {
    expect(fan(2).starts).toEqual([-3, 3]);
    expect(fan(2).ends).toEqual([-3, 3]);
    expect(fan(3).starts).toEqual([-6, 0, 6]);
    expect(fan(3).ends).toEqual([-6, 0, 6]);
  });

  it("só se abrem as linhas que dividem a mesma ponta: por bordas ou caixas diferentes, cada uma fica no meio da sua linha", () => {
    // `ordem_id` aponta para a vizinha da direita e para a da esquerda: duas saídas da mesma linha, uma em cada borda do centro.
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "t1"), fk("b", ["ordem_id"], "t2")], neighbors: [neighbor("t1"), neighbor("t2")] });
    const middle = boxOf(layout, "apontamento");

    expect(boxOf(layout, "t1").y).toBe(boxOf(layout, "t2").y);
    expect(layout.edges.map((edge) => edge.from.y)).toEqual([rowY(middle, 1), rowY(middle, 1)]);
    // As duas vizinhas, uma de cada lado, estão à mesma altura: as chegadas também caem na mesma altura, em bordas diferentes.
    expect(layout.edges.map((edge) => edge.to.y)).toEqual([rowY(boxOf(layout, "t1"), 0), rowY(boxOf(layout, "t2"), 0)]);
  });

  it("de 2 a 12 linhas no mesmo ponto: pontos todos diferentes, dentro da linha de 24 px com 3 px de folga, e nenhuma sobre outra", () => {
    for (let count = 2; count <= 12; count++) {
      const { layout, starts, ends } = fan(count);

      expect(new Set(starts).size, `${count} linhas`).toBe(count);
      expect(new Set(ends).size, `${count} linhas`).toBe(count);
      for (const offset of [...starts, ...ends]) expect(Math.abs(offset), `${count} linhas`).toBeLessThanOrEqual(rowHeight / 2 - 3);
      // O teto de 6 px entre linhas vale: passando de quatro, o passo encolhe para caber na linha.
      for (const points of [starts, ends]) points.slice(1).forEach((offset, at) => expect(offset - points[at], `${count} linhas`).toBeLessThanOrEqual(6));
      expect(overlaps(layout), `${count} linhas`).toBe(0);
    }
  });

  it("as caixas empilhadas do mesmo lado ficam a 32 px uma da outra", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("a", ["ordem_id"], "t1"), fk("b", ["maquina_id"], "t2"), fk("c", ["operador_id"], "t3")], neighbors: [neighbor("t1"), neighbor("t2"), neighbor("t3")] });
    const right = layout.boxes.filter((box) => !box.center && box.x > boxOf(layout, "apontamento").x).sort((a, b) => a.y - b.y);

    expect(right).toHaveLength(2);
    expect(right[1].y - (right[0].y + right[0].height)).toBe(32);
  });

  it("uma chave composta marca como FK todas as colunas dela, e só elas; as vizinhas não levam marca de FK", () => {
    const layout = layoutDiagram({ center, foreignKeys: [fk("composta", ["ordem_id", "maquina_id"], "t1", ["id", "nome"])], neighbors: [neighbor("t1")] });

    expect(boxOf(layout, "apontamento").columns?.map((item) => [item.name, item.foreignKey])).toEqual([
      ["id", false],
      ["ordem_id", true],
      ["maquina_id", true],
      ["operador_id", false],
      ["quantidade", false],
    ]);
    expect(boxOf(layout, "t1").columns?.every((item) => !item.foreignKey)).toBe(true);
    expect(boxOf(layout, "t1").columns?.map((item) => item.primaryKey)).toEqual([true, false]);
  });
});

describe("fitText: o que cabe numa linha de caixa", () => {
  it("cabendo, nada muda", () => {
    expect(fitText("id", "bigint", "PK")).toEqual({ name: "id", type: "bigint", cut: false });
  });

  it("passando do orçamento de caracteres, o tipo encurta primeiro e depois o nome, com reticências", () => {
    const long = fitText("registrado_em_com_nome_muito_comprido", "timestamp with time zone", "FK");

    expect(long.cut).toBe(true);
    expect(long.name.length + long.type.length + 2).toBeLessThanOrEqual(29);
    expect(long.name.endsWith("…") || long.type.endsWith("…")).toBe(true);
  });

  it("a marca de chave tira espaço da linha: o que cabe sem ela pode não caber com ela", () => {
    expect(fitText("abcdefghijkl", "abcdefghijklmno", null).cut).toBe(false);
    expect(fitText("abcdefghijkl", "abcdefghijklmno", "PK").cut).toBe(true);
  });

  it("um nome comprido sozinho encurta, e o tipo guarda ao menos o começo", () => {
    const fitted = fitText("a_coluna_com_um_nome_muito_comprido_mesmo", "int", null);

    expect(fitted.type).toBe("int");
    expect(fitted.name.endsWith("…")).toBe(true);
    expect(fitted.name.length + 1 + fitted.type.length).toBeLessThanOrEqual(29);
  });
});

describe("zoom (RN-TABELA-004: rola, amplia e reduz)", () => {
  it("amplia e reduz em passos de 25%, nos limites de 25% e 200%", () => {
    expect(zoomIn(1)).toBe(1.25);
    expect(zoomOut(1)).toBe(0.8);
    expect(zoomIn(maxZoom)).toBe(maxZoom);
    expect(zoomOut(minZoom)).toBe(minZoom);
    expect(clampZoom(9)).toBe(maxZoom);
    expect(clampZoom(0)).toBe(minZoom);
  });

  it("subir e descer não deixa o zoom fugir dos limites nem criar números longos", () => {
    let zoom = 1;
    for (let step = 0; step < 20; step++) zoom = zoomIn(zoom);
    expect(zoom).toBe(maxZoom);
    for (let step = 0; step < 20; step++) zoom = zoomOut(zoom);
    expect(zoom).toBe(minZoom);
    expect(String(zoomIn(1.25)).length).toBeLessThanOrEqual(4);
  });

  it("ajustar à tela: o maior zoom, até 100%, em que o desenho inteiro cabe na janela", () => {
    expect(fitZoom({ width: 1000, height: 500 }, { width: 500, height: 500 })).toBe(0.5);
    expect(fitZoom({ width: 1000, height: 1000 }, { width: 2000, height: 500 })).toBe(0.5);
    expect(fitZoom({ width: 400, height: 300 }, { width: 2000, height: 2000 })).toBe(1);
  });

  it("ajustar à tela arredonda para baixo: o desenho nunca passa da janela por um pixel", () => {
    expect(fitZoom({ width: 1000, height: 100 }, { width: 456, height: 900 })).toBe(0.45);
    expect(fitZoom({ width: 1000, height: 100 }, { width: 580, height: 900 })).toBe(0.58);
  });

  it("ajustar à tela nunca passa do mínimo, e uma janela sem tamanho (escondida) devolve 100%", () => {
    expect(fitZoom({ width: 9000, height: 9000 }, { width: 100, height: 100 })).toBe(minZoom);
    expect(fitZoom({ width: 1000, height: 1000 }, { width: 0, height: 0 })).toBe(1);
  });

  it("o rótulo é a porcentagem inteira", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(0.64)).toBe("64%");
    expect(zoomLabel(1.5625)).toBe("156%");
  });
});

describe("opensNeighbor: as teclas que abrem a tabela de uma vizinha (RN-TABELA-004)", () => {
  it("Enter e Espaço, como um botão", () => {
    expect(opensNeighbor("Enter")).toBe(true);
    expect(opensNeighbor(" ")).toBe(true);
  });

  it("nenhuma outra tecla: o Tab segue, as setas e as letras não abrem nada", () => {
    for (const key of ["Tab", "Escape", "ArrowDown", "ArrowRight", "+", "-", "0", "a", "Spacebar", "Space", ""]) expect(opensNeighbor(key), JSON.stringify(key)).toBe(false);
  });
});

describe("settleActions: o diagrama mede o próprio tamanho quando aparece (RN-TABELA-004)", () => {
  const fresh = { fitted: false, restored: false, hasMemory: false };

  it("escondido (sem largura ou sem altura), espera: não há o que medir nem onde rolar", () => {
    expect(settleActions({ width: 0, height: 0 }, fresh)).toEqual({ wait: true, restore: false, fit: false });
    expect(settleActions({ width: 800, height: 0 }, fresh)).toEqual({ wait: true, restore: false, fit: false });
    expect(settleActions({ width: 0, height: 600 }, { ...fresh, hasMemory: true })).toEqual({ wait: true, restore: false, fit: false });
  });

  it("a primeira vez que tem tamanho, ajusta o desenho à janela", () => {
    expect(settleActions({ width: 1120, height: 640 }, fresh)).toEqual({ wait: false, restore: false, fit: true });
  });

  it("com um zoom e uma rolagem lembrados, volta à rolagem e não ajusta de novo (o estado já nasce 'ajustado')", () => {
    expect(settleActions({ width: 1120, height: 640 }, { fitted: true, restored: false, hasMemory: true })).toEqual({ wait: false, restore: true, fit: false });
  });

  it("o que já foi feito não se refaz: aparecer de novo, ou mudar de tamanho, não ajusta nem rola outra vez", () => {
    expect(settleActions({ width: 1120, height: 640 }, { fitted: true, restored: true, hasMemory: true })).toEqual({ wait: false, restore: false, fit: false });
    expect(settleActions({ width: 900, height: 500 }, { fitted: true, restored: false, hasMemory: false })).toEqual({ wait: false, restore: false, fit: false });
  });
});
