import { describe, expect, it } from "vitest";

import type { SelectionSlice } from "../grid-selection";
import type { SqlTarget } from "../record-edits.schema";
import { copyOriginOf, copySourceOf, copySourcesOf, singleTableOf } from "./copy-source";

/** `estoque.pedido`, de uma tabela só, com a identidade em `id` (o banco a calcula sempre) e o `codigo` por padrão. */
const target = (change: Partial<SqlTarget["tables"][number]> = {}, tables = 1): SqlTarget => ({
  tables: Array.from({ length: tables }, (_, index) => ({ schema: "estoque", name: index === 0 ? "pedido" : "cliente", key: [0], editable: true, reason: null, kind: "table" as const, keyColumns: ["id"], ...change })),
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: "always" },
    { table: 0, baseColumn: "codigo", editable: true, reason: null, nullable: false, generated: "byDefault" },
    { table: null, baseColumn: null, editable: false, reason: "calculada", nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
});

/** O recorte de duas linhas lidas (1 e 3 na grade) e uma nova, nas colunas 0 e 2 da grade. */
const slice: SelectionSlice = {
  columns: [
    { name: "id", type: "int4", kind: "number" },
    { name: "total", type: "numeric", kind: "number" },
  ],
  rows: [
    ["1", "10.5"],
    ["3", "cortado…"],
    [null, "7"],
  ],
  truncated: [[1, 1]],
  rowNumbers: [1, 3, 4],
  positions: [0, 2, 3],
  columnIndexes: [0, 2],
  newRows: [2],
  generated: [[2, 0]],
};

describe("a origem do Copiar como (RN-GRADE-016)", () => {
  it("nos Registros: o nome da tabela, sem o esquema, e a tabela da aba como destino, mesmo sem o alvo", () => {
    const origin = copyOriginOf(1, { schema: "estoque", name: "pedido" }, null);
    expect(origin).toMatchObject({ engine: 1, sourceName: "pedido", table: { schema: "estoque", name: "pedido" } });
    expect(origin.generated(0)).toBeNull();
  });

  it("no resultado: `resultado`, e a tabela do alvo de uma tabela só, qualquer que seja o tipo dela; o banco calcula as colunas que o alvo diz", () => {
    const origin = copyOriginOf(2, null, { kind: "target", target: target({ kind: "view", editable: false, reason: "pedido é uma visão" }) });
    expect(origin).toMatchObject({ sourceName: "resultado", table: { schema: "estoque", name: "pedido" } });
    expect([0, 1, 2].map(origin.generated)).toEqual(["always", "byDefault", null]);
  });

  it("a junção, a tabela que é outra agora (elsewhere), o resultado só leitura por outro motivo e a falha não dão tabela nem colunas calculadas", () => {
    for (const answer of [
      { kind: "target" as const, target: target({}, 2) },
      { kind: "target" as const, target: target({ kind: "elsewhere" }) },
      { kind: "notEditable" as const, reason: "DISTINCT" },
      { kind: "failed" as const, message: null },
      null,
    ]) {
      const origin = copyOriginOf(1, null, answer);
      expect(origin.table).toBeNull();
      expect(origin.generated(0)).toBeNull();
    }
    expect(singleTableOf(target({}, 2))).toBeNull();
    expect(singleTableOf(target())?.name).toBe("pedido");
  });

  it("copySourceOf: as colunas com o `generated` da coluna da grade, o número da grade (nulo na linha nova) e as marcas por linha", () => {
    const origin = copyOriginOf(1, null, { kind: "target", target: target() });
    const source = copySourceOf(slice, origin);

    expect(source.columns).toEqual([
      { name: "id", type: "int4", kind: "number", generated: "always" },
      { name: "total", type: "numeric", kind: "number", generated: null },
    ]);
    expect(source.rows).toEqual([
      { values: ["1", "10.5"], number: 1, cut: [], generated: [] },
      { values: ["3", "cortado…"], number: 3, cut: [1], generated: [] },
      { values: [null, "7"], number: null, cut: [], generated: [0] },
    ]);
    expect(source.table).toEqual({ schema: "estoque", name: "pedido" });
  });

  it("as três origens do \"O que copiar\", cada uma do seu recorte", () => {
    const origin = copyOriginOf(1, null, null);
    const sources = copySourcesOf({ cells: slice, rows: { ...slice, rows: slice.rows.slice(0, 1), rowNumbers: [1], positions: [0], newRows: [], truncated: [], generated: [] }, loaded: slice }, origin);
    expect(sources.cells.rows).toHaveLength(3);
    expect(sources.rows.rows).toHaveLength(1);
    expect(sources.loaded.rows).toHaveLength(3);
  });
});
