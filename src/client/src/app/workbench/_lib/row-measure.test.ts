import { readdirSync, readFileSync } from "node:fs";

import { measureElement, observeElementOffset, Virtualizer } from "@tanstack/react-virtual";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { measureRendered, observeRenderedOffset } from "./row-measure";

const rowHeight = 30;
const upTo = (last: number) => Array.from({ length: last + 1 }, (_, index) => index);

/**
 * A lista virtual do navegador sem navegador: o `Virtualizer` de verdade, com o que o React e o Chromium fazem com ele quando o contêiner é
 * escondido por `display: none` e volta (a área de trabalho por baixo de outra tela), na ordem em que fazem. Escondida, o `ResizeObserver`
 * avisa caixa ZERO de cada linha desenhada e do contêiner; de volta, as linhas montam (o `ref` mede sem o observador) e o observador avisa a
 * caixa de verdade. `scrolledTo` é a rolagem do DOM: o conteúdo que cabe na janela não rola, e o Chromium não avisa de rolagem nenhuma.
 */
function mountList(count: number, viewport: number, measure: typeof measureElement) {
  const scrollElement = {} as Element;
  const dom = { scrollTop: 0, shown: false };
  let reportRect = (rect: { width: number; height: number }): void => void rect;
  let reportScroll = (offset: number, isScrolling: boolean): void => void [offset, isScrolling];

  const virtualizer = new Virtualizer<Element, Element>({
    count,
    estimateSize: () => rowHeight,
    overscan: 12,
    measureElement: measure,
    getScrollElement: () => scrollElement,
    observeElementRect: (_, report) => void (reportRect = report),
    observeElementOffset: (_, report) => void (reportScroll = report),
    // O Chromium prende a rolagem ao que há para rolar, e só avisa quando ela muda de fato.
    scrollToFn: (offset, { adjustments = 0 }, instance) => {
      const next = Math.max(0, Math.min(offset + adjustments, instance.getTotalSize() - viewport));
      if (next === dom.scrollTop) return;
      dom.scrollTop = next;
      reportScroll(next, false);
    },
    // A renderização do React: lê as linhas a desenhar.
    onChange: (instance) => void instance.getVirtualItems(),
  });
  virtualizer._willUpdate();

  const drawn = () => virtualizer.getVirtualItems().map((item) => item.index);
  const row = (index: number) => ({ getAttribute: () => String(index), offsetHeight: dom.shown ? rowHeight : 0 }) as unknown as Element;
  const box = () => ({ borderBoxSize: [{ blockSize: dom.shown ? rowHeight : 0, inlineSize: dom.shown ? 320 : 0 }] }) as unknown as ResizeObserverEntry;
  /** O que a lista faz com a medida de cada linha: a do `ref` (sem `entry`) e a do `ResizeObserver`. */
  const measureRows = (rows: number[], entry?: ResizeObserverEntry) => {
    for (const index of rows) virtualizer.resizeItem(index, virtualizer.options.measureElement(row(index), entry, virtualizer));
  };

  return {
    virtualizer,
    dom,
    drawn,
    show() {
      dom.shown = true;
      reportRect({ width: 320, height: viewport });
      measureRows(drawn());
      measureRows(drawn(), box());
    },
    hide() {
      const rows = drawn();
      dom.shown = false;
      measureRows(rows, box());
      reportRect({ width: 0, height: 0 });
    },
    scrollTo(offset: number) {
      dom.scrollTop = offset;
      reportScroll(offset, false);
    },
  };
}

