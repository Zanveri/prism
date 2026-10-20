import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { hostOfDocument } from "@/lib/host/host";

// A raiz da área de resultado (`ResultHost`, RN-ABAS-017): muda de DOCUMENTO quando o resultado vai para a janela do resultado, e então refaz o que guarda a
// janela do documento, dá à árvore a página de agora e, só ali, trata o Ctrl+W e segura as teclas que a janela do resultado não tem. Sem DOM: o documento, a
// janela e a raiz são de mentira, e o portal é um elemento que diz para onde iria.
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");

  return createHookRuntime();
});

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("react-dom", async (importOriginal) => {
  const { createElement: element } = await import("react");
  return { ...(await importOriginal<typeof import("react-dom")>()), createPortal: (children: ReactNode, target: unknown) => element("portal", { target }, children) };
});
vi.mock("@/components/ui", async () => {
  const { createElement: element } = await import("react");
  return { HostProvider: ({ host, children }: { host: unknown; children: ReactNode }) => element("host-provider", { host }, children) };
});

import { elementsOf, type Found } from "@/lib/testing/react-tree";

import { ResultHost } from "./result-host";

type FakeView = { name: string; observers: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[]; ResizeObserver: new (callback: () => void) => unknown; addEventListener: () => void; removeEventListener: () => void };

