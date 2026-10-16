import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryRunner } from "./use-query-runner";

// A troca da conexão da aba de consulta (RN-ARVORE-008) e o lugar salvo do script (RN-SCRIPT-003 e 005) no `WorkbenchProvider`, com os ganchos do React
// simulados, como no teste da troca do banco (`workbench-state.database.test.ts`): o que se confere é a LIGAÇÃO. A aba ganha um executor novo na conexão
// escolhida, no banco padrão dela; o de antes sai de cena e a sessão dele fecha na API; nada é executado, o texto fica; e a aba de um script fica com mudança
// não salva enquanto a conexão não é a salva, menos a do genérico. Os executores e a API são de mentira.
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

const script = (over: Partial<Script> = {}): Script => ({ id: "s1", name: "Fechamento", connectionID: "c1", database: null, folderID: null, icon: null, color: null, sql: "select 1", updatedAt: "2026-10-15T00:00:00Z", ...over });

beforeEach(() => {
  rt.created.length = 0;
  vi.clearAllMocks();
  forgetExcept(new Set());
});

afterEach(() => rt.unmount());

describe("WorkbenchProvider.switchConnection: a aba de consulta passa a outra conexão (RN-ARVORE-008)", () => {
  it("dá à aba um executor novo na conexão escolhida, no banco padrão dela, aposenta o de antes e fecha a sessão dele; nada é executado, e o texto fica", async () => {
    render().openQueryTab("c1", "select * from pedido", "vendas");
    let value = render();
    const tab = value.tabs[0];
    const before = fake(value.runnerOf(tab.id));
    before.session = "s-erp";
    before.options.onSession("s-erp");
    value = render();

    value.switchConnection(tab.id, "c2");
    value = render();
    await settle();
    const after = fake(value.runnerOf(tab.id));

    expect(after).not.toBe(before);
    expect(after.options).toMatchObject({ connectionId: "c2", database: undefined });
    expect(before.retire).toHaveBeenCalledOnce();
    expect(rt.sessions.close).toHaveBeenCalledWith("s-erp");
    expect(after.run).not.toHaveBeenCalled();
    expect(value.tabs[0]).toEqual({ id: tab.id, title: tab.title, connectionId: "c2", sessionId: null, sql: "select * from pedido" });
  });

  it("o texto que fica é o do editor deste instante (o da aba chega com atraso)", () => {
    render().openQueryTab("c1", "select 1");
    let value = render();
    const tab = value.tabs[0];
    const unregister = liveEditors.register(tab.id, () => ({ sql: "select 2", anchor: 0, head: 0 }));

    value.switchConnection(tab.id, "c2");
    value = render();
    unregister();

    expect(value.tabs[0].sql).toBe("select 2");
  });

  it("a mesma conexão não troca nada, e com comando em andamento a aba espera", () => {
    render().openQueryTab("c1");
    let value = render();
    const runner = fake(value.runnerOf(value.tabs[0].id));

    value.switchConnection(value.tabs[0].id, "c1");
    value = render();
    expect(value.runnerOf(value.tabs[0].id)).toBe(runner as unknown as QueryRunner);

    runner.state = { status: "running" };
    value.switchConnection(value.tabs[0].id, "c2");
    value = render();
    expect(value.tabs[0].connectionId).toBe("c1");
    expect(runner.retire).not.toHaveBeenCalled();
  });

  it("a execução da atualização automática (RN-GRADE-014) não segura a troca: o executor de antes é aposentado (o que a desliga), e a sessão dele fecha", async () => {
    render().openQueryTab("c1", "select * from fila");
    let value = render();
    const tab = value.tabs[0];
    const before = fake(value.runnerOf(tab.id));
    before.session = "s-erp";
    before.options.onSession("s-erp");
    before.state = { status: "running", auto: true };
    value = render();

    value.switchConnection(tab.id, "c2");
    value = render();
    await settle();
    const after = fake(value.runnerOf(tab.id));

    expect(after).not.toBe(before);
    expect(after.options).toMatchObject({ connectionId: "c2", database: undefined });
    expect(before.retire).toHaveBeenCalledOnce();
    expect(rt.sessions.close).toHaveBeenCalledWith("s-erp");
    expect(after.run).not.toHaveBeenCalled();
    expect(value.tabs[0].connectionId).toBe("c2");
  });

  it("a aba de uma tabela não troca de conexão", () => {
    render().openTableTab("c1", { schema: "loja", name: "pedido" });
    let value = render();

    value.switchConnection(value.tabs[0].id, "c2");
    value = render();

    expect(value.tabs[0].connectionId).toBe("c1");
  });

  it("a aba sem conexão recebe a escolhida pelo mesmo caminho, sem sessão a fechar (RN-SCRIPT-003)", async () => {
    render().openScriptTab(script({ connectionID: "c9" }), { connectionId: null, saved: {} });
    let value = render();
    const tab = value.tabs[0];

    value.switchConnection(tab.id, "c2");
    value = render();
    await settle();

    expect(fake(value.runnerOf(tab.id)).options.connectionId).toBe("c2");
    expect(rt.sessions.close).not.toHaveBeenCalled();
    // A conexão salva sumiu: dar uma conexão à aba é mudança, e o Ctrl+S a grava.
    expect(value.tabs[0].script?.dirty).toBe(true);
  });
});

