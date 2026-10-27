import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import type { AutoRefreshBlocker, AutoRefreshState } from "../../_lib/auto-refresh";
import type { ForeignKey } from "../../_lib/database-sessions.schema";
import type { QueryRunner, RowsState, RunnerState, RunTarget } from "../../_lib/use-query-runner";

// A vista Registros com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`: o vitest deste projeto não tem DOM). As decisões
// dela são funções de `table-view.ts` e de `foreign-key-links.ts`, com teste próprio; o que se confere AQUI é a ligação, que nenhum teste guardava: o que a
// vista ENTREGA a cada uma (a aba à vista, a conexão desconectada, o estado do executor lido na hora) e o que chega ao campo do filtro, à área de resultado
// e ao executor em cada situação. Trocar `disconnected` por `false`, `visible` por `true` ou o estado do executor por um velho passava com a suíte verde, e
// duas dessas trocas devolviam o link e o filtro "aplicado" a uma conexão desconectada.
//
// A mini-runtime não desce aos filhos: as propriedades dos elementos `RecordsFilter` e `ResultPanel` que a vista devolve são o que cada um receberia. O
// executor é de mentira, com o que o de verdade tem de relevante (ver `fakeRunner`); a passagem do filtro, a memória da aba e as funções de decisão são as
// de verdade.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return {
    ...createHookRuntime(),
    /** O catálogo das chaves estrangeiras: o que a consulta devolve (`undefined` enquanto não chegou) e o que a vista pediu a `useQuery` em cada renderização. */
    catalog: { data: undefined as ForeignKey[] | undefined, asked: [] as { queryKey: readonly unknown[]; enabled?: boolean }[] },
    /** RN-IMPORT-001: as listas que a vista lê do cache pela chave (as conexões, as pastas e os grupos da árvore); as outras consultas recebem o catálogo. */
    lists: new Map<string, unknown>(),
    openImport: vi.fn(),
    queryClient: { getQueryData: () => undefined },
    // A conferência do catálogo da edição: o resultado é só leitura (o menu da célula abre com o motivo, sem rota de verdade).
    service: {
      editTargetOrRefuse: vi.fn(async () => ({ ok: false, error: { code: "RESULT_NOT_EDITABLE", title: "Só leitura", detail: "teste", extensions: {} } })),
      saveEditsOrRefuse: vi.fn(),
      previewEditsOrRefuse: vi.fn(),
      sqlTargetOrRefuse: vi.fn(),
    },
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
    saveText: vi.fn(),
    cells: { resultCells: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const listed = JSON.stringify(options.queryKey);
    if (rt.lists.has(listed)) return { data: rt.lists.get(listed) };
    rt.catalog.asked.push(options);
    return { data: rt.catalog.data };
  },
  useQueryClient: () => rt.queryClient,
}));
vi.mock("@/app/settings/_lib/use-preferences", () => ({ usePreferences: () => ({ preferences: { results: { nullText: "(nulo)", autoLoadMore: true }, editor: { autocomplete: true } } }) }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/components/ui/toast")>()), useToast: () => rt.toast }));
vi.mock("../../_lib/save-file", () => ({ saveText: rt.saveText }));
vi.mock("../../_lib/full-values.service", () => rt.cells);
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, work: () => Promise<unknown>) => work() }));
vi.mock("../../_lib/record-edits.service", () => rt.service);
vi.mock("../../_lib/data-import/data-imports", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../_lib/data-import/data-imports")>()), openImportWizard: rt.openImport }));

import { elementsOf } from "@/lib/testing/react-tree";

import { csvBom } from "../../_lib/csv";
import { filterHandoff } from "../../_lib/filter-handoff";
import { forgetExcept } from "../../_lib/tab-memory";
import { createRefreshSlot, type RefreshSlot } from "../../_lib/tab-refresh";
import { recordsSql } from "../../_lib/table-sql";
import { structureKey } from "../../_lib/table-structure.service";
import { canClear } from "../../_lib/table-view";
import { isPersonBusy } from "../../_lib/use-query-runner";
import { workbenchCopy } from "../../_lib/workbench.copy";
import { ResultPanel } from "../result-panel";
import { addRow, deleteRow, editCell, noEdits } from "../../_lib/record-edits";
import { recordsCopy } from "../../_lib/records.copy";
import { remember } from "../../_lib/tab-memory";
import { EditsBanner } from "../edits-banner";
import { RecordsFilter } from "./records-filter";
import { RecordsView } from "./records-view";
import { UnsavedEditsDialog } from "../unsaved-edits-dialog";
import { ContextMenu } from "@/components/ui";
import { groupItems, type ContextMenuItem } from "@/components/ui/context-menu";
import { CustomFilterField } from "../custom-filter-field";
import { ValueFilterDialog } from "../value-filter-dialog";
import { AutoRefreshControl, AutoRefreshDialog } from "../auto-refresh-control";
import { autoRefreshCopy } from "../../_lib/auto-refresh.copy";
import { markImported } from "../../_lib/data-import/data-imports";
import { treeKey } from "../../_lib/database-sessions.service";
import { unprotected } from "@/app/connections/_lib/connections.schema";
import { copyAsCopy } from "../../_lib/copy-as/copy-as.copy";
import { generateSqlCopy } from "../../_lib/generate-sql/generate-sql.copy";
import { CopyAdvancedDialog } from "../copy-as/copy-advanced-dialog";
import { GenerateSqlDialog } from "../generate-sql/generate-sql-dialog";

/** PostgreSQL, como a API numera os bancos. */
const pg: Engine = 1;
const pedidos = { schema: "loja", name: "pedidos" };
const clientes = { schema: "loja", name: "clientes" };
/** Sem filtro nem ordem: o `SELECT` puro. */
const noFilter = "";

/** A tabela da vista: `loja.pedidos`, com `cliente_id` apontando para `loja.clientes(id)`. */
const columns: RowsState["columns"] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "cliente_id", type: "int4", kind: "number" },
];
const foreignKeys: ForeignKey[] = [{ name: "pedidos_cliente_fk", columns: ["cliente_id"], referencedSchema: "loja", referencedTable: "clientes", referencedColumns: ["id"] }];

function rowsState(over: Partial<RowsState> = {}): RowsState {
  return { status: "rows", id: 1, target: { sql: "select 1", offset: 0 }, columns, rows: [["10", "4"]], truncated: new Map(), hasMore: false, totalRows: null, elapsedMs: 3, pages: 1, loadingMore: false, cancelling: false, cursorClosed: false, total: null, counting: false, ...over };
}

/** As três formas de a aba estar ocupada (RN-SESSAO-002). */
const busyStates: [string, RunnerState][] = [
  ["um comando", { status: "running", cancelling: false, previous: null }],
  ["'carregar mais'", rowsState({ loadingMore: true })],
  ["a contagem", rowsState({ counting: true })],
];

const sqlOf = (filter: string) => recordsSql(pg, pedidos.schema, pedidos.name, filter);
/** O que o executor recebe para o filtro dado (o texto do campo: a condição, a ordem ou as duas). */
const sent = (filter: string): RunTarget => ({ sql: sqlOf(filter), offset: 0, engine: pg });

/**
 * O executor de mentira, com o que o de verdade tem de relevante aqui: `run` recusa calado com algo da pessoa em andamento (RN-SESSAO-002), aceita no
 * lugar da execução automática (RN-GRADE-014) e, quando aceita, passa a "executando" NA MESMA chamada. `sent` são os comandos aceitos; `run` (o espião)
 * conta também os pedidos recusados. O estado é o que a prova pôr.
 */
function fakeRunner(initial: RunnerState) {
  const runner = {
    state: initial,
    sent: [] as RunTarget[],
    subscribe: () => () => {},
    getState: (): RunnerState => runner.state,
    run: vi.fn((target: RunTarget): Promise<void> => {
      if (!isPersonBusy(runner.state)) {
        runner.sent.push(target);
        runner.state = { status: "running", cancelling: false, previous: runner.state.status === "rows" ? runner.state : runner.state.status === "running" ? runner.state.previous : null };
      }
      return Promise.resolve();
    }),
    /** RN-GRADE-014: a execução automática em andamento termina quando a prova soltar (`settleAuto`). */
    autoRunSettled: vi.fn(() => runner.autoDone),
    autoDone: Promise.resolve(),
    cancel: vi.fn(),
    loadMore: vi.fn(),
    countTotal: vi.fn(),
    sessionOf: () => "s1",
    /** RN-GRADE-014: o relógio da atualização automática, desligado; a prova lê as pausas e os pedidos de ligar e desligar. */
    autoRefresh: { subscribe: () => () => {}, getState: (): AutoRefreshState => ({ status: "off", stopped: null }), blocker: (): AutoRefreshBlocker | null => null, start: vi.fn(), stop: vi.fn(), pause: vi.fn() },
  };
  return runner;
}

/** `runner` troca o executor da vista (o provedor que entrega outro à aba). */
type Over = { environmentColor?: string | null; filterRef?: ComponentProps<typeof RecordsView>["filterRef"]; tabId?: string; engine?: Engine | undefined; connected?: boolean; visible?: boolean; disconnected?: boolean; refreshSlot?: RefreshSlot; runner?: QueryRunner; database?: string; onOpenQuery?: (connectionId: string, sql: string, database?: string) => void };

/** A vista de `loja.pedidos` na conexão `c1`: à vista e conectada, salvo o que `over` disser. */
function mount(runner: ReturnType<typeof fakeRunner>, over: Over = {}) {
  const onOpenTable = vi.fn();
  const props = { tabId: "t1", runner: runner as unknown as QueryRunner, engine: pg as Engine | undefined, connectionId: "c1", ...pedidos, connected: true, environmentColor: null as string | null, visible: true, disconnected: false, onOpenTable, ...over };

  /**
   * O que a vista entrega AGORA ao campo do filtro e à área de resultado, com as propriedades trocadas por `change`. São duas voltas: os efeitos da primeira
   * mexem no executor e na passagem do filtro (lojas que o React assina e a mini-runtime não), e a segunda é o redesenho que ele faria.
   */
  function show(change: Over = {}) {
    Object.assign(props, change);
    rt.render(() => RecordsView(props));
    const found = elementsOf(rt.render(() => RecordsView(props)));
    const filter = found.find((element) => element.type === RecordsFilter)!.props as unknown as ComponentProps<typeof RecordsFilter>;
    const panel = found.find((element) => element.type === ResultPanel)!.props as unknown as ComponentProps<typeof ResultPanel>;
    const question = found.find((element) => element.type === UnsavedEditsDialog)?.props as unknown as ComponentProps<typeof UnsavedEditsDialog> | undefined;
    const menu = found.find((element) => element.type === ContextMenu)?.props as unknown as ComponentProps<typeof ContextMenu> | undefined;
    const values = found.find((element) => element.type === ValueFilterDialog)?.props as unknown as ComponentProps<typeof ValueFilterDialog> | undefined;
    const custom = found.find((element) => element.type === CustomFilterField)?.props as unknown as ComponentProps<typeof CustomFilterField> | undefined;
    const auto = elementsOf(panel.autoRefresh).find((element) => element.type === AutoRefreshControl)?.props as unknown as ComponentProps<typeof AutoRefreshControl> | undefined;
    const autoDialog = found.find((element) => element.type === AutoRefreshDialog)?.props as unknown as ComponentProps<typeof AutoRefreshDialog> | undefined;

    // RN-GRADE-021: a ordem do cabeçalho é o botão de ordenar, que a edição entrega à grade (`editing.sort`): a seta que ele mostra e o clique nele.
    const sort = panel.editing?.sort;
    const records = { ...panel.records!, sort: sort?.applied ?? null, onSort: (column: string) => sort?.onSort(column) };
    return { filter, panel, records, question, menu, values, custom, auto, autoDialog, found };
  }

  return { show, onOpenTable };
}

/** O campo, o filtro em vigor e o comando à vista. */
const fieldOf = ({ filter }: ReturnType<ReturnType<typeof mount>["show"]>) => ({ draft: filter.draft, applied: filter.applied, command: filter.command });

beforeEach(() => {
  vi.clearAllMocks();
  rt.catalog.data = undefined;
  rt.catalog.asked.length = 0;
  rt.lists.clear();
  // A memória das abas e a passagem do filtro são de módulo: cada teste começa sem nada lembrado e sem pedido nenhum.
  forgetExcept(new Set());
  filterHandoff.forgetExcept([]);
});

afterEach(() => rt.unmount());

