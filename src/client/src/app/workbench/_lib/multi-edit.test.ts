import { describe, expect, it } from "vitest";

import type { Engine } from "@/components/ui";

import type { RowContext } from "./cell-editing";
import { emptySelection, extend, select, selectColumn, selectRow, toggleRow, type GridLayout } from "./grid-selection";
import { allRowsLine, assignmentOf, columnPendingOf, commandLimits, editScopeOf, groupLimit, groupRefusal, literalOf, scopeHint, setNullLabel, wholeColumnBlocker } from "./multi-edit";
import { multiEditCopy } from "./multi-edit.copy";
import type { QueryColumn } from "./query.schema";
import { editWholeColumn, noEdits } from "./record-edits";
import type { EditTarget } from "./record-edits.schema";

// As decisões puras da edição de várias células e da coluna inteira (seção 38: RN-EDIT-017 e 018), sem React.

const pg: Engine = 1;
const db2: Engine = 2;
const ifx: Engine = 3;
const copy = multiEditCopy;

const layout: GridLayout = { read: 5, added: [7], columns: 3 };
const columns: QueryColumn[] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "status", type: "text", kind: "text" },
  { name: "preco", type: "numeric", kind: "number" },
];
const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedido", key: [0], editable: true, reason: null }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
    { table: 0, baseColumn: "preco", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

describe("para quem a edição vale (RN-EDIT-017 e 018)", () => {
  it("uma célula só, as células escolhidas da coluna da ativa (num retângulo de várias colunas, só a dela), ou a coluna inteira", () => {
    const one = select(emptySelection, { row: 1, column: 1 }, layout);
    expect(editScopeOf(one, layout)).toEqual({ kind: "one" });

    const rectangle = extend(one, { row: 3, column: 2 }, layout);
    // O Shift+clique leva a célula ativa ao fim do retângulo: o de 3 linhas e 2 colunas vale para as 3 células da coluna dela, e a outra não muda.
    expect(editScopeOf(rectangle, layout)).toEqual({ kind: "cells", column: 2, rows: [1, 2, 3] });

    const rows = toggleRow(selectRow(one, 0, layout), 5, layout);
    expect(editScopeOf(rows, layout)).toMatchObject({ kind: "cells", rows: [0, 5] });

    const whole = selectColumn(one, 2, layout);
    expect(editScopeOf(whole, layout)).toEqual({ kind: "all", column: 2, added: [5] });
  });

  it("com a célula ativa fora da seleção (o Ctrl+clique que tirou a linha dela), a edição é só dela", () => {
    const rows = toggleRow(selectRow(emptySelection, 0, layout), 2, layout);
    const without = toggleRow(rows, 2, layout);
    expect(editScopeOf(without, layout)).toEqual({ kind: "one" });
  });

  it("a dica do campo e da barra, e o rótulo do \"Definir como nulo\"", () => {
    expect(scopeHint({ kind: "cells", column: 2, rows: Array.from({ length: 37 }, (_, row) => row) }, "preco")).toBe("Vale para as 37 células escolhidas da coluna preco.");
    expect(scopeHint({ kind: "all", column: 2, added: [] }, "preco")).toBe("Vale para todas as linhas do resultado, também as que não foram carregadas (coluna preco).");
    expect(scopeHint({ kind: "all", column: 2, added: [] }, "preco", "bar")).toBe("Vale para todas as linhas do resultado (coluna preco).");
    expect(scopeHint({ kind: "one" }, "preco")).toBeNull();

    expect(setNullLabel({ kind: "one" }, "Definir como nulo")).toBe("Definir como nulo");
    expect(setNullLabel({ kind: "cells", column: 2, rows: Array.from({ length: 37 }, (_, row) => row) }, "x")).toBe("Definir as 37 células como nulo");
    expect(setNullLabel({ kind: "all", column: 2, added: [] }, "x")).toBe("Definir a coluna inteira como nulo");
  });
});

describe("a conferência das células antes de editar várias (RN-EDIT-017)", () => {
  const read = (over: Partial<Extract<RowContext, { kind: "read" }>> = {}): RowContext => ({ kind: "read", truncated: undefined, deleted: false, values: ["1", "a", "10"], ...over });
  const label = (row: number) => `linha ${row + 1}`;

  it("a primeira que não pode receber o valor, na ordem da grade, com o número da linha e o motivo", () => {
    const contexts: Record<number, RowContext> = { 0: read(), 6: read({ truncated: new Set([1]) }), 8: read({ deleted: true }) };
    const rowOf = (row: number) => contexts[row] ?? read();
    expect(groupRefusal({ target, column: 1, rows: [0, 6, 8], rowOf, labelOf: label })).toBe("A edição não foi feita: a célula da linha 7 chegou cortada.");
    expect(groupRefusal({ target, column: 1, rows: [0, 8], rowOf, labelOf: label })).toBe("A edição não foi feita: a linha 9 está marcada para exclusão; Desfazer alteração a devolve.");
  });

  it("a chave cortada, a chave gerada pelo banco, a junção externa sem linha e a célula que o banco preencheu", () => {
    const check = (row: RowContext, name = "linha 7") => groupRefusal({ target, column: 1, rows: [6], rowOf: () => row, labelOf: () => name });
    expect(check(read({ truncated: new Set([0]) }))).toBe("A edição não foi feita: a chave da linha 7 chegou cortada.");
    expect(check(read({ generated: new Set([0]) }), "linha nova 2")).toBe("A edição não foi feita: a chave da linha nova 2 foi gerada pelo banco; execute de novo para editá-la.");
    expect(check(read({ values: [null, "a", "1"] }), "linha 9")).toBe("A edição não foi feita: na linha 9, pedido não tem linha (a chave veio nula).");
    expect(check(read({ generated: new Set([1]) }), "linha nova 3")).toBe("A edição não foi feita: a célula da linha nova 3 foi preenchida pelo banco; execute de novo para vê-la.");
    expect(check({ kind: "new" })).toBeNull();
  });

  it("até 100.000 células de uma vez", () => {
    const rows = Array.from({ length: groupLimit + 1 }, (_, row) => row);
    expect(groupRefusal({ target, column: 1, rows, rowOf: () => read(), labelOf: label })).toBe(copy.tooMany);
    expect(groupRefusal({ target, column: 1, rows: rows.slice(1), rowOf: () => read(), labelOf: label })).toBeNull();
  });
});

describe("o limite de linhas e o sorteio no texto do comando (RN-EDIT-018)", () => {
  it("LIMIT, OFFSET e FETCH FIRST sem ORDER BY no mesmo nível; com ele, só o aviso dos empates", () => {
    expect(commandLimits("select * from t limit 5", pg)).toEqual({ limitWithoutOrder: true, limited: true, sample: false });
    expect(commandLimits("select * from t order by id limit 5 offset 2", pg)).toEqual({ limitWithoutOrder: false, limited: true, sample: false });
    expect(commandLimits("select * from t offset 10 rows", db2).limitWithoutOrder).toBe(true);
    expect(commandLimits("select * from t order by id fetch first 5 rows only", db2).limitWithoutOrder).toBe(false);
    expect(commandLimits("select * from t fetch next 5 rows only", db2).limitWithoutOrder).toBe(true);
    expect(commandLimits("select * from t where id > 1", pg)).toEqual({ limitWithoutOrder: false, limited: false, sample: false });
  });

  it("dentro de parênteses vale o nível de dentro: a ordem de fora não ordena a subconsulta", () => {
    expect(commandLimits("select * from (select * from t limit 3) q order by id", pg).limitWithoutOrder).toBe(true);
    expect(commandLimits("select * from (select * from t order by id limit 3) q", pg).limitWithoutOrder).toBe(false);
  });

  it("no Informix, os modificadores logo depois do SELECT (FIRST, SKIP, LIMIT) contam; FIRST fora da cabeça não", () => {
    expect(commandLimits("select first 5 * from t", ifx).limitWithoutOrder).toBe(true);
    expect(commandLimits("select skip 2 first 5 * from t order by id", ifx)).toEqual({ limitWithoutOrder: false, limited: true, sample: false });
    expect(commandLimits("select limit 5 * from t", ifx).limitWithoutOrder).toBe(true);
    expect(commandLimits("select first, last from t", ifx).limitWithoutOrder).toBe(false);
    expect(commandLimits("select first 5 * from t", pg).limitWithoutOrder).toBe(false);
  });

  it("texto, nomes entre aspas, comentários e nomes qualificados não contam", () => {
    expect(commandLimits("select 'limit 5' from t", pg).limited).toBe(false);
    expect(commandLimits('select "limit" from t', pg).limited).toBe(false);
    expect(commandLimits("select * from t -- limit 5", pg).limited).toBe(false);
    expect(commandLimits("select t.limit from t", pg).limited).toBe(false);
  });

  it("o TABLESAMPLE; e o ORDER BY do filtro do resultado (RN-GRADE-011) é a ordem de fora", () => {
    expect(commandLimits("select * from t tablesample system (10)", pg).sample).toBe(true);
    expect(commandLimits("select * from t limit 5", pg, "status = 'A' ORDER BY id").limitWithoutOrder).toBe(false);
    expect(commandLimits("select * from t limit 5", pg, "status = 'A'").limitWithoutOrder).toBe(true);
  });
});

describe("quando a coluna inteira não vale (RN-EDIT-018)", () => {
  const blocker = (over: Partial<Parameters<typeof wholeColumnBlocker>[0]> = {}) => wholeColumnBlocker({ target, column: 2, columns, read: true, sql: "select * from loja.pedido", engine: pg, ...over });

  it("vale no resultado de uma tabela só, de leitura, sem limite nem sorteio", () => {
    expect(blocker()).toBeNull();
    expect(blocker({ target: null })).toBeNull();
  });

  it("os motivos, na ordem da regra: a junção, a chave, a chave com o nome repetido, o comando que não é leitura, o limite sem ordem e o sorteio", () => {
    const join: EditTarget = { ...target, tables: [...target.tables, { schema: "loja", name: "cliente", key: [1], editable: true, reason: null }], rowOperations: false };
    expect(blocker({ target: join, read: false })).toBe(copy.wholeReasons.join);
    expect(blocker({ column: 0, read: false })).toBe("id é da chave de pedido: na coluna inteira, todas as linhas ficariam com a mesma chave");
    expect(blocker({ columns: [...columns.slice(0, 2), { name: "id", type: "int4", kind: "number" }], read: false })).toBe("id, da chave de pedido, aparece com o mesmo nome em mais de uma coluna do resultado");
    expect(blocker({ read: false, sql: "select * from t limit 1" })).toBe(copy.wholeReasons.notRead);
    expect(blocker({ sql: "select * from t limit 1 tablesample bernoulli (1)" })).toBe(copy.wholeReasons.limit);
    expect(blocker({ sql: "select * from t tablesample bernoulli (1)" })).toBe(copy.wholeReasons.sample);
  });
});

describe("a coluna inteira na faixa e no cabeçalho (RN-EDIT-018)", () => {
  it("o valor como o Ver SQL o escreve: o literal do banco, o nulo como NULL, e `?` sem literal", () => {
    expect(literalOf(pg, "10.00", "number")).toBe("10.00");
    expect(literalOf(pg, "A", "text")).toBe("'A'");
    expect(literalOf(pg, null, "text")).toBe("NULL");
    expect(literalOf(pg, "a\nb", "text")).toBe("?");
    expect(literalOf(undefined, "it's", "text")).toBe("'it''s'");
  });

  it("\"Em todas as linhas do resultado: preco = 10.00; status = 'A'.\", com o literal cortado em 60 caracteres", () => {
    const edits = editWholeColumn(editWholeColumn(noEdits, 2, "10.00"), 1, "A");
    expect(allRowsLine(edits, columns, pg)).toBe("Em todas as linhas do resultado: preco = 10.00; status = 'A'.");
    expect(allRowsLine(noEdits, columns, pg)).toBeNull();
    expect(assignmentOf(pg, columns[1], "x".repeat(70))).toBe(`status = '${"x".repeat(59)}…`);
  });

  it("o mapa do cabeçalho e das células, com a nota da coluna que pode estar gravada em parte das linhas", () => {
    const edits = { ...editWholeColumn(noEdits, 2, "10.00"), columns: [{ column: 2, value: "10.00", uncertain: true }] };
    expect(columnPendingOf(noEdits, columns, pg)).toBeNull();
    expect(columnPendingOf(edits, columns, pg)?.get(2)).toEqual({ value: "10.00", hint: `Alteração pendente em todas as linhas: preco = 10.00\n${copy.uncertain}`, uncertain: true });
  });
});
