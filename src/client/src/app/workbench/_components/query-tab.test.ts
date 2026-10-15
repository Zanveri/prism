import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import type { AutoRefreshBlocker, AutoRefreshState } from "../_lib/auto-refresh";
import type { ScriptChoice, ScriptRun } from "../_lib/script-run";
import type { EditTarget } from "../_lib/record-edits.schema";
import type { QueryRunner, RowsState, RunnerState, RunTarget } from "../_lib/use-query-runner";
import type { QueryTab } from "../_lib/workbench-model";

// A aba de consulta com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`: o vitest deste projeto não tem DOM), como o
// teste da vista Registros. O que se confere AQUI é a ligação da edição das células com o resultado de um comando (seção 22): o que a área de resultado
// recebe, a pergunta antes de executar outro comando com alterações não salvas, e o Salvar que deixa a grade com o que foi salvo, sem executar de novo.
// As decisões são de `record-edits.ts`, `cell-editing.ts` e `cell-menu.ts`, com teste próprio; as rotas da edição são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    queryClient: { getQueryData: () => undefined },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    service: { editTargetOrRefuse: vi.fn(), saveEditsOrRefuse: vi.fn(), previewEditsOrRefuse: vi.fn() },
    cells: { resultCells: vi.fn() },
    /** A área de trabalho é a tela mostrada (a rota); a aba à vista é a ativa com ela na tela (RN-SEG-001). */
    screen: { on: true },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => rt.queryClient }));
vi.mock("@/app/settings/_lib/use-preferences", () => ({ usePreferences: () => ({ preferences: { results: { nullText: "(nulo)", autoLoadMore: true }, editor: { autocomplete: true } } }) }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("../_lib/record-edits.service", () => rt.service);
vi.mock("../_lib/full-values.service", () => rt.cells);
vi.mock("../_lib/use-workbench-on-screen", () => ({ useWorkbenchOnScreen: () => rt.screen.on }));
// O editor de SQL é CodeMirror, que precisa da página; aqui basta o que a aba entrega a ele.
vi.mock("./sql-editor", () => ({ SqlEditor: function SqlEditor() {
  return null;
} }));

import { ContextMenu } from "@/components/ui";
import { groupItems } from "@/components/ui/context-menu";
import { elementsOf } from "@/lib/testing/react-tree";

import { editCell, noEdits } from "../_lib/record-edits";
import { recordsCopy } from "../_lib/records.copy";
import { forgetExcept, remember } from "../_lib/tab-memory";
import { unsavedEdits } from "../_lib/unsaved-edits";
import { isPersonBusy } from "../_lib/use-query-runner";
import { ConnectionPicker } from "./connection-picker";
import { DatabasePicker } from "./database-picker";
import { EditorToolbar } from "./editor-toolbar";
import { EditsBanner } from "./edits-banner";
import { QueryTabPanel } from "./query-tab";
import { ResultPanel } from "./result-panel";
import { SqlEditor } from "./sql-editor";
import { UnsavedEditsDialog } from "./unsaved-edits-dialog";
import { AutoRefreshControl, AutoRefreshDialog } from "./auto-refresh-control";
import { RecordsFilter } from "./table-tab/records-filter";
import type { FilterRefusal } from "../_lib/use-query-runner";

const copy = recordsCopy.edit;
/** PostgreSQL, como a API numera os bancos. */
const pg: Engine = 1;

const columns: RowsState["columns"] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "status", type: "text", kind: "text" },
];

