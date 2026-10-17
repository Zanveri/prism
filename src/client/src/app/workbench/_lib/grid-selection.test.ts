import { describe, expect, it } from "vitest";

import { movementOf, moveCell } from "./grid-cursor";
import {
  activeCell,
  afterSave,
  choseWholeRows,
  collapse,
  columnSpan,
  contextCell,
  contextRow,
  dragRows,
  emptySelection,
  escapeCollapses,
  extend,
  extendByKey,
  extendRows,
  hasSeveralCells,
  isSelected,
  positionOf,
  refAt,
  rowSpan,
  rowsBetween,
  select,
  selectAll,
  selectedCells,
  selectedColumns,
  selectedRows,
  selectionSize,
  selectNewRows,
  selectRow,
  sliceOf,
  toggleRow,
  wholeRows,
  type GridLayout,
  type GridSelection,
  type SliceSource,
} from "./grid-selection";
import type { QueryColumn } from "./query.schema";

/** Cinco linhas lidas, duas novas (ids 7 e 9) e quatro colunas. */
const layout: GridLayout = { read: 5, added: [7, 9], columns: 4 };
/** O "carregar mais" trouxe mais três lidas, que entram ANTES das novas. */
const loadedMore: GridLayout = { read: 8, added: [7, 9], columns: 4 };

const at = (row: number, column: number) => ({ row, column });
const clicked = (row: number, column: number, base: GridSelection = emptySelection, grid = layout) => select(base, at(row, column), grid);

describe("a seleção guarda as linhas pela identidade (RN-GRADE-001)", () => {
  it("a lida é a posição no resultado, a nova é o id; a posição volta pela grade de agora", () => {
    expect(refAt(layout, 2)).toEqual({ kind: "read", row: 2 });
    expect(refAt(layout, 6)).toEqual({ kind: "new", id: 9 });
    expect(refAt(layout, 7)).toBeNull();
    expect(positionOf(loadedMore, { kind: "new", id: 9 })).toBe(9);
    expect(positionOf({ ...layout, added: [7] }, { kind: "new", id: 9 })).toBeNull();
  });

  it("a célula ativa numa linha nova continua nela depois do 'carregar mais', que empurra as novas para baixo", () => {
    const selection = clicked(5, 1);

    expect(activeCell(selection, layout)).toEqual(at(5, 1));
    expect(activeCell(selection, loadedMore)).toEqual(at(8, 1));
  });

  it("o retângulo que atravessa as lidas e as novas fica nas mesmas linhas depois do 'carregar mais'", () => {
    const selection = extend(clicked(3, 0), at(5, 2), layout);

    expect(selectedRows(selection, layout)).toEqual([3, 4, 5]);
    // As três lidas que chegaram (5, 6 e 7) não entram: o retângulo é das linhas 3, 4 e da nova 7, agora na posição 8.
    expect(selectedRows(selection, loadedMore)).toEqual([3, 4, 8]);
    expect(activeCell(selection, loadedMore)).toEqual(at(8, 2));
  });

  it("as faixas de linhas são o que é guardado: as posições de uma a outra, em qualquer ordem, e só as que existem", () => {
    expect(rowsBetween(layout, 6, 3)).toEqual({ read: [[3, 4]], added: [7, 9] });
    expect(rowsBetween(layout, 0, 1)).toEqual({ read: [[0, 1]], added: [] });
    expect(rowsBetween(layout, 5, 40)).toEqual({ read: [], added: [7, 9] });
  });
});

