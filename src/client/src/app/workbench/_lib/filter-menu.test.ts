import { describe, expect, it } from "vitest";

import { cellMenu, type CellMenuGroup, type CellMenuItem, type CellMenuState } from "./cell-menu";
import { customPlan, filterMenuItem, filterPlan, isFilterAction, valueListCap, valuesPlan, visibleValues, type FilterMenuContext } from "./filter-menu";
import type { QueryColumn } from "./query.schema";

// RN-GRADE-013: o submenu "Filtrar" (F11) do menu da célula, o que cada item faz e quando não se aplica.
const code: QueryColumn = { name: "code", type: "varchar", kind: "text" };
const qtd: QueryColumn = { name: "qtd", type: "int4", kind: "number" };
const foto: QueryColumn = { name: "foto", type: "bytea", kind: "binary" };

const context = (over: Partial<FilterMenuContext> = {}): FilterMenuContext => ({ engine: 1, column: code, cell: { kind: "read", value: "11.901", truncated: false }, field: "", removable: false, busy: false, ...over });

const items = (group: CellMenuGroup) => (Array.isArray(group) ? group : group.items);
/** O submenu como a tela o mostra: o título de cada grupo (ou nada) e, de cada item, o rótulo, se está desabilitado e o motivo. */
function shown(item: CellMenuItem) {
  return item.submenu!.groups.map((group) => ({ title: Array.isArray(group) ? null : group.label, items: items(group).map((entry) => [entry.id, entry.label, entry.disabled === true, entry.hint ?? null]) }));
}

describe("filterMenuItem: o item “Filtrar” (F11) e o submenu dele", () => {
  it("o item abre um submenu, com o atalho F11", () => {
    expect(filterMenuItem(context())).toMatchObject({ id: "filter", label: "Filtrar", shortcut: "F11", disabled: false, submenu: { label: "Filtrar" } });
  });

  it("numa célula de texto: “Filtrar por valor…” (Ctrl+F11), o valor da célula, o personalizado e remover tudo, com a condição como rótulo", () => {
    expect(shown(filterMenuItem(context({ removable: true })))).toEqual([
      { title: null, items: [["filter:byValue", "Filtrar por valor…", false, null]] },
      {
        title: "Valor da célula",
        items: [
          ["filter:cell:eq", `"code" = '11.901'`, false, null],
          ["filter:cell:ne", `"code" <> '11.901'`, false, null],
          ["filter:cell:gt", `"code" > '11.901'`, false, null],
          ["filter:cell:lt", `"code" < '11.901'`, false, null],
          ["filter:cell:like", `"code" LIKE '%11.901%'`, false, null],
          ["filter:cell:isNull", `"code" IS NULL`, false, null],
          ["filter:cell:isNotNull", `"code" IS NOT NULL`, false, null],
        ],
      },
      {
        title: "Personalizado",
        items: [
          ["filter:custom:eq", `"code" = …`, false, null],
          ["filter:custom:ne", `"code" <> …`, false, null],
          ["filter:custom:gt", `"code" > …`, false, null],
          ["filter:custom:lt", `"code" < …`, false, null],
        ],
      },
      { title: null, items: [["filter:clear", "Remover todos os filtros e ordenações", false, null]] },
    ]);
    expect(items(filterMenuItem(context()).submenu!.groups[0])[0].shortcut).toBe("Ctrl+F11");
  });

  it("o `contém` só existe em coluna de texto", () => {
    const ids = shown(filterMenuItem(context({ column: qtd, cell: { kind: "read", value: "42", truncated: false } })))[1].items.map(([id]) => id);
    expect(ids).toEqual(["filter:cell:eq", "filter:cell:ne", "filter:cell:gt", "filter:cell:lt", "filter:cell:isNull", "filter:cell:isNotNull"]);
  });

  it("célula cortada ou binária: só os de nulo e o personalizado; as comparações dizem por quê", () => {
    for (const [over, reason] of [
      [{ cell: { kind: "read", value: "começo…", truncated: true } }, "Não se aplica: o valor chegou cortado, e a tela não o tem inteiro."],
      [{ column: foto, cell: { kind: "read", value: "\\x00ff", truncated: false } }, "Não se aplica: a coluna é binária."],
    ] as const) {
      const groups = shown(filterMenuItem(context(over)));
      const cellGroup = groups[1].items;

      expect(cellGroup.filter(([id]) => id !== "filter:cell:isNull" && id !== "filter:cell:isNotNull").every(([, , disabled, hint]) => disabled && hint === reason)).toBe(true);
      expect(cellGroup.filter(([id]) => id === "filter:cell:isNull" || id === "filter:cell:isNotNull").every(([, , disabled]) => !disabled)).toBe(true);
      expect(groups[2].items.every(([, , disabled]) => !disabled)).toBe(true);
    }
    // A coluna binária não tem valores para escolher no diálogo.
    expect(shown(filterMenuItem(context({ column: foto })))[0].items[0]).toEqual(["filter:byValue", "Filtrar por valor…", true, "Não se aplica: a coluna é binária."]);
  });

  it("célula nula: o rótulo das comparações tem o lugar do valor, e o motivo", () => {
    const [eq] = shown(filterMenuItem(context({ cell: { kind: "read", value: null, truncated: false } })))[1].items;
    expect(eq).toEqual(["filter:cell:eq", `"code" = (valor da célula)`, true, "Não se aplica: a célula é nula."]);
  });

  it("na linha nova, que ainda não está no banco, as comparações com o valor não se aplicam; os de nulo e o personalizado sim", () => {
    const groups = shown(filterMenuItem(context({ cell: { kind: "new" } })));
    expect(groups[1].items.map(([id, , disabled, hint]) => [id, disabled, hint])).toEqual([
      ["filter:cell:eq", true, "Não se aplica: a linha nova ainda não está no banco."],
      ["filter:cell:ne", true, "Não se aplica: a linha nova ainda não está no banco."],
      ["filter:cell:gt", true, "Não se aplica: a linha nova ainda não está no banco."],
      ["filter:cell:lt", true, "Não se aplica: a linha nova ainda não está no banco."],
      ["filter:cell:like", true, "Não se aplica: a linha nova ainda não está no banco."],
      ["filter:cell:isNull", false, null],
      ["filter:cell:isNotNull", false, null],
    ]);
  });

  it("com o campo que não aceita outra condição com segurança, o que junta fica desabilitado, com o motivo; remover tudo continua", () => {
    for (const [field, reason] of [
      ["status = 'aberta", "Não se aplica: o filtro do campo deixa aspas ou um comentário abertos."],
      ["a = 1; DROP TABLE t", "Não se aplica: o filtro do campo tem mais de um comando."],
    ]) {
      const groups = shown(filterMenuItem(context({ field, removable: true })));
      expect(groups.slice(0, 3).flatMap((group) => group.items).every(([, , disabled, hint]) => disabled && hint === reason), field).toBe(true);
      expect(groups[3].items[0][2]).toBe(false);
    }
  });

  it("com algo em andamento na aba, nada se aplica, e diz por quê", () => {
    const groups = shown(filterMenuItem(context({ busy: true, removable: true })));
    expect(groups.flatMap((group) => group.items).every(([, , disabled, hint]) => disabled && hint === "Não se aplica: há um comando em andamento na aba.")).toBe(true);
  });

  it("“Remover todos” só vale com filtro ou ordem, em vigor ou no campo", () => {
    expect(shown(filterMenuItem(context()))[3].items[0]).toEqual(["filter:clear", "Remover todos os filtros e ordenações", true, "Não se aplica: não há filtro nem ordem."]);
  });
});

