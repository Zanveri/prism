import { vi, type Mock } from "vitest";

/**
 * Uma página de mentira para o que depende do foco (RN-ABAS-019), já que o vitest deste projeto não tem DOM: o `document` com o `activeElement`, o `body`, o
 * `getElementById`, o `querySelector` e os ouvintes, e a `window` com os dela. O elemento de mentira responde a `closest` pelos seletores que o código pergunta
 * (`inside`), e `focus()` faz o que o navegador faz: se o elemento está vivo e à vista, passa a ser o `activeElement` e avisa o `focusin` do `document`.
 * Quem usa instala com `vi.stubGlobal("document", page.document)` e `vi.stubGlobal("window", page.window)`. Só para testes.
 */
type Listener = (event: never) => void;

export type FakeElement = Element & {
  /** `false`: o elemento está num painel escondido (`checkVisibility`), e o `focus()` não o alcança. */
  visible: boolean;
  focus: Mock<(options?: FocusOptions) => void>;
  /** Tira o elemento da página: o foco que estava nele vai para o corpo, sem `blur`, como o navegador faz. */
  remove: () => void;
};

export function createFakePage() {
  const listeners = { window: new Map<string, Set<Listener>>(), document: new Map<string, Set<{ listener: Listener; capture: boolean }>>() };
  const byId = new Map<string, FakeElement>();
  const answers = new Map<string, FakeElement>();
  const state = { active: null as FakeElement | null, popup: false, lists: [] as boolean[] };

  /**
   * O que o `querySelector` do `document` responde a um seletor: o elemento posto em `answer`, ou o que o diálogo, o menu ou a lista abertos (`popup`) são. As listas
   * postas em `setLists` só respondem ao seletor que as inclui (o do `popupOpen`), e não ao dos diálogos e menus.
   */
  function query(selector: string) {
    if (selector.includes("aria-modal") && (state.popup || (selector.includes("listbox") && state.lists.length > 0))) return {} as Element;
    return (answers.get(selector) ?? null) as unknown as Element | null;
  }

  /** O que o `querySelectorAll` responde: as listas (`role=listbox`) de `setLists`, cada uma com o `closest` que diz se é a lista de sugestões de um editor (`.cm-tooltip`). */
  function queryAll(selector: string) {
    if (selector !== '[role="listbox"]') return [];
    return state.lists.map((inEditor) => ({ closest: (ancestor: string) => (inEditor && ancestor === ".cm-tooltip" ? {} : null) }) as unknown as Element);
  }

  const body = element({ id: "body", tag: "BODY" });

  function element({ id, tag = "DIV", inside = [] }: { id: string; tag?: string; inside?: string[] }): FakeElement {
    let connected = true;
    const el = {
      id,
      tagName: tag,
      get isConnected() {
        return connected;
      },
      visible: true,
      closest: (selector: string) => (selector.split(",").some((part) => inside.includes(part.trim())) ? el : null),
      checkVisibility: () => el.visible,
      focus: vi.fn(() => {
        if (!connected || !el.visible) return;
        state.active = el;
        fire("document", "focusin", { target: el });
      }),
      remove: () => {
        connected = false;
        if (state.active === el) state.active = null;
        byId.delete(id);
      },
    } as unknown as FakeElement;
    byId.set(id, el);
    return el;
  }

  function fire(host: "window" | "document", type: string, event: Record<string, unknown>) {
    const full = { defaultPrevented: false, preventDefault: vi.fn(() => void (full.defaultPrevented = true)), ...event };
    if (host === "document") for (const { listener } of [...(listeners.document.get(type) ?? [])]) listener(full as never);
    // O evento da janela passa pelo `document` (captura e bolha) antes de chegar a ela, como no navegador; aqui só a janela o ouve.
    if (host === "window") for (const listener of [...(listeners.window.get(type) ?? [])]) listener(full as never);
    return full;
  }

  const document = {
    get activeElement() {
      return state.active ?? body;
    },
    body,
    querySelector: query,
    querySelectorAll: queryAll,
    getElementById: (id: string) => byId.get(id) ?? null,
    addEventListener: vi.fn((type: string, listener: Listener, capture?: boolean | { capture?: boolean }) => {
      const held = listeners.document.get(type) ?? new Set();
      held.add({ listener, capture: capture === true || (typeof capture === "object" && capture.capture === true) });
      listeners.document.set(type, held);
    }),
    removeEventListener: vi.fn((type: string, listener: Listener) => {
      const held = listeners.document.get(type);
      if (held !== undefined) for (const entry of [...held]) if (entry.listener === listener) held.delete(entry);
    }),
  };

  const window = {
    addEventListener: vi.fn((type: string, listener: Listener) => void listeners.window.set(type, (listeners.window.get(type) ?? new Set()).add(listener))),
    removeEventListener: vi.fn((type: string, listener: Listener) => void listeners.window.get(type)?.delete(listener)),
  };

  return {
    document,
    window,
    body,
    /** Um elemento da página: `inside` são os seletores a que ele pertence (`closest`), por exemplo `[data-tab-strip]`. */
    element,
    /** O elemento que o `querySelector` devolve para o seletor dado. */
    answer: (selector: string, el: FakeElement | null) => void (el === null ? answers.delete(selector) : answers.set(selector, el)),
    /** Há (ou não) um diálogo modal, um menu ou uma lista aberta. */
    setPopup: (open: boolean) => void (state.popup = open),
    /** As listas (`role=listbox`) abertas: `true` é a lista de sugestões de um editor (dentro de um `.cm-tooltip`), `false`, a de outro lugar (um seletor, a lista de conexões). */
    setLists: (lists: boolean[]) => void (state.lists = lists),
    /** O foco vai a este elemento (ou ao corpo, com `null`), como se a pessoa o tivesse levado. */
    focus: (el: FakeElement | null) => {
      if (el === null) state.active = null;
      else el.focus();
    },
    /** O elemento focado agora (o corpo, sem nenhum). */
    active: () => state.active ?? body,
    /** Uma tecla na janela, depois da bolha do `document`: devolve o evento, para a prova ler o `preventDefault`. */
    key: (event: Record<string, unknown>) => fire("window", "keydown", { key: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, target: state.active ?? body, ...event }),
    listenerCount: (host: "window" | "document", type: string) => (host === "window" ? (listeners.window.get(type)?.size ?? 0) : (listeners.document.get(type)?.size ?? 0)),
    capturing: (type: string) => [...(listeners.document.get(type) ?? [])].every((entry) => entry.capture),
  };
}
