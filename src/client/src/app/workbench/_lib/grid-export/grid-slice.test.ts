import { describe, expect, it } from "vitest";

import { completeSlice, truncatedIn } from "./grid-slice";
import { sliceOf } from "./test-fixtures";
import { toDelimited, csvOptions } from "./to-delimited";

const columns = [
  { name: "id", type: "int4", kind: "number" as const },
  { name: "corpo", type: "text", kind: "text" as const },
];

describe("o recorte com o valor completo das células cortadas (RN-SQL-017)", () => {
  it("o valor completo entra no lugar do cortado, e só a célula que ficou sem continua marcada: todo formato sai com o valor inteiro", () => {
    const slice = sliceOf(
      columns,
      [
        ["1", "x".repeat(10)],
        ["2", "y".repeat(10)],
      ],
      {
        truncated: [
          [0, 1],
          [1, 1],
        ],
      },
    );

    const complete = completeSlice(slice, (row, column) => (row === 0 && column === 1 ? "x".repeat(50) : undefined));

    expect(complete.rows).toEqual([
      ["1", "x".repeat(50)],
      ["2", "y".repeat(10)],
    ]);
    expect(complete.rows[1]).toBe(slice.rows[1]);
    expect(truncatedIn(complete)(0, 1)).toBe(false);
    expect(truncatedIn(complete)(1, 1)).toBe(true);
    expect(toDelimited(complete, csvOptions)).toContain("x".repeat(50));
    expect(slice.rows[0][1]).toBe("x".repeat(10));
  });

  it("sem célula cortada, o recorte é o mesmo", () => {
    const slice = sliceOf(columns, [["1", "a"]]);

    expect(completeSlice(slice, () => "outro")).toBe(slice);
  });
});
