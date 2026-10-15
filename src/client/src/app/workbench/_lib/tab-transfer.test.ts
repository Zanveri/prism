import { describe, expect, it } from "vitest";

import { readTransfer, serializeTab, type TabSnapshot } from "./tab-transfer";
import type { RowsState, RunnerState } from "./use-query-runner";
import type { QueryTab } from "./workbench-model";

const tab: QueryTab = { id: "6f1c1f62-5d2b-4d36-9a37-2f6f0c7a1b10", title: "consulta-3.sql", connectionId: "c-1", sessionId: "velha", sql: "select 1", table: undefined };

const rows: RowsState = {
  status: "rows",
  id: 4,
  target: { sql: "select * from pedido", offset: 10, engine: 1 },
  columns: [
    { name: "id", type: "integer", kind: "number" },
    { name: "nota", type: "text", kind: "text" },
  ],
  rows: [
    ["1", null],
    ["2", "<b>texto</b>"],
  ],
  truncated: new Map([[1, new Set([1])]]),
  hasMore: true,
  totalRows: null,
  elapsedMs: 12.5,
  pages: 1,
  loadingMore: false,
  cancelling: false,
  cursorClosed: false,
  total: null,
  counting: false,
  resultId: "r-9",
  readOnly: null,
};

function snapshot(overrides: Partial<TabSnapshot> = {}): TabSnapshot {
  return {
    tab,
    sessionId: "s-42",
    editor: { sql: "select * from pedido\nwhere id > 1", anchor: 7, head: 13 },
    state: rows,
    memory: { layout: { mode: "maximized", resultPercent: 70 }, grid: { key: "[]", widths: { 0: 120 } } },
    ...overrides,
  };
}

/** Ida e volta, como pelo processo principal: o que passa por IPC é dado puro (sem Map, sem Set, sem função). */
const roundTrip = (value: unknown) => readTransfer(JSON.parse(JSON.stringify(value)));

