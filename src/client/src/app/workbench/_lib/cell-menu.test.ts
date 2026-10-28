import { describe, expect, it } from "vitest";

import { cellAccess, columnHintsOf, deleteRowAccess, deleteRowsAccess, newRowAccess, resultReadOnly, type CellContext } from "./cell-editing";
import { autoRefreshMenuItem } from "./auto-refresh-menu";
import { cellMenu, copyAsFormats, type CellMenuItem, type CellMenuState } from "./cell-menu";
import { editShortcuts } from "./grid-editing";
import { gridSelectionCopy } from "./grid-selection.copy";
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
    // RN-GRADE-014: a execução da atualização automática tem o motivo dela: as linhas vão mudar.
    expect(cellAccess({ ...read(1), busy: "refresh" })).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.refreshing) });
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

const state = (over: Partial<CellMenuState> = {}): CellMenuState => ({ value: "aberta", access: { editable: true }, pending: false, deletedRow: false, nullable: true, newRow: { editable: true }, duplicateRow: { editable: true }, deleteRow: { editable: true }, ...over });

/** Os itens como a tela os mostra: o rótulo, se está desabilitado e o motivo. */
const shown = (groups: ReturnType<typeof cellMenu>) => groups.map((group) => group.map((item) => [item.label, item.disabled === true, item.hint ?? null]));

const grid = gridSelectionCopy.menu;
/** O submenu de um item, como a tela o mostra. */
const submenuOf = (groups: ReturnType<typeof cellMenu>, id: string) => groups.flat().find((item) => item.id === id)?.submenu?.groups.map((group) => (Array.isArray(group) ? group : group.items).map((item: CellMenuItem) => [item.label, item.disabled === true, item.hint ?? null]));