describe("filterPlan: o que cada escolha faz", () => {
  it("o valor da célula junta ao campo, por AND e entre parênteses, com a ordem no fim", () => {
    expect(filterPlan(context(), "filter:cell:eq")).toEqual({ kind: "apply", text: `"code" = '11.901'` });
    expect(filterPlan(context({ field: `status = 'aberta' ORDER BY "id" DESC` }), "filter:cell:ne")).toEqual({ kind: "apply", text: `(status = 'aberta') AND ("code" <> '11.901') ORDER BY "id" DESC` });
    expect(filterPlan(context(), "filter:cell:like")).toEqual({ kind: "apply", text: `"code" LIKE '%11.901%' ESCAPE '!'` });
    expect(filterPlan(context({ cell: { kind: "new" } }), "filter:cell:isNull")).toEqual({ kind: "apply", text: `"code" IS NULL` });
  });

  it("o personalizado pede o valor; o diálogo abre; remover tudo limpa", () => {
    expect(filterPlan(context(), "filter:custom:gt")).toEqual({ kind: "custom", operator: "gt" });
    expect(filterPlan(context(), "filter:byValue")).toEqual({ kind: "values" });
    expect(filterPlan(context({ removable: true }), "filter:clear")).toEqual({ kind: "clear" });
  });

  it("o que não se aplica não faz nada (o menu era de antes: a aba ficou ocupada, a célula é nula, o campo mudou)", () => {
    expect(filterPlan(context({ busy: true }), "filter:cell:eq")).toBeNull();
    expect(filterPlan(context({ cell: { kind: "read", value: null, truncated: false } }), "filter:cell:eq")).toBeNull();
    expect(filterPlan(context({ cell: { kind: "new" } }), "filter:cell:eq")).toBeNull();
    expect(filterPlan(context({ field: "a = 'x" }), "filter:cell:eq")).toBeNull();
    expect(filterPlan(context(), "filter:clear")).toBeNull();
    expect(filterPlan(context({ column: foto }), "filter:byValue")).toBeNull();
  });

  it("isFilterAction separa as ações do Filtrar das da edição", () => {
    expect(isFilterAction("filter:cell:eq")).toBe(true);
    expect(isFilterAction("filter")).toBe(false);
    expect(isFilterAction("copy")).toBe(false);
  });
});

