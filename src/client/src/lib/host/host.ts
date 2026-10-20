/**
 * Em que janela está o que a tela desenha (seção 39: RN-ABAS-015 e 017). A área de resultado de uma aba pode estar na página da janela da aba ou na página em
 * branco de uma janela do resultado, e é a MESMA árvore do React nos dois casos: o `document` e o `window` globais são os da janela da aba, e o que está na
 * outra página tem de usar o documento e a janela de onde está. Este módulo é o lugar disso, sem React:
 *
 * - `Host` é uma página (o documento, a janela dele e, se é uma janela do resultado, o nome dela);
 * - quem tem um elemento acha a página dele (`hostOfNode`), e quem não tem usa a da janela que tem o foco (`focusedHost`);
 * - um elemento da outra página não é instância do `Element` desta janela: a conferência é pelo `nodeType`, e não pelo `instanceof`;
 * - a área de transferência é a da janela onde a pessoa está (`hostClipboard`).
 */

export type HostWindow = Window & typeof globalThis;

export type Host = {
  readonly document: Document;
  readonly view: HostWindow;
  /** O nome da janela do resultado (`prism-result-<id da aba>`); `null` na janela da aba. */
  readonly resultWindow: string | null;
};

const known = new WeakMap<Document, Host>();

/** A página de um documento: sempre o mesmo objeto para o mesmo documento, para os contextos e as assinaturas não mudarem à toa. */
export function hostOfDocument(page: Document, resultWindow: string | null = null): Host {
  const cached = known.get(page);
  if (cached !== undefined && (resultWindow === null || cached.resultWindow === resultWindow)) return cached;

  const host: Host = { document: page, view: (page.defaultView ?? window) as HostWindow, resultWindow };
  known.set(page, host);
  return host;
}

/** Sem página nenhuma (a renderização fora do navegador, os testes): quem desenha só passa o valor adiante, e ninguém lê o documento até haver um. */
const noPage = { document: undefined, view: undefined, resultWindow: null } as unknown as Host;

/** A página da janela da aba: a do `document` global. */
export function mainHost(): Host {
  return typeof document === "undefined" ? noPage : hostOfDocument(document);
}

/** O valor tem a forma de um nó do DOM (de qualquer janela)? */
export function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).nodeType === "number";
}

/** É um elemento (de qualquer janela)? O `instanceof Element` só vale para os da janela que o executa. */
export function isElement(value: unknown): value is Element {
  return isNode(value) && value.nodeType === 1;
}

/** É um elemento HTML (de qualquer janela), que se pode focar? */
export function isHtmlElement(value: unknown): value is HTMLElement {
  return isElement(value) && typeof (value as HTMLElement).focus === "function";
}

/** O elemento de um alvo de evento: ele mesmo, ou o pai do texto. */
export function elementOfTarget(target: EventTarget | null): Element | null {
  if (!isNode(target)) return null;
  return target.nodeType === 1 ? (target as Element) : target.parentElement;
}

/** A página de um nó; sem nó, ou com um documento que ninguém registrou, a da janela da aba. */
export function hostOfNode(node: Node | null | undefined): Host {
  const page = node === null || node === undefined ? null : node.nodeType === 9 ? (node as Document) : node.ownerDocument;
  return page === null ? mainHost() : hostOfDocument(page);
}

function isHost(value: unknown): value is Host {
  return typeof value === "object" && value !== null && "view" in value && "document" in value && !("nodeType" in value);
}

/** As páginas das janelas do resultado abertas, e quem quer saber quando entram e saem. A lista só muda de objeto quando muda de conteúdo. */
const resultHosts = new Set<Host>();
let snapshot: readonly Host[] = [];
const listeners = new Set<() => void>();
const focusListeners = new Map<Host, () => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export const resultHostRegistry = {
  /** Uma janela do resultado montou o documento dela. Os avisos de foco dela atualizam `hostFocus`. */
  add(host: Host): void {
    if (resultHosts.has(host)) return;
    resultHosts.add(host);
    snapshot = [...resultHosts];
    const onFocusChange = () => setTimeout(emit, 0);
    focusListeners.set(host, onFocusChange);
    host.view.addEventListener("focus", onFocusChange);
    host.view.addEventListener("blur", onFocusChange);
    emit();
  },
  remove(host: Host): void {
    if (!resultHosts.delete(host)) return;
    snapshot = [...resultHosts];
    const onFocusChange = focusListeners.get(host);
    if (onFocusChange !== undefined) {
      host.view.removeEventListener("focus", onFocusChange);
      host.view.removeEventListener("blur", onFocusChange);
      focusListeners.delete(host);
    }
    emit();
  },
  list(): readonly Host[] {
    return snapshot;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /** Para cada janela do resultado de agora e das que vierem; devolve a função que solta todas. `each` devolve como soltar a página. */
  each(each: (host: Host) => () => void): () => void {
    const stops = new Map<Host, () => void>();
    const sync = () => {
      for (const host of snapshot) if (!stops.has(host)) stops.set(host, each(host));
      for (const [host, stop] of [...stops]) {
        if (resultHosts.has(host)) continue;
        stop();
        stops.delete(host);
      }
    };
    const unsubscribe = resultHostRegistry.subscribe(sync);
    sync();
    return () => {
      unsubscribe();
      for (const stop of stops.values()) stop();
      stops.clear();
    };
  },
};

/** A página da janela que tem o foco, entre a da aba e as do resultado dela; sem foco em nenhuma, a da aba (RN-ABAS-015: onde os avisos e os diálogos aparecem). */
export function focusedHost(): Host {
  for (const host of resultHosts) if (host.document.hasFocus()) return host;
  return mainHost();
}

let mainFocusWired = false;

/** O foco entre as janelas, para o que acompanha a janela em que a pessoa está (a pilha dos avisos). */
export const hostFocus = {
  subscribe(listener: () => void): () => void {
    if (!mainFocusWired) {
      mainFocusWired = true;
      const onFocusChange = () => setTimeout(emit, 0);
      window.addEventListener("focus", onFocusChange);
      window.addEventListener("blur", onFocusChange);
    }
    return resultHostRegistry.subscribe(listener);
  },
  getSnapshot: focusedHost,
};

type ClipboardLike = Pick<Clipboard, "writeText" | "readText">;

/**
 * A área de transferência da janela onde a pessoa está (RN-ABAS-017): o `navigator.clipboard` da janela de `from` (um elemento, ou a página), e sem `from` o
 * da janela que tem o foco. Todas as chamadas que o resultado alcança passam por aqui: o `navigator` da janela da aba só deixa copiar quando o documento dela
 * tem o foco, e quem copia da janela do resultado está nela.
 */
export function hostClipboard(from?: Host | Node | null): ClipboardLike {
  // Sem página nenhuma (a lógica fora do navegador, nos testes): a área de transferência do ambiente.
  if (typeof document === "undefined") return navigator.clipboard;

  const host = isHost(from) ? from : from === undefined || from === null ? focusedHost() : hostOfNode(from);
  return host.view.navigator.clipboard;
}