describe("RecordsView: a primeira carga recebe o banco, a aba à vista, a desconexão e o estado do executor (`needsFirstRun`)", () => {
  it("à vista, conectada e sem resultado nenhum: o executor recebe o SELECT da tabela, e só ele", () => {
    const runner = fakeRunner({ status: "idle" });

    const { filter } = mount(runner).show();

    expect(runner.sent).toEqual([sent(noFilter)]);
    expect(filter.command).toBe(sqlOf(noFilter));
  });

  it("escondida, não pede nada ao executor e espera ('Carregando…'); aberta, executa", () => {
    const runner = fakeRunner({ status: "idle" });
    const view = mount(runner, { visible: false });

    expect(view.show().records).toMatchObject({ waiting: true, disconnected: false });
    expect(runner.run).not.toHaveBeenCalled();

    view.show({ visible: true });
    expect(runner.sent).toEqual([sent(noFilter)]);
  });

  it("desconectada pela pessoa, não pede nada ao executor e a área diz que está desconectada; reconectada, executa", () => {
    const runner = fakeRunner({ status: "idle" });
    const view = mount(runner, { disconnected: true });

    expect(view.show().records).toMatchObject({ waiting: false, disconnected: true });
    expect(runner.run).not.toHaveBeenCalled();

    view.show({ disconnected: false });
    expect(runner.sent).toEqual([sent(noFilter)]);
  });

  it("sem o banco da conexão não pede nada, espera, e não há comando à vista; quando ele chega, executa", () => {
    const runner = fakeRunner({ status: "idle" });
    const view = mount(runner, { engine: undefined });
    const before = view.show();

    expect(before.records).toMatchObject({ waiting: true, disconnected: false });
    expect(before.filter.command).toBeNull();
    expect(before.records.linkable?.("4")).toBe(false);
    expect(runner.run).not.toHaveBeenCalled();

    view.show({ engine: pg });
    expect(runner.sent).toEqual([sent(noFilter)]);
  });

  it.each<[string, RunnerState]>([
    ["linhas", rowsState()],
    ["um cancelamento", { status: "cancelled" }],
    ["um erro do banco", { status: "error", source: "database", title: "Erro", message: "relation does not exist", sqlState: "42P01", errorAt: null }],
  ])("com %s na tela, montar a vista de novo não executa: quem refaz é 'Atualizar'", (_what, state) => {
    const runner = fakeRunner(state);

    const { records } = mount(runner).show();

    expect(runner.run).not.toHaveBeenCalled();
    expect(records).toMatchObject({ waiting: false, disconnected: false });
  });
});

describe("RecordsView: o filtro que outra aba pediu só é levado com a aba à vista, livre e conectada (`takeHandoff` e `settleHandoff`)", () => {
  const asked = '"id" = 10';
  const filtered = asked;
  const untouched = { draft: "", applied: "", command: sqlOf(noFilter) };
  const taken = { draft: asked, applied: asked, command: sqlOf(filtered) };

  it("aba nova (sem resultado nenhum): o filtro vai ao campo, a primeira carga já sai com ele, e o pedido sai da passagem", () => {
    filterHandoff.request("c1", pedidos, asked);
    const runner = fakeRunner({ status: "idle" });

    expect(fieldOf(mount(runner).show())).toEqual(taken);
    expect(runner.sent).toEqual([sent(filtered)]);
    expect(filterHandoff.peek("c1", pedidos)).toBeNull();
  });

  it("aba com linhas na tela: o filtro vai ao campo, a consulta se refaz com ele, e o pedido sai da passagem", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show();
    filterHandoff.request("c1", pedidos, asked);

    expect(fieldOf(view.show())).toEqual(taken);
    expect(runner.sent).toEqual([sent(filtered)]);
    expect(filterHandoff.peek("c1", pedidos)).toBeNull();
  });

  it("a ordem em vigor fica: o comando sai com a condição pedida E com a ordem do cabeçalho, e o campo mostra as duas", () => {
    const kept = `${asked} ORDER BY "id" ASC`;
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().records.onSort("id");
    runner.state = rowsState({ id: 2 });
    filterHandoff.request("c1", pedidos, asked);

    const after = view.show();

    expect(runner.sent.at(-1)).toEqual(sent(kept));
    expect(fieldOf(after)).toEqual({ draft: kept, applied: kept, command: sqlOf(kept) });
    expect(after.records.sort).toEqual({ column: "id", direction: "asc" });
  });

  it("a condição que estava em vigor sai, e a pedida entra no lugar dela", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().filter.onDraft("cliente_id = 4 order by id desc");
    view.show().filter.onApply();
    runner.state = rowsState({ id: 2 });
    filterHandoff.request("c1", pedidos, asked);

    expect(fieldOf(view.show())).toMatchObject({ draft: `${asked} order by id desc`, applied: `${asked} order by id desc` });
  });

  it("desconectada pela pessoa, o pedido ESPERA na passagem: o campo, o filtro em vigor e o comando ficam como estavam, e nada é pedido ao executor; reconectada, é levado", () => {
    filterHandoff.request("c1", pedidos, asked);
    const runner = fakeRunner(rowsState());
    const view = mount(runner, { disconnected: true });

    expect(fieldOf(view.show())).toEqual(untouched);
    expect(runner.run).not.toHaveBeenCalled();
    expect(filterHandoff.peek("c1", pedidos)).toMatchObject({ where: asked });

    expect(fieldOf(view.show({ disconnected: false }))).toEqual(taken);
    expect(runner.sent).toEqual([sent(filtered)]);
  });

  it("escondida, o pedido espera do mesmo jeito; aberta, é levado", () => {
    filterHandoff.request("c1", pedidos, asked);
    const runner = fakeRunner(rowsState());
    const view = mount(runner, { visible: false });

    expect(fieldOf(view.show())).toEqual(untouched);
    expect(runner.run).not.toHaveBeenCalled();
    expect(filterHandoff.peek("c1", pedidos)).toMatchObject({ where: asked });

    expect(fieldOf(view.show({ visible: true }))).toEqual(taken);
    expect(runner.sent).toEqual([sent(filtered)]);
  });

  it.each(busyStates)("com %s em andamento o pedido espera (o executor recusaria o comando); quando a aba se livra, é levado", (_what, busy) => {
    filterHandoff.request("c1", pedidos, asked);
    const runner = fakeRunner(busy);
    const view = mount(runner);
    const waiting = view.show();

    expect(fieldOf(waiting)).toEqual(untouched);
    expect(waiting.filter.busy).toBe(true);
    expect(runner.run).not.toHaveBeenCalled();
    expect(filterHandoff.peek("c1", pedidos)).toMatchObject({ where: asked });

    runner.state = rowsState({ id: 2 });
    expect(fieldOf(view.show())).toEqual(taken);
    expect(runner.sent).toEqual([sent(filtered)]);
  });

  it("o pedido para OUTRA tabela, ou para a mesma tabela em outra conexão, não é desta vista", () => {
    filterHandoff.request("c1", clientes, asked);
    filterHandoff.request("c2", pedidos, asked);
    const runner = fakeRunner(rowsState());

    expect(fieldOf(mount(runner).show())).toEqual(untouched);
    expect(runner.run).not.toHaveBeenCalled();
    expect(filterHandoff.peek("c1", clientes)).toMatchObject({ where: asked });
    expect(filterHandoff.peek("c2", pedidos)).toMatchObject({ where: asked });
  });
});

