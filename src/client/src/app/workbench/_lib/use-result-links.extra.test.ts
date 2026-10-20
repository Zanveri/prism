import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import type { ForeignKey } from "./database-sessions.schema";
import type { TargetAnswer } from "./generate-sql/generate-sql-flow";
import type { SqlTarget } from "./record-edits.schema";
import type { RowsState } from "./use-query-runner";

// Casos extras dos links de chave estrangeira do resultado (RN-TABELA-007), na mesma montagem de `use-result-links.test.ts` (os ganchos do React simulados,
// `createHookRuntime`): o pedido ao alvo `purpose: "sql"` sai uma vez por comando e colunas, com a atualização automática (a mesma execução), as execuções
// seguidas, o banco, as colunas trocadas com o mesmo texto; a recusa, a falha ou o pedido que lança não dá link nem aviso, e a execução seguinte pergunta de
// novo; e o resultado sem linhas não pede nada.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return {
    ...createHookRuntime(),
    // As chaves de cada tabela de origem, pelo nome; e as consultas que o gancho pediu a cada renderização (a chave inteira, com o banco, para conferir).
    catalog: new Map<string, unknown>(),
    asked: [] as { key: readonly unknown[]; enabled: boolean | undefined; meta: unknown }[],
    handoff: { request: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useQueries: ({ queries, combine }: { queries: { queryKey: readonly unknown[]; enabled?: boolean; meta?: unknown }[]; combine: (results: unknown[]) => unknown }) => {
    for (const query of queries) rt.asked.push({ key: query.queryKey, enabled: query.enabled, meta: query.meta });
    return combine(queries.map((query) => ({ data: rt.catalog.get(String(query.queryKey.at(-2))) })));
  },
}));
vi.mock("./filter-handoff", () => ({ filterHandoff: rt.handoff }));

import { useResultLinks } from "./use-result-links";

const pg: Engine = 1;

const columns: RowsState["columns"] = [
  { name: "id", type: "int4", kind: "number" },
  { name: "status", type: "int4", kind: "number" },
  { name: "obs", type: "text", kind: "text" },
];
const target: SqlTarget = {
  tables: [{ schema: "logistica", name: "pallet_movement", key: [0], editable: true, reason: null, kind: "table", keyColumns: ["id"] }],
  columns: [
    { table: 0, baseColumn: "id", editable: true, reason: null, nullable: false, generated: null },
    // `pallet_movement_status_id AS status`: o resultado mostra o apelido.
    { table: 0, baseColumn: "pallet_movement_status_id", editable: true, reason: null, nullable: true, generated: null },
    { table: null, baseColumn: null, editable: false, reason: "calculada", nullable: true, generated: null },
  ],
  rowOperations: true,
  oneAtATime: false,
};
const foreignKey: ForeignKey = { name: "fk_status", columns: ["pallet_movement_status_id"], referencedSchema: "logistica", referencedTable: "pallet_movement_status", referencedColumns: ["id"] };

function rowsState(over: Partial<RowsState> = {}): RowsState {
  return {
    status: "rows",
    id: 1,
    target: { sql: "select id, pallet_movement_status_id as status, 1 as obs from logistica.pallet_movement", offset: 0 },
    columns,
    rows: [["1", "7", "x"]],
    truncated: new Map(),
    hasMore: false,
    totalRows: null,
    elapsedMs: 3,
    pages: 1,
    loadingMore: false,
    cancelling: false,
    cursorClosed: false,
    total: null,
    counting: false,
    resultId: "r1",
    ...over,
  };
}

const answer = (over: Partial<TargetAnswer> = {}): TargetAnswer => ({ kind: "target", target, ...over }) as TargetAnswer;

function mount(over: Partial<Parameters<typeof useResultLinks>[0]> = {}) {
  const sqlTarget = vi.fn(async (): Promise<TargetAnswer> => answer());
  const onOpenTable = vi.fn();
  const params = { shown: rowsState(), connectionId: "c1", database: undefined as string | undefined, engine: pg as Engine | undefined, connected: true, onView: true, sqlTarget, onOpenTable, ...over };
  const show = (change: Partial<typeof params> = {}) => {
    Object.assign(params, change);
    return rt.render(() => useResultLinks(params));
  };
  return { show, sqlTarget, onOpenTable, params };
}

/** Monta, deixa a resposta do alvo chegar e redesenha, como o React faria. */
async function settle(view: ReturnType<typeof mount>) {
  view.show();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return view.show();
}