describe("o menu de contexto da célula", () => {
  it("numa célula que se edita, os grupos do DBeaver: o copiar e o colar; a edição; as linhas (RN-GRADE-004)", () => {
    expect(shown(cellMenu(state()))).toEqual([
      [
        [grid.copy, false, null],
        [grid.copyWithHeader, false, null],
        [grid.advanced, false, null],
        [menu.paste, false, null],
      ],
      [
        [menu.edit, false, null],
        [menu.setNull, false, null],
        [menu.undo, true, null],
      ],
      [
        [menu.newRow, false, null],
        [menu.duplicateRow, false, null],
        [menu.deleteRow, false, null],
      ],
    ]);
  });

  it("os grupos de quem os tem, na ordem: Filtrar, Ordenar e Ir para o registro referenciado; Exportar dados… e Gerar SQL; Atualizar e o automático", () => {
    const groups = cellMenu(
      state({
        filter: { id: "filter", label: "Filtrar", submenu: { label: "Filtrar", groups: [] } },
        sort: { direction: null, access: { editable: true } },
        follow: { editable: true },
        exportData: { editable: true },
        generateSql: {},
        refresh: { editable: true },
        autoRefresh: autoRefreshMenuItem({ status: "off", stopped: null }, null),
      }),
    );

    expect(groups.map((group) => group.map((item) => item.id))).toEqual([
      ["copy", "copyWithHeader", "advancedCopy", "paste"],
      ["filter", "sort", "follow"],
      ["edit", "setNull", "undo"],
      ["newRow", "duplicateRow", "deleteRow"],
      ["exportData", "generateSql"],
      ["refresh", "autoRefresh"],
    ]);
    expect(groups.flat().find((item) => item.id === "follow")?.label).toBe("Ir para o registro referenciado");
  });

  it("o \"Copiar avançado\" sem a outra frente tem os nomes e os números; com ela, o diálogo (Ctrl+Shift+C), os nove \"Copiar como\" e a configuração", () => {
    expect(submenuOf(cellMenu(state()), "advancedCopy")).toEqual([
      [
        [grid.columnNames, false, null],
        [grid.rowNumbers, false, null],
      ],
    ]);

    const groups = cellMenu(state({ copyAs: { dialog: { editable: true }, formats: { sql: { editable: false, reason: "Informe a tabela de destino." } }, configure: { editable: true } } }));
    const advanced = groups.flat().find((item) => item.id === "advancedCopy")!.submenu!.groups as CellMenuItem[][];
    expect(advanced.map((group) => group.map((item) => item.id))).toEqual([["copyAdvanced", "copyColumnNames", "copyRowNumbers"], copyAsFormats.map((format) => `copyAs:${format}`), ["copyAsConfigure"]]);
    expect(advanced[1].map((item) => item.label)).toEqual(["Copiar como CSV", "Copiar como Código fonte", "Copiar como DbUnit", "Copiar como HTML", "Copiar como JSON", "Copiar como Markdown", "Copiar como SQL", "Copiar como TXT", "Copiar como XML"]);
    expect(advanced[0][0].shortcut).toBe("Ctrl+Shift+C");
    expect(advanced[1][6]).toMatchObject({ disabled: true, hint: "Informe a tabela de destino." });
    expect(advanced[2][0].label).toBe("Configurar comandos 'Copiar como'…");
  });

  it("o \"Gerar SQL\" tem os seis itens do print, na ordem, com o motivo de cada um que não vale", () => {
    expect(submenuOf(cellMenu(state({ generateSql: { create: { editable: false, reason: "Indisponível: pedido é uma visão." } } })), "generateSql")).toEqual([
      [
        ["SELECT .. WHERE .. =", false, null],
        ["SELECT .. WHERE .. IN", false, null],
        ["INSERT", false, null],
        ["UPDATE", false, null],
        ["DELETE pela chave única", false, null],
        ["CREATE", true, "Indisponível: pedido é uma visão."],
      ],
    ]);
  });

  it("o \"Ordenar\" marca a ordem em uso da coluna; com a aba ocupada, os três dizem o motivo", () => {
    const sorted = cellMenu(state({ sort: { direction: "desc", access: { editable: true } } })).flat().find((item) => item.id === "sort")!.submenu!.groups[0] as CellMenuItem[];
    expect(sorted.map((item) => [item.label, item.checked])).toEqual([
      ["Crescente", false],
      ["Decrescente", true],
      ["Sem ordem", false],
    ]);
    const busy = cellMenu(state({ sort: { direction: null, access: { editable: false, reason: "ocupada" } } })).flat().find((item) => item.id === "sort")!.submenu!.groups[0] as CellMenuItem[];
    expect(busy.every((item) => item.disabled === true && item.hint === "ocupada")).toBe(true);
  });

  it("com mais de uma célula escolhida, \"Colar\" vale para uma só; com várias linhas, \"Duplicar linhas\" e \"Excluir linhas\"", () => {
    const items = cellMenu(state({ several: true, rows: 3 })).flat();

    expect(items.find((item) => item.id === "paste")).toMatchObject({ disabled: true, hint: "Vale para uma célula só: escolha uma." });
    // RN-EDIT-017: o "Definir como nulo" vale para as células escolhidas da coluna da ativa.
    expect(items.find((item) => item.id === "setNull")?.disabled).toBeFalsy();
    expect(items.find((item) => item.id === "edit")?.disabled).toBeFalsy();
    expect(items.find((item) => item.id === "duplicateRow")?.label).toBe("Duplicar linhas");
    expect(items.find((item) => item.id === "deleteRow")?.label).toBe("Excluir linhas");
  });

  it("sem célula ativa, \"Copiar\" e \"Copiar com cabeçalho\" pedem uma; no macOS o atalho é o do Cmd", () => {
    const items = cellMenu(state({ hasActive: false })).flat();
    expect(items.filter((item) => item.id === "copy" || item.id === "copyWithHeader").map((item) => [item.disabled, item.hint])).toEqual([
      [true, "Escolha uma célula na grade."],
      [true, "Escolha uma célula na grade."],
    ]);
    expect(cellMenu(state({ mac: true })).flat().find((item) => item.id === "copy")?.shortcut).toBe("Cmd+C");
    expect(cellMenu(state()).flat().find((item) => item.id === "copy")?.shortcut).toBe("Ctrl+C");
  });

  it("copiar leva o texto da célula, e o nulo copia vazio", () => {
    expect(cellMenu(state()).flat().find((item) => item.id === "copy")?.text).toBe("aberta");
    expect(cellMenu(state({ value: null })).flat().find((item) => item.id === "copy")?.text).toBe("");
  });

  it("com o que desfazer nas células escolhidas, ou numa linha escolhida marcada para exclusão, desfazer se habilita", () => {
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

  it("o \"Atualizar automaticamente\" (RN-GRADE-014) vem logo depois do \"Atualizar\" (F5), no último grupo, como veio", () => {
    const auto = autoRefreshMenuItem({ status: "off", stopped: null }, "writes");
    const groups = cellMenu(state({ refresh: { editable: true }, autoRefresh: auto }));

    expect(groups[groups.length - 1].map((item) => item.id)).toEqual(["refresh", "autoRefresh"]);
    expect(groups[groups.length - 1][1]).toBe(auto);
    expect(cellMenu(state()).flat().some((item) => item.id === "autoRefresh")).toBe(false);
  });

  it("\"Exportar dados…\" (RN-EXPORT-001) vem no grupo do \"Gerar SQL\", depois dos itens da linha; o que não se aplica vem desabilitado com o motivo", () => {
    const groups = cellMenu(state({ refresh: { editable: true }, exportData: { editable: true } }));

    expect(groups.map((group) => group.map((item) => item.id))).toEqual([["copy", "copyWithHeader", "advancedCopy", "paste"], ["edit", "setNull", "undo"], ["newRow", "duplicateRow", "deleteRow"], ["exportData"], ["refresh"]]);
    expect(shown([groups[3]])).toEqual([[["Exportar dados…", false, null]]]);
    expect(shown([cellMenu(state({ exportData: { editable: false, reason: "Não há resultado para exportar." } }))[3]])).toEqual([[["Exportar dados…", true, "Não há resultado para exportar."]]]);
    // A grade sem a entrada (quem não a passa) não tem o item.
    expect(cellMenu(state()).flat().some((item) => item.id === "exportData")).toBe(false);
  });

  it("os atalhos que a grade trata vão à direita: F2 edita, Alt+Insert adiciona a linha, Alt+Delete a exclui (RN-EDIT-015)", () => {
    const items = cellMenu(state()).flat();

    expect(items.find((item) => item.id === "edit")?.shortcut).toBe("F2");
    expect(items.find((item) => item.id === "newRow")?.shortcut).toBe("Alt+Insert");
    expect(items.find((item) => item.id === "deleteRow")?.shortcut).toBe("Alt+Delete");
  });

  it("no macOS o menu escreve os atalhos com o Option, como as dicas da barra de edição", () => {
    const items = cellMenu(state({ shortcuts: editShortcuts("MacIntel") })).flat();

    expect(items.find((item) => item.id === "newRow")?.shortcut).toBe("Option+Insert");
    expect(items.find((item) => item.id === "deleteRow")?.shortcut).toBe("Option+Delete");
  });

  it("\"Excluir linha\" na linha já marcada para exclusão fica desabilitado, com o motivo (RN-EDIT-014), também antes de o catálogo responder", () => {
    const deleted = { kind: "read" as const, truncated: undefined, deleted: true };
    const reason = copy.readOnly(copy.reasons.alreadyDeleted);

    expect(deleteRowAccess(deleted, null, target, false)).toEqual({ editable: false, reason });
    expect(deleteRowAccess(deleted, null, null, false)).toEqual({ editable: false, reason });
    expect(reason).toBe("Somente leitura: a linha já está marcada para exclusão; Desfazer alteração a devolve.");
    // O que vem antes na ordem dos motivos fica na frente: o resultado só leitura, a aba ocupada, a junção.
    expect(deleteRowAccess(deleted, "DISTINCT", target, false)).toEqual({ editable: false, reason: copy.readOnly("DISTINCT") });
    expect(deleteRowAccess(deleted, null, target, true)).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.busy) });
  });
});

