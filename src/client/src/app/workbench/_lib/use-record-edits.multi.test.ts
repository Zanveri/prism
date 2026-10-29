import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import type { AutoRefreshBlocker, AutoRefreshState } from "./auto-refresh";
import type { QueryRunner, RowsState, RunnerState } from "./use-query-runner";
import { initialTransaction } from "./transaction";

// A edição de várias células e a coluna inteira (seção 38: RN-EDIT-017 a 022) pelo gancho da edição, com os ganchos do React simulados (`createHookRuntime`):
// o que se confere é o que ele entrega à grade e à faixa, o que pede à API e o que faz com as pendências e com o executor. As decisões puras têm teste
// próprio (`record-edits.multi.test.ts`, `multi-edit.test.ts`, `whole-column-question.test.ts`).
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return {
    ...createHookRuntime(),
    service: { editTargetOrRefuse: vi.fn(), saveEditsOrRefuse: vi.fn(), previewEditsOrRefuse: vi.fn(), sqlTargetOrRefuse: vi.fn(), countWholeColumnOrRefuse: vi.fn() },
    query: { cancelQuery: vi.fn(async () => ({ ok: true, data: undefined })) },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    cells: { resultCells: vi.fn() },
    client: { getQueryData: vi.fn<(key: unknown) => unknown>(() => undefined) },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => rt.client }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("./record-edits.service", () => rt.service);
vi.mock("./query.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("./query.service")>()), ...rt.query }));
vi.mock("./full-values.service", () => rt.cells);

import type { WholeColumnQuestion } from "./command-confirmation";
import { extend, selectColumn, selectRow } from "./grid-selection";
import { multiEditCopy } from "./multi-edit.copy";
import type { EditTarget } from "./record-edits.schema";
import { forgetExcept } from "./tab-memory";
import { useRecordEdits } from "./use-record-edits";

const pg: Engine = 1;
const multi = multiEditCopy;

const columns: RowsState["columns"] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "Nome", type: "text", kind: "text" },
];
const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedidos", key: [0], editable: true, reason: null }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "Nome", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

const page = (from: number, count: number) => Array.from({ length: count }, (_, index) => [`${from + index + 1}`, `n${from + index + 1}`]);

function rowsState(over: Partial<RowsState> = {}): RowsState {
  return { status: "rows", id: 1, target: { sql: 'SELECT * FROM "loja"."pedidos"', offset: 0 }, columns, rows: page(0, 3), truncated: new Map(), hasMore: true, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false, resultId: "r1", read: true, ...over };
}

function fakeRunner(initial: RunnerState) {
  const runner = {
    state: initial,
    subscribe: () => () => {},
    getState: (): RunnerState => runner.state,
    sessionOf: () => "s1",
    script: { getState: () => null },
    // RN-TX-001: em Auto-commit, sem transação; o "Salvar" entrega o estado que a API mandou.
    transaction: { getState: () => initialTransaction, note: vi.fn() },
    loadMore: vi.fn(async () => ({ kind: "end" as const })),
    keepSaved: vi.fn(),
    rerun: vi.fn(async () => {}),
    autoRefresh: { subscribe: () => () => {}, getState: (): AutoRefreshState => ({ status: "off", stopped: null }), blocker: (): AutoRefreshBlocker | null => null, start: vi.fn(), stop: vi.fn(), pause: vi.fn() },
  };
  return runner;
}

type Extra = Partial<Parameters<typeof useRecordEdits>[0]>;

function mount(runner: ReturnType<typeof fakeRunner>, extra: Extra = {}) {
  const params = { tabId: "t1", runner: runner as unknown as QueryRunner, connectionId: "c1", engine: pg, onSaved: vi.fn(), subject: "result" as const, ...extra };
  const show = (change: Extra = {}) => {
    Object.assign(params, change);
    return rt.render(() => useRecordEdits({ ...params, state: runner.state }));
  };
  return { show, params };
}