/** `loja.pedido`, de uma tabela só, com a chave em `id`. */
const target: EditTarget = {
  tables: [{ schema: "loja", name: "pedido", key: [0], editable: true, reason: null }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};

function rowsState(over: Partial<RowsState> = {}): RowsState {
  return { status: "rows", id: 1, target: { sql: "select * from loja.pedido", offset: 0, engine: pg }, columns, rows: [["10", "aberta"]], truncated: new Map(), hasMore: true, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false, resultId: "r1", readOnly: null, ...over };
}

/**
 * O executor de mentira: `run` recusa calado com algo da pessoa em andamento, aceita no lugar da execução automática (RN-GRADE-014) e, quando aceita,
 * passa a "executando" na mesma chamada.
 */
function fakeRunner(initial: RunnerState) {
  const runner = {
    state: initial,
    /** Os comandos aceitos (o espião `run` conta também os recusados). */
    sent: [] as RunTarget[],
    subscribe: () => () => {},
    getState: (): RunnerState => runner.state,
    /** RN-GRADE-011: a recusa do filtro que o próximo `run` devolve (a API simulada respondendo 422 `FILTER_INVALID`). */
    refuse: null as FilterRefusal | null,
    run: vi.fn((target: RunTarget): Promise<FilterRefusal | void> => {
      if (runner.refuse !== null && target.filter !== undefined) {
        const refusal = runner.refuse;
        runner.refuse = null;
        return Promise.resolve(refusal);
      }
      if (!isPersonBusy(runner.state)) {
        runner.sent.push(target);
        runner.state = { status: "running", cancelling: false, previous: runner.state.status === "rows" ? runner.state : runner.state.status === "running" ? runner.state.previous : null };
      }
      return Promise.resolve();
    }),
    rerun: vi.fn(() => Promise.resolve()),
    /** RN-SQL-019: os scripts aceitos (o espião conta também os recusados), e o estado do script que a aba desenha. */
    scripts: [] as RunTarget[][],
    runScript: vi.fn((targets: RunTarget[]): Promise<void> => {
      if (!isPersonBusy(runner.state) && targets.length > 0) {
        runner.scripts.push(targets);
        runner.state = { status: "running", cancelling: false, previous: runner.state.status === "rows" ? runner.state : null };
      }
      return Promise.resolve();
    }),
    runCommand: vi.fn<(target: RunTarget) => Promise<void>>(() => Promise.resolve()),
    scriptState: null as ScriptRun | null,
    script: { subscribe: () => () => {}, getState: (): ScriptRun | null => runner.scriptState, decide: vi.fn<(choice: ScriptChoice) => void>() },
    cancel: vi.fn(),
    loadMore: vi.fn(),
    countTotal: vi.fn(),
    textEdited: vi.fn(),
    sessionOf: () => "s1",
    keepSaved: vi.fn(),
    /** RN-GRADE-014: o relógio da atualização automática, desligado; a prova lê as pausas e os pedidos de ligar e desligar. */
    autoRefresh: { subscribe: () => () => {}, getState: (): AutoRefreshState => ({ status: "off", stopped: null }), blocker: (): AutoRefreshBlocker | null => null, start: vi.fn(), stop: vi.fn(), pause: vi.fn() },
  };
  return runner;
}

const tab: QueryTab = { id: "q1", title: "Consulta 1", connectionId: "c1", sessionId: "s1", sql: "select * from loja.pedido" };

/** A aba `q1` na conexão `c1`, à vista. O painel é memorizado: a função dele é a de dentro do `memo`. */
function mount(runner: ReturnType<typeof fakeRunner>, over: Partial<QueryTab> = {}) {
  const panel = (QueryTabPanel as unknown as { type: (props: ComponentProps<typeof QueryTabPanel>) => ReactNode }).type;
  const props = { tab: { ...tab, ...over }, runner: runner as unknown as QueryRunner, engine: pg as Engine | undefined, active: true, onSqlChange: vi.fn(), onEdited: vi.fn(), onSave: vi.fn(), onSwitchConnection: vi.fn(), onOpenTable: vi.fn(), onSwitchDatabase: vi.fn() };

  /** O que a aba entrega agora à área de resultado, ao editor e às janelas por cima. Duas voltas, como no teste dos Registros: os efeitos da primeira mexem nos registros de módulo. */
  function show() {
    rt.render(() => panel(props));
    const found = elementsOf(rt.render(() => panel(props)));
    const area = found.find((element) => element.type === ResultPanel)!.props as unknown as ComponentProps<typeof ResultPanel>;
    const editor = found.find((element) => element.type === SqlEditor)!.props as unknown as ComponentProps<typeof SqlEditor>;
    const question = found.find((element) => element.type === UnsavedEditsDialog)?.props as unknown as ComponentProps<typeof UnsavedEditsDialog> | undefined;
    const menu = found.find((element) => element.type === ContextMenu)?.props as unknown as ComponentProps<typeof ContextMenu> | undefined;
    const banner = (area.banner as { type: unknown; props: ComponentProps<typeof EditsBanner> } | undefined) ?? null;
    const toolbar = found.find((element) => element.type === EditorToolbar)!.props as unknown as ComponentProps<typeof EditorToolbar>;
    const slot = toolbar.database as { type: unknown; props: ComponentProps<typeof DatabasePicker> } | null | undefined;
    const picker = slot?.type === DatabasePicker ? slot.props : null;
    const connectionSlot = toolbar.connection as { type: unknown; props: ComponentProps<typeof ConnectionPicker> } | null | undefined;
    const connection = connectionSlot?.type === ConnectionPicker ? connectionSlot.props : null;
    const noConnection = found.find((element) => typeof element.props.reason === "string" && typeof element.props.onAssign === "function")?.props as { reason: string; onAssign: (connectionId: string) => void } | undefined;
    const filterSlot = area.filter as { type: unknown; props: ComponentProps<typeof RecordsFilter> } | undefined;
    const filter = filterSlot?.type === RecordsFilter ? filterSlot.props : null;
    const keys = found.find((element) => typeof element.props.onKeyDown === "function")!.props.onKeyDown as (event: unknown) => void;
    const auto = elementsOf(area.autoRefresh).find((element) => element.type === AutoRefreshControl)?.props as unknown as ComponentProps<typeof AutoRefreshControl> | undefined;
    const autoDialog = found.find((element) => element.type === AutoRefreshDialog)?.props as unknown as ComponentProps<typeof AutoRefreshDialog> | undefined;

    return { area, editor, question, menu, banner, picker, connection, noConnection, filter, keys, auto, autoDialog, toolbar };
  }

  return { show, props };
}

/** Uma alteração pendente na coluna `status` da primeira linha do resultado `r1`. */
const withPending = () => remember("q1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 1, "paga", "aberta") });

/** Deixa as promessas em andamento chegarem ao fim. */
const settle = () => new Promise((done) => setTimeout(done, 0));

const command: RunTarget = { sql: "select 2", offset: 0, engine: pg };

/** O destaque do comando enviado (RN-SQL-018), para os testes que não olham para ele. */
const noFlash = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  forgetExcept(new Set());
  unsavedEdits.forgetExcept(new Set());
  rt.screen.on = true;
});

afterEach(() => rt.unmount());