describe("RecordsView: a ordem mora no texto do campo, e 'Limpar' tira a condição e a ordem (`sortRecords` e `clearRecords`, RN-TABELA-010)", () => {
  const byId = 'ORDER BY "id" ASC';
  const idAscending = { column: "id", direction: "asc" };

  it("o defeito relatado: o clique no cabeçalho escreve o ORDER BY no campo, o comando à vista é o dele, a seta aparece e 'Limpar' tem o que limpar", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().records.onSort("id");
    const after = view.show();

    expect(runner.sent).toEqual([sent(byId)]);
    expect(fieldOf(after)).toEqual({ draft: byId, applied: byId, command: sqlOf(byId) });
    expect(after.filter.command).toBe('SELECT * FROM "loja"."pedidos"\nORDER BY "id" ASC');
    expect(after.records.sort).toEqual(idAscending);
    expect(canClear(after.filter.draft, after.filter.applied)).toBe(true);
  });

  it("'Limpar' depois do clique no cabeçalho: o campo esvazia, a ordem sai, e o SELECT puro é enviado e passa a ser o comando à vista", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().records.onSort("id");
    runner.state = rowsState({ id: 2 });

    view.show().filter.onClear();
    const after = view.show();

    expect(runner.sent).toEqual([sent(byId), sent(noFilter)]);
    expect(fieldOf(after)).toEqual({ draft: "", applied: "", command: sqlOf(noFilter) });
    expect(after.records.sort).toBeNull();
    expect(canClear(after.filter.draft, after.filter.applied)).toBe(false);
  });

  it("o ciclo do cabeçalho: crescente, decrescente, sem ordem; o campo, a seta e o comando acompanham cada passo", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    const step = (id: number) => {
      view.show().records.onSort("id");
      runner.state = rowsState({ id });
      const { filter, records } = view.show();
      return { draft: filter.draft, applied: filter.applied, sort: records.sort };
    };

    expect(step(2)).toEqual({ draft: byId, applied: byId, sort: idAscending });
    expect(step(3)).toEqual({ draft: 'ORDER BY "id" DESC', applied: 'ORDER BY "id" DESC', sort: { column: "id", direction: "desc" } });
    expect(step(4)).toEqual({ draft: "", applied: "", sort: null });
    expect(runner.sent).toEqual([sent(byId), sent('ORDER BY "id" DESC'), sent(noFilter)]);
  });

  it("a condição digitada e ainda não aplicada vai junto com o clique no cabeçalho: o campo é enviado inteiro", () => {
    const both = 'cliente_id = 4 ORDER BY "id" ASC';
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().filter.onDraft("cliente_id = 4");

    view.show().records.onSort("id");
    const after = view.show();

    expect(runner.sent).toEqual([sent(both)]);
    expect(after.filter.command).toBe('SELECT * FROM "loja"."pedidos"\nWHERE cliente_id = 4 ORDER BY "id" ASC');
    expect(fieldOf(after)).toEqual({ draft: both, applied: both, command: sqlOf(both) });
    expect(after.records.sort).toEqual(idAscending);
  });

  it("a ordem digitada à mão: de uma coluna só acende a seta dela; de duas colunas, nenhuma; e o clique no cabeçalho a troca", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    const apply = (text: string, id: number) => {
      view.show().filter.onDraft(text);
      view.show().filter.onApply();
      runner.state = rowsState({ id });
      return view.show();
    };

    expect(apply("order by CLIENTE_ID desc", 2).records.sort).toEqual({ column: "cliente_id", direction: "desc" });

    const two = apply("order by cliente_id, id desc", 3);
    expect(two.records.sort).toBeNull();
    expect(two.filter.command).toBe('SELECT * FROM "loja"."pedidos"\norder by cliente_id, id desc');

    two.records.onSort("cliente_id");
    expect(runner.sent.at(-1)).toEqual(sent('ORDER BY "cliente_id" ASC'));
    expect(view.show().filter.draft).toBe('ORDER BY "cliente_id" ASC');
  });

  it("a seta é a da ordem EM VIGOR, e não a do que está só digitado no campo", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().records.onSort("id");
    runner.state = rowsState({ id: 2 });

    view.show().filter.onDraft('ORDER BY "cliente_id" DESC');
    const typing = view.show();

    expect(typing.records.sort).toEqual(idAscending);
    expect(typing.filter).toMatchObject({ draft: 'ORDER BY "cliente_id" DESC', applied: byId, command: sqlOf(byId) });
  });

  it("enquanto o comando da ordem roda sobre as linhas que estavam na tela, a seta já é a dele", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().records.onSort("id");

    expect(runner.state.status).toBe("running");
    expect(view.show().records.sort).toEqual(idAscending);
  });

  it("'Limpar' só com texto digitado (nada em vigor): esvazia o campo e não pede nada ao executor", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().filter.onDraft("cliente_id = 4 order by id");

    view.show().filter.onClear();

    expect(runner.run).not.toHaveBeenCalled();
    expect(fieldOf(view.show())).toEqual({ draft: "", applied: "", command: sqlOf(noFilter) });
  });

  it.each(busyStates)("'Limpar' com %s em andamento: o campo esvazia, mas a ordem em vigor e o comando à vista ficam, e o botão segue valendo", (_what, busy) => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().records.onSort("id");
    runner.state = busy;
    runner.run.mockClear();

    view.show().filter.onClear();
    const after = view.show();

    expect(runner.run).not.toHaveBeenCalled();
    expect(fieldOf(after)).toEqual({ draft: "", applied: byId, command: sqlOf(byId) });
    expect(canClear(after.filter.draft, after.filter.applied)).toBe(true);
  });

  it("o texto do campo é lido pelas regras do banco DA CONEXÃO: no Informix `{ ... }` é comentário, e a ordem lá dentro não é a de fora (a seta, o clique e o filtro pedido por outra aba)", () => {
    const informix: Engine = 3;
    const noted = 'cliente_id = 4 { order by id } ORDER BY "cliente_id" DESC';
    const runner = fakeRunner(rowsState());
    const view = mount(runner, { engine: informix });
    view.show().filter.onDraft(noted);
    view.show().filter.onApply();
    runner.state = rowsState({ id: 2 });

    // A seta: lido como PostgreSQL, o texto teria uma ordem de vários pedaços (`order by id } ORDER BY ...`), e nenhuma seta.
    expect(view.show().records.sort).toEqual({ column: "cliente_id", direction: "desc" });

    // O clique: tira a ordem de fora, e só ela (o comentário fica onde estava).
    view.show().records.onSort("cliente_id");
    runner.state = rowsState({ id: 3 });
    expect(view.show().filter).toMatchObject({ draft: "cliente_id = 4 { order by id }", applied: "cliente_id = 4 { order by id }" });
    expect(runner.sent.at(-1)).toEqual({ sql: 'SELECT * FROM "loja"."pedidos"\nWHERE cliente_id = 4 { order by id }', offset: 0, engine: informix });

    // O filtro pedido por outra aba: não há ordem de fora a manter.
    filterHandoff.request("c1", pedidos, '"id" = 10');
    expect(view.show().filter).toMatchObject({ draft: '"id" = 10', applied: '"id" = 10' });
  });

  it("sem o banco da conexão (a lista de conexões se refazendo), o clique no cabeçalho não faz nada e 'Limpar' só esvazia o campo: o que vale continua valendo", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().records.onSort("id");
    runner.state = rowsState({ id: 2 });
    runner.run.mockClear();

    view.show({ engine: undefined }).records.onSort("cliente_id");
    expect(view.show().filter).toMatchObject({ draft: byId, applied: byId, command: null });

    view.show().filter.onClear();
    expect(view.show().filter).toMatchObject({ draft: "", applied: byId });
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe("RecordsView: 'Atualizar', a ordem e o filtro leem o executor NA HORA do clique (`runRecords`)", () => {
  const byId = 'ORDER BY "id" ASC';
  const idAscending = { column: "id", direction: "asc" };

  it.each(busyStates)("com %s em andamento, o clique no cabeçalho e 'Atualizar' não mudam nada: nem pedido ao executor, nem seta, nem campo, nem comando à vista", (_what, busy) => {
    const runner = fakeRunner(busy);
    const view = mount(runner);
    const { records } = view.show();

    records.onSort("id");
    records.onRefresh();
    const after = view.show();

    expect(runner.run).not.toHaveBeenCalled();
    expect(after.records.sort).toBeNull();
    expect(fieldOf(after)).toEqual({ draft: "", applied: "", command: sqlOf(noFilter) });
  });

  it("dois cliques seguidos, antes de a tela redesenhar: o segundo lê o executor (já ocupado com o primeiro), e não o estado que a tela desenhou", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    const { records } = view.show();

    // O primeiro é aceito, e a aba passa a executar. Os seguintes saem dos MESMOS manipuladores, os da renderização em que a aba estava livre.
    records.onSort("id");
    records.onSort("cliente_id");
    records.onRefresh();
    const after = view.show();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.sent).toEqual([sent(byId)]);
    expect(after.records.sort).toEqual(idAscending);
    expect(fieldOf(after)).toEqual({ draft: byId, applied: byId, command: sqlOf(byId) });
  });

  it("'Aplicar' leva o texto do campo ao comando; 'Limpar' esvazia o campo e refaz sem o filtro", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().filter.onDraft("  ativo ; ");
    view.show().filter.onApply();
    expect(runner.sent).toEqual([sent("ativo")]);
    expect(view.show().filter).toMatchObject({ draft: "  ativo ; ", applied: "ativo", problem: null, command: sqlOf("ativo") });

    runner.state = rowsState({ id: 2 });
    view.show().filter.onClear();
    expect(runner.sent.at(-1)).toEqual(sent(noFilter));
    expect(view.show().filter).toMatchObject({ draft: "", applied: "", command: sqlOf(noFilter) });
  });

  it("'Aplicar' com mais de um comando: o campo diz o que há de errado, e nada é pedido ao executor nem passa a valer; corrigido o texto, o aviso sai e o comando vai", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);

    view.show().filter.onDraft("ativo; delete from loja.pedidos");
    view.show().filter.onApply();

    expect(runner.run).not.toHaveBeenCalled();
    expect(view.show().filter).toMatchObject({ problem: "severalStatements", applied: "", command: sqlOf(noFilter) });

    // O clique no cabeçalho, com o campo ainda errado, também só avisa: a ordem não é escrita num texto que não foi enviado.
    view.show().records.onSort("id");
    expect(runner.run).not.toHaveBeenCalled();
    expect(view.show().filter).toMatchObject({ draft: "ativo; delete from loja.pedidos", problem: "severalStatements", applied: "" });

    view.show().filter.onDraft("ativo");
    expect(view.show().filter.problem).toBeNull();
    view.show().filter.onApply();
    expect(runner.sent).toEqual([sent("ativo")]);
    expect(view.show().filter).toMatchObject({ problem: null, applied: "ativo" });
  });

  it("'Atualizar' e 'executar de novo' refazem o comando em vigor, com a condição e a ordem", () => {
    const current = 'ativo ORDER BY "id" ASC';
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().filter.onDraft("ativo");
    view.show().filter.onApply();
    runner.state = rowsState({ id: 2 });
    view.show().records.onSort("id");
    runner.state = rowsState({ id: 3 });
    // O que está só digitado no campo não entra no "Atualizar": ele repete o que foi enviado.
    view.show().filter.onDraft("ainda digitando");

    view.show().records.onRefresh();
    runner.state = rowsState({ id: 4 });
    view.show().panel.onRerun();

    expect(runner.sent.slice(-2)).toEqual([sent(current), sent(current)]);
    expect(view.show().filter).toMatchObject({ draft: "ainda digitando", applied: current });
  });
});

describe("RecordsView: os valores que são link e o catálogo das chaves estrangeiras (`recordLinks` e `foreignKeysQuery`)", () => {
  const catalog = () => rt.catalog.asked.at(-1);

  it("com linhas na tela, à vista e conectada: pede as chaves DESTA tabela, e a coluna que é chave vira link para a referenciada", () => {
    rt.catalog.data = foreignKeys;

    const { records } = mount(fakeRunner(rowsState())).show();

    expect(catalog()).toMatchObject({ queryKey: structureKey("c1", "loja", "pedidos", "foreignKeys"), enabled: true });
    expect([...(records.links ?? [])]).toEqual([[1, { table: clientes, column: "id" }]]);
    expect(records.linkable?.("4")).toBe(true);
  });

  it("desconectada pela pessoa: NENHUM valor é link, mesmo com o catálogo das chaves em cache; o clique não leva a lugar nenhum e o catálogo não é pedido", () => {
    rt.catalog.data = foreignKeys;
    const view = mount(fakeRunner(rowsState()), { disconnected: true });

    const { records } = view.show();
    records.onFollow?.(1, "4");

    expect(records.links).toBeUndefined();
    expect(catalog()).toMatchObject({ enabled: false });
    expect(view.onOpenTable).not.toHaveBeenCalled();
    expect(filterHandoff.peek("c1", clientes)).toBeNull();
  });

  it.each<[string, RunnerState, Over]>([
    ["escondida", rowsState(), { visible: false }],
    ["sem linhas na tela", { status: "cancelled" }, {}],
    ["enquanto um comando roda", { status: "running", cancelling: false, previous: rowsState() }, {}],
  ])("%s, o catálogo das chaves não é pedido", (_what, state, over) => {
    mount(fakeRunner(state), over).show();

    expect(catalog()).toMatchObject({ enabled: false });
  });

  it("o clique no valor pede o filtro à tabela referenciada ANTES de abrir a aba dela, na vista Registros", () => {
    rt.catalog.data = foreignKeys;
    const view = mount(fakeRunner(rowsState()));
    let waiting: unknown = "a aba não abriu";
    view.onOpenTable.mockImplementation(() => {
      waiting = filterHandoff.peek("c1", clientes);
    });

    view.show().records.onFollow?.(1, "4");

    expect(view.onOpenTable.mock.calls).toEqual([[{ ...clientes, view: "data" }]]);
    expect(waiting).toMatchObject({ where: '"id" = 4' });
  });
});

describe("RecordsView: a memória da aba, o CSV e o que a área de resultado recebe", () => {
  it("o filtro em vigor, o texto do campo e a ordem voltam quando a vista é montada de novo (ir a outra vista e voltar), sem executar nada; outra aba não os herda", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().filter.onDraft("ativo");
    view.show().filter.onApply();
    runner.state = rowsState({ id: 2 });
    view.show().records.onSort("id");
    runner.state = rowsState({ id: 3 });
    view.show().filter.onDraft("ativo e ainda digitando");
    view.show();
    rt.unmount();

    const again = fakeRunner(rowsState({ id: 3 }));
    const back = mount(again).show();

    expect(back.filter).toMatchObject({ draft: "ativo e ainda digitando", applied: 'ativo ORDER BY "id" ASC', command: sqlOf('ativo ORDER BY "id" ASC') });
    expect(back.records.sort).toEqual({ column: "id", direction: "asc" });
    expect(again.run).not.toHaveBeenCalled();

    rt.unmount();
    expect(mount(fakeRunner(rowsState()), { tabId: "t2" }).show().filter).toMatchObject({ draft: "", applied: "" });
  });

  it("'Exportar CSV' salva as linhas que o executor tem NA HORA, com o nome da tabela, e avisa quantas saíram", () => {
    const runner = fakeRunner(rowsState());
    const { records } = mount(runner).show();

    records.onExport();

    expect(rt.saveText.mock.calls).toEqual([["loja.pedidos.csv", `${csvBom}id;cliente_id\r\n10;4\r\n`, "text/csv;charset=utf-8"]]);
    expect(rt.toast.success.mock.calls).toEqual([[workbenchCopy.tableTab.records.exported(1)]]);

    // O executor já não tem linhas (a tela ainda não redesenhou): não há o que salvar.
    runner.state = { status: "cancelled" };
    records.onExport();
    expect(rt.saveText).toHaveBeenCalledTimes(1);
  });

  it("'Exportar CSV' com uma célula cortada pede o valor completo pela linha do resultado e grava o valor inteiro (RN-SQL-017)", async () => {
    const full = "9".repeat(50_000);
    rt.cells.resultCells.mockResolvedValue({ ok: true, data: [full] });
    const runner = fakeRunner(rowsState({ rows: [["10", full.slice(0, 10_000)]], truncated: new Map([[0, new Set([1])]]), resultId: "r1" }));
    const { records } = mount(runner).show();

    records.onExport();
    await new Promise((done) => setTimeout(done, 0));

    expect(rt.cells.resultCells).toHaveBeenCalledWith("s1", "r1", [{ row: 0, column: 1 }], expect.any(AbortSignal));
    expect(rt.saveText.mock.calls).toEqual([["loja.pedidos.csv", `${csvBom}id;cliente_id\r\n10;${full}\r\n`, "text/csv;charset=utf-8"]]);
    expect(rt.toast.success.mock.calls).toEqual([[workbenchCopy.tableTab.records.exported(1)]]);
  });

  it("'Exportar CSV' sem o valor completo grava o cortado e avisa quantos não vieram inteiros", async () => {
    rt.cells.resultCells.mockResolvedValue({ ok: true, data: [null] });
    const runner = fakeRunner(rowsState({ rows: [["10", "4".repeat(10_000)]], truncated: new Map([[0, new Set([1])]]), resultId: "r1" }));
    const { records } = mount(runner).show();

    records.onExport();
    await new Promise((done) => setTimeout(done, 0));

    expect(rt.saveText.mock.calls[0][1]).toBe(`${csvBom}id;cliente_id\r\n10;${"4".repeat(10_000)}\r\n`);
    expect(rt.toast.warning.mock.calls).toEqual([[`${workbenchCopy.tableTab.records.exported(1)} ${workbenchCopy.tableTab.records.exportedCut(1)}`]]);
  });

  it("a área de resultado recebe o estado do executor, a sessão da aba, o nome da tabela e as preferências da grade, e os botões dela falam com o executor", () => {
    const state = rowsState();
    const runner = fakeRunner(state);

    const { panel, records } = mount(runner, { connected: false }).show();
    panel.onLoadMore();
    panel.onCount();
    records.onCancel();

    expect(panel).toMatchObject({ state, connected: false, nullText: "(nulo)", autoLoadMore: true });
    expect(records.name).toBe("loja.pedidos");
    expect(runner.loadMore).toHaveBeenCalledTimes(1);
    expect(runner.countTotal).toHaveBeenCalledTimes(1);
    expect(runner.cancel).toHaveBeenCalledTimes(1);
  });
});

