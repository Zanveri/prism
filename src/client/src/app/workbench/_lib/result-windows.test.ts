import { describe, expect, it, vi } from "vitest";

import { resultWindowNameOf } from "../../../../electron/result-window-messages";
import type { Host } from "@/lib/host/host";
import { closeWaitMs, createResultWindows, type ChildWindow, type ResultWindowsDeps } from "./result-windows";

const tabA = "0b9f2c1e-8a4d-4f6b-9c3e-1d2a3b4c5d6e";
const tabB = "1c0a3d2f-9b5e-4a7c-8d4f-2e3b4c5d6e7f";
const nameA = resultWindowNameOf(tabA);
const nameB = resultWindowNameOf(tabB);

/** A janela que o `window.open` devolveria: o documento (que a tela monta), o `load` e se fechou. */
function fakeChild(readyState: "complete" | "loading" = "complete") {
  const loads = new Set<() => void>();
  const child = {
    document: { readyState } as unknown as Document,
    closed: false,
    addEventListener: (_type: "load", listener: () => void) => void loads.add(listener),
    removeEventListener: (_type: "load", listener: () => void) => void loads.delete(listener),
  } satisfies ChildWindow;
  return { child, load: () => [...loads].forEach((listener) => listener()), loads };
}

function harness(over: Partial<ResultWindowsDeps> = {}) {
  const log: string[] = [];
  const slots = new Map<string, HTMLElement | null>();
  const children = new Map<string, ReturnType<typeof fakeChild>>();
  const timers: { run: () => void; ms: number; canceled: boolean }[] = [];
  let closedHandler: (closed: { name: string; reason: "user" | "host" }) => void = () => {};
  let stateHandler: (state: { name: string; minimized: boolean }) => void = () => {};
  let existed = true;
  let allowed = true;
  let locked = false;
  const deps: ResultWindowsDeps = {
    request: async (request) => {
      log.push(`request ${request.name} ${request.mode}${request.at === null ? "" : ` @${request.at.x},${request.at.y}`}`);
      return allowed;
    },
    openWindow(name) {
      log.push(`open ${name}`);
      const made = children.get(name) ?? fakeChild();
      children.set(name, made);
      return made.child;
    },
    prepare: (child, label) => {
      log.push(`prepare ${label}`);
      const root = { setAttribute: vi.fn() } as unknown as HTMLElement;
      return { root, stop: () => void log.push("stop page") };
    },
    registerPage: (_page, name) => {
      log.push(`register ${name}`);
      return { resultWindow: name } as unknown as Host;
    },
    unregisterPage: (host) => void log.push(`unregister ${host.resultWindow}`),
    settled: async () => void log.push("settled"),
    tellReady: (name) => void log.push(`ready ${name}`),
    requestClose: async (name) => {
      log.push(`close ${name}`);
      return existed;
    },
    requestFocus: async (request) => {
      log.push(`focus ${request.name} ${request.target}`);
      return true;
    },
    setTitle: (name, title) => void log.push(`title ${name} ${title}`),
    setSlot: (tabId, element) => void (log.push(`slot ${tabId} ${element === null ? "null" : "root"}`), slots.set(tabId, element)),
    locked: () => locked,
    schedule(run, ms) {
      const timer = { run, ms, canceled: false };
      timers.push(timer);
      return () => void (timer.canceled = true);
    },
    connectBridge(handlers) {
      closedHandler = handlers.closed;
      stateHandler = handlers.state;
      return () => void log.push("disconnect");
    },
    ...over,
  };
  const windows = createResultWindows(deps);
  // O que o processo principal conta (o fechamento e o estado) chega por quem a área de trabalho ligou ao montar.
  const disconnect = windows.connect();
  return {
    windows,
    disconnect,
    log,
    slots,
    children,
    timers,
    closed: (name: string, reason: "user" | "host") => closedHandler({ name, reason }),
    state: (name: string, minimized: boolean) => stateHandler({ name, minimized }),
    deny: () => void (allowed = false),
    lock: () => void (locked = true),
    unlock: () => void (locked = false),
    gone: () => void (existed = false),
  };
}