describe("QueryTabPanel: a grade do resultado de um comando se edita como a dos Registros (seção 22, RN-EDIT-001)", () => {
  it("com linhas na tela, a área de resultado recebe a edição da grade e a faixa", () => {
    const { area, banner } = mount(fakeRunner(rowsState())).show();

    expect(area.editing?.rows).toEqual([["10", "aberta"]]);
    expect(banner?.type).toBe(EditsBanner);
    expect(banner?.props).toMatchObject({ pending: 0, readOnly: null, failure: null });
  });

  it("o resultado só leitura mostra o motivo que a página trouxe na faixa, no lugar dos Registros (RN-EDIT-002)", () => {
    const { banner } = mount(fakeRunner(rowsState({ readOnly: "união de consultas" }))).show();

    expect(banner?.props.readOnly).toBe(copy.readOnly("união de consultas"));
  });

  it("no resultado só leitura, o menu da célula mostra 'Editar célula' desabilitado, com o motivo; copiar continua", async () => {
    const view = mount(fakeRunner(rowsState({ readOnly: "união de consultas" })));

    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    const items = view.show().menu!.groups.flatMap(groupItems);

    expect(items.find((item) => item.label === copy.menu.edit)).toMatchObject({ disabled: true, hint: copy.readOnly("união de consultas") });
    expect(items.find((item) => item.label === copy.menu.copyValue)?.disabled).toBe(false);
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
  });

  it("as alterações não salvas vão ao registro da aba: fechar a aba pergunta antes, com Salvar (RN-EDIT-007)", () => {
    withPending();
    mount(fakeRunner(rowsState())).show();

    expect(unsavedEdits.countOf("q1")).toBe(1);
    expect(unsavedEdits.saveOf("q1")).not.toBeNull();
  });
});

describe("QueryTabPanel: copiar leva o valor completo da célula cortada (RN-SQL-017)", () => {
  const full = `{"json":"${"x".repeat(50_000)}"}`;
  const cut = () => rowsState({ rows: [["10", full.slice(0, 10_000)]], truncated: new Map([[0, new Set([1])]]) });
  let clipboard: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    clipboard = { writeText: vi.fn(async () => {}) };
    vi.stubGlobal("navigator", { clipboard });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("Ctrl+C na célula cortada pede o valor completo pela linha do resultado e copia o valor inteiro", async () => {
    rt.cells.resultCells.mockResolvedValue({ ok: true, data: [full] });
    const view = mount(fakeRunner(cut()));

    view.show().area.editing!.onCopy({ row: 0, column: 1 });
    await settle();

    expect(rt.cells.resultCells).toHaveBeenCalledWith("s1", "r1", [{ row: 0, column: 1 }], expect.any(AbortSignal));
    expect(clipboard.writeText.mock.calls).toEqual([[full]]);
    expect(rt.toast.success.mock.calls).toEqual([[copy.menu.copied]]);
  });

  it("'Copiar valor' do menu da célula também leva o valor completo", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.cells.resultCells.mockResolvedValue({ ok: true, data: [full] });
    const view = mount(fakeRunner(cut()));

    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    view.show().menu!.groups.flatMap(groupItems).find((item) => item.label === copy.menu.copyValue)!.onSelect!();
    await settle();

    expect(clipboard.writeText.mock.calls).toEqual([[full]]);
  });

  it("sem célula cortada, nada é pedido: copia o que a grade tem", async () => {
    const view = mount(fakeRunner(cut()));

    view.show().area.editing!.onCopy({ row: 0, column: 0 });
    await settle();

    expect(rt.cells.resultCells).not.toHaveBeenCalled();
    expect(clipboard.writeText.mock.calls).toEqual([["10"]]);
  });

  it("sem o valor completo (o resultado mudou), copia o cortado e avisa quantos não vieram inteiros", async () => {
    rt.cells.resultCells.mockResolvedValue({ ok: false, error: { status: 404, code: "RESULT_NOT_FOUND", title: "Resultado não localizado.", detail: null, errors: null, extensions: {} } });
    const view = mount(fakeRunner(cut()));

    view.show().area.editing!.onCopy({ row: 0, column: 1 });
    await settle();

    expect(clipboard.writeText.mock.calls).toEqual([[full.slice(0, 10_000)]]);
    expect(rt.toast.warning.mock.calls).toEqual([[copy.menu.copiedCut(1)]]);
  });

  it("enquanto busca, a faixa mostra que está buscando; cancelar não copia nada, e a grade segue livre", async () => {
    let answer: (value: unknown) => void = () => {};
    rt.cells.resultCells.mockImplementation((_session: string, _result: string, _cells: unknown, signal: AbortSignal) => new Promise((done) => {
      answer = done;
      signal.addEventListener("abort", () => done({ ok: false, error: { status: 0, code: "NETWORK_ERROR", title: "Sem resposta da API.", detail: null, errors: null, extensions: {} } }));
    }));
    const view = mount(fakeRunner(cut()));

    view.show().area.editing!.onCopy({ row: 0, column: 1 });
    const busy = view.show();
    busy.banner!.props.onCancelFetch();
    await settle();
    answer({ ok: true, data: [full] });
    await settle();

    expect(busy.banner!.props.fetching).toBe(true);
    expect(busy.area.editing).toBeDefined();
    expect(view.show().banner!.props.fetching).toBe(false);
    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(rt.toast.error).not.toHaveBeenCalled();
  });
});