describe("RecordsView entrega à área de resultado o id da aba (RN-GRADE-009)", () => {
  it("as larguras das colunas ficam lembradas pela ABA, e voltam com a vista que desmonta ao trocar para a Estrutura", () => {
    expect(mount(fakeRunner(rowsState())).show().panel.tabId).toBe("t1");
    rt.unmount();
    expect(mount(fakeRunner(rowsState()), { tabId: "t2" }).show().panel.tabId).toBe("t2");
  });
});

describe("RecordsView: a edição das células (seção 22)", () => {
  /** Uma alteração pendente na célula da coluna 1 da primeira linha, do resultado `r1`. */
  const withPending = () => remember("t1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 1, "5", "4") });

  it("com linhas na tela, a grade recebe a edição e a faixa, com o motivo de só leitura que a página trouxe", () => {
    const { panel } = mount(fakeRunner(rowsState({ resultId: "r1", readOnly: "DISTINCT" }))).show();
    const banner = panel.banner as { type: unknown; props: ComponentProps<typeof EditsBanner> };

    expect(panel.editing?.rows).toEqual([["10", "4"]]);
    expect(banner.type).toBe(EditsBanner);
    expect(banner.props).toMatchObject({ pending: 0, readOnly: recordsCopy.edit.readOnly("DISTINCT"), failure: null });
  });

  it("as pendências lembradas com a aba voltam para o mesmo resultado (trocar de vista não as perde), e outro resultado começa sem nenhuma", () => {
    withPending();

    const same = mount(fakeRunner(rowsState({ resultId: "r1" }))).show();
    rt.unmount();
    const other = mount(fakeRunner(rowsState({ resultId: "r2" }))).show();

    expect((same.panel.banner as { props: ComponentProps<typeof EditsBanner> }).props.pending).toBe(1);
    expect(same.panel.editing?.marks.get(0)?.pending.get(1)).toBe("5");
    expect((other.panel.banner as { props: ComponentProps<typeof EditsBanner> }).props.pending).toBe(0);
  });

  it("com alterações não salvas, Atualizar pergunta antes e não executa; Descartar executa (RN-EDIT-007)", () => {
    withPending();
    const runner = fakeRunner(rowsState({ resultId: "r1" }));
    const view = mount(runner);

    view.show().records.onRefresh();
    const { question } = view.show();

    expect(runner.run).not.toHaveBeenCalled();
    expect(question).toMatchObject({ count: 1, canSave: true });

    question!.onDiscard();
    expect(runner.sent).toEqual([sent(noFilter)]);
  });

  it("Cancelar na pergunta não executa nada e mantém as pendências", () => {
    withPending();
    const runner = fakeRunner(rowsState({ resultId: "r1" }));
    const view = mount(runner);

    view.show().filter.onApply();
    view.show().question!.onCancel();
    const after = view.show();

    expect(runner.run).not.toHaveBeenCalled();
    expect(after.question).toBeUndefined();
    expect((after.panel.banner as { props: ComponentProps<typeof EditsBanner> }).props.pending).toBe(1);
  });

  it("o filtro que chega de outra aba espera a resposta; Cancelar o deixa para lá, sem levá-lo ao campo", () => {
    withPending();
    const runner = fakeRunner(rowsState({ resultId: "r1" }));
    const view = mount(runner);
    filterHandoff.request("c1", pedidos, '"id" = 7');

    const waiting = view.show();
    expect(waiting.question).toMatchObject({ count: 1 });
    expect(waiting.filter.applied).toBe("");

    waiting.question!.onCancel();
    expect(filterHandoff.peek("c1", pedidos)).toBeNull();
    expect(view.show().filter.applied).toBe("");
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe("RecordsView: o Filtrar do menu da célula (RN-GRADE-013)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** A coluna `code`, de texto, na tabela da vista. */
  const textColumns: RowsState["columns"] = [...columns, { name: "code", type: "varchar", kind: "text" }];
  const loaded = (over: Partial<RowsState> = {}) => rowsState({ columns: textColumns, rows: [["10", "4", "11.901"], ["11", "4", "11.901"], ["12", "5", null]], resultId: "r1", ...over });

  /** Abre o menu da célula (como o clique direito) e devolve o submenu "Filtrar". */
  async function filterMenu(view: ReturnType<typeof mount>, cell = { row: 0, column: 2 }) {
    view.show().panel.editing!.onMenu(cell, { x: 10, y: 20 }, false);
    await settle();
    const menu = view.show().menu!;
    const filter = menu.groups.flatMap(groupItems).find((item) => item.id === "filter")!;
    return { menu, filter, items: filter.submenu!.groups.flatMap(groupItems) };
  }
  const choose = (items: ContextMenuItem[], id: string) => items.find((item) => item.id === id)!.onSelect!();

  it("o menu da célula tem o Filtrar (F11) com o submenu, e o Atualizar (F5)", async () => {
    const view = mount(fakeRunner(loaded()));
    const { menu, filter, items } = await filterMenu(view);

    expect(filter).toMatchObject({ label: "Filtrar", shortcut: "F11" });
    expect(items.map((item) => item.label)).toContain(`"code" = '11.901'`);
    expect(menu.groups.flatMap(groupItems).find((item) => item.id === "refresh")).toMatchObject({ label: "Atualizar", shortcut: "F5", disabled: false });
  });

  it("“Valor da célula” junta a condição ao texto do campo, com a ordem dele no fim, e executa", async () => {
    const runner = fakeRunner(loaded());
    const view = mount(runner);
    view.show().filter.onDraft('cliente_id = 4 ORDER BY "id" DESC');

    const { items } = await filterMenu(view);
    choose(items, "filter:cell:eq");
    const after = view.show();

    const text = `(cliente_id = 4) AND ("code" = '11.901') ORDER BY "id" DESC`;
    expect(runner.sent).toEqual([sent(text)]);
    expect(fieldOf(after)).toEqual({ draft: text, applied: text, command: sqlOf(text) });
  });

  it("com alterações não salvas, o Filtrar pergunta antes; Descartar executa (RN-EDIT-007)", async () => {
    remember("t1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 1, "5", "4") });
    const runner = fakeRunner(loaded());
    const view = mount(runner);

    const { items } = await filterMenu(view);
    choose(items, "filter:cell:isNull");

    expect(runner.run).not.toHaveBeenCalled();
    view.show().question!.onDiscard();
    expect(runner.sent).toEqual([sent(`"code" IS NULL`)]);
  });

  it("o Filtrar usa o valor LIDO da célula, e não a alteração pendente", async () => {
    remember("t1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 2, "outro", "11.901") });
    const view = mount(fakeRunner(loaded()));

    const { items } = await filterMenu(view);
    expect(items.find((item) => item.id === "filter:cell:eq")?.label).toBe(`"code" = '11.901'`);
  });

  it("F11 abre o menu da célula ativa com o submenu Filtrar já aberto, pelo teclado", async () => {
    const view = mount(fakeRunner(loaded()));

    view.show().panel.editing!.onFilter!({ row: 0, column: 2 }, { x: 1, y: 2 }, "menu");
    await settle();

    expect(view.show().menu).toMatchObject({ openSubmenu: "filter", initialFocus: "first", point: { x: 1, y: 2 } });
  });

  it("Ctrl+F11 abre o Filtrar por valor: os valores distintos com a contagem; Filtrar monta IN e IS NULL por OR e executa", () => {
    const runner = fakeRunner(loaded());
    const view = mount(runner);

    view.show().panel.editing!.onFilter!({ row: 0, column: 2 }, { x: 1, y: 2 }, "values");
    const { values } = view.show();

    expect(values).toMatchObject({ column: "code", rows: 3, more: false, values: [{ value: "11.901", count: 2, usable: true }, { value: null, count: 1, usable: true }] });

    values!.onApply(["11.901", null]);
    expect(view.show().values).toBeUndefined();
    expect(runner.sent).toEqual([sent(`"code" = '11.901' OR "code" IS NULL`)]);
  });

  it("Personalizado pede o valor no campo pequeno, que vira literal; o que não vira fica com o motivo", async () => {
    const runner = fakeRunner(loaded());
    const view = mount(runner);

    const { items } = await filterMenu(view);
    choose(items, "filter:custom:gt");
    const { custom } = view.show();
    expect(custom).toMatchObject({ prefix: `"code" >`, point: { x: 10, y: 20 }, problem: null });

    custom!.onApply("a\tb");
    expect(view.show().custom?.problem).toBe("O valor não pode ter tabulação nem outro caractere de controle.");
    expect(runner.run).not.toHaveBeenCalled();

    view.show().custom!.onApply("O'Brien");
    expect(view.show().custom).toBeUndefined();
    expect(runner.sent).toEqual([sent(`"code" > 'O''Brien'`)]);
  });

  it("Remover todos os filtros e ordenações limpa o campo e lê a tabela sem filtro", async () => {
    const runner = fakeRunner(loaded());
    const view = mount(runner);
    view.show().filter.onDraft("cliente_id = 4");
    view.show().filter.onApply();
    runner.state = loaded();
    runner.sent.length = 0;

    const { items } = await filterMenu(view);
    choose(items, "filter:clear");

    expect(runner.sent).toEqual([sent(noFilter)]);
    expect(fieldOf(view.show())).toEqual({ draft: "", applied: "", command: sqlOf(noFilter) });
  });

  it("com a aba ocupada, nada do Filtrar se aplica, e o menu diz por quê", async () => {
    const runner = fakeRunner({ status: "running", cancelling: false, previous: loaded() });
    const view = mount(runner);

    // As linhas de antes ficam na tela, esmaecidas; o menu abre sobre elas.
    const { items, menu } = await filterMenu(view);
    expect(items.every((item) => item.disabled === true)).toBe(true);
    expect(menu.groups.flatMap(groupItems).find((item) => item.id === "refresh")).toMatchObject({ disabled: true });
  });

  it("o campo completa as colunas da grade, e continua com elas quando o filtro dá erro", () => {
    const runner = fakeRunner(loaded());
    const view = mount(runner);
    expect(view.show().filter.columns.map((column) => column.name)).toEqual(["id", "cliente_id", "code"]);

    runner.state = { status: "error", source: "database", title: "Erro do banco", message: "column x does not exist", sqlState: "42703", errorAt: null };
    expect(view.show().filter.columns.map((column) => column.name)).toEqual(["id", "cliente_id", "code"]);
    expect(view.show().filter.autocomplete).toBe(true);
  });
});

describe("RecordsView: F5 é o Atualizar (RN-GRADE-012)", () => {
  it("a vista deixa o Atualizar na aba: F5 lê de novo com o filtro e a ordem em vigor", () => {
    const slot = createRefreshSlot();
    const runner = fakeRunner(rowsState());
    const view = mount(runner, { refreshSlot: slot });
    view.show().filter.onDraft('cliente_id = 4 ORDER BY "id" DESC');
    view.show().filter.onApply();
    runner.state = rowsState();
    runner.sent.length = 0;
    view.show();

    slot.get()!();
    expect(runner.sent).toEqual([sent('cliente_id = 4 ORDER BY "id" DESC')]);
  });

  it("com alterações não salvas, F5 pergunta antes; com algo em andamento, nada", () => {
    remember("t1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 1, "5", "4") });
    const slot = createRefreshSlot();
    const runner = fakeRunner(rowsState({ resultId: "r1" }));
    const view = mount(runner, { refreshSlot: slot });
    view.show();

    slot.get()!();
    expect(runner.run).not.toHaveBeenCalled();
    expect(view.show().question).toMatchObject({ count: 1 });
    view.show().question!.onCancel();

    runner.state = rowsState({ resultId: "r1", loadingMore: true });
    view.show();
    slot.get()!();
    expect(view.show().question).toBeUndefined();
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("a vista que sai da tela tira o Atualizar dela da aba", () => {
    const slot = createRefreshSlot();
    mount(fakeRunner(rowsState()), { refreshSlot: slot }).show();
    expect(slot.get()).not.toBeNull();

    rt.unmount();
    expect(slot.get()).toBeNull();
  });
});

describe("RecordsView: a atualização automática (RN-GRADE-014)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const pauses = (runner: ReturnType<typeof fakeRunner>) => runner.autoRefresh.pause.mock.calls.map(([reason, on]) => `${String(reason)}:${String(on)}`);

  it("à vista, a vista tira a pausa de fora de vista; escondida, põe; desmontada (outra vista da tabela), põe de novo", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show();
    expect(pauses(runner)).toContain("hidden:false");

    runner.autoRefresh.pause.mockClear();
    view.show({ visible: false });
    expect(pauses(runner)).toContain("hidden:true");
    expect(pauses(runner).at(-1)).toBe("hidden:true");

    view.show({ visible: true });
    runner.autoRefresh.pause.mockClear();
    rt.unmount();
    expect(pauses(runner)).toContain("hidden:true");
  });

  it("a grade com alteração não salva fica em pausa (a execução trocaria as linhas debaixo da edição); sem nenhuma, não", () => {
    const clean = fakeRunner(rowsState({ resultId: "r1" }));
    mount(clean).show();
    expect(pauses(clean)).toContain("editing:false");
    expect(pauses(clean)).not.toContain("editing:true");
    rt.unmount();

    remember("t1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 1, "5", "4") });
    const dirty = fakeRunner(rowsState({ resultId: "r1" }));
    mount(dirty).show();
    expect(pauses(dirty)).toContain("editing:true");
  });

  it("a área recebe o controle com o estado do relógio da aba e o motivo; escolher um intervalo nele liga", () => {
    const runner = fakeRunner(rowsState());
    const { auto } = mount(runner).show();

    expect(auto).toMatchObject({ state: { status: "off", stopped: null }, blocker: null });
    auto!.onChoose("autoRefresh:every:10000");
    expect(runner.autoRefresh.start).toHaveBeenCalledExactlyOnceWith(10_000);

    auto!.onChoose("autoRefresh:off");
    expect(runner.autoRefresh.stop).toHaveBeenCalledOnce();
  });

  it("sem linhas na tela (o erro do banco), o controle fica, com o motivo de não ligar", () => {
    const runner = fakeRunner({ status: "error", source: "database", title: "Erro do banco", message: "x", sqlState: null, errorAt: null });
    runner.autoRefresh.blocker = () => "noRows";
    const { auto } = mount(runner).show();

    expect(auto).toMatchObject({ blocker: "noRows" });
  });

  it("o menu da célula tem \"Atualizar automaticamente\" logo depois do \"Atualizar\", e escolher um intervalo no submenu liga", async () => {
    const runner = fakeRunner(rowsState({ resultId: "r1" }));
    const view = mount(runner);
    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 10, y: 20 }, false);
    await settle();
    const menu = view.show().menu!;
    const items = menu.groups.flatMap(groupItems);
    const at = items.findIndex((item) => item.id === "refresh");

    expect(items[at + 1]).toMatchObject({ id: "autoRefresh", label: autoRefreshCopy.menu.label, disabled: false });
    items[at + 1].submenu!.groups.flatMap(groupItems).find((item) => item.id === "autoRefresh:every:30000")!.onSelect!();
    expect(runner.autoRefresh.start).toHaveBeenCalledExactlyOnceWith(30_000);
  });

  it("a execução automática não ocupa a vista para a pessoa: o campo não está ocupado, e F5 e aplicar vão ao executor, que a põe de lado; o botão de ordenar espera (RN-GRADE-021)", () => {
    const slot = createRefreshSlot();
    const autoRun: RunnerState = { status: "running", cancelling: false, previous: rowsState(), auto: true };
    const runner = fakeRunner(autoRun);
    const view = mount(runner, { refreshSlot: slot });
    expect(view.show().filter.busy).toBe(false);

    slot.get()!();
    expect(runner.sent).toEqual([sent(noFilter)]);

    runner.state = autoRun;
    view.show().filter.onDraft("cliente_id = 4");
    view.show().filter.onApply();
    expect(runner.sent.at(-1)).toEqual(sent("cliente_id = 4"));

    // RN-GRADE-021: enquanto a atualização automática lê as linhas de novo, o botão de ordenar fica à vista e desabilitado, com o motivo.
    runner.state = autoRun;
    const during = view.show();
    expect(during.panel.editing?.sort?.reason).toBe(recordsCopy.edit.reasons.refreshing);
    during.records.onSort("id");
    expect(runner.sent).toHaveLength(2);
  });

  it("\"Exportar CSV\" durante a execução automática espera por ela e exporta o resultado novo", async () => {
    let finish!: () => void;
    const runner = fakeRunner({ status: "running", cancelling: false, previous: rowsState(), auto: true });
    runner.autoDone = new Promise<void>((resolve) => (finish = resolve));
    const { records } = mount(runner).show();

    records.onExport();
    await settle();
    expect(rt.saveText).not.toHaveBeenCalled();

    runner.state = rowsState({ rows: [["11", "5"]] });
    finish();
    await settle();
    expect(rt.saveText.mock.calls).toEqual([["loja.pedidos.csv", `${csvBom}id;cliente_id\r\n11;5\r\n`, "text/csv;charset=utf-8"]]);
  });

  it("ligada, a grade não busca a página seguinte sozinha ao rolar até o fim (RN-CONFIG-005): cada execução volta à primeira página", () => {
    const runner = fakeRunner(rowsState({ hasMore: true }));
    const view = mount(runner);
    expect(view.show().panel.autoLoadMore).toBe(true);

    runner.autoRefresh.getState = () => ({ status: "on", everyMs: 5_000, lastAt: null, running: false, paused: null });
    expect(view.show().panel.autoLoadMore).toBe(false);
  });

  it("\"Personalizado…\" abre o diálogo; o texto fora do limite fica nele, com o motivo; o válido liga e fecha", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().auto!.onChoose("autoRefresh:custom");

    const opened = view.show().autoDialog!;
    expect(opened).toMatchObject({ everyMs: null, error: null });
    opened.onSubmit("0");
    expect(view.show().autoDialog).toMatchObject({ error: autoRefreshCopy.dialog.invalid });
    expect(runner.autoRefresh.start).not.toHaveBeenCalled();

    view.show().autoDialog!.onSubmit("45");
    expect(runner.autoRefresh.start).toHaveBeenCalledExactlyOnceWith(45_000);
    expect(view.show().autoDialog).toBeUndefined();
  });
});

describe("RecordsView: a edição e o menu da célula diante da atualização automática (RN-GRADE-014)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const pauses = (runner: ReturnType<typeof fakeRunner>) => runner.autoRefresh.pause.mock.calls.map(([reason, on]) => `${String(reason)}:${String(on)}`);
  const pendingOf = (view: ReturnType<typeof mount>) => (view.show().panel.banner as { props: ComponentProps<typeof EditsBanner> }).props.pending;

  /** O alvo da edição de `loja.pedidos`: as duas colunas editáveis, com `id` como chave. */
  const target = {
    tables: [{ schema: "loja", name: "pedidos", key: [0], editable: true, reason: null }],
    columns: [
      { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
      { table: 0, baseColumn: "cliente_id", editable: true, reason: null, nullable: true, generated: null },
    ],
    rowOperations: true,
    oneAtATime: false,
  };
  /** A pergunta do alvo que só responde quando a prova soltar (a API devagar). */
  function slowTarget(): () => void {
    let answer!: () => void;
    rt.service.editTargetOrRefuse.mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve({ ok: true, data: target }))) as never);
    return () => answer();
  }
  /** O resultado da tela: `id` 10 na primeira linha. */
  const first = () => rowsState({ resultId: "r1", rows: [["10", "4"], ["20", "5"]] });
  /** O que uma execução automática trouxe no lugar: outra linha entrou na frente, e o `id` 10 desceu para a segunda. */
  const second = () => rowsState({ resultId: "r2", rows: [["5", "9"], ["10", "4"], ["20", "5"]] });

  let clipboard: { writeText: ReturnType<typeof vi.fn>; readText: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    clipboard = { writeText: vi.fn(async () => {}), readText: vi.fn(async () => "7") };
    vi.stubGlobal("navigator", { clipboard });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // A resposta lenta que uma prova não consumiu não vale para a seguinte.
    rt.service.editTargetOrRefuse.mockReset();
  });

  it("o duplo clique segura a atualização desde o começo, antes de o alvo chegar, e a solta só com o campo aberto (sem um instante livre)", async () => {
    const runner = fakeRunner(first());
    const view = mount(runner);
    view.show();
    const answer = slowTarget();
    runner.autoRefresh.pause.mockClear();

    view.show().panel.editing!.onEdit({ row: 0, column: 1 });
    expect(pauses(runner)).toEqual(["editing:true"]);

    answer();
    await settle();
    expect(view.show().panel.editing!.editor).toMatchObject({ row: 0, column: 1, draft: "4" });
    expect(pauses(runner)).not.toContain("editing:false");
  });

  it("se as linhas mudaram enquanto o alvo era perguntado, o campo não abre na linha que entrou no lugar, e a pausa sai", async () => {
    const runner = fakeRunner(first());
    const view = mount(runner);
    view.show();
    const answer = slowTarget();

    view.show().panel.editing!.onEdit({ row: 0, column: 1 });
    runner.state = second();
    view.show();
    answer();
    await settle();

    expect(view.show().panel.editing!.editor).toBeNull();
    expect(pauses(runner).at(-1)).toBe("editing:false");
  });

  it("o alvo que chega do resultado de antes não serve ao novo, nem antes de a tela redesenhar: o novo pergunta o dele", async () => {
    const runner = fakeRunner(first());
    const view = mount(runner);
    view.show();
    const answer = slowTarget();

    view.show().panel.editing!.onEdit({ row: 0, column: 1 });
    runner.state = second();
    const editing = view.show().panel.editing!;
    answer();
    await settle();
    rt.service.editTargetOrRefuse.mockImplementationOnce(async () => ({ ok: true, data: target }) as never);
    editing.onEdit({ row: 1, column: 1 });
    await settle();

    expect(rt.service.editTargetOrRefuse).toHaveBeenLastCalledWith("s1", "r2", null);
    expect(view.show().panel.editing!.editor).toMatchObject({ row: 1, column: 1, draft: "4" });
  });

  it("a troca que a tela ainda não desenhou também conta: o executor é lido na hora", async () => {
    const runner = fakeRunner(first());
    const view = mount(runner);
    view.show();
    const answer = slowTarget();

    view.show().panel.editing!.onEdit({ row: 0, column: 1 });
    runner.state = second();
    answer();
    await settle();

    expect(view.show().panel.editing!.editor).toBeNull();
  });

  it("o clique direito também segura desde o começo; com as linhas trocadas no meio-tempo, o menu não abre, e nada é excluído", async () => {
    const runner = fakeRunner(first());
    const view = mount(runner);
    view.show();
    const answer = slowTarget();
    runner.autoRefresh.pause.mockClear();

    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 10, y: 20 }, false);
    expect(pauses(runner)).toEqual(["editing:true"]);
    runner.state = second();
    view.show();
    answer();
    await settle();

    expect(view.show().menu).toBeUndefined();
    expect(pendingOf(view)).toBe(0);
  });

  it("sem troca, \"Excluir linha\" do menu vale na linha que o menu mostrava", async () => {
    const runner = fakeRunner(first());
    const view = mount(runner);
    view.show();
    const answer = slowTarget();
    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 10, y: 20 }, false);
    answer();
    await settle();

    view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "deleteRow")!.onSelect!();
    await settle();

    expect(pendingOf(view)).toBe(1);
    expect(view.show().panel.editing!.marks.get(0)?.deleted).toBe(true);
  });

  it("o menu aberto durante uma execução automática que já rodava fecha quando as linhas mudam, e a escolha que chegar depois não age na linha nova", async () => {
    const runner = fakeRunner({ status: "running", cancelling: false, previous: first(), auto: true });
    const view = mount(runner);
    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 10, y: 20 }, false);
    await settle();
    const opened = view.show().menu!;
    // As linhas vão mudar: o alvo não é perguntado por elas.
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();

    runner.state = second();
    expect(view.show().menu).toBeUndefined();

    // O clique que já estava a caminho, no menu de antes.
    opened.groups.flatMap(groupItems).find((item) => item.id === "copy")!.onSelect!();
    await settle();
    expect(clipboard.writeText).not.toHaveBeenCalled();
  });

  it("\"Colar\" segura a atualização também enquanto lê a área de transferência, e não cola na linha que entrou no lugar", async () => {
    const runner = fakeRunner(first());
    const view = mount(runner);
    view.show();
    const answer = slowTarget();
    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 10, y: 20 }, false);
    answer();
    await settle();
    let paste!: (text: string) => void;
    clipboard.readText.mockImplementationOnce(() => new Promise<string>((resolve) => (paste = resolve)));

    view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "paste")!.onSelect!();
    view.show();
    expect(pauses(runner).at(-1)).toBe("editing:true");

    runner.state = second();
    view.show();
    paste("7");
    await settle();

    expect(pendingOf(view)).toBe(0);
    expect(pauses(runner).at(-1)).toBe("editing:false");
  });

  it("o duplo clique durante a execução automática não pergunta o alvo à API: a faixa diz por quê, e a pausa não fica", async () => {
    const runner = fakeRunner({ status: "running", cancelling: false, previous: first(), auto: true });
    const view = mount(runner);
    view.show();
    runner.autoRefresh.pause.mockClear();

    view.show().panel.editing!.onEdit({ row: 0, column: 1 });
    await settle();

    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
    expect((view.show().panel.banner as { props: ComponentProps<typeof EditsBanner> }).props.notice).toBe(recordsCopy.edit.readOnly(recordsCopy.edit.reasons.refreshing));
    expect(pauses(runner)).not.toContain("editing:true");
  });

  it("o menu aberto, o \"Filtrar por valor…\" e o campo do \"Personalizado\" põem a pausa, e fechá-los a tira", async () => {
    const textColumns: RowsState["columns"] = [...columns, { name: "code", type: "varchar", kind: "text" }];
    const runner = fakeRunner(rowsState({ columns: textColumns, rows: [["10", "4", "a"]], resultId: "r1" }));
    const view = mount(runner);
    const cell = { row: 0, column: 2 };

    view.show().panel.editing!.onMenu(cell, { x: 10, y: 20 }, false);
    await settle();
    view.show();
    expect(pauses(runner).at(-1)).toBe("editing:true");
    view.show().menu!.onClose();
    view.show();
    expect(pauses(runner).at(-1)).toBe("editing:false");

    view.show().panel.editing!.onFilter!(cell, { x: 1, y: 2 }, "values");
    view.show();
    expect(pauses(runner).at(-1)).toBe("editing:true");
    view.show().values!.onClose();
    view.show();
    expect(pauses(runner).at(-1)).toBe("editing:false");

    view.show().panel.editing!.onMenu(cell, { x: 10, y: 20 }, false);
    await settle();
    const filter = view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "filter")!;
    filter.submenu!.groups.flatMap(groupItems).find((item) => item.id === "filter:custom:gt")!.onSelect!();
    view.show();
    expect(view.show().custom).toBeDefined();
    expect(pauses(runner).at(-1)).toBe("editing:true");
    view.show().custom!.onClose();
    view.show();
    expect(pauses(runner).at(-1)).toBe("editing:false");
  });

  it("a vista que sai de cena, ou o executor trocado, tira a pausa da edição do executor de antes", () => {
    remember("t1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 1, "5", "4") });
    const before = fakeRunner(first());
    const after = fakeRunner(first());
    const view = mount(before);
    view.show();
    expect(pauses(before).at(-1)).toBe("editing:true");

    view.show({ runner: after as unknown as QueryRunner });
    expect(pauses(before).at(-1)).toBe("editing:false");
    expect(pauses(after).at(-1)).toBe("editing:true");

    rt.unmount();
    expect(pauses(after).at(-1)).toBe("editing:false");
  });
});