describe("abrir a janela do resultado (RN-ABAS-013 e 017)", () => {
  it("pede a concessão, abre pelo Chromium, monta a página, põe a raiz no lugar da janela e só então avisa que está pronta", async () => {
    const h = harness();

    await expect(h.windows.open(tabA, { mode: "focus", title: "consulta-2.sql" })).resolves.toBe(true);

    expect(h.log).toEqual([
      `request ${nameA} focus`,
      `open ${nameA}`,
      "prepare Resultado de consulta-2.sql",
      `register ${nameA}`,
      `slot ${tabA} root`,
      "settled",
      `title ${nameA} Resultado · consulta-2.sql — Prism`,
      `ready ${nameA}`,
    ]);
    expect(h.windows.isOpen(tabA)).toBe(true);
    expect([...h.windows.shownTabs()]).toEqual([tabA]);
  });

  it("o ponto do arraste vai no pedido", async () => {
    const h = harness();

    await h.windows.open(tabA, { mode: "focus", at: { x: 40, y: 50 }, title: "a" });

    expect(h.log[0]).toBe(`request ${nameA} focus @40,50`);
  });

  it("o processo principal que recusa o pedido não deixa abrir nada, e a aba fica marcada como falha", async () => {
    const h = harness();
    h.deny();

    await expect(h.windows.open(tabA, { mode: "focus", title: "a" })).resolves.toBe(false);

    expect(h.log).toEqual([`request ${nameA} focus`]);
    expect(h.windows.isOpen(tabA)).toBe(false);
  });

  it("o Chromium que devolve nulo (a janela não abriu) é falha, sem raiz nem página", async () => {
    const h = harness({ openWindow: () => null });

    await expect(h.windows.open(tabA, { mode: "background", title: "a" })).resolves.toBe(false);
    expect(h.windows.isOpen(tabA)).toBe(false);
  });

  it("abrir de novo uma aba que já tem a janela, ou está abrindo, não pede outra: o nome aberto nunca é pedido duas vezes", async () => {
    const h = harness();

    const first = h.windows.open(tabA, { mode: "focus", title: "a" });
    const second = h.windows.open(tabA, { mode: "focus", title: "a" });
    await Promise.all([first, second]);
    await h.windows.open(tabA, { mode: "background", title: "a" });

    expect(h.log.filter((line) => line.startsWith("request"))).toHaveLength(1);
    expect(h.log.filter((line) => line.startsWith("open"))).toHaveLength(1);
  });

  it("o documento ainda não completo espera o `load` para montar; o `load` de outro documento monta de novo a raiz", async () => {
    const loading = fakeChild("loading");
    const h = harness({ openWindow: () => loading.child });

    const opening = h.windows.open(tabA, { mode: "focus", title: "a" });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.log).not.toContain(`slot ${tabA} root`);

    (loading.child.document as { readyState: string }).readyState = "complete";
    loading.load();
    await expect(opening).resolves.toBe(true);
    expect(h.log.filter((line) => line.startsWith("prepare"))).toHaveLength(1);

    // O documento em branco do começo foi trocado: a raiz é feita de novo no documento novo.
    (loading.child as { document: Document }).document = { readyState: "complete" } as unknown as Document;
    loading.load();
    expect(h.log.filter((line) => line.startsWith("prepare"))).toHaveLength(2);
    expect(h.log).toContain("stop page");
    expect(h.log.filter((line) => line === `slot ${tabA} root`)).toHaveLength(2);
    expect(h.log.filter((line) => line === `slot ${tabA} null`)).toHaveLength(1);
  });

  it("o `load` do mesmo documento não monta de novo", async () => {
    const h = harness();
    await h.windows.open(tabA, { mode: "focus", title: "a" });

    h.children.get(nameA)?.load();

    expect(h.log.filter((line) => line.startsWith("prepare"))).toHaveLength(1);
  });
});