describe("QueryTabPanel: com alterações não salvas, executar pergunta antes (RN-EDIT-007)", () => {
  it("executar outro comando pergunta e não executa; Descartar executa o comando pedido", () => {
    withPending();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().editor.onRun(command, noFlash);
    const { question } = view.show();

    expect(runner.run).not.toHaveBeenCalled();
    expect(question).toMatchObject({ count: 1, canSave: true });

    question!.onDiscard();
    expect(runner.run).toHaveBeenCalledWith(command);
  });

  it("Cancelar na pergunta não executa nada e mantém as pendências", () => {
    withPending();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().editor.onRun(command, noFlash);
    view.show().question!.onCancel();
    const after = view.show();

    expect(runner.run).not.toHaveBeenCalled();
    expect(after.question).toBeUndefined();
    expect(after.banner?.props.pending).toBe(1);
  });

  it("'Executar de novo' também pergunta antes", () => {
    withPending();
    const runner = fakeRunner(rowsState({ cursorClosed: true }));
    const view = mount(runner);

    view.show().area.onRerun();
    expect(runner.rerun).not.toHaveBeenCalled();

    view.show().question!.onDiscard();
    expect(runner.rerun).toHaveBeenCalledTimes(1);
  });

  it("sem alteração pendente, executar não pergunta; com o comando que o executor não vai enviar (dois comandos), também não: ele só avisa", () => {
    const free = fakeRunner(rowsState());
    mount(free).show().editor.onRun(command, noFlash);
    expect(free.run).toHaveBeenCalledWith(command);
    rt.unmount();

    withPending();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    const several = { ...command, sql: "select 1; select 2" };
    view.show().editor.onRun(several, noFlash);

    expect(runner.run).toHaveBeenCalledWith(several);
    expect(view.show().question).toBeUndefined();
  });
});

describe("QueryTabPanel: o destaque do comando enviado acende só quando ele vai ao banco (RN-SQL-018)", () => {
  it("com a aba livre, acende uma vez, junto com o envio", () => {
    const runner = fakeRunner(rowsState());
    const flash = vi.fn();

    mount(runner).show().editor.onRun(command, flash);

    expect(runner.sent).toEqual([command]);
    expect(flash).toHaveBeenCalledTimes(1);
  });

  it("com um comando em andamento, o executor não envia nada, e nada acende (o Ctrl+Enter no editor, com o Cancelar na barra)", () => {
    for (const state of [{ status: "running", cancelling: false, previous: null }, rowsState({ loadingMore: true }), rowsState({ counting: true })] satisfies RunnerState[]) {
      const runner = fakeRunner(state);
      const flash = vi.fn();

      mount(runner).show().editor.onRun(command, flash);

      expect(runner.sent).toEqual([]);
      expect(flash).not.toHaveBeenCalled();
      rt.unmount();
    }
  });

  it("com mais de um comando ou nenhum, o executor só avisa, e nada acende", () => {
    for (const sql of ["select 1; select 2", "", "-- só um comentário"]) {
      const flash = vi.fn();
      mount(fakeRunner(rowsState())).show().editor.onRun({ ...command, sql }, flash);
      expect(flash, JSON.stringify(sql)).not.toHaveBeenCalled();
      rt.unmount();
    }
  });

  it("na aba sem conexão, o executor só pede uma, e nada acende (RN-SCRIPT-003)", () => {
    const runner = fakeRunner({ status: "idle" });
    const flash = vi.fn();

    mount(runner, { connectionId: null, sessionId: null }).show().editor.onRun(command, flash);

    expect(runner.run).toHaveBeenCalledWith(command);
    expect(flash).not.toHaveBeenCalled();
  });

  it("com alterações não salvas, acende só depois da pergunta, e só se ela não foi cancelada (RN-EDIT-007)", () => {
    withPending();
    const cancelled = vi.fn();
    const view = mount(fakeRunner(rowsState()));

    view.show().editor.onRun(command, cancelled);
    expect(cancelled).not.toHaveBeenCalled();
    view.show().question!.onCancel();
    expect(cancelled).not.toHaveBeenCalled();

    const discarded = vi.fn();
    view.show().editor.onRun(command, discarded);
    expect(discarded).not.toHaveBeenCalled();
    view.show().question!.onDiscard();
    expect(discarded).toHaveBeenCalledTimes(1);
  });
});

describe("QueryTabPanel: o Salvar deixa a grade com o que foi salvo, sem executar de novo (RN-EDIT-009)", () => {
  it("pergunta o alvo se ainda não sabe, grava pela sessão da aba e entrega ao executor as linhas salvas; o aviso diz quantas", async () => {
    withPending();
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.service.saveEditsOrRefuse.mockResolvedValue({ ok: true, data: { applied: 1 } });
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().banner!.props.onSave();
    await settle();

    expect(rt.service.editTargetOrRefuse).toHaveBeenCalledWith("s1", "r1", null);
    expect(rt.service.saveEditsOrRefuse).toHaveBeenCalledWith("s1", "r1", [{ kind: "update", table: 0, key: ["10"], set: [{ column: 1, value: "paga" }] }]);
    expect(runner.keepSaved).toHaveBeenCalledWith("r1", { rows: [["10", "paga"]], truncated: new Map(), generated: new Map() });
    expect(runner.run).not.toHaveBeenCalled();
    expect(runner.rerun).not.toHaveBeenCalled();
    expect(rt.toast.success).toHaveBeenCalledWith(copy.saved(1));
    expect(view.show().banner?.props.pending).toBe(0);
  });

  it("Salvar na pergunta antes de executar grava, deixa a grade salva e só então executa o comando pedido", async () => {
    withPending();
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.service.saveEditsOrRefuse.mockResolvedValue({ ok: true, data: { applied: 1 } });
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().editor.onRun(command, noFlash);
    view.show().question!.onSave();
    await settle();

    expect(runner.keepSaved).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith(command);
  });
});

