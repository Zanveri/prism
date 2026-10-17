import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import type { AutoRefreshBlocker, AutoRefreshState } from "../_lib/auto-refresh";
import { createScriptRun, finishRun, startEntry, withEntry, type ScriptChoice, type ScriptRun } from "../_lib/script-run";
import { scriptRunCopy } from "../_lib/script-run.copy";
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
    service: { editTargetOrRefuse: vi.fn(), saveEditsOrRefuse: vi.fn(), previewEditsOrRefuse: vi.fn(), sqlTargetOrRefuse: vi.fn() },
    cells: { resultCells: vi.fn() },
    /** A área de trabalho é a tela mostrada (a rota); a aba à vista é a ativa com ela na tela (RN-SEG-001). */
    screen: { on: true },
    /**
     * RN-PROT-001: as proteções da conexão da aba, que o aviso de mentira (`useCommandConfirmation`) usa para decidir, e as perguntas que ele abriu, com as
     * respostas. Sem proteção, nada pergunta e tudo segue na mesma chamada, como antes.
     */
    protections: { readOnly: null, confirm: null } as { readOnly: { from: null } | null; confirm: { level: "irreversible" | "all"; from: null } | null },
    asked: [] as { question: { kind: string } & Record<string, unknown>; proceed: () => void; cancelled?: () => void }[],
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
// O aviso de confirmação de mentira (RN-PROT-001): decide pela pergunta que a aba monta com as proteções de `rt.protections`, e guarda a que abriria.
vi.mock("../_lib/use-command-confirmation", () => ({
  useCommandConfirmation: () => ({
    confirm: (make: (protections: unknown) => ({ kind: string } & Record<string, unknown>) | null, proceed: () => void, cancelled?: () => void) => {
      const question = make(rt.protections);
      if (question === null) return proceed();
      rt.asked.push({ question, proceed, cancelled });
    },
    confirmed: (make: (protections: unknown) => ({ kind: string } & Record<string, unknown>) | null) => {
      const question = make(rt.protections);
      if (question === null) return true;
      return new Promise<boolean>((resolve) => rt.asked.push({ question, proceed: () => resolve(true), cancelled: () => resolve(false) }));
    },
    open: null,
  }),
}));
// O editor de SQL é CodeMirror, que precisa da página; aqui basta o que a aba entrega a ele.
vi.mock("./sql-editor", () => ({ SqlEditor: function SqlEditor() {
  return null;
} }));

import { ContextMenu } from "@/components/ui";
import { groupItems } from "@/components/ui/context-menu";
import { elementsOf } from "@/lib/testing/react-tree";

import { editCell, noEdits } from "../_lib/record-edits";
import { gridSelectionCopy } from "../_lib/grid-selection.copy";
import { recordsCopy } from "../_lib/records.copy";
import { forgetExcept, recall, remember } from "../_lib/tab-memory";
import { unsavedEdits } from "../_lib/unsaved-edits";
import { isPersonBusy } from "../_lib/use-query-runner";
import { ConnectionPicker } from "./connection-picker";
import { DatabasePicker } from "./database-picker";
import { EditorToolbar } from "./editor-toolbar";
import { EditsBanner } from "./edits-banner";
import { QueryTabPanel } from "./query-tab";
import { ResultActions } from "./result-actions";
import { ResultPanel } from "./result-panel";
import { SqlEditor } from "./sql-editor";
import { UnsavedEditsDialog } from "./unsaved-edits-dialog";
import { AutoRefreshControl, AutoRefreshDialog } from "./auto-refresh-control";
import { RecordsFilter } from "./table-tab/records-filter";
import { ScriptErrorDialog } from "./script-error-dialog";
import { ScriptStatistics } from "./script-statistics";
import { ScriptTabs } from "./script-tabs";
import type { FilterRefusal } from "../_lib/use-query-runner";
import { copyAsCopy } from "../_lib/copy-as/copy-as.copy";
import type { SqlTarget } from "../_lib/record-edits.schema";
import { CopyAdvancedDialog } from "./copy-as/copy-advanced-dialog";
import { ConfigureCopyAsDialog } from "./copy-as/configure-copy-as-dialog";
import { GenerateSqlDialog } from "./generate-sql/generate-sql-dialog";

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
  const props = { tab: { ...tab, ...over }, runner: runner as unknown as QueryRunner, engine: pg as Engine | undefined, active: true, onSqlChange: vi.fn(), onEdited: vi.fn(), onSave: vi.fn(), onSwitchConnection: vi.fn(), onOpenTable: vi.fn(), onSwitchDatabase: vi.fn(), onOpenQuery: vi.fn() };

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
    const scriptError = found.find((element) => element.type === ScriptErrorDialog)?.props as unknown as ComponentProps<typeof ScriptErrorDialog> | undefined;

    return { area, editor, question, menu, banner, picker, connection, noConnection, filter, keys, auto, autoDialog, toolbar, scriptError, found };
  }

  return { show, props };
}

/** Uma alteração pendente na coluna `status` da primeira linha do resultado `r1`. */
const withPending = () => remember("q1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 1, "paga", "aberta") });

/** RN-SQL-023: uma alteração pendente na aba guardada do script (o resultado `r0`, o do primeiro comando). */
const keptPending = () => remember("q1", "edits", { resultId: "r0", edits: editCell(noEdits, 0, 1, "b", "a") });

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
  rt.protections = { readOnly: null, confirm: null };
  rt.asked.length = 0;
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
    expect(items.find((item) => item.label === gridSelectionCopy.menu.copy)?.disabled).toBe(false);
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

    view.show().area.editing!.onActivate({ row: 0, column: 1 });
    view.show().area.editing!.onCopy();
    await settle();

    expect(rt.cells.resultCells).toHaveBeenCalledWith("s1", "r1", [{ row: 0, column: 1 }], expect.any(AbortSignal));
    expect(clipboard.writeText.mock.calls).toEqual([[full]]);
    expect(rt.toast.success.mock.calls).toEqual([[copy.menu.copied]]);
  });

  it("'Copiar' do menu da célula também leva o valor completo", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.cells.resultCells.mockResolvedValue({ ok: true, data: [full] });
    const view = mount(fakeRunner(cut()));

    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    view.show().menu!.groups.flatMap(groupItems).find((item) => item.label === gridSelectionCopy.menu.copy)!.onSelect!();
    await settle();

    expect(clipboard.writeText.mock.calls).toEqual([[full]]);
  });

  it("sem célula cortada, nada é pedido: copia o que a grade tem", async () => {
    const view = mount(fakeRunner(cut()));

    view.show().area.editing!.onActivate({ row: 0, column: 0 });
    view.show().area.editing!.onCopy();
    await settle();

    expect(rt.cells.resultCells).not.toHaveBeenCalled();
    expect(clipboard.writeText.mock.calls).toEqual([["10"]]);
  });

  it("sem o valor completo (o resultado mudou), copia o cortado e avisa quantos não vieram inteiros", async () => {
    rt.cells.resultCells.mockResolvedValue({ ok: false, error: { status: 404, code: "RESULT_NOT_FOUND", title: "Resultado não localizado.", detail: null, errors: null, extensions: {} } });
    const view = mount(fakeRunner(cut()));

    view.show().area.editing!.onActivate({ row: 0, column: 1 });
    view.show().area.editing!.onCopy();
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

    view.show().area.editing!.onActivate({ row: 0, column: 1 });
    view.show().area.editing!.onCopy();
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

  it("Adicionar linha e Excluir linha ficam desabilitados no menu, com o motivo; a coluna da chave também", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: joinTarget });
    const view = mount(fakeRunner(joined()));

    view.show().area.editing!.onMenu({ row: 0, column: 2 }, { x: 4, y: 4 }, false);
    await settle();
    const items = view.show().menu!.groups.flatMap(groupItems);

    expect(items.find((item) => item.label === copy.menu.newRow)).toMatchObject({ disabled: true, hint: copy.readOnly(copy.reasons.joinRowOperations) });
    // RN-EDIT-016: duplicar vale onde adicionar vale.
    expect(items.find((item) => item.label === copy.menu.duplicateRow)).toMatchObject({ disabled: true, hint: copy.readOnly(copy.reasons.joinRowOperations) });
    expect(items.find((item) => item.label === copy.menu.deleteRow)).toMatchObject({ disabled: true, hint: copy.readOnly(copy.reasons.joinRowOperations) });
    expect(items.find((item) => item.label === copy.menu.edit)).toMatchObject({ disabled: true, hint: copy.readOnly("coluna da chave numa junção") });
  });
});

