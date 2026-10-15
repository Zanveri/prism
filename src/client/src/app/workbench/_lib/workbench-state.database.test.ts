import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryRunner } from "./use-query-runner";

// A troca do banco da aba de consulta (RN-ARVORE-007) no `WorkbenchProvider`, com os ganchos do React simulados, como no teste do bloqueio
// (`workbench-state.lock.test.ts`): o que se confere é a LIGAÇÃO. A aba ganha um executor novo no banco escolhido (é ele que abre a sessão
// desse banco na próxima execução, como a aba aberta pela árvore, RN-ARVORE-006), o de antes sai de cena e a sessão dele fecha na API; nada
// é executado, o texto fica, e a aba de um script fica com mudança não salva (RN-SCRIPT-001). Os executores e a API são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  type Fake = {
    options: { connectionId: string | null; database?: string; onSession: (sessionId: string | null) => void };
    /** `auto`: a execução da atualização automática (RN-GRADE-014). */
    state: { status: string; auto?: true };
    session: string | null;
    getState: () => { status: string; auto?: true };
    run: ReturnType<typeof vi.fn>;
    retire: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
  /** Os executores de mentira que a fábrica do provedor criou, na ordem. */
  const created: Fake[] = [];
  function makeRunner(options: Fake["options"]): Fake {
    const runner: Fake = {
      options,
      state: { status: "idle" },
      session: null,
      getState: () => runner.state,
      run: vi.fn(),
      retire: vi.fn(() => ({ sessionId: runner.session, busy: false })),
      release: vi.fn(() => ({ sessionId: runner.session, busy: false })),
    };
    created.push(runner);
    return runner;
  }

  const queryClient = { removeQueries: vi.fn(), getQueryData: vi.fn() };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const sessions = { close: vi.fn(() => Promise.resolve({ ok: true, data: undefined })) };

  return { ...createHookRuntime(), created, makeRunner, queryClient, toast, sessions };
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: undefined }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, variables: undefined }),
  useQueryClient: () => rt.queryClient,
}));
vi.mock("@/components/ui", () => ({ useToast: () => rt.toast }));
vi.mock("@/app/_components/vault-lock", () => ({ VaultLock: () => null }));
vi.mock("@/lib/api/mutation-cache", () => ({ throughMutationCache: (_client: unknown, run: () => Promise<unknown>) => run() }));
vi.mock("./database-sessions.service", async (importOriginal) => ({ ...(await importOriginal<typeof import("./database-sessions.service")>()), closeDatabaseSession: rt.sessions.close }));
vi.mock("./use-query-runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("./use-query-runner")>()), createQueryRunner: (options: Parameters<typeof rt.makeRunner>[0]) => rt.makeRunner(options) }));

import { liveEditors } from "./live-editors";
import type { Script } from "./scripts.schema";
import { forgetExcept } from "./tab-memory";
import { WorkbenchProvider, type useWorkbench } from "./workbench-state";

type Value = ReturnType<typeof useWorkbench>;
type Fake = (typeof rt.created)[number];

function render(): Value {
  const element = rt.render(() => WorkbenchProvider({ children: null }) as ReactElement<{ value: Value }>);
  return element.props.value;
}

const fake = (runner: QueryRunner) => runner as unknown as Fake;

/** Deixa as promessas em andamento chegarem ao fim. */
const settle = () => new Promise((done) => setTimeout(done, 0));

beforeEach(() => {
  rt.created.length = 0;
  vi.clearAllMocks();
  forgetExcept(new Set());
});

afterEach(() => rt.unmount());

describe("WorkbenchProvider.switchDatabase: a aba de consulta passa a outro banco do servidor (RN-ARVORE-007)", () => {
  it("dá à aba um executor novo no banco escolhido, aposenta o de antes e fecha a sessão dele; nada é executado, e o texto fica", async () => {
    render().openQueryTab("c1", "select * from pedido");
    let value = render();
    const tab = value.tabs[0];
    const before = fake(value.runnerOf(tab.id));
    before.session = "s-mes";
    before.options.onSession("s-mes");
    value = render();

    value.switchDatabase(tab.id, "vendas");
    value = render();
    await settle();
    const after = fake(value.runnerOf(tab.id));

    expect(after).not.toBe(before);
    expect(after.options).toMatchObject({ connectionId: "c1", database: "vendas" });
    expect(before.retire).toHaveBeenCalledOnce();
    expect(rt.sessions.close).toHaveBeenCalledWith("s-mes");
    expect(after.run).not.toHaveBeenCalled();
    expect(value.tabs[0]).toEqual({ ...tab, database: "vendas", sessionId: null, sql: "select * from pedido" });
  });

  it("voltar ao banco da conexão tira o banco da aba; o executor novo é o do banco da conexão", () => {
    render().openQueryTab("c1", "", "vendas");
    let value = render();
    const tab = value.tabs[0];

    value.switchDatabase(tab.id, undefined);
    value = render();

    expect(value.tabs[0]).not.toHaveProperty("database");
    expect(fake(value.runnerOf(tab.id)).options.database).toBeUndefined();
  });

  it("o texto que vai é o do editor deste instante (o da aba chega com atraso)", () => {
    render().openQueryTab("c1", "select 1");
    let value = render();
    const tab = value.tabs[0];
    const unregister = liveEditors.register(tab.id, () => ({ sql: "select 2", anchor: 0, head: 0 }));

    value.switchDatabase(tab.id, "vendas");
    value = render();
    unregister();

    expect(value.tabs[0].sql).toBe("select 2");
  });

  it("o mesmo banco não troca nada, nem a aba sem sessão abre ou fecha alguma", () => {
    render().openQueryTab("c1", "", "vendas");
    let value = render();
    const runner = value.runnerOf(value.tabs[0].id);

    value.switchDatabase(value.tabs[0].id, "vendas");
    value = render();

    expect(value.runnerOf(value.tabs[0].id)).toBe(runner);
    expect(fake(runner).retire).not.toHaveBeenCalled();
    expect(rt.sessions.close).not.toHaveBeenCalled();
  });

  it("com comando em andamento a aba não troca: a resposta dele é do banco de antes", () => {
    render().openQueryTab("c1");
    let value = render();
    const runner = fake(value.runnerOf(value.tabs[0].id));
    runner.state = { status: "running" };

    value.switchDatabase(value.tabs[0].id, "vendas");
    value = render();

    expect(value.runnerOf(value.tabs[0].id)).toBe(runner as unknown as QueryRunner);
    expect(value.tabs[0].database).toBeUndefined();
  });

  it("a execução da atualização automática (RN-GRADE-014) não segura a troca: o executor de antes é aposentado (o que a desliga), e a sessão dele fecha", async () => {
    render().openQueryTab("c1", "select * from fila");
    let value = render();
    const tab = value.tabs[0];
    const before = fake(value.runnerOf(tab.id));
    before.session = "s-mes";
    before.options.onSession("s-mes");
    before.state = { status: "running", auto: true };
    value = render();

    value.switchDatabase(tab.id, "vendas");
    value = render();
    await settle();

    expect(value.runnerOf(tab.id)).not.toBe(before as unknown as QueryRunner);
    expect(before.retire).toHaveBeenCalledOnce();
    expect(rt.sessions.close).toHaveBeenCalledWith("s-mes");
    expect(value.tabs[0].database).toBe("vendas");
  });

  it("a aba de uma tabela não troca de banco: ela é a tabela daquele banco", () => {
    render().openTableTab("c1", { schema: "loja", name: "pedido" });
    let value = render();

    value.switchDatabase(value.tabs[0].id, "vendas");
    value = render();

    expect(value.tabs[0].database).toBeUndefined();
  });

  it("a aba de um script fica com mudança não salva enquanto o banco não é o salvo, e o ponto apaga ao voltar a ele (RN-SCRIPT-001)", () => {
    const script: Script = { id: "s1", name: "Fechamento", connectionID: "c1", database: "mes2", icon: null, color: null, sql: "select 1", updatedAt: "2026-10-13T00:00:00Z" };
    render().openScriptTab(script, { connectionId: "c1", database: "mes2", saved: { savedConnectionId: "c1", savedDatabase: "mes2" } });
    let value = render();
    const tab = value.tabs[0];
    expect(tab.script?.dirty).toBe(false);

    value.switchDatabase(tab.id, "vendas");
    value = render();
    expect(value.tabs[0].script?.dirty).toBe(true);

    value.switchDatabase(tab.id, "mes2");
    value = render();
    expect(value.tabs[0].script?.dirty).toBe(false);
  });

  it("depois de salvar, o banco salvo é o da aba: o ponto apaga, e trocar de novo o acende", () => {
    render().openQueryTab("c1", "select 1", "vendas");
    let value = render();
    const tab = value.tabs[0];

    value.setTabScript(tab.id, { id: "s1", name: "Fechamento" }, "select 1", { savedConnectionId: "c1", savedDatabase: "vendas" });
    value = render();
    expect(value.tabs[0].script?.dirty).toBe(false);

    value.switchDatabase(tab.id, undefined);
    value = render();
    expect(value.tabs[0].script?.dirty).toBe(true);
  });
});