describe("RecordsView: adicionar e excluir linha pelo teclado (RN-EDIT-014 e 015)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const pendingOf = (view: ReturnType<typeof mount>) => (view.show().panel.banner as { props: ComponentProps<typeof EditsBanner> }).props.pending;
  /** `loja.pedidos` de uma tabela só, com `id` como chave: aceita linha nova e exclusão. */
  const target = {
    tables: [{ schema: "loja", name: "pedidos", key: [0], editable: true, reason: null }],
    columns: [
      { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
      { table: 0, baseColumn: "cliente_id", editable: true, reason: null, nullable: true, generated: null },
    ],
    rowOperations: true,
    oneAtATime: false,
  };

  beforeEach(() => {
    rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: target }) as never);
  });
  afterEach(() => rt.service.editTargetOrRefuse.mockReset());

  it("Alt+Delete marca para exclusão a linha da célula ativa, que fica riscada, e a célula ativa fica nela", async () => {
    const view = mount(fakeRunner(rowsState({ resultId: "r1", rows: [["10", "4"], ["20", "5"]] })));
    view.show().panel.editing!.onActivate({ row: 1, column: 1 });

    view.show().panel.editing!.onDeleteRow();
    await settle();
    const editing = view.show().panel.editing!;

    expect(editing.marks.get(1)?.deleted).toBe(true);
    expect(editing.marks.get(0)).toBeUndefined();
    expect(editing.active).toEqual({ row: 1, column: 1 });
    expect(pendingOf(view)).toBe(1);
  });

  it("na linha já marcada, o menu tem \"Excluir linha\" desabilitado com o motivo, e Alt+Delete não muda nada: a faixa diz por quê", async () => {
    remember("t1", "edits", { resultId: "r1", edits: deleteRow(noEdits, 0) });
    const view = mount(fakeRunner(rowsState({ resultId: "r1", rows: [["10", "4"], ["20", "5"]] })));
    const reason = recordsCopy.edit.readOnly(recordsCopy.edit.reasons.alreadyDeleted);

    // Como o clique direito na grade: a célula fica ativa, e o menu abre nela.
    view.show().panel.editing!.onActivate({ row: 0, column: 1 });
    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 2 }, false);
    await settle();
    expect(view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "deleteRow")).toMatchObject({ label: "Excluir linha", disabled: true, hint: reason, shortcut: "Alt+Delete" });
    view.show().menu!.onClose();

    view.show().panel.editing!.onDeleteRow();
    await settle();
    expect(pendingOf(view)).toBe(1);
    expect((view.show().panel.banner as { props: ComponentProps<typeof EditsBanner> }).props.notice).toBe(reason);
  });

  it("tirada uma linha nova, a célula ativa passa à que ficou no lugar dela, ou à de cima quando ela era a última; sem linha nenhuma, não há célula ativa", async () => {
    const view = mount(fakeRunner(rowsState({ resultId: "r1", rows: [] })));
    for (let times = 0; times < 3; times += 1) {
      view.show().panel.editing!.onNewRow();
      await settle();
    }
    expect(view.show().panel.editing!.active).toEqual({ row: 2, column: 0 });

    // A primeira das três: a segunda fica no lugar dela.
    view.show().panel.editing!.onActivate({ row: 0, column: 1 });
    view.show().panel.editing!.onDeleteRow();
    await settle();
    expect(view.show().panel.editing!.rows).toHaveLength(2);
    expect(view.show().panel.editing!.active).toEqual({ row: 0, column: 1 });

    // A última: a célula ativa sobe.
    view.show().panel.editing!.onActivate({ row: 1, column: 1 });
    view.show().panel.editing!.onDeleteRow();
    await settle();
    expect(view.show().panel.editing!.active).toEqual({ row: 0, column: 1 });

    view.show().panel.editing!.onDeleteRow();
    await settle();
    expect(view.show().panel.editing!.rows).toHaveLength(0);
    expect(view.show().panel.editing!.active).toBeNull();
    expect(pendingOf(view)).toBe(0);
  });
});

