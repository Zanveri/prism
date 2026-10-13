import { describe, expect, it } from "vitest";

import { cellAccess, deleteRowAccess, newRowAccess, type CellContext } from "./cell-editing";
import { cellMenu, type CellMenuState } from "./cell-menu";
import type { EditTarget } from "./record-edits.schema";
import { recordsCopy } from "./records.copy";

const copy = recordsCopy.edit;

const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedido", key: [0], editable: true, reason: null }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
    { table: 0, baseColumn: "total", editable: false, reason: "gerada pelo banco", nullable: true, generated: "always" },
    { table: 0, baseColumn: "anexo", editable: false, reason: "coluna binária", nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

const withoutKey: EditTarget = { ...target, tables: [{ ...target.tables[0], key: [], editable: false, reason: "pedido não tem chave primária nem chave única de colunas não nulas" }], columns: target.columns.map((column) => ({ ...column, editable: false, reason: "pedido não tem chave primária nem chave única de colunas não nulas" })), rowOperations: false };

const read = (column: number, over: Partial<Extract<CellContext["row"], { kind: "read" }>> = {}): CellContext => ({ readOnly: null, target, busy: false, column, row: { kind: "read", truncated: undefined, deleted: false, ...over } });

describe("o que uma célula permite editar (RN-EDIT-002)", () => {
  it("a coluna que se edita, numa linha lida inteira, se edita", () => {
    expect(cellAccess(read(1))).toEqual({ editable: true });
  });

  it("o resultado inteiro só leitura, a tabela sem chave, a coluna gerada e a binária dizem o motivo que a API deu", () => {
    expect(cellAccess({ ...read(1), readOnly: "união de consultas" })).toEqual({ editable: false, reason: copy.readOnly("união de consultas") });
    expect(cellAccess({ ...read(1), target: withoutKey })).toEqual({ editable: false, reason: copy.readOnly("pedido não tem chave primária nem chave única de colunas não nulas") });
    expect(cellAccess(read(2))).toEqual({ editable: false, reason: copy.readOnly("gerada pelo banco") });
    expect(cellAccess(read(3))).toEqual({ editable: false, reason: copy.readOnly("coluna binária") });
  });

  it("a célula cortada, a linha com a chave cortada e a linha marcada para exclusão não se editam", () => {
    expect(cellAccess(read(1, { truncated: new Set([1]) }))).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.truncated) });
    expect(cellAccess(read(1, { truncated: new Set([0]) }))).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.keyTruncated) });
    expect(cellAccess(read(1, { deleted: true }))).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.deleted) });
  });

  it("na linha nova se preenche o que a coluna deixa, e a coluna gerada não", () => {
    expect(cellAccess({ ...read(0), row: { kind: "new" } })).toEqual({ editable: true });
    expect(cellAccess({ ...read(2), row: { kind: "new" } })).toEqual({ editable: false, reason: copy.readOnly("gerada pelo banco") });
  });

  it("com um comando em andamento na aba nada se edita", () => {
    expect(cellAccess({ ...read(1), busy: true })).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.busy) });
  });

  it("linha nova e excluir linha só onde o resultado aceita; a linha com a chave cortada não se exclui", () => {
    expect(newRowAccess(null, target, false)).toEqual({ editable: true });
    expect(newRowAccess(null, withoutKey, false)).toEqual({ editable: false, reason: copy.readOnly("pedido não tem chave primária nem chave única de colunas não nulas") });
    expect(deleteRowAccess(read(1).row, null, target, false)).toEqual({ editable: true });
    expect(deleteRowAccess({ kind: "read", truncated: new Set([0]), deleted: false }, null, target, false)).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.keyTruncated) });
    expect(deleteRowAccess({ kind: "new" }, null, target, false)).toEqual({ editable: true });
  });
});

const menu = copy.menu;

const state = (over: Partial<CellMenuState> = {}): CellMenuState => ({ value: "aberta", access: { editable: true }, pending: false, deletedRow: false, nullable: true, newRow: { editable: true }, deleteRow: { editable: true }, ...over });

/** Os itens como a tela os mostra: o rótulo, se está desabilitado e o motivo. */
const shown = (groups: ReturnType<typeof cellMenu>) => groups.map((group) => group.map((item) => [item.label, item.disabled === true, item.hint ?? null]));

describe("o menu de contexto da célula", () => {
  it("numa célula que se edita: copiar, colar, editar e NULL habilitados; desfazer só com pendência; separador, linha nova e excluir", () => {
    expect(shown(cellMenu(state()))).toEqual([
      [
        [menu.copyValue, false, null],
        [menu.paste, false, null],
        [menu.edit, false, null],
        [menu.setNull, false, null],
        [menu.undo, true, null],
      ],
      [
        [menu.newRow, false, null],
        [menu.deleteRow, false, null],
      ],
    ]);
  });

  it("copiar leva o texto da célula, e o nulo copia vazio", () => {
    expect(cellMenu(state()).flat().find((item) => item.id === "copy")?.text).toBe("aberta");
    expect(cellMenu(state({ value: null })).flat().find((item) => item.id === "copy")?.text).toBe("");
  });

  it("numa célula pendente, ou numa linha marcada para exclusão, desfazer se habilita", () => {
    expect(cellMenu(state({ pending: true })).flat().find((item) => item.id === "undo")?.disabled).toBe(false);
    expect(cellMenu(state({ deletedRow: true, access: { editable: false, reason: "x" } })).flat().find((item) => item.id === "undo")?.disabled).toBe(false);
  });

  it("numa célula só leitura, colar, editar e NULL ficam desabilitados com o motivo; copiar continua", () => {
    const reason = copy.readOnly(copy.reasons.truncated);
    const items = cellMenu(state({ access: { editable: false, reason } })).flat();

    expect(items.filter((item) => ["paste", "edit", "setNull"].includes(item.id)).map((item) => [item.disabled, item.hint])).toEqual([
      [true, reason],
      [true, reason],
      [true, reason],
    ]);
    expect(items.find((item) => item.id === "copy")?.disabled).toBe(false);
  });

  it("a coluna que não aceita nulo desabilita só o NULL, com o motivo", () => {
    expect(cellMenu(state({ nullable: false })).flat().find((item) => item.id === "setNull")).toMatchObject({ disabled: true, hint: menu.notNullable });
  });

  it("numa tabela sem chave, linha nova e excluir ficam desabilitados com o motivo", () => {
    const reason = copy.readOnly("pedido não tem chave primária nem chave única de colunas não nulas");
    const items = cellMenu(state({ access: { editable: false, reason }, newRow: { editable: false, reason }, deleteRow: { editable: false, reason } })).flat();

    expect(items.filter((item) => item.id === "newRow" || item.id === "deleteRow").map((item) => [item.disabled, item.hint])).toEqual([
      [true, reason],
      [true, reason],
    ]);
  });

  it("os atalhos que a grade já trata vão à direita: F2 edita, Alt+Insert cria a linha", () => {
    const items = cellMenu(state()).flat();

    expect(items.find((item) => item.id === "edit")?.shortcut).toBe("F2");
    expect(items.find((item) => item.id === "newRow")?.shortcut).toBe("Alt+Insert");
  });
});