describe("QueryTabPanel: num resultado de junção cada coluna se edita na tabela de onde veio (RN-EDIT-002)", () => {
  const joinColumns: RowsState["columns"] = [
    { name: "id", type: "int4", kind: "number" },
    { name: "status", type: "text", kind: "text" },
    { name: "cliente_id", type: "int4", kind: "number" },
    { name: "nome", type: "text", kind: "text" },
  ];
  /** `pedido p JOIN cliente c`: a chave de cada tabela não se edita; o cliente 7 aparece nas duas linhas. */
  const joinTarget: EditTarget = {
    tables: [
      { schema: "loja", name: "pedido", key: [0], editable: true, reason: null },
      { schema: "loja", name: "cliente", key: [2], editable: true, reason: null },
    ],
    columns: [
      { table: 0, baseColumn: "id", editable: false, reason: "coluna da chave numa junção", nullable: false, generated: null },
      { table: 0, baseColumn: "status", editable: true, reason: null, nullable: true, generated: null },
      { table: 1, baseColumn: "id", editable: false, reason: "coluna da chave numa junção", nullable: false, generated: null },
      { table: 1, baseColumn: "nome", editable: true, reason: null, nullable: true, generated: null },
    ],
    rowOperations: false,
    oneAtATime: false,
  };
  const joined = () => rowsState({ columns: joinColumns, rows: [["1", "aberta", "7", "Ana"], ["2", "aberta", "7", "Ana"]], hasMore: false });

  /** Abre o campo na célula, escreve e confirma, como a pessoa faz. */
  async function type(view: ReturnType<typeof mount>, row: number, column: number, text: string) {
    view.show().area.editing!.onEdit({ row, column });
    await settle();
    view.show().area.editing!.onDraft(text);
    view.show().area.editing!.onCommit();
  }

  it("a linha do cliente muda nas duas linhas da grade e conta uma alteração; o Salvar manda um UPDATE por tabela e a grade salva mostra o valor nas duas", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: joinTarget });
    rt.service.saveEditsOrRefuse.mockResolvedValue({ ok: true, data: { applied: 2 } });
    const runner = fakeRunner(joined());
    const view = mount(runner);

    await type(view, 0, 3, "Ana Maria");
    await type(view, 1, 1, "paga");
    const shown = view.show();

    expect([0, 1].map((row) => shown.area.editing!.marks.get(row)?.pending.get(3))).toEqual(["Ana Maria", "Ana Maria"]);
    expect(shown.banner!.props.pending).toBe(2);
    expect(shown.area.editing!.columnReadOnly).toEqual([true, false, true, false]);
    expect(shown.area.editing!.columnHints).toEqual([copy.readOnly("coluna da chave numa junção"), copy.editsColumn("pedido", "status"), copy.readOnly("coluna da chave numa junção"), copy.editsColumn("cliente", "nome")]);

    shown.banner!.props.onSave();
    await settle();

    expect(rt.service.saveEditsOrRefuse).toHaveBeenCalledWith("s1", "r1", [
      { kind: "update", table: 1, key: ["7"], set: [{ column: 3, value: "Ana Maria" }] },
      { kind: "update", table: 0, key: ["2"], set: [{ column: 1, value: "paga" }] },
    ]);
    expect(runner.keepSaved).toHaveBeenCalledWith("r1", { rows: [["1", "aberta", "7", "Ana Maria"], ["2", "paga", "7", "Ana Maria"]], truncated: new Map(), generated: new Map() });
  });

  it("Linha nova e Excluir linha ficam desabilitados no menu, com o motivo; a coluna da chave também", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: joinTarget });
    const view = mount(fakeRunner(joined()));

    view.show().area.editing!.onMenu({ row: 0, column: 2 }, { x: 4, y: 4 }, false);
    await settle();
    const items = view.show().menu!.groups.flatMap(groupItems);

    expect(items.find((item) => item.label === copy.menu.newRow)).toMatchObject({ disabled: true, hint: copy.readOnly(copy.reasons.joinRowOperations) });
    expect(items.find((item) => item.label === copy.menu.deleteRow)).toMatchObject({ disabled: true, hint: copy.readOnly(copy.reasons.joinRowOperations) });
    expect(items.find((item) => item.label === copy.menu.edit)).toMatchObject({ disabled: true, hint: copy.readOnly("coluna da chave numa junção") });
  });
});

describe("QueryTabPanel: o banco da aba na barra do editor (RN-ARVORE-007)", () => {
  it("a barra mostra o banco em que a aba roda, da conexão dela, e sabe se há comando em andamento", () => {
    const idle = mount(fakeRunner(rowsState()), { database: "vendas" }).show().picker;
    expect(idle).toMatchObject({ connectionId: "c1", database: "vendas", engine: pg, busy: false });
    rt.unmount();

    expect(mount(fakeRunner(rowsState({ loadingMore: true }))).show().picker?.busy).toBe(true);
  });

  it("a aba sem conexão não tem banco a trocar: a faixa pede a conexão antes", () => {
    expect(mount(fakeRunner({ status: "idle" }), { connectionId: null }).show().picker).toBeNull();
  });

  it("escolher outro banco passa a aba para ele, sem executar nada", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().picker!.onChoose("vendas");

    expect(view.props.onSwitchDatabase).toHaveBeenCalledWith("q1", "vendas");
    expect(runner.run).not.toHaveBeenCalled();
    expect(runner.rerun).not.toHaveBeenCalled();
  });

  it("com alterações não salvas na grade, a troca pergunta antes, como executar outro comando (RN-EDIT-007); Cancelar fica no banco", () => {
    withPending();
    const view = mount(fakeRunner(rowsState()));

    view.show().picker!.onChoose("vendas");
    const { question } = view.show();
    expect(view.props.onSwitchDatabase).not.toHaveBeenCalled();
    expect(question).toMatchObject({ count: 1, canSave: true });

    question!.onCancel();
    expect(view.props.onSwitchDatabase).not.toHaveBeenCalled();
    expect(view.show().banner?.props.pending).toBe(1);
  });

  it("Descartar na pergunta descarta as alterações e troca o banco", () => {
    withPending();
    const view = mount(fakeRunner(rowsState()));

    view.show().picker!.onChoose(undefined);
    view.show().question!.onDiscard();

    expect(view.props.onSwitchDatabase).toHaveBeenCalledWith("q1", undefined);
  });

  it("Salvar na pergunta grava pela sessão de antes e só então troca o banco", async () => {
    withPending();
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.service.saveEditsOrRefuse.mockResolvedValue({ ok: true, data: { applied: 1 } });
    const view = mount(fakeRunner(rowsState()));

    view.show().picker!.onChoose("vendas");
    view.show().question!.onSave();
    expect(view.props.onSwitchDatabase).not.toHaveBeenCalled();
    await settle();

    expect(rt.service.saveEditsOrRefuse).toHaveBeenCalledWith("s1", "r1", expect.any(Array));
    expect(view.props.onSwitchDatabase).toHaveBeenCalledWith("q1", "vendas");
  });
});