describe("a lista virtual que mede as linhas, escondida por `display: none` e mostrada de novo (E2: o navegador perdia as primeiras linhas)", () => {
  it("17 linhas que cabem sem rolar: de volta, desenha as mesmas 17, do começo, e a rolagem que o virtualizador guarda continua a do DOM", () => {
    const tree = mountList(17, 747, measureRendered);
    tree.show();
    expect(tree.drawn()).toEqual(upTo(16));

    tree.hide();
    expect(tree.drawn()).toEqual([]);

    tree.show();

    expect(tree.drawn()).toEqual(upTo(16));
    expect(tree.virtualizer.scrollOffset).toBe(0);
    expect(tree.dom.scrollTop).toBe(0);
    expect(tree.virtualizer.getTotalSize()).toBe(17 * rowHeight);
  });

  it("várias idas e voltas seguidas (Configurações, Conexões, Drivers) deixam a lista como estava", () => {
    const tree = mountList(16, 747, measureRendered);
    tree.show();
    for (let trip = 0; trip < 3; trip++) {
      tree.hide();
      tree.show();
    }

    expect(tree.drawn()).toEqual(upTo(15));
    expect(tree.virtualizer.scrollOffset).toBe(0);
  });

  it("40 linhas, rolada: de volta, a rolagem fica onde estava e as linhas à vista estão desenhadas", () => {
    const tree = mountList(40, 747, measureRendered);
    tree.show();
    tree.scrollTo(210);
    const before = tree.drawn();

    tree.hide();
    tree.show();

    expect(tree.dom.scrollTop).toBe(210);
    expect(tree.virtualizer.scrollOffset).toBe(210);
    expect(tree.drawn()).toEqual(before);
    // À vista ficam as linhas 7 a 31 (de 210 px a 957 px).
    expect(before).toEqual(expect.arrayContaining([7, 31]));
  });

  it("a causa: com a medida padrão da biblioteca a linha escondida fica com altura ZERO; de volta, cada linha que 'cresce' de 0 a 30 px empurra a rolagem que o virtualizador guarda, o Chromium não rola o que cabe na janela, e a faixa visível passa a ser a do fim da lista", () => {
    const tree = mountList(17, 747, measureElement);
    tree.show();
    tree.hide();

    // Escondida: zero para as 17.
    expect([...tree.virtualizer.itemSizeCache.values()]).toEqual(Array<number>(17).fill(0));

    tree.show();

    // De volta: o DOM segue no topo, o virtualizador acha que rolou a lista inteira (17 x 30), e desenha a última linha e as 12 de folga antes dela.
    expect(tree.dom.scrollTop).toBe(0);
    expect(tree.virtualizer.scrollOffset).toBe(17 * rowHeight);
    expect(tree.drawn()).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});

describe("measureRendered: zero não é altura de linha, é a linha sem caixa", () => {
  const mounted = () => {
    const virtualizer = new Virtualizer<Element, Element>({ count: 3, estimateSize: () => rowHeight, getScrollElement: () => null, observeElementRect: () => {}, observeElementOffset: () => {}, scrollToFn: () => {} });
    virtualizer.getTotalSize();
    return virtualizer;
  };
  const row = (index: number, offsetHeight: number) => ({ getAttribute: () => String(index), offsetHeight }) as unknown as Element;
  const box = (blockSize: number) => ({ borderBoxSize: [{ blockSize, inlineSize: blockSize === 0 ? 0 : 320 }] }) as unknown as ResizeObserverEntry;

  it("a linha com caixa é medida de verdade: a de erro, mais alta que as outras, tem a altura que o observador diz", () => {
    expect(measureRendered(row(1, 74), box(74), mounted())).toBe(74);
    expect(measureRendered(row(1, 74), box(73.6), mounted())).toBe(74);
  });

  it("a linha sem caixa que nunca foi medida fica com a altura estimada", () => {
    expect(measureRendered(row(1, 0), box(0), mounted())).toBe(rowHeight);
  });

  it("a linha sem caixa que já foi medida fica com a medida que tinha", () => {
    const virtualizer = mounted();
    virtualizer.resizeItem(1, 74);

    expect(measureRendered(row(1, 0), box(0), virtualizer)).toBe(74);
  });

  it("vale também para a medida do `ref`, sem o observador: a linha que monta com o contêiner já escondido não mede zero", () => {
    expect(measureRendered(row(2, 0), undefined, mounted())).toBe(rowHeight);
    expect(measureRendered(row(2, 74), undefined, mounted())).toBe(74);
  });
});

/**
 * Uma lista virtual ROLÁVEL com o contêiner de mentira que faz o que o Chromium faz com um elemento escondido por `display: none`: sem caixa, a
 * área de dentro mede 0x0 e `scrollTop` e `scrollLeft` leem 0; quando a caixa volta, a rolagem volta ao valor de antes SEM evento de rolagem. A
 * observação da rolagem é a da biblioteca, de verdade (o ouvinte de `scroll` e a releitura que ela faz 150 ms depois do último evento, com os
 * temporizadores do vitest), embrulhada ou não por `observe`.
 */
function mountScroller({ count, size, viewport, horizontal = false, observe }: { count: number; size: number; viewport: number; horizontal?: boolean; observe: typeof observeElementOffset }) {
  const scrollListeners = new Set<() => void>();
  const dom = { offset: 0, shown: true, collapsed: false };
  // Recolhida (a área de resultado com altura zero), a lista continua com caixa: tem largura, e a rolagem dela se lê.
  const box = () => (horizontal ? { width: viewport, height: 400 } : { width: 320, height: dom.collapsed ? 0 : viewport });
  const element = {
    get scrollTop() {
      return dom.shown && !horizontal ? dom.offset : 0;
    },
    get scrollLeft() {
      return dom.shown && horizontal ? dom.offset : 0;
    },
    get clientHeight() {
      return dom.shown ? box().height : 0;
    },
    get clientWidth() {
      return dom.shown ? box().width : 0;
    },
    addEventListener: (type: string, listener: () => void) => void (type === "scroll" && scrollListeners.add(listener)),
    removeEventListener: (type: string, listener: () => void) => void (type === "scroll" && scrollListeners.delete(listener)),
    ownerDocument: { defaultView: globalThis },
  } as unknown as Element;
  let reportRect = (rect: { width: number; height: number }): void => void rect;

  const virtualizer = new Virtualizer<Element, Element>({
    count,
    horizontal,
    estimateSize: () => size,
    overscan: 6,
    getScrollElement: () => element,
    observeElementRect: (_, report) => void (reportRect = report),
    observeElementOffset: observe,
    scrollToFn: () => {},
    onChange: (instance) => void instance.getVirtualItems(),
  });
  virtualizer._willUpdate();
  reportRect(box());

  const emitScroll = () => {
    for (const listener of scrollListeners) listener();
  };

  return {
    virtualizer,
    drawn: () => virtualizer.getVirtualItems().map((item) => item.index),
    /** A pessoa rola: o DOM muda de lugar e o evento de rolagem sai. */
    scrollTo(offset: number) {
      dom.offset = offset;
      emitScroll();
    },
    hide() {
      dom.shown = false;
      reportRect({ width: 0, height: 0 });
    },
    show() {
      dom.shown = true;
      reportRect(box());
    },
    /** A área de resultado recolhida: altura zero, mas com caixa. */
    collapse() {
      dom.collapsed = true;
      reportRect(box());
    },
    /** Um evento de rolagem que só é entregue com o contêiner já escondido (estava na fila do navegador). */
    lateScrollEvent: emitScroll,
  };
}

describe("a lista virtual rolada e escondida logo depois: a rolagem lida sem caixa não é posição de rolagem (rodada 1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each([30, 100])("200 linhas roladas a 2400 e escondidas %d ms depois do último evento: de volta, a rolagem guardada é a do DOM e as linhas à vista estão desenhadas", (delay) => {
    const grid = mountScroller({ count: 200, size: 32, viewport: 747, observe: observeRenderedOffset });
    grid.scrollTo(2400);
    vi.advanceTimersByTime(delay);

    grid.hide();
    // Escondida por bem mais que os 150 ms em que a biblioteca relê a rolagem.
    vi.advanceTimersByTime(1000);
    grid.show();

    expect(grid.virtualizer.scrollOffset).toBe(2400);
    expect(grid.virtualizer.isScrolling).toBe(false);
    // À vista ficam as linhas 75 a 98 (de 2400 px a 3147 px, 32 px cada).
    expect(grid.drawn()).toEqual(expect.arrayContaining([75, 86, 98]));
    expect(grid.drawn()[0]).toBeGreaterThan(60);
  });

  it("vale para a outra direção (as colunas da grade): `scrollLeft` lido sem caixa também não é posição", () => {
    const columns = mountScroller({ count: 60, size: 120, viewport: 900, horizontal: true, observe: observeRenderedOffset });
    columns.scrollTo(3600);
    vi.advanceTimersByTime(30);

    columns.hide();
    vi.advanceTimersByTime(1000);
    columns.show();

    expect(columns.virtualizer.scrollOffset).toBe(3600);
    // À vista ficam as colunas 30 a 37 (de 3600 px a 4500 px, 120 px cada).
    expect(columns.drawn()).toEqual(expect.arrayContaining([30, 37]));
    expect(columns.drawn()[0]).toBeGreaterThan(20);
  });

  it("o evento de rolagem que só chega com a lista já escondida também não muda a rolagem guardada", () => {
    const tree = mountScroller({ count: 85, size: 30, viewport: 747, observe: observeRenderedOffset });
    tree.scrollTo(1200);
    vi.advanceTimersByTime(500);

    tree.hide();
    tree.lateScrollEvent();
    vi.advanceTimersByTime(1000);
    tree.show();

    expect(tree.virtualizer.scrollOffset).toBe(1200);
    expect(tree.virtualizer.isScrolling).toBe(false);
    expect(tree.drawn()).toEqual(expect.arrayContaining([40, 64]));
  });

  it("com caixa, nada muda: cada evento de rolagem é a posição nova, e 150 ms depois do último a rolagem acabou", () => {
    const grid = mountScroller({ count: 200, size: 32, viewport: 747, observe: observeRenderedOffset });

    grid.scrollTo(640);
    expect(grid.virtualizer.scrollOffset).toBe(640);
    expect(grid.virtualizer.isScrolling).toBe(true);

    grid.scrollTo(1280);
    vi.advanceTimersByTime(149);
    expect(grid.virtualizer.isScrolling).toBe(true);
    vi.advanceTimersByTime(2);

    expect(grid.virtualizer.scrollOffset).toBe(1280);
    expect(grid.virtualizer.isScrolling).toBe(false);
    expect(grid.drawn()).toEqual(expect.arrayContaining([40, 63]));
  });

  it("sem caixa é sem altura E sem largura: a lista recolhida (altura zero, a área de resultado fechada) ainda tem caixa, e a rolagem dela vale", () => {
    const grid = mountScroller({ count: 200, size: 32, viewport: 747, observe: observeRenderedOffset });
    grid.collapse();

    grid.scrollTo(640);
    vi.advanceTimersByTime(200);

    expect(grid.virtualizer.scrollOffset).toBe(640);
  });

  it("escondida sem ter rolado e mostrada de novo, continua no topo; e rolar depois de voltar funciona como antes", () => {
    const grid = mountScroller({ count: 200, size: 32, viewport: 747, observe: observeRenderedOffset });

    grid.hide();
    vi.advanceTimersByTime(1000);
    grid.show();
    expect(grid.virtualizer.scrollOffset ?? 0).toBe(0);
    expect(grid.drawn()[0]).toBe(0);

    grid.scrollTo(3200);
    vi.advanceTimersByTime(200);
    expect(grid.virtualizer.scrollOffset).toBe(3200);
    expect(grid.drawn()).toEqual(expect.arrayContaining([100, 123]));
  });

  it("a causa: com a observação padrão da biblioteca, a releitura de 150 ms depois do último evento acontece com a lista sem caixa, lê 0 e guarda 0; de volta, o DOM está em 2400 e as linhas desenhadas são as do topo (a lista fica em branco)", () => {
    const grid = mountScroller({ count: 200, size: 32, viewport: 747, observe: observeElementOffset });
    grid.scrollTo(2400);
    vi.advanceTimersByTime(30);

    grid.hide();
    vi.advanceTimersByTime(1000);
    grid.show();

    expect(grid.virtualizer.scrollOffset).toBe(0);
    expect(grid.drawn()[0]).toBe(0);
    expect(grid.drawn()).not.toContain(75);
  });
});

