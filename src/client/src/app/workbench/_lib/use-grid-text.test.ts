import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O medidor da grade com os ganchos do React simulados (`createHookRuntime`: o vitest deste projeto não tem DOM) e um documento de mentira: o `canvas` que o
// `createElement` devolve, o contexto 2D dele e a lista de fontes da página. O documento que a grade usa vem de `useHost` (RN-ABAS-017: o da janela do resultado,
// quando a grade está nela).
const rt = await vi.hoisted(async () => {
  const { createHookRuntime } = await import("@/lib/testing/react-hooks");
  return createHookRuntime();
});
const host = vi.hoisted(() => ({ document: undefined as unknown }));

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), ...rt.hooks }));
vi.mock("@/components/ui/host-context", () => ({ useHost: () => ({ document: host.document }) }));

import { resolvedFontFamily } from "@/app/settings/_lib/fonts";

import { gridFonts, monoGridText } from "./grid-text";
import { gridTextFor, unloadedFonts, useGridText } from "./use-grid-text";

const family = resolvedFontFamily("ui", "IBM Plex Sans");
const fonts = gridFonts(family);

type Options = {
  /** O contexto 2D: `null` quando o `canvas` não tem. */
  context?: "ok" | "none" | "refuses-font" | "measures-zero" | "throws";
  /** `fonts.check`: o que devolve (por fonte). */
  loaded?: (font: string) => boolean;
  /** `fonts.load`: quando resolve. */
  load?: (font: string) => Promise<unknown>;
  /** Sem a lista de fontes da página. */
  noFonts?: boolean;
};

/** Um documento de mentira: um `canvas` por `createElement`, com um contexto cuja largura é 7 px por caractere e que lembra a fonte atribuída. */
function fakeDocument({ context = "ok", loaded = () => true, load = () => Promise.resolve([]), noFonts = false }: Options = {}) {
  const measured: { font: string; text: string }[] = [];
  const created: unknown[] = [];
  const makeContext = () => {
    if (context === "none") return null;
    let font = "10px sans-serif";
    return {
      get font() {
        return font;
      },
      // O `canvas` ignora em silêncio a atribuição de uma fonte que não entende: a de antes continua.
      set font(value: string) {
        if (context !== "refuses-font") font = value;
      },
      measureText(text: string) {
        measured.push({ font, text });
        return { width: context === "measures-zero" ? 0 : 7 * [...text].length };
      },
    };
  };
  const check = vi.fn(loaded);
  const loadFont = vi.fn(load);
  const page = {
    createElement: vi.fn((tag: string) => {
      if (context === "throws") throw new Error("sem canvas");
      const element = { tag, getContext: vi.fn(() => makeContext()) };
      created.push(element);
      return element;
    }),
    fonts: noFonts ? undefined : { check, load: loadFont },
  };
  return { page: page as unknown as Document, raw: page, measured, created, check, load: loadFont };
}

