import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SqlTarget } from "../record-edits.schema";
import type { RowsState } from "../use-query-runner";
import type { GridSelectionContext } from "../use-record-edits";
import type { TargetAnswer } from "./generate-sql-flow";

// A ligação do "Gerar SQL" (RN-GRADE-006 e 018 a 020, seção 37) com a grade, pelo gancho com os ganchos do React simulados (`createHookRuntime`): o motivo
// de cada item no submenu, o pedido que o diálogo recebe da seleção, e as peças que ele usa (o alvo do contexto, o valor completo pela linha da grade, a
// pausa, a aba de consulta nova). O contexto é de mentira, com a seleção e a grade de verdade (`grid-selection.ts`); o plano, o texto e o caminho do
// diálogo são os de verdade.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  // O catálogo do CREATE (as três listas da Estrutura, RN-TABELA-003) pelo cache de mentira: as colunas de `pedido`, sem chave estrangeira nem índice.
  const catalogColumns = [
    { name: "id", type: "integer", isNullable: false, isPrimaryKey: true, position: 1, generated: null },
    { name: "cliente", type: "text", isNullable: true, isPrimaryKey: false, position: 2, generated: null },
  ];
  const client = { getQueryData: () => undefined, fetchQuery: vi.fn(async (query: { list: string }) => (query.list === "columns" ? catalogColumns : [])) };
  return { ...createHookRuntime(), toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }, client };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => rt.client }));
vi.mock("../table-structure.service", () => ({ columnsQuery: () => ({ list: "columns" }), foreignKeysQuery: () => ({ list: "foreignKeys" }), indexesQuery: () => ({ list: "indexes" }) }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));

import { emptySelection, select, selectAll, selectColumn, selectedColumns, selectedRows, sliceOf, type GridLayout, type GridSelection } from "../grid-selection";
import { gridSelectionCopy } from "../grid-selection.copy";
import { addRow, editCell, noEdits, type PendingEdits } from "../record-edits";
import { generateSqlCopy } from "./generate-sql.copy";
import { useGridGenerateSql, type RecordsTable } from "./use-grid-generate-sql";

const reasons = generateSqlCopy.reasons;

const shown: RowsState = {
  status: "rows",
  id: 1,
  target: { sql: "select id, cliente from estoque.pedido", offset: 0 },
  columns: [
    { name: "id", type: "integer", kind: "number" },
    { name: "cliente", type: "text", kind: "text" },
  ],
  rows: [
    ["1", "Ana"],
    ["2", "cortado…"],
  ],
  truncated: new Map([[1, new Set([1])]]),
  hasMore: false,
  totalRows: null,
  elapsedMs: 1,
  pages: 1,
  loadingMore: false,
  cancelling: false,
  cursorClosed: false,
  total: null,
  counting: false,
  resultId: "r1",
};

