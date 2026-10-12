import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryRunner } from "./use-query-runner";

// O `WorkbenchProvider` com os ganchos do React simulados (`createHookRuntime`, em `lib/testing/react-hooks.ts`: o vitest deste projeto não tem DOM): o que
// se confere aqui é a LIGAÇÃO do provedor com o bloqueio (RN-SEG-001), o lugar onde morava o Critical da rodada 2 e que nenhum teste guardava: o mapa de
// executores que o descarte troca é o que `runnerOf` lê, as abas são as correntes, a lista de abas é publicada de novo, o "há comando em andamento" olha o
// mapa vivo, e fechar a aba, o efeito das abas que saíram e o desmonte aposentam o executor (`retire`), e não só o soltam (`release`). Os executores são de
// mentira: `retire` e `release` são espiões, e o estado é o que a prova pôr.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  /** Os executores de mentira que a fábrica do provedor criou, na ordem. */
  const created: Fake[] = [];
  type Fake = { options: { connectionId: string; onSession: (sessionId: string | null) => void }; state: { status: string }; getState: () => { status: string }; retire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  function makeRunner(options: Fake["options"]): Fake {
    const runner: Fake = {
      options,
      state: { status: "idle" },
      getState: () => runner.state,
      retire: vi.fn(() => ({ sessionId: null, busy: false })),
      release: vi.fn(() => ({ sessionId: null, busy: false })),
    };
    created.push(runner);
    return runner;
  }

  /** A lista de conexões que a consulta devolve: `undefined` enquanto não chegou. */
  const connections = { list: undefined as { id: string }[] | undefined };
  const queryClient = { removeQueries: vi.fn(), getQueryData: vi.fn() };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

  return { ...createHookRuntime(), created, makeRunner, connections, queryClient, toast };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: rt.connections.list }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useQueryClient: () => rt.queryClient,
}));
vi.mock("@/components/ui", () => ({ useToast: () => rt.toast }));
vi.mock("@/app/_components/vault-lock", () => ({ VaultLock: () => null }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("./use-query-runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("./use-query-runner")>()), createQueryRunner: (options: Parameters<typeof rt.makeRunner>[0]) => rt.makeRunner(options) }));

import { filterHandoff } from "./filter-handoff";
import { forgetExcept, recall, remember } from "./tab-memory";
import { WorkbenchProvider, type useWorkbench } from "./workbench-state";
import { workbenchCopy } from "./workbench.copy";

type Value = ReturnType<typeof useWorkbench>;
type LockProps = { isBusy: () => boolean; discard: () => void };
type Fake = (typeof rt.created)[number];

/**
 * O que o provedor entrega ao `VaultLock` (as propriedades dele) e ao resto da tela (o valor do contexto), depois de renderizar até estabilizar: um
 * `setState` durante a renderização pede outra (o provedor poda as abas assim), e os efeitos da que foi descartada não rodam.
 */
function render(): { value: Value; lock: LockProps } {
  const element = rt.render(() => WorkbenchProvider({ children: null }) as ReactElement<{ value: Value; children: [null, ReactElement<LockProps>] }>);
  return { value: element.props.value, lock: element.props.children[1].props };
}

const fake = (runner: QueryRunner) => runner as unknown as Fake;

/** Abre uma aba de consulta para cada conexão, nesta ordem, e devolve o que o provedor entrega depois. */
function openTabs(...connectionIds: string[]) {
  let rendered = render();
  for (const connectionId of connectionIds) {
    rendered.value.openQueryTab(connectionId);
    rendered = render();
  }
  return rendered;
}

beforeEach(() => {
  rt.created.length = 0;
  rt.connections.list = undefined;
  vi.clearAllMocks();
  // A memória das abas e a passagem do filtro são de módulo: cada teste começa sem nenhuma aba lembrada e sem pedido nenhum.
  forgetExcept(new Set());
  filterHandoff.forgetExcept([]);
});

// O provedor de cada teste sai de cena como o de verdade: a limpeza dos efeitos roda (ele deixa de ouvir a passagem do filtro, que é de módulo).
afterEach(() => rt.unmount());

describe("WorkbenchProvider: o descarte e o 'em andamento' que ele entrega ao bloqueio (RN-SEG-001)", () => {
  it("o descarte troca os executores do mapa que `runnerOf` lê, uma aba por vez, e publica a lista de abas nova (nenhuma aba tem sessão)", () => {
    const { value, lock } = openTabs("c1", "c2");
    const [a, b] = value.tabs;
    const oldA = fake(value.runnerOf(a.id));
    const oldB = fake(value.runnerOf(b.id));

    lock.discard();
    const after = render().value;

    expect(oldA.retire).toHaveBeenCalledOnce();
    expect(oldB.retire).toHaveBeenCalledOnce();
    expect(after.runnerOf(a.id)).not.toBe(oldA);
    expect(after.runnerOf(b.id)).not.toBe(oldB);
    // Cada aba ganha o executor da conexão dela.
    expect(fake(after.runnerOf(a.id)).options.connectionId).toBe("c1");
    expect(fake(after.runnerOf(b.id)).options.connectionId).toBe("c2");
    // A lista de abas é publicada de novo (é o que os painéis veem do bloqueio), com o texto e a sessão nula.
    expect(after.tabs).not.toBe(value.tabs);
    expect(after.tabs.map((tab) => [tab.id, tab.sessionId])).toEqual([
      [a.id, null],
      [b.id, null],
    ]);
  });

  it("o descarte mantém o texto de SQL das abas e solta a sessão que elas guardavam", () => {
    const { value } = openTabs("c1");
    const tab = value.tabs[0];
    value.updateTab(tab.id, { sql: "update t set a = 1", sessionId: "s1" });
    const typed = render();

    typed.lock.discard();
    const after = render().value;

    expect(after.tabs).toEqual([{ ...tab, sql: "update t set a = 1", sessionId: null }]);
  });

  it("'há comando em andamento' olha o mapa vivo: o executor de qualquer aba, inclusive o de uma aba aberta depois de o gancho ser entregue", () => {
    const { value, lock } = openTabs("c1");
    expect(lock.isBusy()).toBe(false);

    fake(value.runnerOf(value.tabs[0].id)).state = { status: "running" };
    expect(lock.isBusy()).toBe(true);
    fake(value.runnerOf(value.tabs[0].id)).state = { status: "idle" };
    expect(lock.isBusy()).toBe(false);

    value.openQueryTab("c2");
    const later = render();
    fake(later.value.runnerOf(later.value.tabs[1].id)).state = { status: "running" };
    expect(lock.isBusy()).toBe(true);
  });

  it("cada aba ganha o executor da conexão dela, e a sessão que ele abre vai para a aba", () => {
    const { value } = openTabs("c7");
    const runner = fake(value.runnerOf(value.tabs[0].id));

    expect(runner.options.connectionId).toBe("c7");
    runner.options.onSession("s9");

    expect(render().value.tabs[0].sessionId).toBe("s9");
  });
});

describe("WorkbenchProvider: o executor que sai de cena é aposentado (retire), e não só solto (release)", () => {
  it("fechar a aba aposenta o executor dela, e só o dela", () => {
    const { value } = openTabs("c1", "c2");
    const [a, b] = value.tabs;
    const closed = fake(value.runnerOf(a.id));
    const kept = fake(value.runnerOf(b.id));

    value.closeTab(a.id);

    expect(closed.retire).toHaveBeenCalledOnce();
    expect(closed.release).not.toHaveBeenCalled();
    expect(kept.retire).not.toHaveBeenCalled();
  });

  it("o efeito das abas que saíram (a conexão foi excluída) aposenta o executor e o tira do mapa", () => {
    const { value } = openTabs("c1", "c2");
    const [a, b] = value.tabs;
    const stays = fake(value.runnerOf(a.id));
    const leaves = fake(value.runnerOf(b.id));

    // A lista de conexões chega sem a c2: a aba dela é podada, e o executor dela não tem mais para quem executar.
    rt.connections.list = [{ id: "c1" }];
    const after = render().value;

    expect(after.tabs.map((tab) => tab.id)).toEqual([a.id]);
    expect(leaves.retire).toHaveBeenCalledOnce();
    expect(leaves.release).not.toHaveBeenCalled();
    expect(() => after.runnerOf(b.id)).toThrow();
    expect(after.runnerOf(a.id)).toBe(stays);
    expect(stays.retire).not.toHaveBeenCalled();
  });

  it("sair do cofre (desmontar o provedor) aposenta todos os executores", () => {
    const { value } = openTabs("c1", "c2");
    const runners = value.tabs.map((tab) => fake(value.runnerOf(tab.id)));

    rt.unmount();

    for (const runner of runners) {
      expect(runner.retire).toHaveBeenCalledOnce();
      expect(runner.release).not.toHaveBeenCalled();
    }
  });
});

describe("WorkbenchProvider: o filtro que uma chave estrangeira pediu a uma tabela (`filter-handoff.ts`) morre com a aba dela, e o que não foi levado a tempo é dito", () => {
  const clientes = { schema: "loja", name: "clientes" };
  const pedidos = { schema: "loja", name: "pedidos" };

  it("fechar a aba da tabela apaga o pedido que esperava por ela: reabrir a mesma tabela não leva o filtro velho", () => {
    let rendered = render();
    rendered.value.openTableTab("c1", clientes);
    rendered = render();
    rendered.value.openTableTab("c1", pedidos);
    rendered = render();
    filterHandoff.request("c1", clientes, '"id" = 4');
    filterHandoff.request("c1", pedidos, '"id" = 9');

    rendered.value.closeTab(rendered.value.tabs.find((tab) => tab.table?.name === "clientes")!.id);
    render();

    expect(filterHandoff.peek("c1", clientes)).toBeNull();
    expect(filterHandoff.peek("c1", pedidos)).toMatchObject({ where: '"id" = 9' });
  });

  it("o pedido feito ANTES de a aba existir (o clique abre a aba em seguida) é dela, e fica", () => {
    const { value } = render();
    filterHandoff.request("c1", clientes, '"id" = 4');
    value.openTableTab("c1", clientes);
    render();

    expect(filterHandoff.peek("c1", clientes)).toMatchObject({ where: '"id" = 4' });
  });

  it("o bloqueio por inatividade não apaga o pedido: as abas ficam", () => {
    let rendered = render();
    rendered.value.openTableTab("c1", clientes);
    rendered = render();
    filterHandoff.request("c1", clientes, '"id" = 4');

    rendered.lock.discard();
    render();

    expect(filterHandoff.peek("c1", clientes)).toMatchObject({ where: '"id" = 4' });
  });

  it("o pedido que ninguém levou a tempo vira aviso de atenção, com o nome da tabela; depois de sair do cofre, não", () => {
    vi.useFakeTimers();
    try {
      let rendered = render();
      rendered.value.openTableTab("c1", clientes);
      rendered = render();
      filterHandoff.request("c1", clientes, '"id" = 4');

      vi.advanceTimersByTime(60_000);

      expect(rt.toast.warning.mock.calls).toEqual([[workbenchCopy.toasts.filterNotApplied("loja.clientes")]]);

      rt.unmount();
      filterHandoff.request("c1", clientes, '"id" = 5');
      vi.advanceTimersByTime(60_000);

      expect(rt.toast.warning).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WorkbenchProvider: o que a tela de cada aba lembra (o filtro, a ordem, a divisão, o zoom: `tab-memory.ts`) sai com a aba", () => {
  const filter = { draft: "ativo = 1", query: { where: "ativo = 1", sort: null } };

  it("fechar a aba leva a memória dela, e só a dela", () => {
    const { value } = openTabs("c1", "c2");
    const [a, b] = value.tabs;
    remember(a.id, "records", filter);
    remember(b.id, "records", filter);
    remember(a.id, "structure", "indexes");
    remember(b.id, "structure", "ddl");

    value.closeTab(a.id);
    render();

    expect(recall(a.id, "records")).toBeUndefined();
    expect(recall(b.id, "records")).toEqual(filter);
    // A seção da Estrutura (RN-TABELA-009): fechar a aba a esquece, e a da outra aba fica.
    expect(recall(a.id, "structure")).toBeUndefined();
    expect(recall(b.id, "structure")).toBe("ddl");
  });

  it("a aba podada com a conexão excluída também leva a dela", () => {
    const { value } = openTabs("c1", "c2");
    const [a, b] = value.tabs;
    remember(a.id, "diagram", { zoom: 0.5, left: 3, top: 4 });
    remember(b.id, "diagram", { zoom: 2, left: 0, top: 0 });
    remember(a.id, "structure", "foreignKeys");
    remember(b.id, "structure", "foreignKeys");

    rt.connections.list = [{ id: "c1" }];
    render();

    expect(recall(a.id, "diagram")).toEqual({ zoom: 0.5, left: 3, top: 4 });
    expect(recall(b.id, "diagram")).toBeUndefined();
    expect(recall(a.id, "structure")).toBe("foreignKeys");
    expect(recall(b.id, "structure")).toBeUndefined();
  });

  it("sair do cofre (desmontar o provedor) apaga a memória de todas as abas e os filtros pedidos que esperavam: o texto dos filtros não fica para o usuário seguinte", () => {
    let rendered = render();
    rendered.value.openTableTab("c1", { schema: "loja", name: "clientes" });
    rendered = render();
    rendered.value.openQueryTab("c1");
    rendered = render();
    const [table, query] = rendered.value.tabs;
    remember(table.id, "records", filter);
    remember(table.id, "diagram", { zoom: 0.5, left: 3, top: 4 });
    remember(table.id, "structure", "indexes");
    remember(query.id, "layout", { mode: "collapsed", resultPercent: 35 });
    filterHandoff.request("c1", { schema: "loja", name: "clientes" }, "cpf = '000'");

    rt.unmount();

    expect(recall(table.id, "records")).toBeUndefined();
    expect(recall(table.id, "diagram")).toBeUndefined();
    expect(recall(table.id, "structure")).toBeUndefined();
    expect(recall(query.id, "layout")).toBeUndefined();
    expect(filterHandoff.peek("c1", { schema: "loja", name: "clientes" })).toBeNull();
  });

  it("o bloqueio por inatividade NÃO apaga: as abas ficam, e o filtro de cada uma tem de sobreviver a ele (RN-SEG-001)", () => {
    const { value, lock } = openTabs("c1", "c2");
    for (const tab of value.tabs) remember(tab.id, "records", filter);
    for (const tab of value.tabs) remember(tab.id, "structure", "foreignKeys");

    lock.discard();
    const after = render().value;

    for (const tab of after.tabs) expect(recall(tab.id, "records"), tab.title).toEqual(filter);
    // A seção da Estrutura também sobrevive ao bloqueio (RN-TABELA-009): ao desbloquear a aba volta onde a pessoa estava.
    for (const tab of after.tabs) expect(recall(tab.id, "structure"), tab.title).toBe("foreignKeys");
  });
});
