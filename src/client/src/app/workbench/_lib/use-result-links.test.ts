import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Engine } from "@/components/ui";

import type { ForeignKey } from "./database-sessions.schema";
import type { TargetAnswer } from "./generate-sql/generate-sql-flow";
import type { SqlTarget } from "./record-edits.schema";
import type { RowsState } from "./use-query-runner";

// Os links de chave estrangeira do resultado de um comando (RN-TABELA-007), pelo gancho com os ganchos do React simulados (`createHookRuntime`): quando o alvo
// `purpose: "sql"` é perguntado (e quando não), o que a atualização automática não acrescenta, os links que chegam com as chaves de cada tabela de origem, e o
// pedido que o clique no valor monta. As decisões puras têm teste próprio (`foreign-key-links.test.ts`, `sql-target-key.test.ts`), e o pedido único à API por
// comando, o do gancho da edição (`use-record-edits.sql-target.test.ts`).
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return {
    ...createHookRuntime(),
    // As chaves de cada tabela de origem, pelo nome; e as consultas que o gancho pediu a cada renderização (para conferir o `enabled`).
    catalog: new Map<string, unknown>(),
    asked: [] as { table: unknown; enabled: boolean | undefined; meta: unknown }[],
    handoff: { request: vi.fn() },
  };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({}),
  useQueries: ({ queries, combine }: { queries: { queryKey: readonly unknown[]; enabled?: boolean; meta?: unknown }[]; combine: (results: unknown[]) => unknown }) => {
    for (const query of queries) rt.asked.push({ table: query.queryKey.at(-2), enabled: query.enabled, meta: query.meta });
    return combine(queries.map((query) => ({ data: rt.catalog.get(String(query.queryKey.at(-2))) })));
  },
}));
vi.mock("./filter-handoff", () => ({ filterHandoff: rt.handoff }));

import { useResultLinks } from "./use-result-links";

const pg: Engine = 1;
const db2: Engine = 2;

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

beforeEach(() => {
  vi.clearAllMocks();
  rt.catalog.clear();
  rt.asked.length = 0;
  rt.catalog.set("pallet_movement", [foreignKey]);
});
afterEach(() => rt.unmount());

