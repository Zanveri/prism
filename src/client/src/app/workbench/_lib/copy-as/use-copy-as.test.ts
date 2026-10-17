import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TargetAnswer } from "../generate-sql/generate-sql-flow";
import type { SqlTarget } from "../record-edits.schema";
import type { RowsState } from "../use-query-runner";
import type { GridSelectionContext } from "../use-record-edits";

// A ligação do "Copiar avançado" (RN-GRADE-003, 016 e 017, seção 37) com a grade, pelo gancho com os ganchos do React simulados (`createHookRuntime`): o que
// cada item do submenu faz com o contexto da grade (a pausa, a faixa, o alvo, a busca dos valores completos), com a área de transferência e com os avisos.
// O contexto é de mentira, com a seleção, o recorte e a grade de verdade (`grid-selection.ts`); os escritores e a cópia são os de verdade.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return { ...createHookRuntime(), toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));

import { defaultOptions } from "../data-export/export-options";
import { writeDocument } from "../grid-export/documents";
import type { KeepGoing } from "../full-values";
import { emptySelection, select, selectedColumns, selectedRows, selectRow, sliceOf, type GridLayout, type GridSelection, type SelectionSlice, type SliceSource } from "../grid-selection";
import { gridSelectionCopy } from "../grid-selection.copy";
import { noEdits } from "../record-edits";
import { recordsCopy } from "../records.copy";
import { copyAsChoicesKey } from "./copy-as-choices";
import { copyAsCopy } from "./copy-as.copy";
import { useCopyAs } from "./use-copy-as";

const columns: RowsState["columns"] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "nome", type: "text", kind: "text" },
];
const values = [
  ["1", "Ana"],
  ["2", "cortado…"],
];
const layout: GridLayout = { read: 2, added: [], columns: 2 };