describe("RecordsView: Duplicar linha (RN-EDIT-016)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const bannerOf = (view: ReturnType<typeof mount>) => (view.show().panel.banner as { props: ComponentProps<typeof EditsBanner> }).props;
  /** `loja.pedidos` com `code`, de texto: `id` é `serial` (gerado "por padrão", a chave), `cliente_id` e `code` se copiam. */
  const withCode: RowsState["columns"] = [...columns, { name: "code", type: "varchar", kind: "text" }];
  const target = {
    tables: [{ schema: "loja", name: "pedidos", key: [0], editable: true, reason: null }],
    columns: [
      { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: "byDefault" },
      { table: 0, baseColumn: "cliente_id", editable: true, reason: null, nullable: true, generated: null },
      { table: 0, baseColumn: "code", editable: true, reason: null, nullable: true, generated: null },
    ],
    rowOperations: true,
    oneAtATime: false,
  };
  /** A mesma tabela com a chave natural em `code`, que se copia. */
  const naturalKey = { ...target, tables: [{ ...target.tables[0], key: [2] }] };
  const loaded = (over: Partial<RowsState> = {}) => rowsState({ columns: withCode, rows: [["10", "4", "A-1"], ["20", "5", "B-2"]], resultId: "r1", ...over });
  const answer = (data: unknown) => rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data }) as never);
  const notCopiedId = recordsCopy.edit.duplicate.notCopied(["id"]);

  /** Duplica a linha da célula ativa pelo teclado (Ctrl+Alt+Insert), como a pessoa faz. */
  async function duplicate(view: ReturnType<typeof mount>, row: number, column = 1) {
    view.show().panel.editing!.onActivate({ row, column });
    view.show().panel.editing!.onDuplicateRow();
    await settle();
    await settle();
  }

  beforeEach(() => answer(target));
  afterEach(() => {
    rt.service.editTargetOrRefuse.mockReset();
    rt.cells.resultCells.mockReset();
  });

  it("o menu da célula tem \"Duplicar linha\" (Ctrl+Alt+Insert) entre \"Adicionar linha\" e \"Excluir linha\"", async () => {
    const view = mount(fakeRunner(loaded()));

    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 2 }, false);
    await settle();
    const group = view.show().menu!.groups.find((items) => (items as ContextMenuItem[]).some((item) => item.id === "newRow")) as ContextMenuItem[];

    expect(group.map((item) => [item.label, item.shortcut, item.disabled === true])).toEqual([
      ["Adicionar linha", "Alt+Insert", false],
      ["Duplicar linha", "Ctrl+Alt+Insert", false],
      ["Excluir linha", "Alt+Delete", false],
    ]);
  });

  it("a cópia vai para o fim da grade com o que a tela mostra (a alteração pendente também), sem o id serial, e a célula ativa vai à primeira coluna editável", async () => {
    remember("t1", "edits", { resultId: "r1", edits: editCell(noEdits, 0, 2, "A-9", "A-1") });
    const view = mount(fakeRunner(loaded()));

    await duplicate(view, 0);
    const editing = view.show().panel.editing!;

    expect(editing.rows).toEqual([["10", "4", "A-1"], ["20", "5", "B-2"], [null, "4", "A-9"]]);
    expect(editing.marks.get(2)).toMatchObject({ kind: "new", pending: new Map([[1, "4"], [2, "A-9"]]) });
    expect(editing.active).toEqual({ row: 2, column: 0 });
    expect(bannerOf(view)).toMatchObject({ pending: 2, notice: notCopiedId, noticeTone: "warning" });
  });

  it("com a chave copiada inteira, a faixa avisa (com as colunas que ficaram de fora) e a célula ativa vai para a coluna da chave", async () => {
    answer(naturalKey);
    const view = mount(fakeRunner(loaded()));

    await duplicate(view, 1);

    expect(view.show().panel.editing!.active).toEqual({ row: 2, column: 2 });
    expect(bannerOf(view).notice).toBe(`${recordsCopy.edit.duplicate.keyCopied("pedidos", ["code"])} ${notCopiedId}`);
    expect(bannerOf(view).notice).toBe("A linha duplicada copiou a chave de pedidos (code): troque-a antes de salvar, ou o banco vai recusar a linha repetida. Não copiada (fica com o padrão da tabela): id.");
  });

  it("o aviso fica até a próxima ação de edição: \"Desfazer alteração\" numa célula da duplicada a tira de lá, e o aviso sai", async () => {
    const view = mount(fakeRunner(loaded()));
    await duplicate(view, 0);

    // A cópia vem escolhida inteira (RN-EDIT-014): o clique escolhe só a célula, e o "Desfazer alteração" age nela.
    view.show().panel.editing!.onActivate({ row: 2, column: 1 });
    view.show().panel.editing!.onMenu({ row: 2, column: 1 }, { x: 1, y: 2 }, false);
    await settle();
    view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "undo")!.onSelect!();
    await settle();

    expect(view.show().panel.editing!.rows[2]).toEqual([null, null, "A-1"]);
    expect(bannerOf(view)).toMatchObject({ pending: 1, notice: null });
  });

  it("a linha marcada para exclusão copia os valores lidos; a linha nova copia só o que foi preenchido nela, e a coluna em branco não entra no aviso", async () => {
    remember("t1", "edits", { resultId: "r1", edits: deleteRow(noEdits, 1) });
    const view = mount(fakeRunner(loaded()));

    await duplicate(view, 1);
    expect(view.show().panel.editing!.rows[2]).toEqual([null, "5", "B-2"]);

    await duplicate(view, 2);
    expect(view.show().panel.editing!.rows[3]).toEqual([null, "5", "B-2"]);
    expect(bannerOf(view).notice).toBeNull();
    expect(bannerOf(view).pending).toBe(3);
  });

  it("a célula cortada vai com o valor completo, que a tela busca antes na API", async () => {
    rt.cells.resultCells.mockResolvedValue({ ok: true, data: ["A-1 inteiro"] });
    const view = mount(fakeRunner(loaded({ truncated: new Map([[0, new Set([2])]]) })));

    await duplicate(view, 0);

    expect(rt.cells.resultCells).toHaveBeenCalledWith("s1", "r1", [{ row: 0, column: 2 }], expect.any(AbortSignal));
    expect(view.show().panel.editing!.rows[2]).toEqual([null, "4", "A-1 inteiro"]);
  });

  it("o valor completo que não vem não duplica nada, e a faixa diz por quê: nos Registros, atualize", async () => {
    rt.cells.resultCells.mockResolvedValue({ ok: false, error: { status: 404, code: "RESULT_NOT_FOUND", title: "x", detail: null, errors: null, extensions: {} } });
    const view = mount(fakeRunner(loaded({ truncated: new Map([[0, new Set([2])]]) })));

    await duplicate(view, 0);

    expect(view.show().panel.editing!.rows).toHaveLength(2);
    expect(bannerOf(view)).toMatchObject({ pending: 0, noticeTone: "warning", notice: "A linha não foi duplicada: o valor completo de code não pôde vir. Atualize os registros para duplicá-la." });
  });

  it("enquanto busca, a faixa diz e deixa cancelar; cancelada, nada é duplicado", async () => {
    rt.cells.resultCells.mockImplementation((_session: string, _result: string, _cells: unknown, signal: AbortSignal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ ok: false, error: { status: 0, code: "NETWORK_ERROR", title: "x", detail: null, errors: null, extensions: {} } }))));
    const view = mount(fakeRunner(loaded({ truncated: new Map([[0, new Set([2])]]) })));

    view.show().panel.editing!.onActivate({ row: 0, column: 1 });
    view.show().panel.editing!.onDuplicateRow();
    await settle();
    expect(bannerOf(view).fetching).toBe(true);

    bannerOf(view).onCancelFetch();
    await settle();

    expect(view.show().panel.editing!.rows).toHaveLength(2);
    expect(bannerOf(view)).toMatchObject({ fetching: false, notice: recordsCopy.edit.duplicate.fetchCancelled });
  });

  it("duas vezes seguidas com a busca dos valores completos correndo (o duplo clique no botão): a segunda cancela a busca da primeira, que sai calada, e a linha é duplicada uma vez", async () => {
    const answers: ((answer: unknown) => void)[] = [];
    rt.cells.resultCells.mockImplementation(
      (_session: string, _result: string, _cells: unknown, signal: AbortSignal) =>
        new Promise((resolve) => {
          answers.push(resolve);
          signal.addEventListener("abort", () => resolve({ ok: false, error: { status: 0, code: "NETWORK_ERROR", title: "x", detail: null, errors: null, extensions: {} } }));
        }),
    );
    const view = mount(fakeRunner(loaded({ truncated: new Map([[0, new Set([2])]]) })));

    view.show().panel.editing!.onActivate({ row: 0, column: 1 });
    view.show().panel.editing!.onDuplicateRow();
    view.show().panel.editing!.onDuplicateRow();
    await settle();
    expect(rt.cells.resultCells).toHaveBeenCalledTimes(2);
    expect(bannerOf(view)).toMatchObject({ fetching: true, notice: null });

    answers[1]({ ok: true, data: ["A-1 inteiro"] });
    await settle();
    await settle();

    expect(view.show().panel.editing!.rows).toEqual([["10", "4", "A-1"], ["20", "5", "B-2"], [null, "4", "A-1 inteiro"]]);
    expect(bannerOf(view)).toMatchObject({ pending: 1, fetching: false, notice: notCopiedId });
  });

  it("onde \"Adicionar linha\" não vale (a tabela sem chave), duplicar diz o motivo e não muda nada", async () => {
    const reason = "pedidos não tem chave primária nem chave única de colunas não nulas";
    answer({ ...target, tables: [{ ...target.tables[0], key: [], editable: false, reason }], columns: target.columns.map((column) => ({ ...column, editable: false, reason })), rowOperations: false });
    const view = mount(fakeRunner(loaded()));

    await duplicate(view, 0);

    expect(view.show().panel.editing!.rows).toHaveLength(2);
    expect(bannerOf(view)).toMatchObject({ pending: 0, notice: recordsCopy.edit.readOnly(reason) });
  });

  it("a atualização automática fica em pausa desde o começo; com as linhas trocadas enquanto o alvo era perguntado, nada é duplicado", async () => {
    let respond!: () => void;
    rt.service.editTargetOrRefuse.mockImplementationOnce(() => new Promise((resolve) => (respond = () => resolve({ ok: true, data: target }))) as never);
    const runner = fakeRunner(loaded());
    const view = mount(runner);
    view.show().panel.editing!.onActivate({ row: 0, column: 1 });
    runner.autoRefresh.pause.mockClear();

    view.show().panel.editing!.onDuplicateRow();
    expect(runner.autoRefresh.pause.mock.calls).toEqual([["editing", true]]);

    runner.state = loaded({ resultId: "r2", rows: [["5", "9", "C-3"], ["10", "4", "A-1"]] });
    view.show();
    respond();
    await settle();

    expect(view.show().panel.editing!.rows).toHaveLength(2);
    expect(runner.autoRefresh.pause.mock.calls.at(-1)).toEqual(["editing", false]);
  });
});

