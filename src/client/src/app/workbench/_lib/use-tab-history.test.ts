import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O gancho com o React simulado (o vitest deste projeto não tem DOM): confere a LIGAÇÃO com a área de trabalho, as rotas, a janela e o bloqueio. As regras
// do que cada botão e cada tecla fazem estão em `tab-history-controller.test.ts`, e a conta do histórico em `tab-history.test.ts`.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));

const world = vi.hoisted(() => ({
  tabs: [] as { id: string }[],
  activeTabId: null as string | null,
  pathname: "/workbench",
  setActiveTab: vi.fn<(tabId: string) => void>(),
  navigate: vi.fn<(to: string) => void>(),
}));
vi.mock("./workbench-state", () => ({ useWorkbench: () => ({ tabs: world.tabs, activeTabId: world.activeTabId, setActiveTab: world.setActiveTab }) }));
vi.mock("react-router", () => ({ useLocation: () => ({ pathname: world.pathname }), useNavigate: () => world.navigate }));
vi.mock("../_components/tab-strip", () => ({ tabElementId: (id: string) => `tab-${id}` }));

import { vaultLock } from "@/lib/api/vault-lock";

import { useTabHistory } from "./use-tab-history";

type Listener = (event: unknown) => void;

function fakeWindow() {
  const listeners = new Map<string, { listener: Listener; capture: boolean }[]>();
  return {
    addEventListener: vi.fn((type: string, listener: Listener, capture?: boolean) => void listeners.set(type, [...(listeners.get(type) ?? []), { listener, capture: capture === true }])),
    removeEventListener: vi.fn((type: string, listener: Listener) => void listeners.set(type, (listeners.get(type) ?? []).filter((held) => held.listener !== listener))),
    fire(type: string, event: Record<string, unknown>) {
      const full = { preventDefault: vi.fn(), defaultPrevented: false, ...event };
      for (const { listener } of listeners.get(type) ?? []) listener(full);
      return full;
    },
    count: () => [...listeners.values()].reduce((sum, held) => sum + held.length, 0),
    captured: (type: string) => (listeners.get(type) ?? []).every((held) => held.capture),
  };
}

let fake: ReturnType<typeof fakeWindow>;
const focus = vi.fn();

beforeEach(() => {
  fake = fakeWindow();
  vi.stubGlobal("window", fake);
  vi.stubGlobal("document", { querySelector: () => null, getElementById: (id: string) => ({ id, focus }) });
  vi.stubGlobal("navigator", { platform: "Win32" });
  Object.assign(world, { tabs: [], activeTabId: null, pathname: "/workbench" });
  vi.clearAllMocks();
  rt.unmount();
});

afterEach(() => {
  rt.unmount();
  vi.unstubAllGlobals();
  vaultLock.reset();
});

/** A janela com as abas dadas e a ativa dada, renderizada como o React faria a cada mudança. */
function show(ids: string[], active: string | null, pathname = "/workbench") {
  Object.assign(world, { tabs: ids.map((id) => ({ id })), activeTabId: active, pathname });
  rt.render(() => useTabHistory());
}

const keyDown = (name: string, extra: Record<string, unknown> = {}) =>
  fake.fire("keydown", { stopPropagation: vi.fn(), key: name, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: { closest: () => null }, ...extra });