describe("os gestos com o ponteiro (RN-GRADE-001)", () => {
  it("o clique numa célula a faz ativa, âncora e seleção", () => {
    const selection = clicked(1, 2);

    expect(activeCell(selection, layout)).toEqual(at(1, 2));
    expect(selectedRows(selection, layout)).toEqual([1]);
    expect(selectedColumns(selection, layout)).toEqual([2]);
    expect(hasSeveralCells(selection, layout)).toBe(false);
  });

  it("Shift+clique estende o retângulo da âncora até a célula, que passa a ser a ativa; sem âncora, é um clique", () => {
    const selection = extend(clicked(1, 2), at(3, 0), layout);

    expect(activeCell(selection, layout)).toEqual(at(3, 0));
    expect(selectedRows(selection, layout)).toEqual([1, 2, 3]);
    expect(selectedColumns(selection, layout)).toEqual([0, 1, 2]);
    expect(selectionSize(selection, layout)).toEqual({ rows: 3, cells: 9, whole: false });
    expect(extend(emptySelection, at(2, 2), layout)).toEqual(clicked(2, 2));
  });

  it("o arraste de volta à âncora é só a célula; a posição fora da grade não muda nada", () => {
    const start = clicked(1, 2);

    expect(extend(extend(start, at(3, 3), layout), at(1, 2), layout).shape).toEqual({ kind: "cell" });
    expect(extend(start, at(20, 1), layout)).toBe(start);
  });

  it("o clique no número escolhe a linha inteira; a ativa vai para ela, na coluna em que estava (na primeira, sem ativa)", () => {
    const fromCell = selectRow(clicked(0, 3), 2, layout);

    expect(activeCell(fromCell, layout)).toEqual(at(2, 3));
    expect(selectedRows(fromCell, layout)).toEqual([2]);
    expect(selectedColumns(fromCell, layout)).toEqual([0, 1, 2, 3]);
    expect(choseWholeRows(fromCell, layout)).toBe(true);
    expect(activeCell(selectRow(emptySelection, 2, layout), layout)).toEqual(at(2, 0));
  });

  it("Shift+clique no número escolhe as linhas da âncora até a clicada; Ctrl+clique acrescenta e tira", () => {
    const shifted = extendRows(selectRow(emptySelection, 1, layout), 3, layout);
    expect(selectedRows(shifted, layout)).toEqual([1, 2, 3]);

    const added = toggleRow(shifted, 6, layout);
    expect(selectedRows(added, layout)).toEqual([1, 2, 3, 6]);
    expect(activeCell(added, layout)).toEqual(at(6, 0));

    const removed = toggleRow(added, 2, layout);
    expect(selectedRows(removed, layout)).toEqual([1, 3, 6]);
    // A célula ativa foi para a linha que saiu: é o único caso em que ela fica fora da seleção.
    expect(activeCell(removed, layout)).toEqual(at(2, 0));
    expect(isSelected(removed, layout, at(2, 0))).toBe(false);
  });

  it("tirada a última linha pelo Ctrl+clique, a seleção volta a ser a célula ativa", () => {
    const selection = toggleRow(selectRow(emptySelection, 4, layout), 4, layout);

    expect(selection.shape).toEqual({ kind: "cell" });
    expect(activeCell(selection, layout)).toEqual(at(4, 0));
    expect(selectedRows(selection, layout)).toEqual([4]);
  });

  it("com um retângulo (ou só a célula ativa), o Ctrl+clique no número é o clique: vários retângulos ficam para depois", () => {
    const rectangle = extend(clicked(0, 0), at(1, 1), layout);

    expect(toggleRow(rectangle, 3, layout)).toEqual(selectRow(rectangle, 3, layout));
    expect(toggleRow(clicked(0, 1), 3, layout)).toEqual(selectRow(clicked(0, 1), 3, layout));
  });

  it("o arraste no número escolhe as linhas do começo até a do ponteiro; com Ctrl no começo, junta às que já estavam", () => {
    const base = toggleRow(selectRow(emptySelection, 0, layout), 6, layout);

    expect(selectedRows(dragRows(base, 2, 4, layout, false), layout)).toEqual([2, 3, 4]);
    expect(selectedRows(dragRows(base, 4, 2, layout, true), layout)).toEqual([0, 2, 3, 4, 6]);
    expect(activeCell(dragRows(base, 2, 4, layout, false), layout)?.row).toBe(4);
  });

  it("o canto e o Ctrl+A escolhem todas as linhas; sem célula ativa, a primeira passa a ser a ativa", () => {
    const all = selectAll(emptySelection, layout);

    expect(activeCell(all, layout)).toEqual(at(0, 0));
    expect(selectionSize(all, layout)).toEqual({ rows: 7, cells: 28, whole: true });
    expect(activeCell(selectAll(clicked(3, 2), layout), layout)).toEqual(at(3, 2));
    expect(selectAll(emptySelection, { read: 0, added: [], columns: 4 })).toBe(emptySelection);
  });

  it("as lidas que chegam depois de um Ctrl+A não entram nele, como no DBeaver; as novas que já estavam, sim", () => {
    const all = selectAll(emptySelection, layout);

    expect(selectedRows(all, loadedMore)).toEqual([0, 1, 2, 3, 4, 8, 9]);
    // A nova acrescentada depois também fica de fora.
    expect(selectedRows(all, { ...loadedMore, added: [7, 9, 11] })).toEqual([0, 1, 2, 3, 4, 8, 9]);
  });

  it("o botão direito fora da seleção a escolhe antes; dentro dela, a seleção fica e a célula clicada passa a ser a ativa", () => {
    const rectangle = extend(clicked(0, 0), at(2, 2), layout);

    const inside = contextCell(rectangle, at(1, 1), layout);
    expect(inside.shape).toEqual(rectangle.shape);
    expect(activeCell(inside, layout)).toEqual(at(1, 1));
    expect(contextCell(rectangle, at(4, 3), layout)).toEqual(clicked(4, 3));
  });

  it("o botão direito no número: fora da seleção escolhe a linha inteira, dentro dela deixa como está", () => {
    const rows = extendRows(selectRow(emptySelection, 1, layout), 3, layout);

    expect(contextRow(rows, 2, layout)).toBe(rows);
    expect(contextRow(rows, 4, layout)).toEqual(selectRow(rows, 4, layout));
  });
});