const pedido = (keyColumns = ["id"]): SqlTarget => ({
  tables: [{ schema: "estoque", name: "pedido", key: [0], editable: true, reason: null, kind: "table", keyColumns }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "cliente", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
});

type Fake = GridSelectionContext & { held: { taken: number; released: number } };

function fakeContext(change: Partial<GridSelectionContext> & { selection?: GridSelection; pending?: PendingEdits } = {}): Fake {
  const pending = change.pending ?? noEdits;
  const layout: GridLayout = { read: shown.rows.length, added: pending.added.map((row) => row.id), columns: 2 };
  const selection = change.selection ?? select(emptySelection, { row: 0, column: 1 }, layout);
  const held = { taken: 0, released: 0 };
  return {
    resultId: "r1",
    shown,
    engine: 1,
    subject: "result",
    target: null,
    layout,
    rows: selectedRows(selection, layout),
    columns: selectedColumns(selection, layout),
    wholeColumns: null,
    rowsToLoad: false,
    total: null,
    loadRest: vi.fn(),
    slice: (scope = "cells") => sliceOf(selection, layout, { columns: shown.columns, valueAt: (row, column) => shown.rows[row]?.[column] ?? null, truncatedAt: () => false, generatedAt: () => false }, scope),
    complete: vi.fn(),
    fullValues: vi.fn(async () => ({ valueOf: (row: number, column: number) => (row === 1 && column === 1 ? "cortado e inteiro" : undefined), missing: 0 })),
    busy: false,
    hold: () => {
      held.taken++;
      return () => void held.released++;
    },
    moved: () => false,
    ensureTarget: vi.fn(),
    sqlTarget: vi.fn(async (): Promise<TargetAnswer> => ({ kind: "target", target: pedido() })),
    knownSqlTarget: () => null,
    copying: () => () => {},
    ...change,
    selection,
    pending,
    held,
  };
}

let openQueryTab: ReturnType<typeof vi.fn<(connectionId: string, sql: string, database?: string) => void>>;
let records: RecordsTable | null;
let readOnly: boolean;
const render = () => rt.render(() => useGridGenerateSql({ connectionId: "c1", database: "vendas", userName: null, records: () => records, readOnlyConnection: () => readOnly, openQueryTab }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  openQueryTab = vi.fn();
  records = null;
  readOnly = false;
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
});
afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

describe("o submenu \"Gerar SQL\" (RN-GRADE-006)", () => {
  it("habilitar não custa consulta: sem o alvo os seis valem, e nada é perguntado", () => {
    const context = fakeContext();
    const states = render().source.access(context);

    expect(Object.values(states).every((state) => state?.editable === true)).toBe(true);
    expect(context.sqlTarget).not.toHaveBeenCalled();
  });

  it("só linhas novas na seleção: os cinco das linhas dizem por quê, e o CREATE vale; a aba ocupada e a atualização automática desabilitam os seis", () => {
    const { edits } = addRow(noEdits);
    const onlyNew = fakeContext({ pending: edits, selection: select(emptySelection, { row: 2, column: 0 }, { read: 2, added: edits.added.map((row) => row.id), columns: 2 }) });
    const states = render().source.access(onlyNew);
    expect(states.update).toEqual({ editable: false, reason: reasons.onlyNewRows });
    expect(states.create).toEqual({ editable: true });

    expect(render().source.access(fakeContext({ busy: true })).create).toEqual({ editable: false, reason: reasons.unavailable(reasons.busy) });
    expect(render().source.access(fakeContext({ busy: "refresh" })).insert).toEqual({ editable: false, reason: reasons.unavailable(reasons.refreshing) });
  });

  it("o alvo que a tela já sabe decide desde o começo: a chave que não está inteira desabilita os que precisam dela, com o motivo da edição", () => {
    const states = render().source.access(fakeContext({ knownSqlTarget: () => ({ kind: "target", target: pedido(["id", "loja"]) }) }));
    expect(states.selectEquals).toEqual({ editable: false, reason: reasons.unavailable(reasons.keyIncomplete("pedido", ["loja"])) });
    expect(states.insert).toEqual({ editable: true });

    const notEditable = render().source.access(fakeContext({ knownSqlTarget: () => ({ kind: "notEditable", reason: "DISTINCT" }) }));
    expect(notEditable.update).toEqual({ editable: false, reason: reasons.oneTable("DISTINCT") });
    expect(notEditable.insert).toEqual({ editable: true });
  });

  it("nos Registros, o CREATE de uma visão vem desabilitado desde o começo", () => {
    records = { schema: "estoque", name: "resumo", kind: "view" };
    expect(render().source.access(fakeContext()).create).toEqual({ editable: false, reason: reasons.unavailable(reasons.view("resumo")) });
  });

  it("nos Registros, o CREATE escolhido primeiro não desabilita os outros: o plano dele é o da tabela da aba, sem colunas nem chave, e não vem do alvo", async () => {
    records = { schema: "estoque", name: "pedido", kind: "table" };
    const context = fakeContext();
    render().source.choose("sql:create", context);
    await settle();
    expect(render().dialog!.view.body).toMatchObject({ kind: "text" });
    expect(context.sqlTarget).not.toHaveBeenCalled();
    render().dialog!.onClose();

    const states = render().source.access(fakeContext());
    expect(Object.values(states).every((state) => state?.editable === true)).toBe(true);
  });
});

describe("o diálogo aberto pela grade (RN-GRADE-018)", () => {
  it("as linhas são as da seleção daquele instante, com a pendência e o lido; o alvo é o do contexto, e a pausa dura até fechar", async () => {
    const pending = editCell(noEdits, 0, 1, "Ana Maria", "Ana");
    const context = fakeContext({ pending, selection: selectAll(emptySelection, { read: 2, added: [], columns: 2 }) });
    render().source.choose("sql:update", context);
    expect(context.held.taken).toBe(1);
    await settle();

    const dialog = render().dialog!;
    expect(context.sqlTarget).toHaveBeenCalledWith();
    // A célula cortada da linha 2 vem pela linha da grade (a posição 1).
    expect(context.fullValues).toHaveBeenCalledWith([{ row: 1, column: 1 }], expect.any(AbortSignal));
    expect(dialog.view.subtitle).toBe(`UPDATE${generateSqlCopy.dialog.separator}estoque.pedido${generateSqlCopy.dialog.separator}2 linhas`);
    expect(dialog.view.body).toEqual({
      kind: "text",
      text: 'UPDATE "estoque"."pedido"\nSET "cliente" = \'Ana Maria\'\nWHERE "id" = 1;\n\nUPDATE "estoque"."pedido"\nSET "cliente" = \'cortado e inteiro\'\nWHERE "id" = 2;',
    });
    expect(dialog.view.warnings).toEqual([generateSqlCopy.warnings.pending(1)]);

    dialog.onClose();
    expect(context.held.released).toBe(1);
    expect(render().dialog).toBeNull();
  });

  it("o texto não é refeito a cada renderização de quem mostra o diálogo: só quando a fase ou as opções mudam", async () => {
    render().source.choose("sql:update", fakeContext());
    await settle();
    const first = render().dialog!;
    expect(render().dialog!.view).toBe(first.view);

    first.onOption({ compact: true });
    const compact = render().dialog!.view;
    expect(compact).not.toBe(first.view);
    expect(compact.body).toEqual({ kind: "text", text: 'UPDATE "estoque"."pedido" SET "cliente" = \'Ana\' WHERE "id" = 1;' });
    expect(render().dialog!.view).toBe(compact);
  });

  it("a conexão somente leitura avisa que o SQL que grava será recusado; \"Abrir numa aba de consulta\" vai à conexão e ao banco da aba", async () => {
    readOnly = true;
    const context = fakeContext();
    render().source.choose("sql:delete", context);
    await settle();
    const dialog = render().dialog!;
    expect(dialog.view.warnings).toContain(generateSqlCopy.warnings.readOnly);

    dialog.onOpenInTab();
    expect(openQueryTab).toHaveBeenCalledWith("c1", 'DELETE FROM "estoque"."pedido"\nWHERE "id" = 1;', "vendas");
    expect(context.held.released).toBe(1);
  });

  it("a linha nova ainda não salva só conta, com o aviso; o resultado que mudou não gera nada", async () => {
    const { edits } = addRow(noEdits);
    const layout = { read: 2, added: edits.added.map((row) => row.id), columns: 2 };
    const context = fakeContext({ pending: edits, selection: selectAll(emptySelection, layout) });
    render().source.choose("sql:insert", context);
    await settle();
    expect(render().dialog!.view.warnings).toContain(generateSqlCopy.warnings.newRows);
    render().dialog!.onClose();

    const moved = fakeContext({ moved: () => true });
    render().source.choose("sql:delete", moved);
    await settle();
    expect(render().dialog!.view.body).toEqual({ kind: "refused", text: generateSqlCopy.dialog.changed });
  });

  it("o menu tem os seis itens com os nomes do print, os mesmos do diálogo", () => {
    expect(generateSqlCopy.items).toBe(gridSelectionCopy.menu.sql);
    expect(generateSqlCopy.menu).toBe(gridSelectionCopy.menu.generateSql);
  });
});

describe("com colunas inteiras, o \"Gerar SQL\" carrega antes as linhas que faltam (RN-GRADE-023)", () => {
  it("depois de conferir a tabela, o lugar do SQL diz o andamento, e o texto é de todas as linhas que chegaram", async () => {
    const whole = selectColumn(emptySelection, 1, { read: 1, added: [], columns: 2 });
    const all = fakeContext({ selection: whole, wholeColumns: [1], rowsToLoad: false, total: 2 });
    let progressShown: string | null = null;
    const loadRest = vi.fn<GridSelectionContext["loadRest"]>(async (options) => {
      options?.onProgress?.("Carregando as linhas que faltam… 1 linha");
      progressShown = render().dialog?.view.body.kind === "status" ? (render().dialog!.view.body as { text: string }).text : null;
      // A conta do limite recebe as linhas que já estavam e as de cada página.
      expect(options?.keepGoing?.(shown, 0)).toBe(true);
      return { kind: "ready", context: all };
    });
    const first = fakeContext({ selection: whole, wholeColumns: [1], rowsToLoad: true, total: null, loadRest, rows: [0] });

    render().source.choose("sql:update", first);
    await settle();
    await settle();

    expect(loadRest).toHaveBeenCalledOnce();
    expect(progressShown).toBe("Carregando as linhas que faltam… 1 linha");
    const view = render().dialog!.view;
    expect(view.body).toMatchObject({ kind: "text" });
    expect(view.subtitle).toContain("2 linhas");
  });

  it("o limite de 1 MB durante o carregar recusa com a frase dele; as linhas que não vêm, com a recusa do carregar", async () => {
    const whole = selectColumn(emptySelection, 1, { read: 1, added: [], columns: 2 });
    const stopped = fakeContext({ selection: whole, wholeColumns: [1], rowsToLoad: true, loadRest: async () => ({ kind: "stopped" }) });
    render().source.choose("sql:update", stopped);
    await settle();
    await settle();
    expect(render().dialog!.view.body).toEqual({ kind: "refused", text: generateSqlCopy.dialog.tooLarge });

    const refused = fakeContext({ selection: whole, wholeColumns: [1], rowsToLoad: true, loadRest: async () => ({ kind: "refused", reason: gridSelectionCopy.loadRest.busy, detail: null }) });
    render().source.choose("sql:update", refused);
    await settle();
    await settle();
    expect(render().dialog!.view.body).toEqual({ kind: "refused", text: gridSelectionCopy.loadRest.busy });
  });
});
