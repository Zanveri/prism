import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Os casos de borda do medidor da grade (RN-CONFIG-008): a ordem em que o contexto recebe as fontes, duas famílias no mesmo `canvas`, a fonte trocada com o pedido de
// carga a caminho e a medida nova que não herda a conta da fonte de reserva. Os ganchos do React são simulados (`createHookRuntime`), como em `use-grid-text.test.ts`.
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
  /** `fonts.check`: o que devolve, por fonte. */
  loaded?: (font: string) => boolean;
  /** `fonts.load`: quando resolve. */
  load?: (font: string) => Promise<unknown>;
  /** A largura de cada caractere na fonte atribuída ao contexto, a cada medida (a de uma fonte que carrega depois muda). */
  width?: (font: string) => number;
};

/** Um documento de mentira que lembra, em ordem, cada fonte atribuída ao contexto e cada texto medido. */
function fakeDocument({ loaded = () => true, load = () => Promise.resolve([]), width = () => 7 }: Options = {}) {
  const assigned: string[] = [];
  const measured: { font: string; text: string }[] = [];
  let font = "10px sans-serif";
  const context = {
    get font() {
      return font;
    },
    set font(value: string) {
      assigned.push(value);
      font = value;
    },
    measureText(text: string) {
      measured.push({ font, text });
      return { width: width(font) * [...text].length };
    },
  };
  const loadFont = vi.fn(load);
  const page = { createElement: vi.fn(() => ({ getContext: vi.fn(() => context) })), fonts: { check: vi.fn(loaded), load: loadFont } };
  return { page: page as unknown as Document, assigned, measured, load: loadFont };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  host.document = undefined;
});
afterEach(() => rt.unmount());

describe("o contexto recebe cada fonte do zero (o `canvas` ignora a atribuição igual à que já tem)", () => {
  it("antes de cada uma das três fontes, a sentinela: a conferência não passa por uma fonte que já estava lá", () => {
    const { page, assigned } = fakeDocument();

    gridTextFor(page, family);

    // A conferência de cada fonte: sentinela, depois a fonte. Depois dela, a medida do "0" na célula.
    expect(assigned.slice(0, 6)).toEqual(["10px sans-serif", fonts.cell, "10px sans-serif", fonts.name, "10px sans-serif", fonts.type]);
    expect(assigned[6]).toBe(fonts.cell);
  });

  it("cada medida atribui a sua fonte antes de medir: duas famílias intercaladas no mesmo `canvas` não se misturam", () => {
    const { page, measured } = fakeDocument();
    const inter = resolvedFontFamily("ui", "Inter");
    const app = gridTextFor(page, family);
    const other = gridTextFor(page, inter);
    measured.length = 0;

    // O contexto parou na última fonte da outra; quem mede depois diz a sua.
    app.cell("a");
    other.name("b");
    app.type("c");
    other.cell("d");

    expect(measured).toEqual([
      { font: fonts.cell, text: "a" },
      { font: gridFonts(inter).name, text: "b" },
      { font: fonts.type, text: "c" },
      { font: gridFonts(inter).cell, text: "d" },
    ]);
  });

  it("o `canvas` é pedido uma vez por documento, por mais medidas e famílias que haja", () => {
    const { page } = fakeDocument();
    const createElement = (page as unknown as { createElement: ReturnType<typeof vi.fn> }).createElement;

    for (const name of ["IBM Plex Sans", "Inter", "Arial", "Segoe UI"]) gridTextFor(page, resolvedFontFamily("ui", name)).cell("a");

    expect(createElement).toHaveBeenCalledTimes(1);
  });
});

describe("a fonte do app que chega depois mede de novo, sem herdar a conta da reserva", () => {
  it("a medida de antes guarda a largura da reserva; a de depois mede os mesmos caracteres na fonte que chegou", async () => {
    let ready = false;
    const arrivals: (() => void)[] = [];
    const { page } = fakeDocument({
      loaded: () => ready,
      load: () => new Promise((resolve) => void arrivals.push(() => ((ready = true), resolve([])))),
      // A reserva é mais larga que a fonte do app.
      width: () => (ready ? 6 : 8),
    });
    host.document = page;

    const before = rt.render(() => useGridText("IBM Plex Sans"));
    expect(before.cell("aaaa")).toBe(4 * 8 + 1);
    expect(before.name("aa")).toBe(2 * 8 + 1);

    for (const arrive of arrivals) arrive();
    await settle();
    const after = rt.render(() => useGridText("IBM Plex Sans"));

    expect(after).not.toBe(before);
    expect(after.cell("aaaa")).toBe(4 * 6 + 1);
    expect(after.name("aa")).toBe(2 * 6 + 1);
    // O que a medida de antes já guardou não muda de mão: quem ainda a segura vê a conta que ela fez.
    expect(before.cell("aaaa")).toBe(4 * 8 + 1);
  });

  it("trocar a família enquanto o pedido da antiga está a caminho: quando ele chega, a medida da nova fica como está", async () => {
    const finish: (() => void)[] = [];
    const { page, load } = fakeDocument({
      // Só a pilha do app pura está por carregar; a da escolhida (do sistema) diz que está pronta.
      loaded: (font) => font.includes('"Inter"'),
      load: () => new Promise((resolve) => void finish.push(() => resolve([]))),
    });
    host.document = page;

    rt.render(() => useGridText("IBM Plex Sans"));
    expect(load).toHaveBeenCalledTimes(3);

    const inter = rt.render(() => useGridText("Inter"));
    for (const resolve of finish) resolve();
    await settle();

    // O pedido da fonte antiga acabou de chegar; a grade já está em outra, e a medida dela não troca por causa dele.
    expect(rt.render(() => useGridText("Inter"))).toBe(inter);
  });

  it("voltar à família anterior depois de a fonte chegar mede com a fonte já carregada, sem pedir de novo", async () => {
    let ready = false;
    const { page, load } = fakeDocument({
      loaded: () => ready,
      load: async () => {
        ready = true;
        return [];
      },
    });
    host.document = page;

    rt.render(() => useGridText("IBM Plex Sans"));
    await settle();
    const calls = load.mock.calls.length;

    rt.render(() => useGridText("Inter"));
    rt.render(() => useGridText("IBM Plex Sans"));
    await settle();

    expect(load).toHaveBeenCalledTimes(calls);
  });
});

describe("unloadedFonts com a pilha de uma fonte escolhida", () => {
  it("confere as três fontes da pilha inteira (a escolhida e a do app atrás), sem filtrar nenhuma", () => {
    const { page } = fakeDocument({ loaded: () => false });
    const inter = resolvedFontFamily("ui", "Inter");

    expect(unloadedFonts(page, inter)).toEqual(Object.values(gridFonts(inter)));
  });

  it("a fonte do sistema não está na lista da página: a conferência diz pronta, e nada é pedido", async () => {
    const { page, load } = fakeDocument({ loaded: () => true });
    host.document = page;

    rt.render(() => useGridText("DejaVu Sans"));
    await settle();

    expect(load).not.toHaveBeenCalled();
  });
});

describe("sem nada a medir, a mono", () => {
  it("o documento sem lista de fontes e sem contexto devolve a conta de antes, e nunca lança", () => {
    const page = { createElement: () => ({ getContext: () => null }) } as unknown as Document;

    expect(gridTextFor(page, family)).toBe(monoGridText);
    expect(unloadedFonts(page, family)).toEqual([]);
  });
});