describe("a regra que evita repetir o E2", () => {
  /** Os componentes de `src/`: é onde uma lista virtual pode existir. */
  function componentFiles(directory: URL): URL[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (entry.isDirectory()) return componentFiles(new URL(`${entry.name}/`, directory));
      return entry.name.endsWith(".tsx") ? [new URL(entry.name, directory)] : [];
    });
  }

  const components = () => componentFiles(new URL("../../../", import.meta.url)).map((file) => ({ file: file.pathname.split("/src/").at(-1) ?? "", source: readFileSync(file, "utf8") }));

  it("toda lista virtual que mede as linhas (entrega `measureElement` do virtualizador a uma linha, de qualquer jeito) passa `measureElement: measureRendered` ao virtualizador", () => {
    const measuring = components().filter(({ source }) => measuresRows(source));

    expect(measuring.map(({ file }) => file)).toContain("app/workbench/_components/navigator.tsx");
    expect(measuring.filter(({ source }) => !/measureElement: measureRendered\b/.test(source)).map(({ file }) => file)).toEqual([]);
  });

  it("a regra enxerga todas as formas de medir: a referência direta, a função em volta dela e a desestruturação; passar a opção, ou citar o nome num comentário, não é medir", () => {
    expect(measuresRows("<div ref={virtualizer.measureElement} data-index={item.index} />")).toBe(true);
    // A forma que passava: a função em volta. É a mesma medida, com o mesmo zero.
    expect(measuresRows("<div ref={(element) => virtualizer.measureElement(element)} />")).toBe(true);
    expect(measuresRows("<div\n  ref={(element) => {\n    rows.measureElement(element);\n  }}\n/>")).toBe(true);
    expect(measuresRows("const measure = rowVirtualizer.measureElement;")).toBe(true);
    expect(measuresRows("const { getVirtualItems, measureElement } = virtualizer;")).toBe(true);

    expect(measuresRows("const virtualizer = useVirtualizer({ count, measureElement: measureRendered });")).toBe(false);
    expect(measuresRows("// As linhas não são medidas: não há `measureElement` aqui.")).toBe(false);
    expect(measuresRows('import { measureElement } from "@tanstack/react-virtual";')).toBe(false);
  });

  it("todo virtualizador (`useVirtualizer(…)`) observa a rolagem por `observeRenderedOffset`: a árvore e as duas direções da grade", () => {
    const calls = components().flatMap(({ file, source }) => virtualizerCalls(source).map((call) => ({ file, call })));

    expect(calls.map(({ file }) => file).sort()).toEqual(["app/workbench/_components/navigator.tsx", "app/workbench/_components/result-grid.tsx", "app/workbench/_components/result-grid.tsx"]);
    expect(calls.filter(({ call }) => !/observeElementOffset: observeRenderedOffset\b/.test(call))).toEqual([]);
  });

  it("a regra enxerga cada chamada inteira, com o que ela passa, e não confunde o `import` com uma chamada", () => {
    const source = ['import { useVirtualizer } from "@tanstack/react-virtual";', "const rows = useVirtualizer({ count: f(a, (b)), estimateSize: () => 32 });", "const columns = useVirtualizer({\n  horizontal: true,\n  observeElementOffset: observeRenderedOffset,\n});"].join("\n");

    expect(virtualizerCalls(source)).toEqual(["{ count: f(a, (b)), estimateSize: () => 32 }", "{\n  horizontal: true,\n  observeElementOffset: observeRenderedOffset,\n}"]);
  });
});

/**
 * O arquivo mede as linhas de uma lista virtual? Mede quem tira `measureElement` de um virtualizador, de qualquer jeito: pelo ponto (`v.measureElement`, direto
 * no `ref` ou dentro de uma função em volta) ou desestruturando (`const { measureElement } = v`). Passar a opção (`measureElement: …`), importar a função da
 * biblioteca e citar o nome num comentário não são medir.
 */
function measuresRows(source: string): boolean {
  return /\.measureElement\b/.test(source) || /\{[^{}]*\bmeasureElement\b[^{}]*\}\s*=[^=>]/.test(source);
}

/** O que cada `useVirtualizer(…)` de um arquivo recebe: o texto entre o parêntese que abre a chamada e o que a fecha. */
function virtualizerCalls(source: string): string[] {
  const calls: string[] = [];
  const opening = "useVirtualizer(";

  for (let at = source.indexOf(opening); at >= 0; at = source.indexOf(opening, at + 1)) {
    const start = at + opening.length;
    let depth = 1;
    let end = start;
    while (end < source.length && depth > 0) {
      if (source[end] === "(") depth++;
      else if (source[end] === ")") depth--;
      end++;
    }
    calls.push(source.slice(start, end - 1));
  }
  return calls;
}