const settle = async () => {
  for (let turn = 0; turn < 30; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** As linhas 1 a `to` da coluna Nome escolhidas, com a célula ativa na de cima (o clique e o arraste para baixo). */
function chooseCells(view: ReturnType<typeof mount>, to: number) {
  view.show().editing!.onSelection((held, grid) => selectRow(held, 0, grid));
  view.show().editing!.onActivate({ row: 0, column: 1 });
  view.show().editing!.onSelection((held, grid) => extend(held, { row: to, column: 1 }, grid));
  // A célula ativa vai ao fim do arraste; o campo abre nela.
  return { row: to, column: 1 };
}

const chooseColumn = (view: ReturnType<typeof mount>, column: number) => view.show().editing!.onSelection((held, grid) => selectColumn(held, column, grid));

async function openAt(view: ReturnType<typeof mount>, cell: { row: number; column: number }) {
  view.show().editing!.onEdit(cell);
  await settle();
  return view.show().editing!.editor;
}

let clipboard: { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  forgetExcept(new Set());
  rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: target }));
  rt.service.countWholeColumnOrRefuse.mockImplementation(async () => ({ ok: true, data: { rows: 1234 } }));
  rt.service.previewEditsOrRefuse.mockImplementation(async () => ({ ok: true, data: { statements: [{ sql: "SELECT COUNT(*)", values: [], note: "nota" }, { sql: 'UPDATE "loja"."pedidos" SET "Nome" = \'z\'', values: [] }], oneAtATime: false } }));
  rt.service.saveEditsOrRefuse.mockImplementation(async () => ({ ok: true, data: { applied: 1 } }));
  clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => "") };
  vi.stubGlobal("navigator", { clipboard, platform: "Win32" });
});
afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