describe("QueryTabPanel: Duplicar linha no resultado de um comando (RN-EDIT-016)", () => {
  it("a cópia vai para o fim da grade, como nos Registros; o valor completo que não vem diz para executar o comando de novo", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.cells.resultCells.mockResolvedValue({ ok: true, data: [null] });
    const view = mount(fakeRunner(rowsState({ rows: [["10", "aberta"], ["11", "longa"]], truncated: new Map([[1, new Set([1])]]) })));

    view.show().area.editing!.onActivate({ row: 0, column: 1 });
    view.show().area.editing!.onDuplicateRow();
    await settle();
    expect(view.show().area.editing!.rows[2]).toEqual(["10", "aberta"]);
    expect(view.show().banner!.props.notice).toBe(copy.duplicate.keyCopied("pedido", ["id"]));

    view.show().area.editing!.onActivate({ row: 1, column: 0 });
    view.show().area.editing!.onDuplicateRow();
    await settle();
    await settle();
    expect(view.show().area.editing!.rows).toHaveLength(3);
    expect(view.show().banner!.props.notice).toBe("A linha não foi duplicada: o valor completo de status não pôde vir. Execute o comando de novo para duplicá-la.");
  });

  it("da linha nova já salva (RN-EDIT-009), a coluna que o banco preencheu não se copia, fica com o padrão da tabela e entra no aviso", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    // A segunda linha é a nova que o Salvar gravou: o `id` foi o banco que preencheu, e a tela não sabe o valor.
    const view = mount(fakeRunner(rowsState({ rows: [["10", "aberta"], [null, "nova"]], generated: new Map([[1, new Set([0])]]) })));

    view.show().area.editing!.onActivate({ row: 1, column: 1 });
    view.show().area.editing!.onDuplicateRow();
    await settle();

    expect(view.show().area.editing!.rows[2]).toEqual([null, "nova"]);
    expect(view.show().area.editing!.marks.get(2)).toMatchObject({ kind: "new", pending: new Map([[1, "nova"]]) });
    expect(view.show().area.editing!.active).toEqual({ row: 2, column: 0 });
    expect(view.show().banner!.props.notice).toBe(copy.duplicate.notCopied(["id"]));
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

describe("QueryTabPanel: executar script (seção 31, RN-SQL-019 a 022)", () => {
  const targets: RunTarget[] = [
    { sql: "select 1", offset: 0, engine: pg },
    { sql: "update t set a = 1", offset: 10, engine: pg },
    { sql: "select * from loja.pedido", offset: 30, engine: pg },
  ];
  const key = (over: Record<string, unknown>) => ({ key: "x", code: "KeyX", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault: vi.fn(), ...over });
  const pauses = (runner: ReturnType<typeof fakeRunner>) => runner.autoRefresh.pause.mock.calls.filter(([reason]) => reason === "hidden").map(([, on]) => on);

  /** O script terminado: o primeiro e o último devolveram linhas, e o último tem o cursor aberto (a aba dele é o executor). O primeiro é o resultado `r0`. */
  function finished(runner: ReturnType<typeof fakeRunner>): ScriptRun {
    const first = rowsState({ id: 7, target: targets[0], rows: [["1", "a"]], resultId: "r0" });
    let run = createScriptRun(1, targets);
    run = withEntry(run, 0, { status: "ok", rows: { read: 1, more: true, total: null }, kept: true });
    run = withEntry(run, 1, { status: "ok", affected: 3 });
    run = withEntry(run, 2, { status: "ok", rows: { read: 1, more: true, total: null }, kept: true });
    run = { ...finishRun(run, "done"), results: [{ entry: 0, rows: first }, { entry: 2, rows: runner.state as RowsState }], live: 2 };
    runner.scriptState = run;
    return run;
  }

  it("a barra tem Executar script, ao lado de Executar, com o atalho da plataforma", () => {
    const { toolbar } = mount(fakeRunner(rowsState())).show();

    expect(toolbar.scriptShortcut).toEqual({ label: scriptRunCopy.editor.shortcut, aria: "Alt+X" });
    expect(typeof toolbar.onRunScript).toBe("function");
  });

  it("Alt+X com o foco em qualquer ponto da aba é o atalho; o que outro já tratou, e o Alt+Shift+X, não", () => {
    const { keys } = mount(fakeRunner(rowsState())).show();

    const alt = key({ altKey: true });
    keys(alt);
    expect(alt.preventDefault).toHaveBeenCalledOnce();

    const handled = key({ altKey: true, defaultPrevented: true });
    keys(handled);
    expect(handled.preventDefault).not.toHaveBeenCalled();

    const shifted = key({ altKey: true, shiftKey: true });
    keys(shifted);
    expect(shifted.preventDefault).not.toHaveBeenCalled();
  });

  it("segurar Alt+X não começa o script de novo: só o primeiro evento o começa, e a repetição (`repeat`) só é consumida", () => {
    const view = mount(fakeRunner(rowsState()));
    const runScript = vi.fn();
    (view.show().editor.ref as { current: unknown }).current = { runScript, focus: vi.fn() };
    const { keys } = view.show();

    const first = key({ altKey: true });
    const held = key({ altKey: true, repeat: true });
    keys(first);
    keys(held);
    keys(key({ altKey: true, repeat: true }));

    expect(runScript).toHaveBeenCalledOnce();
    expect(held.preventDefault).toHaveBeenCalledOnce();
  });

  it("o editor manda os comandos ao executor; com alterações não salvas, pergunta antes (RN-EDIT-007), e Descartar roda o script", () => {
    const free = fakeRunner(rowsState());
    mount(free).show().editor.onRunScript!(targets);
    expect(free.scripts).toEqual([targets]);
    rt.unmount();

    withPending();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().editor.onRunScript!(targets);
    expect(runner.runScript).not.toHaveBeenCalled();

    view.show().question!.onDiscard();
    expect(runner.scripts).toEqual([targets]);
  });

  it("sem comando nenhum, o executor só avisa: nada pergunta", () => {
    withPending();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().editor.onRunScript!([]);

    expect(runner.runScript).toHaveBeenCalledWith([]);
    expect(view.show().question).toBeUndefined();
  });

  it("enquanto roda: as Estatísticas à frente, o progresso na barra e a marca do comando em execução no editor", () => {
    const runner = fakeRunner({ status: "running", cancelling: false, previous: null });
    runner.scriptState = startEntry(withEntry(createScriptRun(1, targets), 0, { status: "ok" }), 1);
    const shown = mount(runner).show();

    expect((shown.area.tabs?.list as { type: unknown }).type).toBe(ScriptTabs);
    expect((shown.area.statistics?.body as { type: unknown }).type).toBe(ScriptStatistics);
    expect(shown.area.progress).toBe(scriptRunCopy.progress(2, 3));
    expect(shown.editor.runningAt).toBe(targets[1]);
    expect(shown.toolbar.busy).toBe(true);
  });

  it("no fim, a aba do último comando vem à frente e é o resultado do executor, com a edição, o filtro e a atualização automática", () => {
    const runner = fakeRunner(rowsState({ target: targets[2] }));
    finished(runner);
    const { area, editor } = mount(runner).show();

    expect(area.state).toBe(runner.state);
    expect(area.statistics).toBeUndefined();
    expect(area.kept).toBeUndefined();
    expect(area.editing).toBeDefined();
    expect(area.progress).toBeNull();
    expect(editor.runningAt).toBeNull();
    expect(pauses(runner).at(-1)).toBe(false);
  });

  it("uma aba guardada mostra as linhas dela, que se editam (RN-SQL-023), com a nota; Executar este comando executa só ele, depois da pergunta das alterações", () => {
    keptPending();
    const runner = fakeRunner(rowsState({ target: targets[2] }));
    const run = finished(runner);
    const view = mount(runner);
    // Sem alterações no resultado do último comando, a troca de aba não pergunta nada.
    expect((view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props.onChoose(0)).toBe(true);
    const { area, banner } = view.show();

    expect(area.state).toBe(run.results[0].rows);
    // As alterações são as da aba guardada, no resultado dela.
    expect(area.editing?.pending).toBe(1);
    expect(banner?.props.pending).toBe(1);
    expect(area.connected).toBe(false);
    expect(area.autoLoadMore).toBe(false);
    expect(area.kept).toMatchObject({ busy: false });
    // O resultado do último comando não está à vista: a atualização automática dele espera (RN-GRADE-014).
    expect(pauses(runner).at(-1)).toBe(true);

    area.kept!.onRunAlone();
    expect(runner.runCommand).not.toHaveBeenCalled();
    view.show().question!.onDiscard();
    expect(runner.runCommand).toHaveBeenCalledWith(targets[0]);
  });

  it("na conexão que confirma (RN-PROT-001), Executar este comando pergunta como o Ctrl+Enter nele, pelo comando da aba guardada; cancelado, nada roda", () => {
    rt.protections = { readOnly: null, confirm: { level: "all", from: null } };
    const runner = fakeRunner(rowsState({ target: targets[2] }));
    finished(runner);
    const view = mount(runner);
    (view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props.onChoose(0);

    view.show().area.kept!.onRunAlone();
    expect(rt.asked.map(({ question }) => question)).toEqual([{ kind: "command", command: { number: null, sql: "select 1", irreversible: null } }]);
    rt.asked[0].cancelled?.();
    expect(runner.runCommand).not.toHaveBeenCalled();

    view.show().area.kept!.onRunAlone();
    rt.asked[1].proceed();
    expect(runner.runCommand).toHaveBeenCalledExactlyOnceWith(targets[0]);
  });

  it("com um comando em andamento na aba, Executar este comando diz que está ocupado e não pergunta, não limpa o filtro nem abre a área recolhida", () => {
    keptPending();
    const runner = fakeRunner(rowsState({ target: targets[2] }));
    finished(runner);
    const view = mount(runner);
    view.show().filter!.onDraft("id > 0");
    (view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props.onChoose(0);
    (view.show().area.actions as { props: ComponentProps<typeof ResultActions> }).props.onAction("collapse");
    runner.state = { status: "running", cancelling: false, previous: rowsState({ target: targets[2] }) };
    const { area } = view.show();

    expect(area.kept).toMatchObject({ busy: true });
    area.kept!.onRunAlone();

    // O executor recusa calado (a aba ocupada); a tela não muda por um comando que não vai rodar.
    expect(view.show().question).toBeUndefined();
    expect(runner.runCommand).toHaveBeenCalledOnce();
    expect(view.show().filter).toMatchObject({ draft: "id > 0" });
    expect(view.show().area.collapsed).toBe(true);
  });

  it("trocar o executor (o banco, a conexão, o bloqueio) tira a aba do script escolhida: o primeiro script do novo, que também é o 1, abre nas Estatísticas", () => {
    const runner = fakeRunner(rowsState({ target: targets[2] }));
    finished(runner);
    const view = mount(runner);
    (view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props.onChoose(0);
    expect((view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props.shown).toBe(0);

    // O executor novo numera os scripts dele desde o 1, e o primeiro está rodando: as Estatísticas à frente, e não a aba escolhida no anterior.
    const next = fakeRunner({ status: "running", cancelling: false, previous: null });
    next.scriptState = { ...startEntry(withEntry(createScriptRun(1, targets), 0, { status: "ok", rows: { read: 1, more: true, total: null }, kept: true }), 1), results: [{ entry: 0, rows: rowsState({ target: targets[0] }) }] };
    view.props.runner = next as unknown as QueryRunner;

    expect((view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props.shown).toBe("statistics");
    expect(view.show().area.statistics).toBeDefined();
  });

  it("o F5 só executa de novo na aba do resultado do último comando", () => {
    const runner = fakeRunner(rowsState({ target: targets[2] }));
    finished(runner);
    const view = mount(runner);
    (view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props.onChoose("statistics");

    const onStatistics = key({ key: "F5", code: "F5" });
    view.show().keys(onStatistics);
    expect(onStatistics.preventDefault).toHaveBeenCalledOnce();
    expect(runner.rerun).not.toHaveBeenCalled();

    (view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props.onChoose(2);
    view.show().keys(key({ key: "F5", code: "F5" }));
    expect(runner.rerun).toHaveBeenCalledOnce();
  });

  it("a pergunta de erro: com o script parado no comando, o diálogo o mostra, e a escolha vai ao executor (RN-SQL-021)", () => {
    const runner = fakeRunner({ status: "error", source: "database", title: "Erro do banco", message: "boom", sqlState: "42601", errorAt: 12 });
    const failedEntry = { title: "Erro do banco", message: "boom", sqlState: "42601" };
    runner.scriptState = { ...withEntry(withEntry(createScriptRun(1, targets), 0, { status: "ok" }), 1, { status: "error", error: failedEntry }), phase: "paused", current: 1 };
    const { scriptError, editor } = mount(runner).show();

    expect(scriptError).toMatchObject({ number: 2, total: 3, entry: { target: targets[1], error: failedEntry } });
    expect(editor.errorAt).toBe(12);
    expect(editor.runningAt).toBeNull();

    scriptError!.onChoose("skip");
    expect(runner.script.decide).toHaveBeenCalledWith("skip");
  });

  it.each([
    ["outra aba à frente", { active: false }, true],
    ["a área de trabalho por baixo de Configurações", { active: true }, false],
  ] as const)("a pergunta de erro só aparece na aba à vista: com %s, o script espera, e nada cobre a tela (RN-SQL-021)", (_name, over, onScreen) => {
    const runner = fakeRunner({ status: "error", source: "database", title: "Erro do banco", message: "boom", sqlState: "42601", errorAt: 12 });
    runner.scriptState = { ...withEntry(createScriptRun(1, targets), 0, { status: "error", error: { title: "Erro do banco", message: "boom", sqlState: "42601" } }), phase: "paused", current: 0 };
    rt.screen.on = onScreen;
    const view = mount(runner);
    Object.assign(view.props, over);

    expect(view.show().scriptError).toBeUndefined();
    expect(view.show().area.progress).toBe(scriptRunCopy.paused(1, 3));
    expect(runner.script.decide).not.toHaveBeenCalled();

    // A pessoa volta à aba: a pergunta aparece.
    rt.screen.on = true;
    view.props.active = true;
    expect(view.show().scriptError).toMatchObject({ number: 1, total: 3 });
  });
});

describe("QueryTabPanel: as abas guardadas do script se editam (seção 33, RN-SQL-023)", () => {
  const first: RunTarget = { sql: "select * from loja.pedido where id < 5", offset: 0, engine: pg };
  const last: RunTarget = { sql: "select * from loja.pedido", offset: 40, engine: pg };
  const kept = () => rowsState({ id: 7, target: first, rows: [["1", "a"]], hasMore: false, resultId: "r0" });
  const tabsOf = (view: ReturnType<typeof mount>) => (view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props;

  /** O script terminado com duas abas: a do primeiro comando, guardada (o resultado `r0`), e a do último, que é o executor (`r1`, com o cursor aberto). */
  function twoTabs(runner: ReturnType<typeof fakeRunner>): ScriptRun {
    let run = createScriptRun(1, [first, last]);
    run = withEntry(run, 0, { status: "ok", rows: { read: 1, more: false, total: null }, kept: true });
    run = withEntry(run, 1, { status: "ok", rows: { read: 1, more: true, total: null }, kept: true });
    run = { ...finishRun(run, "done"), results: [{ entry: 0, rows: kept() }, { entry: 1, rows: runner.state as RowsState }], live: 1 };
    runner.scriptState = run;
    return run;
  }

  it("a aba guardada recebe a edição e a faixa; o alvo é o do resultado dela, e o menu da célula não tem Filtrar, Ordenar, Atualizar nem Atualizar automaticamente", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    const runner = fakeRunner(rowsState({ target: last }));
    twoTabs(runner);
    const view = mount(runner);
    tabsOf(view).onChoose(0);
    const { area, banner } = view.show();

    expect(area.editing?.rows).toEqual([["1", "a"]]);
    expect(banner?.type).toBe(EditsBanner);
    // O F11 do "Filtrar" é do resultado do último comando.
    expect(area.editing?.onFilter).toBeUndefined();

    area.editing!.onMenu({ row: 0, column: 1 }, { x: 0, y: 0 }, false);
    await settle();
    const ids = view.show().menu!.groups.flatMap(groupItems).map((item) => item.id);

    expect(rt.service.editTargetOrRefuse).toHaveBeenCalledWith("s1", "r0", null);
    expect(ids).toEqual(expect.arrayContaining(["copy", "copyWithHeader", "advancedCopy", "paste", "edit", "setNull", "undo", "newRow", "duplicateRow", "deleteRow"]));
    expect(ids).not.toContain("filter");
    // RN-SQL-023: o "Ordenar" é do resultado do último comando, como o "Filtrar".
    expect(ids).not.toContain("sort");
    expect(ids).not.toContain("refresh");
    expect(ids).not.toContain("autoRefresh");
  });

  it("a aba guardada tem a barra de edição (RN-EDIT-013), e Duplicar linha põe a cópia no fim da grade dela; a célula cortada, cujo valor completo a API não guarda para ela, não duplica nada (RN-EDIT-016)", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.cells.resultCells.mockResolvedValue({ ok: false, error: { status: 404, code: "RESULT_NOT_FOUND", title: "Resultado não localizado.", detail: null, errors: null, extensions: {} } });
    const runner = fakeRunner(rowsState({ target: last }));
    const run = twoTabs(runner);
    runner.scriptState = { ...run, results: [{ entry: 0, rows: rowsState({ id: 7, target: first, rows: [["1", "a"], ["2", "corta"]], truncated: new Map([[1, new Set([1])]]), hasMore: false, resultId: "r0" }) }, run.results[1]] };
    const view = mount(runner);
    tabsOf(view).onChoose(0);

    expect(view.show().area.editing!.bar.buttons.map((button) => button.id)).toEqual(["edit", "newRow", "duplicateRow", "deleteRow"]);

    view.show().area.editing!.onActivate({ row: 0, column: 1 });
    view.show().area.editing!.bar.onAction("duplicateRow");
    await settle();
    expect(rt.service.editTargetOrRefuse).toHaveBeenCalledWith("s1", "r0", null);
    expect(view.show().area.editing!.rows[2]).toEqual(["1", "a"]);
    expect(view.show().banner!.props.notice).toBe(copy.duplicate.keyCopied("pedido", ["id"]));

    view.show().area.editing!.onActivate({ row: 1, column: 0 });
    view.show().area.editing!.onDuplicateRow();
    await settle();
    await settle();
    expect(rt.cells.resultCells).toHaveBeenCalledWith("s1", "r0", [{ row: 1, column: 1 }], expect.any(AbortSignal));
    expect(view.show().area.editing!.rows).toHaveLength(3);
    expect(view.show().banner!.props.notice).toBe(copy.duplicate.fullValueMissing("status", "result"));
  });

  it("o Salvar de uma aba guardada grava pelo resultado dela e entrega ao executor o que foi salvo (que fecha o cursor do último), sem executar nada", async () => {
    keptPending();
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.service.saveEditsOrRefuse.mockResolvedValue({ ok: true, data: { applied: 1 } });
    const runner = fakeRunner(rowsState({ target: last }));
    twoTabs(runner);
    const view = mount(runner);
    tabsOf(view).onChoose(0);

    view.show().banner!.props.onSave();
    await settle();

    expect(rt.service.saveEditsOrRefuse).toHaveBeenCalledWith("s1", "r0", [{ kind: "update", table: 0, key: ["1"], set: [{ column: 1, value: "b" }] }]);
    expect(runner.keepSaved).toHaveBeenCalledWith("r0", { rows: [["1", "b"]], truncated: new Map(), generated: new Map() });
    expect(runner.run).not.toHaveBeenCalled();
    expect(runner.runCommand).not.toHaveBeenCalled();
    expect(rt.toast.success).toHaveBeenCalledWith(copy.saved(1));
  });

  it("com alterações não salvas, trocar de aba pergunta antes: Cancelar fica onde estava, Descartar joga fora e troca; a aba que já está à frente não pergunta", () => {
    withPending();
    const runner = fakeRunner(rowsState({ target: last }));
    twoTabs(runner);
    const view = mount(runner);

    expect(tabsOf(view).onChoose(1)).toBe(true);
    expect(view.show().question).toBeUndefined();

    expect(tabsOf(view).onChoose(0)).toBe(false);
    expect(view.show().question).toMatchObject({ count: 1 });
    view.show().question!.onCancel();
    expect(view.show().question).toBeUndefined();
    expect(tabsOf(view).shown).toBe(1);
    expect(view.show().area.editing?.pending).toBe(1);

    // Também para as Estatísticas.
    expect(tabsOf(view).onChoose("statistics")).toBe(false);
    view.show().question!.onDiscard();
    expect(tabsOf(view).shown).toBe("statistics");
    expect(unsavedEdits.countOf("q1")).toBe(0);
  });

  it("com alterações não salvas numa aba guardada, trocar dela para outra (a do último comando, as Estatísticas) também pergunta; Descartar joga fora e troca", () => {
    keptPending();
    const runner = fakeRunner(rowsState({ target: last }));
    twoTabs(runner);
    const view = mount(runner);
    expect(tabsOf(view).onChoose(0)).toBe(true);
    expect(view.show().area.editing?.pending).toBe(1);

    expect(tabsOf(view).onChoose(1)).toBe(false);
    expect(view.show().question).toMatchObject({ count: 1 });
    view.show().question!.onCancel();
    expect(tabsOf(view).shown).toBe(0);

    expect(tabsOf(view).onChoose("statistics")).toBe(false);
    view.show().question!.onDiscard();
    expect(tabsOf(view).shown).toBe("statistics");
    expect(unsavedEdits.countOf("q1")).toBe(0);
  });

  it("a ação numa aba guardada que esperava o alvo não age quando o script sai no meio (o Ctrl+Enter troca o executor de resultados)", async () => {
    let respond!: () => void;
    rt.service.editTargetOrRefuse.mockImplementationOnce(() => new Promise((resolve) => (respond = () => resolve({ ok: true, data: target }))) as never);
    const runner = fakeRunner(rowsState({ target: last }));
    twoTabs(runner);
    const view = mount(runner);
    tabsOf(view).onChoose(0);
    view.show().area.editing!.onActivate({ row: 0, column: 1 });

    view.show().area.editing!.bar.onAction("newRow");
    // O script sai enquanto o alvo é perguntado, sem a tela redesenhar antes da resposta: quem decide é o executor, lido na hora.
    runner.scriptState = null;
    respond();
    await settle();

    expect(rt.service.editTargetOrRefuse).toHaveBeenCalledWith("s1", "r0", null);
    // Nenhuma linha nova: nem nas linhas que a aba guardava, que saíram, nem nas do executor.
    expect(recall("q1", "edits")?.edits.added ?? []).toEqual([]);
    expect(view.show().area.editing?.rows).toEqual([["10", "aberta"]]);
    expect(unsavedEdits.countOf("q1")).toBe(0);
  });

  it("a edição de uma aba guardada vai à sessão em que ela foi lida: depois de o F5 reabrir a sessão que caiu, a faixa diz que a sessão não existe mais", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: false, error: { status: 404, code: "DATABASE_SESSION_NOT_FOUND", title: "Sessão não localizada.", detail: "A sessão com o banco não existe ou já foi fechada.", errors: null, extensions: {} } });
    const runner = fakeRunner(rowsState({ target: last }));
    const run = twoTabs(runner);
    // A aba guardada foi lida na sessão `s0`, que caiu; o F5 do último abriu a `s1`, que é a da aba agora.
    runner.scriptState = { ...run, results: [{ entry: 0, rows: { ...kept(), sessionId: "s0" } }, run.results[1]] };
    const view = mount(runner);
    tabsOf(view).onChoose(0);

    view.show().area.editing!.onEdit({ row: 0, column: 1 });
    await settle();

    expect(rt.service.editTargetOrRefuse).toHaveBeenCalledWith("s0", "r0", null);
    expect(view.show().banner!.props.failure).toMatchObject({ headline: copy.checkResultFailed, detail: "A sessão com o banco não existe ou já foi fechada." });
    expect(view.show().area.editing?.editor).toBeNull();
  });

  it("Salvar na pergunta grava e então troca; se o Salvar falha, a aba fica, com a falha na faixa", async () => {
    withPending();
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.service.saveEditsOrRefuse.mockResolvedValueOnce({ ok: false, error: { status: 422, code: "SQL_EXECUTION_FAILED", title: "Falha ao executar o comando.", detail: "duplicate key value", errors: null, extensions: { change: 0 } } });
    const runner = fakeRunner(rowsState({ target: last }));
    twoTabs(runner);
    const view = mount(runner);

    tabsOf(view).onChoose(0);
    view.show().question!.onSave();
    await settle();
    expect(tabsOf(view).shown).toBe(1);
    expect(view.show().banner?.props.failure).not.toBeNull();

    rt.service.saveEditsOrRefuse.mockResolvedValueOnce({ ok: true, data: { applied: 1 } });
    tabsOf(view).onChoose(0);
    view.show().question!.onSave();
    await settle();
    expect(runner.keepSaved).toHaveBeenCalledWith("r1", expect.anything());
    expect(tabsOf(view).shown).toBe(0);
  });

  it("enquanto o script espera a resposta da pergunta de erro, a edição fica ocupada em todas as abas de resultado, com o motivo", async () => {
    const runner = fakeRunner({ status: "error", source: "database", title: "Erro do banco", message: "boom", sqlState: "42601", errorAt: null });
    let run = withEntry(createScriptRun(1, [first, last]), 0, { status: "ok", rows: { read: 1, more: false, total: null }, kept: true });
    run = { ...withEntry(run, 1, { status: "error", error: { title: "Erro do banco", message: "boom", sqlState: "42601" } }), phase: "paused", current: 1, results: [{ entry: 0, rows: kept() }] };
    runner.scriptState = run;
    const view = mount(runner);
    tabsOf(view).onChoose(0);

    view.show().area.editing!.onEdit({ row: 0, column: 1 });
    await settle();

    expect(view.show().banner?.props.notice).toBe(copy.readOnly(copy.reasons.busy));
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
    // Os quatro botões da barra também, com o mesmo motivo (RN-EDIT-014).
    expect(view.show().area.editing!.bar.buttons.map((button) => button.reason)).toEqual(Array(4).fill(copy.readOnly(copy.reasons.busy)));
  });

  it("as alterações não salvas de uma aba guardada vão ao registro da aba: levar a aba para outra janela, ou fechá-la, pergunta antes (RN-EDIT-007)", () => {
    keptPending();
    const runner = fakeRunner(rowsState({ target: last }));
    twoTabs(runner);
    const view = mount(runner);
    tabsOf(view).onChoose(0);
    view.show();

    expect(unsavedEdits.countOf("q1")).toBe(1);
    expect(unsavedEdits.saveOf("q1")).not.toBeNull();
  });
});

describe("QueryTabPanel: o aviso antes de executar, na conexão que confirma (RN-PROT-001)", () => {
  const drop: RunTarget = { sql: "DELETE FROM loja.pedido", offset: 0, engine: pg };
  const irreversible = () => (rt.protections = { readOnly: null, confirm: { level: "irreversible", from: null } });
  const all = () => (rt.protections = { readOnly: null, confirm: { level: "all", from: null } });

  it("sem proteção nada pergunta, e o comando sai na mesma chamada", () => {
    const runner = fakeRunner(rowsState());
    mount(runner).show().editor.onRun(drop, noFlash);

    expect(rt.asked).toEqual([]);
    expect(runner.sent).toEqual([drop]);
  });

  it("“Só comandos irreversíveis”: o DELETE sem WHERE espera o “Executar mesmo assim”, e o destaque só acende quando ele sai; a leitura não pergunta", () => {
    irreversible();
    const runner = fakeRunner(rowsState());
    const flash = vi.fn();
    const view = mount(runner);

    view.show().editor.onRun(drop, flash);
    expect(rt.asked.map(({ question }) => question)).toEqual([{ kind: "command", command: { number: null, sql: drop.sql, irreversible: { kind: "delete", target: "loja.pedido" } } }]);
    expect(runner.sent).toEqual([]);
    expect(flash).not.toHaveBeenCalled();

    rt.asked[0].proceed();
    expect(runner.sent).toEqual([drop]);
    expect(flash).toHaveBeenCalledOnce();

    rt.unmount();
    const reader = fakeRunner(rowsState());
    mount(reader).show().editor.onRun(command, noFlash);
    expect(rt.asked).toHaveLength(1);
    expect(reader.sent).toEqual([command]);
  });

  it("cancelar não executa nada e deixa a aba como estava, com o resultado de antes", () => {
    irreversible();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().editor.onRun(drop, noFlash);
    rt.asked[0].cancelled?.();

    expect(runner.run).not.toHaveBeenCalled();
    expect(view.show().area.state).toMatchObject({ status: "rows", resultId: "r1" });
  });

  it("numa conexão somente leitura, “Só comandos irreversíveis” não pergunta (a API recusa); “Todos os comandos” continua perguntando", () => {
    rt.protections = { readOnly: { from: null }, confirm: { level: "irreversible", from: null } };
    const runner = fakeRunner(rowsState());
    mount(runner).show().editor.onRun(drop, noFlash);
    expect(rt.asked).toEqual([]);
    expect(runner.sent).toEqual([drop]);

    rt.unmount();
    rt.protections = { readOnly: { from: null }, confirm: { level: "all", from: null } };
    const other = fakeRunner(rowsState());
    mount(other).show().editor.onRun(command, noFlash);
    expect(rt.asked.map(({ question }) => question.kind)).toEqual(["command"]);
    expect(other.sent).toEqual([]);
  });

  it("com alterações não salvas, a pergunta delas vem antes, e o aviso depois, logo antes de o comando sair", () => {
    all();
    withPending();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().editor.onRun(command, noFlash);
    expect(view.show().question).toBeDefined();
    expect(rt.asked).toEqual([]);

    view.show().question!.onDiscard();
    expect(rt.asked.map(({ question }) => question.kind)).toEqual(["command"]);
    rt.asked[0].proceed();
    expect(runner.sent).toEqual([command]);
  });

  it("o que o executor não enviaria (dois comandos na seleção) não pergunta: ele só avisa", () => {
    all();
    const runner = fakeRunner(rowsState());
    const several: RunTarget = { sql: "select 1; select 2", offset: 0, engine: pg };
    mount(runner).show().editor.onRun(several, noFlash);

    expect(rt.asked).toEqual([]);
    expect(runner.run).toHaveBeenCalledWith(several);
  });

  it("o script pergunta uma vez, antes do primeiro comando, com a lista dos irreversíveis e o número de cada; confirmado, roda inteiro", () => {
    irreversible();
    const runner = fakeRunner(rowsState());
    const targets: RunTarget[] = [command, drop, { sql: "TRUNCATE loja.item", offset: 40, engine: pg }];
    mount(runner).show().editor.onRunScript!(targets);

    expect(rt.asked).toHaveLength(1);
    expect(rt.asked[0].question).toMatchObject({ kind: "script", total: 3, commands: [{ number: 2, sql: drop.sql }, { number: 3, sql: "TRUNCATE loja.item" }] });
    expect(runner.scripts).toEqual([]);

    rt.asked[0].proceed();
    expect(runner.scripts).toEqual([targets]);
  });

  it("o script cancelado não roda nada; o sem nenhum irreversível roda sem perguntar", () => {
    irreversible();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().editor.onRunScript!([drop]);
    rt.asked[0].cancelled?.();
    expect(runner.runScript).not.toHaveBeenCalled();

    view.show().editor.onRunScript!([command]);
    expect(rt.asked).toHaveLength(1);
    expect(runner.scripts).toEqual([[command]]);
  });

  it("F5 e “Executar de novo” perguntam pelo comando do resultado, como qualquer execução", () => {
    all();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().keys({ key: "F5", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault: vi.fn() });
    expect(rt.asked.map(({ question }) => question)).toEqual([{ kind: "command", command: { number: null, sql: "select * from loja.pedido", irreversible: null } }]);
    expect(runner.rerun).not.toHaveBeenCalled();
    rt.asked[0].proceed();
    expect(runner.rerun).toHaveBeenCalledOnce();

    view.show().area.onRerun();
    expect(rt.asked).toHaveLength(2);
    rt.asked[1].cancelled?.();
    expect(runner.rerun).toHaveBeenCalledOnce();
  });

  it("o “Atualizar” do menu da grade pergunta como o F5, pelo comando do resultado", async () => {
    all();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 0, y: 0 }, false);
    await settle();

    view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "refresh")!.onSelect!();
    expect(rt.asked.map(({ question }) => question)).toEqual([{ kind: "command", command: { number: null, sql: "select * from loja.pedido", irreversible: null } }]);
    expect(runner.rerun).not.toHaveBeenCalled();
    rt.asked[0].proceed();
    expect(runner.rerun).toHaveBeenCalledOnce();
  });

  it("aplicar o filtro pergunta pelo comando que vai ao banco, com o filtro junto; cancelado, o campo e o filtro em vigor ficam", async () => {
    all();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().filter!.onDraft(`"status" = 'aberta'`);
    view.show().filter!.onApply();
    expect(rt.asked.map(({ question }) => question)).toEqual([{ kind: "command", command: { number: null, sql: "select * from loja.pedido", filter: `"status" = 'aberta'`, irreversible: null } }]);
    rt.asked[0].cancelled?.();
    await settle();
    expect(runner.run).not.toHaveBeenCalled();
    expect(view.show().filter).toMatchObject({ applied: "", draft: `"status" = 'aberta'` });

    view.show().filter!.onApply();
    rt.asked[1].proceed();
    await settle();
    expect(runner.sent).toEqual([{ sql: "select * from loja.pedido", offset: 0, engine: pg, filter: `"status" = 'aberta'` }]);
  });

  it("“Todos os comandos”: ligar a atualização automática pergunta uma vez; trocar só o intervalo, com ela ligada, não", () => {
    all();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().auto!.onChoose("autoRefresh:every:10000");
    expect(rt.asked.map(({ question }) => question.kind)).toEqual(["autoRefresh"]);
    expect(runner.autoRefresh.start).not.toHaveBeenCalled();
    rt.asked[0].proceed();
    expect(runner.autoRefresh.start).toHaveBeenCalledExactlyOnceWith(10_000);

    runner.autoRefresh.getState = () => ({ status: "on", everyMs: 10_000, lastAt: null, running: false, paused: null });
    view.show().auto!.onChoose("autoRefresh:every:30000");
    expect(rt.asked).toHaveLength(1);
    expect(runner.autoRefresh.start).toHaveBeenLastCalledWith(30_000);
  });

  it("“Só comandos irreversíveis” não pergunta ao ligar a atualização automática: ela só repete uma leitura", () => {
    irreversible();
    const runner = fakeRunner(rowsState());
    mount(runner).show().auto!.onChoose("autoRefresh:every:10000");

    expect(rt.asked).toEqual([]);
    expect(runner.autoRefresh.start).toHaveBeenCalledExactlyOnceWith(10_000);
  });

  it("“Todos os comandos”: o Salvar da grade pergunta uma vez, com quantas alterações vão; cancelado, nada é gravado e a alteração fica", async () => {
    all();
    withPending();
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.service.saveEditsOrRefuse.mockResolvedValue({ ok: true, data: { applied: 1 } });
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().banner!.props.onSave();
    await settle();
    expect(rt.asked.map(({ question }) => question)).toEqual([{ kind: "save", count: 1 }]);
    rt.asked[0].cancelled?.();
    await settle();
    expect(rt.service.saveEditsOrRefuse).not.toHaveBeenCalled();
    expect(view.show().banner?.props.pending).toBe(1);

    view.show().banner!.props.onSave();
    await settle();
    rt.asked[1].proceed();
    await settle();
    expect(rt.service.saveEditsOrRefuse).toHaveBeenCalledOnce();
    expect(runner.keepSaved).toHaveBeenCalledOnce();
  });

  it("“Só comandos irreversíveis”: o Salvar não pergunta (cada comando dele é pela chave da linha, com WHERE)", async () => {
    irreversible();
    withPending();
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.service.saveEditsOrRefuse.mockResolvedValue({ ok: true, data: { applied: 1 } });
    const view = mount(fakeRunner(rowsState()));

    view.show().banner!.props.onSave();
    await settle();

    expect(rt.asked).toEqual([]);
    expect(rt.service.saveEditsOrRefuse).toHaveBeenCalledOnce();
  });
});

describe("QueryTabPanel: a grade de uma conexão somente leitura não se edita (RN-PROT-002 e RN-EDIT-002)", () => {
  // A lista das conexões em cache diz que `c1` é somente leitura agora: o motivo dela, na página ou na recusa, só vale enquanto ela é (RN-PROT-003).
  const getQueryData = rt.queryClient.getQueryData;
  beforeEach(() => {
    rt.queryClient.getQueryData = ((key: unknown) => (Array.isArray(key) && key[0] === "connections" ? [{ id: "c1", protections: { readOnly: true } }] : undefined)) as never;
  });
  afterEach(() => {
    rt.queryClient.getQueryData = getQueryData;
  });

  it("a página da conexão somente leitura já diz por quê: a faixa mostra o motivo, e “Editar célula” fica desabilitado com ele, sem perguntar o alvo", async () => {
    const view = mount(fakeRunner(rowsState({ readOnly: "a conexão é somente leitura" })));

    expect(view.show().banner?.props.readOnly).toBe("Somente leitura: a conexão é somente leitura.");
    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    const items = view.show().menu!.groups.flatMap(groupItems);

    expect(items.find((item) => item.label === copy.menu.edit)).toMatchObject({ disabled: true, hint: "Somente leitura: a conexão é somente leitura." });
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
  });

  it("a conexão que passou a ser somente leitura depois do resultado (a API recusa o alvo com CONNECTION_READ_ONLY) fica só leitura, com o mesmo motivo", async () => {
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: false, error: { status: 422, code: "CONNECTION_READ_ONLY", title: "Conexão somente leitura.", detail: "A conexão é somente leitura: nada se grava nela, e a edição de registros não vale. Nada foi enviado ao banco.", errors: null, extensions: {} } });
    const view = mount(fakeRunner(rowsState()));

    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    const items = view.show().menu!.groups.flatMap(groupItems);

    expect(items.find((item) => item.label === copy.menu.edit)).toMatchObject({ disabled: true, hint: copy.readOnly(copy.reasons.connectionReadOnly) });
    expect(view.show().banner?.props.readOnly).toBe(copy.readOnly(copy.reasons.connectionReadOnly));
    // Dali em diante, os quatro botões da barra de edição também (RN-EDIT-014).
    expect(view.show().area.editing!.bar.buttons.map((button) => button.reason)).toEqual(Array(4).fill(copy.readOnly(copy.reasons.connectionReadOnly)));
  });

  it("os quatro botões da barra de edição ficam desabilitados desde o começo, com o motivo da página (RN-EDIT-013 e 014)", () => {
    const view = mount(fakeRunner(rowsState({ readOnly: "a conexão é somente leitura" })));
    const { buttons } = view.show().area.editing!.bar;

    expect(buttons.map((button) => button.title)).toEqual([
      "Editar célula (F2). Somente leitura: a conexão é somente leitura.",
      "Adicionar linha (Alt+Insert). Somente leitura: a conexão é somente leitura.",
      "Duplicar linha (Ctrl+Alt+Insert). Somente leitura: a conexão é somente leitura.",
      "Excluir linha (Alt+Delete). Somente leitura: a conexão é somente leitura.",
    ]);
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
  });

  it("desmarcado o \"Somente leitura\" depois da leitura, o motivo da página não vale: a faixa não o mostra, e \"Editar célula\" pergunta o alvo à API", async () => {
    rt.queryClient.getQueryData = getQueryData;
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    const view = mount(fakeRunner(rowsState({ readOnly: "a conexão é somente leitura" })));

    expect(view.show().banner?.props.readOnly).toBeNull();
    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    const items = view.show().menu!.groups.flatMap(groupItems);

    expect(rt.service.editTargetOrRefuse).toHaveBeenCalledTimes(1);
    expect(items.find((item) => item.label === copy.menu.edit)?.disabled).toBeFalsy();
  });
});

describe("QueryTabPanel: o \"Ordenar\" do menu da grade, pelo campo de filtro do resultado (RN-GRADE-004 e 011)", () => {
  const filtered = (text: string) => ({ ...rowsState().target, filter: text });

  it("a ordem escolhida é escrita no campo e aplicada; a ordem em uso, a do filtro aplicado, vem marcada", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 1 }, false);
    await settle();
    const sort = () => view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "sort")!.submenu!.groups.flatMap(groupItems);
    expect(sort().map((item) => item.checked)).toEqual([false, false, true]);
    sort().find((item) => item.id === "sort:asc")!.onSelect!();
    await settle();

    expect(runner.sent).toEqual([filtered('ORDER BY "status" ASC')]);
  });
});