/** Uma resposta que chega quando a pessoa (o teste) decide: para pôr outra execução na frente antes de a primeira pousar. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  rt.catalog.clear();
  rt.asked.length = 0;
  rt.catalog.set("pallet_movement", [foreignKey]);
});
afterEach(() => rt.unmount());

describe("useResultLinks: um pedido ao alvo por comando e colunas (RN-TABELA-007)", () => {
  it("dez resultados seguidos do mesmo comando (a atualização automática, a mesma execução) pedem o alvo uma vez, e os links são os mesmos", async () => {
    const view = mount();
    const first = await settle(view);

    // A atualização automática: outro resultado da API a cada 1 s, com as mesmas colunas, e a mesma execução (`id`, RN-GRADE-014).
    for (let run = 2; run <= 10; run++) view.show({ shown: rowsState({ resultId: `r${run}`, rows: [[String(run), "7", "x"]] }) });
    const after = await settle(view);

    expect(view.sqlTarget).toHaveBeenCalledTimes(1);
    expect([...(after.links ?? [])]).toEqual([[1, { table: { schema: "logistica", name: "pallet_movement_status" }, column: "id" }]]);
    expect(after.links).toBe(first.links);
  });

  it("dez atualizações que chegam antes de a resposta do alvo pousar pedem uma vez só, e a resposta vale para todas", async () => {
    const pending = deferred<TargetAnswer>();
    const sqlTarget = vi.fn(() => pending.promise);
    const view = mount({ sqlTarget });

    view.show();
    for (let run = 2; run <= 10; run++) view.show({ shown: rowsState({ resultId: `r${run}`, rows: [[String(run), "7", "x"]] }) });

    expect(sqlTarget).toHaveBeenCalledTimes(1);
    expect(view.show().links).toBeUndefined();

    pending.resolve(answer());
    await tick();
    const shown = view.show();

    expect(sqlTarget).toHaveBeenCalledTimes(1);
    expect([...(shown.links ?? [])]).toHaveLength(1);
  });

  it("o mesmo comando em outro banco pede de novo: sem link do banco de antes até a resposta, e o catálogo das chaves é o do banco novo", async () => {
    const second = deferred<TargetAnswer>();
    const sqlTarget = vi.fn().mockResolvedValueOnce(answer()).mockReturnValueOnce(second.promise);
    const view = mount({ sqlTarget });
    await settle(view);

    const moved = view.show({ database: "producao", shown: rowsState({ id: 2, resultId: "r2" }) });

    expect(sqlTarget).toHaveBeenCalledTimes(2);
    expect(moved.links).toBeUndefined();

    second.resolve(answer());
    await tick();
    const shown = view.show();

    expect([...(shown.links ?? [])]).toHaveLength(1);
    expect(JSON.stringify(rt.asked.at(-1)?.key)).toContain("producao");
  });

  it("as mesmas colunas com outro nome, outra ordem, sem uma coluna ou com uma a mais, com o mesmo texto do comando, pedem de novo a cada troca", async () => {
    const reordered: SqlTarget = { ...target, columns: [target.columns[1], target.columns[0], target.columns[2]] as SqlTarget["columns"] };
    const view = mount();
    await settle(view);
    expect(view.sqlTarget).toHaveBeenCalledTimes(1);

    // O alias muda (`AS situacao`): outro nome de coluna, a mesma origem.
    view.show({ shown: rowsState({ id: 2, resultId: "r2", columns: [columns[0], { ...columns[1], name: "situacao" }, columns[2]] }) });
    await settle(view);
    expect(view.sqlTarget).toHaveBeenCalledTimes(2);

    // A ordem muda: a resposta nova diz a origem de cada coluna na nova ordem, e o link segue a coluna `status`, agora a primeira.
    view.sqlTarget.mockImplementation(async () => answer({ target: reordered }));
    const swapped = view.show({ shown: rowsState({ id: 3, resultId: "r3", columns: [columns[1], columns[0], columns[2]], rows: [["7", "1", "x"]] }) });
    expect(swapped.links).toBeUndefined();
    const reorderedLinks = await settle(view);
    expect(view.sqlTarget).toHaveBeenCalledTimes(3);
    expect([...(reorderedLinks.links?.keys() ?? [])]).toEqual([0]);

    // Sai uma coluna: a nova lista tem menos colunas que o alvo, e nenhuma das duas que sobram é chave.
    view.sqlTarget.mockImplementation(async () => answer());
    view.show({ shown: rowsState({ id: 4, resultId: "r4", columns: [columns[0], columns[2]], rows: [["1", "x"]] }) });
    await settle(view);
    expect(view.sqlTarget).toHaveBeenCalledTimes(4);

    // Entra uma coluna: a que não tem origem no alvo não é link, e a da chave segue o seu lugar.
    view.show({ shown: rowsState({ id: 5, resultId: "r5", columns: [...columns, { name: "extra", type: "text", kind: "text" }], rows: [["1", "7", "x", "y"]] }) });
    const added = await settle(view);
    expect(view.sqlTarget).toHaveBeenCalledTimes(5);
    expect([...(added.links?.keys() ?? [])]).toEqual([1]);
  });

  it("a resposta que chega depois de outro comando já rodar não vale para o de agora, e não fica guardada para ele", async () => {
    const first = deferred<TargetAnswer>();
    const second = deferred<TargetAnswer>();
    const sqlTarget = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = mount({ sqlTarget });
    view.show();

    // Outro comando (outro texto, uma coluna, a do status): a resposta do primeiro ainda não chegou.
    const otherTarget: SqlTarget = { ...target, columns: [target.columns[1]] as SqlTarget["columns"] };
    view.show({ shown: rowsState({ id: 2, resultId: "r2", target: { sql: "select pallet_movement_status_id as status from logistica.pallet_movement", offset: 0 }, columns: [columns[1]], rows: [["7"]] }) });
    expect(sqlTarget).toHaveBeenCalledTimes(2);

    // A do primeiro chega: não é a do comando de agora, e nenhum link aparece com ela.
    first.resolve(answer());
    await tick();
    expect(view.show().links).toBeUndefined();

    second.resolve(answer({ target: otherTarget }));
    await tick();
    const shown = view.show();

    expect(sqlTarget).toHaveBeenCalledTimes(2);
    expect([...(shown.links?.keys() ?? [])]).toEqual([0]);
    expect(shown.links?.get(0)?.table.name).toBe("pallet_movement_status");
  });
});

describe("useResultLinks: a recusa ou a falha do alvo (RN-TABELA-007)", () => {
  it("recusado ou falho, o resultado não tem link, o clique não abre nada, e a atualização automática não pede de novo", async () => {
    const refusals: TargetAnswer[] = [{ kind: "notEditable", reason: "união" }, { kind: "changed" }, { kind: "failed", message: "caiu" }, { kind: "failed", message: null }];

    for (const refusal of refusals) {
      // Cada recusa é uma montagem nova: os ganchos guardam o estado entre `render`s, e sem desmontar a pergunta da recusa anterior não se repetiria.
      rt.unmount();
      const sqlTarget = vi.fn(async (): Promise<TargetAnswer> => refusal);
      const view = mount({ sqlTarget });

      const settled = await settle(view);

      for (let run = 2; run <= 10; run++) view.show({ shown: rowsState({ resultId: `r${run}`, rows: [[String(run), "7", "x"]] }) });
      const after = view.show();

      expect(settled.links, refusal.kind).toBeUndefined();
      expect(after.links, refusal.kind).toBeUndefined();
      // Uma pergunta por execução: a recusa de "resultado mudou" pergunta uma vez mais (o que já se testa, na mesma execução); as outras, não. As dez atualizações não acrescentam pedido.
      expect(sqlTarget.mock.calls.length, refusal.kind).toBe(refusal.kind === "changed" ? 2 : 1);

      view.show().follow(1, "7");
      expect(rt.handoff.request).not.toHaveBeenCalled();
      expect(view.onOpenTable).not.toHaveBeenCalled();
    }
  });

  it("o alvo que lança vale como a falha: sem link, sem erro solto, e só a execução seguinte da pessoa pergunta de novo", async () => {
    const sqlTarget = vi.fn(async (): Promise<TargetAnswer> => {
      throw new Error("sessão caiu");
    });
    const view = mount({ sqlTarget });

    view.show();
    await tick();

    expect(view.show().links).toBeUndefined();
    expect(sqlTarget).toHaveBeenCalledTimes(1);

    // A atualização automática (a mesma execução) não pergunta de novo.
    view.show({ shown: rowsState({ resultId: "r2" }) });
    await tick();
    expect(sqlTarget).toHaveBeenCalledTimes(1);

    // O F5: outra execução, e agora o catálogo responde.
    sqlTarget.mockImplementation(async () => answer());
    view.show({ shown: rowsState({ id: 2, resultId: "r3" }) });
    await tick();

    expect(sqlTarget).toHaveBeenCalledTimes(2);
    expect([...(view.show().links ?? [])]).toHaveLength(1);
  });
});

describe("useResultLinks: o resultado sem linhas não pede o alvo (RN-TABELA-007)", () => {
  it("dez resultados sem linhas, com as colunas, não pedem o alvo nem o catálogo; quando as linhas chegam, um pedido só", async () => {
    const view = mount({ shown: rowsState({ rows: [] }) });
    for (let run = 2; run <= 10; run++) view.show({ shown: rowsState({ rows: [], resultId: `r${run}` }) });
    const empty = await settle(view);

    expect(view.sqlTarget).not.toHaveBeenCalled();
    expect(rt.asked).toEqual([]);
    expect(empty.links).toBeUndefined();

    const filled = view.show({ shown: rowsState({ id: 2, resultId: "r11" }) });
    expect(filled.links).toBeUndefined();
    await settle(view);

    expect(view.sqlTarget).toHaveBeenCalledTimes(1);
  });
});