describe("\"Excluir linhas\" sobre as linhas da seleção (RN-EDIT-014)", () => {
  const lido = (over: Partial<Extract<CellContext["row"], { kind: "read" }>> = {}) => ({ kind: "read" as const, truncated: undefined, deleted: false, ...over });

  it("com uma linha só, é o \"Excluir linha\" de sempre, com as frases dele", () => {
    expect(deleteRowsAccess([{ number: 3, row: lido({ truncated: new Set([0]) }) }], null, target, false)).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.keyTruncated) });
  });

  it("a primeira linha cuja chave não se sabe, na ordem da grade, diz o motivo com o número dela, e nada é excluído", () => {
    const rows = [
      { number: 2, row: lido() },
      { number: 7, row: lido({ truncated: new Set([0]) }) },
      { number: 9, row: lido({ generated: new Set([0]) }) },
    ];
    expect(deleteRowsAccess(rows, null, target, false)).toEqual({ editable: false, reason: copy.readOnly("a chave da linha 7 chegou cortada") });
    expect(deleteRowsAccess([rows[0], rows[2]], null, target, false)).toEqual({ editable: false, reason: copy.readOnly("a chave da linha 9 foi gerada pelo banco; execute de novo para editá-la") });
    // Sem o alvo a chave não se sabe ainda: a primeira tentativa pergunta.
    expect(deleteRowsAccess(rows, null, null, false)).toEqual({ editable: true });
  });

  it("a linha já marcada não impede (fica como está); com todas já marcadas, o motivo diz isso, no plural", () => {
    expect(deleteRowsAccess([{ number: 1, row: lido({ deleted: true, truncated: new Set([0]) }) }, { number: 2, row: { kind: "new" } }], null, target, false)).toEqual({ editable: true });
    expect(deleteRowsAccess([{ number: 1, row: lido({ deleted: true }) }, { number: 2, row: lido({ deleted: true }) }], null, target, false)).toEqual({ editable: false, reason: copy.readOnly("as linhas já estão marcadas para exclusão; Desfazer alteração as devolve") });
  });

  it("o que vem antes na ordem dos motivos fica na frente: o resultado só leitura, a aba ocupada, a junção", () => {
    expect(deleteRowsAccess([{ number: 1, row: lido() }, { number: 2, row: lido() }], "DISTINCT", target, false)).toEqual({ editable: false, reason: copy.readOnly("DISTINCT") });
    expect(deleteRowsAccess([{ number: 1, row: lido() }, { number: 2, row: lido() }], null, target, true)).toEqual({ editable: false, reason: copy.readOnly(copy.reasons.busy) });
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
  it("Editar célula, Definir como nulo, Adicionar linha (seção 33: era \"Linha nova\"), Excluir linha e Desfazer alteração", () => {
    expect([menu.edit, menu.setNull, menu.newRow, menu.deleteRow, menu.undo]).toEqual(["Editar célula", "Definir como nulo", "Adicionar linha", "Excluir linha", "Desfazer alteração"]);
  });
});