describe("os gestos pelo teclado (RN-GRADE-001)", () => {
  it("com Shift, as teclas estendem o retângulo; com linhas inteiras, a vertical estende as linhas e a horizontal só move a ativa", () => {
    const rectangle = extendByKey(clicked(1, 1), at(2, 2), layout, true);
    expect(selectedColumns(rectangle, layout)).toEqual([1, 2]);

    const rows = selectRow(emptySelection, 1, layout);
    const down = extendByKey(rows, at(3, 0), layout, true);
    expect(selectedRows(down, layout)).toEqual([1, 2, 3]);
    const right = extendByKey(down, at(3, 1), layout, false);
    expect(selectedRows(right, layout)).toEqual([1, 2, 3]);
    expect(activeCell(right, layout)).toEqual(at(3, 1));
  });

  it("Shift+Espaço faz do retângulo as linhas inteiras dele; Esc volta a seleção para a célula ativa", () => {
    const rectangle = extend(clicked(0, 1), at(2, 2), layout);
    const rows = wholeRows(rectangle);

    expect(choseWholeRows(rectangle, layout)).toBe(false);
    expect(choseWholeRows(rows, layout)).toBe(true);
    expect(selectedRows(rows, layout)).toEqual([0, 1, 2]);
    expect(selectedColumns(rows, layout)).toEqual([0, 1, 2, 3]);
    expect(choseWholeRows(wholeRows(clicked(4, 0)), layout)).toBe(true);

    const escaped = collapse(rows);
    expect(escaped.shape).toEqual({ kind: "cell" });
    expect(activeCell(escaped, layout)).toEqual(at(2, 2));
  });

  it("o Esc é da grade sempre que a seleção não é só a célula ativa, também a linha inteira de uma coluna só, que é uma célula e o Delete excluiria", () => {
    const narrow: GridLayout = { read: 3, added: [], columns: 1 };
    const row = selectRow(emptySelection, 1, narrow);

    expect(hasSeveralCells(row, narrow)).toBe(false);
    expect(choseWholeRows(row, narrow)).toBe(true);
    expect(escapeCollapses(row)).toBe(true);
    const escaped = collapse(row);
    expect(escapeCollapses(escaped)).toBe(false);
    expect(choseWholeRows(escaped, narrow)).toBe(false);
    expect(activeCell(escaped, narrow)).toEqual(at(1, 0));

    expect(escapeCollapses(wholeRows(select(emptySelection, at(2, 0), narrow)))).toBe(true);
    expect(escapeCollapses(extend(clicked(0, 1), at(2, 2), layout))).toBe(true);
    expect(escapeCollapses(clicked(0, 1))).toBe(false);
    expect(escapeCollapses(emptySelection)).toBe(false);
  });

  it("o retângulo que cobre todas as colunas continua um retângulo: não vale como linhas inteiras para o Delete", () => {
    const narrow: GridLayout = { read: 3, added: [], columns: 1 };

    expect(choseWholeRows(select(emptySelection, at(1, 0), narrow), narrow)).toBe(false);
    expect(choseWholeRows(extend(select(emptySelection, at(0, 0), narrow), at(2, 0), narrow), narrow)).toBe(false);
  });

  it("PageUp e PageDown andam uma altura da área à vista; com Ctrl, Alt ou Cmd a tecla não é da grade (o Ctrl+Shift+PageUp move a aba)", () => {
    expect(moveCell(at(10, 1), "PageDown", { rows: 100, columns: 3, page: 20 })).toEqual(at(30, 1));
    expect(moveCell(at(10, 1), "PageUp", { rows: 100, columns: 3, page: 20 })).toEqual(at(0, 1));
    expect(moveCell(at(95, 1), "PageDown", { rows: 100, columns: 3, page: 20 })).toEqual(at(99, 1));

    const key = (over: Partial<Parameters<typeof movementOf>[0]>) => movementOf({ key: "PageDown", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });
    expect(key({})).toEqual({ key: "PageDown", extend: false, vertical: true, ctrl: false });
    expect(key({ shiftKey: true })?.extend).toBe(true);
    expect(key({ ctrlKey: true, shiftKey: true })).toBeNull();
    expect(key({ altKey: true })).toBeNull();
    expect(key({ metaKey: true })).toBeNull();
    expect(key({ key: "Home", ctrlKey: true })?.vertical).toBe(true);
    expect(key({ key: "Home" })?.vertical).toBe(false);
    expect(key({ key: "a" })).toBeNull();
  });
});