const shown: RowsState = {
  status: "rows",
  id: 1,
  target: { sql: "select id, nome from estoque.pedido", offset: 0 },
  columns,
  rows: values,
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

const pedido: SqlTarget = {
  tables: [{ schema: "estoque", name: "pedido", key: [0], editable: true, reason: null, kind: "table", keyColumns: ["id"] }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: "always" },
    { table: 0, baseColumn: "nome", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

type Fake = GridSelectionContext & { held: { taken: number; released: number }; tracked: { started: AbortController[]; done: number } };

/** O contexto da grade de mentira, com a seleção de verdade sobre as duas linhas: a célula `nome` da primeira, por padrão. */
function fakeContext(change: Partial<GridSelectionContext> & { selection?: GridSelection } = {}): Fake {
  const selection = change.selection ?? select(emptySelection, { row: 0, column: 1 }, layout);
  const source: SliceSource = { columns, valueAt: (row, column) => values[row][column], truncatedAt: (row, column) => shown.truncated.get(row)?.has(column) === true, generatedAt: () => false };
  const held = { taken: 0, released: 0 };
  const tracked = { started: [] as AbortController[], done: 0 };
  return {
    resultId: "r1",
    shown,
    engine: 1,
    subject: "result",
    target: null,
    layout,
    rows: selectedRows(selection, layout),
    columns: selectedColumns(selection, layout),
    slice: (scope = "cells") => sliceOf(selection, layout, source, scope),
    complete: vi.fn(async (slice: SelectionSlice) => ({ slice: { ...slice, rows: slice.rows.map((row) => row.map((value) => (value === "cortado…" ? "cortado e inteiro" : value))), truncated: [] }, missing: 0, stopped: false })),
    fullValues: vi.fn(),
    pending: noEdits,
    busy: false,
    hold: () => {
      held.taken++;
      return () => void held.released++;
    },
    moved: () => false,
    ensureTarget: vi.fn(),
    sqlTarget: vi.fn(async (): Promise<TargetAnswer> => ({ kind: "target", target: pedido })),
    knownSqlTarget: () => null,
    copying: (controller) => {
      tracked.started.push(controller);
      return () => void tracked.done++;
    },
    ...change,
    selection,
    held,
    tracked,
  };
}

let writeText: ReturnType<typeof vi.fn<(text: string) => Promise<void>>>;
const render = (records: { schema: string; name: string } | null = null) => rt.render(() => useCopyAs({ records, userName: () => "ana", writeText }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** O texto que o escritor do formato monta para estas linhas e colunas, com as opções padrão da exportação. */
const expected = (format: "csv" | "json", rows: (string | null)[][], names: string[], sourceName = "resultado") =>
  writeDocument(
    format,
    { engine: 1, sourceName, columns: names.map((name) => ({ ...columns.find((column) => column.name === name)!, generated: null })), options: defaultOptions({ schema: "", table: "" }) },
    rows.map((row, index) => ({ values: row, number: index + 1 })),
  ).text;

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn(async () => {});
});
afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
});

describe("o submenu \"Copiar avançado\" (RN-GRADE-003)", () => {
  it("vale com uma célula ativa, também no resultado só leitura; sem ela, o diálogo e os nove \"Copiar como\" pedem uma", () => {
    const { source } = render();

    expect(source.access(fakeContext())).toEqual({ dialog: { editable: true }, configure: { editable: true } });
    const none = source.access(fakeContext({ selection: emptySelection }));
    expect(none.dialog).toEqual({ editable: false, reason: gridSelectionCopy.copy.chooseCell });
    expect(none.formats?.json).toEqual({ editable: false, reason: gridSelectionCopy.copy.chooseCell });
    expect(none.configure).toEqual({ editable: true });
  });
});

describe("\"Copiar como <formato>\" (RN-GRADE-016)", () => {
  it("copia na hora as células escolhidas no formato, com o aviso dele; a pausa e a faixa \"Copiando…\" duram do clique ao texto", async () => {
    const context = fakeContext();
    render().source.choose("copyAs:csv", context);
    await settle();

    expect(writeText).toHaveBeenCalledWith(expected("csv", [["Ana"]], ["nome"]));
    expect(rt.toast.success).toHaveBeenCalledWith(copyAsCopy.notice.copied(1, "csv"));
    expect(context.held).toEqual({ taken: 1, released: 1 });
    expect(context.tracked.started).toHaveLength(1);
    expect(context.tracked.done).toBe(1);
    // Fora do SQL e do DbUnit, a tabela de destino não importa: não pergunta o alvo.
    expect(context.sqlTarget).not.toHaveBeenCalled();
  });

  it("as linhas inteiras escolhidas pelo número, com a célula cortada no valor completo, pela busca do contexto", async () => {
    const context = fakeContext({ selection: selectRow(emptySelection, 1, layout) });
    render().source.choose("copyAs:json", context);
    await settle();

    expect(context.complete).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(expected("json", [["2", "cortado e inteiro"]], ["id", "nome"]));
  });

  it("só as cortadas que o documento escreve vão à busca (RN-SQL-017), e o lote volta à cópia pela posição no recorte; a que não vai continua cortada", async () => {
    const asked: SelectionSlice[] = [];
    const answers: (boolean | undefined)[] = [];
    const selection = selectRow(emptySelection, 1, layout);
    const plain = fakeContext({ selection });
    const context = fakeContext({
      selection,
      // O `id` e o `nome` da linha 2 chegaram cortados; o `id` é dos que o banco calcula, e o INSERT sem "Incluir as colunas que o banco calcula" o deixa de fora.
      slice: (scope) => ({ ...plain.slice(scope), truncated: [[0, 0], [0, 1]] }),
      complete: vi.fn(async (slice: SelectionSlice, keepGoing?: KeepGoing) => {
        asked.push(slice);
        answers.push(keepGoing?.([{ cell: { row: 1, column: 1, resultRow: 1 }, value: "cortado e inteiro" }]));
        return { slice: { ...slice, rows: [[slice.rows[0][0], "cortado e inteiro"]], truncated: [] }, missing: 0, stopped: false };
      }),
      knownSqlTarget: () => ({ kind: "target", target: pedido }),
    });
    render().source.choose("copyAs:sql", context);
    await settle();

    expect(asked.map((slice) => slice.truncated)).toEqual([[[0, 1]]]);
    expect(answers).toEqual([true]);
    expect(writeText.mock.calls[0][0]).toContain(`INSERT INTO "estoque"."pedido" ("nome") VALUES`);
    expect(writeText.mock.calls[0][0]).toContain("'cortado e inteiro'");
  });

  it("a busca que o texto passou do limite para, e a cópia é a recusa do limite, sem ir à área de transferência", async () => {
    const context = fakeContext({
      selection: selectRow(emptySelection, 1, layout),
      complete: vi.fn(async (slice: SelectionSlice) => ({ slice, missing: 1, stopped: true })),
    });
    render().source.choose("copyAs:json", context);
    await settle();

    expect(writeText).not.toHaveBeenCalled();
    expect(rt.toast.error).toHaveBeenCalledWith(copyAsCopy.notice.tooLarge);
  });

  it("as opções lembradas do \"Copiar como\" são as da chave dele, não as da exportação", async () => {
    const stored = new Map([[copyAsChoicesKey("ana"), JSON.stringify({ format: "csv", options: { csv: { delimiter: "|", header: false } } })]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => stored.get(key) ?? null, setItem: vi.fn() });
    const context = fakeContext({ selection: selectRow(emptySelection, 0, layout) });
    render().source.choose("copyAs:csv", context);
    await settle();

    expect(writeText).toHaveBeenCalledWith("1|Ana\r\n");
  });

  it("o SQL sem o alvo pergunta a tabela antes, com \"Conferindo a tabela deste resultado…\"; o INSERT vai para a tabela do alvo, sem a coluna que o banco calcula", async () => {
    const context = fakeContext({ selection: selectRow(emptySelection, 0, layout) });
    render().source.choose("copyAs:sql", context);
    await settle();

    expect(context.sqlTarget).toHaveBeenCalledWith(copyAsCopy.checkingTable);
    const text = writeText.mock.calls[0][0];
    expect(text).toContain('INSERT INTO "estoque"."pedido" ("nome")');
    expect(text).not.toContain('"id"');
  });

  it("o alvo que a tela já sabe não é perguntado de novo; com a aba ocupada, não se pergunta, e a tabela fica como não conhecida", async () => {
    const known = fakeContext({ knownSqlTarget: () => ({ kind: "target", target: pedido }) });
    render().source.choose("copyAs:dbUnit", known);
    await settle();
    expect(known.sqlTarget).not.toHaveBeenCalled();
    expect(writeText.mock.calls[0][0]).toContain("<PEDIDO");

    const busy = fakeContext({ busy: true });
    const view = render();
    view.source.choose("copyAs:sql", busy);
    await settle();
    expect(busy.sqlTarget).not.toHaveBeenCalled();
    // Sem tabela conhecida, abre o "Copiar avançado…" no formato, com o foco no campo da tabela; a pausa passa a ser do diálogo.
    const dialog = render().advanced!;
    expect(dialog).toMatchObject({ initialFormat: "sql", focusTable: true });
    expect(dialog.sources.cells.table).toBeNull();
    expect(busy.held).toEqual({ taken: 1, released: 0 });
    dialog.onClose();
    expect(busy.held).toEqual({ taken: 1, released: 1 });
    expect(render().advanced).toBeNull();
  });

  it("nos Registros o DbUnit tem a tabela da aba e não pergunta; o nome da origem é o da tabela", async () => {
    const context = fakeContext();
    const records = { schema: "estoque", name: "pedido" };
    render(records).source.choose("copyAs:json", context);
    await settle();
    expect(context.sqlTarget).not.toHaveBeenCalled();
    expect(writeText.mock.calls[0][0]).toContain('"pedido"');

    render(records).source.choose("copyAs:dbUnit", context);
    await settle();
    expect(context.sqlTarget).not.toHaveBeenCalled();
    expect(writeText.mock.calls[1][0]).toContain("<PEDIDO");
  });

  it("RN-GRADE-016: na junção com dois id, o \"Copiar como SQL\" é recusado com o motivo no aviso, sem abrir o diálogo e sem tocar a área de transferência; o CSV copia", async () => {
    const joinColumns: RowsState["columns"] = [columns[0], columns[0], columns[1]];
    const joinLayout: GridLayout = { read: 1, added: [], columns: 3 };
    const selection = selectRow(emptySelection, 0, joinLayout);
    const joinSource: SliceSource = { columns: joinColumns, valueAt: (_row, column) => ["1", "10", "Ana"][column], truncatedAt: () => false, generatedAt: () => false };
    const join = () =>
      fakeContext({ selection, layout: joinLayout, rows: [0], columns: [0, 1, 2], slice: (scope = "cells") => sliceOf(selection, joinLayout, joinSource, scope), knownSqlTarget: () => ({ kind: "notEditable", reason: "a junção não tem uma tabela só" }) });

    const context = join();
    const view = render();
    expect(view.source.access(context).formats).toBeUndefined();
    view.source.choose("copyAs:sql", context);
    await settle();
    expect(rt.toast.error).toHaveBeenCalledWith(copyAsCopy.notice.duplicateColumn("id"));
    expect(copyAsCopy.notice.duplicateColumn("id")).toBe("O resultado tem duas colunas chamadas id: deixe uma de fora da seleção.");
    expect(writeText).not.toHaveBeenCalled();
    expect(render().advanced).toBeNull();
    expect(context.held).toEqual({ taken: 1, released: 1 });

    render().source.choose("copyAs:csv", join());
    await settle();
    expect(writeText.mock.calls[0][0]).toContain("id;id;nome");
  });

  it("a recusa do limite é a frase do \"Copiar\", uma só; a área de transferência que recusa é o aviso de atenção de hoje", async () => {
    expect(copyAsCopy.notice.tooLarge).toBe(gridSelectionCopy.copy.tooLarge);
    expect(copyAsCopy.notice.failed).toBe(recordsCopy.edit.menu.notCopied);

    writeText.mockRejectedValue(new Error("negado"));
    const context = fakeContext();
    render().source.choose("copyAs:csv", context);
    await settle();
    expect(rt.toast.warning).toHaveBeenCalledWith(recordsCopy.edit.menu.notCopied);
    expect(context.held).toEqual({ taken: 1, released: 1 });
  });
});

describe("o diálogo \"Copiar avançado…\" e o \"Configurar comandos 'Copiar como'…\" (RN-GRADE-003 e 017)", () => {
  it("abre com as três origens, depois de perguntar o alvo; a cópia de cada escolha busca os completos do recorte dela, avisa e o diálogo fecha", async () => {
    const context = fakeContext();
    render().source.choose("copyAdvanced", context);
    await settle();

    expect(context.sqlTarget).toHaveBeenCalledWith(copyAsCopy.checkingTable);
    const dialog = render().advanced!;
    expect(dialog.sources.cells.rows).toHaveLength(1);
    expect(dialog.sources.rows.columns).toHaveLength(2);
    expect(dialog.sources.loaded.rows).toHaveLength(2);
    expect(dialog.sources.cells.table).toEqual({ schema: "estoque", name: "pedido" });
    expect(dialog.initial.format).toBe("csv");
    expect(context.held).toEqual({ taken: 1, released: 0 });

    const signal = new AbortController().signal;
    const outcome = await dialog.onCopy({ format: "json", options: dialog.initial.options, source: dialog.sources.loaded }, { signal, onPhase: vi.fn() });
    expect(outcome.kind).toBe("copied");
    expect(context.complete).toHaveBeenCalledWith(expect.objectContaining({ positions: [0, 1] }), expect.any(Function), signal);
    expect(rt.toast.success).toHaveBeenCalledWith(copyAsCopy.notice.copied(2, "json"));

    dialog.onClose();
    expect(context.held.released).toBe(1);
  });

  it("no diálogo, a recusa fica no alto dele, sem aviso", async () => {
    writeText.mockRejectedValue(new Error("negado"));
    const context = fakeContext({ knownSqlTarget: () => ({ kind: "notEditable", reason: "DISTINCT" }) });
    render().source.choose("copyAdvanced", context);
    await settle();
    const dialog = render().advanced!;
    expect(context.sqlTarget).not.toHaveBeenCalled();
    expect(dialog.sources.cells.table).toBeNull();

    const outcome = await dialog.onCopy({ format: "csv", options: dialog.initial.options, source: dialog.sources.cells }, { signal: new AbortController().signal, onPhase: vi.fn() });
    expect(outcome).toEqual({ kind: "failed", message: recordsCopy.edit.menu.notCopied });
    expect(rt.toast.warning).not.toHaveBeenCalled();
  });

  it("\"Configurar…\" abre com as escolhas do usuário; Salvar grava na chave do \"Copiar como\", avisa e fecha, soltando a pausa", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem });
    const context = fakeContext();
    render().source.choose("copyAsConfigure", context);
    const dialog = render().configure!;
    expect(context.held.taken).toBe(1);

    dialog.onSave(dialog.initial);
    expect(setItem).toHaveBeenCalledWith(copyAsChoicesKey("ana"), expect.any(String));
    expect(rt.toast.success).toHaveBeenCalledWith(copyAsCopy.configure.saved);
    expect(render().configure).toBeNull();
    expect(context.held.released).toBe(1);
  });
});