describe("serializeTab e readTransfer: a aba passa para outra janela como estava (RN-ABAS-002)", () => {
  it("leva o texto que está no EDITOR (e não a cópia atrasada da aba), a seleção, a sessão, o resultado com o cursor aberto e o que a tela lembrava", () => {
    const transfer = serializeTab(snapshot());
    expect(transfer).not.toBeNull();

    const adopted = roundTrip(transfer);
    expect(adopted?.tab).toEqual({ ...tab, sql: "select * from pedido\nwhere id > 1", sessionId: "s-42" });
    expect(adopted?.selection).toEqual({ anchor: 7, head: 13 });
    expect(adopted?.state).toEqual(rows);
    expect(adopted?.memory).toEqual({ layout: { mode: "maximized", resultPercent: 70 }, grid: { key: "[]", widths: { 0: 120 } } });
  });

  it("o resultado filtrado leva o filtro com o comando e diz como ele entrou (RN-GRADE-011): Executar de novo na outra janela repete os dois", () => {
    const filtered: RowsState = { ...rows, target: { ...rows.target, filter: `"nota" IS NULL ORDER BY "id" DESC` }, filterApplied: "wrapped", readOnly: "o filtro foi aplicado por fora do comando" };

    expect(roundTrip(serializeTab(snapshot({ state: filtered })))?.state).toEqual(filtered);
  });

  it("as células cortadas voltam como mapa de conjuntos, e o resultado volta parado (sem carregar, contar nem cancelar)", () => {
    const state = roundTrip(serializeTab(snapshot()))?.state as RowsState;
    expect(state.truncated.get(1)?.has(1)).toBe(true);
    expect([state.loadingMore, state.counting, state.cancelling]).toEqual([false, false, false]);
  });

  it("a aba de uma tabela, sem editor, leva a vista, o banco e o filtro dos Registros; o texto continua o da aba", () => {
    const tableTab: QueryTab = { ...tab, sql: "", database: "vendas", table: { schema: "public", name: "pedido", view: "data" } };
    const adopted = roundTrip(serializeTab(snapshot({ tab: tableTab, editor: null, memory: { records: { draft: "id > 3", query: { where: "id > 3", sort: null } } } })));

    expect(adopted?.tab).toEqual({ ...tableTab, sessionId: "s-42" });
    expect(adopted?.selection).toBeNull();
    expect(adopted?.memory.records).toEqual({ draft: "id > 3", query: { where: "id > 3", sort: null } });
  });

  it.each<[string, RunnerState]>([
    ["sem resultado", { status: "idle" }],
    ["linhas afetadas", { status: "affected", rowsAffected: 3, elapsedMs: 4 }],
    ["cancelado", { status: "cancelled" }],
    ["aviso", { status: "notice", message: "A seleção tem 2 comandos." }],
    ["erro do banco", { status: "error", source: "database", title: "Erro do banco", message: "relation \"x\" does not exist", sqlState: "42P01", errorAt: 14 }],
    ["erro de driver", { status: "error", source: "driver", title: "Driver", message: null, sqlState: null, errorAt: null, driverID: "db2" }],
  ])("leva o estado %s como estava", (_, state) => {
    expect(roundTrip(serializeTab(snapshot({ state })))?.state).toEqual(state);
  });

  it.each<[string, RunnerState]>([
    ["executando", { status: "running", cancelling: false, previous: null }],
    ["carregando mais", { ...rows, loadingMore: true }],
    ["contando", { ...rows, counting: true }],
  ])("a aba com comando em andamento (%s) não passa: a resposta chegaria à janela que ela deixou", (_, state) => {
    expect(serializeTab(snapshot({ state }))).toBeNull();
  });

  it("recusa o que não é uma aba: outra versão, id que não é UUID, campo a mais no lugar errado, posição negativa", () => {
    const good = serializeTab(snapshot());
    expect(readTransfer({ ...good, version: 2 })).toBeNull();
    expect(readTransfer({ ...good, tab: { ...good?.tab, id: "../../etc" } })).toBeNull();
    expect(readTransfer({ ...good, editor: { anchor: -1, head: 0 } })).toBeNull();
    expect(readTransfer({ ...good, result: { status: "rows" } })).toBeNull();
    expect(readTransfer({ ...good, memory: { layout: { mode: "tela-cheia", resultPercent: 50 } } })).toBeNull();
    expect(readTransfer("aba")).toBeNull();
    expect(readTransfer(null)).toBeNull();
  });

  it("a aba de um script leva o id, o nome e o texto salvo; o ponto da mudança não salva é refeito pelo texto do editor (RN-SCRIPT-001)", () => {
    const script = { id: "0199c3a0-0000-7000-8000-000000000001", name: "Fechamento", savedSql: "select 1", savedConnectionId: tab.connectionId!, dirty: false };
    const edited = roundTrip(serializeTab(snapshot({ tab: { ...tab, title: "Fechamento", script }, editor: { sql: "select 2", anchor: 0, head: 0 } })));
    const same = roundTrip(serializeTab(snapshot({ tab: { ...tab, title: "Fechamento", script: { ...script, dirty: true } }, editor: { sql: "select 1", anchor: 0, head: 0 } })));

    expect(edited?.tab.script).toEqual({ ...script, dirty: true });
    expect(edited?.tab.title).toBe("Fechamento");
    expect(same?.tab.script).toEqual(script);
  });

  it("a aba que trocou de banco leva o banco novo, e o script leva o banco em que foi salvo: o ponto continua aceso do outro lado (RN-ARVORE-007)", () => {
    const script = { id: "0199c3a0-0000-7000-8000-000000000001", name: "Fechamento", savedSql: "select 1", savedConnectionId: tab.connectionId!, savedDatabase: "mes2", dirty: true };
    const moved = roundTrip(serializeTab(snapshot({ tab: { ...tab, title: "Fechamento", database: "vendas", sessionId: null, script }, sessionId: null, editor: { sql: "select 1", anchor: 0, head: 0 } })));
    const back = roundTrip(serializeTab(snapshot({ tab: { ...tab, title: "Fechamento", database: "mes2", script }, editor: { sql: "select 1", anchor: 0, head: 0 } })));

    expect(moved?.tab.database).toBe("vendas");
    expect(moved?.tab.script).toEqual(script);
    expect(back?.tab.script).toEqual({ ...script, dirty: false });
  });

  it("o script leva a conexão em que foi salvo, e o genérico vai genérico: o ponto do outro lado conta a conexão da aba, menos no genérico (RN-SCRIPT-003 e 005)", () => {
    const other = "0199c3a0-0000-7000-8000-0000000000c2";
    const script = { id: "0199c3a0-0000-7000-8000-000000000001", name: "Fechamento", savedSql: "select 1", savedConnectionId: other, dirty: true };
    const moved = roundTrip(serializeTab(snapshot({ tab: { ...tab, title: "Fechamento", script }, editor: { sql: "select 1", anchor: 0, head: 0 } })));
    const generic = { id: script.id, name: "Fechamento", savedSql: "select 1", generic: true as const, dirty: false };
    const movedGeneric = roundTrip(serializeTab(snapshot({ tab: { ...tab, title: "Fechamento", script: generic }, editor: { sql: "select 1", anchor: 0, head: 0 } })));

    expect(moved?.tab.script).toEqual(script);
    expect(movedGeneric?.tab.script).toEqual(generic);
    // Só `true` diz genérico: outro valor no lugar dele é aba fora do formato.
    const good = serializeTab(snapshot({ tab: { ...tab, script } }))!;
    expect(readTransfer({ ...good, tab: { ...good.tab, script: { ...good.tab.script, generic: false } } })).toBeNull();
  });

  it("a aba sem conexão (o script cuja conexão sumiu, RN-SCRIPT-003) passa sem conexão", () => {
    const adopted = roundTrip(serializeTab(snapshot({ tab: { ...tab, connectionId: null, sessionId: null } })));

    expect(adopted?.tab.connectionId).toBeNull();
  });

  it("a seleção que passa do fim do texto (o texto mudou) fica no fim dele", () => {
    const adopted = roundTrip(serializeTab(snapshot({ editor: { sql: "select 1", anchor: 2, head: 400 } })));
    expect(adopted?.selection).toEqual({ anchor: 2, head: 8 });
  });
});

describe("a aba de consulta que salvou a edição vai com a grade salva (RN-EDIT-009)", () => {
  it("as células que o banco preencheu numa linha nova salva vão marcadas, e voltam como mapa de conjuntos", () => {
    const saved: RowsState = { ...rows, cursorClosed: true, generated: new Map([[1, new Set([0])]]) };

    const state = roundTrip(serializeTab(snapshot({ state: saved })))?.state as RowsState;

    expect(state.generated?.get(1)?.has(0)).toBe(true);
    expect(state.cursorClosed).toBe(true);
  });

  it("o resultado sem marca nenhuma volta sem o campo, como ia antes", () => {
    expect(roundTrip(serializeTab(snapshot()))?.state).not.toHaveProperty("generated");
    expect(roundTrip(serializeTab(snapshot()))?.state).not.toHaveProperty("sourceRows");
  });

  it("a linha de cada linha no resultado da API vai junto: copiar a célula cortada pede a linha certa na outra janela (RN-SQL-017)", () => {
    const saved: RowsState = { ...rows, cursorClosed: true, sourceRows: [1, null] };

    const state = roundTrip(serializeTab(snapshot({ state: saved })))?.state as RowsState;

    expect(state.sourceRows).toEqual([1, null]);
  });
});