describe("editar várias células da mesma coluna (RN-EDIT-017)", () => {
  it("o campo abre na célula ativa com a dica de para quantas vale; o texto mexido vai a todas, uma pendência por linha", async () => {
    const view = mount(fakeRunner(rowsState()));
    const cell = chooseCells(view, 2);

    expect((await openAt(view, cell))?.hint).toBe("Vale para as 3 células escolhidas da coluna Nome.");
    view.show().editing!.onDraft("igual");
    view.show().editing!.onCommit();

    const shown = view.show();
    expect(shown.pending).toBe(3);
    expect([...shown.editing!.marks.keys()]).toEqual([0, 1, 2]);
    // Depois do Enter, a seleção fica.
    expect(shown.editing!.status).toBe("3 células escolhidas");
  });

  it("confirmar sem ter mexido no texto não aplica nada, nem à célula ativa, e a faixa diz por quê; Esc também não aplica nada", async () => {
    const view = mount(fakeRunner(rowsState()));
    const cell = chooseCells(view, 2);
    await openAt(view, cell);
    view.show().editing!.onCommit();

    expect(view.show().pending).toBe(0);
    expect(view.show().banner.notice).toBe(multi.untouched);
    // O campo abre com o texto todo selecionado: o conselho é digitar por cima, não apagar um caractere (que apagaria o valor).
    expect(multi.untouched).toContain("digite o valor por cima");
    expect(multi.untouched).not.toContain("apague um caractere");

    await openAt(view, cell);
    view.show().editing!.onDraft("x");
    view.show().editing!.onCancel();
    expect(view.show().pending).toBe(0);
  });

  it("F2, Enter e o duplo clique abrem o campo com o valor, sem mexer nele (a tela o seleciona todo); digitar abre com o caractere no lugar do valor, já mexido (RN-EDIT-001)", async () => {
    const view = mount(fakeRunner(rowsState()));

    expect(await openAt(view, { row: 0, column: 1 })).toMatchObject({ draft: "n1", touched: false });
    view.show().editing!.onCancel();
    view.show().editing!.onEdit({ row: 0, column: 1 }, "k");
    await settle();

    expect(view.show().editing!.editor).toMatchObject({ draft: "k", touched: true });
  });

  it("começar a digitar já é mexer no texto: confirmar leva o que foi digitado a todas", async () => {
    const view = mount(fakeRunner(rowsState()));
    const cell = chooseCells(view, 1);
    view.show().editing!.onEdit(cell, "k");
    await settle();
    view.show().editing!.onCommit();

    expect(view.show().pending).toBe(2);
  });

  it("antes de abrir, confere todas as linhas: a primeira que não pode receber o valor, com o número dela, e nada muda", async () => {
    const view = mount(fakeRunner(rowsState({ truncated: new Map([[1, new Set([1])]]) })));
    const cell = chooseCells(view, 2);

    expect(await openAt(view, cell)).toBeNull();
    expect(view.show().banner.notice).toBe("A edição não foi feita: a célula da linha 2 chegou cortada.");
    expect(view.show().pending).toBe(0);
  });

  it("\"Definir como nulo\" diz para quantas vale e as anula, sem abrir o campo", async () => {
    const view = mount(fakeRunner(rowsState()));
    const cell = chooseCells(view, 2);
    view.show().editing!.onMenu(cell, { x: 1, y: 1 }, false);
    await settle();
    const item = view.show().menu!.groups.flat().find((entry) => entry.id === "setNull")!;
    expect(item.label).toBe("Definir as 3 células como nulo");
    view.show().menu!.onChoose("setNull");
    await settle();

    expect(view.show().pending).toBe(3);
    expect([...view.show().editing!.marks.values()].every((mark) => mark.pending.get(1) === null)).toBe(true);
  });

  it("\"Desfazer alteração\" logo depois, com a mesma seleção, desfaz o grupo inteiro de uma vez", async () => {
    const view = mount(fakeRunner(rowsState()));
    const cell = chooseCells(view, 2);
    await openAt(view, cell);
    view.show().editing!.onDraft("x");
    view.show().editing!.onCommit();
    view.show().editing!.onMenu(cell, { x: 1, y: 1 }, false);
    await settle();
    view.show().menu!.onChoose("undo");

    expect(view.show().pending).toBe(0);
  });

  it("o grupo grande é montado em partes, com \"Aplicando o valor a N células…\"; o \"Cancelar\" não deixa nenhuma célula alterada", async () => {
    const big = page(0, 6_000);
    const view = mount(fakeRunner(rowsState({ rows: big, hasMore: false })));
    const cell = chooseCells(view, 5_999);
    await openAt(view, cell);
    view.show().editing!.onDraft("x");
    view.show().editing!.onCommit();

    expect(view.show().banner.building).toBe("Aplicando o valor a 6.000 células…");
    // Enquanto monta, uma nova edição espera.
    view.show().editing!.onEdit({ row: 0, column: 0 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.show().banner.onCancelBuild!();
    await settle();
    expect(view.show().banner.building).toBeNull();
    expect(view.show().pending).toBe(0);

    // De novo, até o fim: o grupo entra inteiro.
    await openAt(view, cell);
    view.show().editing!.onDraft("y");
    view.show().editing!.onCommit();
    await settle();
    expect(view.show().pending).toBe(6_000);
    expect(view.show().banner.building).toBeNull();
  });

  it("o Ctrl+S e o \"Salvar\" da faixa esperam o grupo em montagem, com \"Aplicando o valor às células escolhidas.\", e ele continua", async () => {
    const big = page(0, 6_000);
    const view = mount(fakeRunner(rowsState({ rows: big, hasMore: false })));
    const cell = chooseCells(view, 5_999);
    await openAt(view, cell);
    view.show().editing!.onDraft("x");
    view.show().editing!.onCommit();
    expect(view.show().banner.building).toBe("Aplicando o valor a 6.000 células…");

    view.show().editing!.onSave();
    view.show().banner.onSave();
    expect(view.show().banner.notice).toBe(multi.applyingBusy);
    await settle();

    // O grupo entrou inteiro, e nada foi gravado: o Salvar seguinte é da pessoa, com o grupo nas pendências.
    expect(view.show().banner.building).toBeNull();
    expect(view.show().pending).toBe(6_000);
    expect(rt.service.saveEditsOrRefuse).not.toHaveBeenCalled();
  });
});

describe("a coluna inteira, uma alteração só (RN-EDIT-018)", () => {
  it("com a coluna escolhida inteira, a edição vale para todas as linhas do resultado: uma alteração, a linha da faixa e o mapa da grade", async () => {
    const view = mount(fakeRunner(rowsState()));
    chooseColumn(view, 1);
    const cell = view.show().editing!.active!;

    expect((await openAt(view, cell))?.hint).toBe("Vale para todas as linhas do resultado, também as que não foram carregadas (coluna Nome).");
    view.show().editing!.onDraft("z");
    view.show().editing!.onCommit();

    const shown = view.show();
    expect(shown.pending).toBe(1);
    expect(shown.banner.wholeLine).toBe("Em todas as linhas do resultado: Nome = 'z'.");
    expect(shown.editing!.columnPending?.get(1)).toMatchObject({ value: "z", hint: "Alteração pendente em todas as linhas: Nome = 'z'" });
    // As linhas não viram uma pendência cada uma.
    expect(shown.editing!.marks.size).toBe(0);
    // O "Editar célula" da barra diz para quem vale.
    expect(shown.editing!.bar.buttons[0].title).toBe("Editar célula (F2). Vale para todas as linhas do resultado (coluna Nome).");
  });

  it("o copiar leva o valor da coluna inteira nas linhas lidas", async () => {
    const view = mount(fakeRunner(rowsState({ hasMore: false })));
    chooseColumn(view, 1);
    await openAt(view, view.show().editing!.active!);
    view.show().editing!.onDraft("z");
    view.show().editing!.onCommit();
    view.show().editing!.onCopy();
    await settle();

    expect(clipboard.writeText).toHaveBeenCalledWith("z\nz\nz");
  });

  it("não vale no comando que limita as linhas sem ordem, nem na coluna da chave: o campo não abre, e a faixa diz o motivo em \"Indisponível: …\"", async () => {
    const limited = mount(fakeRunner(rowsState({ target: { sql: "select * from loja.pedidos limit 5", offset: 0 } })));
    chooseColumn(limited, 1);
    expect(await openAt(limited, limited.show().editing!.active!)).toBeNull();
    expect(limited.show().banner.notice).toBe(multi.unavailable(multi.wholeReasons.limit));
    expect(limited.show().editing!.bar.buttons[0].reason).toBe(multi.unavailable(multi.wholeReasons.limit));

    rt.unmount();
    const key = mount(fakeRunner(rowsState()));
    chooseColumn(key, 0);
    expect(await openAt(key, key.show().editing!.active!)).toBeNull();
    expect(key.show().banner.notice).toBe("Indisponível: id é da chave de pedidos: na coluna inteira, todas as linhas ficariam com a mesma chave.");
  });

  it("\"Definir a coluna inteira como nulo\"; e o \"Desfazer alteração\" dela diz a conta", async () => {
    const view = mount(fakeRunner(rowsState()));
    chooseColumn(view, 1);
    const cell = view.show().editing!.active!;
    view.show().editing!.onMenu(cell, { x: 1, y: 1 }, false);
    await settle();
    expect(view.show().menu!.groups.flat().find((item) => item.id === "setNull")?.label).toBe("Definir a coluna inteira como nulo");
    view.show().menu!.onChoose("setNull");
    await settle();
    expect(view.show().banner.wholeLine).toBe("Em todas as linhas do resultado: Nome = NULL.");

    view.show().editing!.onMenu(cell, { x: 1, y: 1 }, false);
    await settle();
    expect(view.show().menu!.groups.flat().find((item) => item.id === "undo")).toMatchObject({ label: "Desfazer a alteração da coluna Nome", disabled: false });
    view.show().menu!.onChoose("undo");
    expect(view.show().pending).toBe(0);
  });

  it("uma célula editada depois, sob a coluna inteira, vale para aquela linha; só algumas células escolhidas não desfazem a da coluna", async () => {
    const view = mount(fakeRunner(rowsState()));
    chooseColumn(view, 1);
    await openAt(view, view.show().editing!.active!);
    view.show().editing!.onDraft("z");
    view.show().editing!.onCommit();

    view.show().editing!.onActivate({ row: 1, column: 1 });
    await openAt(view, { row: 1, column: 1 });
    expect(view.show().editing!.editor?.draft).toBe("z");
    // Voltar ao valor lido, sob a coluna inteira, continua sendo uma pendência.
    view.show().editing!.onDraft("n2");
    view.show().editing!.onCommit();
    expect(view.show().pending).toBe(2);

    view.show().editing!.onActivate({ row: 0, column: 1 });
    view.show().editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 1 }, false);
    await settle();
    expect(view.show().menu!.groups.flat().find((item) => item.id === "undo")).toMatchObject({ disabled: true, hint: multi.undo.wholeOnly });
  });
});

