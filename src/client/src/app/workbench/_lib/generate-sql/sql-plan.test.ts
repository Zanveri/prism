import { describe, expect, it } from "vitest";

import type { QueryColumn } from "../query.schema";
import type { SqlTarget } from "../record-edits.schema";
import type { SqlPlan, SqlRow } from "./generate-sql";
import { completeRows, cutCellsFor, neededColumns, optionRefusal, planRefusal, sqlMenuStates, sqlPlanOf, targetNameProblem, type SqlMenuContext } from "./sql-plan";

const result: QueryColumn[] = [
  { name: "id", type: "integer", kind: "number" },
  { name: "cliente", type: "text", kind: "text" },
  { name: "dobro", type: "integer", kind: "number" },
  { name: "total", type: "numeric", kind: "number" },
];

type Table = SqlTarget["tables"][number];
type TargetColumn = SqlTarget["columns"][number];

const targetColumn = (table: number | null, baseColumn: string | null, extra: Partial<TargetColumn> = {}): TargetColumn => ({ table, baseColumn, editable: true, reason: null, nullable: true, generated: null, ...extra });

const pedido: Table = { schema: "estoque", name: "pedido", key: [0], editable: true, reason: null, kind: "table", keyColumns: ["id"] };

const target = (extra: Partial<SqlTarget> = {}): SqlTarget => ({
  tables: [pedido],
  // `dobro` é calculada no comando (`id * 2`); `total` é gerada sempre pela tabela.
  columns: [targetColumn(0, "id", { generated: "byDefault" }), targetColumn(0, "nome"), targetColumn(null, null, { editable: false, reason: "coluna calculada" }), targetColumn(0, "total", { generated: "always", editable: false })],
  rowOperations: true,
  oneAtATime: false,
  ...extra,
});

const planOf = (sql: SqlTarget) => sqlPlanOf(1, result, { kind: "target", target: sql });

const row = (number: number, values: (string | null)[], extra: Partial<SqlRow> = {}): SqlRow => ({ number, values, read: values, changed: [], cut: [], generated: [], ...extra });