describe("WorkbenchProvider: a conexão da aba de um script é mudança não salva (RN-SCRIPT-003 e 005)", () => {
  it("trocar a conexão acende o ponto, e voltar à conexão salva o apaga", () => {
    render().openScriptTab(script(), { connectionId: "c1", saved: { savedConnectionId: "c1" } });
    let value = render();
    const tab = value.tabs[0];
    expect(tab.script?.dirty).toBe(false);

    value.switchConnection(tab.id, "c2");
    value = render();
    expect(value.tabs[0].script?.dirty).toBe(true);

    value.switchConnection(tab.id, "c1");
    value = render();
    expect(value.tabs[0].script?.dirty).toBe(false);
  });

  it("o script genérico troca de conexão sem ponto: só o texto conta", () => {
    render().openScriptTab(script({ connectionID: null }), { connectionId: "c1", saved: { generic: true } });
    let value = render();
    const tab = value.tabs[0];

    value.switchConnection(tab.id, "c2");
    value = render();

    expect(value.tabs[0].script).toMatchObject({ generic: true, dirty: false });
  });

  it("depois do Ctrl+S a conexão salva é a da aba; o genérico salvo continua genérico", () => {
    render().openScriptTab(script(), { connectionId: "c1", saved: { savedConnectionId: "c1" } });
    let value = render();
    const tab = value.tabs[0];
    value.switchConnection(tab.id, "c2");
    value = render();

    value.setTabScript(tab.id, { id: "s1", name: "Fechamento" }, "select 1", { savedConnectionId: "c2" });
    value = render();
    expect(value.tabs[0].script).toMatchObject({ savedConnectionId: "c2", dirty: false });

    value.setTabScript(tab.id, { id: "s1", name: "Fechamento" }, "select 1", { generic: true });
    value = render();
    expect(value.tabs[0].script).toEqual({ id: "s1", name: "Fechamento", savedSql: "select 1", generic: true, dirty: false });
  });

  it("o texto do editor que mudou enquanto a gravação ia continua marcado", () => {
    render().openQueryTab("c1", "select 1");
    let value = render();
    const tab = value.tabs[0];
    const unregister = liveEditors.register(tab.id, () => ({ sql: "select 12", anchor: 0, head: 0 }));

    value.setTabScript(tab.id, { id: "s1", name: "Fechamento" }, "select 1", { savedConnectionId: "c1" });
    value = render();
    unregister();

    expect(value.tabs[0].script?.dirty).toBe(true);
  });

  it("tornar genérico e vincular, pelo menu do script, trocam o lugar salvo das abas dele e refazem o ponto", () => {
    render().openScriptTab(script(), { connectionId: "c1", saved: { savedConnectionId: "c1" } });
    let value = render();
    const tab = value.tabs[0];
    value.switchConnection(tab.id, "c2");
    value = render();
    expect(value.tabs[0].script?.dirty).toBe(true);

    value.setScriptPlace("s1", { generic: true });
    value = render();
    expect(value.tabs[0].script).toMatchObject({ generic: true, dirty: false });

    value.setScriptPlace("s1", { savedConnectionId: "c2" });
    value = render();
    expect(value.tabs[0].script).toEqual({ id: "s1", name: "Fechamento", savedSql: "select 1", savedConnectionId: "c2", dirty: false });

    const tabs = value.tabs;
    value.setScriptPlace("outro", { generic: true });
    expect(render().tabs).toBe(tabs);
  });
});
