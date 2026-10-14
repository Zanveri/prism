import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

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
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({ ...(await importOriginal<typeof import("@tanstack/react-query")>()), useQueryClient: () => rt.queryClient }));
vi.mock("@/app/settings/_lib/use-preferences", () => ({ usePreferences: () => ({ preferences: { results: { nullText: "(nulo)", autoLoadMore: false } } }) }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("../_lib/record-edits.service", () => rt.service);
vi.mock("../_lib/full-values.service", () => rt.cells);
// O editor de SQL é CodeMirror, que precisa da página; aqui basta o que a aba entrega a ele.
vi.mock("./sql-editor", () => ({ SqlEditor: function SqlEditor() {
  return null;
} }));

import { ContextMenu } from "@/components/ui";
import { elementsOf } from "@/lib/testing/react-tree";

import { editCell, noEdits } from "../_lib/record-edits";
import { recordsCopy } from "../_lib/records.copy";
import { forgetExcept, remember } from "../_lib/tab-memory";
import { unsavedEdits } from "../_lib/unsaved-edits";
import { isBusyState } from "../_lib/use-query-runner";
import { DatabasePicker } from "./database-picker";
import { EditorToolbar } from "./editor-toolbar";
import { EditsBanner } from "./edits-banner";
import { QueryTabPanel } from "./query-tab";
import { ResultPanel } from "./result-panel";
import { SqlEditor } from "./sql-editor";
import { UnsavedEditsDialog } from "./unsaved-edits-dialog";

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

/** O executor de mentira: `run` recusa calado com algo em andamento e, quando aceita, passa a "executando" na mesma chamada. */
function fakeRunner(initial: RunnerState) {
  const runner = {
    state: initial,
    /** Os comandos aceitos (o espião `run` conta também os recusados). */
    sent: [] as RunTarget[],
    subscribe: () => () => {},
    getState: (): RunnerState => runner.state,
    run: vi.fn((target: RunTarget): Promise<void> => {
      if (!isBusyState(runner.state)) {
        runner.sent.push(target);
        runner.state = { status: "running", cancelling: false, previous: runner.state.status === "rows" ? runner.state : null };
      }
      return Promise.resolve();
    }),
    rerun: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(),
    loadMore: vi.fn(),
    countTotal: vi.fn(),
    textEdited: vi.fn(),
    sessionOf: () => "s1",
    keepSaved: vi.fn(),
  };
  return runner;
}

const tab: QueryTab = { id: "q1", title: "Consulta 1", connectionId: "c1", sessionId: "s1", sql: "select * from loja.pedido" };

/** A aba `q1` na conexão `c1`, à vista. O painel é memorizado: a função dele é a de dentro do `memo`. */
function mount(runner: ReturnType<typeof fakeRunner>, over: Partial<QueryTab> = {}) {
  const panel = (QueryTabPanel as unknown as { type: (props: ComponentProps<typeof QueryTabPanel>) => ReactNode }).type;
  const props = { tab: { ...tab, ...over }, runner: runner as unknown as QueryRunner, engine: pg as Engine | undefined, active: true, onSqlChange: vi.fn(), onEdited: vi.fn(), onSave: vi.fn(), onAssignConnection: vi.fn(), onOpenTable: vi.fn(), onSwitchDatabase: vi.fn() };

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

    return { area, editor, question, menu, banner, picker };
  }

  return { show, props };
}

/** Uma alteração pendente na coluna `status` da primeira linha do resultado `r1`. */
const withPending = () => remember("q1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 1, "paga", "aberta") });

/** Deixa as promessas em andamento chegarem ao fim. */
const settle = () => new Promise((done) => setTimeout(done, 0));

const command: RunTarget = { sql: "select 2", offset: 0, engine: pg };

beforeEach(() => {
  vi.clearAllMocks();
  forgetExcept(new Set());
  unsavedEdits.forgetExcept(new Set());
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
    const { banner } = mount(fakeRunner(rowsState({ readOnly: "junção de tabelas" }))).show();

    expect(banner?.props.readOnly).toBe(copy.readOnly("junção de tabelas"));
  });

  it("no resultado só leitura, o menu da célula mostra 'Editar célula' desabilitado, com o motivo; copiar continua", async () => {
    const view = mount(fakeRunner(rowsState({ readOnly: "junção de tabelas" })));

    view.show().area.editing!.onMenu({ row: 0, column: 1 }, { x: 4, y: 4 }, false);
    await settle();
    const items = view.show().menu!.groups.flat();

    expect(items.find((item) => item.label === copy.menu.edit)).toMatchObject({ disabled: true, hint: copy.readOnly("junção de tabelas") });
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
    view.show().menu!.groups.flat().find((item) => item.label === copy.menu.copyValue)!.onSelect();
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

    view.show().editor.onRun(command);
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

    view.show().editor.onRun(command);
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
    mount(free).show().editor.onRun(command);
    expect(free.run).toHaveBeenCalledWith(command);
    rt.unmount();

    withPending();
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    const several = { ...command, sql: "select 1; select 2" };
    view.show().editor.onRun(several);

    expect(runner.run).toHaveBeenCalledWith(several);
    expect(view.show().question).toBeUndefined();
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

    view.show().editor.onRun(command);
    view.show().question!.onSave();
    await settle();

    expect(runner.keepSaved).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith(command);
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
