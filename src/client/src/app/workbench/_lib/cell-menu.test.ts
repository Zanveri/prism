import { describe, expect, it } from "vitest";

import { cellAccess, columnHintsOf, deleteRowAccess, newRowAccess, resultReadOnly, type CellContext } from "./cell-editing";
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

/** `pedido p JOIN cliente c JOIN item i`: a chave de pedido em 0, a de cliente em 2; item fica só leitura. */
const join: EditTarget = {
  tables: [
    { schema: "loja", name: "pedido", key: [0], editable: true, reason: null },
    { schema: "loja", name: "cliente", key: [2], editable: true, reason: null },
    { schema: "loja", name: "item", key: [], editable: false, reason: "a chave de item não está inteira no resultado: faltam id" },
  ],
  columns: [
    { table: 0, baseColumn: "id", editable: false, reason: "coluna da chave numa junção", nullable: false, generated: null },
    { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
    { table: 1, baseColumn: "id", editable: false, reason: "coluna da chave numa junção", nullable: false, generated: null },
    { table: 1, baseColumn: "nome", editable: true, reason: null, nullable: true, generated: null },
    { table: 2, baseColumn: "codigo", editable: false, reason: "a chave de item não está inteira no resultado: faltam id", nullable: true, generated: null },
    { table: null, baseColumn: null, editable: false, reason: "coluna calculada", nullable: true, generated: null },
  ],
  rowOperations: false,
  oneAtATime: false,
};

const inJoin = (column: number, over: Partial<Extract<CellContext["row"], { kind: "read" }>> = {}): CellContext => ({ readOnly: null, target: join, busy: false, column, row: { kind: "read", truncated: undefined, deleted: false, values: ["1", "aberta", "7", "Ana", "x", "2"], ...over } });

describe("o que se edita num resultado de junção (RN-EDIT-002)", () => {
  it("cada coluna vale na tabela de onde veio: a tabela só leitura não impede as outras, e a chave e a calculada não se editam", () => {
    expect(cellAccess(inJoin(1))).toEqual({ editable: true });
    expect(cellAccess(inJoin(3))).toEqual({ editable: true });
    expect(cellAccess(inJoin(4))).toEqual({ editable: false, reason: copy.readOnly("a chave de item não está inteira no resultado: faltam id") });
    expect(cellAccess(inJoin(2))).toEqual({ editable: false, reason: copy.readOnly("coluna da chave numa junção") });
    expect(cellAccess(inJoin(5))).toEqual({ editable: false, reason: copy.readOnly("coluna calculada") });
  });

  it("numa junção externa sem linha (a chave veio nula), as células daquela tabela são só leitura; a chave cortada vale por tabela", () => {
    const missing = inJoin(3, { values: ["1", "aberta", null, null, "x", "2"] });

    expect(cellAccess(missing)).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.noRowHere("cliente")) });
    expect(cellAccess({ ...missing, column: 1 })).toEqual({ editable: true });
    expect(cellAccess(inJoin(3, { truncated: new Set([2]) }))).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.keyTruncated) });
    expect(cellAccess(inJoin(1, { truncated: new Set([2]) }))).toEqual({ editable: true });
  });

  it("linha nova e excluir linha ficam desabilitados, com o motivo", () => {
    expect(newRowAccess(null, join, false)).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.joinRowOperations) });
    expect(deleteRowAccess(inJoin(1).row, null, join, false)).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.joinRowOperations) });
  });

  it("a barra diz só leitura quando nenhuma tabela se edita, com o motivo de cada uma; numa tabela só, o motivo dela", () => {
    const none: EditTarget = { ...join, tables: join.tables.map((table, index) => (index === 2 ? table : { ...table, editable: false, reason: `${table.name} é uma visão` })) };

    expect(resultReadOnly(null, join)).toBeNull();
    expect(resultReadOnly(null, none)).toBe(copy.readOnly("pedido é uma visão; cliente é uma visão; a chave de item não está inteira no resultado: faltam id"));
    expect(resultReadOnly(null, withoutKey)).toBe(copy.readOnly("pedido não tem chave primária nem chave única de colunas não nulas"));
    expect(resultReadOnly("união de consultas", null)).toBe(copy.readOnly("união de consultas"));
    expect(resultReadOnly(null, target)).toBeNull();
  });

  it("a dica do cabeçalho diz o motivo da coluna que não se edita e, na junção, a tabela e a coluna que a editável altera", () => {
    expect(columnHintsOf(join)).toEqual([
      copy.readOnly("coluna da chave numa junção"),
      copy.editsColumn("pedido", "status"),
      copy.readOnly("coluna da chave numa junção"),
      copy.editsColumn("cliente", "nome"),
      copy.readOnly("a chave de item não está inteira no resultado: faltam id"),
      copy.readOnly("coluna calculada"),
    ]);
    expect(columnHintsOf(target)).toEqual([null, null, copy.readOnly("gerada pelo banco"), copy.readOnly("coluna binária")]);
    expect(columnHintsOf(null)).toBeNull();
  });
});

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

describe("a linha nova depois do Salvar, com o que o banco preencheu (RN-EDIT-009)", () => {
  it("a célula que o banco preencheu não se edita, com o motivo: o valor dela a tela não sabe", () => {
    expect(cellAccess(read(1, { generated: new Set([1]) }))).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.generated) });
    expect(cellAccess(read(1, { generated: new Set([3]) }))).toEqual({ editable: true });
  });

  it("com a chave preenchida pelo banco, a linha não se acha: nenhuma célula dela se edita, e ela não se exclui", () => {
    const row = { kind: "read" as const, truncated: undefined, deleted: false, generated: new Set([0]) };

    expect(cellAccess(read(1, { generated: new Set([0]) }))).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.keyGenerated) });
    expect(deleteRowAccess(row, null, target, false)).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.keyGenerated) });
  });
});

describe("os rótulos do menu da célula são os da especificação (RN-EDIT-001)", () => {
  it("Editar célula, Definir como nulo, Linha nova, Excluir linha e Desfazer alteração", () => {
    expect([menu.edit, menu.setNull, menu.newRow, menu.deleteRow, menu.undo]).toEqual(["Editar célula", "Definir como nulo", "Linha nova", "Excluir linha", "Desfazer alteração"]);
  });
});