describe("o plano do resultado (RN-GRADE-006 e 020)", () => {
  it("de uma tabela só: as colunas dela pelo nome na tabela, sem a calculada, e a chave pelo keyColumns", () => {
    const plan = planOf(target());

    expect(plan.table).toEqual({ schema: "estoque", name: "pedido" });
    expect(plan.kind).toBe("table");
    expect(plan.columns.map((column) => [column.at, column.name, column.generated])).toEqual([
      [0, "id", "byDefault"],
      [1, "nome", null],
      [3, "total", "always"],
    ]);
    expect(plan.key).toEqual({ kind: "complete", columns: [0] });
  });

  it("a visão, a conexão somente leitura e o resultado que não se edita também são de uma tabela só: decide o tables, e não o rowOperations nem o editable", () => {
    const view = planOf(target({ tables: [{ ...pedido, kind: "view", keyColumns: [], editable: false, reason: "pedido é uma visão" }], rowOperations: false }));
    const readOnly = planOf(target({ tables: [{ ...pedido, editable: false, reason: "a conexão é somente leitura" }], rowOperations: false }));

    expect(view.table).toEqual({ schema: "estoque", name: "pedido" });
    expect(view.key).toEqual({ kind: "none" });
    expect(readOnly.key).toEqual({ kind: "complete", columns: [0] });
  });

  it("a chave que não está inteira no resultado diz o que falta, pelos nomes da tabela, sem olhar o key da edição", () => {
    const plan = planOf(target({ tables: [{ ...pedido, key: [], keyColumns: ["loja", "id", "numero"] }] }));

    expect(plan.key).toEqual({ kind: "partial", missing: ["loja", "numero"] });
    expect(planRefusal("selectEquals", plan)).toBe("Indisponível: a chave de pedido não está inteira no resultado: faltam loja, numero.");
    expect(planRefusal("insert", plan)).toBeNull();
    expect(planRefusal("create", plan)).toBeNull();
  });

  it("a coluna da tabela que aparece duas vezes no resultado entra uma vez, com a primeira", () => {
    const twice: QueryColumn[] = [result[0], { name: "copia", type: "integer", kind: "number" }];
    const plan = sqlPlanOf(1, twice, { kind: "target", target: target({ columns: [targetColumn(0, "id"), targetColumn(0, "id")] }) });

    expect(plan.columns.map((column) => [column.at, column.name])).toEqual([[0, "id"]]);
  });

  it("o sinônimo (other) usa as colunas pelo nome do resultado, sem baseColumn", () => {
    const plan = planOf(target({ tables: [{ ...pedido, kind: "other", keyColumns: [] }], columns: result.map(() => targetColumn(0, null)) }));

    expect(plan.columns.map((column) => column.name)).toEqual(["id", "cliente", "dobro", "total"]);
    expect(planRefusal("create", plan)).toBe("Indisponível: pedido não é uma tabela: o Prism só monta o DDL de tabelas.");
  });

  it("a tabela não conhecida: a junção, a aba guardada que leva a outra tabela e o resultado só leitura; só o INSERT vale, com todas as colunas do resultado", () => {
    const join = planOf(target({ tables: [pedido, { ...pedido, name: "cliente" }] }));
    const elsewhere = planOf(target({ tables: [{ ...pedido, kind: "elsewhere", keyColumns: [] }] }));
    const distinct = sqlPlanOf(1, result, { kind: "notEditable", reason: "DISTINCT" });

    expect([join.table, elsewhere.table, distinct.table]).toEqual([null, null, null]);
    expect(join.columns.map((column) => column.name)).toEqual(["id", "cliente", "dobro", "total"]);
    expect(planRefusal("update", join)).toBe("Só num resultado de uma tabela: num resultado de junção só se alteram células.");
    expect(planRefusal("create", elsewhere)).toBe("Só num resultado de uma tabela: pedido, escrita sem esquema, leva agora a outra tabela na sessão.");
    expect(planRefusal("delete", distinct)).toBe("Só num resultado de uma tabela: DISTINCT.");
    expect(planRefusal("insert", distinct)).toBeNull();
  });

  it("o UPDATE sem coluna fora da chave, a condição sem coluna que sirva, e o CREATE de uma visão", () => {
    const onlyKey = sqlPlanOf(1, [result[0]], { kind: "target", target: target({ columns: [targetColumn(0, "id")] }) });
    const json = sqlPlanOf(1, [{ name: "dados", type: "json", kind: "text" }], { kind: "target", target: target({ tables: [{ ...pedido, keyColumns: [] }], columns: [targetColumn(0, "dados")] }) });
    const view = planOf(target({ tables: [{ ...pedido, kind: "view", keyColumns: [] }] }));

    expect(planRefusal("update", onlyKey)).toBe("Indisponível: não há coluna fora da chave para atualizar.");
    expect(planRefusal("selectEquals", onlyKey)).toBeNull();
    expect(planRefusal("selectIn", json)).toBe("Indisponível: nenhuma coluna do resultado serve de condição.");
    expect(planRefusal("create", view)).toBe("Indisponível: pedido é uma visão: o Prism não monta o DDL de visões.");
  });
});

describe("os itens do submenu (RN-GRADE-006)", () => {
  const context = (extra: Partial<SqlMenuContext> = {}): SqlMenuContext => ({ gridRows: 3, savedRows: 1, newRows: 0, busy: false, plan: null, records: null, ...extra });

  it("habilitar não custa consulta: sem o plano, os seis valem", () => {
    expect(Object.values(sqlMenuStates(context()))).toEqual([null, null, null, null, null, null]);
  });

  it("sem linhas, ou só com linhas novas, os cinco primeiros ficam desabilitados, e o CREATE vale", () => {
    const empty = sqlMenuStates(context({ gridRows: 0, savedRows: 0 }));
    const onlyNew = sqlMenuStates(context({ savedRows: 0, newRows: 2 }));

    expect(empty.insert).toBe("O resultado não tem linhas.");
    expect(empty.create).toBeNull();
    expect(onlyNew.selectEquals).toBe("As linhas novas ainda não estão no banco: o Ver SQL mostra o INSERT delas.");
    expect(onlyNew.create).toBeNull();
  });

  it("a aba ocupada e a atualização automática desabilitam os seis", () => {
    expect(new Set(Object.values(sqlMenuStates(context({ busy: true }))))).toEqual(new Set(["Indisponível: há um comando em andamento na aba."]));
    expect(sqlMenuStates(context({ busy: "refresh" })).create).toBe("Indisponível: a atualização automática está lendo as linhas de novo; tente outra vez em um instante.");
  });

  it("o CREATE de uma visão dos Registros fica desabilitado desde o começo; com o plano, valem os motivos dele", () => {
    expect(sqlMenuStates(context({ records: { name: "resumo", kind: "view" } })).create).toBe("Indisponível: resumo é uma visão: o Prism não monta o DDL de visões.");
    const states = sqlMenuStates(context({ plan: sqlPlanOf(1, result, { kind: "notEditable", reason: "DISTINCT" }) }));
    expect(states.insert).toBeNull();
    expect(states.selectIn).toBe("Só num resultado de uma tabela: DISTINCT.");
  });
});