describe("RecordsView: a barra de edição (RN-EDIT-013 e 014)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const bannerOf = (view: ReturnType<typeof mount>) => (view.show().panel.banner as { props: ComponentProps<typeof EditsBanner> }).props;
  const barOf = (view: ReturnType<typeof mount>) => view.show().panel.editing!.bar;
  const reasonsOf = (view: ReturnType<typeof mount>) => barOf(view).buttons.map((button) => button.reason);
  const target = {
    tables: [{ schema: "loja", name: "pedidos", key: [0], editable: true, reason: null }],
    columns: [
      { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
      { table: 0, baseColumn: "cliente_id", editable: true, reason: null, nullable: true, generated: null },
    ],
    rowOperations: true,
    oneAtATime: false,
  };
  const loaded = (over: Partial<RowsState> = {}) => rowsState({ resultId: "r1", rows: [["10", "4"], ["20", "5"]], ...over });
  const edit = recordsCopy.edit;

  beforeEach(() => {
    rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: target }) as never);
  });
  afterEach(() => rt.service.editTargetOrRefuse.mockReset());

  it("sem célula ativa, \"Adicionar linha\" vale e os outros pedem uma célula ou uma linha; sem o catálogo perguntado, nada mais os desabilita (RN-EDIT-010)", () => {
    const view = mount(fakeRunner(loaded()));

    expect(barOf(view).buttons.map((button) => button.label)).toEqual(["Editar célula", "Adicionar linha", "Duplicar linha", "Excluir linha"]);
    expect(reasonsOf(view)).toEqual([edit.bar.chooseCell, null, edit.bar.chooseRow, edit.bar.chooseRow]);
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();

    view.show().panel.editing!.onActivate({ row: 0, column: 1 });
    expect(reasonsOf(view)).toEqual([null, null, null, null]);
  });

  it("\"Editar célula\" abre o campo na célula ativa, com o valor, como o F2", async () => {
    const view = mount(fakeRunner(loaded()));
    view.show().panel.editing!.onActivate({ row: 1, column: 1 });

    barOf(view).onAction("edit");
    await settle();

    expect(view.show().panel.editing!.editor).toMatchObject({ row: 1, column: 1, draft: "5" });
  });

  it("\"Adicionar linha\" põe a linha nova no fim, com a célula ativa nela; \"Duplicar linha\" e \"Excluir linha\" agem na linha da célula ativa", async () => {
    const view = mount(fakeRunner(loaded()));

    barOf(view).onAction("newRow");
    await settle();
    expect(view.show().panel.editing!.rows).toEqual([["10", "4"], ["20", "5"], [null, null]]);
    expect(view.show().panel.editing!.active).toEqual({ row: 2, column: 0 });

    view.show().panel.editing!.onActivate({ row: 1, column: 1 });
    barOf(view).onAction("duplicateRow");
    await settle();
    expect(view.show().panel.editing!.rows[3]).toEqual(["20", "5"]);

    view.show().panel.editing!.onActivate({ row: 0, column: 1 });
    barOf(view).onAction("deleteRow");
    await settle();
    expect(view.show().panel.editing!.marks.get(0)?.deleted).toBe(true);
    // Riscada, a linha não se exclui de novo, e a célula dela não se edita.
    expect(reasonsOf(view)).toEqual([edit.readOnly(edit.reasons.deleted), null, null, edit.readOnly(edit.reasons.alreadyDeleted)]);
    expect(bannerOf(view).pending).toBe(3);
  });

  it("a primeira tentativa pergunta ao catálogo; se a ação não vale, a faixa diz o motivo, e dali em diante o botão fica desabilitado com ele", async () => {
    rt.service.editTargetOrRefuse.mockImplementation(async () => ({ ok: true, data: { ...target, rowOperations: false } }) as never);
    const view = mount(fakeRunner(loaded()));
    view.show().panel.editing!.onActivate({ row: 0, column: 1 });
    expect(reasonsOf(view)).toEqual([null, null, null, null]);

    barOf(view).onAction("newRow");
    await settle();

    const reason = edit.readOnly(edit.reasons.noRowOperations);
    expect(bannerOf(view).notice).toBe(reason);
    expect(reasonsOf(view)).toEqual([null, reason, reason, reason]);
    expect(barOf(view).buttons[1].title).toBe(`Adicionar linha (Alt+Insert). ${reason}`);
  });

  it("o resultado só leitura pela página desabilita os quatro com o motivo da barra do resultado, sem perguntar ao catálogo", () => {
    const view = mount(fakeRunner(loaded({ readOnly: "DISTINCT" })));
    view.show().panel.editing!.onActivate({ row: 0, column: 1 });

    expect(reasonsOf(view)).toEqual(Array(4).fill(edit.readOnly("DISTINCT")));
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
  });

  it("com a aba ocupada os quatro ficam desabilitados; com a atualização automática lendo as linhas de novo, com o motivo dela", () => {
    expect(reasonsOf(mount(fakeRunner({ status: "running", cancelling: false, previous: loaded() })))).toEqual(Array(4).fill(edit.readOnly(edit.reasons.busy)));
    rt.unmount();
    expect(reasonsOf(mount(fakeRunner({ status: "running", cancelling: false, previous: loaded(), auto: true })))).toEqual(Array(4).fill(edit.readOnly(edit.reasons.refreshing)));
  });

  it("sem nenhuma linha, os três que agem numa dizem que não há linhas, e \"Adicionar linha\" vale", () => {
    expect(reasonsOf(mount(fakeRunner(loaded({ rows: [] }))))).toEqual([edit.bar.noRows, null, edit.bar.noRows, edit.bar.noRows]);
  });

  it("Ctrl+Alt+Insert e Alt+Delete sem célula ativa não fazem nada, e a faixa diz o que a barra diz", async () => {
    const view = mount(fakeRunner(loaded()));

    view.show().panel.editing!.onDuplicateRow();
    await settle();
    expect(bannerOf(view)).toMatchObject({ pending: 0, notice: edit.bar.chooseRow });
    view.show().panel.editing!.onDeleteRow();
    await settle();
    expect(bannerOf(view)).toMatchObject({ pending: 0, notice: edit.bar.chooseRow });
    expect(rt.service.editTargetOrRefuse).not.toHaveBeenCalled();
  });

  it("o botão segura a atualização automática desde o começo, como o menu, e a ação cujo resultado mudou no meio não age (RN-GRADE-014)", async () => {
    let respond!: () => void;
    rt.service.editTargetOrRefuse.mockImplementationOnce(() => new Promise((resolve) => (respond = () => resolve({ ok: true, data: target }))) as never);
    const runner = fakeRunner(loaded());
    const view = mount(runner);
    view.show().panel.editing!.onActivate({ row: 0, column: 1 });
    runner.autoRefresh.pause.mockClear();

    barOf(view).onAction("deleteRow");
    expect(runner.autoRefresh.pause.mock.calls).toEqual([["editing", true]]);

    runner.state = loaded({ resultId: "r2", rows: [["5", "9"], ["10", "4"]] });
    view.show();
    respond();
    await settle();

    expect(view.show().panel.editing!.marks.size).toBe(0);
    expect(runner.autoRefresh.pause.mock.calls.at(-1)).toEqual(["editing", false]);
  });

  it("\"Excluir linha\" duas vezes na mesma linha nova enquanto o alvo é perguntado tira só ela: a linha nova que passou ao lugar dela fica", async () => {
    let respond!: () => void;
    rt.service.editTargetOrRefuse.mockImplementationOnce(() => new Promise((resolve) => (respond = () => resolve({ ok: true, data: target }))) as never);
    // As pendências lembradas com a aba voltam sem o alvo: duas linhas novas.
    remember("t1", "edits", { resultId: "r1", edits: addRow(addRow(noEdits, { 0: "30" }).edits, { 0: "40" }).edits });
    const view = mount(fakeRunner(loaded()));
    view.show().panel.editing!.onActivate({ row: 2, column: 0 });

    barOf(view).onAction("deleteRow");
    barOf(view).onAction("deleteRow");
    respond();
    await settle();

    expect(view.show().panel.editing!.rows).toEqual([["10", "4"], ["20", "5"], ["40", null]]);
    expect(view.show().panel.editing!.active).toEqual({ row: 2, column: 0 });
    expect(bannerOf(view).pending).toBe(1);
  });
});

