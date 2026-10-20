/**
 * A página em branco da janela do resultado (RN-ABAS-017): o que a tela da aba põe nela antes de desenhar a área de resultado, e o que mantém igual ao da página
 * dela depois. Só DOM, sem React, com o que muda de uma janela para outra (o `MutationObserver`, que é da janela de quem observa) injetado: é o que os testes
 * conferem.
 *
 * - **A política de conteúdo e o endereço base vêm primeiro**: uma cópia da `<meta http-equiv="Content-Security-Policy">` e um `<base href>` com o endereço da
 *   página da aba (sem ele, os `url()` relativos das folhas copiadas, como os `url(/…)` do Vite em desenvolvimento, não acham as fontes). A janela do resultado
 *   não carrega nada que a da aba não carregue.
 * - **Os estilos**: as `<link>` pelo endereço, as `<style>` pelo texto (uma folha construída não serve a dois documentos, então as de `adoptedStyleSheets`
 *   viram `<style>` com as regras), e a língua, o tema e o `style` da raiz (as variáveis das fontes), que um observador acompanha, com as `<style>` e `<link>` que
 *   entram e saem da `<head>` da aba (no desenvolvimento, o Vite as troca a cada mudança do código).
 * - **A raiz**: um `<main>` com o nome "Resultado de …", onde a área de resultado se põe.
 */

/** O que o observador de mudanças entrega: o que mudou na página da aba. */
export type PageObserver = (target: Node, options: MutationObserverInit, onChange: () => void) => () => void;

/** Os ouvintes de página, na janela dela: o `addEventListener` do documento. */
type PageEvents = Pick<Document, "addEventListener" | "removeEventListener">;

export type ResultPage = {
  /** O ponto de referência principal (`main`) da página: onde a área de resultado se põe. */
  root: HTMLElement;
  /** Para de acompanhar a página da aba. */
  stop: () => void;
};

const securityPolicy = 'meta[http-equiv="Content-Security-Policy"]';
const rootAttributes = ["lang", "data-theme", "style", "class"] as const;

/** As regras de uma folha construída, como o texto de uma `<style>`; a folha que não se deixa ler (de outra origem) fica de fora. */
function rulesText(sheet: CSSStyleSheet): string {
  try {
    return [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
  } catch {
    return "";
  }
}

/** Uma cópia do elemento de estilo da página da aba, na página nova: a `<link>` pelo endereço e a `<style>` pelo texto. `null` se não é um dos dois. */
function cloneStyle(source: Element, page: Document): HTMLElement | null {
  const tag = source.tagName.toLowerCase();
  if (tag === "style") {
    const style = page.createElement("style");
    style.textContent = source.textContent;
    const media = source.getAttribute("media");
    if (media !== null) style.setAttribute("media", media);
    return style;
  }
  if (tag === "link" && source.getAttribute("rel")?.toLowerCase() === "stylesheet") {
    const link = page.createElement("link");
    link.setAttribute("rel", "stylesheet");
    // O endereço inteiro (`href` do elemento, já resolvido pela página da aba), e não o texto relativo do atributo.
    link.setAttribute("href", (source as HTMLLinkElement).href ?? source.getAttribute("href") ?? "");
    const media = source.getAttribute("media");
    if (media !== null) link.setAttribute("media", media);
    return link;
  }
  return null;
}

export function prepareResultPage({ page, source, label, observe }: { page: Document; source: Document; label: string; observe: PageObserver }): ResultPage {
  const head = page.head;

  // A política de conteúdo e o endereço base, antes de qualquer outra coisa.
  const policy = source.querySelector(securityPolicy);
  if (policy !== null) {
    const meta = page.createElement("meta");
    meta.setAttribute("http-equiv", "Content-Security-Policy");
    meta.setAttribute("content", policy.getAttribute("content") ?? "");
    head.append(meta);
  }
  const base = page.createElement("base");
  base.setAttribute("href", source.baseURI);
  head.append(base);
  const charset = page.createElement("meta");
  charset.setAttribute("charset", "utf-8");
  head.append(charset);

  // A língua, o tema e as variáveis da raiz, e o que mais ela leva (o `class`).
  const copyRoot = () => {
    for (const name of rootAttributes) {
      const value = source.documentElement.getAttribute(name);
      if (value === null) page.documentElement.removeAttribute(name);
      else page.documentElement.setAttribute(name, value);
    }
    page.body.className = source.body.className;
  };
  copyRoot();

  // As folhas de estilo da página da aba, e as que entram e saem dela.
  const copies = new Map<Element, HTMLElement>();
  const adopted: HTMLElement[] = [];
  const copyStyles = () => {
    for (const [original, copy] of [...copies]) {
      if (original.isConnected) continue;
      copy.remove();
      copies.delete(original);
    }
    for (const original of source.head.children) {
      const known = copies.get(original);
      if (known !== undefined) {
        if (original.tagName.toLowerCase() === "style" && known.textContent !== original.textContent) known.textContent = original.textContent;
        continue;
      }
      const copy = cloneStyle(original, page);
      if (copy === null) continue;
      copies.set(original, copy);
      head.append(copy);
    }
    for (const style of adopted.splice(0)) style.remove();
    for (const sheet of source.adoptedStyleSheets ?? []) {
      const text = rulesText(sheet);
      if (text === "") continue;
      const style = page.createElement("style");
      style.textContent = text;
      adopted.push(style);
      head.append(style);
    }
  };
  copyStyles();

  const root = page.createElement("main");
  root.setAttribute("aria-label", label);
  root.className = "flex h-full min-h-0 min-w-0 flex-col";
  page.body.replaceChildren(root);

  const stops = [guardPage(page), observe(source.documentElement, { attributes: true, attributeFilter: [...rootAttributes] }, copyRoot), observe(source.body, { attributes: true, attributeFilter: ["class"] }, copyRoot), observe(source.head, { childList: true, subtree: true, characterData: true }, copyStyles)];
  return {
    root,
    stop() {
      for (const stop of stops) stop();
    },
  };
}

/**
 * Nada navega a janela do resultado (RN-SHELL-001 e RN-ABAS-017): um link (`<a href>`) que a tela não tratou (o `Link` do roteador chama `preventDefault` e navega
 * o roteador da janela da aba) não faz nada, e um arquivo solto sobre ela não é aberto no lugar da página. O que o processo principal nega por cima disso
 * (a navegação) já está negado; aqui a página nem tenta.
 */
export function guardPage(page: PageEvents): () => void {
  const onLink = (event: Event) => {
    const target = event.target as Node | null;
    const element = target === null ? null : target.nodeType === 1 ? (target as Element) : target.parentElement;
    if (element?.closest("a[href]") != null && !event.defaultPrevented) event.preventDefault();
  };
  const onFileDrop = (event: Event) => {
    if ((event as DragEvent).dataTransfer?.types.includes("Files") === true) event.preventDefault();
  };
  page.addEventListener("click", onLink);
  page.addEventListener("auxclick", onLink);
  page.addEventListener("dragover", onFileDrop);
  page.addEventListener("drop", onFileDrop);
  return () => {
    page.removeEventListener("click", onLink);
    page.removeEventListener("auxclick", onLink);
    page.removeEventListener("dragover", onFileDrop);
    page.removeEventListener("drop", onFileDrop);
  };
}

/** O observador de verdade: o `MutationObserver` da janela da página observada. */
export const observePage: PageObserver = (target, options, onChange) => {
  const Observer = (target.ownerDocument ?? (target as Document)).defaultView?.MutationObserver ?? MutationObserver;
  const observer = new Observer(onChange);
  observer.observe(target, options);
  return () => observer.disconnect();
};