describe("QueryTabPanel: a conexão da aba na barra do editor (RN-ARVORE-008)", () => {
  const ctrl9 = (over: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; defaultPrevented: boolean }> = {}) => ({ key: "9", code: "Digit9", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...over });

  it("a barra mostra o botão da conexão da aba, antes do banco, fechado, e sabe se há comando em andamento", () => {
    const idle = mount(fakeRunner(rowsState())).show().connection;
    expect(idle).toMatchObject({ connectionId: "c1", busy: false, open: false });
    rt.unmount();

    expect(mount(fakeRunner(rowsState({ loadingMore: true }))).show().connection?.busy).toBe(true);
  });

  it("a aba sem conexão também tem o botão, sem conexão, e ele dá a conexão escolhida", () => {
    expect(mount(fakeRunner({ status: "idle" }), { connectionId: null }).show().connection).toMatchObject({ connectionId: null });
  });

  it("Ctrl+9 (ou Cmd+9) com o foco em qualquer ponto da aba abre a lista, e de novo, de dentro dela, a fecha; com Shift, ou já tratado, não", () => {
    const view = mount(fakeRunner(rowsState()));

    const event = ctrl9();
    view.show().keys(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(view.show().connection?.open).toBe(true);

    // Aberta, o foco está na busca da lista, e o teclado dela não sobe à aba: o segundo Ctrl+9 é tratado nela, que fecha pelo `onOpenChange` que recebeu
    // (a tecla dentro da lista é de `connection-picker.focus.test.ts`).
    view.show().connection!.onOpenChange(false);
    expect(view.show().connection?.open).toBe(false);

    view.show().keys(ctrl9({ ctrlKey: false, metaKey: true }));
    expect(view.show().connection?.open).toBe(true);
    // Com o foco no botão da conexão (que fica na aba), a tecla chega aqui e fecha.
    view.show().keys(ctrl9());
    expect(view.show().connection?.open).toBe(false);

    view.show().keys(ctrl9({ shiftKey: true }));
    view.show().keys(ctrl9({ defaultPrevented: true }));
    expect(view.show().connection?.open).toBe(false);
    expect(view.props.onSave).not.toHaveBeenCalled();
  });

  it("o botão abre e fecha a lista pelo mesmo estado", () => {
    const view = mount(fakeRunner(rowsState()));

    view.show().connection!.onOpenChange(true);
    expect(view.show().connection?.open).toBe(true);
    view.show().connection!.onOpenChange(false);
    expect(view.show().connection?.open).toBe(false);
  });

  it("escolher outra conexão passa a aba para ela, sem executar nada", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().connection!.onChoose("c2");

    expect(view.props.onSwitchConnection).toHaveBeenCalledWith("q1", "c2");
    expect(runner.run).not.toHaveBeenCalled();
    expect(runner.rerun).not.toHaveBeenCalled();
  });

  it("com alterações não salvas na grade, a troca pergunta antes (RN-EDIT-007): Cancelar fica na conexão, Descartar troca", () => {
    withPending();
    const view = mount(fakeRunner(rowsState()));

    view.show().connection!.onChoose("c2");
    expect(view.props.onSwitchConnection).not.toHaveBeenCalled();
    view.show().question!.onCancel();
    expect(view.props.onSwitchConnection).not.toHaveBeenCalled();

    view.show().connection!.onChoose("c2");
    view.show().question!.onDiscard();
    expect(view.props.onSwitchConnection).toHaveBeenCalledWith("q1", "c2");
  });

  it("a faixa da aba sem conexão diz por quê: o script cuja conexão sumiu, o genérico ou a aba que voltou; e escolher troca pela mesma via (RN-SCRIPT-003 e 005)", () => {
    const missing = mount(fakeRunner({ status: "idle" }), { connectionId: null, script: { id: "s1", name: "Fechamento", savedSql: "", dirty: false } });
    expect(missing.show().noConnection?.reason).toBe("scriptMissing");
    rt.unmount();

    expect(mount(fakeRunner({ status: "idle" }), { connectionId: null, script: { id: "s1", name: "Fechamento", savedSql: "", generic: true, dirty: false } }).show().noConnection?.reason).toBe("generic");
    rt.unmount();

    const restored = mount(fakeRunner({ status: "idle" }), { connectionId: null });
    expect(restored.show().noConnection?.reason).toBe("restored");
    restored.show().noConnection!.onAssign("c2");
    expect(restored.props.onSwitchConnection).toHaveBeenCalledWith("q1", "c2");
    rt.unmount();

    expect(mount(fakeRunner(rowsState())).show().noConnection).toBeUndefined();
  });
});

