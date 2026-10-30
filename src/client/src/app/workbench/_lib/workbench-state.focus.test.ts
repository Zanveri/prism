import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Script } from "./scripts.schema";

// Abrir uma aba por um gesto pede o foco para ela (`tabFocus`, RN-ABAS-019), e o `WorkbenchProvider` é quem pede: a aba de consulta nova, a de tabela nova ou já
// aberta, o script novo ou já aberto, a aba que chegou de outra janela e a ativa que volta na entrada. O pedido leva quem tinha o foco na hora. Quem foca é a área
// das abas, num efeito (`workbench-tabs.focus.test.ts`); aqui se confere o pedido. Os ganchos do React, os executores e a ponte são de mentira, como no teste
// de `detachTab`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  const makeRunner = () => ({ getState: () => ({ status: "idle" }), retire: vi.fn(() => ({ sessionId: null, busy: false })), release: vi.fn(() => ({ sessionId: null, busy: false })) });
  const queryClient = { removeQueries: vi.fn(), getQueryData: vi.fn() };
  const toast = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  /** O que a janela recebe quando uma aba chega de outra (`onTabArrived`). */
  const arrived: { handle: (delivery: { transfer: unknown; index?: number }) => void } = { handle: () => {} };

  return { ...createHookRuntime(), makeRunner, queryClient, toast, arrived };
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
vi.mock("@/lib/api/bridge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/bridge")>()),
  claimWorkspaceRestore: async () => false,
  onTabArrived: (handle: typeof rt.arrived.handle) => {
    rt.arrived.handle = handle;
    return () => {};
  },
  tellWindows: () => {},
}));
vi.mock("./tab-transfer", async (importOriginal) => ({ ...(await importOriginal<typeof import("./tab-transfer")>()), readTransfer: (raw: unknown) => raw }));
vi.mock("./use-query-runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("./use-query-runner")>()), createQueryRunner: () => rt.makeRunner() }));

import { forgetExcept } from "./tab-memory";
import { tabFocus } from "./tab-focus";
import { WorkbenchProvider, type useWorkbench } from "./workbench-state";

type Value = ReturnType<typeof useWorkbench>;

const render = (): Value => rt.render(() => WorkbenchProvider({ children: null }) as ReactElement<{ value: Value }>).props.value;

/** Quem tem o foco na hora do gesto: a linha do navegador, em geral. */
const row = { closest: () => null };

const script = (id: string): Script => ({ id, name: `${id}.sql`, sql: "select 1", connectionID: null, database: null, folderID: null, icon: null, color: null, updatedAt: "" });
const place = { connectionId: "c1", saved: { generic: true } } as unknown as Parameters<Value["openScriptTab"]>[1];

beforeEach(() => {
  vi.clearAllMocks();
  forgetExcept(new Set());
  tabFocus.forgetExcept(new Set());
  vi.stubGlobal("document", { activeElement: row });
});

afterEach(() => {
  rt.unmount();
  tabFocus.forgetExcept(new Set());
  vi.unstubAllGlobals();
});

describe("WorkbenchProvider: abrir uma aba pede o foco para ela (RN-ABAS-019)", () => {
  it("a aba de consulta nova ('Nova consulta', 'Gerar SELECT', 'Abrir numa aba de consulta') pede o foco, com quem o tinha", () => {
    render().openQueryTab("c1", "select 1");
    const [created] = render().tabs;

    expect(tabFocus.take(created.id)).toEqual({ tabId: created.id, from: row, fromPopup: false });
  });

  it("a aba de tabela nova pede o foco", () => {
    render().openTableTab("c1", { schema: "loja", name: "pedido" });
    const [created] = render().tabs;

    expect(tabFocus.take(created.id)).toEqual({ tabId: created.id, from: row, fromPopup: false });
  });

  it("a aba de tabela que já estava aberta também pede o foco, ativa ou não, na vista pedida (RN-TABELA-001)", () => {
    render().openTableTab("c1", { schema: "loja", name: "pedido" });
    render().openQueryTab("c1");
    const [table, query] = render().tabs;
    tabFocus.forgetExcept(new Set());
    expect(render().activeTabId).toBe(query.id);

    render().openTableTab("c1", { schema: "loja", name: "pedido", view: "structure" });

    expect(render().activeTabId).toBe(table.id);
    expect(render().tabs[0].table?.view).toBe("structure");
    expect(tabFocus.take(table.id)).toEqual({ tabId: table.id, from: row, fromPopup: false });

    // A que já era a ativa pede de novo: o foco ficou na árvore, e abrir outra vez o leva para a aba.
    render().openTableTab("c1", { schema: "loja", name: "pedido" });
    expect(tabFocus.take(table.id)).toEqual({ tabId: table.id, from: row, fromPopup: false });
  });

  it("o script novo pede o foco, e o que já estava aberto também: ele volta à aba dele, e o foco ia ficando na árvore (RN-SCRIPT-003)", () => {
    render().openScriptTab(script("s1"), place);
    const [created] = render().tabs;
    expect(tabFocus.take(created.id)).toEqual({ tabId: created.id, from: row, fromPopup: false });

    render().openQueryTab("c1");
    tabFocus.forgetExcept(new Set());
    expect(render().activeTabId).not.toBe(created.id);

    render().openScriptTab(script("s1"), place);

    expect(render().tabs).toHaveLength(2);
    expect(render().activeTabId).toBe(created.id);
    expect(tabFocus.take(created.id)).toEqual({ tabId: created.id, from: row, fromPopup: false });
  });

  it("o script cujo texto vem da API depois de uma espera pede o foco a quem o tinha quando a pessoa pediu (o duplo clique), e não a quem o tem quando a aba aparece", () => {
    const asked = { closest: () => null };

    render().openScriptTab(script("s1"), place, asked as unknown as Element);
    const [created] = render().tabs;
    expect(tabFocus.take(created.id)).toEqual({ tabId: created.id, from: asked, fromPopup: false });

    // O mesmo no ramo do script que já estava aberto.
    render().openQueryTab("c1");
    tabFocus.forgetExcept(new Set());
    render().openScriptTab(script("s1"), place, asked as unknown as Element);
    expect(tabFocus.take(created.id)).toEqual({ tabId: created.id, from: asked, fromPopup: false });

    // Quem pediu nenhum elemento (o foco não estava em lugar nenhum) é diferente de quem não disse: o primeiro fica nulo, o segundo lê o foco de agora.
    render().openScriptTab(script("s1"), place, null);
    expect(tabFocus.take(created.id)?.from).toBeNull();
    render().openScriptTab(script("s1"), place);
    expect(tabFocus.take(created.id)?.from).toBe(row);
  });

  it("o gesto que vem de um menu ou de um diálogo pede o foco marcado: eles fecham logo depois e devolvem o foco ao item da árvore", () => {
    vi.stubGlobal("document", { activeElement: { closest: () => ({}) } });

    render().openTableTab("c1", { schema: "loja", name: "pedido", view: "data" });
    const [created] = render().tabs;

    expect(tabFocus.take(created.id)?.fromPopup).toBe(true);
  });

  it("sem página (o que não é o app), o pedido não tem de quem", () => {
    vi.unstubAllGlobals();

    render().openQueryTab("c1");
    const [created] = render().tabs;

    expect(tabFocus.take(created.id)).toEqual({ tabId: created.id, from: null, fromPopup: false });
  });

  it("a aba que chega de outra janela pede o foco; a que já está aqui (o mesmo id) não pede nada", () => {
    render();
    const incoming = { id: "chegou", title: "consulta-7.sql", connectionId: "c1", sessionId: null, sql: "select 1" };
    const transfer = { tab: incoming, selection: null, state: { status: "idle" }, memory: {}, resultWindowLost: false };

    rt.arrived.handle({ transfer });
    render();

    expect(render().tabs.map((tab) => tab.id)).toEqual(["chegou"]);
    expect(render().activeTabId).toBe("chegou");
    expect(tabFocus.take("chegou")).toEqual({ tabId: "chegou", from: row, fromPopup: false });

    rt.arrived.handle({ transfer });
    expect(tabFocus.take("chegou")).toBeNull();
  });

  it("fechar uma aba ou ativar outra pela faixa não pede o foco: quem trata é a regra do foco perdido e o foco que fica na aba", () => {
    render().openQueryTab("c1");
    render().openQueryTab("c1");
    const [first, second] = render().tabs;
    tabFocus.forgetExcept(new Set());

    render().setActiveTab(first.id);
    render().closeTab(second.id);

    expect(tabFocus.take(first.id)).toBeNull();
    expect(tabFocus.take(second.id)).toBeNull();
  });
});