describe("o menu com várias células escolhidas na coluna e com a coluna inteira (RN-EDIT-017 e 018)", () => {
  it("\"Editar célula\" e \"Definir como nulo\" seguem o que vale para o grupo, e o nulo diz para quantas", () => {
    const cells = cellMenu(state({ several: true, group: { access: { editable: true }, nullLabel: "Definir as 37 células como nulo" } })).flat();
    expect(cells.find((item) => item.id === "setNull")).toMatchObject({ label: "Definir as 37 células como nulo" });
    expect(cells.find((item) => item.id === "setNull")?.disabled).toBeFalsy();

    const unavailable = { editable: false as const, reason: "Indisponível: o comando sorteia as linhas, e o banco escolheria outras ao executar de novo: escolha as células da coluna." };
    const whole = cellMenu(state({ several: true, group: { access: unavailable, nullLabel: "Definir a coluna inteira como nulo" } })).flat();
    expect(whole.find((item) => item.id === "edit")).toMatchObject({ disabled: true, hint: unavailable.reason });
    expect(whole.find((item) => item.id === "setNull")).toMatchObject({ label: "Definir a coluna inteira como nulo", disabled: true, hint: unavailable.reason });
  });

  it("o \"Desfazer alteração\" diz a conta com a coluna inteira, e fica desabilitado com o motivo quando só ela vale nas células escolhidas", () => {
    expect(cellMenu(state({ pending: true, undo: { label: "Desfazer a alteração da coluna preco e de 37 células" } })).flat().find((item) => item.id === "undo")).toMatchObject({ label: "Desfazer a alteração da coluna preco e de 37 células", disabled: false });
    const only = cellMenu(state({ pending: false, undo: { reason: "A alteração desta coluna vale para todas as linhas: escolha a coluna inteira, pelo cabeçalho, para desfazê-la." } })).flat().find((item) => item.id === "undo");
    expect(only).toMatchObject({ label: "Desfazer alteração", disabled: true, hint: "A alteração desta coluna vale para todas as linhas: escolha a coluna inteira, pelo cabeçalho, para desfazê-la." });
  });

  it("inclui 'Visualizar valor' (F7) no grupo da célula quando viewValue é informado, mesmo em resultado somente leitura", () => {
    const items = cellMenu(state({ access: { editable: false, reason: "somente leitura" }, viewValue: { editable: true } })).flat();
    expect(items.find((item) => item.id === "viewValue")).toEqual({
      id: "viewValue",
      label: "Visualizar valor",
      shortcut: "F7",
      disabled: false,
    });
  });
});