describe("o fechamento: quem fechou decide o que acontece com o lugar (RN-ABAS-013 e 017)", () => {
  it("a pessoa que fecha pelo sistema (`user`) avisa quem acompanha, e a raiz sai de `resultSlots`", async () => {
    const h = harness();
    const closed = vi.fn();
    h.windows.onUserClosed(closed);
    await h.windows.open(tabA, { mode: "focus", title: "a" });

    h.closed(nameA, "user");

    expect(closed).toHaveBeenCalledWith(tabA);
    expect(h.slots.get(tabA)).toBeNull();
    expect(h.windows.isOpen(tabA)).toBe(false);
    expect(h.log).toContain(`unregister ${nameA}`);
    expect(h.windows.shownTabs().size).toBe(0);
  });

  it("o Prism que fecha (`host`) não toca no lugar: ninguém é avisado de que a pessoa fechou", async () => {
    const h = harness();
    const closed = vi.fn();
    h.windows.onUserClosed(closed);
    await h.windows.open(tabA, { mode: "focus", title: "a" });

    h.closed(nameA, "host");

    expect(closed).not.toHaveBeenCalled();
    expect(h.windows.isOpen(tabA)).toBe(false);
  });

  it("`close` marca a aba como fechando pelo Prism antes de pedir, espera o aviso e devolve que confirmou, sem voltar o resultado ao painel", async () => {
    const h = harness();
    const closed = vi.fn();
    h.windows.onUserClosed(closed);
    await h.windows.open(tabA, { mode: "focus", title: "a" });

    const closing = h.windows.close(tabA);
    await Promise.resolve();
    // Mesmo que o processo principal dissesse `user` (a pessoa fechou no mesmo instante), a marca do Prism vale.
    h.closed(nameA, "user");

    await expect(closing).resolves.toBe(true);
    expect(closed).not.toHaveBeenCalled();
    expect(h.log).toContain(`close ${nameA}`);
  });

  it("sem a confirmação em 3 segundos a espera acaba, devolve que não confirmou e esquece a janela", async () => {
    const h = harness();
    await h.windows.open(tabA, { mode: "focus", title: "a" });

    const closing = h.windows.close(tabA);
    await Promise.resolve();
    await Promise.resolve();
    const wait = h.timers.find((timer) => timer.ms === closeWaitMs);
    expect(wait).toBeDefined();
    wait?.run();

    await expect(closing).resolves.toBe(false);
    expect(h.windows.isOpen(tabA)).toBe(false);
    expect(h.slots.get(tabA)).toBeNull();
  });

  it("se o processo principal não tem a janela (já fechou), a tela a esquece na hora", async () => {
    const h = harness();
    h.gone();
    await h.windows.open(tabA, { mode: "focus", title: "a" });

    await expect(h.windows.close(tabA)).resolves.toBe(true);
    expect(h.windows.isOpen(tabA)).toBe(false);
  });

  it("fechar uma aba que não tem janela é confirmar, sem pedir nada", async () => {
    const h = harness();

    await expect(h.windows.close(tabA)).resolves.toBe(true);
    expect(h.log).toEqual([]);
  });

  it("`closeAll` fecha todas pelo Prism (o bloqueio, o \"Sair\")", async () => {
    const h = harness();
    const closed = vi.fn();
    h.windows.onUserClosed(closed);
    await h.windows.open(tabA, { mode: "focus", title: "a" });
    await h.windows.open(tabB, { mode: "background", title: "b" });

    const all = h.windows.closeAll();
    await Promise.resolve();
    await Promise.resolve();
    h.closed(nameA, "host");
    h.closed(nameB, "host");
    await all;

    expect(h.windows.isOpen(tabA) || h.windows.isOpen(tabB)).toBe(false);
    expect(closed).not.toHaveBeenCalled();
  });
});