describe("QueryTabPanel: o Copiar avançado e o Gerar SQL do menu da grade, no resultado e nas abas guardadas do script (seção 37)", () => {
  /** O alvo do "Gerar SQL" de `loja.pedido`, de uma tabela só. */
  const sqlTarget: SqlTarget = { ...target, tables: target.tables.map((table) => ({ ...table, kind: "table" as const, keyColumns: ["id"] })) };
  let clipboard: { writeText: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    clipboard = { writeText: vi.fn(async () => {}) };
    vi.stubGlobal("navigator", { clipboard, platform: "Win32" });
    rt.service.editTargetOrRefuse.mockResolvedValue({ ok: true, data: target });
    rt.service.sqlTargetOrRefuse.mockResolvedValue({ ok: true, data: sqlTarget });
  });
  afterEach(() => vi.unstubAllGlobals());

  const items = (view: ReturnType<typeof mount>) => view.show().menu!.groups.flatMap(groupItems);
  const submenu = (view: ReturnType<typeof mount>, id: string) => items(view).find((item) => item.id === id)!.submenu!.groups.flatMap(groupItems);
  const dialogOf = (view: ReturnType<typeof mount>, type: unknown) => view.show().found.find((element) => element.type === type)?.props;
  async function chooseOn(view: ReturnType<typeof mount>, parent: string, id: string) {
    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    submenu(view, parent).find((item) => item.id === id)!.onSelect!();
    await settle();
    await settle();
  }

  it("Copiar como JSON: a origem é `resultado`; Copiar como SQL usa a tabela do alvo de uma tabela só, que a edição já perguntou", async () => {
    const view = mount(fakeRunner(rowsState()));
    await chooseOn(view, "advancedCopy", "copyAs:json");
    expect(clipboard.writeText.mock.calls[0][0]).toContain('"resultado"');
    expect(rt.toast.success).toHaveBeenCalledWith(copyAsCopy.notice.copied(1, "json"));

    await chooseOn(view, "advancedCopy", "copyAs:sql");
    expect(clipboard.writeText.mock.calls[1][0]).toContain('INSERT INTO "loja"."pedido" ("status")');
    // O alvo que a edição já pediu (ao abrir o menu) não traz o tipo nem a chave pelo nome: o do "Gerar SQL" é perguntado uma vez, com purpose sql.
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledTimes(1);
  });

  it("numa junção, Copiar como SQL abre o Copiar avançado… no SQL, com o foco no campo da tabela", async () => {
    rt.service.sqlTargetOrRefuse.mockResolvedValue({ ok: true, data: { ...sqlTarget, tables: [...sqlTarget.tables, { ...sqlTarget.tables[0], name: "cliente" }] } });
    const view = mount(fakeRunner(rowsState()));
    await chooseOn(view, "advancedCopy", "copyAs:sql");

    expect(clipboard.writeText).not.toHaveBeenCalled();
    expect(dialogOf(view, CopyAdvancedDialog)).toMatchObject({ initialFormat: "sql", focusTable: true });
  });

  it("Configurar comandos 'Copiar como'… abre o diálogo dele", async () => {
    const view = mount(fakeRunner(rowsState()));
    await chooseOn(view, "advancedCopy", "copyAsConfigure");
    expect(dialogOf(view, ConfigureCopyAsDialog)).toBeDefined();
  });

  it("Gerar SQL ▸ UPDATE abre o diálogo; \"Abrir numa aba de consulta\" abre a aba nova da conexão da aba", async () => {
    const view = mount(fakeRunner(rowsState()));
    await chooseOn(view, "generateSql", "sql:update");

    const dialog = dialogOf(view, GenerateSqlDialog) as unknown as ComponentProps<typeof GenerateSqlDialog>;
    expect(dialog.engine).toBe(pg);
    expect(dialog.dialog.view.body).toEqual({ kind: "text", text: 'UPDATE "loja"."pedido"\nSET "status" = \'aberta\'\nWHERE "id" = 10;' });
    dialog.dialog.onOpenInTab();
    expect(view.props.onOpenQuery).toHaveBeenCalledWith("c1", 'UPDATE "loja"."pedido"\nSET "status" = \'aberta\'\nWHERE "id" = 10;', undefined);
  });

  it("a aba guardada do script tem o Copiar avançado e o Gerar SQL; o alvo é o do resultado dela, pela sessão em que foi lido", async () => {
    const first: RunTarget = { sql: "select * from loja.pedido where id < 5", offset: 0, engine: pg };
    const last: RunTarget = { sql: "select * from loja.pedido", offset: 40, engine: pg };
    const runner = fakeRunner(rowsState({ target: last }));
    let run = createScriptRun(1, [first, last]);
    run = withEntry(run, 0, { status: "ok", rows: { read: 1, more: false, total: null }, kept: true });
    run = withEntry(run, 1, { status: "ok", rows: { read: 1, more: true, total: null }, kept: true });
    runner.scriptState = { ...finishRun(run, "done"), results: [{ entry: 0, rows: rowsState({ id: 7, target: first, rows: [["1", "a"]], hasMore: false, resultId: "r0", sessionId: "s0" }) }, { entry: 1, rows: runner.state as RowsState }], live: 1 };
    const view = mount(runner);
    (view.show().area.tabs!.list as { props: ComponentProps<typeof ScriptTabs> }).props.onChoose(0);

    await chooseOn(view, "generateSql", "sql:delete");
    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledWith("s0", "r0", null);
    const dialog = dialogOf(view, GenerateSqlDialog) as unknown as ComponentProps<typeof GenerateSqlDialog>;
    expect(dialog.dialog.view.body).toEqual({ kind: "text", text: 'DELETE FROM "loja"."pedido"\nWHERE "id" = 1;' });
    dialog.dialog.onClose();

    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    expect(submenu(view, "advancedCopy").map((item) => item.id)).toContain("copyAs:xml");
  });
});
