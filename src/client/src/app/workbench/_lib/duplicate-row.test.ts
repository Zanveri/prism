import { describe, expect, it } from "vitest";

import { duplicatePlan } from "./duplicate-row";
import type { EditTarget } from "./record-edits.schema";

type Column = EditTarget["columns"][number];
const column = (over: Partial<Column> = {}): Column => ({ table: 0, baseColumn: "x", editable: true, reason: null, nullable: true, generated: null, ...over });

/**
 * `loja.pedido` lido por `SELECT p.*, quantidade * 2 AS dobro`: `id` (a chave, `serial`, "por padrão"), `codigo`, `status`, `total` (calculada da tabela,
 * "sempre"), `foto` (binária), `nota` (tipo que o Prism não converte) e a calculada no comando.
 */
const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedido", key: [0], editable: true, reason: null }],
  columns: [
    column({ baseColumn: "id", nullable: false, generated: "byDefault" }),
    column({ baseColumn: "codigo", nullable: false }),
    column({ baseColumn: "status" }),
    column({ baseColumn: "total", editable: false, reason: "gerada pelo banco", generated: "always" }),
    column({ baseColumn: "foto", editable: false, reason: "coluna binária" }),
    column({ baseColumn: "nota", editable: false, reason: "o Prism ainda não edita este tipo neste banco" }),
    column({ table: null, baseColumn: null, editable: false, reason: "coluna calculada" }),
  ],
  rowOperations: true,
  oneAtATime: false,
};

/** A mesma tabela com a chave natural em `codigo`, que se copia. */
const naturalKey: EditTarget = { ...target, tables: [{ ...target.tables[0], key: [1] }] };

const row = ["7", "A-1", null, "14", "0x89", "(1,2)", "14"];

describe("o que \"Duplicar linha\" copia (RN-EDIT-016)", () => {
  it("de uma linha lida, o valor de cada coluna da tabela que se edita (o nulo, como nulo); as geradas e as que não se editam ficam com o padrão, e a calculada no comando não conta", () => {
    expect(duplicatePlan(target, { kind: "read", values: row })).toEqual({ values: { 1: "A-1", 2: null }, cut: [], skipped: [0, 3, 4, 5], key: null });
  });

  it("a chave copiada inteira vem na resposta, para o aviso e a célula ativa; a chave gerada pelo banco não é copiada inteira, e não pede aviso", () => {
    expect(duplicatePlan(naturalKey, { kind: "read", values: row }).key).toEqual([1]);
    expect(duplicatePlan(target, { kind: "read", values: row }).key).toBeNull();

    const composite: EditTarget = { ...naturalKey, tables: [{ ...naturalKey.tables[0], key: [2, 1] }] };
    expect(duplicatePlan(composite, { kind: "read", values: row }).key).toEqual([1, 2]);
    const partly: EditTarget = { ...naturalKey, tables: [{ ...naturalKey.tables[0], key: [0, 1] }] };
    expect(duplicatePlan(partly, { kind: "read", values: row }).key).toBeNull();
  });

  it("a célula cortada de uma coluna que se copia pede o valor completo; a de uma coluna que não se copia, não", () => {
    const plan = duplicatePlan(target, { kind: "read", values: row, truncated: new Set([2, 4]) });

    expect(plan.cut).toEqual([2]);
    expect(plan.values[2]).toBeNull();
  });

  it("na linha nova já salva, a coluna que o banco preencheu não se copia e vai para a lista", () => {
    expect(duplicatePlan(naturalKey, { kind: "read", values: row, generated: new Set([2]) })).toMatchObject({ values: { 1: "A-1" }, skipped: [0, 2, 3, 4, 5] });
  });

  it("de uma linha nova pendente, só o que foi preenchido: a coluna em branco já estava com o padrão e fica fora da lista; a preenchida que o banco gera, não se copia", () => {
    expect(duplicatePlan(naturalKey, { kind: "new", values: { 0: "99", 2: "paga" } })).toEqual({ values: { 2: "paga" }, cut: [], skipped: [0], key: null });
    expect(duplicatePlan(naturalKey, { kind: "new", values: { 1: "B-2", 2: null } })).toEqual({ values: { 1: "B-2", 2: null }, cut: [], skipped: [], key: [1] });
  });

  it("a coluna da tabela que o resultado traz duas vezes se copia uma vez só, pela primeira: o INSERT não leva a mesma coluna duas vezes", () => {
    // `SELECT codigo, codigo AS copia, status FROM pedido`, com a chave natural em `codigo`.
    const twice: EditTarget = {
      ...naturalKey,
      tables: [{ ...naturalKey.tables[0], key: [0] }],
      columns: [column({ baseColumn: "codigo", nullable: false }), column({ baseColumn: "codigo", nullable: false }), column({ baseColumn: "status" })],
    };

    expect(duplicatePlan(twice, { kind: "read", values: ["A-1", "A-1", "aberta"], truncated: new Set([1]) })).toEqual({ values: { 0: "A-1", 2: "aberta" }, cut: [], skipped: [], key: [0] });
    // Na linha nova de origem, a primeira preenchida.
    expect(duplicatePlan(twice, { kind: "new", values: { 1: "B-2" } })).toEqual({ values: { 1: "B-2" }, cut: [], skipped: [], key: null });
  });

  it("sem nenhuma coluna copiada, a duplicada é a linha em branco", () => {
    expect(duplicatePlan(naturalKey, { kind: "new", values: {} })).toEqual({ values: {}, cut: [], skipped: [], key: null });
  });
});