describe("o resultado à vista: a janela aberta e não minimizada (RN-ABAS-015)", () => {
  it("minimizar tira a aba da lista das à vista, restaurar a põe de volta, e quem assinou é avisado", async () => {
    const h = harness();
    const listener = vi.fn();
    h.windows.subscribe(listener);
    await h.windows.open(tabA, { mode: "focus", title: "a" });
    listener.mockClear();

    h.state(nameA, true);
    expect(h.windows.shownTabs().has(tabA)).toBe(false);
    h.state(nameA, false);
    expect(h.windows.shownTabs().has(tabA)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    // O mesmo estado de novo não é mudança, e janela desconhecida é ignorada.
    h.state(nameA, false);
    h.state("prism-result-outra", true);
    expect(h.windows.shownTabs().has(tabA)).toBe(true);
  });

  it("a lista das à vista é o mesmo objeto enquanto não muda", async () => {
    const h = harness();
    await h.windows.open(tabA, { mode: "focus", title: "a" });
    const before = h.windows.shownTabs();

    h.state(nameA, false);

    expect(h.windows.shownTabs()).toBe(before);
  });
});

describe("a volta das abas (RN-ABAS-016)", () => {
  it("abre as janelas que faltam uma a uma, na ordem dada, sem tomar o foco", async () => {
    const h = harness();

    h.windows.reconcile([{ tabId: tabB, title: "b" }, { tabId: tabA, title: "a" }], vi.fn());
    await vi.waitFor(() => expect(h.windows.isOpen(tabA)).toBe(true));

    const requests = h.log.filter((line) => line.startsWith("request"));
    expect(requests).toEqual([`request ${nameB} background`, `request ${nameA} background`]);
  });

  it("não abre de novo a que já está aberta nem fecha a que continua pedida; fecha, pelo Prism, a que deixou de ser pedida", async () => {
    const h = harness();
    await h.windows.open(tabA, { mode: "focus", title: "a" });
    await h.windows.open(tabB, { mode: "focus", title: "b" });
    h.log.length = 0;

    h.windows.reconcile([{ tabId: tabA, title: "a" }], vi.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(h.log).toEqual([`close ${nameB}`]);
  });

  it("o bloqueio no meio da fila: as que esperavam não abrem (RN-SEG-001), e o desbloqueio pede de novo", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let settledCount = 0;
    const h = harness({ settled: async () => void (settledCount++ === 0 ? await gate : undefined) });
    const failed = vi.fn();

    h.windows.reconcile([{ tabId: tabA, title: "a" }, { tabId: tabB, title: "b" }], failed);
    await vi.waitFor(() => expect(h.log).toContain(`open ${nameA}`));

    // O bloqueio chega com a primeira ainda abrindo: o `closeAll` espera por ela, e a segunda não chega a abrir.
    h.lock();
    const closing = h.windows.closeAll();
    release();
    await Promise.resolve();
    await Promise.resolve();
    h.closed(nameA, "host");
    await closing;
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(h.log).not.toContain(`request ${nameB} background`);
    expect(h.windows.isOpen(tabB)).toBe(false);
    expect(failed).not.toHaveBeenCalled();

    h.unlock();
    h.windows.reconcile([{ tabId: tabA, title: "a" }, { tabId: tabB, title: "b" }], failed);
    await vi.waitFor(() => expect(h.windows.isOpen(tabB)).toBe(true));
    expect(failed).not.toHaveBeenCalled();
  });

  it("bloqueado, `open` recusa sem pedir nada e sem marcar a aba como falha", async () => {
    const h = harness();
    h.lock();

    await expect(h.windows.open(tabA, { mode: "focus", title: "a" })).resolves.toBe(false);
    expect(h.log).toEqual([]);

    h.unlock();
    h.windows.reconcile([{ tabId: tabA, title: "a" }], vi.fn());
    await vi.waitFor(() => expect(h.windows.isOpen(tabA)).toBe(true));
  });

  it("a que não abriu avisa qual foi e não é tentada de novo, até o lugar mudar", async () => {
    const h = harness();
    h.deny();
    const failed = vi.fn();

    h.windows.reconcile([{ tabId: tabA, title: "a" }], failed);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledWith(tabA));

    h.windows.reconcile([{ tabId: tabA, title: "a" }], failed);
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(h.log.filter((line) => line.startsWith("request"))).toHaveLength(1);

    h.windows.forgetFailure(tabA);
    h.windows.reconcile([{ tabId: tabA, title: "a" }], failed);
    await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(2));
  });
});

describe("o título, o foco e o desligar", () => {
  it("o título da janela e o nome do ponto de referência acompanham o título da aba, e só quando mudam", async () => {
    const h = harness();
    await h.windows.open(tabA, { mode: "focus", title: "consulta-2.sql" });
    h.log.length = 0;

    h.windows.setTitle(tabA, "consulta-2.sql");
    expect(h.log).toEqual([]);

    h.windows.setTitle(tabA, "pallets QAS");
    expect(h.log).toEqual([`title ${nameA} Resultado · pallets QAS — Prism`]);
  });

  it("trazer à frente passa o nome e qual das janelas (a do resultado ou a da aba)", async () => {
    const h = harness();

    await h.windows.focus(tabA, "opener");
    await h.windows.focus(tabA, "result");

    expect(h.log).toEqual([`focus ${nameA} opener`, `focus ${nameA} result`]);
  });

  it("desligar (desmontar a área de trabalho) solta a ponte e fecha as janelas pelo Prism", async () => {
    const h = harness();
    await h.windows.open(tabA, { mode: "focus", title: "a" });

    h.disconnect();

    expect(h.log).toContain("disconnect");
    expect(h.log).toContain(`close ${nameA}`);
  });
});