describe("os valores completos e as opções do diálogo (RN-SQL-017 e RN-GRADE-018)", () => {
  it("as colunas cujo valor cortado se busca são só as que o item usa", () => {
    const plan = planOf(target());

    expect(neededColumns("delete", plan)).toEqual([0]);
    expect(neededColumns("insert", plan)).toEqual([0, 1]);
    expect(neededColumns("update", plan)).toEqual([0, 1]);
  });

  it("as células cortadas que o item usa, e as linhas com o valor completo no lugar; o que não veio continua cortado", () => {
    const plan = planOf(target());
    const rows = [row(1, ["1", "Ana…", null, "2"], { cut: [1, 3] }), row(2, ["2", "Bia"], { read: ["2", "Bi…"], changed: [1], cut: [1] })];

    expect(cutCellsFor("insert", plan, rows).map(({ row: found, column }) => [found.number, column])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    const completed = completeRows(rows, (found, column) => (found.number === 1 && column === 1 ? "Ana Maria" : found.number === 2 ? "Bianca" : undefined));
    expect(completed[0]).toMatchObject({ values: ["1", "Ana Maria", null, "2"], read: ["1", "Ana Maria", null, "2"], cut: [3] });
    expect(completed[1]).toMatchObject({ values: ["2", "Bia"], read: ["2", "Bianca"], cut: [] });
  });

  it("a tabela de destino do INSERT da tabela não conhecida: obrigatória, até 128 caracteres, sem caractere de controle; e as colunas de mesmo nome", () => {
    const join = planOf(target({ tables: [pedido, { ...pedido, name: "cliente" }] }));
    const options = { qualified: true, compact: false, excludeGenerated: true };

    expect(optionRefusal("insert", join, options)).toBe("Informe a tabela de destino.");
    expect(optionRefusal("insert", join, { ...options, target: { schema: "", name: "copia" } })).toBeNull();
    expect(optionRefusal("insert", join, { ...options, target: { schema: "a\u0007", name: "copia" } })).toBe("O nome não pode ter caractere de controle.");
    expect(targetNameProblem("x".repeat(129), true)).toBe("O nome tem no máximo 128 caracteres.");
    expect(targetNameProblem("😀".repeat(128), true)).toBeNull();
    expect(targetNameProblem("", false)).toBeNull();

    const twice: SqlPlan = sqlPlanOf(1, [result[0], result[0]], { kind: "notEditable", reason: "DISTINCT" });
    expect(optionRefusal("insert", twice, { ...options, target: { schema: "", name: "copia" } })).toBe("O resultado tem duas colunas chamadas id: o INSERT seria recusado pelo banco.");
  });

  it("o INSERT de uma tabela conhecida sem coluna que não seja gerada pelo banco", () => {
    const plan = sqlPlanOf(1, [result[0]], { kind: "target", target: target({ columns: [targetColumn(0, "id", { generated: "byDefault" })] }) });

    expect(optionRefusal("insert", plan, { qualified: true, compact: false, excludeGenerated: true })).toBe("Indisponível: todas as colunas da tabela no resultado são geradas pelo banco.");
    expect(optionRefusal("insert", plan, { qualified: true, compact: false, excludeGenerated: false })).toBeNull();
    expect(optionRefusal("update", plan, { qualified: true, compact: false, excludeGenerated: true })).toBeNull();
  });
});