describe("useTabHistory: ligado à área de trabalho (RN-ABAS-018)", () => {
  it("registra a aba ativa a cada mudança e o botão 'voltar' do mouse ativa a anterior, segurando o clique", () => {
    show(["a", "b", "c"], "a");
    show(["a", "b", "c"], "b");
    show(["a", "b", "c"], "c");

    const event = fake.fire("mouseup", { button: 3 });

    expect(world.setActiveTab).toHaveBeenCalledExactlyOnceWith("b");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(world.navigate).not.toHaveBeenCalled();
  });

  it("o 'avançar' volta à aba de onde se voltou, e Alt+← e Alt+→ fazem o mesmo", () => {
    show(["a", "b", "c"], "a");
    show(["a", "b", "c"], "b");

    keyDown("ArrowLeft", { altKey: true });
    expect(world.setActiveTab).toHaveBeenLastCalledWith("a");

    show(["a", "b", "c"], "a");
    keyDown("ArrowRight", { altKey: true });
    expect(world.setActiveTab).toHaveBeenLastCalledWith("b");
  });

  it("a aba que fechou é pulada", () => {
    show(["a", "b", "c"], "a");
    show(["a", "b", "c"], "b");
    show(["a", "b", "c"], "c");
    show(["a", "c"], "c");

    fake.fire("mouseup", { button: 3 });

    expect(world.setActiveTab).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("a aba que o Voltar ativou recebe o foco, no elemento dela, depois de ativa", () => {
    show(["a", "b"], "a");
    show(["a", "b"], "b");
    fake.fire("mouseup", { button: 3 });
    expect(focus).not.toHaveBeenCalled();

    show(["a", "b"], "a");

    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it("nas Configurações, o 'voltar' vai à área de trabalho e não mexe nas abas; nada anda pelo histórico das rotas", () => {
    show(["a", "b"], "a");
    show(["a", "b"], "b");
    show(["a", "b"], "b", "/settings");

    fake.fire("mouseup", { button: 3 });
    fake.fire("mouseup", { button: 4 });

    expect(world.navigate).toHaveBeenCalledExactlyOnceWith("/workbench");
    expect(world.setActiveTab).not.toHaveBeenCalled();
  });

  it("fora da área de trabalho e das Configurações o botão não faz nada", () => {
    show(["a", "b"], "a");
    show(["a", "b"], "b", "/sign-in");

    const event = fake.fire("mouseup", { button: 3 });

    expect(world.setActiveTab).not.toHaveBeenCalled();
    expect(world.navigate).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("o bloqueio zera o histórico, e a aba ativa de agora é a primeira entrada", () => {
    show(["a", "b"], "a");
    show(["a", "b"], "b");

    vaultLock.lock();
    vaultLock.unlock();
    show(["a", "b"], "b");
    fake.fire("mouseup", { button: 3 });

    expect(world.setActiveTab).not.toHaveBeenCalled();
  });

  it("bloqueado, o botão não ativa nada", () => {
    show(["a", "b"], "a");
    show(["a", "b"], "b");

    vaultLock.lock();
    fake.fire("mouseup", { button: 3 });

    expect(world.setActiveTab).not.toHaveBeenCalled();
  });

  it("o menu que o próprio clique fecha no pointerdown (o ContextMenu e o Select fecham em qualquer botão) ainda segura o botão", () => {
    show(["a", "b"], "a");
    show(["a", "b"], "b");
    let menuOpen = true;
    vi.stubGlobal("document", { querySelector: () => (menuOpen ? {} : null), getElementById: (id: string) => ({ id, focus }) });

    // O aperto vê o menu; o menu fecha antes de o botão ser solto.
    fake.fire("pointerdown", { button: 3 });
    menuOpen = false;
    const event = fake.fire("mouseup", { button: 3 });

    expect(world.setActiveTab).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();

    // Sem nada aberto ao apertar, o mesmo botão volta a aba.
    fake.fire("pointerdown", { button: 3 });
    fake.fire("mouseup", { button: 3 });
    expect(world.setActiveTab).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("as teclas e o botão são ouvidos na fase de captura, e ao desmontar os ouvintes saem", () => {
    show(["a", "b"], "a");
    show(["a", "b"], "b");
    expect(fake.captured("mouseup")).toBe(true);
    expect(fake.captured("pointerdown")).toBe(true);
    expect(fake.captured("keydown")).toBe(true);

    rt.unmount();
    expect(fake.count()).toBe(0);
  });

  it("um menu ou uma lista aberta segura a tecla", () => {
    show(["a", "b"], "a");
    show(["a", "b"], "b");
    vi.stubGlobal("document", { querySelector: () => ({}), getElementById: () => null });

    const event = keyDown("ArrowLeft", { altKey: true });

    expect(world.setActiveTab).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