describe("o que a grade desenha e o que as ações recebem", () => {
  it("as colunas escolhidas de cada linha à vista e as do cabeçalho", () => {
    const rectangle = extend(clicked(1, 1), at(2, 2), layout);

    expect(rowSpan(rectangle, layout, 0)).toBeNull();
    expect(rowSpan(rectangle, layout, 2)).toEqual([1, 2]);
    expect(columnSpan(rectangle, layout)).toEqual([1, 2]);
    expect(rowSpan(selectRow(emptySelection, 6, layout), layout, 6)).toEqual([0, 3]);
    expect(columnSpan(emptySelection, layout)).toBeNull();
  });

  it("as células escolhidas, linha a linha, na ordem da grade", () => {
    expect([...selectedCells(extend(clicked(5, 3), at(4, 2), layout), layout)]).toEqual([at(4, 2), at(4, 3), at(5, 2), at(5, 3)]);
    expect([...selectedCells(emptySelection, layout)]).toEqual([]);
  });

  it("a seleção das cópias do 'Duplicar linhas': as novas inteiras, com a ativa na primeira", () => {
    const copies = selectNewRows([7, 9], 2);

    expect(selectedRows(copies, layout)).toEqual([5, 6]);
    expect(activeCell(copies, layout)).toEqual(at(5, 2));
    expect(choseWholeRows(copies, layout)).toBe(true);
  });

  it("depois do Salvar que tirou as excluídas e pôs as novas como lidas, fica só a célula ativa, quando a linha dela continua", () => {
    const rows = selectAll(clicked(3, 1), layout);

    expect(activeCell(afterSave(rows, { deleted: [1], read: 5, added: [7, 9] }), { read: 6, added: [], columns: 4 })).toEqual(at(2, 1));
    expect(afterSave(clicked(1, 1), { deleted: [1], read: 5, added: [] })).toEqual(emptySelection);
    expect(activeCell(afterSave(clicked(6, 0), { deleted: [0, 2], read: 5, added: [7, 9] }), { read: 5, added: [], columns: 4 })).toEqual(at(4, 0));
    expect(afterSave(rows, { deleted: [], read: 5, added: [] }).shape).toEqual({ kind: "cell" });
  });

  it("o recorte: as linhas e as colunas da seleção, com o que a grade mostra, as cortadas, as 'gerado pelo banco' e as linhas novas", () => {
    const columns: QueryColumn[] = ["a", "b", "c", "d"].map((name) => ({ name, type: "text", kind: "text" }));
    const source: SliceSource = {
      columns,
      valueAt: (row, column) => (row === 5 && column === 3 ? null : `${row}.${column}`),
      truncatedAt: (row, column) => row === 4 && column === 2,
      generatedAt: (row, column) => row === 3 && column === 3,
    };
    const selection = extend(clicked(3, 2), at(5, 3), layout);

    const slice = sliceOf(selection, layout, source);
    expect(slice.columns.map((column) => column.name)).toEqual(["c", "d"]);
    expect(slice.rows).toEqual([
      ["3.2", null],
      ["4.2", "4.3"],
      ["5.2", null],
    ]);
    expect(slice.truncated).toEqual([[1, 0]]);
    expect(slice.generated).toEqual([[0, 1]]);
    expect(slice.newRows).toEqual([2]);
    expect(slice.positions).toEqual([3, 4, 5]);
    expect(slice.columnIndexes).toEqual([2, 3]);
    expect(slice.rowNumbers).toEqual([4, 5, 6]);

    expect(sliceOf(selection, layout, source, "rows").columns).toHaveLength(4);
    expect(sliceOf(selection, layout, source, "loaded").positions).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(sliceOf(emptySelection, layout, source).rows).toEqual([]);
  });
});