describe("QueryTabPanel: o campo de filtro no resultado (RN-GRADE-011)", () => {
  const filtered = (text: string) => ({ ...rowsState().target, filter: text });
  const key = (name: string) => ({ key: name, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault: vi.fn() });

  it("com linhas na tela, o campo dos Registros aparece acima da grade, com as colunas do resultado; sem resultado, não", () => {
    const { filter } = mount(fakeRunner(rowsState())).show();

    expect(filter).toMatchObject({ subject: "result", draft: "", applied: "", problem: null, command: null, engine: pg, autocomplete: true });
    expect(filter!.columns.map((column) => column.name)).toEqual(["id", "status"]);
    expect(mount(fakeRunner({ status: "idle" })).show().filter).toBeNull();
    expect(mount(fakeRunner({ status: "affected", rowsAffected: 1, elapsedMs: 1 })).show().filter).toBeNull();
  });

  it("aplicar executa de novo o comando do resultado com o filtro, e o texto do editor não muda", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().filter!.onDraft(`"status" = 'aberta' ORDER BY "id" DESC`);
    view.show().filter!.onApply();
    await settle();

    expect(runner.sent).toEqual([filtered(`"status" = 'aberta' ORDER BY "id" DESC`)]);
    expect(view.show().filter).toMatchObject({ applied: `"status" = 'aberta' ORDER BY "id" DESC` });
    expect(view.props.onSqlChange).not.toHaveBeenCalled();
  });

  it("a recusa da API (FILTER_INVALID) aparece no campo com a frase dela, e o filtro em vigor fica o de antes", async () => {
    const runner = fakeRunner(rowsState());
    runner.refuse = { code: "FILTER_INVALID", message: "O filtro tem um terminador de comando (;)." };
    const view = mount(runner);

    view.show().filter!.onDraft("id > 0; drop table t");
    view.show().filter!.onApply();
    await settle();

    expect(view.show().filter).toMatchObject({ problem: { message: "O filtro tem um terminador de comando (;)." }, applied: "", draft: "id > 0; drop table t" });
    // Escrever no campo tira a recusa.
    view.show().filter!.onDraft("id > 0");
    expect(view.show().filter!.problem).toBeNull();
  });

  it("o erro do banco no comando filtrado deixa o campo à vista, para a pessoa corrigir o filtro", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().filter!.onDraft("x = 1");
    view.show().filter!.onApply();
    await settle();
    runner.state = { status: "error", source: "database", title: "Erro do banco", message: 'column "x" does not exist', sqlState: "42703", errorAt: null };

    expect(view.show().filter).toMatchObject({ draft: "x = 1", applied: "x = 1" });
    expect(view.show().filter!.columns.map((column) => column.name)).toEqual(["id", "status"]);
  });

  it("executar pelo editor limpa o filtro e envia o comando do editor sem ele", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().filter!.onDraft("id > 0");
    view.show().filter!.onApply();
    await settle();
    runner.state = rowsState({ target: filtered("id > 0") });

    view.show().editor.onRun(command, noFlash);
    runner.state = rowsState({ target: command });

    expect(runner.sent.at(-1)).toEqual(command);
    expect(view.show().filter).toMatchObject({ draft: "", applied: "", problem: null });
  });

  it("com alterações não salvas na grade, aplicar o filtro pergunta antes, como executar outro comando (RN-EDIT-007)", async () => {
    withPending();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().filter!.onDraft("id > 0");
    view.show().filter!.onApply();
    expect(runner.run).not.toHaveBeenCalled();

    view.show().question!.onDiscard();
    await settle();
    expect(runner.sent).toEqual([filtered("id > 0")]);
  });

  it("Limpar executa o comando sem filtro", async () => {
    const runner = fakeRunner(rowsState({ target: filtered("id > 0") }));
    const view = mount(runner);

    view.show().filter!.onClear();
    await settle();

    expect(runner.sent).toEqual([rowsState().target]);
  });

  it("o Filtrar do menu da célula junta a condição ao campo e executa o comando com ela", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().filter!.onDraft("id > 5");

    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    const items = view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "filter")!.submenu!.groups.flatMap(groupItems);
    items.find((item) => item.id === "filter:cell:eq")!.onSelect!();
    await settle();

    expect(runner.sent).toEqual([filtered(`(id > 5) AND ("status" = 'aberta')`)]);
    expect(view.show().filter).toMatchObject({ draft: `(id > 5) AND ("status" = 'aberta')` });
  });

  it.each([
    ["o banco", { database: "vendas" }],
    ["a conexão", { connectionId: "c2" }],
  ] as const)("depois de trocar %s da aba, o filtro do resultado anterior sai: o campo some, e o comando anterior não volta a ser executado (RN-ARVORE-007 e 008)", async (_name, place) => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().filter!.onDraft("id > 0");
    view.show().filter!.onApply();
    await settle();
    // O comando filtrado deu erro: o campo fica à vista pelo comando fixado, para a correção.
    runner.state = { status: "error", source: "database", title: "Erro do banco", message: "falhou", sqlState: null, errorAt: null };
    expect(view.show().filter).toMatchObject({ draft: "id > 0", applied: "id > 0" });

    // A troca: a aba ganha um executor novo, sem resultado, no lugar novo (o provedor aposenta o de antes).
    const next = fakeRunner({ status: "idle" });
    view.props.runner = next as unknown as QueryRunner;
    view.props.tab = { ...view.props.tab, ...place };

    expect(view.show().filter).toBeNull();
    expect(next.run).not.toHaveBeenCalled();

    // O primeiro resultado do lugar novo traz o campo vazio.
    next.state = rowsState({ target: { sql: "select * from pedido", offset: 0, engine: pg } });
    expect(view.show().filter).toMatchObject({ draft: "", applied: "", problem: null });
    view.show().filter!.onApply();
    await settle();
    expect(next.sent).toEqual([{ sql: "select * from pedido", offset: 0, engine: pg }]);
  });

  it("F5 é o Executar de novo, com o foco em qualquer ponto da aba; com algo em andamento, nada (RN-GRADE-012)", () => {
    const runner = fakeRunner(rowsState({ target: filtered("id > 0") }));
    const view = mount(runner);

    const press = key("F5");
    view.show().keys(press);
    expect(press.preventDefault).toHaveBeenCalled();
    expect(runner.rerun).toHaveBeenCalledOnce();

    runner.state = rowsState({ loadingMore: true });
    view.show().keys(key("F5"));
    expect(runner.rerun).toHaveBeenCalledOnce();
  });

  it("F5 com alterações não salvas pergunta antes", () => {
    withPending();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().keys(key("F5"));
    expect(runner.rerun).not.toHaveBeenCalled();
    expect(view.show().question).toMatchObject({ count: 1 });
  });
});