describe("customPlan e valuesPlan: o personalizado com o valor escrito e os valores marcados", () => {
  it("o valor escrito vira literal e junta ao campo", () => {
    expect(customPlan(context({ field: "x > 1" }), "eq", "O'Brien")).toEqual({ kind: "apply", text: `(x > 1) AND ("code" = 'O''Brien')` });
    expect(customPlan(context({ column: qtd }), "lt", "10")).toEqual({ kind: "apply", text: `"qtd" < 10` });
  });

  it("o valor que não vira literal diz o problema, para o campo pequeno mostrar", () => {
    expect(customPlan(context(), "eq", "a\tb")).toEqual({ problem: "O valor não pode ter tabulação nem outro caractere de controle." });
  });

  it("os valores marcados: IN, = ou IS NULL por OR, juntos ao campo; sem nada marcado, nada", () => {
    expect(valuesPlan(context(), ["a", "b", null])).toEqual({ kind: "apply", text: `"code" IN ('a', 'b') OR "code" IS NULL` });
    expect(valuesPlan(context({ field: "x > 1" }), ["a"])).toEqual({ kind: "apply", text: `(x > 1) AND ("code" = 'a')` });
    expect(valuesPlan(context(), [])).toBeNull();
  });
});

describe("visibleValues: o que o diálogo “Filtrar por valor…” mostra para a busca", () => {
  const values = [
    { value: "Aberta", count: 5, usable: true },
    { value: "fechada", count: 3, usable: true },
    { value: null, count: 2, usable: true },
    { value: "ABERTURA", count: 1, usable: true },
  ];

  it("sem busca, todos, na ordem da lista, com a posição de cada um", () => {
    expect(visibleValues(values, "")).toEqual({ entries: values.map((value, index) => ({ index, value })), total: 4 });
  });

  it("a busca acha o texto em qualquer parte, sem diferença de maiúsculas; o nulo se acha por “null”", () => {
    expect(visibleValues(values, " aber ").entries.map((entry) => entry.index)).toEqual([0, 3]);
    expect(visibleValues(values, "null").entries.map((entry) => entry.index)).toEqual([2]);
    expect(visibleValues(values, "zzz")).toEqual({ entries: [], total: 0 });
  });

  it("desenha no máximo 500, e diz quantos casaram", () => {
    const many = Array.from({ length: 1200 }, (_, index) => ({ value: `v${index}`, count: 1, usable: true }));
    const shown = visibleValues(many, "");

    expect(shown.entries).toHaveLength(valueListCap);
    expect(shown.total).toBe(1200);
  });
});

describe("cellMenu com o Filtrar e o Atualizar (RN-GRADE-013 e RN-GRADE-012)", () => {
  const state = (over: Partial<CellMenuState> = {}): CellMenuState => ({ value: "11.901", access: { editable: true }, pending: false, deletedRow: false, nullable: true, newRow: { editable: true }, duplicateRow: { editable: true }, deleteRow: { editable: true }, ...over });

  it("o Filtrar (F11) e o Atualizar (F5) entram num grupo depois dos de célula, antes de adicionar, duplicar e excluir linha", () => {
    const groups = cellMenu(state({ filter: filterMenuItem(context()), refresh: { editable: true } }));

    expect(groups.map((group) => group.map((item) => item.id))).toEqual([["copy", "paste", "edit", "setNull", "undo"], ["filter", "refresh"], ["newRow", "duplicateRow", "deleteRow"]]);
    expect(groups[1].map((item) => [item.label, item.shortcut, item.disabled === true])).toEqual([
      ["Filtrar", "F11", false],
      ["Atualizar", "F5", false],
    ]);
  });

  it("com algo em andamento, o Atualizar fica desabilitado com o motivo", () => {
    const [, view] = cellMenu(state({ refresh: { editable: false, reason: "Não se aplica: há um comando em andamento na aba." } }));
    expect(view[0]).toMatchObject({ id: "refresh", disabled: true, hint: "Não se aplica: há um comando em andamento na aba." });
  });

  it("sem os dois, o menu é o de antes", () => {
    expect(cellMenu(state()).map((group) => group.map((item) => item.id))).toEqual([["copy", "paste", "edit", "setNull", "undo"], ["newRow", "duplicateRow", "deleteRow"]]);
  });
});