/** Uma página de mentira, com a janela dela e os `ResizeObserver` que essa janela criou. */
function page(name: string) {
  const view = { name, observers: [] as FakeView["observers"], addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as FakeView;
  view.ResizeObserver = class {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor() {
      view.observers.push(this);
    }
  } as unknown as FakeView["ResizeObserver"];
  const document = { nodeType: 9, defaultView: view, hasFocus: () => false, createElement: () => element(document) } as unknown as Document & { createElement: () => unknown };
  return { document, view };
}

/** Uma raiz de mentira: guarda o pai e o documento, que o `appendChild` troca (adota). */
function element(owner: unknown) {
  const self = {
    ownerDocument: owner,
    parentElement: null as unknown,
    isConnected: false,
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getClientRects: () => [],
    remove: vi.fn(() => void (self.parentElement = null)),
  };
  return self;
}

const slotOf = (document: unknown) => {
  const slot = element(document);
  (slot as unknown as { appendChild: (child: ReturnType<typeof element>) => void }).appendChild = (child) => {
    child.ownerDocument = document;
    child.parentElement = slot;
  };
  return slot as unknown as HTMLElement;
};

let main: ReturnType<typeof page>;
let result: ReturnType<typeof page>;

beforeEach(() => {
  rt.unmount();
  main = page("aba");
  result = page("janela");
  vi.stubGlobal("document", main.document);
  vi.stubGlobal("window", main.view);
  hostOfDocument(main.document);
  hostOfDocument(result.document, "prism-result-0b9f2c1e-8a4d-4f6b-9c3e-1d2a3b4c5d6e");
});

const show = (slot: HTMLElement | null, callbacks: { onBack?: () => void; onLink?: () => void } = {}): Found[] => elementsOf(rt.render(() => ResultHost({ tabId: "a", slot, ...callbacks, children: null }) as ReactNode));
const keysOf = (found: Found[]) => found.find((candidate) => candidate.props.style && (candidate.props.style as { display?: string }).display === "contents")!.props;
const key = (over: Record<string, unknown>) => ({ key: "", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...over });

describe("ResultHost: o documento onde a raiz está (RN-ABAS-017)", () => {
  it("na janela da aba, a árvore tem a página da aba e o `ResizeObserver` é o da janela dela", () => {
    const found = show(slotOf(main.document));

    expect(found.find((candidate) => "host" in candidate.props)?.props.host).toBe(hostOfDocument(main.document));
    expect(main.view.observers).toHaveLength(1);
    expect(result.view.observers).toHaveLength(0);
  });

  it("ao ir para a janela do resultado, a raiz é adotada pelo documento dela, a árvore recebe a página dela e o `ResizeObserver` é refeito na janela dela", () => {
    show(slotOf(main.document));
    const placed = slotOf(result.document);

    const found = show(placed);
    // A segunda renderização assenta o documento (o ajuste durante a renderização pede outra).
    const host = found.find((candidate) => candidate.type === "portal")?.props.target as { ownerDocument: unknown; parentElement: unknown };

    expect(host.parentElement).toBe(placed);
    expect(host.ownerDocument).toBe(result.document);
    expect(found.find((candidate) => "host" in candidate.props)?.props.host).toBe(hostOfDocument(result.document));
    expect(main.view.observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(result.view.observers).toHaveLength(1);
    expect(result.view.observers[0].observe).toHaveBeenCalledTimes(1);
  });

  it("sem lugar (a janela do resultado fechou pelo Prism), a raiz fica onde estava e a página também", () => {
    show(slotOf(result.document));

    const found = show(null);

    expect(found.find((candidate) => "host" in candidate.props)?.props.host).toBe(hostOfDocument(result.document));
  });
});

describe("ResultHost: o campo de edição aberto é confirmado antes de a raiz sair do documento (RN-ABAS-011)", () => {
  /** Um campo com o foco dentro da raiz: o `blur` anota em que documento a raiz estava quando o foco saiu. */
  function focusInside(found: Found[], owner: { activeElement?: unknown }) {
    const host = found.find((candidate) => candidate.type === "portal")?.props.target as { ownerDocument: unknown; contains: (node: unknown) => boolean };
    const seenIn: unknown[] = [];
    const field = { blur: vi.fn(() => void seenIn.push(host.ownerDocument)) };
    owner.activeElement = field;
    host.contains = (node) => node === field;
    return { field, seenIn };
  }

  it("a volta ao painel (o Ctrl+W na janela do resultado) tira o foco do campo com a raiz ainda na janela do resultado", () => {
    const found = show(slotOf(result.document));
    const { field, seenIn } = focusInside(found, result.document as unknown as { activeElement?: unknown });

    show(slotOf(main.document));

    expect(field.blur).toHaveBeenCalledTimes(1);
    expect(seenIn).toEqual([result.document]);
  });

  it("a janela que fechou (sem lugar) também confirma o campo", () => {
    const found = show(slotOf(result.document));
    const { field } = focusInside(found, result.document as unknown as { activeElement?: unknown });

    show(null);

    expect(field.blur).toHaveBeenCalledTimes(1);
  });

  it("o foco que não está dentro da raiz fica como está", () => {
    const found = show(slotOf(result.document));
    const { field } = focusInside(found, result.document as unknown as { activeElement?: unknown });
    (found.find((candidate) => candidate.type === "portal")!.props.target as { contains: () => boolean }).contains = () => false;

    show(slotOf(main.document));

    expect(field.blur).not.toHaveBeenCalled();
  });
});

describe("releaseFocusIn: a raiz na janela do resultado (RN-ABAS-011)", () => {
  it("acha a raiz pelo lugar da janela do resultado, e não só pela página pedida", async () => {
    const { releaseFocusIn } = await import("./result-host");
    const { resultSlots } = await import("../_lib/result-slots");
    const blur = vi.fn();
    const field = { blur };
    const host = { ownerDocument: { activeElement: field, body: {} }, contains: (node: unknown) => node === field };
    const windowPage = { querySelector: () => host };
    resultSlots.set("a", "window", { ownerDocument: windowPage } as unknown as HTMLElement);

    releaseFocusIn("a", { querySelector: () => null } as unknown as Document);
    resultSlots.set("a", "window", null);

    expect(blur).toHaveBeenCalledTimes(1);
  });
});

describe("ResultHost: as teclas da janela do resultado (RN-ABAS-015 e 017)", () => {
  it("o Ctrl+W volta o resultado ao painel e não sobe à aba nem à faixa", () => {
    const onBack = vi.fn();
    const props = keysOf(show(slotOf(result.document), { onBack }));
    const event = key({ key: "w" });

    (props.onKeyDown as (event: unknown) => void)(event);

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it("as teclas do que a janela não tem não sobem, e não voltam ao painel", () => {
    const onBack = vi.fn();
    const props = keysOf(show(slotOf(result.document), { onBack }));

    for (const stopped of [key({ key: "PageUp", shiftKey: true }), key({ key: "9" }), key({ key: "b" }), key({ key: "E", shiftKey: true }), key({ key: "," })]) {
      (props.onKeyDown as (event: unknown) => void)(stopped);
      expect(stopped.stopPropagation).toHaveBeenCalled();
      expect(stopped.preventDefault).not.toHaveBeenCalled();
    }
    expect(onBack).not.toHaveBeenCalled();
  });

  it("o F5, o F6, o Alt+X, o Ctrl+S e o resto seguem até a aba de consulta", () => {
    const props = keysOf(show(slotOf(result.document), { onBack: vi.fn() }));

    for (const passing of [key({ key: "F5", ctrlKey: false }), key({ key: "F6", ctrlKey: false }), key({ key: "x", ctrlKey: false, altKey: true }), key({ key: "s" })]) {
      (props.onKeyDown as (event: unknown) => void)(passing);
      expect(passing.stopPropagation).not.toHaveBeenCalled();
    }
  });

  it("na aba do resultado e no painel (a página da aba), as teclas seguem para a faixa, que as trata", () => {
    const onBack = vi.fn();
    const props = keysOf(show(slotOf(main.document), { onBack }));
    const event = key({ key: "w" });

    (props.onKeyDown as (event: unknown) => void)(event);

    expect(onBack).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("um link usado na janela do resultado traz a janela da aba à frente; fora dela, não", () => {
    const onLink = vi.fn();
    const inLink = { target: { nodeType: 1, closest: (selector: string) => (selector === "a[href]" ? {} : null) } };
    const elsewhere = { target: { nodeType: 1, closest: () => null } };

    const inWindow = keysOf(show(slotOf(result.document), { onLink }));
    (inWindow.onClick as (event: unknown) => void)(elsewhere);
    expect(onLink).not.toHaveBeenCalled();
    (inWindow.onClick as (event: unknown) => void)(inLink);
    expect(onLink).toHaveBeenCalledTimes(1);

    rt.unmount();
    const inTab = keysOf(show(slotOf(main.document), { onLink }));
    (inTab.onClick as (event: unknown) => void)(inLink);
    expect(onLink).toHaveBeenCalledTimes(1);
  });
});