describe("RecordsView: \"Importar…\" e a nota das linhas importadas (RN-IMPORT-001 e 020)", () => {
  const groupKey = (objects: "tables" | "views") => JSON.stringify(treeKey({ type: "objects", connectionId: "c1", schema: "loja", objects }));
  const bannerOf = (panel: ComponentProps<typeof ResultPanel>) => (panel.banner as { props: ComponentProps<typeof EditsBanner> }).props;

  it("habilitado na tabela, também desconectada e ocupada; abre o assistente com a tabela da aba", () => {
    const view = mount(fakeRunner({ status: "running", cancelling: false, previous: null }), { disconnected: true });
    const { panel } = view.show();

    expect(panel.importer?.blocker).toBeNull();
    panel.importer?.onImport();
    expect(rt.openImport).toHaveBeenCalledWith({ connectionId: "c1", schema: "loja", name: "pedidos" });
  });

  it("desabilitado, com o motivo, na conexão somente leitura e na visão que a árvore já mostrou", () => {
    rt.lists.set(JSON.stringify(["connections"]), [{ id: "c1", protections: { ...unprotected, readOnly: true } }]);
    rt.lists.set(JSON.stringify(["folders"]), []);
    expect(mount(fakeRunner(rowsState())).show().panel.importer?.blocker).toBe("A conexão é somente leitura: importar grava na tabela.");

    rt.lists.clear();
    rt.lists.set(groupKey("views"), [{ key: "k", kind: "view", label: "pedidos", depth: 0, hasChildren: false }]);
    expect(mount(fakeRunner(rowsState())).show().panel.importer?.blocker).toBe("Só uma tabela recebe linhas importadas: esta é uma visão.");
  });

  it("a importação nesta tabela depois da leitura acende a nota com o \"Atualizar\" da aba; a aba que lê de novo a apaga; a de outra tabela não", () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    expect(bannerOf(view.show().panel).onImportedRefresh).toBeNull();

    markImported({ connectionId: "c1", schema: "loja", name: "clientes" });
    markImported({ connectionId: "c2", schema: "loja", name: "pedidos" });
    expect(bannerOf(view.show().panel).onImportedRefresh).toBeNull();

    markImported({ connectionId: "c1", schema: "loja", name: "pedidos" });
    const lit = view.show();
    expect(bannerOf(lit.panel).onImportedRefresh).toBe(lit.records.onRefresh);

    lit.records.onRefresh();
    expect(bannerOf(view.show().panel).onImportedRefresh).toBe(lit.records.onRefresh);
    runner.state = rowsState({ id: 2 });
    expect(bannerOf(view.show().panel).onImportedRefresh).toBeNull();
  });
});

describe("RecordsView: o \"Ordenar\" e o \"Ir para o registro referenciado\" do menu da grade (RN-GRADE-004)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const submenuOf = (item: ContextMenuItem) => item.submenu!.groups.flatMap(groupItems);

  it("o \"Ordenar\" marca a ordem em vigor da coluna, e a escolhida vai ao campo e é executada, como o clique no cabeçalho", async () => {
    const runner = fakeRunner(rowsState());
    const view = mount(runner);
    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 1 }, false);
    await settle();

    const sort = view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "sort")!;
    expect(submenuOf(sort).map((item) => [item.label, item.checked])).toEqual([
      ["Crescente", false],
      ["Decrescente", false],
      ["Sem ordem", true],
    ]);
    submenuOf(sort).find((item) => item.id === "sort:desc")!.onSelect!();

    expect(runner.sent.at(-1)).toEqual(sent('ORDER BY "cliente_id" DESC'));
    expect(view.show().filter.draft).toBe('ORDER BY "cliente_id" DESC');
  });

  it("numa coluna de chave estrangeira, \"Ir para o registro referenciado\" abre a tabela de lá, filtrada pelo valor; nas outras, o item não aparece", async () => {
    rt.catalog.data = foreignKeys;
    const view = mount(fakeRunner(rowsState()));
    view.show();

    view.show().panel.editing!.onMenu({ row: 0, column: 0 }, { x: 1, y: 1 }, false);
    await settle();
    expect(view.show().menu!.groups.flatMap(groupItems).some((item) => item.id === "follow")).toBe(false);

    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 1, y: 1 }, false);
    await settle();
    view.show().menu!.groups.flatMap(groupItems).find((item) => item.id === "follow")!.onSelect!();

    expect(view.onOpenTable).toHaveBeenCalledWith({ ...clientes, view: "data" });
  });
});

describe("RecordsView: o Copiar avançado e o Gerar SQL do menu da grade, com a tabela da aba (seção 37)", () => {
  /** O alvo do "Gerar SQL" de `loja.pedidos`, com a chave em `id` e o `cliente_id` que o banco preenche por padrão. */
  const pedidosTarget = {
    tables: [{ schema: "loja", name: "pedidos", key: [0], editable: true, reason: null, kind: "table", keyColumns: ["id"] }],
    columns: [
      { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: "always" },
      { table: 0, baseColumn: "cliente_id", editable: true, reason: null, nullable: true, generated: null },
    ],
    rowOperations: true,
    oneAtATime: false,
  };
  let clipboard: { writeText: ReturnType<typeof vi.fn> };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const dialogOf = <T,>(view: ReturnType<typeof mount>, type: T) => view.show().found.find((element) => element.type === type)?.props;

  beforeEach(() => {
    clipboard = { writeText: vi.fn(async () => {}) };
    vi.stubGlobal("navigator", { clipboard, platform: "Win32" });
    rt.service.sqlTargetOrRefuse.mockResolvedValue({ ok: true, data: pedidosTarget });
  });
  afterEach(() => vi.unstubAllGlobals());

  const items = (view: ReturnType<typeof mount>) => view.show().menu!.groups.flatMap(groupItems);
  const submenu = (view: ReturnType<typeof mount>, id: string) => items(view).find((item) => item.id === id)!.submenu!.groups.flatMap(groupItems);
  async function menuOn(view: ReturnType<typeof mount>) {
    view.show().panel.editing!.onMenu({ row: 0, column: 1 }, { x: 10, y: 20 }, false);
    await settle();
  }

  it("o submenu Copiar avançado tem o diálogo, os nomes, os números, os nove Copiar como e a configuração; o Gerar SQL tem os seis itens", async () => {
    const view = mount(fakeRunner(rowsState({ resultId: "r9" })));
    await menuOn(view);

    expect(submenu(view, "advancedCopy").map((item) => item.id)).toEqual([
      "copyAdvanced",
      "copyColumnNames",
      "copyRowNumbers",
      "copyAs:csv",
      "copyAs:sourceCode",
      "copyAs:dbUnit",
      "copyAs:html",
      "copyAs:json",
      "copyAs:markdown",
      "copyAs:sql",
      "copyAs:txt",
      "copyAs:xml",
      "copyAsConfigure",
    ]);
    expect(submenu(view, "advancedCopy")[0]).toMatchObject({ label: copyAsCopy.menu.advanced, shortcut: "Ctrl+Shift+C" });
    expect(submenu(view, "generateSql").map((item) => item.label)).toEqual(Object.values(generateSqlCopy.items));
    // Habilitar não custa consulta: o alvo do "Gerar SQL" só é perguntado na escolha.
    expect(rt.service.sqlTargetOrRefuse).not.toHaveBeenCalled();
    // O Ctrl+Shift+C chega à grade.
    expect(view.show().panel.editing!.onCopyAdvanced).toBeTypeOf("function");
  });

  it("Copiar como SQL: pergunta o alvo com purpose sql e copia o INSERT na tabela da aba, sem a coluna que o banco calcula", async () => {
    const view = mount(fakeRunner(rowsState({ resultId: "r9" })));
    await menuOn(view);
    submenu(view, "advancedCopy").find((item) => item.id === "copyAs:sql")!.onSelect!();
    await settle();
    await settle();

    expect(rt.service.sqlTargetOrRefuse).toHaveBeenCalledWith("s1", "r9", null);
    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(clipboard.writeText.mock.calls[0][0]).toContain('INSERT INTO "loja"."pedidos" ("cliente_id")');
    expect(rt.toast.success).toHaveBeenCalledWith(copyAsCopy.notice.copied(1, "sql"));
  });

  it("Copiar avançado… abre o diálogo com as três origens e a tabela da aba como destino", async () => {
    const view = mount(fakeRunner(rowsState({ resultId: "r9" })));
    await menuOn(view);
    submenu(view, "advancedCopy").find((item) => item.id === "copyAdvanced")!.onSelect!();
    await settle();

    const dialog = dialogOf(view, CopyAdvancedDialog) as unknown as ComponentProps<typeof CopyAdvancedDialog>;
    expect(dialog.sources.cells.table).toEqual({ schema: "loja", name: "pedidos" });
    expect(dialog.sources.cells.sourceName).toBe("pedidos");
    expect(dialog.sources.loaded.rows).toHaveLength(1);
  });

  it("Gerar SQL ▸ DELETE abre o diálogo com o texto; \"Abrir numa aba de consulta\" vai à conexão e ao banco da aba", async () => {
    const onOpenQuery = vi.fn();
    const view = mount(fakeRunner(rowsState({ resultId: "r9" })), { onOpenQuery, database: "vendas" });
    await menuOn(view);
    submenu(view, "generateSql").find((item) => item.id === "sql:delete")!.onSelect!();
    await settle();

    const dialog = dialogOf(view, GenerateSqlDialog) as unknown as ComponentProps<typeof GenerateSqlDialog>;
    expect(dialog.dialog.view.body).toEqual({ kind: "text", text: 'DELETE FROM "loja"."pedidos"\nWHERE "id" = 10;' });

    dialog.dialog.onOpenInTab();
    expect(onOpenQuery).toHaveBeenCalledWith("c1", 'DELETE FROM "loja"."pedidos"\nWHERE "id" = 10;', "vendas");
  });
});

describe("RecordsView: o campo de filtro é a entrada da aba da tabela (RN-ABAS-019)", () => {
  it("a ref que a aba entrega chega ao campo de filtro, para o foco entrar nele ao abrir a tabela, onde o Ctrl+Espaço completa", () => {
    const filterRef = { current: null };

    const { filter } = mount(fakeRunner({ status: "idle" }), { filterRef }).show();

    expect((filter as unknown as { ref?: unknown }).ref).toBe(filterRef);
  });

  it("sem ref (a vista que ninguém foca) o campo nasce igual", () => {
    const { filter } = mount(fakeRunner({ status: "idle" })).show();

    expect((filter as unknown as { ref?: unknown }).ref).toBeUndefined();
  });
});
