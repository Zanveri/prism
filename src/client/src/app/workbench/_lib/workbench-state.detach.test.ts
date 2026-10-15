import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryRunner } from "./use-query-runner";

// A aba que foi para outra janela sai desta (`detachTab`, RN-ABAS-002 e 003) no `WorkbenchProvider`, com os ganchos do React simulados, como no teste da
// troca do banco (`workbench-state.database.test.ts`). A ida espera a execução automática em andamento terminar (`handOffTab`, RN-GRADE-014), e quem solta a
// aba é a função da renderização em que a pessoa pediu: ela tem de tirar a aba da lista DE AGORA. Os executores e a API são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  type Fake = {
    options: { connectionId: string | null; database?: string; onSession: (sessionId: string | null) => void };
    state: { status: string };
    session: string | null;
    getState: () => { status: string };
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

describe("WorkbenchProvider.detachTab: a aba que foi para outra janela sai da lista de agora (RN-ABAS-002 e 003)", () => {
  it("abrir uma aba e fechar outra enquanto a ida esperava a execução automática não se desfaz: a aberta fica, com o executor e a sessão dela, e a fechada não volta", async () => {
    render().openQueryTab("c1", "select * from fila");
    render().openQueryTab("c1", "select 2");
    let value = render();
    const [moving, closed] = value.tabs;
    const movingRunner = fake(value.runnerOf(moving.id));
    value.setActiveTab(moving.id);
    // A renderização em que a pessoa pediu a ida: é a função dela que solta a aba quando a outra janela a levou.
    const asked = render();

    // Durante a espera: uma aba nova (que abre a sessão dela) e a outra fechada.
    asked.openQueryTab("c2", "select 3");
    value = render();
    const opened = value.tabs[2];
    const openedRunner = fake(value.runnerOf(opened.id));
    openedRunner.session = "s-nova";
    openedRunner.options.onSession("s-nova");
    value = render();
    value.setActiveTab(moving.id);
    value = render();
    value.closeTab(closed.id);
    value = render();
    await settle();

    asked.detachTab(moving.id);
    value = render();
    await settle();

    expect(value.tabs.map((tab) => tab.id)).toEqual([opened.id]);
    // A ativa era a que foi: a vizinha de agora fica à vista.
    expect(value.activeTabId).toBe(opened.id);
    expect(value.runnerOf(opened.id)).toBe(openedRunner as unknown as QueryRunner);
    expect(openedRunner.retire).not.toHaveBeenCalled();
    expect(rt.sessions.close).not.toHaveBeenCalledWith("s-nova");
    // Só o executor da que foi sai de cena: a sessão dela é da outra janela.
    expect(movingRunner.retire).toHaveBeenCalledOnce();
    expect(() => value.runnerOf(moving.id)).toThrow();
  });

  it("a aba à vista que não é a que foi continua à vista", () => {
    render().openQueryTab("c1");
    render().openQueryTab("c1");
    let value = render();
    const [moving, other] = value.tabs;
    const asked = value;

    asked.openQueryTab("c1");
    value = render();
    const opened = value.tabs[2];
    asked.detachTab(moving.id);
    value = render();

    expect(value.tabs.map((tab) => tab.id)).toEqual([other.id, opened.id]);
    expect(value.activeTabId).toBe(opened.id);
  });

  it("a aba que já não está na lista não muda nada", () => {
    render().openQueryTab("c1");
    let value = render();
    const tabs = value.tabs;

    value.detachTab("outra");
    value = render();

    expect(value.tabs).toBe(tabs);
  });
});
