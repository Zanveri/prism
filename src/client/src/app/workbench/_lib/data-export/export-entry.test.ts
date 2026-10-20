import { describe, expect, it } from "vitest";

import type { RowsState, RunnerState } from "../use-query-runner";
import { exportBlocker, exportRows, recordsSource, resultSource, runnerExportBlocker } from "./export-entry";
import { initialChecked } from "./export-source";

const rows: RowsState = {
  status: "rows",
  id: 1,
  target: { sql: 'SELECT * FROM "estoque"."pedido" WHERE id > 1', offset: 0, filter: "cliente = 'Ana'" },
  columns: [
    { name: "id", type: "int4", kind: "number" },
    { name: "cliente", type: "text", kind: "text" },
  ],
  rows: [["1", "Ana"]],
  truncated: new Map(),
  hasMore: true,
  totalRows: null,
  elapsedMs: 3,
  pages: 1,
  loadingMore: false,
  cancelling: false,
  cursorClosed: false,
  total: null,
  counting: false,
  read: true,
};

describe("quando o \"Exportar…\" vale (RN-EXPORT-001)", () => {
  it("com o resultado de uma leitura na tela, e a aba livre, vale", () => {
    expect(exportBlocker(rows, { busy: false })).toBeNull();
  });

  it("sem resultado (antes da primeira execução, nas linhas afetadas, no erro): \"Não há resultado para exportar.\"", () => {
    expect(exportBlocker(null, { busy: false })).toBe("Não há resultado para exportar.");
    for (const state of [{ status: "idle" }, { status: "affected", rowsAffected: 3, elapsedMs: 1 }, { status: "error", source: "database", title: "Erro", message: "x", sqlState: null, errorAt: null }] as RunnerState[]) {
      expect(runnerExportBlocker(state, { busy: false })).toBe("Não há resultado para exportar.");
    }
  });

  it("o comando que não é só de leitura, o que gravou e devolveu linhas (RN-SQL-013), e a página que não disse: o motivo da RN-EXPORT-002", () => {
    const reason = "Exportar executaria o comando de novo, e ele não é só de leitura.";
    expect(exportBlocker({ ...rows, read: false }, { busy: false })).toBe(reason);
    expect(exportBlocker({ ...rows, totalRows: 4, hasMore: false }, { busy: false })).toBe(reason);
    // Na dúvida, não é leitura.
    expect(exportBlocker({ ...rows, read: null }, { busy: false })).toBe(reason);
    expect(exportBlocker({ ...rows, read: undefined }, { busy: false })).toBe(reason);
  });

  it("a aba ocupada vem antes do resultado, e as Estatísticas à frente antes de tudo", () => {
    expect(exportBlocker(rows, { busy: true })).toBe("Há um comando em andamento na aba.");
    expect(exportBlocker(null, { busy: true })).toBe("Há um comando em andamento na aba.");
    expect(exportBlocker(rows, { busy: true, statistics: true })).toBe("Escolha a aba de um resultado para exportar.");
  });

  it("com a execução da atualização automática rodando, a origem é a grade que está na tela (a de antes dela)", () => {
    const auto: RunnerState = { status: "running", auto: true, previous: rows } as RunnerState;
    expect(exportRows(auto)).toBe(rows);
    expect(runnerExportBlocker(auto, { busy: false })).toBeNull();
    expect(exportRows({ status: "running", previous: null } as RunnerState)).toBeNull();
  });
});

describe("a origem que cada entrada entrega ao assistente (RN-EXPORT-002)", () => {
  it("os Registros: o comando que a grade mostra, o filtro aplicado (para o subtítulo), as colunas do resultado e as alterações não salvas", () => {
    const source = recordsSource(rows, { connectionId: "c1", database: "outro", schema: "estoque", name: "pedido", filter: "id > 1", unsavedEdits: 2 });

    expect(source).toEqual({
      connectionId: "c1",
      database: "outro",
      origin: { kind: "records", schema: "estoque", name: "pedido", sql: 'SELECT * FROM "estoque"."pedido" WHERE id > 1', filter: "id > 1" },
      columns: [
        { name: "id", type: "int4" },
        { name: "cliente", type: "text" },
      ],
      unsavedEdits: 2,
    });
    expect("database" in recordsSource(rows, { connectionId: "c1", schema: "estoque", name: "pedido", filter: "", unsavedEdits: 0 })).toBe(false);
  });

  it("o resultado: o comando como foi executado, com o filtro do resultado (RN-GRADE-011), o nome da aba, o número no script e a tabela única que o alvo conhece", () => {
    const source = resultSource(rows, { connectionId: "c1", tabTitle: "consulta-1.sql", scriptNumber: 3, unsavedEdits: 0, table: { schema: "estoque", name: "pedido" } });

    expect(source.origin).toEqual({ kind: "result", tabTitle: "consulta-1.sql", scriptNumber: 3, sql: rows.target.sql, filter: "cliente = 'Ana'", table: { schema: "estoque", name: "pedido" } });
    expect(resultSource({ ...rows, target: { sql: "select 1", offset: 0 } }, { connectionId: "c1", tabTitle: "x", scriptNumber: null, unsavedEdits: 0, table: null }).origin).toMatchObject({ filter: null, table: null, scriptNumber: null });
  });
});

describe("as colunas inteiras escolhidas na grade abrem marcadas na Extração (RN-EXPORT-001 e 005)", () => {
  it("as duas origens da grade levam as posições delas; sem elas (ou vazias), nada vai, e todas vêm marcadas", () => {
    expect(recordsSource(rows, { connectionId: "c1", schema: "estoque", name: "pedido", filter: "", unsavedEdits: 0, checkedColumns: [1] }).checkedColumns).toEqual([1]);
    expect(resultSource(rows, { connectionId: "c1", tabTitle: "x", scriptNumber: null, unsavedEdits: 0, table: null, checkedColumns: [0] }).checkedColumns).toEqual([0]);
    expect("checkedColumns" in recordsSource(rows, { connectionId: "c1", schema: "estoque", name: "pedido", filter: "", unsavedEdits: 0, checkedColumns: null })).toBe(false);
    expect("checkedColumns" in resultSource(rows, { connectionId: "c1", tabTitle: "x", scriptNumber: null, unsavedEdits: 0, table: null, checkedColumns: [] })).toBe(false);
  });

  it("as caixas ao abrir: só as escolhidas; as posições fora das colunas não contam, e sem nenhuma que valha, todas", () => {
    const columns = [
      { name: "id", type: "int4" },
      { name: "cliente", type: "text" },
      { name: "total", type: "numeric" },
    ];
    expect(initialChecked(columns, [0, 2])).toEqual([true, false, true]);
    expect(initialChecked(columns, [7])).toEqual([true, true, true]);
    expect(initialChecked(columns, undefined)).toEqual([true, true, true]);
  });
});
