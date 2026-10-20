import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { elementOfTarget, focusedHost, hostClipboard, hostFocus, hostOfDocument, hostOfNode, isElement, isHtmlElement, isNode, mainHost, resultHostRegistry } from "./host";

/** Uma página de mentira: o vitest deste projeto não tem DOM. */
function page(hasFocus = false) {
  const listeners = new Map<string, Set<() => void>>();
  const view = {
    navigator: { clipboard: { writeText: vi.fn(async () => {}), readText: vi.fn(async () => "") } },
    addEventListener: vi.fn((type: string, listener: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type))?.add(listener)),
    removeEventListener: vi.fn((type: string, listener: () => void) => void listeners.get(type)?.delete(listener)),
  };
  const state = { focus: hasFocus };
  const document = { nodeType: 9, defaultView: view, hasFocus: () => state.focus, body: { ownerDocument: null as unknown } } as unknown as Document;
  (document.body as unknown as { ownerDocument: unknown }).ownerDocument = document;
  return { document, view, state, listeners };
}

let main: ReturnType<typeof page>;
beforeEach(() => {
  main = page(true);
  vi.stubGlobal("document", main.document);
  vi.stubGlobal("window", main.view);
});
afterEach(() => {
  for (const host of resultHostRegistry.list()) resultHostRegistry.remove(host);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("a página de cada janela (RN-ABAS-017)", () => {
  it("é sempre o mesmo objeto para o mesmo documento, com o documento, a janela dele e o nome da janela do resultado", () => {
    const other = page();
    const host = hostOfDocument(other.document, "prism-result-x");

    expect(hostOfDocument(other.document)).toBe(host);
    expect(hostOfDocument(other.document, "prism-result-x")).toBe(host);
    expect(host).toMatchObject({ document: other.document, view: other.view, resultWindow: "prism-result-x" });
    expect(mainHost()).toMatchObject({ document: main.document, view: main.view, resultWindow: null });
  });

  it("a página de um nó é a do documento dele; sem nó, a da janela da aba", () => {
    const other = page();
    const host = hostOfDocument(other.document, "prism-result-y");

    expect(hostOfNode(other.document.body)).toBe(host);
    expect(hostOfNode(other.document)).toBe(host);
    expect(hostOfNode(null)).toBe(mainHost());
    expect(hostOfNode(undefined)).toBe(mainHost());
  });
});

describe("conferir o que é um elemento sem o `instanceof` da janela (RN-ABAS-017)", () => {
  const element = { nodeType: 1, focus: () => {}, parentElement: null };
  const text = { nodeType: 3, parentElement: element };

  it("pelo `nodeType`, de qualquer janela", () => {
    expect(isNode(element)).toBe(true);
    expect(isNode(text)).toBe(true);
    expect(isNode({})).toBe(false);
    expect(isNode(null)).toBe(false);
    expect(isNode("div")).toBe(false);
    expect(isElement(element)).toBe(true);
    expect(isElement(text)).toBe(false);
    expect(isElement(main.document)).toBe(false);
    expect(isHtmlElement(element)).toBe(true);
    expect(isHtmlElement({ nodeType: 1 })).toBe(false);
  });

  it("o elemento de um alvo de evento é ele mesmo, ou o pai do texto; o que não é nó não tem", () => {
    expect(elementOfTarget(element as unknown as EventTarget)).toBe(element);
    expect(elementOfTarget(text as unknown as EventTarget)).toBe(element);
    expect(elementOfTarget(null)).toBeNull();
    expect(elementOfTarget(main.view as unknown as EventTarget)).toBeNull();
  });
});

describe("as janelas do resultado e o foco entre elas", () => {
  it("a página com o foco é a da janela do resultado que o tem; sem foco em nenhuma delas, a da aba", () => {
    const other = page();
    const host = hostOfDocument(other.document, "prism-result-a");
    resultHostRegistry.add(host);

    expect(focusedHost()).toBe(mainHost());
    other.state.focus = true;
    main.state.focus = false;
    expect(focusedHost()).toBe(host);
    other.state.focus = false;
    expect(focusedHost()).toBe(mainHost());
  });

  it("a lista só muda de objeto quando muda de conteúdo, e quem assinou é avisado de quem entra e sai", () => {
    const listener = vi.fn();
    const stop = resultHostRegistry.subscribe(listener);
    const host = hostOfDocument(page().document, "prism-result-b");

    resultHostRegistry.add(host);
    const first = resultHostRegistry.list();
    resultHostRegistry.add(host);
    expect(resultHostRegistry.list()).toBe(first);
    expect(first).toEqual([host]);

    resultHostRegistry.remove(host);
    resultHostRegistry.remove(host);
    expect(resultHostRegistry.list()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("`each` liga o que for preciso a cada janela, as de agora e as que vierem, e solta quando a janela sai ou quando se desliga", () => {
    const first = hostOfDocument(page().document, "prism-result-c");
    const second = hostOfDocument(page().document, "prism-result-d");
    resultHostRegistry.add(first);
    const stops = new Map<string, ReturnType<typeof vi.fn>>();
    const stop = resultHostRegistry.each((host) => {
      const release = vi.fn();
      stops.set(host.resultWindow ?? "", release);
      return release;
    });

    resultHostRegistry.add(second);
    expect([...stops.keys()]).toEqual(["prism-result-c", "prism-result-d"]);

    resultHostRegistry.remove(first);
    expect(stops.get("prism-result-c")).toHaveBeenCalledTimes(1);
    expect(stops.get("prism-result-d")).not.toHaveBeenCalled();

    stop();
    expect(stops.get("prism-result-d")).toHaveBeenCalledTimes(1);
    expect(stops.get("prism-result-c")).toHaveBeenCalledTimes(1);
  });

  it("o foco da janela do resultado avisa quem acompanha, e a assinatura do foco devolve a página de agora", () => {
    vi.useFakeTimers();
    const other = page();
    const host = hostOfDocument(other.document, "prism-result-e");
    const listener = vi.fn();
    const stop = hostFocus.subscribe(listener);

    resultHostRegistry.add(host);
    listener.mockClear();
    for (const onFocusChange of other.listeners.get("focus") ?? []) onFocusChange();
    vi.runAllTimers();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(hostFocus.getSnapshot()).toBe(mainHost());
    stop();
  });
});

describe("a área de transferência da janela onde a pessoa está (RN-ABAS-017)", () => {
  it("de um elemento é a da página dele; da página, a dela; sem nada, a da janela com o foco", async () => {
    const other = page();
    const host = hostOfDocument(other.document, "prism-result-f");
    resultHostRegistry.add(host);

    await hostClipboard(other.document.body).writeText("a");
    await hostClipboard(host).writeText("b");
    expect(other.view.navigator.clipboard.writeText).toHaveBeenCalledTimes(2);
    expect(main.view.navigator.clipboard.writeText).not.toHaveBeenCalled();

    await hostClipboard().writeText("c");
    expect(main.view.navigator.clipboard.writeText).toHaveBeenCalledWith("c");

    main.state.focus = false;
    other.state.focus = true;
    await hostClipboard().writeText("d");
    expect(other.view.navigator.clipboard.writeText).toHaveBeenLastCalledWith("d");
  });
});
