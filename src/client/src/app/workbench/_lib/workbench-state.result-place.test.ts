import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { preferencesStore } from "@/app/settings/_lib/preferences";

// O lugar do resultado no `WorkbenchProvider` (seção 39: RN-ABAS-011, 012 e 016, RN-CONFIG-010), com os ganchos do React simulados, como nos outros testes do
// provedor: a aba de consulta nova nasce no lugar da preferência lida na hora, a de tabela não tem lugar, a aba do resultado é a entrada ativa só com o
// resultado da aba ativa numa aba, e trocar o lugar não troca o executor. Os executores e a API são de mentira.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  const created: { options: unknown; retire: ReturnType<typeof vi.fn> }[] = [];
  function makeRunner(options: unknown) {
    const runner = { options, getState: () => ({ status: "idle" }), retire: vi.fn(() => ({ sessionId: null, busy: false })), release: vi.fn(() => ({ sessionId: null, busy: false })) };
    created.push(runner);
    return runner;
  }

  const session = { userName: "lugar.resultado" as string | null };
  const queryClient = { removeQueries: vi.fn(), getQueryData: vi.fn(() => (session.userName === null ? undefined : { unlocked: true, userName: session.userName })) };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };

  return { ...createHookRuntime(), created, makeRunner, queryClient, toast, session };
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
vi.mock("./use-query-runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("./use-query-runner")>()), createQueryRunner: (options: unknown) => rt.makeRunner(options) }));

import type { Script } from "./scripts.schema";
import { forgetExcept } from "./tab-memory";
import { WorkbenchProvider, type useWorkbench } from "./workbench-state";

type Value = ReturnType<typeof useWorkbench>;

function render(): Value {
  const element = rt.render(() => WorkbenchProvider({ children: null }) as ReactElement<{ value: Value }>);
  return element.props.value;
}

const script: Script = { id: "s1", name: "Fechamento", connectionID: "c1", database: null, folderID: null, icon: null, color: null, sql: "select 1", updatedAt: "2026-10-15T00:00:00Z" };

beforeEach(() => {
  rt.created.length = 0;
  rt.session.userName = "lugar.resultado";
  preferencesStore.set("lugar.resultado", { results: { resultPlace: "panel" } });
  vi.clearAllMocks();
  forgetExcept(new Set());
});

afterEach(() => rt.unmount());

describe("a aba de consulta nova nasce no lugar da preferência (RN-ABAS-016 e RN-CONFIG-010)", () => {
  it("a 'Nova consulta' e o script aberto, no lugar da preferência lida na hora; mudar a preferência não muda as abas abertas", () => {
    render().openQueryTab("c1");
    preferencesStore.set("lugar.resultado", { results: { resultPlace: "tab" } });
    render().openQueryTab("c1", "select 2");
    render().openScriptTab(script, { connectionId: "c1", saved: { savedConnectionId: "c1" } });

    expect(render().tabs.map((tab) => tab.resultPlace)).toEqual(["panel", "tab", "tab"]);
  });

  it("a preferência 'Numa janela', sem a janela do resultado, abre no painel; sem usuário (a sessão por chegar), vale o padrão", () => {
    preferencesStore.set("lugar.resultado", { results: { resultPlace: "window" } });
    render().openQueryTab("c1");
    rt.session.userName = null;
    render().openQueryTab("c1");

    expect(render().tabs.map((tab) => tab.resultPlace)).toEqual(["panel", "panel"]);
  });

  it("a aba de tabela não tem lugar do resultado", () => {
    preferencesStore.set("lugar.resultado", { results: { resultPlace: "tab" } });
    render().openTableTab("c1", { schema: "loja", name: "pedido" });

    expect(render().tabs[0].resultPlace).toBeUndefined();
  });
});

describe("a aba do resultado é uma entrada da faixa, e não uma aba da lista (RN-ABAS-012)", () => {
  it("só fica ativa com o resultado da aba ativa numa aba; a aba ativa continua sendo a da consulta", () => {
    preferencesStore.set("lugar.resultado", { results: { resultPlace: "tab" } });
    render().openQueryTab("c1");
    const tab = render().tabs[0];

    render().showEntry(tab.id, "result");
    const value = render();
    expect(value.resultActive).toBe(true);
    expect(value.activeTabId).toBe(tab.id);

    value.setActiveTab(tab.id);
    expect(render().resultActive).toBe(false);
  });

  it("outra aba ativa desfaz a entrada do resultado, e voltar à aba volta à consulta", () => {
    preferencesStore.set("lugar.resultado", { results: { resultPlace: "tab" } });
    render().openQueryTab("c1");
    render().openQueryTab("c1");
    const [first, second] = render().tabs;

    render().showEntry(first.id, "result");
    render().setActiveTab(second.id);
    render().setActiveTab(first.id);

    expect(render().resultActive).toBe(false);
  });

  it("o resultado que sai da aba (o painel, a janela) deixa a da consulta ativa no lugar da do resultado, com o mesmo executor", () => {
    preferencesStore.set("lugar.resultado", { results: { resultPlace: "tab" } });
    render().openQueryTab("c1");
    const tab = render().tabs[0];
    const runner = render().runnerOf(tab.id);
    render().showEntry(tab.id, "result");

    render().setResultPlace(tab.id, "panel");
    const value = render();

    expect(value.tabs[0].resultPlace).toBe("panel");
    expect(value.resultActive).toBe(false);
    expect(value.activeTabId).toBe(tab.id);
    expect(value.runnerOf(tab.id)).toBe(runner);
    expect(rt.created).toHaveLength(1);
  });

  it("a aba da consulta pedida como resultado sem o resultado numa aba fica na consulta", () => {
    render().openQueryTab("c1");
    const tab = render().tabs[0];

    render().showEntry(tab.id, "result");

    expect(render().resultActive).toBe(false);
  });
});
