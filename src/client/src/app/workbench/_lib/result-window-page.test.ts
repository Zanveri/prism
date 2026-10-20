import { describe, expect, it, vi } from "vitest";

import { guardPage, prepareResultPage, type PageObserver } from "./result-window-page";

/** Um DOM de mentira, só com o que a preparação da página usa (o vitest deste projeto não tem DOM). */
class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  textContent = "";
  className = "";
  isConnected = true;
  href = "";
  constructor(
    readonly tagName: string,
    readonly ownerDocument: FakeDocument | null = null,
  ) {}
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name === "class") this.className = value;
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  append(...nodes: FakeElement[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes: FakeElement[]) {
    this.children.length = 0;
    this.append(...nodes);
  }
  remove() {
    this.isConnected = false;
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
}

class FakeDocument {
  readonly head = new FakeElement("HEAD", this);
  readonly body = new FakeElement("BODY", this);
  readonly documentElement = new FakeElement("HTML", this);
  baseURI = "app://prism/index.html";
  adoptedStyleSheets: { cssRules: { cssText: string }[] }[] = [];
  addEventListener() {}
  removeEventListener() {}
  createElement(tag: string) {
    return new FakeElement(tag.toUpperCase(), this);
  }
  querySelector(selector: string) {
    return selector.includes("Content-Security-Policy") ? (this.head.children.find((child) => child.getAttribute("http-equiv") === "Content-Security-Policy") ?? null) : null;
  }
}

/** Um observador que guarda o que lhe pediram e o dispara à mão. */
function observer() {
  const watching: { target: unknown; options: unknown; onChange: () => void; stopped: boolean }[] = [];
  const observe: PageObserver = (target, options, onChange) => {
    const watch = { target, options, onChange, stopped: false };
    watching.push(watch);
    return () => void (watch.stopped = true);
  };
  return { observe, watching, fire: () => watching.filter((watch) => !watch.stopped).forEach((watch) => watch.onChange()) };
}

function app() {
  const source = new FakeDocument();
  const csp = source.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", "default-src 'self'");
  const style = source.createElement("style");
  style.textContent = "body{color:red}";
  const link = source.createElement("link");
  link.setAttribute("rel", "stylesheet");
  link.setAttribute("href", "/assets/app.css");
  link.href = "app://prism/assets/app.css";
  const icon = source.createElement("link");
  icon.setAttribute("rel", "icon");
  source.head.append(csp, style, link, icon);
  source.documentElement.setAttribute("lang", "pt-BR");
  source.documentElement.setAttribute("data-theme", "dark");
  source.documentElement.setAttribute("style", "--font-sans: Inter");
  source.body.className = "font-body";
  return { source, style, link };
}

const prepare = (source: FakeDocument, page: FakeDocument, observe: PageObserver) => prepareResultPage({ page: page as unknown as Document, source: source as unknown as Document, label: "Resultado de consulta-2.sql", observe });

describe("a página em branco da janela do resultado (RN-ABAS-017)", () => {
  it("a política de conteúdo e o endereço base vêm primeiro, antes de qualquer estilo", () => {
    const { source } = app();
    const page = new FakeDocument();

    prepare(source, page, observer().observe);

    const tags = page.head.children.map((child) => child.tagName);
    expect(tags.slice(0, 2)).toEqual(["META", "BASE"]);
    expect(page.head.children[0].getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(page.head.children[0].getAttribute("content")).toBe("default-src 'self'");
    expect(page.head.children[1].getAttribute("href")).toBe("app://prism/index.html");
    expect(tags.indexOf("STYLE")).toBeGreaterThan(1);
    expect(tags.indexOf("LINK")).toBeGreaterThan(1);
  });

  it("copia as folhas de estilo (a <link> pelo endereço inteiro, a <style> pelo texto) e nada mais da <head>", () => {
    const { source } = app();
    const page = new FakeDocument();

    prepare(source, page, observer().observe);

    const style = page.head.children.find((child) => child.tagName === "STYLE");
    const link = page.head.children.find((child) => child.tagName === "LINK");
    expect(style?.textContent).toBe("body{color:red}");
    expect(link?.getAttribute("href")).toBe("app://prism/assets/app.css");
    expect(page.head.children.filter((child) => child.tagName === "LINK")).toHaveLength(1);
  });

  it("a folha construída (uma por documento) vira <style> com as regras", () => {
    const { source } = app();
    source.adoptedStyleSheets = [{ cssRules: [{ cssText: "a{color:blue}" }, { cssText: "b{color:green}" }] }];
    const page = new FakeDocument();

    prepare(source, page, observer().observe);

    expect(page.head.children.some((child) => child.tagName === "STYLE" && child.textContent === "a{color:blue}\nb{color:green}")).toBe(true);
  });

  it("a língua, o tema e as variáveis da raiz, e a classe do corpo, vão para a página; o que sai da raiz da aba sai de lá", () => {
    const { source } = app();
    const page = new FakeDocument();
    const { observe, fire } = observer();

    prepare(source, page, observe);
    expect(page.documentElement.getAttribute("lang")).toBe("pt-BR");
    expect(page.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(page.documentElement.getAttribute("style")).toBe("--font-sans: Inter");
    expect(page.body.className).toBe("font-body");

    source.documentElement.setAttribute("data-theme", "light");
    source.documentElement.removeAttribute("style");
    fire();
    expect(page.documentElement.getAttribute("data-theme")).toBe("light");
    expect(page.documentElement.getAttribute("style")).toBeNull();
  });

  it("acompanha as folhas que entram, mudam e saem da <head> da aba (o Vite as troca a cada mudança do código)", () => {
    const { source, style, link } = app();
    const page = new FakeDocument();
    const { observe, fire } = observer();

    prepare(source, page, observe);
    const styles = () => page.head.children.filter((child) => child.tagName === "STYLE");

    style.textContent = "body{color:blue}";
    fire();
    expect(styles().map((copy) => copy.textContent)).toEqual(["body{color:blue}"]);

    const added = source.createElement("style");
    added.textContent = "i{font-style:italic}";
    source.head.append(added);
    fire();
    expect(styles().map((copy) => copy.textContent)).toEqual(["body{color:blue}", "i{font-style:italic}"]);

    style.remove();
    link.remove();
    fire();
    expect(styles().map((copy) => copy.textContent)).toEqual(["i{font-style:italic}"]);
    expect(page.head.children.some((child) => child.tagName === "LINK")).toBe(false);
  });

  it("a raiz é o ponto de referência principal, com o nome dado, e é a única coisa do corpo", () => {
    const { source } = app();
    const page = new FakeDocument();

    const { root } = prepare(source, page, observer().observe);

    expect(root.tagName).toBe("MAIN");
    expect(root.getAttribute("aria-label")).toBe("Resultado de consulta-2.sql");
    expect(page.body.children).toEqual([root]);
  });

  it("`stop` para de acompanhar a página da aba", () => {
    const { source } = app();
    const page = new FakeDocument();
    const { observe, watching } = observer();

    const { stop } = prepare(source, page, observe);
    expect(watching.length).toBeGreaterThan(0);
    stop();

    expect(watching.every((watch) => watch.stopped)).toBe(true);
  });
});

describe("a página não navega (RN-SHELL-001 e RN-ABAS-017)", () => {
  function pageEvents() {
    const handlers = new Map<string, (event: Event) => void>();
    const target = {
      addEventListener: (type: string, listener: (event: Event) => void) => void handlers.set(type, listener),
      removeEventListener: (type: string) => void handlers.delete(type),
    } as unknown as Document;
    const fire = (type: string, event: object) => handlers.get(type)?.(event as Event);
    return { target, fire, handlers };
  }
  const click = (anchor: boolean, defaultPrevented = false) => ({ target: { nodeType: 1, closest: (selector: string) => (anchor && selector === "a[href]" ? {} : null) }, defaultPrevented, preventDefault: vi.fn() });

  it("um link que a tela não tratou não faz nada; o que o roteador tratou (`preventDefault`) não é cancelado de novo; o que não é link passa", () => {
    const { target, fire } = pageEvents();
    guardPage(target);

    const untreated = click(true);
    fire("click", untreated);
    expect(untreated.preventDefault).toHaveBeenCalledTimes(1);

    const treated = click(true, true);
    fire("click", treated);
    expect(treated.preventDefault).not.toHaveBeenCalled();

    const plain = click(false);
    fire("click", plain);
    expect(plain.preventDefault).not.toHaveBeenCalled();

    const middle = click(true);
    fire("auxclick", middle);
    expect(middle.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("um arquivo solto sobre a janela não é aberto no lugar da página; texto solto segue", () => {
    const { target, fire } = pageEvents();
    guardPage(target);

    const file = { dataTransfer: { types: ["Files"] }, preventDefault: vi.fn() };
    fire("drop", file);
    fire("dragover", file);
    expect(file.preventDefault).toHaveBeenCalledTimes(2);

    const text = { dataTransfer: { types: ["text/plain"] }, preventDefault: vi.fn() };
    fire("drop", text);
    expect(text.preventDefault).not.toHaveBeenCalled();
  });

  it("solta os ouvintes", () => {
    const { target, handlers } = pageEvents();

    guardPage(target)();

    expect(handlers.size).toBe(0);
  });
});