describe("useResultLinks: quando se pergunta a origem das colunas (RN-TABELA-007)", () => {
  it("o resultado com linhas, à vista e conectado pergunta o alvo uma vez, em silêncio, e os valores são texto até a resposta", async () => {
    const view = mount();

    expect(view.show().links).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const shown = view.show();

    expect(view.sqlTarget).toHaveBeenCalledTimes(1);
    // Em silêncio: sem a frase da faixa ("Conferindo…").
    expect(view.sqlTarget).toHaveBeenCalledWith();
    // O apelido (`AS status`) não esconde a chave: a coluna 1 vem de `pallet_movement_status_id`; a calculada e o `id` não são link.
    expect([...(shown.links ?? [])]).toEqual([[1, { table: { schema: "logistica", name: "pallet_movement_status" }, column: "id" }]]);
  });

  it("a atualização automática e o F5 (outro resultado, mesmo comando e colunas) não perguntam de novo, e os links ficam os mesmos", async () => {
    const view = mount();
    const first = await settle(view);

    for (let run = 2; run <= 5; run++) view.show({ shown: rowsState({ id: run, resultId: `r${run}`, rows: [[String(run), "7", "x"]] }) });
    const after = await settle(view);

    expect(view.sqlTarget).toHaveBeenCalledTimes(1);
    expect(after.links).toBe(first.links);
  });

  it("outro comando pergunta de novo, e fica sem link até a resposta", async () => {
    const view = mount();
    await settle(view);

    const other = view.show({ shown: rowsState({ id: 2, resultId: "r2", target: { sql: "select id from logistica.pallet_movement", offset: 0 }, columns: [columns[0]] }) });

    expect(other.links).toBeUndefined();
    expect(view.sqlTarget).toHaveBeenCalledTimes(2);
  });

  it("as mesmas colunas com outro tipo, ou o mesmo comando em outro banco, também perguntam de novo", async () => {
    const view = mount();
    await settle(view);

    view.show({ shown: rowsState({ id: 2, resultId: "r2", columns: [columns[0], { ...columns[1], type: "int8" }, columns[2]] }) });
    expect(view.sqlTarget).toHaveBeenCalledTimes(2);

    view.show({ shown: rowsState({ id: 3, resultId: "r3" }), database: "outro" });
    expect(view.sqlTarget).toHaveBeenCalledTimes(3);
  });

  it("desconectada, a aba não pergunta nem mostra link, mesmo com o alvo e as chaves em cache", async () => {
    const view = mount();
    await settle(view);

    const disconnected = view.show({ connected: false });

    expect(disconnected.links).toBeUndefined();
    expect(view.sqlTarget).toHaveBeenCalledTimes(1);

    // Uma montagem nova: com o estado da anterior, que já tem o alvo deste comando, o efeito não perguntaria mesmo que a conexão não contasse.
    rt.unmount();
    const cold = mount({ connected: false });
    await settle(cold);
    expect(cold.sqlTarget).not.toHaveBeenCalled();
  });

  it("escondida (outra aba à frente, a área de trabalho fora da tela) ou sem linhas na tela, não pergunta nada e não pede as chaves ao catálogo", async () => {
    const hidden = mount({ onView: false });
    await settle(hidden);
    const empty = mount({ shown: rowsState({ rows: [] }) });
    await settle(empty);
    const none = mount({ shown: null });
    await settle(none);

    expect(hidden.sqlTarget).not.toHaveBeenCalled();
    expect(empty.sqlTarget).not.toHaveBeenCalled();
    expect(none.sqlTarget).not.toHaveBeenCalled();
    expect(none.show().links).toBeUndefined();
  });

  it("o alvo recusado ou falho (só leitura por outro motivo, resultado que mudou, falha da API) não é link, sem aviso nenhum", async () => {
    for (const refusal of [{ kind: "notEditable", reason: "união" }, { kind: "changed" }, { kind: "failed", message: "caiu" }] as TargetAnswer[]) {
      // Cada recusa é uma montagem nova: os ganchos simulados guardam o estado entre os `render`s, e o efeito que pergunta só roda com a chave trocada; sem desmontar,
      // a pergunta da recusa anterior não se repetiria e o `sqlTarget` desta nunca seria chamado.
      rt.unmount();
      const asked = vi.fn(async () => refusal);
      const view = mount({ sqlTarget: asked });

      expect((await settle(view)).links, refusal.kind).toBeUndefined();
      expect(asked, refusal.kind).toHaveBeenCalled();
    }
  });

  it("a resposta que falhou ou chegou velha não fica: a execução seguinte da pessoa (F5, outro filtro) pergunta de novo, e a atualização automática não", async () => {
    const sqlTarget = vi.fn(async (): Promise<TargetAnswer> => ({ kind: "failed", message: "caiu" }));
    const view = mount({ sqlTarget });
    await settle(view);
    expect(sqlTarget).toHaveBeenCalledTimes(1);

    // A atualização automática: outro resultado da API, a mesma execução (`id`) e as mesmas colunas. Nada se pergunta a cada 1 s.
    for (let tick = 2; tick <= 4; tick++) {
      view.show({ shown: rowsState({ resultId: `r${tick}` }) });
      await settle(view);
    }
    expect(sqlTarget).toHaveBeenCalledTimes(1);

    // O F5: outra execução, as mesmas colunas. A pessoa pediu: pergunta de novo, e agora o catálogo responde.
    sqlTarget.mockImplementation(async () => answer());
    view.show({ shown: rowsState({ id: 2, resultId: "r5" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sqlTarget).toHaveBeenCalledTimes(2);
    expect([...(view.show().links ?? [])]).toHaveLength(1);
  });

  it("o resultado que a atualização automática trocou antes de a resposta pousar (mudou) pergunta uma vez mais, e só uma", async () => {
    const sqlTarget = vi.fn(async (): Promise<TargetAnswer> => ({ kind: "changed" }));
    const view = mount({ sqlTarget });
    view.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.show();
    await new Promise((resolve) => setTimeout(resolve, 0));
    view.show();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sqlTarget).toHaveBeenCalledTimes(2);

    sqlTarget.mockImplementation(async () => answer());
    view.show({ shown: rowsState({ id: 2, resultId: "r2" }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sqlTarget).toHaveBeenCalledTimes(3);
  });

  it("pede as chaves de cada tabela de origem uma vez, só com o resultado à vista (o mesmo cache dos Registros), e sem o catálogo ainda os valores são texto", async () => {
    rt.catalog.delete("pallet_movement");
    const view = mount();
    const waiting = await settle(view);

    expect(waiting.links?.size ?? 0).toBe(0);
    // Em silêncio: o catálogo que falha deixa os valores como texto, sem o aviso central.
    expect(rt.asked.at(-1)).toEqual({ table: "pallet_movement", enabled: true, meta: { silent: true } });

    rt.catalog.set("pallet_movement", [foreignKey]);
    expect(view.show().links?.size).toBe(1);

    view.show({ onView: false });
    expect(rt.asked.at(-1)).toEqual({ table: "pallet_movement", enabled: false, meta: { silent: true } });
  });
});

describe("useResultLinks: o clique no valor (RN-TABELA-007)", () => {
  it("monta o pedido do filtro com a coluna referenciada e o valor da célula, e abre a tabela referenciada", async () => {
    const view = mount();
    const { follow } = await settle(view);

    follow(1, "7");

    expect(rt.handoff.request).toHaveBeenCalledWith("c1", { schema: "logistica", name: "pallet_movement_status" }, '"id" = 7');
    expect(view.onOpenTable).toHaveBeenCalledWith({ schema: "logistica", name: "pallet_movement_status" });
    // O pedido sai antes de a aba abrir.
    expect(rt.handoff.request.mock.invocationCallOrder[0]).toBeLessThan(view.onOpenTable.mock.invocationCallOrder[0]);
  });

  it("no banco escolhido da aba, o pedido é da tabela daquele banco; e o literal é o do banco da conexão", async () => {
    const view = mount({ engine: db2, database: "producao" });
    const { follow } = await settle(view);

    follow(1, "a\\b");

    expect(rt.handoff.request).toHaveBeenCalledWith("c1", { schema: "logistica", name: "pallet_movement_status", database: "producao" }, "\"id\" = 'a\\b'");
  });

  it("o valor de uma coluna que não é link, o nulo, o que não cabe no filtro e o clique antes do alvo chegar não abrem nada", async () => {
    const view = mount();
    view.show().follow(1, "7");
    const { follow, linkable } = await settle(view);
    follow(1, "7");
    expect(view.onOpenTable).toHaveBeenCalledTimes(1);
    vi.clearAllMocks();

    follow(0, "1");
    follow(2, "x");
    follow(1, "a\nb");

    expect(rt.handoff.request).not.toHaveBeenCalled();
    expect(view.onOpenTable).not.toHaveBeenCalled();
    expect(linkable("a\nb")).toBe(false);
    expect(linkable("7")).toBe(true);
  });

  it("desconectada, o clique em um valor que era link não abre nada: nada seria enviado", async () => {
    const view = mount();
    await settle(view);
    const { follow } = view.show({ connected: false });

    follow(1, "7");

    expect(rt.handoff.request).not.toHaveBeenCalled();
    expect(view.onOpenTable).not.toHaveBeenCalled();
  });

  it("sem o banco da conexão conhecido (o tipo da conexão ainda não chegou), nada abre e nada é link", async () => {
    const view = mount({ engine: undefined });
    const { follow, linkable } = await settle(view);

    follow(1, "7");

    expect(linkable("7")).toBe(false);
    expect(rt.handoff.request).not.toHaveBeenCalled();
  });
});