describe("desempenho: a seleção grande custa o mesmo que uma célula (RN-GRADE-001)", () => {
  it("o Ctrl+A em 100 mil linhas de 20 colunas é uma faixa, e desenhar e contar não passam pelas células", () => {
    const big: GridLayout = { read: 100_000, added: [1, 2, 3], columns: 20 };
    const started = performance.now();

    const all = selectAll(emptySelection, big);
    expect(all.shape).toEqual({ kind: "rows", rows: { read: [[0, 99_999]], added: [1, 2, 3] } });
    expect(selectionSize(all, big)).toEqual({ rows: 100_003, cells: 2_000_060, whole: true });
    for (let row = 50_000; row < 50_040; row += 1) expect(rowSpan(all, big, row)).toEqual([0, 19]);

    // Linhas tiradas uma a uma pelo Ctrl+clique viram faixas, e a pergunta continua sendo uma busca nelas.
    let holes = all;
    for (let row = 0; row < 2_000; row += 2) holes = toggleRow(holes, row, big);
    expect(holes.shape.kind === "rows" ? holes.shape.rows.read.length : 0).toBe(1_000);
    expect(rowSpan(holes, big, 1_000)).toBeNull();
    expect(rowSpan(holes, big, 1_001)).toEqual([0, 19]);

    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
