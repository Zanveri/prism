import { describe, expect, it, vi } from "vitest";

import { allCutCells, cutCellsOf, fetchFullValues, fullValuesBatch, noFullValues, withFullValues, type FetchCells } from "./full-values";

const marks = (entries: [number, number[]][]) => new Map(entries.map(([row, columns]) => [row, new Set(columns)]));

describe("que células pedir (RN-SQL-017)", () => {
  it("só as cortadas da seleção, sem repetir; a que não foi cortada já está inteira na tela", () => {
    const truncated = marks([
      [0, [1]],
      [3, [1, 2]],
    ]);

    const cut = cutCellsOf(
      [
        { row: 0, column: 0 },
        { row: 0, column: 1 },
        { row: 3, column: 2 },
        { row: 0, column: 1 },
        { row: 7, column: 1 },
      ],
      truncated,
    );

    expect(cut).toEqual([
      { row: 0, column: 1, resultRow: 0 },
      { row: 3, column: 2, resultRow: 3 },
    ]);
  });

  it("depois de um Salvar que tirou linhas, a linha do resultado na API é a de antes, e não a da grade", () => {
    const truncated = marks([[1, [0]]]);

    expect(cutCellsOf([{ row: 1, column: 0 }], truncated, [0, 2, null])).toEqual([{ row: 1, column: 0, resultRow: 2 }]);
  });

  it("todas as cortadas das linhas lidas, para exportar", () => {
    expect(
      allCutCells(
        marks([
          [2, [0, 3]],
          [5, [1]],
        ]),
      ),
    ).toEqual([
      { row: 2, column: 0 },
      { row: 2, column: 3 },
      { row: 5, column: 1 },
    ]);
  });
});

describe("a busca dos valores completos (RN-SQL-017)", () => {
  const signal = () => new AbortController().signal;

  it("sem célula cortada, nada é pedido", async () => {
    const fetchCells = vi.fn<FetchCells>();

    expect(await fetchFullValues([], fetchCells, signal())).toBe(noFullValues);
    expect(fetchCells).not.toHaveBeenCalled();
  });

  it("pede pela linha do resultado, em lotes de até 10.000, um depois do outro, e acha cada valor pela posição na grade", async () => {
    const cut = Array.from({ length: fullValuesBatch * 2 + 1 }, (_, index) => ({ row: index, column: 1, resultRow: index + 100 }));
    const fetchCells = vi.fn<FetchCells>(async (cells) => cells.map((cell) => `inteiro ${cell.row}`));

    const full = await fetchFullValues(cut, fetchCells, signal());

    expect(fetchCells.mock.calls.map(([cells]) => cells.length)).toEqual([10_000, 10_000, 1]);
    expect(fetchCells.mock.calls[0][0][0]).toEqual({ row: 100, column: 1 });
    expect(full?.valueOf(0, 1)).toBe("inteiro 100");
    expect(full?.valueOf(20_000, 1)).toBe("inteiro 20100");
    expect(full?.valueOf(0, 0)).toBeUndefined();
    expect(full?.missing).toBe(0);
  });

  it("a célula sem valor completo (nulo) e o lote que não veio ficam cortados, e a busca diz quantos", async () => {
    const cut = Array.from({ length: fullValuesBatch + 2 }, (_, index) => ({ row: index, column: 0, resultRow: index }));
    const fetchCells = vi.fn<FetchCells>(async (cells) => (cells.length === 2 ? null : cells.map((cell) => (cell.row === 3 ? null : "x"))));

    const full = await fetchFullValues(cut, fetchCells, signal());

    expect(full?.missing).toBe(3);
    expect(full?.valueOf(3, 0)).toBeUndefined();
    expect(full?.valueOf(fullValuesBatch, 0)).toBeUndefined();
    expect(full?.valueOf(4, 0)).toBe("x");
  });

  it("cancelada no meio, não devolve nada e não pede o lote seguinte", async () => {
    const controller = new AbortController();
    const cut = Array.from({ length: fullValuesBatch + 1 }, (_, index) => ({ row: index, column: 0, resultRow: index }));
    const fetchCells = vi.fn<FetchCells>(async (cells) => {
      controller.abort();
      return cells.map(() => "x");
    });

    expect(await fetchFullValues(cut, fetchCells, controller.signal)).toBeNull();
    expect(fetchCells).toHaveBeenCalledTimes(1);
  });
});

describe("o que exportar grava (RN-SQL-017)", () => {
  const rows = [
    ["1", "corte do primeiro"],
    ["2", "curto"],
    ["3", "corte do terceiro"],
  ];

  it("o valor completo entra no lugar do cortado, e só a célula que ficou sem continua marcada; a linha sem troca é o mesmo objeto", () => {
    const result = {
      rows,
      truncated: marks([
        [0, [1]],
        [2, [1]],
      ]),
      hasMore: false,
    };
    const full = { valueOf: (row: number) => (row === 0 ? "corte do primeiro, inteiro" : undefined), missing: 1 };

    const exported = withFullValues(result, full);

    expect(exported.rows).toEqual([["1", "corte do primeiro, inteiro"], rows[1], rows[2]]);
    expect(exported.rows[1]).toBe(rows[1]);
    expect(exported.truncated).toEqual(marks([[2, [1]]]));
    expect(exported.hasMore).toBe(false);
    expect(rows[0][1]).toBe("corte do primeiro");
  });

  it("sem célula cortada, o resultado é o mesmo", () => {
    const result = { rows, truncated: new Map() };

    expect(withFullValues(result, noFullValues)).toBe(result);
  });
});

describe("parar de pedir entre um lote e outro (RN-GRADE-002 e RN-SQL-017)", () => {
  it("quem pediu manda parar depois de um lote: o resto não é pedido, conta como sem valor, e a resposta diz que parou", async () => {
    const cut = Array.from({ length: fullValuesBatch + 5 }, (_, index) => ({ row: index, column: 0, resultRow: index }));
    const fetchCells = vi.fn<FetchCells>(async (cells) => cells.map(() => "x"));
    const seen: number[] = [];

    const full = await fetchFullValues(cut, fetchCells, new AbortController().signal, (batch) => {
      seen.push(batch.length);
      return false;
    });

    expect(fetchCells).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([fullValuesBatch]);
    expect(full).toMatchObject({ missing: 5, stopped: true });
    expect(full?.valueOf(0, 0)).toBe("x");
  });

  it("depois do último lote não há o que parar: a resposta é a de sempre", async () => {
    const full = await fetchFullValues([{ row: 0, column: 0, resultRow: 0 }], async () => ["x"], new AbortController().signal, () => false);

    expect(full).toMatchObject({ missing: 0 });
    expect(full?.stopped).toBeUndefined();
  });
});