describe("QueryTabPanel: a atualização automática do resultado (RN-GRADE-014)", () => {
  const pauses = (runner: ReturnType<typeof fakeRunner>) => runner.autoRefresh.pause.mock.calls.filter(([reason]) => reason === "hidden").map(([reason, on]) => `${String(reason)}:${String(on)}`);

  it("só a aba à vista a deixa executar: a ativa com a área de trabalho na tela; atrás de outra tela, ou outra aba à frente, ela espera", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show();
    expect(pauses(runner).at(-1)).toBe("hidden:false");

    rt.screen.on = false;
    view.show();
    expect(pauses(runner).at(-1)).toBe("hidden:true");

    rt.screen.on = true;
    view.props.active = false;
    view.show();
    expect(pauses(runner).at(-1)).toBe("hidden:true");
  });

  it("a barra do resultado recebe o controle; \"Personalizado…\" abre o diálogo com o intervalo em uso, e o texto válido troca o intervalo", () => {
    const runner = fakeRunner(rowsState());
    runner.autoRefresh.getState = () => ({ status: "on", everyMs: 10_000, lastAt: null, running: false, paused: null });
    const view = mount(runner);
    const { auto } = view.show();

    expect(auto).toMatchObject({ state: { status: "on", everyMs: 10_000 } });
    auto!.onChoose("autoRefresh:custom");
    expect(view.show().autoDialog).toMatchObject({ everyMs: 10_000, error: null });

    view.show().autoDialog!.onSubmit("90");
    expect(runner.autoRefresh.start).toHaveBeenCalledExactlyOnceWith(90_000);
    expect(view.show().autoDialog).toBeUndefined();
  });

  it("a execução automática não ocupa a aba para a pessoa: \"Executar\" não vira \"Cancelar\", o banco e o filtro seguem livres, e F5 e Ctrl+Enter chegam ao executor", () => {
    const runner = fakeRunner({ status: "running", cancelling: false, previous: rowsState(), auto: true });
    const view = mount(runner);
    const shown = view.show();

    expect(shown.toolbar.busy).toBe(false);
    expect(shown.picker?.busy).toBe(false);
    expect(shown.filter?.busy).toBe(false);

    shown.keys({ key: "F5", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault: vi.fn() });
    expect(runner.rerun).toHaveBeenCalledOnce();

    view.show().editor.onRun(command, noFlash);
    expect(runner.sent).toEqual([command]);
    // O comando da pessoa, sim, ocupa: "Executar" vira "Cancelar".
    expect(view.show().toolbar.busy).toBe(true);
  });

  it("no menu da célula, durante a execução automática, \"Atualizar\" segue valendo e editar espera por ela, com o motivo", async () => {
    const runner = fakeRunner({ status: "running", cancelling: false, previous: rowsState(), auto: true });
    const view = mount(runner);
    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 0, y: 0 }, false);
    await settle();
    const items = view.show().menu!.groups.flatMap(groupItems);

    expect(items.find((item) => item.id === "refresh")).toMatchObject({ disabled: false });
    expect(items.find((item) => item.id === "edit")).toMatchObject({ disabled: true, hint: copy.readOnly(copy.reasons.refreshing) });
    // A pergunta do alvo da edição não vai à API por um resultado que está para mudar.
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
  });

  it("ligada, a grade não busca a página seguinte sozinha ao rolar até o fim (RN-CONFIG-005): cada execução volta à primeira página", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    expect(view.show().area.autoLoadMore).toBe(true);

    runner.autoRefresh.getState = () => ({ status: "on", everyMs: 5_000, lastAt: null, running: false, paused: null });
    expect(view.show().area.autoLoadMore).toBe(false);
  });

  it("o menu da célula tem \"Atualizar automaticamente\" depois do \"Atualizar\" (F5)", async () => {
    const view = mount(fakeRunner(rowsState()));
    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 0, y: 0 }, false);
    await settle();
    const ids = view.show().menu!.groups.flatMap(groupItems).map((item) => item.id);

    expect(ids.indexOf("autoRefresh")).toBe(ids.indexOf("refresh") + 1);
  });
});