/** Deixa os `then` de uma promessa já resolvida rodarem. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  host.document = undefined;
});
afterEach(() => rt.unmount());

describe("gridTextFor: a medida da grade nesta página e nesta fonte", () => {
  it("sem documento (os testes, a renderização fora do navegador), a conta da mono", () => {
    expect(gridTextFor(undefined, family)).toBe(monoGridText);
  });

  it("com `canvas` e a fonte aceita, mede pelo contexto: a largura de cada caractere, na fonte da parte da grade", () => {
    const { page, measured } = fakeDocument();
    const text = gridTextFor(page, family);

    expect(text).not.toBe(monoGridText);
    expect(text.key).toBe(family);
    // 7 px por caractere, mais a folga de 1 px.
    expect(text.cell("abc")).toBe(22);
    expect(text.name("ab")).toBe(15);
    expect(text.type("a")).toBe(8);
    // Cada medida na fonte da sua parte da grade.
    expect(measured.some((entry) => entry.font === fonts.cell && entry.text === "a")).toBe(true);
    expect(measured.some((entry) => entry.font === fonts.name && entry.text === "a")).toBe(true);
    expect(measured.some((entry) => entry.font === fonts.type && entry.text === "a")).toBe(true);
  });

  it("o `canvas` é um só por documento, nunca anexado à página; outro documento (a janela do resultado) tem o dele", () => {
    const one = fakeDocument();
    const other = fakeDocument();

    gridTextFor(one.page, family);
    gridTextFor(one.page, resolvedFontFamily("ui", "Inter"));
    gridTextFor(other.page, family);

    expect(one.raw.createElement).toHaveBeenCalledExactlyOnceWith("canvas");
    expect(other.raw.createElement).toHaveBeenCalledExactlyOnceWith("canvas");
  });

  it("sem contexto 2D, ou com o `canvas` que lança, a conta da mono", () => {
    expect(gridTextFor(fakeDocument({ context: "none" }).page, family)).toBe(monoGridText);
    expect(gridTextFor(fakeDocument({ context: "throws" }).page, family)).toBe(monoGridText);
  });

  it("a fonte que o contexto recusa (a atribuição é ignorada em silêncio) cai na mono: a medida seria a de outra fonte", () => {
    expect(gridTextFor(fakeDocument({ context: "refuses-font" }).page, family)).toBe(monoGridText);
  });

  it("o `canvas` que mede o '0' como largura nenhuma (sem fonte, sem motor de texto) cai na mono", () => {
    expect(gridTextFor(fakeDocument({ context: "measures-zero" }).page, family)).toBe(monoGridText);
  });

  it("a pilha da fonte escolhida chega ao contexto sem var(), e a key muda com ela", () => {
    const { page, measured } = fakeDocument();
    const inter = gridTextFor(page, resolvedFontFamily("ui", "Inter"));

    inter.cell("a");
    expect(measured.some((entry) => entry.font === '400 13px "Inter", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif')).toBe(true);
    expect(inter.key).not.toBe(gridTextFor(page, family).key);
  });
});

describe("unloadedFonts: o que a página ainda não carregou", () => {
  it("nenhuma quando todas estão carregadas, ou quando a página não tem a lista de fontes", () => {
    expect(unloadedFonts(fakeDocument().page, family)).toEqual([]);
    expect(unloadedFonts(fakeDocument({ noFonts: true }).page, family)).toEqual([]);
    expect(unloadedFonts(undefined, family)).toEqual([]);
  });

  it("as que a conferência diz que não estão prontas, das três da grade", () => {
    const { page } = fakeDocument({ loaded: (font) => !font.startsWith("600") });

    expect(unloadedFonts(page, family)).toEqual([fonts.name]);
    expect(unloadedFonts(fakeDocument({ loaded: () => false }).page, family)).toEqual([fonts.cell, fonts.name, fonts.type]);
  });

  it("uma fonte que o CSS não entende não carrega nunca: não há o que esperar", () => {
    const { page } = fakeDocument({
      loaded: () => {
        throw new Error("SyntaxError");
      },
    });

    expect(unloadedFonts(page, family)).toEqual([]);
  });
});

describe("useGridText: a medida do texto da grade na fonte da interface (RN-CONFIG-008)", () => {
  it("sem documento, a mono", () => {
    expect(rt.render(() => useGridText("IBM Plex Sans"))).toBe(monoGridText);
  });

  it("a mesma família dá a mesma identidade, a cada renderização: a grade não calcula as larguras de novo à toa", () => {
    host.document = fakeDocument().page;

    const first = rt.render(() => useGridText("IBM Plex Sans"));
    expect(first).not.toBe(monoGridText);
    expect(rt.render(() => useGridText("IBM Plex Sans"))).toBe(first);
    expect(rt.render(() => useGridText("IBM Plex Sans"))).toBe(first);
  });

  it("trocar a fonte da interface troca a medida, e a key é a pilha da nova (nome inválido ou a fonte do app: a pilha do app)", () => {
    host.document = fakeDocument().page;

    const app = rt.render(() => useGridText("IBM Plex Sans"));
    const inter = rt.render(() => useGridText("Inter"));

    expect(inter).not.toBe(app);
    expect(inter.key).toBe(resolvedFontFamily("ui", "Inter"));
    expect(rt.render(() => useGridText('Arial", x'))).not.toBe(inter);
    expect(rt.render(() => useGridText('Arial", x')).key).toBe(app.key);
  });

  it("a grade vai para a janela do resultado: outro documento, outra medida", () => {
    host.document = fakeDocument().page;
    const here = rt.render(() => useGridText("IBM Plex Sans"));

    host.document = fakeDocument().page;
    expect(rt.render(() => useGridText("IBM Plex Sans"))).not.toBe(here);
  });

  it("com as fontes carregadas, não pede nenhuma", async () => {
    const { page, load } = fakeDocument();
    host.document = page;

    rt.render(() => useGridText("IBM Plex Sans"));
    await settle();

    expect(load).not.toHaveBeenCalled();
  });

  it("com a fonte ainda por carregar, devolve a medida possível, pede a fonte e, quando ela chega, troca a medida (uma vez)", async () => {
    let ready = false;
    const { page, load, check } = fakeDocument({
      loaded: () => ready,
      load: async () => {
        ready = true;
        return [];
      },
    });
    host.document = page;

    const before = rt.render(() => useGridText("IBM Plex Sans"));
    expect(before).not.toBe(monoGridText);
    expect(load.mock.calls.map(([font]) => font)).toEqual([fonts.cell, fonts.name, fonts.type]);

    await settle();
    const after = rt.render(() => useGridText("IBM Plex Sans"));
    expect(after).not.toBe(before);
    expect(after.key).toBe(before.key);

    // Carregada, ela não é pedida de novo, e a medida fica.
    const calls = load.mock.calls.length;
    expect(rt.render(() => useGridText("IBM Plex Sans"))).toBe(after);
    await settle();
    expect(load).toHaveBeenCalledTimes(calls);
    expect(check).toHaveBeenCalled();
  });

  it("a fonte que não carrega (o pedido falha, ou segue não pronta) não faz laço: a medida muda uma vez e para", async () => {
    const { page, load } = fakeDocument({ loaded: () => false, load: () => Promise.reject(new Error("falhou")) });
    host.document = page;

    const before = rt.render(() => useGridText("IBM Plex Sans"));
    await settle();
    const after = rt.render(() => useGridText("IBM Plex Sans"));
    await settle();

    expect(after).not.toBe(before);
    expect(rt.render(() => useGridText("IBM Plex Sans"))).toBe(after);
    // Os três pedidos de antes, e nenhum depois: o efeito só roda quando a página ou a pilha mudam.
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("o pedido de uma página que a grade já deixou não troca a medida da de agora", async () => {
    let finish: () => void = () => {};
    const first = fakeDocument({ loaded: () => false, load: () => new Promise((resolve) => (finish = () => resolve([]))) });
    host.document = first.page;
    rt.render(() => useGridText("IBM Plex Sans"));

    host.document = fakeDocument().page;
    const second = rt.render(() => useGridText("IBM Plex Sans"));
    finish();
    await settle();

    expect(rt.render(() => useGridText("IBM Plex Sans"))).toBe(second);
  });
});