describe("o Salvar com a coluna inteira (RN-EDIT-019 a 022)", () => {
  async function withWhole(extra: Extra = {}, over: Partial<RowsState> = {}) {
    const runner = fakeRunner(rowsState(over));
    const view = mount(runner, extra);
    chooseColumn(view, 1);
    await openAt(view, view.show().editing!.active!);
    view.show().editing!.onDraft("z");
    view.show().editing!.onCommit();
    return { view, runner };
  }

  it("conta na sessão, pede os comandos, pergunta sempre e grava com as linhas contadas; avisa quantas mudaram, e quem usa lê de novo", async () => {
    const confirmWholeColumn = vi.fn<(question: WholeColumnQuestion) => Promise<boolean>>(async () => true);
    const { view, runner } = await withWhole({ confirmWholeColumn });
    const onSaved = view.params.onSaved;
    view.show().banner.onSave();
    await settle();

    expect(rt.service.countWholeColumnOrRefuse).toHaveBeenCalledWith("s1", "r1", [{ kind: "updateAll", table: 0, set: [{ column: 1, value: "z" }] }]);
    expect(rt.service.previewEditsOrRefuse).toHaveBeenCalledWith("s1", "r1", [{ kind: "updateAll", table: 0, set: [{ column: 1, value: "z" }] }]);
    expect(confirmWholeColumn.mock.calls[0][0]).toMatchObject({ kind: "wholeColumn", title: "Alterar Nome em 1.234 linhas de loja.pedidos?", assignments: ["Nome = 'z'"], confirm: "Alterar 1.234 linhas", command: { sql: 'UPDATE "loja"."pedidos" SET "Nome" = \'z\'', note: null } });
    expect(rt.service.saveEditsOrRefuse).toHaveBeenCalledWith("s1", "r1", [{ kind: "updateAll", table: 0, set: [{ column: 1, value: "z" }], rows: 1234 }]);
    // A contagem é um comando na sessão: o cursor aberto fechou.
    expect(runner.keepSaved).toHaveBeenCalledWith("r1", expect.objectContaining({ rows: rowsState().rows }));
    expect(rt.toast.success).toHaveBeenCalledWith("Coluna Nome atualizada em 1.234 linhas.");
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ resultId: "r1", reread: true, whole: { columns: ["Nome"], rows: 1234 }, kept: false }));
    expect(view.show().pending).toBe(0);
  });

  it("a pergunta não cobre a da proteção \"Todos os comandos\" à parte: ela é a única daquele Salvar", async () => {
    const confirmSave = vi.fn(() => true as const);
    const { view } = await withWhole({ confirmSave, confirmWholeColumn: async () => true });
    view.show().banner.onSave();
    await settle();
    expect(confirmSave).not.toHaveBeenCalled();
    expect(rt.service.saveEditsOrRefuse).toHaveBeenCalledOnce();
  });

  it("da contagem até a resposta, a grade não aceita edição; cancelar a pergunta deixa as pendências como estavam", async () => {
    let answer: (value: boolean) => void = () => {};
    const confirmWholeColumn = vi.fn(() => new Promise<boolean>((resolve) => (answer = resolve)));
    const { view } = await withWhole({ confirmWholeColumn });
    view.show().banner.onSave();
    await settle();

    expect(view.show().banner.asking).toBe(true);
    view.show().editing!.onActivate({ row: 0, column: 0 });
    expect(await openAt(view, { row: 0, column: 0 })).toBeNull();
    expect(view.show().banner.notice).toBe("Somente leitura: há um comando em andamento na aba.");

    answer(false);
    await settle();
    expect(rt.service.saveEditsOrRefuse).not.toHaveBeenCalled();
    expect(view.show().pending).toBe(1);
    expect(view.show().banner.asking).toBe(false);
  });

  it("\"Contando as linhas do resultado…\" com o \"Cancelar\", que pede o cancelamento ao banco; cancelada, volta à faixa de antes, sem salvar", async () => {
    let finish: (value: unknown) => void = () => {};
    rt.service.countWholeColumnOrRefuse.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { view } = await withWhole({ confirmWholeColumn: async () => true });
    view.show().banner.onSave();
    await settle();

    expect(view.show().banner.counting).toBe(true);
    view.show().banner.onCancelSave!();
    expect(rt.query.cancelQuery).toHaveBeenCalledWith("s1");
    finish({ ok: false, error: { status: 422, code: "SQL_EXECUTION_FAILED", title: "Falha", detail: "cancelado", errors: null, extensions: { outcome: "canceled" } } });
    await settle();

    expect(view.show().banner.counting).toBe(false);
    expect(view.show().banner.failure).toBeNull();
    expect(rt.service.saveEditsOrRefuse).not.toHaveBeenCalled();
  });

  it("a contagem que o banco recusa não salva nada, e a faixa diz por quê, com a mensagem do banco", async () => {
    rt.service.countWholeColumnOrRefuse.mockImplementation(async () => ({ ok: false, error: { status: 422, code: "SQL_EXECUTION_FAILED", title: "Falha", detail: "ERRO: permissão negada", errors: null, extensions: {} } }));
    const { view } = await withWhole({ confirmWholeColumn: async () => true });
    view.show().banner.onSave();
    await settle();

    expect(view.show().banner.failure).toMatchObject({ headline: multi.countFailed, detail: "ERRO: permissão negada" });
    expect(view.show().pending).toBe(1);
  });

  it("no Informix sem log, o número de linhas que não bateu ficou gravado: sai das pendências, a grade mostra o gravado, e nada é lido de novo", async () => {
    rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: { ...target, oneAtATime: true } }));
    rt.service.saveEditsOrRefuse.mockImplementation(async () => ({ ok: false, error: { status: 422, code: "EDIT_ROW_MISMATCH", title: "x", detail: null, errors: null, extensions: { change: 0, rowsAffected: 1240, applied: 1 } } }));
    const { view } = await withWhole({ confirmWholeColumn: async () => true });
    view.show().banner.onSave();
    await settle();

    expect(view.show().pending).toBe(0);
    expect(view.show().banner.failure?.headline).toContain("A coluna Nome foi alterada em 1.240 linhas, e não nas 1.234 contadas");
    expect(view.params.onSaved).toHaveBeenCalledWith(expect.objectContaining({ partial: true, reread: false, result: expect.objectContaining({ rows: [["1", "z"], ["2", "z"], ["3", "z"]] }) }));
  });

  it("no Informix sem log, a falha no meio fica pendente, com a nota de que pode estar gravada em parte das linhas", async () => {
    rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: { ...target, oneAtATime: true } }));
    rt.service.saveEditsOrRefuse.mockImplementation(async () => ({ ok: false, error: { status: 422, code: "SQL_EXECUTION_FAILED", title: "x", detail: "lock", errors: null, extensions: { change: 0, outcome: "unknown", applied: 0 } } }));
    const { view } = await withWhole({ confirmWholeColumn: async () => true });
    view.show().banner.onSave();
    await settle();

    const shown = view.show();
    expect(shown.pending).toBe(1);
    expect(shown.editing!.columnPending?.get(1)?.uncertain).toBe(true);
    expect(shown.banner.failure).toMatchObject({ headline: multi.failedMidway(["Nome"]), detail: "lock" });
    expect(view.params.onSaved).toHaveBeenCalledWith(expect.objectContaining({ partial: true, result: expect.objectContaining({ rows: rowsState().rows }) }));
  });

  it("o \"Cancelar\" que chega depois da contagem, com os comandos ainda a caminho, também volta à faixa de antes: a pergunta não abre", async () => {
    let finishPreview: (value: unknown) => void = () => {};
    rt.service.previewEditsOrRefuse.mockImplementation(() => new Promise((resolve) => (finishPreview = resolve)));
    const confirmWholeColumn = vi.fn(async () => true);
    const { view } = await withWhole({ confirmWholeColumn });
    view.show().banner.onSave();
    await settle();

    expect(view.show().banner.counting).toBe(true);
    view.show().banner.onCancelSave!();
    finishPreview({ ok: true, data: { statements: [{ sql: "SELECT COUNT(*)", values: [] }, { sql: "UPDATE", values: [] }], oneAtATime: false } });
    await settle();

    expect(confirmWholeColumn).not.toHaveBeenCalled();
    expect(rt.service.saveEditsOrRefuse).not.toHaveBeenCalled();
    expect(view.show().banner.counting).toBe(false);
    expect(view.show().banner.failure).toBeNull();
    expect(view.show().pending).toBe(1);
  });

  it("a contagem recusada antes de chegar à sessão não fecha o cursor; a que o banco recusou fecha", async () => {
    rt.service.countWholeColumnOrRefuse.mockImplementation(async () => ({ ok: false, error: { status: 422, code: "CONNECTION_READ_ONLY", title: "Somente leitura", detail: null, errors: null, extensions: {} } }));
    const refused = await withWhole({ confirmWholeColumn: async () => true });
    refused.view.show().banner.onSave();
    await settle();
    expect(refused.runner.keepSaved).not.toHaveBeenCalled();
    expect(refused.view.show().banner.failure).not.toBeNull();
    rt.unmount();

    rt.service.countWholeColumnOrRefuse.mockImplementation(async () => ({ ok: false, error: { status: 422, code: "SQL_EXECUTION_FAILED", title: "Falha", detail: "ERRO", errors: null, extensions: {} } }));
    const failed = await withWhole({ confirmWholeColumn: async () => true });
    failed.view.show().banner.onSave();
    await settle();
    expect(failed.runner.keepSaved).toHaveBeenCalledOnce();
  });

  it("com o total só contado (o cursor não leu até o fim), a pergunta não compara a contagem com ele: a grade não tem aquelas linhas", async () => {
    const confirmWholeColumn = vi.fn<(question: WholeColumnQuestion) => Promise<boolean>>(async () => false);
    const { view } = await withWhole({ confirmWholeColumn }, { hasMore: true, total: 5000 });
    view.show().banner.onSave();
    await settle();
    expect(confirmWholeColumn.mock.calls[0][0].warnings).toEqual([multi.question.triggers]);

    // Lido até o fim, a grade tem as 3 linhas, e o comando devolve 1.234 agora: o resultado mudou.
    rt.unmount();
    const read = await withWhole({ confirmWholeColumn }, { hasMore: false });
    read.view.show().banner.onSave();
    await settle();
    expect(confirmWholeColumn.mock.calls[1][0].warnings[0]).toBe(multi.question.changed(3, 1234));
  });

  it("no Informix sem log, a falha de uma alteração depois da coluna inteira: a grade mostra a coluna gravada e, por cima, a célula também gravada", async () => {
    rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: { ...target, oneAtATime: true } }));
    const { view } = await withWhole({ confirmWholeColumn: async () => true });
    for (const [row, value] of [[0, "own"], [2, "bad"]] as const) {
      view.show().editing!.onActivate({ row, column: 1 });
      await openAt(view, { row, column: 1 });
      view.show().editing!.onDraft(value);
      view.show().editing!.onCommit();
    }
    expect(view.show().pending).toBe(3);
    rt.service.saveEditsOrRefuse.mockImplementation(async () => ({ ok: false, error: { status: 422, code: "SQL_EXECUTION_FAILED", title: "x", detail: "recusa", errors: null, extensions: { change: 2, applied: 2 } } }));
    view.show().banner.onSave();
    await settle();

    expect(view.params.onSaved).toHaveBeenCalledWith(expect.objectContaining({ partial: true, result: expect.objectContaining({ rows: [["1", "own"], ["2", "z"], ["3", "z"]] }) }));
    expect(view.show().pending).toBe(1);
  });

  it("o \"Salvar\" do aviso da troca de aba do script (`guard` que não executa nada) lê o resultado de novo depois da coluna inteira", async () => {
    const { view } = await withWhole({ confirmWholeColumn: async () => true });
    const proceed = vi.fn();
    view.show().guard(proceed, true);
    view.show().question!.onSave();
    await settle();

    expect(view.params.onSaved).toHaveBeenCalledWith(expect.objectContaining({ reread: true, whole: { columns: ["Nome"], rows: 1234 } }));
    expect(proceed).toHaveBeenCalledOnce();
  });

  it("o \"Salvar\" do aviso \"Há N alterações não salvas\" também conta e pergunta; cancelada a pergunta, a ação que ele interrompia também fica", async () => {
    const { view } = await withWhole({ confirmWholeColumn: async () => false });
    const proceed = vi.fn();
    view.show().guard(proceed);
    view.show().question!.onSave();
    await settle();

    expect(rt.service.countWholeColumnOrRefuse).toHaveBeenCalledOnce();
    expect(proceed).not.toHaveBeenCalled();
    expect(view.show().question).toBeNull();
    expect(view.show().pending).toBe(1);
  });

  it("o corpo que passa de 32 MiB não vai: a faixa diz por quê, e nada é contado", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner, { confirmWholeColumn: async () => true });
    chooseColumn(view, 1);
    await openAt(view, view.show().editing!.active!);
    view.show().editing!.onDraft("x".repeat(33 * 1024 * 1024));
    view.show().editing!.onCommit();
    view.show().banner.onSave();
    await settle();

    expect(view.show().banner.notice).toBe(multi.tooLarge);
    expect(rt.service.countWholeColumnOrRefuse).not.toHaveBeenCalled();
  });

  it("o cancelamento do Salvar é pelo desfecho: \"Salvar cancelado: nada foi gravado.\", e as pendências ficam", async () => {
    rt.service.saveEditsOrRefuse.mockImplementation(async () => ({ ok: false, error: { status: 422, code: "SQL_EXECUTION_FAILED", title: "x", detail: "57014", errors: null, extensions: { outcome: "canceled", change: 0 } } }));
    const { view } = await withWhole({ confirmWholeColumn: async () => true });
    view.show().banner.onSave();
    await settle();

    expect(view.show().banner.failure).toMatchObject({ headline: multi.cancelled, detail: null });
    expect(view.show().pending).toBe(1);
  });
});
